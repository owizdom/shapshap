// Seam contract for the SharpSharp tool server (spec 0001 rev 3, section 4).
// Tests and implementation both import from here. Erasable TypeScript only.

// ---- Data rows (tool/data/*.csv) ----

export interface PriceRow { model: string; capacity_gb: number; base_ngn: number; floor_ngn: number }
export type FaultAction = "deduct" | "inspect" | "refuse";
export interface FaultRow {
  fault: string; label: string; category: string; action: FaultAction;
  deduct_pct: number; check_hint: string; basis: "sourced" | "policy";
}
export interface StockUnit {
  unit_id: string; model: string; capacity_gb: number; grade: string;
  battery_pct: number; warranty_months: number; price_ngn: number;
}
export interface Catalog { prices: PriceRow[]; faults: FaultRow[]; stock: StockUnit[] }

// ---- Valuation rules ----
// Fault actions (faults.csv): "refuse" = the shop cannot buy the phone (iCloud, MDM, blacklisted...): value_trade_in
//   returns FAULT_NOT_BOUGHT naming the fault, before any figure. "inspect" = cannot be judged in chat: its deduct_pct is a
//   provisional hold, applied like a deduction, and the fault is listed in inspect_faults. "deduct" = applied as is.
// MAX_DEDUCTION_PCT: the sum of deductions is capped at this share of base_ngn (shop policy); when the cap bites, an
//   adjustment {label: "Deductions capped at 70% of base", ngn: +<excess>} keeps the working adding up. The cap applies
//   before rounding and the floor.
// deduction ngn for a fault = Math.round(base_ngn * deduct_pct / 100)
// raw value = base_ngn - sum(deductions); duplicate faults count once
// value_ngn = max(floor_ngn, floor_to_1000(raw value))
// The working must add up exactly: value_ngn = base_ngn - sum(deductions.ngn) + sum(adjustments.ngn).
//   cap: see MAX_DEDUCTION_PCT above.
//   rounding: when floor_to_1000 removes naira, an adjustment {label: "Rounded down to the nearest 1,000", ngn: -<removed>}
//   floor: when the floor lifts the value, an adjustment {label: "Minimum we pay for this model", ngn: +<lift>}
//   (when the floor applies, there is no rounding adjustment; adjustments is [] when neither applies)
// Model matching: case-insensitive; collapse repeated spaces; "promax", "pro-max" and "pro max" all mean "Pro Max";
// a leading "apple " is dropped; a missing leading "iphone " is added ("13 promax" == "iPhone 13 Pro Max").
// The result always carries the canonical model name from the price file.
// a quote is valid for QUOTE_TTL_MS from issue

export const QUOTE_TTL_MS = 48 * 60 * 60 * 1000;
export const MAX_DEDUCTION_PCT = 70;

export interface Deduction { fault: string; label: string; ngn: number }
export interface Adjustment { label: string; ngn: number } // signed

export interface Valuation {
  quote_token: string; model: string; capacity_gb: number; base_ngn: number;
  deductions: Deduction[]; adjustments: Adjustment[]; value_ngn: number; valid_until: string; // ISO-8601
  inspect_faults: { fault: string; label: string }[]; // provisional, confirmed at the pickup inspection
}

// ---- Quote token ----
// format: base64url(JSON payload) + "." + base64url(HMAC-SHA256(secret, first part))
export interface QuotePayload {
  v: 1; model: string; capacity_gb: number; faults: string[]; // faults sorted, unique
  value_ngn: number; iat: number; exp: number; // epoch ms
}

// ---- Tool results ----

export type ToolError<C extends string> = { error: C; detail: string };

export type ValueTradeInResult = Valuation | ToolError<"MODEL_NOT_BOUGHT" | "CAPACITY_UNKNOWN" | "UNKNOWN_FAULT" | "FAULT_NOT_BOUGHT">;

