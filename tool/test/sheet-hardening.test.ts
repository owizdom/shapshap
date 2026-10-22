// Regression tests for the sheet-hardening review round. Each test is named after the finding it guards.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { parseCatalog } from "../src/catalog.ts";
import { sheetCatalogLoader } from "../src/sheet.ts";
import { valueTradeIn, findPhones, createCheckout } from "../src/tools.ts";
import type { Catalog, SheetUrls, Valuation, PhoneOption } from "../src/types.ts";
import { FLAWLESS, makeCtx, tinyCatalog } from "./fakes.ts";

const PRICES = "model,capacity_gb,base_ngn,floor_ngn\n";
const FAULTS = "fault,label,category,action,deduct_pct,check_hint,basis\n";
const STOCK = "unit_id,model,capacity_gb,grade,battery_pct,warranty_months,price_ngn\n";
const okPrice = "iPhone 13,128,302000,45000\n";
const okFault = "screen_cracked,Screen cracked,screen,deduct,20,Picture works?,sourced\n";
const okStock = "SS-1,iPhone 13,128,A,90,3,420000\n";

function parse(prices = PRICES + okPrice, faults = FAULTS + okFault, stock = STOCK + okStock) {
  return parseCatalog({ prices, faults, stock });
}

describe("refuse row with blank deduct_pct still refuses", () => {
  test("value_trade_in(['icloud_locked']) is FAULT_NOT_BOUGHT with no quote_token", async () => {
    const r = parse(undefined, FAULTS + "icloud_locked,iCloud locked,security,refuse,,Setup asks for an Apple Account?,policy\n");
    assert.deepEqual(r.problems, []);
    assert.equal(r.catalog.faults.length, 1);
    assert.equal(r.catalog.faults[0].action, "refuse");
    const ctx = makeCtx(r.catalog);
    const v = (await valueTradeIn(ctx.deps, { model: "iPhone 13", capacity_gb: 128, faults: ["icloud_locked"] })) as Record<string, unknown>;
    assert.equal(v.error, "FAULT_NOT_BOUGHT");
    assert.equal("quote_token" in v, false);
    assert.equal("value_ngn" in v, false);
  });

  test("a deduct row with a blank deduct_pct is still skipped with a problem", () => {
    const r = parse(undefined, FAULTS + "scratch,Scratch,screen,deduct,,x,policy\n" + okFault);
    assert.deepEqual(r.catalog.faults.map((f) => f.fault), ["screen_cracked"]);
    assert.equal(r.problems.length, 1);
  });
});

