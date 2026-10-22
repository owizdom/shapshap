// B2 valuation working, rewritten for spec 0002 (pricing matches Ziggatech). Rules: src/types.ts.
// Expected figures are hard-coded from the spec table or computed by the independent helper below, never by src/.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { loadCatalog } from "../src/catalog.ts";
import { valueTradeIn } from "../src/tools.ts";
import { readQuote } from "../src/quote.ts";
import { QUOTE_TTL_MS } from "../src/types.ts";
import type { Condition, FaultRow, PriceRow, Valuation, ValueTradeInArgs } from "../src/types.ts";
import { FLAWLESS, NOW, SECRET, makeCtx, tinyCatalog } from "./fakes.ts";

const dataDir = fileURLToPath(new URL("../data", import.meta.url));
const real = loadCatalog(dataDir);
const buyable = real.faults.filter((f) => f.action !== "refuse");

// ---- Independent model of the website calculator (multipliers copied by hand from the spec, not imported) ----
const SCREEN = { flawless: 1.0, light: 0.92, visible: 0.80, cracked: 0.45 };
const BODY = { flawless: 1.0, light: 0.96, visible: 0.90, cracked: 0.65 };
const BATTERY = { healthy: 1.0, worn: 0.95, service: 0.88, replaced: 0.85 };
const PARTS = { genuine: 1.0, one: 0.88, multiple: 0.78 };
const DEFAULT: Condition = { screen: "light", body: "light", battery: "healthy", parts: "genuine" };

function website(base: number, c: Condition) {
  const exact = base * (0.65 * SCREEN[c.screen] + 0.35 * BODY[c.body]) * BATTERY[c.battery] * PARTS[c.parts];
  return { W: Math.round(exact), siteNo: Math.round(exact * 0.3) };
}

// The full expected working for a price row, a set of fault rows and a condition.
function expected(p: PriceRow, faults: FaultRow[], c: Condition) {
  const { W, siteNo } = website(p.base_ngn, c);
  const d = faults.map((f) => {
    const pct = Math.round((W * f.deduct_pct) / 100);
    const repair = f.repair === "screen" ? p.screen_repair_ngn : f.repair === "camera" ? p.camera_repair_ngn : null;
    return { fault: f.fault, ngn: Math.max(pct, repair ?? 0) };
  });
  const sumD = d.reduce((s, x) => s + x.ngn, 0);
  const adjustments: { label: string; ngn: number }[] = [];
  if (W !== p.base_ngn) {
    adjustments.push({ label: `Condition: screen ${c.screen}, body ${c.body}, battery ${c.battery}, parts ${c.parts}`, ngn: W - p.base_ngn });
  }
  let v = W - sumD;
  if (faults.length > 0 && siteNo > v) {
    adjustments.push({ label: SITE, ngn: siteNo - v });
    v = siteNo;
  }
  if (p.floor_ngn > v) {
    adjustments.push({ label: FLOOR, ngn: p.floor_ngn - v });
    v = p.floor_ngn;
  }
  return { W, siteNo, d, sumD, adjustments, value: v };
}

const SITE = "Raised to our website quote for a faulty phone";
const FLOOR = "Minimum we pay for this model";
const sum = (xs: { ngn: number }[]) => xs.reduce((s, x) => s + x.ngn, 0);
const adds = (r: Valuation) => r.base_ngn - sum(r.deductions) + sum(r.adjustments) === r.value_ngn;
const cond = (over: Partial<Condition> = {}): Condition => ({ ...DEFAULT, ...over });
const fault = (k: string) => real.faults.find((f) => f.fault === k)!;
const price = (m: string, gb: number) => real.prices.find((p) => p.model === m && p.capacity_gb === gb)!;

function asValuation(r: unknown): Valuation {
  assert.ok(r && typeof r === "object" && !("error" in r), `expected a valuation, got ${JSON.stringify(r)}`);
  return r as Valuation;
}

const PLUS = { model: "iPhone 16 Plus", capacity_gb: 256 } as const;
async function plus(faults: string[], over: Partial<ValueTradeInArgs> = {}): Promise<Valuation> {
  const { deps } = makeCtx(real);
  return asValuation(await valueTradeIn(deps, { ...PLUS, faults, ...over }));
}

describe("loadCatalog (real data)", () => {
  test("parses the three csv files into typed rows", () => {
    assert.equal(real.prices.length, 31);
    assert.equal(real.faults.length, 34);
    assert.equal(real.stock.length, 35);
    assert.deepEqual(price("iPhone 16 Plus", 256), {
      model: "iPhone 16 Plus", capacity_gb: 256, base_ngn: 775890, floor_ngn: 115000, screen_repair_ngn: 444150, camera_repair_ngn: 228150,
    });
    const f = fault("charging_port");
    assert.equal(f.deduct_pct, 5);
    assert.equal(f.action, "deduct");
    assert.equal(f.basis, "sourced");
    assert.equal(f.repair, "");
    assert.equal(typeof f.deduct_pct, "number");
    assert.equal(fault("icloud_locked").action, "refuse");
    assert.equal(fault("charging_ic").action, "inspect");
    assert.equal(fault("charging_ic").check_hint, "30 min on a wall socket with two cables, then force restart");
    const u = real.stock.find((r) => r.unit_id === "SS-1401");
    assert.equal(u?.price_ngn, 515000);
    assert.equal(typeof u?.capacity_gb, "number");
  });

  test("the seven condition faults are gone from the faults tab", () => {
    const keys = new Set(real.faults.map((f) => f.fault));
    for (const k of ["screen_cracked", "back_glass", "frame_dents", "battery_service", "battery_not_genuine", "aftermarket_screen", "parts_unknown_other"]) {
      assert.ok(!keys.has(k), `${k} should have left faults.csv`);
    }
    assert.equal(buyable.length, 28);
  });

  test("the repair column: screen on four faults, camera on two, blank everywhere else", () => {
    const by = (r: string) => real.faults.filter((f) => f.repair === r).map((f) => f.fault).sort();
    assert.deepEqual(by("screen"), ["display_lines", "oled_burn_in", "screen_dead", "touch_fault"]);
    assert.deepEqual(by("camera"), ["front_camera", "rear_camera"]);
    assert.equal(real.faults.filter((f) => f.repair === "").length, 34 - 6);
  });
});