export interface PhoneOption {
  unit_id: string; model: string; capacity_gb: number; grade: string;
  battery_pct: number; warranty_months: number; price_ngn: number; topup_ngn: number;
  offer_token: string; // price lock, see below
}
// Price lock: each option carries offer_token = base64url(JSON {v:1, unit_id, price_ngn, topup_ngn, quote_sig, exp})
// + "." + base64url(HMAC-SHA256(secret, "offer." + first part)). quote_sig is the signature part of the quote_token it
// was computed against; exp equals that quote's exp. create_checkout charges exactly topup_ngn from the offer, so a
// price the owner edits in the sheet after the customer saw the list never changes what they pay. The unit must still
// be in the current stock and unsold, otherwise UNIT_SOLD.
// options: units with price_ngn > value_ngn and topup_ngn <= max_topup_ngn,
// excluding units already sold. Ledger rule: among transactions with status "success", currency NGN,
// metadata present and amount_kobo === metadata.topup_ngn * 100, the earliest paid_at per unit_id
// (reference as tie-break) owns the unit. Wrong-amount payments never own a unit.
// sorted by topup_ngn ascending, ties by unit_id ascending, at most 3
export type FindPhonesResult = { options: PhoneOption[] } | ToolError<"QUOTE_INVALID" | "QUOTE_EXPIRED" | "PAYSTACK_UNAVAILABLE">;

export interface Checkout { reference: string; checkout_url: string; topup_ngn: number; unit_id: string }
// create_checkout refuses with FIND_MY_ON unless find_my_off is true: an activation-locked trade-in
// is worthless, so the check is enforced in code, not only in the prompt.
export type CreateCheckoutResult =
  | Checkout
  | ToolError<"QUOTE_INVALID" | "QUOTE_EXPIRED" | "OFFER_INVALID" | "OFFER_EXPIRED" | "FIND_MY_ON" | "UNIT_SOLD" | "NO_TOPUP_NEEDED" | "PAYSTACK_UNAVAILABLE">;
// OFFER_INVALID: bad signature, or the offer was made against a different quote_token. Check order: quote, offer,
// find_my_off, unit still in stock and unsold, then Paystack.

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
  currency: string; // "NGN"
  status: string; // Paystack data.status: "success" | "failed" | "abandoned" | "ongoing" | "pending" | "reversed" | ...
  amount_kobo: number;
  paid_at: string | null; // ISO-8601, null until paid
  gateway_response: string | null;
  metadata: CheckoutMetadata | null;
}