describe("fault action typos", () => {
  const row = (action: string) => `thing,Thing,misc,${action},10,x,policy\n`;

  test('"Refused" skips the row with a problem', () => {
    const r = parse(undefined, FAULTS + row("Refused"));
    assert.equal(r.catalog.faults.length, 0);
    assert.equal(r.problems.length, 1);
  });

  test('"ban" skips the row with a problem', () => {
    const r = parse(undefined, FAULTS + row("ban") + okFault);
    assert.deepEqual(r.catalog.faults.map((f) => f.fault), ["screen_cracked"]);
    assert.equal(r.problems.length, 1);
  });

  test('"refuse " with a trailing space is accepted as refuse', () => {
    const r = parse(undefined, FAULTS + row('"refuse "'));
    assert.deepEqual(r.problems, []);
    assert.equal(r.catalog.faults[0].action, "refuse");
  });

  test('"REFUSE" is accepted as refuse, "Inspect" as inspect, "DEDUCT" as deduct', () => {
    const r = parse(undefined, FAULTS + "a1,A,m,REFUSE,10,x,policy\nb1,B,m,Inspect,10,x,policy\nc1,C,m,DEDUCT,10,x,policy\n");
    assert.deepEqual(r.problems, []);
    assert.deepEqual(r.catalog.faults.map((f) => f.action), ["refuse", "inspect", "deduct"]);
  });

  test("a blank action is not silently a deduct: row skipped with a problem", () => {
    const r = parse(undefined, FAULTS + row(""));
    assert.equal(r.catalog.faults.length, 0);
    assert.equal(r.problems.length, 1);
  });

  const noAction = "fault,label,category,deduct_pct,check_hint,basis\nicloud_locked,iCloud locked,security,100,x,policy\nscreen_cracked,Screen,screen,20,x,policy\n";

  test("a faults tab without an action column skips every row with problems", () => {
    const r = parse(undefined, noAction);
    assert.equal(r.catalog.faults.length, 0);
    assert.ok(r.problems.length >= 2, r.problems.join("|"));
  });

  test("through sheetCatalogLoader that faults tab counts as zero valid rows: fallback, icloud_locked never valued", async () => {
    const urls: SheetUrls = { prices: "https://s.test/p", faults: "https://s.test/f", stock: "https://s.test/s" };
    const body: Record<string, string> = {
      [urls.prices]: PRICES + okPrice, [urls.faults]: noAction, [urls.stock]: STOCK + okStock,
    };
    const f = (async (input: any) => new Response(body[typeof input === "string" ? input : input.url], { status: 200 })) as unknown as typeof fetch;
    const load = sheetCatalogLoader(urls, { fetch: f, timeoutMs: 50, bundled: () => tinyCatalog() });
    const r = await load();
    assert.equal(r.source, "bundled");
    assert.equal(r.catalog.faults.find((x) => x.fault === "icloud_locked"), undefined);
    assert.deepEqual(r.catalog, tinyCatalog());
    assert.ok(r.problems.length > 0);
    const ctx = makeCtx(r.catalog);
    const v = (await valueTradeIn(ctx.deps, { model: "Test Phone", capacity_gb: 128, faults: ["icloud_locked"] })) as Record<string, unknown>;
    assert.equal(v.error, "UNKNOWN_FAULT");
    assert.equal("quote_token" in v, false);
  });
});