describe("P10 the prices tab equals the website formula at flawless", () => {
  // [model, capacity, calculator base, storage steps applied on top]. Hand-copied from the spec evidence, not from the csv.
  const TABLE: [string, number, number, number[]][] = [
    ["iPhone 12", 64, 206000, []], ["iPhone 12", 128, 206000, [1.16]],
    ["iPhone 12 Pro", 128, 285000, []], ["iPhone 12 Pro Max", 128, 344000, []],
    ["iPhone 13", 128, 302000, []], ["iPhone 13", 256, 302000, [1.11]],
    ["iPhone 13 Pro", 128, 423000, []], ["iPhone 13 Pro", 256, 423000, [1.11]],
    ["iPhone 13 Pro Max", 128, 461000, []], ["iPhone 13 Pro Max", 256, 461000, [1.11]],
    ["iPhone 14", 128, 361000, []], ["iPhone 14 Plus", 128, 389000, []],
    ["iPhone 14 Pro", 128, 521000, []], ["iPhone 14 Pro", 256, 521000, [1.11]],
    ["iPhone 14 Pro Max", 256, 608000, [1.11]],
    ["iPhone 15", 128, 495000, []], ["iPhone 15 Plus", 128, 511000, []],
    ["iPhone 15 Pro", 128, 671000, []], ["iPhone 15 Pro", 256, 671000, [1.11]],
    ["iPhone 15 Pro Max", 256, 748000, []],
    ["iPhone 16e", 128, 434000, []], ["iPhone 16", 128, 691000, []],
    ["iPhone 16 Plus", 128, 699000, []], ["iPhone 16 Plus", 256, 699000, [1.11]],
    ["iPhone 16 Pro", 128, 715000, []], ["iPhone 16 Pro", 256, 715000, [1.11]],
    ["iPhone 16 Pro Max", 256, 805000, []],
    ["iPhone 17", 256, 836000, []], ["iPhone Air", 256, 836000, []],
    ["iPhone 17 Pro", 256, 1035000, []], ["iPhone 17 Pro Max", 256, 1167000, []],
  ];

  test("all 31 rows exist and each base_ngn is round(calculator base x storage steps)", () => {
    assert.equal(TABLE.length, 31);
    assert.equal(real.prices.length, 31);
    for (const [model, gb, base, steps] of TABLE) {
      const row = real.prices.find((p) => p.model === model && p.capacity_gb === gb);
      assert.ok(row, `${model} ${gb} missing`);
      const want = Math.round(steps.reduce((x, s) => x * s, base));
      assert.equal(row.base_ngn, want, `${model} ${gb}`);
    }
  });

  test("the nine rows that changed carry the spec's figures", () => {
    const want: [string, number, number][] = [
      ["iPhone 12", 128, 238960], ["iPhone 13", 256, 335220], ["iPhone 13 Pro", 256, 469530],
      ["iPhone 13 Pro Max", 256, 511710], ["iPhone 14 Pro", 256, 578310], ["iPhone 14 Pro Max", 256, 674880],
      ["iPhone 15 Pro", 256, 744810], ["iPhone 16 Plus", 256, 775890], ["iPhone 16 Pro", 256, 793650],
    ];
    for (const [m, gb, b] of want) assert.equal(price(m, gb).base_ngn, b, `${m} ${gb}`);
  });

  test("flawless and fully working, a no-fault quote is exactly base_ngn for every row", async () => {
    const { deps } = makeCtx(real);
    for (const p of real.prices) {
      const r = asValuation(await valueTradeIn(deps, { model: p.model, capacity_gb: p.capacity_gb, faults: [], ...FLAWLESS }));
      assert.equal(r.value_ngn, p.base_ngn, `${p.model} ${p.capacity_gb}`);
      assert.deepEqual(r.adjustments, []);
    }
  });
});

describe("repair prices on the prices tab", () => {
  test("published for 30 of 31 models; iPhone 16e is blank", () => {
    const blank = real.prices.filter((p) => p.screen_repair_ngn === null || p.camera_repair_ngn === null);
    assert.deepEqual(blank.map((p) => p.model), ["iPhone 16e"]);
    assert.equal(price("iPhone 16e", 128).screen_repair_ngn, null);
    assert.equal(price("iPhone 16e", 128).camera_repair_ngn, null);
  });

  test("spot checks against the Ziggatech repair page", () => {
    assert.equal(price("iPhone 16 Plus", 256).screen_repair_ngn, 444150);
    assert.equal(price("iPhone 16 Plus", 256).camera_repair_ngn, 228150);
    assert.equal(price("iPhone 16 Plus", 128).screen_repair_ngn, 444150);
    assert.equal(price("iPhone 12", 64).screen_repair_ngn, 162000);
    assert.equal(price("iPhone 12", 64).camera_repair_ngn, 228150);
    assert.equal(price("iPhone 12 Pro Max", 128).camera_repair_ngn, 295650);
    assert.equal(price("iPhone 17 Pro Max", 256).screen_repair_ngn, 511650);
  });
});