export interface PaystackClient {
  // POST /transaction/initialize
  initialize(input: { email: string; amount_kobo: number; reference: string; metadata: CheckoutMetadata }): Promise<{ authorization_url: string; reference: string }>;
  // GET /transaction/verify/:reference ; null ONLY when Paystack answers code "transaction_not_found"
  // (HTTP 400) or HTTP 404. Any other 4xx, a 5xx, a timeout, a network error, or a body that cannot be
  // read or parsed throws PaystackUnavailable.
  verify(reference: string): Promise<PaystackTxn | null>;
  // GET /transaction?status=success ; EVERY page (perPage=100, follow meta.pageCount), restricted to
  // transactions created on or after the client's `since` option when given (Paystack `from` param).
  // The same error rules as verify apply.
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

// ---- Owner price sheet (spec 0001 section 4b) ----
// The owner keeps prices in a Google Sheet with three tabs mirroring the CSVs (same headers). Each tab is read
// as CSV from its "publish to web" URL. Parsing is by header name, unknown columns are ignored, quoted cells
// are supported, and numbers may be typed as the owner writes them ("₦850,000", "850,000", " 850000 ").
// Numbers are whole naira: after stripping ₦, commas and spaces the cell must be digits only, optionally followed by
// ".00" or ".0" (Sheets currency formatting), so "₦815,000.00" is 815000, while "850.000" or "420,000.07" is rejected
// (row skipped, problem reported), never read as 850 or a fraction. Percent cells may end
// in "%". Plausible ranges: base_ngn and stock price_ngn 10,000..5,000,000; floor_ngn a multiple of 1,000.
// Faults: action must be exactly deduct, inspect or refuse (case-insensitive, trimmed); anything else or a missing
// action column skips the row with a problem. deduct_pct is optional on refuse rows (treated as 100).
// Stock: model non-empty and capacity_gb a positive integer. A stock tab with a header and zero rows is valid (sold
// out); prices and faults tabs need at least one valid row. Every tab must carry its key headers (prices: model,
// capacity_gb, base_ngn, floor_ngn; faults: fault, action; stock: unit_id, model, capacity_gb, price_ngn). A tab whose
// key headers are missing (e.g. an HTML sign-in page), or a stock tab with data rows of which none is valid, counts as a
// failed read (fallback), never as "sold out".
// Speed: the endpoint loads the catalog only for tools/call, not initialize or tools/list. A failed sheet read is
// remembered for cacheMs (no refetch on every request while the sheet is down), and a good read older than cacheMs
// is served immediately while a background refresh runs (stale-while-revalidate).
// Row checks: prices need a model, capacity_gb > 0, base_ngn > 0 and 0 <= floor_ngn <= base_ngn, first row wins
// on a duplicate model+capacity; faults need a key matching /^[a-z][a-z0-9_]*$/ and 0 <= deduct_pct <= 100;
// stock needs a unique unit_id, price_ngn > 0 and 0 <= battery_pct <= 100. A failing row is skipped and
// reported in `problems`; it never stops the rest loading.
// Fallback is all-or-nothing: if any tab cannot be fetched (timeout, network, non-2xx) or yields zero valid
// rows (stock excepted, see above), the whole catalog comes from the last good sheet read if there is one, else
// from the bundled CSVs,
// so prices never mix sources. A good read is cached for cacheMs.

export interface CatalogTexts { prices: string; faults: string; stock: string }
export interface SheetUrls { prices: string; faults: string; stock: string }
export interface LoadedCatalog { catalog: Catalog; source: "sheet" | "cached_sheet" | "bundled"; problems: string[] }

// ---- Module entry points the tests call (implemented in src/) ----
// src/catalog.ts   loadCatalog(dir: string): Catalog
//                  parseCatalog(texts: CatalogTexts): { catalog: Catalog; problems: string[] }   (loadCatalog uses it)
// src/sheet.ts     sheetCatalogLoader(urls: SheetUrls, opts?: { fetch?: typeof fetch; timeoutMs?: number /*3000*/;
//                    cacheMs?: number /*60000*/; now?: () => number; bundled?: () => Catalog }): () => Promise<LoadedCatalog>
//                  (api/mcp.ts uses it when PRICES_SHEET_PRICES_URL, PRICES_SHEET_FAULTS_URL and PRICES_SHEET_STOCK_URL
//                   are all set, logs source and problems with console.warn, and otherwise uses loadCatalog())
// src/quote.ts     signQuote(p: QuotePayload, secret: string): string
//                  readQuote(token: string, secret: string, now: number): QuotePayload | "QUOTE_INVALID" | "QUOTE_EXPIRED"
// src/tools.ts     valueTradeIn(deps, args: { model: string; capacity_gb: number; faults: string[] }): Promise<ValueTradeInResult>
//                  findPhones(deps, args: { quote_token: string; max_topup_ngn: number }): Promise<FindPhonesResult>
//                  createCheckout(deps, args: { quote_token: string; offer_token: string; find_my_off: boolean }): Promise<CreateCheckoutResult>
//                  confirmPayment(deps, args: { reference: string }): Promise<ConfirmPaymentResult>
//                  pickupCode(reference: string, secret: string): string
// src/paystack.ts  httpPaystack(secretKey: string, opts?: { timeoutMs?: number; fetch?: typeof fetch; since?: string }): PaystackClient
//                  (api/mcp.ts passes since = process.env.STOCK_EPOCH, an ISO date that resets the demo stock)
// src/server.ts    buildServer(deps: Deps): McpServer   (tools: value_trade_in, find_phones, create_checkout, confirm_payment)
// api/mcp.ts       default export (req, res): 401 unless "Authorization: Bearer <MCP_TOKEN>", else MCP Streamable HTTP, stateless
