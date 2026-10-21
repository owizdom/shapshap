// B2: valuation working. Spec 0001 section 6.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { loadCatalog } from "../src/catalog.ts";
import { valueTradeIn } from "../src/tools.ts";
import { readQuote } from "../src/quote.ts";
import { QUOTE_TTL_MS } from "../src/types.ts";
import type { Valuation } from "../src/types.ts";
import { NOW, SECRET, floorTo1000, makeCtx, tinyCatalog } from "./fakes.ts";

const dataDir = fileURLToPath(new URL("../data", import.meta.url));
const real = loadCatalog(dataDir);

// Expected value computed from the rules in types.ts, independent of the implementation.
const CAP = "Deductions capped at 70% of base";
const buyable = real.faults.filter((f) => f.action !== "refuse");
function expectValue(base: number, floor: number, pcts: number[]) {
  const total = pcts.reduce((s, p) => s + Math.round((base * p) / 100), 0);
  const capLimit = (base * 70) / 100;
  const excess = Math.max(0, total - capLimit);
  return { total, excess, value: Math.max(floor, floorTo1000(base - total + excess)) };
}

function asValuation(r: unknown): Valuation {
  assert.ok(r && typeof r === "object" && !("error" in r), `expected a valuation, got ${JSON.stringify(r)}`);
  return r as Valuation;
}

describe("loadCatalog (real data)", () => {
  test("parses the three csv files into typed rows", () => {
    assert.equal(real.prices.length, 31);
    assert.equal(real.faults.length, 41);
    assert.equal(real.stock.length, 35);
    const p = real.prices.find((r) => r.model === "iPhone 16 Plus" && r.capacity_gb === 256);
    assert.deepEqual(p, { model: "iPhone 16 Plus", capacity_gb: 256, base_ngn: 835000, floor_ngn: 115000 });
    const f = real.faults.find((r) => r.fault === "charging_port");
    assert.equal(f?.deduct_pct, 5);
    assert.equal(f?.action, "deduct");
    assert.equal(f?.basis, "sourced");
    assert.equal(typeof f?.deduct_pct, "number");
    assert.equal(real.faults.find((r) => r.fault === "icloud_locked")?.action, "refuse");
    assert.equal(real.faults.find((r) => r.fault === "charging_ic")?.action, "inspect");
    assert.equal(real.faults.find((r) => r.fault === "charging_ic")?.check_hint, "30 min on a wall socket with two cables, then force restart");
    const u = real.stock.find((r) => r.unit_id === "SS-1401");
    assert.equal(u?.price_ngn, 515000);
    assert.equal(typeof u?.capacity_gb, "number");
  });
});

