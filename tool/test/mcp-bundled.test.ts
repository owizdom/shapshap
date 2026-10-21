// 4b: api/mcp.ts uses the bundled CSVs when PRICES_SHEET_* are absent, and when the sheet is unreachable.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

const TOKEN = "test-mcp-token";
const realFetch = globalThis.fetch;
const outside: string[] = [];

async function quote(base: string) {
  const res = await realFetch(base, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "value_trade_in", arguments: { model: "iPhone 16 Plus", capacity_gb: 256, faults: ["charging_port"] } } }),
  });
  assert.equal(res.status, 200);
  const t = (await res.text()).trim();
  const line = t.startsWith("{") ? t : t.split("\n").find((l) => l.startsWith("data:"))!.slice(5);
  const msg = JSON.parse(line);
  return msg.result.structuredContent ?? JSON.parse(msg.result.content.find((c: any) => c.type === "text").text);
}

async function boot(): Promise<{ server: http.Server; base: string }> {
  process.env.MCP_TOKEN = TOKEN;
  process.env.QUOTE_SECRET = "test-quote-secret";
  process.env.PAYSTACK_SECRET_KEY = "sk_test_not_real";
  const mod = await import("../api/mcp.ts");
  const server = http.createServer(mod.default);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/mcp` };
}

describe("api/mcp.ts without a sheet", () => {
  let server: http.Server;
  let base: string;
  before(async () => {
    for (const k of ["PRICES_SHEET_PRICES_URL", "PRICES_SHEET_FAULTS_URL", "PRICES_SHEET_STOCK_URL"]) delete process.env[k];
    globalThis.fetch = (async (input: any, init?: any) => {
      const url = typeof input === "string" ? input : input.url ?? String(input);
      if (!url.startsWith("http://127.0.0.1")) outside.push(url);
      return realFetch(input, init);
    }) as typeof fetch;
    ({ server, base } = await boot());
  });
  after(async () => {
    globalThis.fetch = realFetch;
    server?.closeAllConnections?.();
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  });

  test("variables absent: bundled prices (835000 base, 793000 value) and no outside fetch", async () => {
    const body = await quote(base);
    assert.equal(body.base_ngn, 835000);
    assert.equal(body.value_ngn, 793000);
    assert.deepEqual(outside, []);
  });

  test("only some of the three variables set: still bundled", async () => {
    process.env.PRICES_SHEET_PRICES_URL = "https://sheets.test/prices.csv";
    try {
      const body = await quote(base);
      assert.equal(body.base_ngn, 835000);
      assert.deepEqual(outside, []);
    } finally {
      delete process.env.PRICES_SHEET_PRICES_URL;
    }
  });
});
