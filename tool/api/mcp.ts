import { timingSafeEqual } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { loadCatalog } from "../src/catalog.ts";
import { httpPaystack } from "../src/paystack.ts";
import { buildServer } from "../src/server.ts";

function sameString(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

function send(res: any, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

async function readBody(req: any): Promise<unknown> {
  if (req.body !== undefined) {
    if (typeof req.body === "string") return req.body.length ? JSON.parse(req.body) : undefined;
    return req.body;
  }
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.from(c));
  const text = Buffer.concat(chunks).toString("utf8");
  return text.length ? JSON.parse(text) : undefined;
}

export default async function handler(req: any, res: any): Promise<void> {
  const token = process.env.MCP_TOKEN;
  if (!token) return send(res, 500, { error: "Server is not configured: MCP_TOKEN is missing." });
  const auth = String(req.headers?.authorization ?? "");
  if (!sameString(auth, "Bearer " + token)) return send(res, 401, { error: "Unauthorized" });

  const paystackKey = process.env.PAYSTACK_SECRET_KEY;
  const secret = process.env.QUOTE_SECRET;
  if (!paystackKey || !secret) {
    return send(res, 500, { error: "Server is not configured: PAYSTACK_SECRET_KEY and QUOTE_SECRET are required." });
  }

  let body: unknown;
  try {
    body = await readBody(req);
  } catch {
    return send(res, 400, { jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null });
  }

  try {
    const server = buildServer({ catalog: loadCatalog(), paystack: httpPaystack(paystackKey), secret, now: Date.now });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch {
    if (!res.headersSent) send(res, 500, { error: "Internal server error" });
  }
}