describe("B2 valuation", () => {
  test("worked case: iPhone 16 Plus 256 GB charging_port is 793000", async () => {
    const { deps } = makeCtx(real);
    const r = asValuation(await valueTradeIn(deps, { model: "iPhone 16 Plus", capacity_gb: 256, faults: ["charging_port"] }));
    assert.equal(r.model, "iPhone 16 Plus");
    assert.equal(r.capacity_gb, 256);
    assert.equal(r.base_ngn, 835000);
    assert.equal(r.deductions.length, 1);
    assert.equal(r.deductions[0].fault, "charging_port");
    assert.equal(r.deductions[0].ngn, 41750);
    assert.equal(typeof r.deductions[0].label, "string");
    assert.deepEqual(r.inspect_faults, []);
    assert.equal(r.value_ngn, 793000); // 793250 floored to the thousand
    assert.equal(typeof r.quote_token, "string");
    assert.equal(r.valid_until, new Date(NOW + QUOTE_TTL_MS).toISOString());
  });

  test("every price row and every single deduct or inspect fault: capped, rounded, floored, never below floor", async () => {
    const { deps } = makeCtx(real);
    let checked = 0;
    for (const p of real.prices) {
      for (const f of buyable) {
        const e = expectValue(p.base_ngn, p.floor_ngn, [f.deduct_pct]);
        const r = asValuation(await valueTradeIn(deps, { model: p.model, capacity_gb: p.capacity_gb, faults: [f.fault] }));
        assert.equal(r.base_ngn, p.base_ngn, `${p.model} ${p.capacity_gb} ${f.fault} base`);
        assert.equal(r.deductions[0].ngn, Math.round((p.base_ngn * f.deduct_pct) / 100), `${p.model} ${p.capacity_gb} ${f.fault} deduction`);
        assert.equal(r.value_ngn, e.value, `${p.model} ${p.capacity_gb} ${f.fault} value`);
        assert.ok(r.value_ngn >= p.floor_ngn);
        checked++;
      }
    }
    assert.equal(buyable.length, 35);
    assert.equal(checked, 31 * 35);
  });

  test("every price row with all deduct and inspect faults at once: capped, floored, sum identity", async () => {
    const { deps } = makeCtx(real);
    const all = buyable.map((f) => f.fault);
    for (const p of real.prices) {
      const e = expectValue(p.base_ngn, p.floor_ngn, buyable.map((f) => f.deduct_pct));
      assert.ok(e.excess > 0, "all faults together must exceed the cap");
      const r = asValuation(await valueTradeIn(deps, { model: p.model, capacity_gb: p.capacity_gb, faults: all }));
      assert.equal(r.value_ngn, e.value, `${p.model} ${p.capacity_gb}`);
      assert.ok(r.value_ngn >= p.floor_ngn);
      assert.ok(r.adjustments.some((a) => a.label === CAP && a.ngn === e.excess), `${p.model} ${p.capacity_gb} cap adjustment`);
    }
  });

  test("no faults: value is the base floored to the thousand", async () => {
    const { deps } = makeCtx(tinyCatalog());
    const r = asValuation(await valueTradeIn(deps, { model: "Test Phone", capacity_gb: 256, faults: [] }));
    assert.equal(r.base_ngn, 100005);
    assert.deepEqual(r.deductions, []);
    assert.equal(r.value_ngn, 100000);
  });

  test("each deduction is rounded individually, then summed (hand-built numbers)", async () => {
    const { deps } = makeCtx(tinyCatalog());
    // base 100005: a = 10% = 10000.5 -> 10001 ; b = 15% = 15000.75 -> 15001 ; raw = 75003 ; floored 75000
    const r = asValuation(await valueTradeIn(deps, { model: "Test Phone", capacity_gb: 256, faults: ["a", "b"] }));
    const byFault = Object.fromEntries(r.deductions.map((d) => [d.fault, d.ngn]));
    assert.equal(byFault.a, 10001);
    assert.equal(byFault.b, 15001);
    assert.equal(r.value_ngn, 75000);
  });

  test("duplicate faults count once", async () => {
    const { deps } = makeCtx(tinyCatalog());
    const once = asValuation(await valueTradeIn(deps, { model: "Test Phone", capacity_gb: 128, faults: ["a"] }));
    const dup = asValuation(await valueTradeIn(deps, { model: "Test Phone", capacity_gb: 128, faults: ["a", "a", "a"] }));
    assert.equal(once.value_ngn, 90000);
    assert.equal(dup.value_ngn, 90000);
    assert.equal(dup.deductions.length, 1);
    assert.equal(dup.deductions[0].ngn, 10000);
  });

  test("value never goes below floor_ngn", async () => {
    const { deps } = makeCtx(tinyCatalog());
    const r = asValuation(await valueTradeIn(deps, { model: "Cheap Phone", capacity_gb: 64, faults: ["dead"] }));
    assert.equal(r.value_ngn, 18345); // raw 15000 is under the floor, which is not a multiple of 1000 and is kept as is
  });

  test("model match ignores case and surrounding spaces", async () => {
    const { deps } = makeCtx(real);
    const r = asValuation(await valueTradeIn(deps, { model: "  iphone 16 PLUS ", capacity_gb: 256, faults: ["charging_port"] }));
    assert.equal(r.value_ngn, 793000);
    assert.equal(r.model, "iPhone 16 Plus");
  });

  test("the issued token carries the sorted unique faults, value and expiry", async () => {
    const { deps } = makeCtx(real);
    const r = asValuation(await valueTradeIn(deps, {
      model: "iPhone 16 Plus", capacity_gb: 256, faults: ["screen_cracked", "charging_port", "charging_port"],
    }));
    const p = readQuote(r.quote_token, SECRET, NOW);
    assert.ok(typeof p === "object", `token should be valid, got ${String(p)}`);
    assert.equal(p.v, 1);
    assert.equal(p.model, "iPhone 16 Plus");
    assert.equal(p.capacity_gb, 256);
    assert.deepEqual(p.faults, ["charging_port", "screen_cracked"]);
    assert.equal(p.value_ngn, r.value_ngn);
    assert.equal(p.iat, NOW);
    assert.equal(p.exp, NOW + QUOTE_TTL_MS);
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
    const r = await valueTradeIn(deps, { model: "iPhone 16 Plus", capacity_gb: 256, faults: ["charging_port", "haunted"] });
    assert.ok("error" in r);
    assert.equal(r.error, "UNKNOWN_FAULT");
    assert.match(r.detail, /haunted/);
  });
});