describe("numbers are whole naira, plausible, and floors are multiples of 1,000", () => {
  test('"850.000" base is rejected with a problem, not read as 850 or 850000', () => {
    const r = parse(PRICES + 'iPhone 14,128,"850.000",0\n' + okPrice);
    assert.deepEqual(r.catalog.prices.map((p) => p.model), ["iPhone 13"]);
    assert.equal(r.problems.length, 1);
  });

  test('"420,000.07" stock price is rejected with a problem', () => {
    const r = parse(undefined, undefined, STOCK + 'SS-9,iPhone 13,128,A,90,3,"420,000.07"\n' + okStock);
    assert.deepEqual(r.catalog.stock.map((s) => s.unit_id), ["SS-1"]);
    assert.equal(r.problems.length, 1);
  });

  test('"420,000.07" as a floor and "45000.5" as a base are rejected', () => {
    const r = parse(PRICES + 'iPhone 14,128,300000,"420,000.07"\niPhone 15,128,"45000.5",20000\n' + okPrice);
    assert.deepEqual(r.catalog.prices.map((p) => p.model), ["iPhone 13"]);
    assert.equal(r.problems.length, 2);
  });

  test('"₦850,000" and "850000" are accepted', () => {
    const r = parse(PRICES + 'iPhone 14,128,"₦850,000",45000\niPhone 15,128,850000,45000\n');
    assert.deepEqual(r.problems, []);
    assert.deepEqual(r.catalog.prices.map((p) => p.base_ngn), [850000, 850000]);
  });

  test('"15%" deduct_pct is accepted as 15', () => {
    const r = parse(undefined, FAULTS + "scratch,Scratch,screen,deduct,15%,x,policy\n");
    assert.deepEqual(r.problems, []);
    assert.equal(r.catalog.faults[0].deduct_pct, 15);
  });

  test("base 9,999 is below the plausible range and rejected; 10,000 is accepted", () => {
    const r = parse(PRICES + "Low Phone,128,9999,0\nEdge Phone,128,10000,0\n");
    assert.deepEqual(r.catalog.prices.map((p) => p.model), ["Edge Phone"]);
    assert.equal(r.problems.length, 1);
  });

  test("base 5,000,001 is above the plausible range and rejected; 5,000,000 is accepted", () => {
    const r = parse(PRICES + "High Phone,128,5000001,0\nEdge Phone,128,5000000,0\n");
    assert.deepEqual(r.catalog.prices.map((p) => p.model), ["Edge Phone"]);
    assert.equal(r.problems.length, 1);
  });

  test("stock price_ngn outside 10,000..5,000,000 is rejected", () => {
    const r = parse(undefined, undefined, STOCK + "S-1,iPhone 13,128,A,90,3,9999\nS-2,iPhone 13,128,A,90,3,5000001\nS-3,iPhone 13,128,A,90,3,10000\n");
    assert.deepEqual(r.catalog.stock.map((s) => s.unit_id), ["S-3"]);
    assert.equal(r.problems.length, 2);
  });

  test("floor 130,500 is not a multiple of 1,000 and is rejected; 130,000 is accepted", () => {
    const r = parse(PRICES + "Odd Floor,128,300000,130500\nGood Floor,128,300000,130000\n");
    assert.deepEqual(r.catalog.prices.map((p) => p.model), ["Good Floor"]);
    assert.equal(r.problems.length, 1);
  });

  test("no catalog value produces a non-integer deduction, adjustment, value, topup or amount_kobo", async () => {
    const bases = [10001, 123457, 302003, 835001, 999999, 5000000];
    const pcts = [3, 7, 12, 33, 45, 70, 100];
    const prices = PRICES + bases.map((b, i) => `Phone ${i},128,${b},10000`).join("\n") + "\n";
    const faults = FAULTS + pcts.map((p) => `f${p},F${p},m,deduct,${p},x,policy`).join("\n") + "\n";
    const stock = STOCK + bases.map((b, i) => `U-${i},Phone ${i},128,A,90,3,${5000000 - i}`).join("\n") + "\n";
    const { catalog, problems } = parseCatalog({ prices, faults, stock });
    assert.deepEqual(problems, []);
    const ctx = makeCtx(catalog);
    for (let i = 0; i < bases.length; i++) {
      for (const combo of [[], ["f3"], ["f7", "f12"], ["f33", "f45"], ["f70"], ["f100", "f45"]]) {
        const v = (await valueTradeIn(ctx.deps, { model: `Phone ${i}`, capacity_gb: 128, faults: combo })) as Valuation;
        const ctxt = `${bases[i]} ${combo}`;
        assert.ok(Number.isInteger(v.value_ngn), ctxt);
        for (const d of v.deductions) assert.ok(Number.isInteger(d.ngn), ctxt);
        for (const a of v.adjustments) assert.ok(Number.isInteger(a.ngn), ctxt);
        assert.equal(v.value_ngn, v.base_ngn - v.deductions.reduce((s, d) => s + d.ngn, 0) + v.adjustments.reduce((s, a) => s + a.ngn, 0), ctxt);
        const fp = (await findPhones(ctx.deps, { quote_token: v.quote_token, max_topup_ngn: 10_000_000 })) as { options: PhoneOption[] };
        for (const o of fp.options) assert.ok(Number.isInteger(o.topup_ngn), `${ctxt} topup ${o.topup_ngn}`);
        if (fp.options.length > 0) {
          const c = await createCheckout(ctx.deps, { quote_token: v.quote_token, offer_token: fp.options[0].offer_token, find_my_off: true });
          assert.ok(!("error" in c), JSON.stringify(c));
          const call = ctx.paystack.initializeCalls.at(-1)!;
          assert.ok(Number.isInteger(call.amount_kobo), `${ctxt} kobo ${call.amount_kobo}`);
        }
      }
    }
  });
});

