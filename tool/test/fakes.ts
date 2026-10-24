// Shared test helpers: fake Paystack, deterministic clock, catalogs.
import { createHmac } from "node:crypto";
import { PaystackUnavailable } from "../src/types.ts";
import { findPhones } from "../src/tools.ts";
import { readQuote } from "../src/quote.ts";
import type {
  Catalog, CheckoutMetadata, Deps, PaystackClient, PaystackTxn,
} from "../src/types.ts";

export const SECRET = "test-secret-not-real";
export const NOW = Date.parse("2026-10-21T12:00:00.000Z");

export interface InitializeCall {
  email: string; amount_kobo: number; reference: string; metadata: CheckoutMetadata;
}

export class FakePaystack implements PaystackClient {
  txns = new Map<string, PaystackTxn>();
  initializeCalls: InitializeCall[] = [];
  verifyCalls: string[] = [];
  listCalls = 0;
  failInitialize = false;
  failVerify = false;
  failList = false;
  failListOpen = false;
  listOpenCalls: string[] = [];
  // the fake stamps created_at from this clock; makeCtx wires it to the test clock
  now: () => number = () => NOW;

  setTxn(t: Partial<PaystackTxn> & { reference: string }): PaystackTxn {
    const full: PaystackTxn = {
      currency: "NGN", status: "success", amount_kobo: 0, paid_at: null, created_at: null, gateway_response: null, metadata: null, ...t,
    };
    this.txns.set(full.reference, full);
    return full;
  }

  // Convenience: a successful payment for a unit at an exact time.
  paid(reference: string, unit_id: string, topup_ngn: number, paid_at: string, quote_token = "tok"): PaystackTxn {
    return this.setTxn({
      reference, status: "success", amount_kobo: topup_ngn * 100, paid_at,
      gateway_response: "Successful", metadata: { unit_id, topup_ngn, quote_token },
    });
  }

  async initialize(input: InitializeCall) {
    this.initializeCalls.push(input);
    if (this.failInitialize) throw new PaystackUnavailable("initialize down");
    this.setTxn({
      reference: input.reference, status: "abandoned", amount_kobo: input.amount_kobo,
      paid_at: null, created_at: new Date(this.now()).toISOString(), gateway_response: null, metadata: input.metadata,
    });
    return {
      authorization_url: `https://checkout.paystack.test/${input.reference}`,
      reference: input.reference,
    };
  }

  async verify(reference: string) {
    this.verifyCalls.push(reference);
    if (this.failVerify) throw new PaystackUnavailable("verify down");
    return this.txns.get(reference) ?? null;
  }

  async listSuccessful() {
    this.listCalls++;
    if (this.failList) throw new PaystackUnavailable("list down");
    return [...this.txns.values()].filter((t) => t.status === "success");
  }

  async listOpen(fromIso: string) {
    this.listOpenCalls.push(fromIso);
    if (this.failListOpen) throw new PaystackUnavailable("list open down");
    const from = Date.parse(fromIso);
    return [...this.txns.values()].filter((t) => !["success", "failed", "reversed"].includes(t.status) && t.created_at !== null && Date.parse(t.created_at) >= from);
  }
}

// Small hand-built catalog with exact, easy numbers.
export function tinyCatalog(): Catalog {
  return {
    prices: [
      { model: "Test Phone", capacity_gb: 128, base_ngn: 100000, floor_ngn: 20000, screen_repair_ngn: null, camera_repair_ngn: null },
      { model: "Test Phone", capacity_gb: 256, base_ngn: 100005, floor_ngn: 20000, screen_repair_ngn: null, camera_repair_ngn: null },
      { model: "Cheap Phone", capacity_gb: 64, base_ngn: 50000, floor_ngn: 18345, screen_repair_ngn: null, camera_repair_ngn: null },
      { model: "Odd Phone", capacity_gb: 64, base_ngn: 100500, floor_ngn: 10000, screen_repair_ngn: null, camera_repair_ngn: null },
    ],
    faults: [
      { fault: "a", label: "Fault A", category: "test", action: "deduct", deduct_pct: 10, check_hint: "", basis: "policy", repair: "" },
      { fault: "b", label: "Fault B", category: "test", action: "deduct", deduct_pct: 15, check_hint: "", basis: "policy", repair: "" },
      { fault: "dead", label: "Dead", category: "test", action: "deduct", deduct_pct: 70, check_hint: "", basis: "policy", repair: "" },
      { fault: "huge", label: "Huge", category: "test", action: "deduct", deduct_pct: 90, check_hint: "", basis: "policy", repair: "" },
      { fault: "insp", label: "Needs a look", category: "test", action: "inspect", deduct_pct: 20, check_hint: "", basis: "policy", repair: "" },
      { fault: "locked", label: "Locked", category: "test", action: "refuse", deduct_pct: 100, check_hint: "", basis: "policy", repair: "" },
    ],
    stock: [
      { unit_id: "T-1", model: "Test Phone", capacity_gb: 128, grade: "A", battery_pct: 90, warranty_months: 3, price_ngn: 90000 },
      { unit_id: "T-2", model: "Test Phone", capacity_gb: 128, grade: "B", battery_pct: 85, warranty_months: 3, price_ngn: 130000 },
      { unit_id: "T-3", model: "Test Phone", capacity_gb: 128, grade: "A", battery_pct: 95, warranty_months: 6, price_ngn: 150000 },
      { unit_id: "T-4", model: "Test Phone", capacity_gb: 128, grade: "A", battery_pct: 96, warranty_months: 6, price_ngn: 110000 },
      { unit_id: "T-5", model: "Test Phone", capacity_gb: 128, grade: "A", battery_pct: 97, warranty_months: 6, price_ngn: 120000 },
      { unit_id: "T-6", model: "Test Phone", capacity_gb: 128, grade: "A", battery_pct: 98, warranty_months: 6, price_ngn: 400000 },
      { unit_id: "T-7", model: "Test Phone", capacity_gb: 128, grade: "A", battery_pct: 99, warranty_months: 6, price_ngn: 100000 },
    ],
  };
}