const ROUND = "Rounded down to the nearest 1,000";
const FLOOR = "Minimum we pay for this model";
const sum = (xs: { ngn: number }[]) => xs.reduce((s, x) => s + x.ngn, 0);
const adds = (r: Valuation) => r.base_ngn - sum(r.deductions) + sum(r.adjustments) === r.value_ngn;

describe("valuation adjustments (the working adds up)", () => {
  test("worked case shows the rounding adjustment", async () => {
    const { deps } = makeCtx(real);
    const r = asValuation(await valueTradeIn(deps, { model: "iPhone 16 Plus", capacity_gb: 256, faults: ["charging_port"] }));
    assert.equal(r.deductions.length, 1);
    assert.equal(r.deductions[0].fault, "charging_port");
    assert.equal(r.deductions[0].ngn, 41750);
    assert.deepEqual(r.adjustments, [{ label: ROUND, ngn: -250 }]);
    assert.equal(r.value_ngn, 793000);
    assert.ok(adds(r));
  });

  test("floor applies: one positive lift adjustment, no rounding adjustment", async () => {
    const { deps } = makeCtx(tinyCatalog());
    const r = asValuation(await valueTradeIn(deps, { model: "Cheap Phone", capacity_gb: 64, faults: ["dead"] }));
    assert.equal(r.value_ngn, 18345);
    assert.deepEqual(r.adjustments, [{ label: FLOOR, ngn: 3345 }]); // 50000 - 35000 = 15000, lifted to 18345
    assert.ok(adds(r));
  });

  test("floor applies on real data with many faults", async () => {
    const { deps } = makeCtx(real);
    const p = real.prices[0];
    const r = asValuation(await valueTradeIn(deps, { model: p.model, capacity_gb: p.capacity_gb, faults: buyable.map((f) => f.fault) }));
    const lifted = r.adjustments.filter((a) => a.label === FLOOR);
    if (r.value_ngn === p.floor_ngn && r.base_ngn - sum(r.deductions) < p.floor_ngn) {
      assert.equal(r.adjustments.length, 1);
      assert.equal(lifted[0].ngn, p.floor_ngn - (r.base_ngn - sum(r.deductions)));
      assert.ok(lifted[0].ngn > 0);
    }
    assert.ok(adds(r));
  });

  test("no rounding and no floor gives an empty adjustments list", async () => {
    const { deps } = makeCtx(tinyCatalog());
    const r = asValuation(await valueTradeIn(deps, { model: "Test Phone", capacity_gb: 128, faults: ["a"] }));
    assert.equal(r.value_ngn, 90000);
    assert.deepEqual(r.adjustments, []);
    assert.ok(adds(r));
  });

  test("sum identity holds for every price row x every single deduct/inspect fault, all of them together, and none", async () => {
    const { deps } = makeCtx(real);
    const sets = [...buyable.map((f) => [f.fault]), buyable.map((f) => f.fault), []];
    let n = 0;
    for (const p of real.prices) {
      for (const faults of sets) {
        const r = asValuation(await valueTradeIn(deps, { model: p.model, capacity_gb: p.capacity_gb, faults }));
        assert.ok(adds(r), `${p.model} ${p.capacity_gb} ${faults.length} faults`);
        assert.ok(r.value_ngn >= p.floor_ngn);
        for (const a of r.adjustments) {
          if (a.label === FLOOR) assert.ok(a.ngn > 0);
          else if (a.label === CAP) assert.ok(a.ngn > 0);
          else { assert.equal(a.label, ROUND); assert.ok(a.ngn < 0 && a.ngn > -1000); }
        }
        n++;
      }
    }
    assert.equal(n, 31 * 37);
  });
});

