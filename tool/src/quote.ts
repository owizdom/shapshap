import { createHmac, timingSafeEqual } from "node:crypto";
import type { QuotePayload } from "./types.ts";

function mac(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

export function signQuote(p: QuotePayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(p), "utf8").toString("base64url");
  return body + "." + mac(body, secret);
}

export function readQuote(token: string, secret: string, now: number): QuotePayload | "QUOTE_INVALID" | "QUOTE_EXPIRED" {
  if (typeof token !== "string") return "QUOTE_INVALID";
  const parts = token.split(".");
  if (parts.length !== 2 || parts[0] === "" || parts[1] === "") return "QUOTE_INVALID";
  const given = Buffer.from(parts[1], "utf8");
  const want = Buffer.from(mac(parts[0], secret), "utf8");
  if (given.length !== want.length || !timingSafeEqual(given, want)) return "QUOTE_INVALID";
  let p: QuotePayload;
  try {
    p = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  } catch {
    return "QUOTE_INVALID";
  }
  if (!p || typeof p !== "object" || p.v !== 1 || typeof p.exp !== "number" || typeof p.value_ngn !== "number") return "QUOTE_INVALID";
  if (now > p.exp) return "QUOTE_EXPIRED";
  return p;
}
