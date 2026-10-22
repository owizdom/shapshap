// B2 valuation working, rewritten for spec 0002 (pricing matches Ziggatech). Rules: src/types.ts.
// Expected figures are hard-coded from the spec table, never computed by src/.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { loadCatalog } from "../src/catalog.ts";
import { valueTradeIn } from "../src/tools.ts";
import type { Condition, Valuation, ValueTradeInArgs } from "../src/types.ts";
import { FLAWLESS, makeCtx } from "./fakes.ts";

const dataDir = fileURLToPath(new URL("../data", import.meta.url));
const real = loadCatalog(dataDir);
const buyable = real.faults.filter((f) => f.action !== "refuse");

const DEFAULT: Condition = { screen: "light", body: "light", battery: "healthy", parts: "genuine" };
const SITE = "Raised to our website quote for a faulty phone";
const FLOOR = "Minimum we pay for this model";
const sum = (xs: { ngn: number }[]) => xs.reduce((s, x) => s + x.ngn, 0);
const adds = (r: Valuation) => r.base_ngn - sum(r.deductions) + sum(r.adjustments) === r.value_ngn;
const fault = (k: string) => real.faults.find((f) => f.fault === k)!;

function asValuation(r: unknown): Valuation {
  assert.ok(r && typeof r === "object" && !("error" in r), `expected a valuation, got ${JSON.stringify(r)}`);
  return r as Valuation;
}

const PLUS = { model: "iPhone 16 Plus", capacity_gb: 256 } as const;
async function plus(faults: string[], over: Partial<ValueTradeInArgs> = {}): Promise<Valuation> {
  const { deps } = makeCtx(real);
  return asValuation(await valueTradeIn(deps, { ...PLUS, faults, ...over }));
}

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

describe("B2 valuation", () => {
  test("model match ignores case and surrounding spaces", async () => {
    const { deps } = makeCtx(real);
    const r = asValuation(await valueTradeIn(deps, { model: "  iphone 16 PLUS ", capacity_gb: 256, faults: ["charging_port"] }));
    assert.equal(r.value_ngn, 688447);
    assert.equal(r.model, "iPhone 16 Plus");
  });

  test("Galaxy S23 is still MODEL_NOT_BOUGHT", async () => {
    const { deps } = makeCtx(real);
    const r = await valueTradeIn(deps, { model: "Galaxy S23", capacity_gb: 128, faults: [] });
    assert.ok("error" in r);
    assert.equal(r.error, "MODEL_NOT_BOUGHT");
  });
});

describe("adjustments (the working adds up)", () => {
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
});
