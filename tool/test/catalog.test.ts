// 4b: parseCatalog, the owner-sheet CSV reader. Header based, forgiving about numbers, strict about rows.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { loadCatalog, parseCatalog } from "../src/catalog.ts";

const PRICES = "model,capacity_gb,base_ngn,floor_ngn\n";
const FAULTS = "fault,label,category,action,deduct_pct,check_hint,basis\n";
const STOCK = "unit_id,model,capacity_gb,grade,battery_pct,warranty_months,price_ngn\n";
const okPrice = "iPhone 13,128,302000,45000\n";
const okFault = "screen_cracked,Screen cracked,screen,deduct,20,Picture works?,sourced\n";
const okStock = "SS-1,iPhone 13,128,A,90,3,420000\n";

function parse(prices = PRICES + okPrice, faults = FAULTS + okFault, stock = STOCK + okStock) {
  return parseCatalog({ prices, faults, stock });
}

describe("parseCatalog on the bundled data", () => {
  test("parsing the shipped csv text gives the same catalog as loadCatalog and no problems", () => {
    const dir = fileURLToPath(new URL("../data", import.meta.url));
    const read = (f: string) => readFileSync(`${dir}/${f}`, "utf8");
    const r = parseCatalog({ prices: read("trade-in-prices.csv"), faults: read("faults.csv"), stock: read("stock.csv") });
    assert.deepEqual(r.problems, []);
    assert.equal(r.catalog.prices.length, 31);
    assert.equal(r.catalog.faults.length, 34);
    assert.equal(r.catalog.stock.length, 35);
    assert.deepEqual(r.catalog, loadCatalog(dir));
  });

  test("quoted cells keep their commas and quotes are stripped", () => {
    const dir = fileURLToPath(new URL("../data", import.meta.url));
    const c = loadCatalog(dir);
    const ic = c.faults.find((f) => f.fault === "charging_ic")!;
    assert.equal(ic.check_hint, "30 min on a wall socket with two cables, then force restart");
    const r = parse(undefined, FAULTS + 'no_power,"Does not charge, any cable",power,inspect,60,"Charge one hour, then try",policy\n');
    assert.equal(r.catalog.faults[0].label, "Does not charge, any cable");
    assert.equal(r.catalog.faults[0].check_hint, "Charge one hour, then try");
    assert.equal(r.catalog.faults[0].deduct_pct, 60);
    assert.deepEqual(r.problems, []);
  });
});

describe("parseCatalog header handling", () => {
  test("columns in any order and unknown columns are ignored", () => {
    const r = parse(
      "notes,floor_ngn,model,extra,base_ngn,capacity_gb\nhello,45000,iPhone 13,x,302000,128\n",
      "basis,deduct_pct,fault,whatever,label,action,category,check_hint\nsourced,20,screen_cracked,zzz,Screen cracked,deduct,screen,Works?\n",
      "price_ngn,unit_id,comment,model,capacity_gb,grade,battery_pct,warranty_months\n420000,SS-1,hi,iPhone 13,128,A,90,3\n",
    );
    assert.deepEqual(r.problems, []);
    assert.deepEqual(r.catalog.prices, [{ model: "iPhone 13", capacity_gb: 128, base_ngn: 302000, floor_ngn: 45000, screen_repair_ngn: null, camera_repair_ngn: null }]);
    assert.deepEqual(r.catalog.faults, [{ fault: "screen_cracked", label: "Screen cracked", category: "screen", action: "deduct", deduct_pct: 20, check_hint: "Works?", basis: "sourced", repair: "" }]);
    assert.deepEqual(r.catalog.stock, [{ unit_id: "SS-1", model: "iPhone 13", capacity_gb: 128, grade: "A", battery_pct: 90, warranty_months: 3, price_ngn: 420000 }]);
  });

  test("windows line endings and blank lines are fine", () => {
    const r = parse(PRICES.trimEnd() + "\r\n\r\n" + okPrice.trimEnd() + "\r\n\r\n");
    assert.equal(r.catalog.prices.length, 1);
    assert.deepEqual(r.problems, []);
  });
});

describe("parseCatalog owner-typed numbers", () => {
  for (const typed of ["₦850,000", "850,000", " 850000 ", '"₦850,000"', '"850,000"', "₦ 850,000", "850000"]) {
    test(`base_ngn ${JSON.stringify(typed)} parses to 850000`, () => {
      const cell = typed.startsWith('"') || !typed.includes(",") ? typed : `"${typed}"`;
      const r = parse(PRICES + `iPhone 13,128,${cell},45000\n`);
      assert.deepEqual(r.problems, []);
      assert.equal(r.catalog.prices[0].base_ngn, 850000);
    });
  }

  test("typed numbers also work in the stock and fault tabs", () => {
    const r = parse(undefined, FAULTS + "screen_cracked,Screen cracked,screen,deduct, 20 ,Works?,sourced\n", STOCK + 'SS-1,iPhone 13,128,A, 90 ,3,"₦420,000"\n');
    assert.deepEqual(r.problems, []);
    assert.equal(r.catalog.faults[0].deduct_pct, 20);
    assert.equal(r.catalog.stock[0].price_ngn, 420000);
    assert.equal(r.catalog.stock[0].battery_pct, 90);
  });
});

