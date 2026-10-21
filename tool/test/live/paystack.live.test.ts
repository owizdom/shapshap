// Opt-in live tests against Paystack TEST mode. Not in the default glob ("test/*.test.ts").
// Run with: npm run test:live (PAYSTACK_LIVE_TEST=1, PAYSTACK_SECRET_KEY in the environment).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { httpPaystack } from "../../src/paystack.ts";
import { confirmPayment } from "../../src/tools.ts";
import type { Catalog, Deps } from "../../src/types.ts";

const ENABLED = process.env.PAYSTACK_LIVE_TEST === "1";
const RUN_START = new Date().toISOString();

function key(): string {
  const k = process.env.PAYSTACK_SECRET_KEY;
  assert.ok(k, "PAYSTACK_SECRET_KEY must be set for the live tests");
  return k;
}

function catalogWith(unit_id: string, price_ngn: number): Catalog {
  return {
    prices: [], faults: [],
    stock: [{ unit_id, model: "Live Phone", capacity_gb: 128, grade: "A", battery_pct: 90, warranty_months: 3, price_ngn }],
  };
}

function unique(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

async function charge(sk: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch("https://api.paystack.co/charge", {
    method: "POST",
    headers: { authorization: `Bearer ${sk}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json: any = await res.json();
  assert.ok(json.status === true || json.data, `charge request failed: HTTP ${res.status} ${JSON.stringify(json)}`);
  return json;
}

async function untilNotWaiting(deps: Deps, reference: string) {
  let r: Awaited<ReturnType<typeof confirmPayment>> = { status: "waiting" };
  for (let i = 0; i < 10; i++) {
    r = await confirmPayment(deps, { reference });
    if (!("status" in r) || r.status !== "waiting") return r;
    await new Promise((res) => setTimeout(res, 1500));
  }
  return r;
}

describe("Paystack test mode (live, opt-in)", { skip: ENABLED ? false : "set PAYSTACK_LIVE_TEST=1 (use npm run test:live)" }, () => {
  test("a new checkout verifies as not yet paid", async () => {
    const ps = httpPaystack(key(), { since: RUN_START });
    const reference = unique("live-new");
    const metadata = { unit_id: unique("LIVE"), topup_ngn: 100, quote_token: "live" };
    const r = await ps.initialize({ email: `${reference}@example.com`, amount_kobo: 10000, reference, metadata });
    assert.equal(r.reference, reference);
    assert.match(r.authorization_url, /^https:\/\//);
    const t = await ps.verify(reference);
    assert.ok(t, "verify should find the transaction");
    assert.equal(t.status, "abandoned");
    assert.equal(t.paid_at, null);
    assert.equal(t.amount_kobo, 10000);
    assert.equal(t.currency, "NGN");
    assert.deepEqual(t.metadata, metadata);
  });

  test("an unknown reference verifies as null", async () => {
    assert.equal(await httpPaystack(key(), { since: RUN_START }).verify(unique("live-missing")), null);
  });

  test("the success test card makes confirmPayment return reserved", async () => {
    const sk = key();
    const unit_id = unique("LIVE");
    const reference = unique("live-ok");
    const topup_ngn = 100;
    await charge(sk, {
      email: `${reference}@example.com`, amount: topup_ngn * 100, reference,
      card: { number: "4084084084084081", cvv: "408", expiry_month: "10", expiry_year: "27" },
      metadata: { unit_id, topup_ngn, quote_token: "live" },
    });
    const deps: Deps = { catalog: catalogWith(unit_id, 100000 + topup_ngn), paystack: httpPaystack(sk, { since: RUN_START }), secret: "live-secret", now: Date.now };
    const r = await untilNotWaiting(deps, reference);
    assert.ok("status" in r && r.status === "reserved", JSON.stringify(r));
    assert.equal(r.unit_id, unit_id);
    assert.equal(r.topup_ngn, topup_ngn);
    assert.match(r.pickup_code, /^\d{6}$/);
  });

  test("the declined test card makes confirmPayment return declined", async () => {
    const sk = key();
    const unit_id = unique("LIVE");
    const reference = unique("live-declined");
    const topup_ngn = 100;
    await charge(sk, {
      email: `${reference}@example.com`, amount: topup_ngn * 100, reference,
      card: { number: "4084080000005408", cvv: "001", expiry_month: "10", expiry_year: "27" },
      metadata: { unit_id, topup_ngn, quote_token: "live" },
    });
    const deps: Deps = { catalog: catalogWith(unit_id, 100000 + topup_ngn), paystack: httpPaystack(sk, { since: RUN_START }), secret: "live-secret", now: Date.now };
    const r = await untilNotWaiting(deps, reference);
    assert.ok("status" in r && r.status === "declined", JSON.stringify(r));
    assert.equal(typeof r.reason, "string");
  });
});
