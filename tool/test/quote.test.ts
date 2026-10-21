// B3: signed quote. Round trip, tampering, expiry, and every tool that takes a token.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { signQuote, readQuote } from "../src/quote.ts";
import { valueTradeIn, findPhones, createCheckout } from "../src/tools.ts";
import { QUOTE_TTL_MS } from "../src/types.ts";
import type { QuotePayload, Valuation } from "../src/types.ts";
import { NOW, SECRET, makeCtx, tinyCatalog } from "./fakes.ts";

const payload: QuotePayload = {
  v: 1, model: "Test Phone", capacity_gb: 128, faults: ["a", "b"],
  value_ngn: 75000, iat: NOW, exp: NOW + QUOTE_TTL_MS,
};

const b64u = (s: string) => Buffer.from(s, "utf8").toString("base64url");

function swapFirstChar(s: string): string {
  return (s[0] === "A" ? "B" : "A") + s.slice(1);
}

describe("quote token", () => {
  test("format is base64url(JSON payload) + '.' + signature, and round trips", () => {
    const t = signQuote(payload, SECRET);
    const parts = t.split(".");
    assert.equal(parts.length, 2);
    assert.deepEqual(JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")), payload);
    assert.match(parts[1], /^[A-Za-z0-9_-]+$/);
    assert.deepEqual(readQuote(t, SECRET, NOW), payload);
  });

  test("a different secret does not verify", () => {
    const t = signQuote(payload, SECRET);
    assert.equal(readQuote(t, "another-secret", NOW), "QUOTE_INVALID");
  });

  test("tampered payload gives QUOTE_INVALID", () => {
    const t = signQuote(payload, SECRET);
    const sig = t.split(".")[1];
    const forged = b64u(JSON.stringify({ ...payload, value_ngn: 700000 })) + "." + sig;
    assert.equal(readQuote(forged, SECRET, NOW), "QUOTE_INVALID");
  });

  test("tampered signature gives QUOTE_INVALID", () => {
    const t = signQuote(payload, SECRET);
    const [body, sig] = t.split(".");
    assert.equal(readQuote(body + "." + swapFirstChar(sig), SECRET, NOW), "QUOTE_INVALID");
    assert.equal(readQuote(body + ".", SECRET, NOW), "QUOTE_INVALID");
  });

  test("garbage gives QUOTE_INVALID", () => {
    for (const bad of ["", "abc", "a.b.c", "....", "not a token"]) {
      assert.equal(readQuote(bad, SECRET, NOW), "QUOTE_INVALID", JSON.stringify(bad));
    }
  });

  test("past exp gives QUOTE_EXPIRED, at exp minus one is still valid", () => {
    const t = signQuote(payload, SECRET);
    assert.deepEqual(readQuote(t, SECRET, payload.exp - 1), payload);
    assert.equal(readQuote(t, SECRET, payload.exp + 1), "QUOTE_EXPIRED");
  });

  test("a bad signature on an expired token is QUOTE_INVALID, not EXPIRED", () => {
    const t = signQuote(payload, SECRET);
    const [body, sig] = t.split(".");
    assert.equal(readQuote(body + "." + swapFirstChar(sig), SECRET, payload.exp + 1), "QUOTE_INVALID");
  });
});

describe("B3 every tool that takes a token refuses bad ones", () => {
  async function goodToken() {
    const ctx = makeCtx(tinyCatalog());
    const r = (await valueTradeIn(ctx.deps, { model: "Test Phone", capacity_gb: 128, faults: [] })) as Valuation;
    return { ctx, token: r.quote_token };
  }

  test("find_phones refuses tampered payload, tampered signature, garbage and expired", async () => {
    const { ctx, token } = await goodToken();
    const [body, sig] = token.split(".");
    const forgedBody = b64u(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), value_ngn: 1000 }));
    const cases: [string, string][] = [
      ["tampered payload", forgedBody + "." + sig],
      ["tampered signature", body + "." + swapFirstChar(sig)],
      ["garbage", "garbage"],
    ];
    for (const [name, t] of cases) {
      const r = await findPhones(ctx.deps, { quote_token: t, max_topup_ngn: 100000 });
      assert.deepEqual("error" in r && r.error, "QUOTE_INVALID", name);
    }
    ctx.clock.now = NOW + QUOTE_TTL_MS + 1;
    const r = await findPhones(ctx.deps, { quote_token: token, max_topup_ngn: 100000 });
    assert.equal("error" in r && r.error, "QUOTE_EXPIRED");
  });

  test("create_checkout refuses tampered payload, tampered signature, garbage and expired, and never calls Paystack", async () => {
    const { ctx, token } = await goodToken();
    const [body, sig] = token.split(".");
    const forgedBody = b64u(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), value_ngn: 99000 }));
    const cases: [string, string][] = [
      ["tampered payload", forgedBody + "." + sig],
      ["tampered signature", body + "." + swapFirstChar(sig)],
      ["garbage", "garbage"],
    ];
    for (const [name, t] of cases) {
      const r = await createCheckout(ctx.deps, { quote_token: t, offer_token: "x.y", find_my_off: true });
      assert.deepEqual("error" in r && r.error, "QUOTE_INVALID", name);
    }
    ctx.clock.now = NOW + QUOTE_TTL_MS + 1;
    const r = await createCheckout(ctx.deps, { quote_token: token, offer_token: "x.y", find_my_off: true });
    assert.equal("error" in r && r.error, "QUOTE_EXPIRED");
    assert.equal(ctx.paystack.initializeCalls.length, 0);
  });

  test("a token signed with another secret is refused by both tools", async () => {
    const { ctx } = await goodToken();
    const foreign = signQuote({ ...payload, model: "Test Phone", faults: [], value_ngn: 1000 }, "attacker-secret");
    const a = await findPhones(ctx.deps, { quote_token: foreign, max_topup_ngn: 500000 });
    const b = await createCheckout(ctx.deps, { quote_token: foreign, offer_token: "x.y", find_my_off: true });
    assert.equal("error" in a && a.error, "QUOTE_INVALID");
    assert.equal("error" in b && b.error, "QUOTE_INVALID");
  });
});
