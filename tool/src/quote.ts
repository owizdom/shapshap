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

export interface OfferPayload { v: 1; unit_id: string; price_ngn: number; topup_ngn: number; quote_sig: string; exp: number }

// The "offer." prefix keeps an offer signature from ever validating as a quote signature, and the reverse.
const offerMac = (body: string, secret: string) => mac("offer." + body, secret);

export function signOffer(p: OfferPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(p), "utf8").toString("base64url");
  return body + "." + offerMac(body, secret);
}

// quoteSig is the signature part of the quote_token the offer must belong to.
export function readOffer(token: string, secret: string, now: number, quoteSig: string): OfferPayload | "OFFER_INVALID" | "OFFER_EXPIRED" {
  if (typeof token !== "string") return "OFFER_INVALID";
  const parts = token.split(".");
  if (parts.length !== 2 || parts[0] === "" || parts[1] === "") return "OFFER_INVALID";
  const given = Buffer.from(parts[1], "utf8");
  const want = Buffer.from(offerMac(parts[0], secret), "utf8");
  if (given.length !== want.length || !timingSafeEqual(given, want)) return "OFFER_INVALID";
  let p: OfferPayload;
  try {
    p = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  } catch {
    return "OFFER_INVALID";
  }
  if (!p || typeof p !== "object" || p.v !== 1 || typeof p.unit_id !== "string" || typeof p.quote_sig !== "string"
    || !Number.isInteger(p.topup_ngn) || !Number.isInteger(p.price_ngn) || typeof p.exp !== "number") return "OFFER_INVALID";
  if (p.quote_sig !== quoteSig) return "OFFER_INVALID";
  if (now > p.exp) return "OFFER_EXPIRED";
  return p;
}
