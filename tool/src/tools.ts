import { createHmac, randomBytes } from "node:crypto";
import { signQuote, readQuote } from "./quote.ts";
import { MAX_DEDUCTION_PCT, PaystackUnavailable, QUOTE_TTL_MS } from "./types.ts";
import type {
  Adjustment, ConfirmPaymentResult, CreateCheckoutResult, Deps, FindPhonesResult, PaystackTxn, PhoneOption, ValueTradeInResult,
} from "./types.ts";

const norm = (s: string) => s.trim().toLowerCase();

// "13 promax" / "Apple iPhone 13 Pro-Max" -> "iphone 13 pro max"
function normModel(s: string): string {
  let m = s.toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  m = m.replace(/\bpro\s?max\b/g, "pro max");
  m = m.replace(/^apple\s+/, "");
  if (!m.startsWith("iphone ")) m = `iphone ${m}`;
  return m;
}

function randomId(n: number): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = randomBytes(n);
  let out = "";
  for (let i = 0; i < n; i++) out += chars[bytes[i] % chars.length];
  return out;
}

export function pickupCode(reference: string, secret: string): string {
  const h = createHmac("sha256", secret).update(reference).digest();
  return String(h.readUInt32BE(0) % 1_000_000).padStart(6, "0");
}

export async function valueTradeIn(
  deps: Deps, args: { model: string; capacity_gb: number; faults: string[] },
): Promise<ValueTradeInResult> {
  const { catalog } = deps;
  const m = normModel(args.model);
  const models = catalog.prices.filter((p) => normModel(p.model) === m);
  if (models.length === 0) return { error: "MODEL_NOT_BOUGHT", detail: `We do not buy "${args.model.trim()}". Tell the customer plainly that we cannot value this model.` };
  const row = models.find((p) => p.capacity_gb === args.capacity_gb);
  if (!row) {
    const caps = models.map((p) => p.capacity_gb).sort((a, b) => a - b).join(", ");
    return { error: "CAPACITY_UNKNOWN", detail: `No ${models[0].model} price for ${args.capacity_gb} GB. Known capacities: ${caps} GB. Ask the customer which of these they have.` };
  }
  const unique = [...new Set(args.faults)].sort();
  const deductions = [];
  const inspect_faults = [];
  for (const id of unique) {
    const f = catalog.faults.find((x) => x.fault === id);
    if (!f) return { error: "UNKNOWN_FAULT", detail: `Unknown fault "${id}". Use only the fault ids from the shop list, or leave faults empty.` };
    if (f.action === "refuse") return { error: "FAULT_NOT_BOUGHT", detail: `We cannot buy a phone with this fault: ${f.label} (${f.fault}). Tell the customer plainly; do not give a figure.` };
  }
  for (const id of unique) {
    const f = catalog.faults.find((x) => x.fault === id)!;
    deductions.push({ fault: f.fault, label: f.label, ngn: Math.round((row.base_ngn * f.deduct_pct) / 100) });
    if (f.action === "inspect") inspect_faults.push({ fault: f.fault, label: f.label });
  }
  const adjustments: Adjustment[] = [];
  let total = deductions.reduce((s, d) => s + d.ngn, 0);
  const capLimit = Math.round((row.base_ngn * MAX_DEDUCTION_PCT) / 100);
  if (total > capLimit) {
    adjustments.push({ label: `Deductions capped at ${MAX_DEDUCTION_PCT}% of base`, ngn: total - capLimit });
    total = capLimit;
  }
  const raw = row.base_ngn - total;
  const rounded = Math.floor(raw / 1000) * 1000;
  let value_ngn = rounded;
  if (rounded < row.floor_ngn) {
    value_ngn = row.floor_ngn;
    adjustments.push({ label: "Minimum we pay for this model", ngn: row.floor_ngn - raw });
  } else if (rounded < raw) {
    adjustments.push({ label: "Rounded down to the nearest 1,000", ngn: rounded - raw });
  }
  const iat = deps.now();
  const exp = iat + QUOTE_TTL_MS;
  const quote_token = signQuote(
    { v: 1, model: row.model, capacity_gb: row.capacity_gb, faults: unique, value_ngn, iat, exp }, deps.secret,
  );
  return {
    quote_token, model: row.model, capacity_gb: row.capacity_gb, base_ngn: row.base_ngn,
    deductions, adjustments, value_ngn, valid_until: new Date(exp).toISOString(), inspect_faults,
  };
}

// unit_id -> winning transaction (earliest paid_at; reference breaks ties)
function buildLedger(txns: PaystackTxn[]): Map<string, PaystackTxn> {
  const winners = new Map<string, PaystackTxn>();
  for (const t of txns) {
    if (t.status !== "success" || t.currency !== "NGN" || !t.metadata) continue;
    if (t.amount_kobo !== t.metadata.topup_ngn * 100) continue;
    const cur = winners.get(t.metadata.unit_id);
    if (!cur || earlier(t, cur)) winners.set(t.metadata.unit_id, t);
  }
  return winners;
}