describe("fault actions", () => {
  test("a refuse fault gives FAULT_NOT_BOUGHT naming the fault, with no figure and no token", async () => {
    const { deps } = makeCtx(real);
    const r = await valueTradeIn(deps, { model: "iPhone 16 Plus", capacity_gb: 256, faults: ["icloud_locked"] });
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
      for (const faults of [[f.fault], ["screen_cracked", f.fault, "charging_ic"]]) {
        const r = await valueTradeIn(deps, { model: "iPhone 16 Plus", capacity_gb: 256, faults });
        assert.ok("error" in r, `${faults.join("+")} ${JSON.stringify(r)}`);
        assert.equal(r.error, "FAULT_NOT_BOUGHT", faults.join("+"));
        assert.match(r.detail, new RegExp(f.fault));
        assert.ok(!("quote_token" in r));
      }
    }
  });

  test("a refuse fault never reaches Paystack", async () => {
    const ctx = makeCtx(real);
    await valueTradeIn(ctx.deps, { model: "iPhone 16 Plus", capacity_gb: 256, faults: ["mdm_locked"] });
    assert.equal(ctx.paystack.initializeCalls.length, 0);
    assert.equal(ctx.paystack.verifyCalls.length, 0);
    assert.equal(ctx.paystack.listCalls, 0);
  });

  test("an inspect fault applies its provisional deduct_pct and is listed with its label", async () => {
    const { deps } = makeCtx(real);
    const ic = real.faults.find((f) => f.fault === "charging_ic")!;
    // 835000 * 20% = 167000 ; raw 668000
    const r = asValuation(await valueTradeIn(deps, { model: "iPhone 16 Plus", capacity_gb: 256, faults: ["charging_ic"] }));
    assert.deepEqual(r.deductions.map((d) => [d.fault, d.ngn]), [["charging_ic", 167000]]);
    assert.equal(r.value_ngn, 668000);
    assert.deepEqual(r.inspect_faults, [{ fault: "charging_ic", label: ic.label }]);
    assert.ok(adds(r));
  });

  test("deduct faults never appear in inspect_faults; mixed sets list only the inspect ones", async () => {
    const { deps } = makeCtx(real);
    const r = asValuation(await valueTradeIn(deps, { model: "iPhone 16 Plus", capacity_gb: 256, faults: ["screen_cracked", "charging_ic", "battery_service", "liquid_damage"] }));
    assert.deepEqual(r.inspect_faults.map((x) => x.fault).sort(), ["charging_ic", "liquid_damage"]);
    for (const d of r.inspect_faults) assert.equal(d.label, real.faults.find((f) => f.fault === d.fault)!.label);
    const only = asValuation(await valueTradeIn(deps, { model: "iPhone 16 Plus", capacity_gb: 256, faults: ["screen_cracked", "battery_service"] }));
    assert.deepEqual(only.inspect_faults, []);
  });

  test("an inspect fault with deduct_pct 0 is still listed and deducts nothing", async () => {
    const { deps } = makeCtx(real);
    const r = asValuation(await valueTradeIn(deps, { model: "iPhone 16 Plus", capacity_gb: 256, faults: ["finish_repair_pending"] }));
    assert.deepEqual(r.inspect_faults.map((x) => x.fault), ["finish_repair_pending"]);
    assert.equal(r.deductions[0].ngn, 0);
    assert.equal(r.value_ngn, 835000);
  });
});

