// find_phones, create_checkout, confirm_payment.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { valueTradeIn, findPhones, createCheckout, confirmPayment, pickupCode } from "../src/tools.ts";
import type { Catalog, Valuation, PhoneOption, Checkout, ValueTradeInArgs } from "../src/types.ts";
import { FLAWLESS, SECRET, makeCtx, tinyCatalog, offerFor } from "./fakes.ts";
import { httpPaystack } from "../src/paystack.ts";
import type { TestCtx } from "./fakes.ts";

async function quoteFor(ctx: TestCtx, model: string, capacity_gb: number, faults: string[], over: Partial<ValueTradeInArgs> = {}): Promise<Valuation> {
  const r = await valueTradeIn(ctx.deps, { model, capacity_gb, faults, ...over });
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

// Tiny catalog, no faults on Test Phone 128, screen and body flawless: value_ngn is 100000.
async function tinyQuote(cat: Catalog = tinyCatalog()) {
  const ctx = makeCtx(cat);
  const v = await quoteFor(ctx, "Test Phone", 128, [], FLAWLESS);
  assert.equal(v.value_ngn, 100000);
  return { ctx, token: v.quote_token };
}

describe("B4 find_phones", () => {
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

  test("at most three, ascending top-up", async () => {
    const { ctx, token } = await tinyQuote();
    const opts = options(await findPhones(ctx.deps, { quote_token: token, max_topup_ngn: 60000 }));
    assert.equal(opts.length, 3);
    assert.deepEqual(opts.map((o) => o.unit_id), ["T-4", "T-5", "T-2"]);
    const ups = opts.map((o) => o.topup_ngn);
    assert.deepEqual(ups, [...ups].sort((a, b) => a - b));
  });

  test("excludes units with a successful Paystack payment", async () => {
    const { ctx, token } = await tinyQuote();
    ctx.paystack.paid("ref-sold", "T-4", 10000, "2026-10-21T10:00:00.000Z");
    const opts = options(await findPhones(ctx.deps, { quote_token: token, max_topup_ngn: 60000 }));
    assert.deepEqual(opts.map((o) => o.unit_id), ["T-5", "T-2", "T-3"]);
  });
});

describe("B5 create_checkout: server-side amount", () => {
  test("initializes Paystack with (price - value) * 100 kobo and the metadata", async () => {
    const { ctx, token } = await tinyQuote();
    const c = checkout(await createCheckout(ctx.deps, { quote_token: token, offer_token: await offerFor(ctx, token, "T-2"), find_my_off: true }));
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
});

describe("confirm_payment", () => {
  const T = "2026-10-21T11:00:00.000Z";

  async function pending() {
    const { ctx, token } = await tinyQuote();
    const c = checkout(await createCheckout(ctx.deps, { quote_token: token, offer_token: await offerFor(ctx, token, "T-2"), find_my_off: true }));
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

  test("B7 failed is declined with the gateway_response as reason", async () => {
    const { ctx, token, ref } = await pending();
    ctx.paystack.setTxn({ reference: ref, status: "failed", amount_kobo: 3000000, paid_at: null, gateway_response: "Insufficient Funds", metadata: { unit_id: "T-2", topup_ngn: 30000, quote_token: token } });
    const r = await confirmPayment(ctx.deps, { reference: ref });
    assert.deepEqual(r, { status: "declined", reason: "Insufficient Funds" });
  });

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
});

describe("F2 confirm_payment: only a true not-found is UNKNOWN_REFERENCE", () => {
  const bodies: Array<[string, () => Response]> = [
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
});

describe("F5 create_checkout: Find My guard", () => {
  test("find_my_off false is FIND_MY_ON and makes no Paystack call", async () => {
    const { ctx, token } = await tinyQuote();
    const offer_token = await offerFor(ctx, token, "T-2");
    const lists = ctx.paystack.listCalls; // find_phones read the ledger already
    const r = await createCheckout(ctx.deps, { quote_token: token, offer_token, find_my_off: false });
    assert.equal("error" in r && r.error, "FIND_MY_ON");
    assert.equal(ctx.paystack.initializeCalls.length, 0);
    assert.equal(ctx.paystack.listCalls, lists);
    assert.equal(ctx.paystack.verifyCalls.length, 0);
  });
});
