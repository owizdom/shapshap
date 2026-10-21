// Shared test helpers: fake Paystack, deterministic clock, catalogs.
import { PaystackUnavailable } from "../src/types.ts";
import type {
  Catalog, CheckoutMetadata, Deps, PaystackClient, PaystackTxn,
} from "../src/types.ts";

export const SECRET = "test-secret-not-real";
export const NOW = Date.parse("2026-10-21T12:00:00.000Z");
export const HOUR = 60 * 60 * 1000;

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

  setTxn(t: Partial<PaystackTxn> & { reference: string }): PaystackTxn {
    const full: PaystackTxn = {
      status: "success", amount_kobo: 0, paid_at: null, gateway_response: null, metadata: null, ...t,
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
      paid_at: null, gateway_response: null, metadata: input.metadata,
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
}

// Small hand-built catalog with exact, easy numbers.
export function tinyCatalog(): Catalog {
  return {
    prices: [
      { model: "Test Phone", capacity_gb: 128, base_ngn: 100000, floor_ngn: 20000 },
      { model: "Test Phone", capacity_gb: 256, base_ngn: 100005, floor_ngn: 20000 },
      { model: "Cheap Phone", capacity_gb: 64, base_ngn: 50000, floor_ngn: 12345 },
    ],
    faults: [
      { fault: "a", label: "Fault A", deduct_pct: 10 },
      { fault: "b", label: "Fault B", deduct_pct: 15 },
      { fault: "dead", label: "Dead", deduct_pct: 100 },
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

export function floorTo1000(n: number): number {
  return Math.floor(n / 1000) * 1000;
}

export interface TestCtx {
  deps: Deps;
  paystack: FakePaystack;
  clock: { now: number };
}

export function makeCtx(catalog: Catalog): TestCtx {
  const paystack = new FakePaystack();
  const clock = { now: NOW };
  const deps: Deps = { catalog, paystack, secret: SECRET, now: () => clock.now };
  return { deps, paystack, clock };
}
