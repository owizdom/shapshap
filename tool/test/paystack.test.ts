// httpPaystack: injected-fetch behaviour, plus one opt-in live test.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { httpPaystack } from "../src/paystack.ts";
import { PaystackUnavailable } from "../src/types.ts";

interface Seen { url: string; init: RequestInit | undefined }

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function fakeFetch(handler: (url: string, init?: RequestInit) => Promise<Response> | Response) {
  const seen: Seen[] = [];
  const f = (async (input: any, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.url ?? String(input);
    seen.push({ url, init });
    return handler(url, init);
  }) as unknown as typeof fetch;
  return { f, seen };
}

// A fetch that never answers on its own and rejects when the abort signal fires, like the real one.
function hangingFetch(): typeof fetch {
  return ((_input: any, init?: RequestInit) =>
    new Promise<Response>((_res, rej) => {
      const sig = init?.signal;
      if (sig?.aborted) return rej(sig.reason ?? new Error("aborted"));
      sig?.addEventListener("abort", () => rej(sig.reason ?? new Error("aborted")));
    })) as unknown as typeof fetch;
}

const meta = { unit_id: "T-2", topup_ngn: 30000, quote_token: "tok" };
const initInput = { email: "c1@example.com", amount_kobo: 3000000, reference: "ref-1", metadata: meta };

describe("httpPaystack (injected fetch)", () => {
  test("initialize posts to /transaction/initialize with bearer auth, kobo amount and metadata", async () => {
    const { f, seen } = fakeFetch(() => json({ status: true, message: "ok", data: { authorization_url: "https://checkout.paystack.com/abc", access_code: "abc", reference: "ref-1" } }));
    const ps = httpPaystack("sk_test_x", { fetch: f });
    const r = await ps.initialize(initInput);
    assert.deepEqual(r, { authorization_url: "https://checkout.paystack.com/abc", reference: "ref-1" });
    assert.equal(seen.length, 1);
    assert.match(seen[0].url, /^https:\/\/api\.paystack\.co\/transaction\/initialize$/);
    assert.equal(seen[0].init?.method, "POST");
    const headers = new Headers(seen[0].init?.headers);
    assert.equal(headers.get("authorization"), "Bearer sk_test_x");
    const body = JSON.parse(String(seen[0].init?.body));
    assert.equal(body.amount, 3000000);
    assert.equal(body.email, "c1@example.com");
    assert.equal(body.reference, "ref-1");
    assert.deepEqual(body.metadata, meta);
  });

  test("verify maps data.* into a PaystackTxn", async () => {
    const { f, seen } = fakeFetch(() => json({
      status: true, message: "Verification successful",
      data: { reference: "ref-1", status: "success", amount: 3000000, paid_at: "2026-10-21T10:00:00.000Z", gateway_response: "Successful", metadata: meta },
    }));
    const t = await httpPaystack("sk_test_x", { fetch: f }).verify("ref-1");
    assert.deepEqual(t, { reference: "ref-1", status: "success", amount_kobo: 3000000, paid_at: "2026-10-21T10:00:00.000Z", gateway_response: "Successful", metadata: meta });
    assert.match(seen[0].url, /\/transaction\/verify\/ref-1$/);
  });

  test("verify of an abandoned transaction keeps paid_at null", async () => {
    const { f } = fakeFetch(() => json({ status: true, message: "ok", data: { reference: "ref-1", status: "abandoned", amount: 3000000, paid_at: null, gateway_response: "The transaction was not completed", metadata: meta } }));
    const t = await httpPaystack("sk_test_x", { fetch: f }).verify("ref-1");
    assert.equal(t?.status, "abandoned");
    assert.equal(t?.paid_at, null);
  });

  test("verify with a 200 whose body has status false returns null", async () => {
    const { f } = fakeFetch(() => json({ status: false, message: "Transaction reference not found" }, 200));
    assert.equal(await httpPaystack("sk_test_x", { fetch: f }).verify("nope"), null);
  });

  test("listSuccessful asks for status=success and maps every row", async () => {
    const { f, seen } = fakeFetch(() => json({
      status: true, message: "ok",
      data: [
        { reference: "r1", status: "success", amount: 1000000, paid_at: "2026-10-21T10:00:00.000Z", gateway_response: "Successful", metadata: { ...meta, unit_id: "A" } },
        { reference: "r2", status: "success", amount: 2000000, paid_at: "2026-10-21T10:05:00.000Z", gateway_response: "Successful", metadata: null },
      ],
    }));
    const rows = await httpPaystack("sk_test_x", { fetch: f }).listSuccessful();
    assert.match(seen[0].url, /\/transaction\?.*status=success/);
    assert.deepEqual(rows.map((r) => r.reference), ["r1", "r2"]);
    assert.equal(rows[0].amount_kobo, 1000000);
    assert.equal(rows[0].metadata?.unit_id, "A");
    assert.equal(rows[1].metadata, null);
  });

  for (const status of [500, 502, 503]) {
    test(`HTTP ${status} throws PaystackUnavailable on every call`, async () => {
      const { f } = fakeFetch(() => json({ status: false, message: "boom" }, status));
      const ps = httpPaystack("sk_test_x", { fetch: f });
      await assert.rejects(() => ps.initialize(initInput), PaystackUnavailable);
      await assert.rejects(() => ps.verify("ref-1"), PaystackUnavailable);
      await assert.rejects(() => ps.listSuccessful(), PaystackUnavailable);
    });
  }

  test("a network failure throws PaystackUnavailable", async () => {
    const { f } = fakeFetch(() => { throw new TypeError("fetch failed"); });
    const ps = httpPaystack("sk_test_x", { fetch: f });
    await assert.rejects(() => ps.verify("ref-1"), PaystackUnavailable);
  });

  test("a timeout throws PaystackUnavailable", async () => {
    const ps = httpPaystack("sk_test_x", { timeoutMs: 30, fetch: hangingFetch() });
    await assert.rejects(() => ps.verify("ref-1"), PaystackUnavailable);
    await assert.rejects(() => ps.initialize(initInput), PaystackUnavailable);
    await assert.rejects(() => ps.listSuccessful(), PaystackUnavailable);
  });
});

describe("httpPaystack (live, opt-in)", () => {
  test("initializes a real test-mode transaction and verify reports it not yet paid",
    { skip: process.env.PAYSTACK_LIVE_TEST !== "1" ? "set PAYSTACK_LIVE_TEST=1 to run against Paystack test mode" : false },
    async () => {
      const key = process.env.PAYSTACK_SECRET_KEY;
      assert.ok(key, "PAYSTACK_SECRET_KEY must be set for the live test");
      const ps = httpPaystack(key);
      const reference = `live-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      const r = await ps.initialize({ email: `live-${Date.now()}@example.com`, amount_kobo: 10000, reference, metadata: { unit_id: "LIVE-1", topup_ngn: 100, quote_token: "live" } });
      assert.equal(r.reference, reference);
      assert.match(r.authorization_url, /^https:\/\//);
      const t = await ps.verify(reference);
      assert.ok(t, "verify should find the transaction");
      assert.equal(t.status, "abandoned");
      assert.equal(t.paid_at, null);
      assert.equal(t.amount_kobo, 10000);
      assert.deepEqual(t.metadata, { unit_id: "LIVE-1", topup_ngn: 100, quote_token: "live" });
    });
});