function earlier(a: PaystackTxn, b: PaystackTxn): boolean {
  const ta = a.paid_at ? Date.parse(a.paid_at) : Infinity;
  const tb = b.paid_at ? Date.parse(b.paid_at) : Infinity;
  if (ta !== tb) return ta < tb;
  return a.reference < b.reference;
}

const unavailable = (e: unknown) => ({
  error: "PAYSTACK_UNAVAILABLE" as const,
  detail: "Payments are temporarily unavailable. Tell the customer to wait a moment, then call this tool again.",
});

export async function findPhones(
  deps: Deps, args: { quote_token: string; max_topup_ngn: number },
): Promise<FindPhonesResult> {
  const q = readQuote(args.quote_token, deps.secret, deps.now());
  if (typeof q === "string") return { error: q, detail: q === "QUOTE_EXPIRED" ? "The quote has expired. Value the phone again with value_trade_in." : "The quote token is not valid. Value the phone again with value_trade_in." };
  let ledger: Map<string, PaystackTxn>;
  try {
    ledger = buildLedger(await deps.paystack.listSuccessful());
  } catch (e) {
    if (e instanceof PaystackUnavailable) return unavailable(e);
    throw e;
  }
  const options: PhoneOption[] = deps.catalog.stock
    .filter((u) => u.price_ngn > q.value_ngn && u.price_ngn - q.value_ngn <= args.max_topup_ngn && !ledger.has(u.unit_id))
    .map((u) => ({ ...u, topup_ngn: u.price_ngn - q.value_ngn }))
    .sort((a, b) => a.topup_ngn - b.topup_ngn || (a.unit_id < b.unit_id ? -1 : a.unit_id > b.unit_id ? 1 : 0))
    .slice(0, 3);
  return { options };
}

export async function createCheckout(
  deps: Deps, args: { quote_token: string; unit_id: string; find_my_off: boolean },
): Promise<CreateCheckoutResult> {
  const q = readQuote(args.quote_token, deps.secret, deps.now());
  if (typeof q === "string") return { error: q, detail: q === "QUOTE_EXPIRED" ? "The quote has expired. Value the phone again with value_trade_in." : "The quote token is not valid. Value the phone again with value_trade_in." };
  if (args.find_my_off !== true) {
    return { error: "FIND_MY_ON", detail: "Find My must be off on the trade-in phone. Ask the customer to turn it off and confirm, then call create_checkout again." };
  }
  const unit = deps.catalog.stock.find((u) => u.unit_id === args.unit_id);
  if (!unit) return { error: "UNIT_UNKNOWN", detail: `No unit "${args.unit_id}" in stock. Use a unit_id returned by find_phones.` };
  const topup_ngn = unit.price_ngn - q.value_ngn;
  if (topup_ngn <= 0) return { error: "NO_TOPUP_NEEDED", detail: "The trade-in value covers this phone, so no payment is needed. Tell the customer; do not create a checkout." };
  try {
    const ledger = buildLedger(await deps.paystack.listSuccessful());
    if (ledger.has(unit.unit_id)) return { error: "UNIT_SOLD", detail: `Unit ${unit.unit_id} has already been sold. Call find_phones again and offer another phone.` };
    const reference = `ss-${unit.unit_id.toLowerCase()}-${randomId(12)}`;
    const metadata = { unit_id: unit.unit_id, topup_ngn, quote_token: args.quote_token };
    const r = await deps.paystack.initialize({
      email: `buyer-${randomId(10)}@example.com`, amount_kobo: topup_ngn * 100, reference, metadata,
    });
    return { reference, checkout_url: r.authorization_url, topup_ngn, unit_id: unit.unit_id };
  } catch (e) {
    if (e instanceof PaystackUnavailable) return unavailable(e);
    throw e;
  }
}

export async function confirmPayment(deps: Deps, args: { reference: string }): Promise<ConfirmPaymentResult> {
  try {
    const t = await deps.paystack.verify(args.reference);
    if (!t) return { error: "UNKNOWN_REFERENCE", detail: `No transaction with reference "${args.reference}". Check the reference from create_checkout and try again.` };
    if (t.status === "failed" || t.status === "reversed") {
      return { status: "declined", reason: t.gateway_response ?? t.status };
    }
    if (t.status !== "success") return { status: "waiting" };
    const meta = t.metadata;
    if (!meta || t.amount_kobo !== meta.topup_ngn * 100) {
      return { error: "AMOUNT_MISMATCH", detail: "The amount paid does not match the top-up for this checkout. Do not reserve the phone; ask the customer to contact the shop." };
    }
    const ledger = buildLedger([...(await deps.paystack.listSuccessful()), t]);
    const winner = ledger.get(meta.unit_id);
    if (winner && winner.reference !== t.reference) {
      return { status: "sold_to_earlier_payer", unit_id: meta.unit_id, refund_needed: true };
    }
    return { status: "reserved", unit_id: meta.unit_id, topup_ngn: meta.topup_ngn, pickup_code: pickupCode(t.reference, deps.secret) };
  } catch (e) {
    if (e instanceof PaystackUnavailable) return unavailable(e);
    throw e;
  }
}
