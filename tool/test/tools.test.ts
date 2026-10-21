// B4 to B10: find_phones, create_checkout, confirm_payment.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { loadCatalog } from "../src/catalog.ts";
import { valueTradeIn, findPhones, createCheckout, confirmPayment, pickupCode } from "../src/tools.ts";
import { readQuote } from "../src/quote.ts";
import type { Catalog, Valuation, PhoneOption, Checkout } from "../src/types.ts";
import { NOW, SECRET, makeCtx, tinyCatalog, paginatedApi, apiTxn } from "./fakes.ts";
import { httpPaystack } from "../src/paystack.ts";
import type { TestCtx } from "./fakes.ts";

const real = loadCatalog(fileURLToPath(new URL("../data", import.meta.url)));

async function quoteFor(ctx: TestCtx, model: string, capacity_gb: number, faults: string[]): Promise<Valuation> {
  const r = await valueTradeIn(ctx.deps, { model, capacity_gb, faults });
  assert.ok(!("error" in r), `valuation failed: ${JSON.stringify(r)}`);
  return r as Valuation;
}

function options(r: Awaited<ReturnType<typeof findPhones>>): PhoneOption[] {
  assert.ok(!("error" in r), `find_phones failed: ${JSON.stringify(r)}`);
  return (r as { options: PhoneOption[] }).options;
}

function checkout(r: Awaited<ReturnType<typeof createCheckout>>): Checkout {
  assert.ok(!("error" in r), `create_checkout failed: ${JSON.stringify(r)}`);
  return r as Checkout;
}

// Tiny catalog, no faults on Test Phone 128: value_ngn is 100000.
async function tinyQuote(cat: Catalog = tinyCatalog()) {
  const ctx = makeCtx(cat);
  const v = await quoteFor(ctx, "Test Phone", 128, []);
  assert.equal(v.value_ngn, 100000);
  return { ctx, token: v.quote_token };
}

describe("B4 find_phones", () => {
  test("real data, worked case, max top-up 150000: SS-1401, SS-1311, SS-1321 in that order", async () => {
    const ctx = makeCtx(real);
    const v = await quoteFor(ctx, "iPhone 16 Plus", 256, ["no_charge"]);
    assert.equal(v.value_ngn, 513000);
    const opts = options(await findPhones(ctx.deps, { quote_token: v.quote_token, max_topup_ngn: 150000 }));
    assert.deepEqual(opts.map((o) => o.unit_id), ["SS-1401", "SS-1403", "SS-1311"]);
    assert.deepEqual(opts.map((o) => o.topup_ngn), [7000, 17000, 27000]);
    assert.deepEqual(opts.map((o) => o.price_ngn), [520000, 530000, 540000]);
    const first = opts[0];
    assert.deepEqual(
      { model: first.model, capacity_gb: first.capacity_gb, grade: first.grade, battery_pct: first.battery_pct, warranty_months: first.warranty_months },
      { model: "iPhone 14", capacity_gb: 128, grade: "A", battery_pct: 92, warranty_months: 6 },
    );
  });

  test("only units dearer than the value and within max_topup_ngn", async () => {
    const { ctx, token } = await tinyQuote();
    const opts = options(await findPhones(ctx.deps, { quote_token: token, max_topup_ngn: 25000 }));
    assert.deepEqual(opts.map((o) => o.unit_id), ["T-4", "T-5"]);
    for (const o of opts) {
      assert.ok(o.price_ngn > 100000, "dearer than the value");
      assert.ok(o.topup_ngn <= 25000, "within budget");
      assert.equal(o.topup_ngn, o.price_ngn - 100000);
    }
  });

  test("a unit priced exactly at the value is not offered; a top-up exactly at the budget is", async () => {
    const { ctx, token } = await tinyQuote();
    const opts = options(await findPhones(ctx.deps, { quote_token: token, max_topup_ngn: 30000 }));
    const ids = opts.map((o) => o.unit_id);
    assert.ok(!ids.includes("T-7"), "price == value excluded");
    assert.ok(!ids.includes("T-1"), "cheaper than value excluded");
    assert.ok(ids.includes("T-2"), "top-up == budget included (T-2 is 130000, top-up 30000)");
  });

  test("at most three, ascending top-up", async () => {
    const { ctx, token } = await tinyQuote();
    const opts = options(await findPhones(ctx.deps, { quote_token: token, max_topup_ngn: 60000 }));
    assert.equal(opts.length, 3);
    assert.deepEqual(opts.map((o) => o.unit_id), ["T-4", "T-5", "T-2"]);
    const ups = opts.map((o) => o.topup_ngn);
    assert.deepEqual(ups, [...ups].sort((a, b) => a - b));
  });

  test("nothing fits gives an empty list, not an error", async () => {
    const { ctx, token } = await tinyQuote();
    const r = await findPhones(ctx.deps, { quote_token: token, max_topup_ngn: 5000 });
    assert.deepEqual(options(r), []);
  });

  test("excludes units with a successful Paystack payment", async () => {
    const { ctx, token } = await tinyQuote();
    ctx.paystack.paid("ref-sold", "T-4", 10000, "2026-10-21T10:00:00.000Z");
    const opts = options(await findPhones(ctx.deps, { quote_token: token, max_topup_ngn: 60000 }));
    assert.deepEqual(opts.map((o) => o.unit_id), ["T-5", "T-2", "T-3"]);
  });

  test("an abandoned or failed payment does not hide a unit", async () => {
    const { ctx, token } = await tinyQuote();
    ctx.paystack.setTxn({ reference: "r1", status: "abandoned", amount_kobo: 1000000, metadata: { unit_id: "T-4", topup_ngn: 10000, quote_token: "x" } });
    ctx.paystack.setTxn({ reference: "r2", status: "failed", amount_kobo: 1000000, metadata: { unit_id: "T-5", topup_ngn: 20000, quote_token: "x" } });
    const opts = options(await findPhones(ctx.deps, { quote_token: token, max_topup_ngn: 60000 }));
    assert.deepEqual(opts.map((o) => o.unit_id), ["T-4", "T-5", "T-2"]);
  });

  test("Paystack down while reading the ledger is PAYSTACK_UNAVAILABLE style failure, never a stale list", async () => {
    const { ctx, token } = await tinyQuote();
    ctx.paystack.failList = true;
    const r = await findPhones(ctx.deps, { quote_token: token, max_topup_ngn: 60000 });
    assert.ok("error" in r, "must not return options when the sold ledger cannot be read");
    assert.equal(r.error, "PAYSTACK_UNAVAILABLE");
  });
});