describe("spec 0002 acceptance tests, iPhone 16 Plus 256GB (base 775,890)", () => {
  test("P1 no faults, default condition: 724,681, the website Yes quote", async () => {
    const r = await plus([]);
    assert.equal(r.base_ngn, 775890);
    assert.equal(r.value_ngn, 724681);
    assert.deepEqual(r.deductions, []);
    assert.deepEqual(r.adjustments, [
      { label: "Condition: screen light, body light, battery healthy, parts genuine", ngn: -51209 },
    ]);
    assert.deepEqual(r.condition, DEFAULT);
    assert.deepEqual(r.inspect_faults, []);
    assert.ok(adds(r));
  });

  test("P2 screen flawless and body flawless: 775,890 and no adjustment", async () => {
    const r = await plus([], FLAWLESS);
    assert.equal(r.value_ngn, 775890);
    assert.deepEqual(r.adjustments, []);
    assert.deepEqual(r.condition, { screen: "flawless", body: "flawless", battery: "healthy", parts: "genuine" });
    assert.ok(adds(r));
  });

  test("P3 screen cracked, no faults: 487,647, the website cracked-glass quote", async () => {
    const r = await plus([], { screen: "cracked" });
    assert.equal(r.value_ngn, 487647);
    assert.deepEqual(r.deductions, []);
    assert.deepEqual(r.adjustments, [
      { label: "Condition: screen cracked, body light, battery healthy, parts genuine", ngn: 487647 - 775890 },
    ]);
    assert.ok(adds(r));
  });

  test("P4 charging_ic (20%, no repair price): d 144,936, value 579,745, provisional", async () => {
    const r = await plus(["charging_ic"]);
    assert.deepEqual(r.deductions.map((d) => [d.fault, d.ngn]), [["charging_ic", 144936]]);
    assert.equal(r.value_ngn, 579745);
    assert.deepEqual(r.inspect_faults, [{ fault: "charging_ic", label: fault("charging_ic").label }]);
    assert.ok(!r.adjustments.some((a) => a.label === SITE), "579,745 is above the website No quote 217,404");
    assert.ok(adds(r));
  });

  test("P5 rear_camera (10%, camera repair 228,150): the repair price beats 72,468; value 496,531", async () => {
    const r = await plus(["rear_camera"]);
    assert.deepEqual(r.deductions.map((d) => [d.fault, d.ngn]), [["rear_camera", 228150]]);
    assert.equal(r.value_ngn, 496531);
    assert.deepEqual(r.inspect_faults, []);
    assert.ok(adds(r));
  });

  test("P6 screen_dead (25%, screen repair 444,150): d 444,150, value 280,531", async () => {
    const r = await plus(["screen_dead"]);
    assert.deepEqual(r.deductions.map((d) => [d.fault, d.ngn]), [["screen_dead", 444150]]);
    assert.equal(r.value_ngn, 280531);
    assert.ok(adds(r));
  });

  test("P7 screen_dead + rear_camera: W - sum(d) = 52,381, raised to the website No quote 217,404 with the adjustment line", async () => {
    const r = await plus(["screen_dead", "rear_camera"]);
    assert.equal(724681 - sum(r.deductions), 52381);
    assert.equal(sum(r.deductions), 444150 + 228150);
    assert.equal(r.value_ngn, 217404);
    assert.deepEqual(r.adjustments, [
      { label: "Condition: screen light, body light, battery healthy, parts genuine", ngn: -51209 },
      { label: SITE, ngn: 217404 - 52381 },
    ]);
    assert.ok(adds(r));
  });

  test("P8 iPhone 12 64GB with rear_camera: W 192,404, d 228,150, value 57,721 (the No quote)", async () => {
    const { deps } = makeCtx(real);
    const r = asValuation(await valueTradeIn(deps, { model: "iPhone 12", capacity_gb: 64, faults: ["rear_camera"] }));
    assert.equal(r.base_ngn, 206000);
    assert.deepEqual(r.deductions.map((d) => d.ngn), [228150]);
    assert.equal(206000 + r.adjustments[0].ngn, 192404, "W is the first adjustment applied to the base");
    assert.equal(r.value_ngn, 57721);
    assert.deepEqual(r.adjustments, [
      { label: "Condition: screen light, body light, battery healthy, parts genuine", ngn: 192404 - 206000 },
      { label: SITE, ngn: 57721 - (192404 - 228150) },
    ]);
    assert.ok(adds(r));
  });

  test("P9 every quote in P1-P8 adds up, and a faulty phone is never below the website No quote", async () => {
    const { deps } = makeCtx(real);
    const cases: [string, number, string[], Partial<ValueTradeInArgs>, number][] = [
      ["iPhone 16 Plus", 256, [], {}, 0],
      ["iPhone 16 Plus", 256, [], FLAWLESS, 0],
      ["iPhone 16 Plus", 256, [], { screen: "cracked" }, 0],
      ["iPhone 16 Plus", 256, ["charging_ic"], {}, 217404],
      ["iPhone 16 Plus", 256, ["rear_camera"], {}, 217404],
      ["iPhone 16 Plus", 256, ["screen_dead"], {}, 217404],
      ["iPhone 16 Plus", 256, ["screen_dead", "rear_camera"], {}, 217404],
      ["iPhone 12", 64, ["rear_camera"], {}, 57721],
    ];
    for (const [model, capacity_gb, faults, over, siteNo] of cases) {
      const r = asValuation(await valueTradeIn(deps, { model, capacity_gb, faults, ...over }));
      const tag = `${model} ${capacity_gb} ${faults.join("+")} ${JSON.stringify(over)}`;
      assert.ok(adds(r), tag);
      const row = price(model, capacity_gb);
      const c = { ...DEFAULT, ...(over as Partial<Condition>) };
      assert.equal(r.value_ngn, expected(row, faults.map(fault), c).value, tag);
      assert.equal(r.base_ngn - sum(r.deductions) + sum(r.adjustments), r.value_ngn, tag);
      if (faults.length > 0) assert.ok(r.value_ngn >= siteNo, `${tag}: ${r.value_ngn} < ${siteNo}`);
    }
  });

  test("P12 screen_cracked sent as a fault is UNKNOWN_FAULT, never double-counted", async () => {
    const { deps } = makeCtx(real);
    for (const k of ["screen_cracked", "back_glass", "frame_dents", "battery_service", "battery_not_genuine", "aftermarket_screen", "parts_unknown_other"]) {
      const r = await valueTradeIn(deps, { ...PLUS, faults: [k] });
      assert.ok("error" in r, `${k} ${JSON.stringify(r)}`);
      assert.equal(r.error, "UNKNOWN_FAULT");
      assert.match(r.detail, new RegExp(k));
      assert.ok(!("value_ngn" in r) && !("quote_token" in r));
    }
  });
});