describe("empty stock tab (header only) is valid", () => {
  const urls: SheetUrls = { prices: "https://s.test/p", faults: "https://s.test/f", stock: "https://s.test/s" };
  const mk = (stock: string, prices = PRICES + "Test Phone,128,100000,20000\n", faults = FAULTS + okFault) => {
    const body: Record<string, string> = { [urls.prices]: prices, [urls.faults]: faults, [urls.stock]: stock };
    const f = (async (input: any) => new Response(body[typeof input === "string" ? input : input.url], { status: 200 })) as unknown as typeof fetch;
    return sheetCatalogLoader(urls, { fetch: f, timeoutMs: 50, bundled: () => tinyCatalog() });
  };

  test("parseCatalog: header-only stock gives [] and no problems", () => {
    const r = parse(undefined, undefined, STOCK);
    assert.deepEqual(r.catalog.stock, []);
    assert.deepEqual(r.problems, []);
  });

  test("loader: source is sheet with stock [], and the bundled stock is not used", async () => {
    const r = await mk(STOCK)();
    assert.equal(r.source, "sheet");
    assert.deepEqual(r.catalog.stock, []);
    assert.equal(r.catalog.prices[0].model, "Test Phone");
  });

  test("find_phones on a sold-out sheet returns options []", async () => {
    const r = await mk(STOCK)();
    const ctx = makeCtx(r.catalog);
    const v = (await valueTradeIn(ctx.deps, { model: "Test Phone", capacity_gb: 128, faults: [] })) as Valuation;
    const fp = await findPhones(ctx.deps, { quote_token: v.quote_token, max_topup_ngn: 10_000_000 });
    assert.deepEqual(fp, { options: [] });
  });

  test("a header-only prices tab still falls back to bundled", async () => {
    const r = await mk(STOCK, PRICES)();
    assert.equal(r.source, "bundled");
    assert.deepEqual(r.catalog, tinyCatalog());
  });

  test("a header-only faults tab still falls back to bundled", async () => {
    const r = await mk(STOCK, undefined, FAULTS)();
    assert.equal(r.source, "bundled");
    assert.deepEqual(r.catalog, tinyCatalog());
  });

  test("a wholly empty stock body (no header) is not a valid sold-out sheet: falls back", async () => {
    const r = await mk("")();
    assert.equal(r.source, "bundled");
  });
});