describe("B5 create_checkout: server-side amount", () => {
  test("initializes Paystack with (price - value) * 100 kobo and the metadata", async () => {
    const { ctx, token } = await tinyQuote();
    const c = checkout(await createCheckout(ctx.deps, { quote_token: token, unit_id: "T-2", find_my_off: true }));
    assert.equal(c.unit_id, "T-2");
    assert.equal(c.topup_ngn, 30000);
    assert.equal(ctx.paystack.initializeCalls.length, 1);
    const call = ctx.paystack.initializeCalls[0];
    assert.equal(call.amount_kobo, 3000000);
    assert.deepEqual(call.metadata, { unit_id: "T-2", topup_ngn: 30000, quote_token: token });
    assert.equal(call.reference, c.reference);
    assert.match(call.email, /@example\.com$/);
    assert.equal(typeof c.reference, "string");
    assert.ok(c.reference.length > 0);
    assert.equal(c.checkout_url, `https://checkout.paystack.test/${c.reference}`);
  });

  test("real data worked case: SS-1401 top-up is 7000 so 700000 kobo", async () => {
    const ctx = makeCtx(real);
    const v = await quoteFor(ctx, "iPhone 16 Plus", 256, ["no_charge"]);
    const c = checkout(await createCheckout(ctx.deps, { quote_token: v.quote_token, unit_id: "SS-1401", find_my_off: true }));
    assert.equal(c.topup_ngn, 7000);
    assert.equal(ctx.paystack.initializeCalls[0].amount_kobo, 700000);
  });

  test("two checkouts get distinct references", async () => {
    const { ctx, token } = await tinyQuote();
    const a = checkout(await createCheckout(ctx.deps, { quote_token: token, unit_id: "T-2", find_my_off: true }));
    const b = checkout(await createCheckout(ctx.deps, { quote_token: token, unit_id: "T-2", find_my_off: true }));
    assert.notEqual(a.reference, b.reference);
  });

  test("NO_TOPUP_NEEDED when price <= value (equal and lower)", async () => {
    const { ctx, token } = await tinyQuote();
    for (const unit_id of ["T-7", "T-1"]) {
      const r = await createCheckout(ctx.deps, { quote_token: token, unit_id, find_my_off: true });
      assert.equal("error" in r && r.error, "NO_TOPUP_NEEDED", unit_id);
    }
    assert.equal(ctx.paystack.initializeCalls.length, 0);
  });

  test("UNIT_UNKNOWN for an id not in stock", async () => {
    const { ctx, token } = await tinyQuote();
    const r = await createCheckout(ctx.deps, { quote_token: token, unit_id: "NOPE-1", find_my_off: true });
    assert.equal("error" in r && r.error, "UNIT_UNKNOWN");
    assert.equal(ctx.paystack.initializeCalls.length, 0);
  });

  test("UNIT_SOLD when a successful payment already exists for the unit", async () => {
    const { ctx, token } = await tinyQuote();
    ctx.paystack.paid("ref-other", "T-2", 30000, "2026-10-21T10:00:00.000Z");
    const r = await createCheckout(ctx.deps, { quote_token: token, unit_id: "T-2", find_my_off: true });
    assert.equal("error" in r && r.error, "UNIT_SOLD");
    assert.equal(ctx.paystack.initializeCalls.length, 0);
  });

  test("PAYSTACK_UNAVAILABLE when initialize throws PaystackUnavailable", async () => {
    const { ctx, token } = await tinyQuote();
    ctx.paystack.failInitialize = true;
    const r = await createCheckout(ctx.deps, { quote_token: token, unit_id: "T-2", find_my_off: true });
    assert.equal("error" in r && r.error, "PAYSTACK_UNAVAILABLE");
  });

  test("PAYSTACK_UNAVAILABLE when the sold ledger cannot be read", async () => {
    const { ctx, token } = await tinyQuote();
    ctx.paystack.failList = true;
    const r = await createCheckout(ctx.deps, { quote_token: token, unit_id: "T-2", find_my_off: true });
    assert.equal("error" in r && r.error, "PAYSTACK_UNAVAILABLE");
    assert.equal(ctx.paystack.initializeCalls.length, 0);
  });
});