describe("condition inputs (CONDITION table, hard-coded on iPhone 16 Plus 256, no faults)", () => {
  const cases: [string, Partial<ValueTradeInArgs>, number][] = [
    ["screen flawless (body light)", { screen: "flawless" }, 765028],
    ["screen visible", { screen: "visible" }, 664162],
    ["screen cracked", { screen: "cracked" }, 487647],
    ["body flawless (screen light)", { body: "flawless" }, 735544],
    ["body visible", { body: "visible" }, 708388],
    ["body cracked", { body: "cracked" }, 640497],
    ["battery worn", { battery: "worn" }, 688447],
    ["battery service", { battery: "service" }, 637720],
    ["battery replaced", { battery: "replaced" }, 615979],
    ["parts one", { parts: "one" }, 637720],
    ["parts multiple", { parts: "multiple" }, 565251],
    ["all four changed", { screen: "visible", body: "visible", battery: "worn", parts: "one" }, 541618],
  ];
  for (const [name, over, value] of cases) {
    test(`${name}: ${value}`, async () => {
      const r = await plus([], over);
      assert.equal(r.value_ngn, value);
      assert.deepEqual(r.condition, { ...DEFAULT, ...over });
      assert.deepEqual(r.adjustments, [{ label: `Condition: screen ${r.condition.screen}, body ${r.condition.body}, battery ${r.condition.battery}, parts ${r.condition.parts}`, ngn: value - 775890 }]);
      assert.ok(adds(r));
    });
  }

  test("the condition adjustment is one negative line, named for what was assumed, first in the list", async () => {
    const r = await plus(["screen_dead", "rear_camera"], { battery: "worn" });
    assert.equal(r.adjustments[0].label, "Condition: screen light, body light, battery worn, parts genuine");
    assert.ok(r.adjustments[0].ngn < 0);
    assert.equal(r.adjustments.filter((a) => a.label.startsWith("Condition")).length, 1);
  });

  test("no condition line when the condition equals the base (flawless screen, body, battery, parts)", async () => {
    const r = await plus([], { ...FLAWLESS, battery: "healthy", parts: "genuine" });
    assert.equal(r.adjustments.length, 0);
  });

  test("omitted inputs fall back to light, light, healthy, genuine; given ones are kept", async () => {
    assert.deepEqual((await plus([])).condition, DEFAULT);
    assert.deepEqual((await plus([], { parts: "multiple" })).condition, { ...DEFAULT, parts: "multiple" });
  });

  test("the fault percentage is taken of W (the condition-adjusted value), not of the base", async () => {
    const r = await plus(["charging_port"]);
    assert.equal(r.deductions[0].ngn, 36234); // 5% of 724,681 = 36,234.05
    assert.equal(r.value_ngn, 688447);
  });
});

