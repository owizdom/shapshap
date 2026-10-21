import { PaystackUnavailable } from "./types.ts";
import type { CheckoutMetadata, PaystackClient, PaystackTxn } from "./types.ts";

const BASE = "https://api.paystack.co";

function parseMeta(m: unknown): CheckoutMetadata | null {
  let v = m;
  if (typeof v === "string") {
    try { v = JSON.parse(v); } catch { return null; }
  }
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.unit_id !== "string") return null;
  return { unit_id: o.unit_id, topup_ngn: Number(o.topup_ngn), quote_token: String(o.quote_token ?? "") };
}

function toTxn(d: any): PaystackTxn {
  return {
    reference: String(d.reference),
    currency: String(d.currency ?? ""),
    status: String(d.status),
    amount_kobo: Number(d.amount),
    paid_at: d.paid_at ?? null,
    gateway_response: d.gateway_response ?? null,
    metadata: parseMeta(d.metadata),
  };
}

export function httpPaystack(secretKey: string, opts: { timeoutMs?: number; fetch?: typeof fetch; since?: string } = {}): PaystackClient {
  const timeoutMs = opts.timeoutMs ?? 8000;
  const doFetch = opts.fetch ?? fetch;

  // Returns the HTTP status and parsed body of a 2xx, 400 or 404 answer. Everything else throws.
  async function call(path: string, init: RequestInit = {}, tolerate: number[] = []): Promise<{ http: number; body: any }> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(new Error("timeout")), timeoutMs);
    try {
      const res = await doFetch(BASE + path, {
        ...init,
        headers: { authorization: `Bearer ${secretKey}`, "content-type": "application/json" },
        signal: ctl.signal,
      });
      const ok = res.status >= 200 && res.status < 300;
      if (!ok && !tolerate.includes(res.status)) throw new PaystackUnavailable(`Paystack HTTP ${res.status}`);
      const text = await res.text();
      let body: any = null;
      try { body = JSON.parse(text); } catch { body = null; }
      if (ok && body === null) throw new PaystackUnavailable("Paystack returned a body that is not JSON");
      return { http: res.status, body };
    } catch (e) {
      if (e instanceof PaystackUnavailable) throw e;
      throw new PaystackUnavailable(`Paystack unreachable: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async initialize(input) {
      const { body } = await call("/transaction/initialize", {
        method: "POST",
        body: JSON.stringify({ email: input.email, amount: input.amount_kobo, reference: input.reference, metadata: input.metadata }),
      });
      if (!body || body.status !== true || !body.data?.authorization_url) {
        throw new PaystackUnavailable(`Paystack refused initialize: ${body?.message ?? "no response"}`);
      }
      return { authorization_url: String(body.data.authorization_url), reference: String(body.data.reference ?? input.reference) };
    },
    async verify(reference) {
      const { http, body } = await call(`/transaction/verify/${encodeURIComponent(reference)}`, {}, [400, 404]);
      if (http === 404) return null;
      if (http === 400) {
        if (body?.code === "transaction_not_found") return null;
        throw new PaystackUnavailable(`Paystack HTTP 400: ${body?.message ?? "bad request"}`);
      }
      if (!body || body.status !== true || !body.data) throw new PaystackUnavailable("Paystack verify answered without data");
      return toTxn(body.data);
    },
    async listSuccessful() {
      const out: PaystackTxn[] = [];
      let pageCount = 1;
      for (let page = 1; page <= pageCount; page++) {
        const q = new URLSearchParams({ status: "success", perPage: "100", page: String(page) });
        if (opts.since) q.set("from", opts.since);
        const { body } = await call(`/transaction?${q.toString()}`);
        if (!body || body.status !== true || !Array.isArray(body.data)) {
          throw new PaystackUnavailable(`Paystack list failed: ${body?.message ?? "no response"}`);
        }
        out.push(...body.data.map(toTxn));
        const pc = Number(body.meta?.pageCount);
        if (Number.isFinite(pc) && pc > 0) pageCount = pc;
      }
      return out;
    },
  };
}