describe("B6 B7 B8 confirm_payment", () => {
  const T = "2026-10-21T11:00:00.000Z";

  async function pending() {
    const { ctx, token } = await tinyQuote();
    const c = checkout(await createCheckout(ctx.deps, { quote_token: token, unit_id: "T-2", find_my_off: true }));
    return { ctx, token, ref: c.reference };
  }

  test("B6 success with matching amount is reserved with a 6-digit code derived from the reference", async () => {
    const { ctx, token, ref } = await pending();
    ctx.paystack.paid(ref, "T-2", 30000, T, token);
    const r = await confirmPayment(ctx.deps, { reference: ref });
    assert.ok("status" in r && r.status === "reserved", JSON.stringify(r));
    assert.equal(r.unit_id, "T-2");
    assert.equal(r.topup_ngn, 30000);
    assert.match(r.pickup_code, /^\d{6}$/);
    assert.equal(r.pickup_code, pickupCode(ref, SECRET));
  });

  test("pickupCode is deterministic, 6 digits, and depends on the reference and the secret", () => {
    const a = pickupCode("ref-1", SECRET);
    assert.match(a, /^\d{6}$/);
    assert.equal(pickupCode("ref-1", SECRET), a);
    const others = new Set([pickupCode("ref-2", SECRET), pickupCode("ref-3", SECRET), pickupCode("ref-4", SECRET), pickupCode("ref-1", "other-secret"), pickupCode("ref-1", "other-secret-2")]);
    assert.ok([...others].some((c) => c !== a), "codes must vary with reference or secret");
    assert.ok(others.size > 1);
  });

  test("B7 failed is declined with the gateway_response as reason", async () => {
    const { ctx, token, ref } = await pending();
    ctx.paystack.setTxn({ reference: ref, status: "failed", amount_kobo: 3000000, paid_at: null, gateway_response: "Insufficient Funds", metadata: { unit_id: "T-2", topup_ngn: 30000, quote_token: token } });
    const r = await confirmPayment(ctx.deps, { reference: ref });
    assert.deepEqual(r, { status: "declined", reason: "Insufficient Funds" });
  });

  for (const status of ["abandoned", "ongoing", "pending"]) {
    test(`B8 ${status} is waiting and holds nothing`, async () => {
      const { ctx, token, ref } = await pending();
      ctx.paystack.setTxn({ reference: ref, status, amount_kobo: 3000000, paid_at: null, gateway_response: null, metadata: { unit_id: "T-2", topup_ngn: 30000, quote_token: token } });
      const r = await confirmPayment(ctx.deps, { reference: ref });
      assert.deepEqual(r, { status: "waiting" });
    });
  }

  test("a freshly created checkout (abandoned in Paystack) is waiting", async () => {
    const { ctx, ref } = await pending();
    assert.deepEqual(await confirmPayment(ctx.deps, { reference: ref }), { status: "waiting" });
  });

  test("amount mismatch is AMOUNT_MISMATCH, never reserved", async () => {
    const { ctx, token, ref } = await pending();
    ctx.paystack.setTxn({ reference: ref, status: "success", amount_kobo: 1000000, paid_at: T, gateway_response: "Successful", metadata: { unit_id: "T-2", topup_ngn: 30000, quote_token: token } });
    const r = await confirmPayment(ctx.deps, { reference: ref });
    assert.ok("error" in r);
    assert.equal(r.error, "AMOUNT_MISMATCH");
    assert.ok(!("pickup_code" in r));
  });

  test("verify returning null is UNKNOWN_REFERENCE", async () => {
    const { ctx } = await pending();
    const r = await confirmPayment(ctx.deps, { reference: "does-not-exist" });
    assert.ok("error" in r);
    assert.equal(r.error, "UNKNOWN_REFERENCE");
  });
});