describe("B2 valuation", () => {
  test("worked case: iPhone 16 Plus 256 GB charging_port at default condition is 688,447", async () => {
    const { deps } = makeCtx(real);
    const r = asValuation(await valueTradeIn(deps, { ...PLUS, faults: ["charging_port"] }));
    assert.equal(r.model, "iPhone 16 Plus");
    assert.equal(r.capacity_gb, 256);
    assert.equal(r.base_ngn, 775890);
    assert.equal(r.deductions.length, 1);
    assert.equal(r.deductions[0].fault, "charging_port");
    assert.equal(r.deductions[0].ngn, 36234);
    assert.equal(typeof r.deductions[0].label, "string");
    assert.deepEqual(r.inspect_faults, []);
    assert.equal(r.value_ngn, 688447);
    assert.equal(typeof r.quote_token, "string");
    assert.equal(r.valid_until, new Date(NOW + QUOTE_TTL_MS).toISOString());
  });

  test("every price row and every single deduct or inspect fault, default condition: the independent formula agrees", async () => {
    const { deps } = makeCtx(real);
    let checked = 0;
    for (const p of real.prices) {
      for (const f of buyable) {
        const e = expected(p, [f], DEFAULT);
        const r = asValuation(await valueTradeIn(deps, { model: p.model, capacity_gb: p.capacity_gb, faults: [f.fault] }));
        const tag = `${p.model} ${p.capacity_gb} ${f.fault}`;
        assert.equal(r.base_ngn, p.base_ngn, tag);
        assert.equal(r.deductions[0].ngn, e.d[0].ngn, `${tag} deduction`);
        assert.equal(r.value_ngn, e.value, `${tag} value`);
        assert.deepEqual(r.adjustments, e.adjustments, `${tag} adjustments`);
        assert.ok(r.value_ngn >= p.floor_ngn && r.value_ngn >= e.siteNo, tag);
        assert.ok(adds(r), tag);
        checked++;
      }
    }
    assert.equal(checked, 31 * 28);
  });

  test("every price row with all deduct and inspect faults at once: floored at the website No quote, sum identity", async () => {
    const { deps } = makeCtx(real);
    const all = buyable.map((f) => f.fault);
    for (const p of real.prices) {
      const e = expected(p, buyable, DEFAULT);
      const r = asValuation(await valueTradeIn(deps, { model: p.model, capacity_gb: p.capacity_gb, faults: all }));
      const tag = `${p.model} ${p.capacity_gb}`;
      assert.ok(e.W - e.sumD < e.siteNo, `${tag}: the faults together must drag the value under the No quote`);
      assert.equal(r.value_ngn, e.value, tag);
      assert.deepEqual(r.adjustments, e.adjustments, tag);
      assert.ok(r.adjustments.some((a) => a.label === SITE && a.ngn > 0), tag);
      assert.ok(adds(r), tag);
    }
  });

  test("condition sweep: five conditions x every row x three fault sets match the independent formula", async () => {
    const { deps } = makeCtx(real);
    const conds: Condition[] = [
      DEFAULT,
      { screen: "flawless", body: "flawless", battery: "healthy", parts: "genuine" },
      { screen: "cracked", body: "cracked", battery: "replaced", parts: "multiple" },
      { screen: "visible", body: "cracked", battery: "worn", parts: "one" },
      { screen: "light", body: "visible", battery: "service", parts: "genuine" },
    ];
    const sets = [[], ["charging_port", "rear_camera"], ["screen_dead", "front_camera", "face_id"]];
    for (const c of conds) {
      for (const p of real.prices) {
        for (const fs of sets) {
          const e = expected(p, fs.map(fault), c);
          const r = asValuation(await valueTradeIn(deps, { model: p.model, capacity_gb: p.capacity_gb, faults: fs, ...c }));
          const tag = `${p.model} ${p.capacity_gb} ${fs.join("+")} ${JSON.stringify(c)}`;
          assert.equal(r.value_ngn, e.value, tag);
          assert.deepEqual(r.adjustments, e.adjustments, tag);
          assert.deepEqual(r.deductions.map((d) => d.ngn), e.d.map((d) => d.ngn), tag);
          assert.deepEqual(r.condition, c, tag);
          assert.ok(adds(r), tag);
        }
      }
    }
  });

  test("no faults: exact naira, no rounding to 1,000 (hand-built, base 100,005)", async () => {
    const { deps } = makeCtx(tinyCatalog());
    const r = asValuation(await valueTradeIn(deps, { model: "Test Phone", capacity_gb: 256, faults: [], ...FLAWLESS }));
    assert.equal(r.base_ngn, 100005);
    assert.deepEqual(r.deductions, []);
    assert.equal(r.value_ngn, 100005);
    assert.deepEqual(r.adjustments, []);
  });

  test("a hand-built default condition: base 100,000 gives 93,400 with one -6,600 line", async () => {
    const { deps } = makeCtx(tinyCatalog());
    const r = asValuation(await valueTradeIn(deps, { model: "Test Phone", capacity_gb: 128, faults: [] }));
    assert.equal(r.value_ngn, 93400);
    assert.deepEqual(r.adjustments, [{ label: "Condition: screen light, body light, battery healthy, parts genuine", ngn: -6600 }]);
  });

  test("each deduction is rounded individually, then summed, and the value is exact naira (hand-built)", async () => {
    const { deps } = makeCtx(tinyCatalog());
    // base 100005 flawless: a = 10% = 10000.5 -> 10001 ; b = 15% = 15000.75 -> 15001 ; value 100005 - 25002 = 75003
    const r = asValuation(await valueTradeIn(deps, { model: "Test Phone", capacity_gb: 256, faults: ["a", "b"], ...FLAWLESS }));
    const byFault = Object.fromEntries(r.deductions.map((d) => [d.fault, d.ngn]));
    assert.equal(byFault.a, 10001);
    assert.equal(byFault.b, 15001);
    assert.equal(r.value_ngn, 75003);
    assert.deepEqual(r.adjustments, []);
    assert.ok(adds(r));
  });

  test("no 'Rounded down' adjustment exists anywhere any more", async () => {
    const { deps } = makeCtx(real);
    for (const p of real.prices) {
      for (const fs of [[], ["charging_port"], ["charging_port", "rear_camera"]]) {
        const r = asValuation(await valueTradeIn(deps, { model: p.model, capacity_gb: p.capacity_gb, faults: fs }));
        assert.ok(!r.adjustments.some((a) => /rounded|cap/i.test(a.label)), `${p.model} ${fs}`);
      }
    }
  });

  test("duplicate faults count once", async () => {
    const { deps } = makeCtx(tinyCatalog());
    const once = asValuation(await valueTradeIn(deps, { model: "Test Phone", capacity_gb: 128, faults: ["a"], ...FLAWLESS }));
    const dup = asValuation(await valueTradeIn(deps, { model: "Test Phone", capacity_gb: 128, faults: ["a", "a", "a"], ...FLAWLESS }));
    assert.equal(once.value_ngn, 90000);
    assert.equal(dup.value_ngn, 90000);
    assert.equal(dup.deductions.length, 1);
    assert.equal(dup.deductions[0].ngn, 10000);
  });

  test("model match ignores case and surrounding spaces", async () => {
    const { deps } = makeCtx(real);
    const r = asValuation(await valueTradeIn(deps, { model: "  iphone 16 PLUS ", capacity_gb: 256, faults: ["charging_port"] }));
    assert.equal(r.value_ngn, 688447);
    assert.equal(r.model, "iPhone 16 Plus");
  });

  test("the issued token carries the sorted unique faults, the condition, value and expiry", async () => {
    const { deps } = makeCtx(real);
    const r = asValuation(await valueTradeIn(deps, {
      model: "iPhone 16 Plus", capacity_gb: 256, faults: ["screen_dead", "charging_port", "charging_port"], battery: "worn", parts: "one",
    }));
    const p = readQuote(r.quote_token, SECRET, NOW);
    assert.ok(typeof p === "object", `token should be valid, got ${String(p)}`);
    assert.equal(p.v, 1);
    assert.equal(p.model, "iPhone 16 Plus");
    assert.equal(p.capacity_gb, 256);
    assert.deepEqual(p.faults, ["charging_port", "screen_dead"]);
    assert.deepEqual(p.condition, { screen: "light", body: "light", battery: "worn", parts: "one" });
    assert.deepEqual(r.condition, p.condition);
    assert.equal(p.value_ngn, r.value_ngn);
    assert.equal(p.iat, NOW);
    assert.equal(p.exp, NOW + QUOTE_TTL_MS);
  });

  test("a default-condition token carries the default condition", async () => {
    const r = await plus([]);
    const p = readQuote(r.quote_token, SECRET, NOW);
    assert.ok(typeof p === "object");
    assert.deepEqual(p.condition, DEFAULT);
  });

  test("MODEL_NOT_BOUGHT for a model not in the price file", async () => {
    const { deps } = makeCtx(real);
    const r = await valueTradeIn(deps, { model: "iPhone 11", capacity_gb: 64, faults: [] });
    assert.ok("error" in r);
    assert.equal(r.error, "MODEL_NOT_BOUGHT");
    assert.equal(typeof r.detail, "string");
    assert.ok(!("value_ngn" in r), "must never invent a value");
  });

  test("CAPACITY_UNKNOWN for a known model with an unlisted capacity", async () => {
    const { deps } = makeCtx(real);
    const r = await valueTradeIn(deps, { model: "iPhone 16 Plus", capacity_gb: 512, faults: [] });
    assert.ok("error" in r);
    assert.equal(r.error, "CAPACITY_UNKNOWN");
  });

  test("UNKNOWN_FAULT for a fault id not in the fault file", async () => {
    const { deps } = makeCtx(real);
    const r = await valueTradeIn(deps, { ...PLUS, faults: ["charging_port", "haunted"] });
    assert.ok("error" in r);
    assert.equal(r.error, "UNKNOWN_FAULT");
    assert.match(r.detail, /haunted/);
  });
});

