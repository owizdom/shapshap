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

function asValuation(r: unknown): Valuation {
  assert.ok(r && typeof r === "object" && !("error" in r), `expected a valuation, got ${JSON.stringify(r)}`);
  return r as Valuation;
}

describe("loadCatalog (real data)", () => {
  test("parses the three csv files into typed rows", () => {
    assert.equal(real.prices.length, 26);
    assert.equal(real.faults.length, 9);
    assert.equal(real.stock.length, 12);
    const p = real.prices.find((r) => r.model === "iPhone 16 Plus" && r.capacity_gb === 256);
    assert.deepEqual(p, { model: "iPhone 16 Plus", capacity_gb: 256, base_ngn: 790000, floor_ngn: 115000 });
    const f = real.faults.find((r) => r.fault === "no_charge");
    assert.equal(f?.deduct_pct, 35);
    assert.equal(typeof f?.deduct_pct, "number");
    const u = real.stock.find((r) => r.unit_id === "SS-1401");
    assert.equal(u?.price_ngn, 520000);
    assert.equal(typeof u?.capacity_gb, "number");
  });
});

describe("B2 valuation", () => {
  test("worked case: iPhone 16 Plus 256 GB no_charge is 513000", async () => {
    const { deps } = makeCtx(real);
    const r = asValuation(await valueTradeIn(deps, { model: "iPhone 16 Plus", capacity_gb: 256, faults: ["no_charge"] }));
    assert.equal(r.model, "iPhone 16 Plus");
    assert.equal(r.capacity_gb, 256);
    assert.equal(r.base_ngn, 790000);
    assert.equal(r.deductions.length, 1);
    assert.equal(r.deductions[0].fault, "no_charge");
    assert.equal(r.deductions[0].ngn, 276500);
    assert.equal(typeof r.deductions[0].label, "string");
    assert.equal(r.value_ngn, 513000); // 513500 floored to the thousand
    assert.equal(typeof r.quote_token, "string");
    assert.equal(r.valid_until, new Date(NOW + QUOTE_TTL_MS).toISOString());
  });

  test("every price row and every single fault: base minus rounded deduction, floored, never below floor", async () => {
    const { deps } = makeCtx(real);
    let checked = 0;
    for (const p of real.prices) {
      for (const f of real.faults) {
        const ded = Math.round((p.base_ngn * f.deduct_pct) / 100);
        const expected = Math.max(p.floor_ngn, floorTo1000(p.base_ngn - ded));
        const r = asValuation(await valueTradeIn(deps, { model: p.model, capacity_gb: p.capacity_gb, faults: [f.fault] }));
        assert.equal(r.base_ngn, p.base_ngn, `${p.model} ${p.capacity_gb} ${f.fault} base`);
        assert.equal(r.deductions[0].ngn, ded, `${p.model} ${p.capacity_gb} ${f.fault} deduction`);
        assert.equal(r.value_ngn, expected, `${p.model} ${p.capacity_gb} ${f.fault} value`);
        assert.ok(r.value_ngn >= p.floor_ngn);
        checked++;
      }
    }
    assert.equal(checked, 26 * 9);
  });

  test("every price row with all faults at once stays at or above the floor", async () => {
    const { deps } = makeCtx(real);
    const all = real.faults.map((f) => f.fault);
    for (const p of real.prices) {
      const ded = real.faults.reduce((s, f) => s + Math.round((p.base_ngn * f.deduct_pct) / 100), 0);
      const expected = Math.max(p.floor_ngn, floorTo1000(p.base_ngn - ded));
      const r = asValuation(await valueTradeIn(deps, { model: p.model, capacity_gb: p.capacity_gb, faults: all }));
      assert.equal(r.value_ngn, expected, `${p.model} ${p.capacity_gb}`);
      assert.ok(r.value_ngn >= p.floor_ngn);
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
    assert.equal(r.value_ngn, 12345); // raw 0, floor is not a multiple of 1000 and is kept as is
  });

  test("model match ignores case and surrounding spaces", async () => {
    const { deps } = makeCtx(real);
    const r = asValuation(await valueTradeIn(deps, { model: "  iphone 16 PLUS ", capacity_gb: 256, faults: ["no_charge"] }));
    assert.equal(r.value_ngn, 513000);
    assert.equal(r.model, "iPhone 16 Plus");
  });

  test("the issued token carries the sorted unique faults, value and expiry", async () => {
    const { deps } = makeCtx(real);
    const r = asValuation(await valueTradeIn(deps, {
      model: "iPhone 16 Plus", capacity_gb: 256, faults: ["screen_cracked", "no_charge", "no_charge"],
    }));
    const p = readQuote(r.quote_token, SECRET, NOW);
    assert.ok(typeof p === "object", `token should be valid, got ${String(p)}`);
    assert.equal(p.v, 1);
    assert.equal(p.model, "iPhone 16 Plus");
    assert.equal(p.capacity_gb, 256);
    assert.deepEqual(p.faults, ["no_charge", "screen_cracked"]);
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
    const r = await valueTradeIn(deps, { model: "iPhone 16 Plus", capacity_gb: 256, faults: ["no_charge", "haunted"] });
    assert.ok("error" in r);
    assert.equal(r.error, "UNKNOWN_FAULT");
    assert.match(r.detail, /haunted/);
  });
});