describe("B9 no double sale", () => {
  test("two successful payments for one unit: earlier paid_at is reserved, later is sold_to_earlier_payer", async () => {
    const { ctx } = await tinyQuote();
    ctx.paystack.paid("ref-early", "T-2", 30000, "2026-10-21T10:00:00.000Z");
    ctx.paystack.paid("ref-late", "T-2", 30000, "2026-10-21T10:00:05.000Z");
    const early = await confirmPayment(ctx.deps, { reference: "ref-early" });
    assert.ok("status" in early && early.status === "reserved", JSON.stringify(early));
    assert.equal(early.pickup_code, pickupCode("ref-early", SECRET));
    const late = await confirmPayment(ctx.deps, { reference: "ref-late" });
    assert.deepEqual(late, { status: "sold_to_earlier_payer", unit_id: "T-2", refund_needed: true });
  });

  test("order of insertion into the ledger does not matter, paid_at does", async () => {
    const { ctx } = await tinyQuote();
    ctx.paystack.paid("ref-late", "T-2", 30000, "2026-10-21T10:00:05.000Z");
    ctx.paystack.paid("ref-early", "T-2", 30000, "2026-10-21T10:00:00.000Z");
    const late = await confirmPayment(ctx.deps, { reference: "ref-late" });
    assert.ok("status" in late && late.status === "sold_to_earlier_payer");
    const early = await confirmPayment(ctx.deps, { reference: "ref-early" });
    assert.ok("status" in early && early.status === "reserved");
  });

  test("payments for different units do not collide", async () => {
    const { ctx } = await tinyQuote();
    ctx.paystack.paid("ref-a", "T-2", 30000, "2026-10-21T10:00:00.000Z");
    ctx.paystack.paid("ref-b", "T-3", 50000, "2026-10-21T10:00:05.000Z");
    const b = await confirmPayment(ctx.deps, { reference: "ref-b" });
    assert.ok("status" in b && b.status === "reserved");
  });
});

describe("B10 Paystack down", () => {
  test("verify throwing PaystackUnavailable is PAYSTACK_UNAVAILABLE", async () => {
    const { ctx } = await tinyQuote();
    ctx.paystack.paid("ref-1", "T-2", 30000, "2026-10-21T10:00:00.000Z");
    ctx.paystack.failVerify = true;
    const r = await confirmPayment(ctx.deps, { reference: "ref-1" });
    assert.ok("error" in r, JSON.stringify(r));
    assert.equal(r.error, "PAYSTACK_UNAVAILABLE");
    assert.ok(!("status" in r));
  });

  test("list throwing PaystackUnavailable after a successful verify is PAYSTACK_UNAVAILABLE, not reserved", async () => {
    const { ctx } = await tinyQuote();
    ctx.paystack.paid("ref-1", "T-2", 30000, "2026-10-21T10:00:00.000Z");
    ctx.paystack.failList = true;
    const r = await confirmPayment(ctx.deps, { reference: "ref-1" });
    assert.ok("error" in r, JSON.stringify(r));
    assert.equal(r.error, "PAYSTACK_UNAVAILABLE");
  });
});

