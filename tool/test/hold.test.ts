// Spec 0003: a unit with an open payment link is held for HOLD_MS; the holder still sees it.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { valueTradeIn, findPhones, createCheckout } from "../src/tools.ts";
import { HOLD_MS } from "../src/types.ts";
import type { Checkout, PhoneOption, Valuation } from "../src/types.ts";
import { FLAWLESS, makeCtx, tinyCatalog, offerFor } from "./fakes.ts";
import type { TestCtx } from "./fakes.ts";

// A trades in a flawless Test Phone 128 (value 100000); B one with fault "a" (value 90000). Both are offered T-4 (110000).
const quoteA = async (ctx: TestCtx) => ((await valueTradeIn(ctx.deps, { model: "Test Phone", capacity_gb: 128, faults: [], ...FLAWLESS })) as Valuation).quote_token;
const quoteB = async (ctx: TestCtx) => ((await valueTradeIn(ctx.deps, { model: "Test Phone", capacity_gb: 128, faults: ["a"], ...FLAWLESS })) as Valuation).quote_token;
const offered = async (ctx: TestCtx, quote_token: string) => {
  const r = await findPhones(ctx.deps, { quote_token, max_topup_ngn: 100000 });
  assert.ok(!("error" in r), JSON.stringify(r));
  return (r as { options: PhoneOption[] }).options.map((o) => o.unit_id);
};
const code = (r: unknown) => (r as { error?: string }).error;

// A opens a payment link for T-4.
async function aHoldsT4(ctx: TestCtx) {
  const qa = await quoteA(ctx);
  const c = (await createCheckout(ctx.deps, { quote_token: qa, offer_token: await offerFor(ctx, qa, "T-4"), find_my_off: true })) as Checkout;
  assert.equal(c.unit_id, "T-4");
  return c;
}

describe("a unit with an open link is held from other customers", () => {
  test("H1: B is not offered T-4 while A's link is open", async () => {
    const ctx = makeCtx(tinyCatalog());
    const qb = await quoteB(ctx);
    assert.ok((await offered(ctx, qb)).includes("T-4"));
    await aHoldsT4(ctx);
    assert.ok(!(await offered(ctx, qb)).includes("T-4"));
  });

  test("H2: B's checkout for T-4 with an offer made before A's link is UNIT_HELD and never reaches initialize", async () => {
    const ctx = makeCtx(tinyCatalog());
    const qb = await quoteB(ctx);
    const offerB = await offerFor(ctx, qb, "T-4");
    await aHoldsT4(ctx);
    const before = ctx.paystack.initializeCalls.length;
    const r = await createCheckout(ctx.deps, { quote_token: qb, offer_token: offerB, find_my_off: true });
    assert.equal(code(r), "UNIT_HELD");
    assert.equal(ctx.paystack.initializeCalls.length, before);
  });

  test("H3: A, re-valued later with the same phone, is still offered T-4 and gets a fresh link", async () => {
    const ctx = makeCtx(tinyCatalog());
    await aHoldsT4(ctx);
    ctx.clock.now += 60_000;
    const qa2 = await quoteA(ctx);
    assert.ok((await offered(ctx, qa2)).includes("T-4"));
    const c = await createCheckout(ctx.deps, { quote_token: qa2, offer_token: await offerFor(ctx, qa2, "T-4"), find_my_off: true });
    assert.equal((c as Checkout).unit_id, "T-4", JSON.stringify(c));
  });

  test("H4: after HOLD_MS, B is offered T-4 again", async () => {
    const ctx = makeCtx(tinyCatalog());
    await aHoldsT4(ctx);
    ctx.clock.now += HOLD_MS + 1;
    assert.ok((await offered(ctx, await quoteB(ctx))).includes("T-4"));
  });

  test("H5: a declined payment releases the hold", async () => {
    const ctx = makeCtx(tinyCatalog());
    const c = await aHoldsT4(ctx);
    ctx.paystack.setTxn({ ...ctx.paystack.txns.get(c.reference)!, status: "failed", gateway_response: "Declined" });
    assert.ok((await offered(ctx, await quoteB(ctx))).includes("T-4"));
  });

  test("H5b: a link still being paid (ongoing or pending) keeps the hold", async () => {
    for (const status of ["ongoing", "pending"]) {
      const ctx = makeCtx(tinyCatalog());
      const c = await aHoldsT4(ctx);
      ctx.paystack.setTxn({ ...ctx.paystack.txns.get(c.reference)!, status });
      assert.ok(!(await offered(ctx, await quoteB(ctx))).includes("T-4"), status);
    }
  });

  test("H6: if open links cannot be read, both tools say PAYSTACK_UNAVAILABLE and nothing is initialized", async () => {
    const ctx = makeCtx(tinyCatalog());
    const qb = await quoteB(ctx);
    const offerB = await offerFor(ctx, qb, "T-4");
    ctx.paystack.failListOpen = true;
    assert.equal(code(await findPhones(ctx.deps, { quote_token: qb, max_topup_ngn: 100000 })), "PAYSTACK_UNAVAILABLE");
    assert.equal(code(await createCheckout(ctx.deps, { quote_token: qb, offer_token: offerB, find_my_off: true })), "PAYSTACK_UNAVAILABLE");
    assert.equal(ctx.paystack.initializeCalls.length, 0);
  });

  test("the hold window starts HOLD_MS before now", async () => {
    const ctx = makeCtx(tinyCatalog());
    await offered(ctx, await quoteB(ctx));
    assert.equal(ctx.paystack.listOpenCalls.at(-1), new Date(ctx.clock.now - HOLD_MS).toISOString());
  });
});