describe("70% deduction cap", () => {
  test("cap bites: one adjustment with the exact excess, working still adds up (hand-built)", async () => {
    const { deps } = makeCtx(tinyCatalog());
    // Test Phone 128 base 100000: huge = 90000, cap 70000, excess 20000, raw 30000, no rounding
    const r = asValuation(await valueTradeIn(deps, { model: "Test Phone", capacity_gb: 128, faults: ["huge"] }));
    assert.equal(r.deductions[0].ngn, 90000);
    assert.deepEqual(r.adjustments, [{ label: CAP, ngn: 20000 }]);
    assert.equal(r.value_ngn, 30000);
    assert.ok(adds(r));
  });

  test("exactly 70% does not bite", async () => {
    const { deps } = makeCtx(tinyCatalog());
    const r = asValuation(await valueTradeIn(deps, { model: "Test Phone", capacity_gb: 128, faults: ["dead"] }));
    assert.deepEqual(r.adjustments, []);
    assert.equal(r.value_ngn, 30000);
  });

  test("cap then rounding: adjustments are cap first, then rounding", async () => {
    const { deps } = makeCtx(tinyCatalog());
    // Odd Phone base 100500: huge = 90450, cap 70350, excess 20100, raw 30150 -> 30000 (-150)
    const r = asValuation(await valueTradeIn(deps, { model: "Odd Phone", capacity_gb: 64, faults: ["huge"] }));
    assert.deepEqual(r.adjustments, [{ label: CAP, ngn: 20100 }, { label: ROUND, ngn: -150 }]);
    assert.equal(r.value_ngn, 30000);
    assert.ok(adds(r));
  });

  test("cap and floor both apply: cap, then floor lift, no rounding adjustment", async () => {
    const { deps } = makeCtx(tinyCatalog());
    // Cheap Phone base 50000 floor 18345: huge = 45000, cap 35000, excess 10000, raw 15000 < floor, lift 3345
    const r = asValuation(await valueTradeIn(deps, { model: "Cheap Phone", capacity_gb: 64, faults: ["huge"] }));
    assert.deepEqual(r.adjustments, [{ label: CAP, ngn: 10000 }, { label: FLOOR, ngn: 3345 }]);
    assert.equal(r.value_ngn, 18345);
    assert.ok(adds(r));
  });

  test("real data: several faults past 70% give one cap adjustment with the exact excess", async () => {
    const { deps } = makeCtx(real);
    // 835000: screen_dead 25% + face_id 25% + carrier_locked 30% + no_service(40, inspect) = 120%
    const faults = ["screen_dead", "face_id", "carrier_locked", "no_service"];
    const r = asValuation(await valueTradeIn(deps, { model: "iPhone 16 Plus", capacity_gb: 256, faults }));
    const total = 208750 + 208750 + 250500 + 334000;
    assert.equal(r.deductions.reduce((s, d) => s + d.ngn, 0), total);
    const caps = r.adjustments.filter((a) => a.label === CAP);
    assert.equal(caps.length, 1);
    assert.equal(caps[0].ngn, total - 584500); // 70% of 835000
    assert.equal(r.value_ngn, 250000); // 835000 - 584500 = 250500 -> 250000
    assert.deepEqual(r.adjustments[1], { label: ROUND, ngn: -500 });
    assert.ok(adds(r));
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