describe("integration: the clock is injected", () => {
  test("a token issued at NOW is readable at NOW", async () => {
    const { token } = await tinyQuote();
    const p = readQuote(token, SECRET, NOW);
    assert.ok(typeof p === "object");
    assert.equal(p.iat, NOW);
  });
});

// ---- Fix round 1 ----

describe("F1 ledger: every page, correct-amount NGN only", () => {
  // 120 unrelated successes pad the list; the earliest payment for T-2 sits on the LAST page
  // because Paystack lists newest first.
  function crowdedLedger() {
    const all = [];
    for (let i = 0; i < 120; i++) {
      const t = new Date(Date.parse("2026-10-21T11:00:00.000Z") + i * 1000).toISOString();
      all.push(apiTxn(`pad-${i}`, `OTHER-${i}`, 1000, t));
    }
    all.reverse(); // newest first
    all.push(apiTxn("ref-first", "T-2", 30000, "2026-10-21T09:00:00.000Z")); // oldest, last page
    return all;
  }

  async function withApi(all: ReturnType<typeof crowdedLedger>) {
    const { ctx, token } = await tinyQuote();
    const api = paginatedApi(all);
    ctx.deps.paystack = httpPaystack("sk_test_x", { fetch: api.f });
    return { ctx, token, api };
  }

  test("find_phones excludes a unit whose only payment is on page 2 of 2+", async () => {
    const { ctx, token, api } = await withApi(crowdedLedger());
    const opts = options(await findPhones(ctx.deps, { quote_token: token, max_topup_ngn: 60000 }));
    assert.deepEqual(opts.map((o) => o.unit_id), ["T-4", "T-5", "T-3"]);
    assert.ok(api.urls.length >= 2, "must have read more than one page");
  });

  test("create_checkout is UNIT_SOLD when the earliest payment is on the last page", async () => {
    const { ctx, token } = await withApi(crowdedLedger());
    const r = await createCheckout(ctx.deps, { quote_token: token, unit_id: "T-2", find_my_off: true });
    assert.equal("error" in r && r.error, "UNIT_SOLD");
  });

  test("a later payer is sold_to_earlier_payer when the earlier payment is on the last page", async () => {
    const all = crowdedLedger();
    all.unshift(apiTxn("ref-second", "T-2", 30000, "2026-10-21T10:00:00.000Z")); // newest, page 1
    const { ctx } = await withApi(all);
    const late = await confirmPayment(ctx.deps, { reference: "ref-second" });
    assert.deepEqual(late, { status: "sold_to_earlier_payer", unit_id: "T-2", refund_needed: true });
  });

  test("a wrong-amount earlier success does not own the unit: the later correct payer is reserved", async () => {
    const { ctx } = await tinyQuote();
    ctx.paystack.setTxn({ reference: "ref-short", status: "success", amount_kobo: 100, paid_at: "2026-10-21T10:00:00.000Z", gateway_response: "Successful", metadata: { unit_id: "T-2", topup_ngn: 30000, quote_token: "tok" } });
    ctx.paystack.paid("ref-right", "T-2", 30000, "2026-10-21T10:05:00.000Z");
    const r = await confirmPayment(ctx.deps, { reference: "ref-right" });
    assert.ok("status" in r && r.status === "reserved", JSON.stringify(r));
  });

  test("a wrong-amount success does not hide the unit from find_phones or block create_checkout", async () => {
    const { ctx, token } = await tinyQuote();
    ctx.paystack.setTxn({ reference: "ref-short", status: "success", amount_kobo: 100, paid_at: "2026-10-21T10:00:00.000Z", gateway_response: "Successful", metadata: { unit_id: "T-4", topup_ngn: 10000, quote_token: "tok" } });
    const opts = options(await findPhones(ctx.deps, { quote_token: token, max_topup_ngn: 60000 }));
    assert.deepEqual(opts.map((o) => o.unit_id), ["T-4", "T-5", "T-2"]);
    const c = await createCheckout(ctx.deps, { quote_token: token, unit_id: "T-4", find_my_off: true });
    assert.ok(!("error" in c), JSON.stringify(c));
  });

  test("a non-NGN success does not own a unit", async () => {
    const { ctx, token } = await tinyQuote();
    ctx.paystack.setTxn({ reference: "ref-usd", currency: "USD", status: "success", amount_kobo: 1000000, paid_at: "2026-10-21T10:00:00.000Z", gateway_response: "Successful", metadata: { unit_id: "T-4", topup_ngn: 10000, quote_token: "tok" } });
    ctx.paystack.paid("ref-ngn", "T-4", 10000, "2026-10-21T10:05:00.000Z");
    const r = await confirmPayment(ctx.deps, { reference: "ref-ngn" });
    assert.ok("status" in r && r.status === "reserved", JSON.stringify(r));
    // and with only the USD payment present, the unit is still on offer
    const fresh = await tinyQuote();
    fresh.ctx.paystack.setTxn({ reference: "ref-usd", currency: "USD", status: "success", amount_kobo: 1000000, paid_at: "2026-10-21T10:00:00.000Z", gateway_response: "Successful", metadata: { unit_id: "T-4", topup_ngn: 10000, quote_token: "tok" } });
    const opts = options(await findPhones(fresh.ctx.deps, { quote_token: fresh.token, max_topup_ngn: 60000 }));
    assert.ok(opts.map((o) => o.unit_id).includes("T-4"));
  });
});

