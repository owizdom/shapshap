import { timingSafeEqual } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { loadCatalog } from "../src/catalog.ts";
import { sheetCatalogLoader } from "../src/sheet.ts";
import type { Catalog, SheetUrls } from "../src/types.ts";
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

// The SDK answers 406 unless Accept lists both types; add whichever is missing.
function fixAccept(req: any): void {
  if (req.method !== "POST") return;
  const cur = String(req.headers?.accept ?? "");
  const parts = [cur].filter((x) => x.trim().length > 0);
  if (!cur.includes("application/json")) parts.push("application/json");
  if (!cur.includes("text/event-stream")) parts.push("text/event-stream");
  const value = parts.join(", ");
  req.headers.accept = value;
  if (Array.isArray(req.rawHeaders)) {
    const i = req.rawHeaders.findIndex((h: string, k: number) => k % 2 === 0 && h.toLowerCase() === "accept");
    if (i >= 0) req.rawHeaders[i + 1] = value; else req.rawHeaders.push("accept", value);
  }
}

// Module level so the sheet cache survives across requests in a warm function.
let sheetLoader: { key: string; load: ReturnType<typeof sheetCatalogLoader> } | undefined;

async function getCatalog(): Promise<Catalog> {
  const prices = process.env.PRICES_SHEET_PRICES_URL, faults = process.env.PRICES_SHEET_FAULTS_URL, stock = process.env.PRICES_SHEET_STOCK_URL;
  if (!prices || !faults || !stock) return loadCatalog();
  try {
    const urls: SheetUrls = { prices, faults, stock };
    const key = JSON.stringify(urls);
    if (!sheetLoader || sheetLoader.key !== key) sheetLoader = { key, load: sheetCatalogLoader(urls) };
    const r = await sheetLoader.load();
    console.warn(`catalog source: ${r.source}`, ...(r.problems.length ? [r.problems] : []));
    return r.catalog;
  } catch (e) {
    console.warn("catalog sheet loader failed, using bundled prices", e instanceof Error ? e.message : String(e));
    return loadCatalog();
  }
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

  fixAccept(req);
  try {
    const server = buildServer({ catalog: await getCatalog(), paystack: httpPaystack(paystackKey, { since: process.env.STOCK_EPOCH || undefined }), secret, now: Date.now });
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