describe("parseCatalog bad rows are skipped, reported once each, and the rest load", () => {
  test("prices: missing model, capacity 0, floor above base, zero base", () => {
    const r = parse(PRICES + okPrice + ",128,300000,40000\niPhone 14,0,300000,40000\niPhone 15,128,300000,400000\niPhone 16,128,0,0\niPhone 12,64,206000,30000\n");
    assert.deepEqual(r.catalog.prices.map((p) => p.model), ["iPhone 13", "iPhone 12"]);
    assert.equal(r.problems.length, 4);
    for (const p of r.problems) assert.equal(typeof p, "string");
    for (const p of r.problems) assert.ok(p.length > 0);
  });

  test("faults: bad key and pct 101 are skipped, pct 0 and 100 are kept", () => {
    const r = parse(undefined, FAULTS + okFault
      + "Bad Key,Label,screen,deduct,10,hint,policy\n"
      + "1starts_with_digit,Label,screen,deduct,10,hint,policy\n"
      + "too_much,Label,screen,deduct,101,hint,policy\n"
      + "zero_ok,Label,screen,inspect,0,hint,policy\n"
      + "hundred_ok,Label,security,refuse,100,hint,policy\n");
    assert.deepEqual(r.catalog.faults.map((f) => f.fault), ["screen_cracked", "zero_ok", "hundred_ok"]);
    assert.equal(r.problems.length, 3);
  });

  test("stock: duplicate unit_id and battery 120 are skipped, battery 0 and 100 are kept", () => {
    const r = parse(undefined, undefined, STOCK + okStock
      + "SS-1,iPhone 13,256,B,80,3,450000\n"
      + "SS-2,iPhone 13,128,A,120,3,420000\n"
      + "SS-3,iPhone 13,128,A,100,3,420000\n"
      + "SS-4,iPhone 13,128,A,0,3,420000\n"
      + "SS-5,iPhone 13,128,A,90,3,0\n");
    assert.deepEqual(r.catalog.stock.map((u) => u.unit_id), ["SS-1", "SS-3", "SS-4"]);
    assert.equal(r.catalog.stock[0].price_ngn, 420000, "first row of a duplicate unit_id wins");
    assert.equal(r.problems.length, 3);
  });

  test("each problem names the offending row so the owner can find it", () => {
    const r = parse(PRICES + okPrice + "iPhone 15,128,300000,400000\n", FAULTS + okFault + "Bad Key,L,screen,deduct,10,h,policy\n", STOCK + okStock + "SS-9,iPhone 13,128,A,120,3,420000\n");
    assert.equal(r.problems.length, 3);
    assert.ok(r.problems.some((p) => p.includes("iPhone 15")), r.problems.join("|"));
    assert.ok(r.problems.some((p) => p.includes("Bad Key")), r.problems.join("|"));
    assert.ok(r.problems.some((p) => p.includes("SS-9")), r.problems.join("|"));
  });

  test("first row wins on a duplicate model + capacity", () => {
    const r = parse(PRICES + "iPhone 13,128,302000,45000\niPhone 13,128,999000,45000\niPhone 13,256,330000,50000\n");
    assert.equal(r.catalog.prices.length, 2);
    assert.equal(r.catalog.prices.find((p) => p.capacity_gb === 128)!.base_ngn, 302000);
  });

  test("an empty tab gives an empty list, not a crash", () => {
    const r = parse("", FAULTS, STOCK);
    assert.deepEqual(r.catalog.prices, []);
    assert.deepEqual(r.catalog.faults, []);
    assert.deepEqual(r.catalog.stock, []);
  });
});

// ---- Spec 0002 section 2.1 and 2.3: repair columns (P11) ----
const PRICES_R = "model,capacity_gb,base_ngn,floor_ngn,screen_repair_ngn,camera_repair_ngn\n";
const FAULTS_R = "fault,label,category,action,deduct_pct,repair,check_hint,basis\n";