describe("F2 confirm_payment: only a true not-found is UNKNOWN_REFERENCE", () => {
  const bodies: Array<[string, () => Response]> = [
    ["HTTP 401", () => new Response(JSON.stringify({ status: false, message: "Invalid key" }), { status: 401 })],
    ["HTTP 403", () => new Response(JSON.stringify({ status: false, message: "Forbidden" }), { status: 403 })],
    ["HTTP 429", () => new Response(JSON.stringify({ status: false, message: "Rate limited" }), { status: 429 })],
    ["HTTP 400 with another code", () => new Response(JSON.stringify({ status: false, message: "bad", code: "invalid_params" }), { status: 400 })],
    ["HTTP 200 with a non-JSON body", () => new Response("<html>gateway</html>", { status: 200 })],
  ];
  for (const [name, mk] of bodies) {
    test(`${name} is PAYSTACK_UNAVAILABLE, never UNKNOWN_REFERENCE`, async () => {
      const { ctx } = await tinyQuote();
      ctx.deps.paystack = httpPaystack("sk_test_x", { fetch: (async () => mk()) as unknown as typeof fetch });
      const r = await confirmPayment(ctx.deps, { reference: "ref-1" });
      assert.deepEqual(r, { error: "PAYSTACK_UNAVAILABLE", detail: (r as any).detail });
    });
  }

  test("a body that fails mid-stream is PAYSTACK_UNAVAILABLE", async () => {
    const { ctx } = await tinyQuote();
    const broken = () => new Response(new ReadableStream({
      start(c) { c.enqueue(new TextEncoder().encode('{"status":tr')); },
      pull(c) { c.error(new Error("socket reset")); },
    }), { status: 200 });
    ctx.deps.paystack = httpPaystack("sk_test_x", { fetch: (async () => broken()) as unknown as typeof fetch });
    const r = await confirmPayment(ctx.deps, { reference: "ref-1" });
    assert.equal("error" in r && r.error, "PAYSTACK_UNAVAILABLE");
  });

  test("control: Paystack's transaction_not_found is UNKNOWN_REFERENCE", async () => {
    const { ctx } = await tinyQuote();
    const api = paginatedApi([]);
    ctx.deps.paystack = httpPaystack("sk_test_x", { fetch: api.f });
    const r = await confirmPayment(ctx.deps, { reference: "nope" });
    assert.equal("error" in r && r.error, "UNKNOWN_REFERENCE");
  });
});

describe("F5 create_checkout: Find My guard", () => {
  test("find_my_off false is FIND_MY_ON and makes no Paystack call", async () => {
    const { ctx, token } = await tinyQuote();
    const r = await createCheckout(ctx.deps, { quote_token: token, unit_id: "T-2", find_my_off: false });
    assert.equal("error" in r && r.error, "FIND_MY_ON");
    assert.equal(ctx.paystack.initializeCalls.length, 0);
    assert.equal(ctx.paystack.listCalls, 0);
    assert.equal(ctx.paystack.verifyCalls.length, 0);
  });

  test("find_my_off true proceeds to a checkout", async () => {
    const { ctx, token } = await tinyQuote();
    const c = checkout(await createCheckout(ctx.deps, { quote_token: token, unit_id: "T-2", find_my_off: true }));
    assert.equal(c.topup_ngn, 30000);
  });
});
