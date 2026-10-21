// Seam contract for the SharpSharp tool server (spec 0001 rev 3, section 4).
// Tests and implementation both import from here. Erasable TypeScript only.

// ---- Data rows (tool/data/*.csv) ----

export interface PriceRow { model: string; capacity_gb: number; base_ngn: number; floor_ngn: number }
export interface FaultRow { fault: string; label: string; deduct_pct: number }
export interface StockUnit {
  unit_id: string; model: string; capacity_gb: number; grade: string;
  battery_pct: number; warranty_months: number; price_ngn: number;
}
export interface Catalog { prices: PriceRow[]; faults: FaultRow[]; stock: StockUnit[] }

// ---- Valuation rules ----
// deduction ngn for a fault = Math.round(base_ngn * deduct_pct / 100)
// raw value = base_ngn - sum(deductions); duplicate faults count once
// value_ngn = max(floor_ngn, floor_to_1000(raw value))
// model matching ignores case and surrounding spaces ("iphone 16 plus" == "iPhone 16 Plus")
// a quote is valid for QUOTE_TTL_MS from issue

export const QUOTE_TTL_MS = 48 * 60 * 60 * 1000;

export interface Deduction { fault: string; label: string; ngn: number }

export interface Valuation {
  quote_token: string; model: string; capacity_gb: number; base_ngn: number;
  deductions: Deduction[]; value_ngn: number; valid_until: string; // ISO-8601
}

// ---- Quote token ----
// format: base64url(JSON payload) + "." + base64url(HMAC-SHA256(secret, first part))
export interface QuotePayload {
  v: 1; model: string; capacity_gb: number; faults: string[]; // faults sorted, unique
  value_ngn: number; iat: number; exp: number; // epoch ms
}

// ---- Tool results ----

export type ToolError<C extends string> = { error: C; detail: string };

export type ValueTradeInResult = Valuation | ToolError<"MODEL_NOT_BOUGHT" | "CAPACITY_UNKNOWN" | "UNKNOWN_FAULT">;

export interface PhoneOption {
  unit_id: string; model: string; capacity_gb: number; grade: string;
  battery_pct: number; warranty_months: number; price_ngn: number; topup_ngn: number;
}
// options: units with price_ngn > value_ngn and topup_ngn <= max_topup_ngn,
// excluding units already sold (earliest successful Paystack payment for that unit_id),
// sorted by topup_ngn ascending, at most 3
export type FindPhonesResult = { options: PhoneOption[] } | ToolError<"QUOTE_INVALID" | "QUOTE_EXPIRED" | "PAYSTACK_UNAVAILABLE">;

export interface Checkout { reference: string; checkout_url: string; topup_ngn: number; unit_id: string }
export type CreateCheckoutResult =
  | Checkout
  | ToolError<"QUOTE_INVALID" | "QUOTE_EXPIRED" | "UNIT_UNKNOWN" | "UNIT_SOLD" | "NO_TOPUP_NEEDED" | "PAYSTACK_UNAVAILABLE">;

export type ConfirmPaymentResult =
  | { status: "reserved"; unit_id: string; topup_ngn: number; pickup_code: string } // pickup_code: 6 digits
  | { status: "declined"; reason: string }
  | { status: "waiting" }
  | { status: "sold_to_earlier_payer"; unit_id: string; refund_needed: true }
  | ToolError<"UNKNOWN_REFERENCE" | "AMOUNT_MISMATCH" | "PAYSTACK_UNAVAILABLE">;

// ---- Paystack boundary (injected so tests use a fake) ----
// Amounts at this boundary are in kobo (NGN * 100), as Paystack uses them.

export interface CheckoutMetadata { unit_id: string; topup_ngn: number; quote_token: string }

export interface PaystackTxn {
  reference: string;
  status: string; // Paystack data.status: "success" | "failed" | "abandoned" | "ongoing" | "pending" | "reversed" | ...
  amount_kobo: number;
  paid_at: string | null; // ISO-8601, null until paid
  gateway_response: string | null;
  metadata: CheckoutMetadata | null;
}

export interface PaystackClient {
  // POST /transaction/initialize
  initialize(input: { email: string; amount_kobo: number; reference: string; metadata: CheckoutMetadata }): Promise<{ authorization_url: string; reference: string }>;
  // GET /transaction/verify/:reference ; null when Paystack says the transaction does not exist
  verify(reference: string): Promise<PaystackTxn | null>;
  // GET /transaction?status=success ; recent successful transactions, used as the ledger of sold units
  listSuccessful(): Promise<PaystackTxn[]>;
}

// Thrown by a PaystackClient on timeout, network failure or HTTP 5xx.
export class PaystackUnavailable extends Error {}

// ---- Tool server dependencies ----
export interface Deps {
  catalog: Catalog;
  paystack: PaystackClient;
  secret: string; // signs quote tokens and pickup codes
  now: () => number; // epoch ms
}

// ---- Module entry points the tests call (implemented in src/) ----
// src/catalog.ts   loadCatalog(dir: string): Catalog
// src/quote.ts     signQuote(p: QuotePayload, secret: string): string
//                  readQuote(token: string, secret: string, now: number): QuotePayload | "QUOTE_INVALID" | "QUOTE_EXPIRED"
// src/tools.ts     valueTradeIn(deps, args: { model: string; capacity_gb: number; faults: string[] }): Promise<ValueTradeInResult>
//                  findPhones(deps, args: { quote_token: string; max_topup_ngn: number }): Promise<FindPhonesResult>
//                  createCheckout(deps, args: { quote_token: string; unit_id: string }): Promise<CreateCheckoutResult>
//                  confirmPayment(deps, args: { reference: string }): Promise<ConfirmPaymentResult>
//                  pickupCode(reference: string, secret: string): string
// src/paystack.ts  httpPaystack(secretKey: string, opts?: { timeoutMs?: number; fetch?: typeof fetch }): PaystackClient
// src/server.ts    buildServer(deps: Deps): McpServer   (tools: value_trade_in, find_phones, create_checkout, confirm_payment)
// api/mcp.ts       default export (req, res): 401 unless "Authorization: Bearer <MCP_TOKEN>", else MCP Streamable HTTP, stateless
