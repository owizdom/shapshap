// Price lock: find_phones signs an offer per option; create_checkout charges the offer, not the live sheet.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { valueTradeIn, findPhones, createCheckout } from "../src/tools.ts";
import { QUOTE_TTL_MS } from "../src/types.ts";
import type { Checkout, PhoneOption, Valuation } from "../src/types.ts";
import { FLAWLESS, NOW, SECRET, makeCtx, tinyCatalog, signOfferRaw, b64u } from "./fakes.ts";

// Test Phone 128 with no faults is valued at 100000 in the tiny catalog (screen and body flawless): T-2 130000 (topup 30000), T-4 110000, T-5 120000.
async function setup() {
  const ctx = makeCtx(tinyCatalog());
  const v = (await valueTradeIn(ctx.deps, { model: "Test Phone", capacity_gb: 128, faults: [], ...FLAWLESS })) as Valuation;
  const f = await findPhones(ctx.deps, { quote_token: v.quote_token, max_topup_ngn: 60000 });
  assert.ok(!("error" in f));
  const options = (f as { options: PhoneOption[] }).options;
  return { ctx, token: v.quote_token, options, t2: options.find((o) => o.unit_id === "T-2")! };
}

const decode = (tok: string) => JSON.parse(Buffer.from(tok.split(".")[0], "base64url").toString());
const swapFirst = (s: string) => (s[0] === "A" ? "B" : "A") + s.slice(1);
const code = (r: unknown) => (r as { error?: string }).error;

function noPaystack(ctx: { paystack: { initializeCalls: unknown[] } }) {
  assert.equal(ctx.paystack.initializeCalls.length, 0, "must not call Paystack initialize");
}

describe("offers from find_phones", () => {
  test("every option carries an offer_token that verifies and encodes unit, price, topup and the quote exp", async () => {
    const { token, options } = await setup();
    assert.ok(options.length >= 3);
    const [, quoteSig] = token.split(".");
    for (const o of options) {
      assert.equal(typeof o.offer_token, "string");
      const [body, sig] = o.offer_token.split(".");
      const want = createHmac("sha256", SECRET).update("offer." + body).digest("base64url");
      assert.equal(sig, want, "HMAC with the offer. prefix");
      assert.deepEqual(decode(o.offer_token), {
        v: 1, unit_id: o.unit_id, price_ngn: o.price_ngn, topup_ngn: o.topup_ngn, quote_sig: quoteSig, exp: NOW + QUOTE_TTL_MS,
      });
    }
  });
});

describe("the lock holds", () => {
  test("a stock price edit after the offer does not change the charge", async () => {
    const { ctx, token, t2 } = await setup();
    ctx.deps.catalog.stock.find((u) => u.unit_id === "T-2")!.price_ngn = 175000;
    const c = (await createCheckout(ctx.deps, { quote_token: token, offer_token: t2.offer_token, find_my_off: true })) as Checkout;
    assert.equal(c.topup_ngn, 30000);
    assert.equal(c.unit_id, "T-2");
    assert.equal(ctx.paystack.initializeCalls.length, 1);
    assert.equal(ctx.paystack.initializeCalls[0].amount_kobo, 30000 * 100);
    assert.deepEqual(ctx.paystack.initializeCalls[0].metadata, { unit_id: "T-2", topup_ngn: 30000, quote_token: token });
  });
});

describe("a sold or stale offer is refused before Paystack", () => {
  test("already sold in the ledger is UNIT_SOLD", async () => {
    const { ctx, token, t2 } = await setup();
    ctx.paystack.paid("ref-other", "T-2", 30000, "2026-10-21T10:00:00.000Z");
    const r = await createCheckout(ctx.deps, { quote_token: token, offer_token: t2.offer_token, find_my_off: true });
    assert.equal(code(r), "UNIT_SOLD");
    noPaystack(ctx);
  });

  test("a correctly signed offer whose own exp has passed is OFFER_EXPIRED", async () => {
    const { ctx, token, t2 } = await setup();
    const stale = signOfferRaw({ ...decode(t2.offer_token), exp: NOW - 1 });
    const r = await createCheckout(ctx.deps, { quote_token: token, offer_token: stale, find_my_off: true });
    assert.equal(code(r), "OFFER_EXPIRED");
    noPaystack(ctx);
  });
});

describe("a bad offer is refused before Paystack", () => {
  test("tampered payload, tampered signature, garbage", async () => {
    const { ctx, token, t2 } = await setup();
    const lists = ctx.paystack.listCalls;
    const [body, sig] = t2.offer_token.split(".");
    const forged = b64u(JSON.stringify({ ...decode(t2.offer_token), topup_ngn: 1000, price_ngn: 101000 }));
    const cases: [string, string][] = [
      ["tampered payload", forged + "." + sig],
      ["tampered signature", body + "." + swapFirst(sig)],
      ["garbage", "garbage"],
      ["empty", ""],
      ["no signature", body + "."],
    ];
    for (const [name, offer_token] of cases) {
      const r = await createCheckout(ctx.deps, { quote_token: token, offer_token, find_my_off: true });
      assert.equal(code(r), "OFFER_INVALID", name);
    }
    noPaystack(ctx);
    assert.equal(ctx.paystack.listCalls, lists, "must not read the ledger");
  });
});
