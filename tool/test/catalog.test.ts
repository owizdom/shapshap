// parseCatalog, the owner-sheet CSV reader: repair columns (spec 0002 P11).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseCatalog } from "../src/catalog.ts";

const PRICES = "model,capacity_gb,base_ngn,floor_ngn\n";
const FAULTS = "fault,label,category,action,deduct_pct,check_hint,basis\n";
const STOCK = "unit_id,model,capacity_gb,grade,battery_pct,warranty_months,price_ngn\n";
const okPrice = "iPhone 13,128,302000,45000\n";
const okFault = "screen_cracked,Screen cracked,screen,deduct,20,Picture works?,sourced\n";
const okStock = "SS-1,iPhone 13,128,A,90,3,420000\n";

function parse(prices = PRICES + okPrice, faults = FAULTS + okFault, stock = STOCK + okStock) {
  return parseCatalog({ prices, faults, stock });
}

const PRICES_R = "model,capacity_gb,base_ngn,floor_ngn,screen_repair_ngn,camera_repair_ngn\n";

describe("parseCatalog repair columns (P11)", () => {
  test("blank cells mean not published: null, no problem, the row loads", () => {
    const r = parse(PRICES_R + "iPhone 16e,128,434000,65000,,\niPhone 13,128,302000,45000,297000,\n");
    assert.deepEqual(r.problems, []);
    assert.deepEqual(r.catalog.prices.map((p) => [p.screen_repair_ngn, p.camera_repair_ngn]), [[null, null], [297000, null]]);
  });
});