describe("failure cache and stale-while-revalidate", () => {
  const urls: SheetUrls = { prices: "https://s.test/p", faults: "https://s.test/f", stock: "https://s.test/s" };
  const GOODP = (base: number) => PRICES + `Sheet Phone,128,${base},10000\n`;

  test("hanging sheet: two consecutive loads within cacheMs fetch only on the first", async () => {
    let calls = 0;
    const f = (async () => { calls++; return new Promise<Response>(() => {}); }) as unknown as typeof fetch;
    const clock = { t: 1_000_000 };
    const load = sheetCatalogLoader(urls, { fetch: f, timeoutMs: 20, cacheMs: 60_000, now: () => clock.t, bundled: () => tinyCatalog() });
    const a = await load();
    assert.equal(a.source, "bundled");
    const n = calls;
    assert.ok(n > 0 && n <= 3, `first load made ${n} fetches`);
    clock.t += 30_000;
    const t0 = Date.now();
    const b = await load();
    assert.equal(calls, n, "second load within cacheMs must not fetch");
    assert.equal(b.source, "bundled");
    assert.ok(Date.now() - t0 < 15, "remembered failure must answer without waiting on a timeout");
  });

  test("the failure is retried once cacheMs has passed", async () => {
    let calls = 0;
    const f = (async () => { calls++; return new Response("", { status: 500 }); }) as unknown as typeof fetch;
    const clock = { t: 1_000_000 };
    const load = sheetCatalogLoader(urls, { fetch: f, timeoutMs: 20, cacheMs: 60_000, now: () => clock.t, bundled: () => tinyCatalog() });
    await load();
    const n = calls;
    clock.t += 60_001;
    await load();
    assert.ok(calls > n, "expected a refetch after cacheMs");
  });

  test("stale-while-revalidate: after cacheMs the cached good catalog returns immediately and one background refresh runs", async () => {
    let calls = 0;
    const gates: (() => void)[] = [];
    let slow = false;
    let priceBase = 500000;
    const f = (async (input: any) => {
      calls++;
      const url = typeof input === "string" ? input : input.url;
      if (slow) await new Promise<void>((r) => { gates.push(r); setTimeout(r, 5000).unref(); });
      const body = url === urls.prices ? GOODP(priceBase) : url === urls.faults ? FAULTS + okFault : STOCK + okStock;
      return new Response(body, { status: 200 });
    }) as unknown as typeof fetch;
    const clock = { t: 1_000_000 };
    const load = sheetCatalogLoader(urls, { fetch: f, timeoutMs: 4000, cacheMs: 60_000, now: () => clock.t, bundled: () => tinyCatalog() });
    const first = await load();
    assert.equal(first.source, "sheet");
    assert.equal(calls, 3);

    slow = true;
    priceBase = 650000;
    clock.t += 60_001;
    const t0 = Date.now();
    const stale = await load();
    assert.ok(Date.now() - t0 < 200, `stale read waited ${Date.now() - t0} ms on the fetch`);
    assert.equal(stale.catalog.prices[0].base_ngn, 500000);
    assert.ok(stale.source === "sheet" || stale.source === "cached_sheet");
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(calls, 6, "exactly one background refresh (3 tab fetches)");

    // a concurrent call while the refresh is in flight does not start another
    await load();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(calls, 6, "no second refresh while one is in flight");

    // let the refresh finish; the next load serves the new sheet
    slow = false;
    for (const g of gates.splice(0)) g();
    await new Promise((r) => setTimeout(r, 50));
    const after = await load();
    assert.equal(after.catalog.prices[0].base_ngn, 650000);
  });
});

