// B14: MCP surface. In-memory client for tools/list and calls, real HTTP for the bearer token.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../src/server.ts";
import { makeCtx, tinyCatalog } from "./fakes.ts";

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

describe("B14 MCP surface (in memory)", () => {
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

  test("input schemas have the contract's properties", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const props = Object.fromEntries(tools.map((t) => [t.name, Object.keys(t.inputSchema.properties ?? {}).sort()]));
    assert.deepEqual(props, {
      confirm_payment: ["reference"],
      create_checkout: ["find_my_off", "offer_token", "quote_token"],
      find_phones: ["max_topup_ngn", "quote_token"],
      value_trade_in: ["capacity_gb", "faults", "model"],
    });
  });

  test("create_checkout requires a boolean find_my_off", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const t = tools.find((x) => x.name === "create_checkout")!;
    assert.ok((t.inputSchema.required ?? []).includes("find_my_off"), JSON.stringify(t.inputSchema));
    assert.equal((t.inputSchema.properties as any).find_my_off.type, "boolean");
  });

  test("create_checkout through MCP with find_my_off false is FIND_MY_ON", async () => {
    const { client, ctx } = await connect();
    const v = payloadOf(await client.callTool({ name: "value_trade_in", arguments: { model: "Test Phone", capacity_gb: 128, faults: [] } }));
    const f = payloadOf(await client.callTool({ name: "find_phones", arguments: { quote_token: v.quote_token, max_topup_ngn: 60000 } }));
    const c = payloadOf(await client.callTool({ name: "create_checkout", arguments: { quote_token: v.quote_token, offer_token: f.options[0].offer_token, find_my_off: false } }));
    assert.equal(c.error, "FIND_MY_ON");
    assert.equal(ctx.paystack.initializeCalls.length, 0);
  });

  test("B5: no tool input property is named like an amount or a price", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    for (const t of tools) {
      for (const name of Object.keys(t.inputSchema.properties ?? {})) {
        // max_topup_ngn is the customer's budget filter, not a price; it is the one allowed money-shaped name
        assert.ok(!/amount/i.test(name), `${t.name}.${name} looks like an amount`);
        assert.ok(!/price/i.test(name), `${t.name}.${name} looks like a price`);
      }
    }
  });

  test("calling value_trade_in end to end through MCP returns the working", async () => {
    const { client } = await connect();
    const res = await client.callTool({ name: "value_trade_in", arguments: { model: "test phone", capacity_gb: 256, faults: ["a", "b"] } });
    const body = payloadOf(res);
    assert.equal(body.value_ngn, 75000);
    assert.equal(body.base_ngn, 100005);
    assert.equal(typeof body.quote_token, "string");
    assert.deepEqual(body.adjustments, [{ label: "Rounded down to the nearest 1,000", ngn: -3 }]);
  });

  test("calling find_phones with a bad token returns QUOTE_INVALID through MCP", async () => {
    const { client } = await connect();
    const res = await client.callTool({ name: "find_phones", arguments: { quote_token: "bad.token", max_topup_ngn: 50000 } });
    assert.equal(payloadOf(res).error, "QUOTE_INVALID");
  });

  test("a full flow through MCP: value, find, checkout, confirm waiting", async () => {
    const { client } = await connect();
    const v = payloadOf(await client.callTool({ name: "value_trade_in", arguments: { model: "Test Phone", capacity_gb: 128, faults: [] } }));
    const f = payloadOf(await client.callTool({ name: "find_phones", arguments: { quote_token: v.quote_token, max_topup_ngn: 60000 } }));
    assert.deepEqual(f.options.map((o: any) => o.unit_id), ["T-4", "T-5", "T-2"]);
    const c = payloadOf(await client.callTool({ name: "create_checkout", arguments: { quote_token: v.quote_token, offer_token: f.options[0].offer_token, find_my_off: true } }));
    assert.equal(c.topup_ngn, 10000);
    const s = payloadOf(await client.callTool({ name: "confirm_payment", arguments: { reference: c.reference } }));
    assert.deepEqual(s, { status: "waiting" });
  });
});

describe("B14 bearer token over HTTP", () => {
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

  test("wrong bearer token gets 401", async () => {
    const res = await fetch(base, { method: "POST", headers: { ...baseHeaders, authorization: "Bearer wrong" }, body: initBody });
    assert.equal(res.status, 401);
  });

  test("a non-Bearer scheme with the right secret gets 401", async () => {
    const res = await fetch(base, { method: "POST", headers: { ...baseHeaders, authorization: `Basic ${TOKEN}` }, body: initBody });
    assert.equal(res.status, 401);
  });

  test("tools/list without the token gets 401", async () => {
    const res = await fetch(base, {
      method: "POST", headers: baseHeaders,
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    });
    assert.equal(res.status, 401);
  });

  test("with the token, initialize succeeds", async () => {
    const res = await fetch(base, { method: "POST", headers: { ...baseHeaders, authorization: `Bearer ${TOKEN}` }, body: initBody });
    assert.equal(res.status, 200);
    const msg = parseRpc(await res.text());
    assert.equal(msg.id, 1);
    assert.ok(msg.result, JSON.stringify(msg));
    assert.equal(typeof msg.result.protocolVersion, "string");
    assert.ok(msg.result.capabilities.tools, "server must advertise tools");
  });

  test("F3: initialize with Accept: application/json only succeeds, not 406", async () => {
    const res = await fetch(base, { method: "POST", headers: { "content-type": "application/json", accept: "application/json", authorization: `Bearer ${TOKEN}` }, body: initBody });
    assert.equal(res.status, 200, await res.clone().text());
    const msg = parseRpc(await res.text());
    assert.equal(msg.id, 1);
    assert.ok(msg.result, JSON.stringify(msg));
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
});
