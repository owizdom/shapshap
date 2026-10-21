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
    status: String(d.status),
    amount_kobo: Number(d.amount),
    paid_at: d.paid_at ?? null,
    gateway_response: d.gateway_response ?? null,
    metadata: parseMeta(d.metadata),
  };
}

export function httpPaystack(secretKey: string, opts: { timeoutMs?: number; fetch?: typeof fetch } = {}): PaystackClient {
  const timeoutMs = opts.timeoutMs ?? 8000;
  const doFetch = opts.fetch ?? fetch;

  async function call(path: string, init: RequestInit = {}): Promise<{ http: number; body: any }> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(new Error("timeout")), timeoutMs);
    try {
      const res = await doFetch(BASE + path, {
        ...init,
        headers: { authorization: `Bearer ${secretKey}`, "content-type": "application/json" },
        signal: ctl.signal,
      });
      if (res.status >= 500) throw new PaystackUnavailable(`Paystack HTTP ${res.status}`);
      let body: any = null;
      try { body = await res.json(); } catch { body = null; }
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
      const { body } = await call(`/transaction/verify/${encodeURIComponent(reference)}`);
      if (!body || body.status !== true || !body.data) return null;
      return toTxn(body.data);
    },
    async listSuccessful() {
      const { body } = await call("/transaction?status=success&perPage=100");
      if (!body || body.status !== true || !Array.isArray(body.data)) {
        throw new PaystackUnavailable(`Paystack list failed: ${body?.message ?? "no response"}`);
      }
      return body.data.map(toTxn);
    },
  };
}