// Spec 0002: with screen and body flawless the tiny catalog's base is the working value (multiplier 0.65 + 0.35 = 1).
// Spread into value_trade_in args wherever a test wants the hand-built numbers undisturbed by the default condition.
export const FLAWLESS = { screen: "flawless", body: "flawless" } as const;

export interface TestCtx {
  deps: Deps;
  paystack: FakePaystack;
  clock: { now: number };
}

export function makeCtx(catalog: Catalog): TestCtx {
  const paystack = new FakePaystack();
  const clock = { now: NOW };
  paystack.now = () => clock.now;
  const deps: Deps = { catalog, paystack, secret: SECRET, now: () => clock.now };
  return { deps, paystack, clock };
}

// ---- A fake Paystack HTTP API (for httpPaystack with an injected fetch) ----
// Serves GET /transaction?status=success with real pagination (newest first, like Paystack),
// GET /transaction/verify/:ref, and records every URL asked.
export interface ApiTxn {
  reference: string; status: string; amount: number; currency: string;
  paid_at: string | null; gateway_response: string | null; metadata: unknown; createdAt?: string;
}

export function apiTxn(reference: string, unit_id: string, topup_ngn: number, paid_at: string, over: Partial<ApiTxn> = {}): ApiTxn {
  return {
    reference, status: "success", amount: topup_ngn * 100, currency: "NGN", paid_at,
    gateway_response: "Successful", metadata: { unit_id, topup_ngn, quote_token: "tok" }, ...over,
  };
}

export function paginatedApi(all: ApiTxn[]) {
  const urls: string[] = [];
  const f = (async (input: any) => {
    const url = typeof input === "string" ? input : input.url ?? String(input);
    urls.push(url);
    const u = new URL(url);
    const j = (b: unknown, st = 200) => new Response(JSON.stringify(b), { status: st, headers: { "content-type": "application/json" } });
    if (u.pathname === "/transaction") {
      const perPage = Number(u.searchParams.get("perPage") ?? 50);
      const page = Number(u.searchParams.get("page") ?? 1);
      const ok = all.filter((t) => t.status === (u.searchParams.get("status") ?? t.status));
      const pageCount = Math.max(1, Math.ceil(ok.length / perPage));
      return j({ status: true, message: "Transactions retrieved", data: ok.slice((page - 1) * perPage, page * perPage), meta: { total: ok.length, page, pageCount, perPage } });
    }
    const m = u.pathname.match(/^\/transaction\/verify\/(.+)$/);
    if (m) {
      const t = all.find((x) => x.reference === decodeURIComponent(m[1]));
      return t ? j({ status: true, message: "Verification successful", data: t })
        : j({ status: false, message: "Transaction reference not found", code: "transaction_not_found" }, 400);
    }
    return j({ status: false, message: "unexpected " + url }, 500);
  }) as unknown as typeof fetch;
  return { f, urls };
}

// ---- Price lock helpers ----
export const b64u = (s: string) => Buffer.from(s, "utf8").toString("base64url");

// Signs an offer by hand, exactly as the contract in src/types.ts describes (prefix is overridable to test forgeries).
export function signOfferRaw(
  payload: { v: 1; unit_id: string; price_ngn: number; topup_ngn: number; quote_sig: string; exp: number },
  secret = SECRET, prefix = "offer.",
): string {
  const body = b64u(JSON.stringify(payload));
  return body + "." + createHmac("sha256", secret).update(prefix + body).digest("base64url");
}

// An offer for a unit the way a customer gets one: from find_phones. Throws if the unit is not offered.
export async function offerFor(ctx: TestCtx, quote_token: string, unit_id: string): Promise<string> {
  const q = readQuote(quote_token, ctx.deps.secret, ctx.deps.now());
  if (typeof q === "string") throw new Error("bad quote " + q);
  const unit = ctx.deps.catalog.stock.find((u) => u.unit_id === unit_id);
  if (!unit) throw new Error("no such unit " + unit_id);
  const r = await findPhones(ctx.deps, { quote_token, max_topup_ngn: Math.max(unit.price_ngn - q.value_ngn, 0) });
  if ("error" in r) throw new Error("find_phones: " + r.error);
  const o = r.options.find((x) => x.unit_id === unit_id);
  if (!o) throw new Error(`find_phones did not offer ${unit_id}`);
  return o.offer_token;
}