describe("endpoint loads the catalog only for tools/call", () => {
  const TOKEN = "test-mcp-token";
  const U = { p: "https://sheets.test/prices.csv", f: "https://sheets.test/faults.csv", s: "https://sheets.test/stock.csv" };
  const realFetch = globalThis.fetch;
  let fetches = 0;
  let server: http.Server;
  let base: string;
  const BODIES: Record<string, string> = {
    [U.p]: 'model,capacity_gb,base_ngn,floor_ngn\niPhone 16 Plus,256,"₦900,000",100000\n',
    [U.f]: "fault,label,category,action,deduct_pct,check_hint,basis\ncharging_port,Charging port,power,deduct,10,Try two cables,sourced\n",
    [U.s]: "unit_id,model,capacity_gb,grade,battery_pct,warranty_months,price_ngn\nSH-1,iPhone 16,128,A,98,6,1000000\n",
  };

  before(async () => {
    process.env.MCP_TOKEN = TOKEN;
    process.env.QUOTE_SECRET = "test-quote-secret";
    process.env.PAYSTACK_SECRET_KEY = "sk_test_not_real";
    process.env.PRICES_SHEET_PRICES_URL = U.p;
    process.env.PRICES_SHEET_FAULTS_URL = U.f;
    process.env.PRICES_SHEET_STOCK_URL = U.s;
    globalThis.fetch = (async (input: any, init?: any) => {
      const url = typeof input === "string" ? input : input.url ?? String(input);
      if (url in BODIES) { fetches++; return new Response(BODIES[url], { status: 200 }); }
      return realFetch(input, init);
    }) as typeof fetch;
    const mod = await import("../api/mcp.ts");
    server = http.createServer(mod.default);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/mcp`;
  });

  after(async () => {
    globalThis.fetch = realFetch;
    for (const k of ["PRICES_SHEET_PRICES_URL", "PRICES_SHEET_FAULTS_URL", "PRICES_SHEET_STOCK_URL"]) delete process.env[k];
    server?.closeAllConnections?.();
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  });

  const rpc = (body: unknown) => realFetch(base, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });

  test("initialize does not fetch the sheet", async () => {
    const res = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "0" } } });
    assert.equal(res.status, 200);
    await res.text();
    assert.equal(fetches, 0);
  });

  test("tools/list does not fetch the sheet and still lists the four tools", async () => {
    const res = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    assert.equal(res.status, 200);
    const t = (await res.text()).trim();
    const line = t.startsWith("{") ? t : t.split("\n").find((l) => l.startsWith("data:"))!.slice(5);
    const names = JSON.parse(line).result.tools.map((x: any) => x.name).sort();
    assert.deepEqual(names, ["confirm_payment", "create_checkout", "find_phones", "value_trade_in"]);
    assert.equal(fetches, 0);
  });

  test("tools/call does fetch the sheet and prices from it", async () => {
    const res = await rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "value_trade_in", arguments: { model: "iPhone 16 Plus", capacity_gb: 256, faults: [] } } });
    assert.equal(res.status, 200);
    const t = (await res.text()).trim();
    const line = t.startsWith("{") ? t : t.split("\n").find((l) => l.startsWith("data:"))!.slice(5);
    const msg = JSON.parse(line);
    const body = msg.result.structuredContent ?? JSON.parse(msg.result.content.find((c: any) => c.type === "text").text);
    assert.equal(body.base_ngn, 900000);
    assert.ok(fetches >= 3, `fetches ${fetches}`);
  });
});

describe("floor adjustment is never negative and only labelled when positive", () => {
  const FLOOR = "Minimum we pay for this model";
  const floors = [0, 1000, 20000, 90000, 130000, 300000];
  const bases = [100000, 130999, 250500, 302003, 835001];

  test("sweep: any adjustment labelled as the minimum is positive, and the working adds up", async () => {
    const prices = PRICES + bases.flatMap((b, i) => floors.filter((f) => f <= b).map((f) => `P${i}f${f},128,${b},${f}`)).join("\n") + "\n";
    const faults = FAULTS + [0, 10, 33, 50, 70, 100].map((p) => `f${p},F,m,deduct,${p},x,policy`).join("\n") + "\n";
    const { catalog, problems } = parseCatalog({ prices, faults, stock: STOCK });
    assert.deepEqual(problems, []);
    const ctx = makeCtx(catalog);
    let lifted = 0;
    for (const p of catalog.prices) {
      for (const fid of ["f0", "f10", "f33", "f50", "f70", "f100"]) {
        const v = (await valueTradeIn(ctx.deps, { model: p.model, capacity_gb: 128, faults: [fid] })) as Valuation;
        const adj = v.adjustments.filter((a) => a.label === FLOOR);
        for (const a of adj) assert.ok(a.ngn > 0, `${p.model} ${fid}: ${a.ngn}`);
        for (const a of v.adjustments) assert.ok(!/minimum/i.test(a.label) || a.ngn > 0);
        assert.ok(v.value_ngn >= p.floor_ngn);
        assert.equal(v.value_ngn, v.base_ngn - v.deductions.reduce((s, d) => s + d.ngn, 0) + v.adjustments.reduce((s, a) => s + a.ngn, 0));
        if (adj.length) { lifted++; assert.equal(v.value_ngn, p.floor_ngn); }
        else assert.ok(v.value_ngn >= p.floor_ngn);
      }
    }
    assert.ok(lifted > 0, "sweep never lifted to a floor, test is vacuous");
  });

  test("a lifted value carries exactly one positive floor adjustment equal to floor minus the pre-floor value", async () => {
    const { catalog } = parseCatalog({ prices: PRICES + "Lift Phone,128,100000,90000\n", faults: FAULTS + "f50,F,m,deduct,50,x,policy\n", stock: STOCK });
    const v = (await valueTradeIn(makeCtx(catalog).deps, { model: "Lift Phone", capacity_gb: 128, faults: ["f50"], ...FLAWLESS })) as Valuation;
    assert.equal(v.value_ngn, 90000);
    assert.deepEqual(v.adjustments, [{ label: FLOOR, ngn: 40000 }]);
  });

  test("a value above the floor has no floor adjustment", async () => {
    const { catalog } = parseCatalog({ prices: PRICES + "Plain Phone,128,100000,20000\n", faults: FAULTS + "f10,F,m,deduct,10,x,policy\n", stock: STOCK });
    const v = (await valueTradeIn(makeCtx(catalog).deps, { model: "Plain Phone", capacity_gb: 128, faults: ["f10"], ...FLAWLESS })) as Valuation;
    assert.equal(v.value_ngn, 90000);
    assert.equal(v.adjustments.some((a) => a.label === FLOOR), false);
  });
});

describe("stock rows with empty model or bad capacity are skipped", () => {
  test("empty model is skipped with a problem", () => {
    const r = parse(undefined, undefined, STOCK + "S-1,,128,A,90,3,420000\n" + okStock);
    assert.deepEqual(r.catalog.stock.map((s) => s.unit_id), ["SS-1"]);
    assert.equal(r.problems.length, 1);
  });

  test('capacity "128GB" is skipped with a problem, not read as NaN or 128', () => {
    const r = parse(undefined, undefined, STOCK + "S-1,iPhone 13,128GB,A,90,3,420000\n" + okStock);
    assert.deepEqual(r.catalog.stock.map((s) => s.unit_id), ["SS-1"]);
    assert.equal(r.problems.length, 1);
  });

  test("capacity 0 and capacity 128.5 are skipped with problems", () => {
    const r = parse(undefined, undefined, STOCK + "S-1,iPhone 13,0,A,90,3,420000\nS-2,iPhone 13,128.5,A,90,3,420000\n" + okStock);
    assert.deepEqual(r.catalog.stock.map((s) => s.unit_id), ["SS-1"]);
    assert.equal(r.problems.length, 2);
  });

  test("every kept stock capacity is a positive integer", () => {
    const r = parse(undefined, undefined, STOCK + "S-1,iPhone 13,128GB,A,90,3,420000\n" + okStock);
    for (const s of r.catalog.stock) assert.ok(Number.isInteger(s.capacity_gb) && s.capacity_gb > 0);
  });
});

describe("tabs must carry their key headers; an all-invalid stock tab is a failed read", () => {
  const urls: SheetUrls = { prices: "https://s.test/p", faults: "https://s.test/f", stock: "https://s.test/s" };
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

  for (const tab of ["stock", "prices", "faults"] as const) {
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

  test("a stock tab whose rows all fail falls back with problems", async () => {
    const r = await mk({ stock: STOCK + 'SS-1,iPhone 13,128,A,90,3,"₦815,000.50"\nSS-2,iPhone 13,128,A,90,3,"₦815,000.50"\n' })();
    assert.equal(r.source, "bundled");
    assert.ok(r.problems.length > 0);
  });

  test('"₦815,000.00" and "815000.0" parse to 815000', () => {
    const r = parse(PRICES + 'iPhone 14,128,"₦815,000.00",45000\niPhone 15,128,815000.0,45000\n');
    assert.deepEqual(r.problems, []);
    assert.deepEqual(r.catalog.prices.map((p) => p.base_ngn), [815000, 815000]);
  });

  test("a header-only stock tab is still source sheet with stock []", async () => {
    const r = await mk({ stock: STOCK })();
    assert.equal(r.source, "sheet");
    assert.deepEqual(r.catalog.stock, []);
  });
});
