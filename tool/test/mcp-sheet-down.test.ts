// 4b / spec C3: a sheet that is unreachable never takes the agent down; the bundled prices answer.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

const TOKEN = "test-mcp-token";
const realFetch = globalThis.fetch;

describe("api/mcp.ts with an unreachable sheet", () => {
  let server: http.Server;
  let base: string;
  before(async () => {
    process.env.MCP_TOKEN = TOKEN;
    process.env.QUOTE_SECRET = "test-quote-secret";
    process.env.PAYSTACK_SECRET_KEY = "sk_test_not_real";
    process.env.PRICES_SHEET_PRICES_URL = "https://sheets.test/prices.csv";
    process.env.PRICES_SHEET_FAULTS_URL = "https://sheets.test/faults.csv";
    process.env.PRICES_SHEET_STOCK_URL = "https://sheets.test/stock.csv";
    globalThis.fetch = (async (input: any, init?: any) => {
      const url = typeof input === "string" ? input : input.url ?? String(input);
      if (url.startsWith("https://sheets.test/")) throw new TypeError("fetch failed");
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

  test("tool call still answers from the bundled catalog", async () => {
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
    assert.equal(body.value_ngn, 688447);
  });
});
