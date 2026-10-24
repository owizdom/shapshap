// httpPaystack: injected-fetch behaviour. Live tests are in test/live/.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { httpPaystack } from "../src/paystack.ts";
import { PaystackUnavailable } from "../src/types.ts";
import { paginatedApi, apiTxn } from "./fakes.ts";

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
      data: { reference: "ref-1", status: "success", currency: "NGN", amount: 3000000, paid_at: "2026-10-21T10:00:00.000Z", gateway_response: "Successful", metadata: meta },
    }));
    const t = await httpPaystack("sk_test_x", { fetch: f }).verify("ref-1");
    assert.deepEqual(t, { reference: "ref-1", currency: "NGN", status: "success", amount_kobo: 3000000, paid_at: "2026-10-21T10:00:00.000Z", created_at: null, gateway_response: "Successful", metadata: meta });
    assert.match(seen[0].url, /\/transaction\/verify\/ref-1$/);
  });

  test("verify throws PaystackUnavailable on a 200 whose body is not JSON", async () => {
    const { f } = fakeFetch(() => new Response("<html>bad gateway page</html>", { status: 200 }));
    const ps = httpPaystack("sk_test_x", { fetch: f });
    await assert.rejects(() => ps.verify("ref-1"), PaystackUnavailable);
    await assert.rejects(() => ps.listSuccessful(), PaystackUnavailable);
  });

  test("listSuccessful sends from=<since> on every page when since is given, and none when not", async () => {
    const all = [];
    for (let i = 0; i < 150; i++) all.push(apiTxn(`r${i}`, `U-${i}`, 1000, "2026-10-21T10:00:00.000Z"));
    const since = "2026-10-20T00:00:00.000Z";
    const a = paginatedApi(all);
    await httpPaystack("sk_test_x", { fetch: a.f, since }).listSuccessful();
    const listUrls = a.urls.map((u) => new URL(u)).filter((u) => u.pathname === "/transaction");
    assert.equal(listUrls.length, 2);
    for (const u of listUrls) assert.equal(u.searchParams.get("from"), since);
    const b = paginatedApi(all);
    await httpPaystack("sk_test_x", { fetch: b.f }).listSuccessful();
    for (const u of b.urls.map((x) => new URL(x))) assert.equal(u.searchParams.get("from"), null);
  });

  test("H7: listOpen lists every page from the later of fromIso and since, keeps only unpaid links, and reads createdAt", async () => {
    const all = [];
    for (let i = 0; i < 120; i++) all.push(apiTxn(`o${i}`, `U-${i}`, 1000, null as unknown as string, { status: i % 2 ? "abandoned" : "ongoing", createdAt: "2026-10-24T10:00:00.000Z" }));
    for (const status of ["success", "failed", "reversed"]) all.push(apiTxn(`c-${status}`, "U-x", 1000, "2026-10-24T10:00:00.000Z", { status, createdAt: "2026-10-24T10:00:00.000Z" }));
    const a = paginatedApi(all);
    const open = await httpPaystack("sk_test_x", { fetch: a.f, since: "2026-10-20T00:00:00.000Z" }).listOpen("2026-10-24T09:30:00.000Z");
    assert.equal(open.length, 120);
    assert.ok(open.every((t) => t.status === "abandoned" || t.status === "ongoing"));
    assert.equal(open[0].created_at, "2026-10-24T10:00:00.000Z");
    const urls = a.urls.map((u) => new URL(u));
    assert.equal(urls.length, 2);
    for (const u of urls) {
      assert.equal(u.searchParams.get("status"), null);
      assert.equal(u.searchParams.get("from"), "2026-10-24T09:30:00.000Z");
    }
    const b = paginatedApi(all);
    await httpPaystack("sk_test_x", { fetch: b.f, since: "2026-10-24T09:45:00.000Z" }).listOpen("2026-10-24T09:30:00.000Z");
    for (const u of b.urls.map((x) => new URL(x))) assert.equal(u.searchParams.get("from"), "2026-10-24T09:45:00.000Z");
  });

  test("a timeout throws PaystackUnavailable", async () => {
    const ps = httpPaystack("sk_test_x", { timeoutMs: 30, fetch: hangingFetch() });
    await assert.rejects(() => ps.verify("ref-1"), PaystackUnavailable);
    await assert.rejects(() => ps.initialize(initInput), PaystackUnavailable);
    await assert.rejects(() => ps.listSuccessful(), PaystackUnavailable);
  });
});
