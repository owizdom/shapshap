// 4b / spec C1: api/mcp.ts prices from the owner sheet when the three PRICES_SHEET_* vars are set.
// Needs api/mcp.ts to read the sheet through the global fetch resolved at call time (not captured at import).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

const TOKEN = "test-mcp-token";
const U = { p: "https://sheets.test/prices.csv", f: "https://sheets.test/faults.csv", s: "https://sheets.test/stock.csv" };
const realFetch = globalThis.fetch;
const sheetCalls: string[] = [];
const BODIES: Record<string, string> = {
  [U.p]: 'model,capacity_gb,base_ngn,floor_ngn\niPhone 16 Plus,256,"₦900,000",100000\n',
  [U.f]: "fault,label,category,action,deduct_pct,check_hint,basis\ncharging_port,Charging port,power,deduct,10,Try two cables,sourced\n",
  [U.s]: "unit_id,model,capacity_gb,grade,battery_pct,warranty_months,price_ngn\nSH-1,iPhone 16,128,A,98,6,1000000\n",
};

describe("api/mcp.ts with the sheet configured", () => {
  let server: http.Server;
  let base: string;

  before(async () => {
    process.env.MCP_TOKEN = TOKEN;
    process.env.QUOTE_SECRET = "test-quote-secret";
    process.env.PAYSTACK_SECRET_KEY = "sk_test_not_real";
    process.env.PRICES_SHEET_PRICES_URL = U.p;
    process.env.PRICES_SHEET_FAULTS_URL = U.f;
    process.env.PRICES_SHEET_STOCK_URL = U.s;
    globalThis.fetch = (async (input: any, init?: any) => {
      const url = typeof input === "string" ? input : input.url ?? String(input);
      if (url in BODIES) { sheetCalls.push(url); return new Response(BODIES[url], { status: 200 }); }
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

  test("value_trade_in prices from the sheet: base 900000 and 10% charging_port, not the bundled 835000", async () => {
    const res = await realFetch(base, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "value_trade_in", arguments: { model: "iPhone 16 Plus", capacity_gb: 256, faults: ["charging_port"] } } }),
    });
    assert.equal(res.status, 200);
    const t = (await res.text()).trim();
    const line = t.startsWith("{") ? t : t.split("\n").find((l) => l.startsWith("data:"))!.slice(5);
    const msg = JSON.parse(line);
    const body = msg.result.structuredContent ?? JSON.parse(msg.result.content.find((c: any) => c.type === "text").text);
    assert.equal(body.base_ngn, 900000);
    assert.equal(body.deductions[0].ngn, 90000);
    assert.equal(body.value_ngn, 810000);
    assert.ok(sheetCalls.includes(U.p) && sheetCalls.includes(U.f) && sheetCalls.includes(U.s), sheetCalls.join(","));
  });
});