describe("repair price as a minimum deduction", () => {
  test("repair price lifts a small percentage; a bigger percentage beats a small repair price (hand-built)", async () => {
    const catalog = tinyCatalog();
    catalog.prices.push({ model: "Fix Phone", capacity_gb: 128, base_ngn: 200000, floor_ngn: 10000, screen_repair_ngn: 30000, camera_repair_ngn: null });
    catalog.faults.push(
      { fault: "scr", label: "Screen", category: "t", action: "deduct", deduct_pct: 10, check_hint: "", basis: "policy", repair: "screen" },
      { fault: "scr_big", label: "Screen big", category: "t", action: "deduct", deduct_pct: 50, check_hint: "", basis: "policy", repair: "screen" },
      { fault: "cam", label: "Camera", category: "t", action: "deduct", deduct_pct: 10, check_hint: "", basis: "policy", repair: "camera" },
    );
    const { deps } = makeCtx(catalog);
    const a = asValuation(await valueTradeIn(deps, { model: "Fix Phone", capacity_gb: 128, faults: ["scr"], ...FLAWLESS }));
    assert.equal(a.deductions[0].ngn, 30000); // 10% = 20,000 < repair 30,000
    assert.equal(a.value_ngn, 170000);
    const b = asValuation(await valueTradeIn(deps, { model: "Fix Phone", capacity_gb: 128, faults: ["scr_big"], ...FLAWLESS }));
    assert.equal(b.deductions[0].ngn, 100000); // 50% beats the repair price
    const c = asValuation(await valueTradeIn(deps, { model: "Fix Phone", capacity_gb: 128, faults: ["cam"], ...FLAWLESS }));
    assert.equal(c.deductions[0].ngn, 20000); // camera repair price not published: percentage only
  });

  test("a model with no published repair price (iPhone 16e) falls back to the percentage", async () => {
    const { deps } = makeCtx(real);
    const r = asValuation(await valueTradeIn(deps, { model: "iPhone 16e", capacity_gb: 128, faults: ["screen_dead"], ...FLAWLESS }));
    assert.deepEqual(r.deductions.map((d) => d.ngn), [108500]); // 25% of 434,000
    assert.equal(r.value_ngn, 325500);
  });
});