describe("parseCatalog repair columns (P11)", () => {
  test("filled cells parse to whole naira, typed the way the owner types them", () => {
    const r = parse(PRICES_R + 'iPhone 16 Plus,256,775890,115000,"₦444,150",228150\n');
    assert.deepEqual(r.problems, []);
    assert.deepEqual(r.catalog.prices, [{ model: "iPhone 16 Plus", capacity_gb: 256, base_ngn: 775890, floor_ngn: 115000, screen_repair_ngn: 444150, camera_repair_ngn: 228150 }]);
  });

  test("blank cells mean not published: null, no problem, the row loads", () => {
    const r = parse(PRICES_R + "iPhone 16e,128,434000,65000,,\niPhone 13,128,302000,45000,297000,\n");
    assert.deepEqual(r.problems, []);
    assert.deepEqual(r.catalog.prices.map((p) => [p.screen_repair_ngn, p.camera_repair_ngn]), [[null, null], [297000, null]]);
  });

  test("an old sheet without the two columns still loads, both read as null", () => {
    const r = parse(PRICES + okPrice);
    assert.deepEqual(r.problems, []);
    assert.equal(r.catalog.prices.length, 1);
    assert.equal(r.catalog.prices[0].screen_repair_ngn, null);
    assert.equal(r.catalog.prices[0].camera_repair_ngn, null);
  });

  test("only one of the two columns present: the other is null", () => {
    const r = parse("model,capacity_gb,base_ngn,floor_ngn,camera_repair_ngn\niPhone 13,128,302000,45000,228150\n");
    assert.deepEqual(r.problems, []);
    assert.equal(r.catalog.prices[0].screen_repair_ngn, null);
    assert.equal(r.catalog.prices[0].camera_repair_ngn, 228150);
  });

  for (const [name, cell] of [["text", "abc"], ["a fraction", '"444,150.07"'], ["dot thousands", '"444.150"'], ["below 10,000", "9999"], ["above 5,000,000", "5000001"], ["negative", "-5000"], ["zero", "0"]] as const) {
    test(`an invalid screen_repair_ngn (${name}: ${cell}) skips the row with a problem naming it`, () => {
      const r = parse(PRICES_R + `iPhone 14,128,361000,55000,${cell},228150\n` + "iPhone 13,128,302000,45000,297000,228150\n");
      assert.deepEqual(r.catalog.prices.map((p) => p.model), ["iPhone 13"]);
      assert.equal(r.problems.length, 1);
      assert.ok(r.problems[0].includes("iPhone 14"), r.problems[0]);
    });
  }

  test("an invalid camera_repair_ngn skips the row too, and the boundary values 10,000 and 5,000,000 are kept", () => {
    const r = parse(PRICES_R + "A Phone,128,361000,55000,297000,12.5\nB Phone,128,361000,55000,10000,5000000\n");
    assert.deepEqual(r.catalog.prices.map((p) => p.model), ["B Phone"]);
    assert.equal(r.problems.length, 1);
    assert.deepEqual([r.catalog.prices[0].screen_repair_ngn, r.catalog.prices[0].camera_repair_ngn], [10000, 5000000]);
  });

  test("faults: repair screen, camera and blank are read; a missing repair column reads as blank", () => {
    const r = parse(undefined, FAULTS_R + "screen_dead,Dead,screen,deduct,25,screen,h,sourced\nrear_camera,Cam,camera,deduct,10,camera,h,sourced\ncharging_port,Port,power,deduct,5,,h,sourced\n");
    assert.deepEqual(r.problems, []);
    assert.deepEqual(r.catalog.faults.map((f) => [f.fault, f.repair]), [["screen_dead", "screen"], ["rear_camera", "camera"], ["charging_port", ""]]);
    const old = parse(undefined, FAULTS + okFault);
    assert.deepEqual(old.problems, []);
    assert.equal(old.catalog.faults[0].repair, "");
  });

  test("faults: any other repair value skips the row with a problem naming it", () => {
    const r = parse(undefined, FAULTS_R + "screen_dead,Dead,screen,deduct,25,screen,h,sourced\nbad_one,Bad,power,deduct,5,battery,h,sourced\nbad_two,Bad,power,deduct,5,Screen repair,h,sourced\n");
    assert.deepEqual(r.catalog.faults.map((f) => f.fault), ["screen_dead"]);
    assert.equal(r.problems.length, 2);
    assert.ok(r.problems.some((p) => p.includes("bad_one")), r.problems.join("|"));
    assert.ok(r.problems.some((p) => p.includes("bad_two")), r.problems.join("|"));
  });

  test("the bundled prices tab carries the two columns and faults.csv carries repair", () => {
    const dir = fileURLToPath(new URL("../data", import.meta.url));
    const c = loadCatalog(dir);
    assert.equal(c.prices.filter((p) => p.screen_repair_ngn !== null).length, 30);
    assert.equal(c.prices.filter((p) => p.camera_repair_ngn !== null).length, 30);
    assert.equal(c.faults.find((f) => f.fault === "screen_dead")!.repair, "screen");
    assert.equal(c.faults.find((f) => f.fault === "rear_camera")!.repair, "camera");
  });
});
