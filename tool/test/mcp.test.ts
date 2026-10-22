// MCP surface. In-memory client for tools/list and calls, real HTTP for the bearer token and the catalog source.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../src/server.ts";
import { makeCtx, tinyCatalog } from "./fakes.ts";

const realFetch = globalThis.fetch;
const SHEET_VARS = ["PRICES_SHEET_PRICES_URL", "PRICES_SHEET_FAULTS_URL", "PRICES_SHEET_STOCK_URL"];

const TOOLS = ["confirm_payment", "create_checkout", "find_phones", "value_trade_in"];

async function connect() {
  const ctx = makeCtx(tinyCatalog());
  const server = buildServer(ctx.deps);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  return { ctx, client, server };
}

function payloadOf(res: any): any {
  if (res.structuredContent) return res.structuredContent;
  const text = res.content?.find((c: any) => c.type === "text")?.text;
  assert.equal(typeof text, "string", `no text content in ${JSON.stringify(res)}`);
  return JSON.parse(text);
}

describe("MCP surface (in memory)", () => {
  test("tools/list returns exactly the four tools", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), TOOLS);
    for (const t of tools) {
      assert.equal(t.inputSchema.type, "object", t.name);
      assert.equal(typeof t.description, "string", t.name);
      assert.ok(t.description!.length > 0, t.name);
    }
  });

  test("a full flow through MCP: value, find, checkout, confirm waiting", async () => {
    const { client } = await connect();
    const v = payloadOf(await client.callTool({ name: "value_trade_in", arguments: { model: "Test Phone", capacity_gb: 128, faults: [], screen: "flawless", body: "flawless" } }));
    const f = payloadOf(await client.callTool({ name: "find_phones", arguments: { quote_token: v.quote_token, max_topup_ngn: 60000 } }));
    assert.deepEqual(f.options.map((o: any) => o.unit_id), ["T-4", "T-5", "T-2"]);
    const c = payloadOf(await client.callTool({ name: "create_checkout", arguments: { quote_token: v.quote_token, offer_token: f.options[0].offer_token, find_my_off: true } }));
    assert.equal(c.topup_ngn, 10000);
    const s = payloadOf(await client.callTool({ name: "confirm_payment", arguments: { reference: c.reference } }));
    assert.deepEqual(s, { status: "waiting" });
  });
});

describe("bearer token over HTTP", () => {
  const TOKEN = "test-mcp-token";
  let server: http.Server;
  let base: string;

  before(async () => {
    process.env.MCP_TOKEN = TOKEN;
    process.env.QUOTE_SECRET = "test-quote-secret";
    process.env.PAYSTACK_SECRET_KEY = "sk_test_not_real";
    const mod = await import("../api/mcp.ts");
    server = http.createServer(mod.default);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/mcp`;
  });

  after(async () => {
    server?.closeAllConnections?.();
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  });

  const initBody = JSON.stringify({
    jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "0.0.0" } },
  });
  const baseHeaders = { "content-type": "application/json", accept: "application/json, text/event-stream" };

  // Streamable HTTP may answer as JSON or as one SSE event.
  function parseRpc(text: string): any {
    const t = text.trim();
    if (t.startsWith("{")) return JSON.parse(t);
    const line = t.split("\n").find((l) => l.startsWith("data:"));
    assert.ok(line, `no data line in ${t}`);
    return JSON.parse(line.slice(5).trim());
  }

  test("no Authorization header gets 401", async () => {
    const res = await fetch(base, { method: "POST", headers: baseHeaders, body: initBody });
    assert.equal(res.status, 401);
  });

  test("with the token, stateless tools/list lists the four tools", async () => {
    const res = await fetch(base, {
      method: "POST", headers: { ...baseHeaders, authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    });
    assert.equal(res.status, 200);
    const msg = parseRpc(await res.text());
    assert.deepEqual(msg.result.tools.map((t: any) => t.name).sort(), TOOLS);
  });

  // The catalog source: bundled CSVs without the sheet variables, the sheet when all three are set, bundled again when it is down.
  async function quote(): Promise<any> {
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

  function useSheet(urls: { p: string; f: string; s: string }, answer: (url: string) => Response) {
    process.env.PRICES_SHEET_PRICES_URL = urls.p;
    process.env.PRICES_SHEET_FAULTS_URL = urls.f;
    process.env.PRICES_SHEET_STOCK_URL = urls.s;
    globalThis.fetch = (async (input: any, init?: any) => {
      const url = typeof input === "string" ? input : input.url ?? String(input);
      if (url.startsWith("https://sheets.test/")) return answer(url);
      return realFetch(input, init);
    }) as typeof fetch;
  }

  function restore() {
    globalThis.fetch = realFetch;
    for (const k of SHEET_VARS) delete process.env[k];
  }

  test("variables absent: bundled prices (775890 base, 688447 value)", async () => {
    const body = await quote();
    assert.equal(body.base_ngn, 775890);
    assert.equal(body.value_ngn, 688447);
  });

  test("with the sheet configured, value_trade_in prices from the sheet: base 900000 and 10% charging_port", async () => {
    const BODIES: Record<string, string> = {
      "https://sheets.test/ok/prices.csv": 'model,capacity_gb,base_ngn,floor_ngn\niPhone 16 Plus,256,"₦900,000",100000\n',
      "https://sheets.test/ok/faults.csv": "fault,label,category,action,deduct_pct,check_hint,basis\ncharging_port,Charging port,power,deduct,10,Try two cables,sourced\n",
      "https://sheets.test/ok/stock.csv": "unit_id,model,capacity_gb,grade,battery_pct,warranty_months,price_ngn\nSH-1,iPhone 16,128,A,98,6,1000000\n",
    };
    useSheet({ p: "https://sheets.test/ok/prices.csv", f: "https://sheets.test/ok/faults.csv", s: "https://sheets.test/ok/stock.csv" }, (url) => new Response(BODIES[url], { status: 200 }));
    try {
      const body = await quote();
      assert.equal(body.base_ngn, 900000);
      // default condition: W = round(900000 x 0.934) = 840600 ; 10% = 84060 ; value 756540. The sheet has no repair columns.
      assert.equal(body.deductions[0].ngn, 84060);
      assert.equal(body.value_ngn, 756540);
    } finally {
      restore();
    }
  });

  test("with the sheet unreachable, the tool call still answers from the bundled catalog", async () => {
    useSheet({ p: "https://sheets.test/down/prices.csv", f: "https://sheets.test/down/faults.csv", s: "https://sheets.test/down/stock.csv" }, () => { throw new TypeError("fetch failed"); });
    try {
      const body = await quote();
      assert.equal(body.value_ngn, 688447);
    } finally {
      restore();
    }
  });
});