describe("adjustments (the working adds up)", () => {
  test("floor applies: one positive model-floor line, no site line when the site quote is not higher (hand-built)", async () => {
    const { deps } = makeCtx(tinyCatalog());
    // Cheap Phone base 50000 floor 18345: dead 70% = 35000, W - d = 15000 = site_no 15000 (not a lift), floor lifts 3345
    const r = asValuation(await valueTradeIn(deps, { model: "Cheap Phone", capacity_gb: 64, faults: ["dead"], ...FLAWLESS }));
    assert.equal(r.value_ngn, 18345);
    assert.deepEqual(r.adjustments, [{ label: FLOOR, ngn: 3345 }]);
    assert.ok(adds(r));
  });

  test("site floor then model floor, in that order, when both lift (hand-built)", async () => {
    const { deps } = makeCtx(tinyCatalog());
    // Cheap Phone: huge 90% = 45000, W - d = 5000, site_no 15000 (lift 10000), floor 18345 (lift 3345)
    const r = asValuation(await valueTradeIn(deps, { model: "Cheap Phone", capacity_gb: 64, faults: ["huge"], ...FLAWLESS }));
    assert.deepEqual(r.adjustments, [{ label: SITE, ngn: 10000 }, { label: FLOOR, ngn: 3345 }]);
    assert.equal(r.value_ngn, 18345);
    assert.ok(adds(r));
  });

  test("real data: model floor still applies when the website No quote is below it", async () => {
    // iPhone 16 Plus 256, worst condition: W 267,496, No quote 80,249, model floor 115,000.
    const r = await plus(["screen_dead", "rear_camera"], { screen: "cracked", body: "cracked", battery: "replaced", parts: "multiple" });
    assert.equal(r.value_ngn, 115000);
    assert.deepEqual(r.adjustments, [
      { label: "Condition: screen cracked, body cracked, battery replaced, parts multiple", ngn: 267496 - 775890 },
      { label: SITE, ngn: 80249 - (267496 - 672300) },
      { label: FLOOR, ngn: 115000 - 80249 },
    ]);
    assert.ok(adds(r));
  });

  test("the site-floor adjustment appears only for a faulty phone, never for a clean one", async () => {
    const { deps } = makeCtx(real);
    for (const p of real.prices) {
      const r = asValuation(await valueTradeIn(deps, { model: p.model, capacity_gb: p.capacity_gb, faults: [], screen: "cracked", body: "cracked", battery: "replaced", parts: "multiple" }));
      assert.ok(!r.adjustments.some((a) => a.label === SITE), `${p.model} ${p.capacity_gb}`);
      assert.ok(adds(r));
    }
  });

  test("a site-floor line, when present, is positive; the working adds up for 31 rows x 30 fault sets x default condition", async () => {
    const { deps } = makeCtx(real);
    const sets = [...buyable.map((f) => [f.fault]), buyable.map((f) => f.fault), []];
    let n = 0;
    for (const p of real.prices) {
      for (const faults of sets) {
        const r = asValuation(await valueTradeIn(deps, { model: p.model, capacity_gb: p.capacity_gb, faults }));
        assert.ok(adds(r), `${p.model} ${p.capacity_gb} ${faults.length} faults`);
        assert.ok(r.value_ngn >= p.floor_ngn);
        for (const a of r.adjustments) {
          if (a.label === FLOOR || a.label === SITE) assert.ok(a.ngn > 0, a.label);
          else { assert.match(a.label, /^Condition: /); assert.ok(a.ngn < 0); }
        }
        n++;
      }
    }
    assert.equal(n, 31 * 30);
  });

  test("no 70% cap: a fault set past 70% of W deducts in full when the result stays above the No quote (hand-built)", async () => {
    const { deps } = makeCtx(tinyCatalog());
    // Test Phone 128 flawless: dead 70% = 70000, value 30000 = site_no 30000, so no lift line and nothing capped
    const r = asValuation(await valueTradeIn(deps, { model: "Test Phone", capacity_gb: 128, faults: ["dead"], ...FLAWLESS }));
    assert.deepEqual(r.deductions.map((d) => d.ngn), [70000]);
    assert.deepEqual(r.adjustments, []);
    assert.equal(r.value_ngn, 30000);
    // huge 90%: deducts 90000 in full, then the website No quote lifts the value to 30000
    const h = asValuation(await valueTradeIn(deps, { model: "Test Phone", capacity_gb: 128, faults: ["huge"], ...FLAWLESS }));
    assert.deepEqual(h.deductions.map((d) => d.ngn), [90000]);
    assert.deepEqual(h.adjustments, [{ label: SITE, ngn: 20000 }]);
    assert.equal(h.value_ngn, 30000);
    assert.ok(adds(h));
  });

  test("site quote on an odd base: Odd Phone 100,500, huge 90% deducts 90,450 and is raised by 20,100 to 30,150", async () => {
    const { deps } = makeCtx(tinyCatalog());
    const r = asValuation(await valueTradeIn(deps, { model: "Odd Phone", capacity_gb: 64, faults: ["huge"], ...FLAWLESS }));
    assert.deepEqual(r.deductions.map((d) => d.ngn), [90450]);
    assert.deepEqual(r.adjustments, [{ label: SITE, ngn: 20100 }]);
    assert.equal(r.value_ngn, 30150);
    assert.ok(adds(r));
  });

  test("a fault with deduct_pct 0 still counts as a fault: the website No quote does not lift (it is lower), value is W", async () => {
    const r = await plus(["finish_repair_pending"]);
    assert.equal(r.value_ngn, 724681);
    assert.ok(!r.adjustments.some((a) => a.label === SITE));
  });
});

