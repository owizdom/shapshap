// sheetCatalogLoader with an injected fetch and clock. Fallback is all-or-nothing.
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
    ["a network error on one tab", (s) => { s.replies[urls.stock] = new TypeError("fetch failed"); }],
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
});

describe("a sheet that returns HTML instead of CSV", () => {
  const urls: SheetUrls = { prices: "https://s.test/p", faults: "https://s.test/f", stock: "https://s.test/s" };
  const PRICES = "model,capacity_gb,base_ngn,floor_ngn\n";
  const FAULTS = "fault,label,category,action,deduct_pct,check_hint,basis\n";
  const STOCK = "unit_id,model,capacity_gb,grade,battery_pct,warranty_months,price_ngn\n";
  const okFault = "screen_cracked,Screen cracked,screen,deduct,20,Picture works?,sourced\n";
  const okStock = "SS-1,iPhone 13,128,A,90,3,420000\n";
  const HTML = "<!DOCTYPE html><html><body>Sign in</body></html>";
  const mk = (over: Partial<Record<keyof SheetUrls, string>>) => {
    const body: Record<string, string> = {
      [urls.prices]: over.prices ?? PRICES + "Test Phone,128,100000,20000\n",
      [urls.faults]: over.faults ?? FAULTS + okFault,
      [urls.stock]: over.stock ?? STOCK + okStock,
    };
    const f = (async (input: any) => new Response(body[typeof input === "string" ? input : input.url], { status: 200 })) as unknown as typeof fetch;
    return sheetCatalogLoader(urls, { fetch: f, timeoutMs: 50, bundled: () => tinyCatalog() });
  };

  for (const tab of ["stock"] as const) {
    test(`an HTML body with status 200 for the ${tab} tab falls back, never source sheet`, async () => {
      const r = await mk({ [tab]: HTML })();
      assert.notEqual(r.source, "sheet");
      assert.equal(r.source, "bundled");
      assert.deepEqual(r.catalog, tinyCatalog());
      assert.ok(r.problems.length > 0);
    });
  }

  test("an HTML stock tab after a good read serves cached_sheet", async () => {
    let html = false;
    const f = (async (input: any) => {
      const url = typeof input === "string" ? input : input.url;
      if (html && url === urls.stock) return new Response(HTML, { status: 200 });
      const body = url === urls.prices ? PRICES + "Test Phone,128,100000,20000\n" : url === urls.faults ? FAULTS + okFault : STOCK + okStock;
      return new Response(body, { status: 200 });
    }) as unknown as typeof fetch;
    const clock = { t: 1_000_000 };
    const load = sheetCatalogLoader(urls, { fetch: f, timeoutMs: 50, cacheMs: 1000, now: () => clock.t, bundled: () => tinyCatalog() });
    assert.equal((await load()).source, "sheet");
    html = true;
    clock.t += 1001;
    const r = await load();
    assert.equal(r.source, "cached_sheet");
    assert.equal(r.catalog.stock.length, 1);
  });
});
