// 4b: sheetCatalogLoader with an injected fetch and clock. Fallback is all-or-nothing.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { sheetCatalogLoader } from "../src/sheet.ts";
import { tinyCatalog } from "./fakes.ts";
import type { SheetUrls } from "../src/types.ts";

const urls: SheetUrls = {
  prices: "https://docs.google.com/spreadsheets/d/e/X/pub?gid=1&output=csv",
  faults: "https://docs.google.com/spreadsheets/d/e/X/pub?gid=2&output=csv",
  stock: "https://docs.google.com/spreadsheets/d/e/X/pub?gid=3&output=csv",
};

const FAULTS = "fault,label,category,action,deduct_pct,check_hint,basis\nscreen_cracked,Screen cracked,screen,deduct,20,Works?,sourced\n";
const STOCK = "unit_id,model,capacity_gb,grade,battery_pct,warranty_months,price_ngn\nSH-1,Sheet Phone,128,A,90,3,\"₦420,000\"\n";
const pricesCsv = (base: number, model = "Sheet Phone") => `model,capacity_gb,base_ngn,floor_ngn\n${model},128,"₦${base.toLocaleString("en-US")}",10000\n`;

type Reply = string | Error | "hang" | number; // number = HTTP status with an empty body

function setup(initial: { prices?: Reply; faults?: Reply; stock?: Reply } = {}) {
  const replies: Record<string, Reply> = {
    [urls.prices]: initial.prices ?? pricesCsv(500000),
    [urls.faults]: initial.faults ?? FAULTS,
    [urls.stock]: initial.stock ?? STOCK,
  };
  const calls: string[] = [];
  const f = (async (input: any) => {
    const url = typeof input === "string" ? input : input.url ?? String(input);
    calls.push(url);
    const r = replies[url];
    if (r === undefined) return new Response("unexpected url", { status: 500 });
    if (r === "hang") return new Promise<Response>(() => {});
    if (r instanceof Error) throw r;
    if (typeof r === "number") return new Response("", { status: r });
    return new Response(r, { status: 200, headers: { "content-type": "text/csv" } });
  }) as unknown as typeof fetch;
  const clock = { t: 1_000_000 };
  const load = sheetCatalogLoader(urls, { fetch: f, timeoutMs: 25, cacheMs: 60_000, now: () => clock.t, bundled: () => tinyCatalog() });
  return { replies, calls, clock, load };
}

describe("sheetCatalogLoader happy path and cache", () => {
  test("all three tabs good: source sheet, owner-typed numbers parsed", async () => {
    const { load, calls } = setup();
    const r = await load();
    assert.equal(r.source, "sheet");
    assert.deepEqual(r.problems, []);
    assert.equal(r.catalog.prices[0].model, "Sheet Phone");
    assert.equal(r.catalog.prices[0].base_ngn, 500000);
    assert.equal(r.catalog.stock[0].price_ngn, 420000);
    assert.deepEqual([...calls].sort(), [urls.faults, urls.prices, urls.stock].sort());
  });

  test("a second call within cacheMs makes no fetch and returns the same sheet", async () => {
    const { load, calls, clock } = setup();
    await load();
    const n = calls.length;
    clock.t += 59_000;
    const r = await load();
    assert.equal(calls.length, n);
    assert.equal(r.source, "sheet");
    assert.equal(r.catalog.prices[0].base_ngn, 500000);
  });

  test("after cacheMs it refetches and picks up an edited cell", async () => {
    const { load, calls, clock, replies } = setup();
    await load();
    const n = calls.length;
    replies[urls.prices] = pricesCsv(650000);
    clock.t += 60_001;
    const r = await load();
    assert.equal(calls.length, n + 3);
    assert.equal(r.source, "sheet");
    assert.equal(r.catalog.prices[0].base_ngn, 650000);
  });

  test("skipped rows come back as problems while the valid rows load", async () => {
    const { load } = setup({ prices: pricesCsv(500000) + "Bad Phone,0,100,50\n" });
    const r = await load();
    assert.equal(r.source, "sheet");
    assert.equal(r.catalog.prices.length, 1);
    assert.equal(r.problems.length, 1);
    assert.equal(typeof r.problems[0], "string");
  });
});

describe("sheetCatalogLoader fallback is all-or-nothing", () => {
  const failures: [string, (s: ReturnType<typeof setup>) => void][] = [
    ["a tab that never answers (timeout)", (s) => { s.replies[urls.stock] = "hang"; }],
    ["a non-2xx on one tab", (s) => { s.replies[urls.faults] = 403; }],
    ["a 500 on one tab", (s) => { s.replies[urls.prices] = 500; }],
    ["a network error on one tab", (s) => { s.replies[urls.stock] = new TypeError("fetch failed"); }],
    ["a tab with only a header row", (s) => { s.replies[urls.faults] = "fault,label,category,action,deduct_pct,check_hint,basis\n"; }],
    ["a tab where every row is invalid", (s) => { s.replies[urls.prices] = "model,capacity_gb,base_ngn,floor_ngn\n,0,0,0\nX,128,100,500\n"; }],
    ["an empty tab", (s) => { s.replies[urls.stock] = ""; }],
  ];

  for (const [name, breakIt] of failures) {
    test(`${name}, no earlier good read: whole catalog is bundled`, async () => {
      const s = setup();
      breakIt(s);
      const r = await s.load();
      assert.equal(r.source, "bundled");
      assert.deepEqual(r.catalog, tinyCatalog());
    });

    test(`${name}, after a good read: whole catalog is the last good sheet (cached_sheet), never a mix`, async () => {
      const s = setup();
      const first = await s.load();
      assert.equal(first.source, "sheet");
      // the owner edits prices (new, valid) at the same moment another tab breaks
      s.replies[urls.prices] = pricesCsv(777000, "Newer Phone");
      breakIt(s);
      s.clock.t += 60_001;
      const r = await s.load();
      assert.equal(r.source, "cached_sheet");
      assert.deepEqual(r.catalog, first.catalog);
      assert.equal(r.catalog.prices[0].model, "Sheet Phone");
    });
  }

  test("recovers to a fresh sheet once every tab is good again", async () => {
    const s = setup();
    await s.load();
    s.replies[urls.stock] = 503;
    s.clock.t += 60_001;
    assert.equal((await s.load()).source, "cached_sheet");
    s.replies[urls.stock] = STOCK;
    s.replies[urls.prices] = pricesCsv(900000);
    s.clock.t += 120_000;
    const r = await s.load();
    assert.equal(r.source, "sheet");
    assert.equal(r.catalog.prices[0].base_ngn, 900000);
  });

  test("a hanging tab does not hold the call past a small multiple of timeoutMs", async () => {
    const s = setup({ stock: "hang" });
    const t0 = Date.now();
    await s.load();
    assert.ok(Date.now() - t0 < 1000, `took ${Date.now() - t0} ms`);
  });
});