describe("fault actions", () => {
  test("a refuse fault gives FAULT_NOT_BOUGHT naming the fault, with no figure and no token", async () => {
    const { deps } = makeCtx(real);
    const r = await valueTradeIn(deps, { ...PLUS, faults: ["icloud_locked"] });
    assert.ok("error" in r, JSON.stringify(r));
    assert.equal(r.error, "FAULT_NOT_BOUGHT");
    assert.match(r.detail, /icloud_locked/);
    assert.ok(!("quote_token" in r) && !("value_ngn" in r));
  });

  test("every refuse fault in faults.csv is refused, alone and mixed with deduct faults", async () => {
    const { deps } = makeCtx(real);
    const refuse = real.faults.filter((f) => f.action === "refuse");
    assert.deepEqual(refuse.map((f) => f.fault).sort(), ["converted_housing", "icloud_bypassed", "icloud_locked", "lost_or_blacklisted", "mdm_locked", "passcode_unknown"]);
    for (const f of refuse) {
      for (const faults of [[f.fault], ["screen_dead", f.fault, "charging_ic"]]) {
        const r = await valueTradeIn(deps, { ...PLUS, faults });
        assert.ok("error" in r, `${faults.join("+")} ${JSON.stringify(r)}`);
        assert.equal(r.error, "FAULT_NOT_BOUGHT", faults.join("+"));
        assert.match(r.detail, new RegExp(f.fault));
        assert.ok(!("quote_token" in r));
      }
    }
  });

  test("a refuse fault never reaches Paystack", async () => {
    const ctx = makeCtx(real);
    await valueTradeIn(ctx.deps, { ...PLUS, faults: ["mdm_locked"] });
    assert.equal(ctx.paystack.initializeCalls.length, 0);
    assert.equal(ctx.paystack.verifyCalls.length, 0);
    assert.equal(ctx.paystack.listCalls, 0);
  });

  test("an inspect fault applies its provisional deduct_pct and is listed with its label", async () => {
    const ic = fault("charging_ic");
    const r = await plus(["charging_ic"]);
    assert.deepEqual(r.deductions.map((d) => [d.fault, d.ngn]), [["charging_ic", 144936]]);
    assert.equal(r.value_ngn, 579745);
    assert.deepEqual(r.inspect_faults, [{ fault: "charging_ic", label: ic.label }]);
    assert.ok(adds(r));
  });

  test("deduct faults never appear in inspect_faults; mixed sets list only the inspect ones", async () => {
    const r = await plus(["screen_dead", "charging_ic", "face_id", "liquid_damage"]);
    assert.deepEqual(r.inspect_faults.map((x) => x.fault).sort(), ["charging_ic", "liquid_damage"]);
    for (const d of r.inspect_faults) assert.equal(d.label, fault(d.fault).label);
    const only = await plus(["screen_dead", "face_id"]);
    assert.deepEqual(only.inspect_faults, []);
  });

  test("an inspect fault with deduct_pct 0 is still listed and deducts nothing", async () => {
    const r = await plus(["finish_repair_pending"], FLAWLESS);
    assert.deepEqual(r.inspect_faults.map((x) => x.fault), ["finish_repair_pending"]);
    assert.equal(r.deductions[0].ngn, 0);
    assert.equal(r.value_ngn, 775890);
  });
});

describe("model normalisation", () => {
  for (const input of ["13 promax", "iphone 13 pro-max", "Apple iPhone 13 Pro Max", "  IPHONE   13   PRO   MAX "]) {
    test(`"${input}" resolves to iPhone 13 Pro Max`, async () => {
      const { deps } = makeCtx(real);
      const r = await valueTradeIn(deps, { model: input, capacity_gb: 128, faults: [] });
      assert.ok(!("error" in r), JSON.stringify(r));
      assert.equal(r.model, "iPhone 13 Pro Max");
      assert.equal(r.capacity_gb, 128);
    });
  }

  test("Galaxy S23 is still MODEL_NOT_BOUGHT", async () => {
    const { deps } = makeCtx(real);
    const r = await valueTradeIn(deps, { model: "Galaxy S23", capacity_gb: 128, faults: [] });
    assert.ok("error" in r);
    assert.equal(r.error, "MODEL_NOT_BOUGHT");
  });
});
