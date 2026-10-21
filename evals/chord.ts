// Real Chord client (fetch only) and a minimal .env loader. Never prints secret values.
import { existsSync, readFileSync } from "node:fs";
import type { ChatResponse, ChordClient } from "./types.ts";

export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

// Loads KEY=VALUE pairs from `path` into `env` without overriding variables already set.
export function loadEnvFile(path: string, env: Record<string, string | undefined> = process.env): void {
  if (!existsSync(path)) return;
  for (const [k, v] of Object.entries(parseEnvFile(readFileSync(path, "utf8")))) {
    if (env[k] === undefined || env[k] === "") env[k] = v;
  }
}

export interface ChordConfig { apiKey: string; baseUrl: string; workspaceId: string; teammateId?: string }

export function configFromEnv(env: Record<string, string | undefined>): { config?: ChordConfig; missing: string[] } {
  const missing = ["CHORD_API_KEY", "CHORD_WORKSPACE_ID"].filter((k) => !env[k]);
  if (missing.length) return { missing };
  return {
    missing,
    config: {
      apiKey: env.CHORD_API_KEY!,
      baseUrl: (env.CHORD_BASE_URL || "https://api.chordhq.xyz").replace(/\/+$/, ""),
      workspaceId: env.CHORD_WORKSPACE_ID!,
      teammateId: env.CHORD_TEAMMATE_ID || undefined,
    },
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class HttpChordClient implements ChordClient {
  cfg: ChordConfig;
  constructor(cfg: ChordConfig) { this.cfg = cfg; }

  private headers() {
    return { Authorization: `Bearer ${this.cfg.apiKey}`, "Content-Type": "application/json" };
  }

  async send(input: { session_id: string; sender_id: string; text: string }): Promise<ChatResponse> {
    for (let attempt = 0; ; attempt++) {
      const body: Record<string, string> = {
        workspace_id: this.cfg.workspaceId,
        sender_id: input.sender_id,
        session_id: input.session_id,
        text: input.text,
        message_id: crypto.randomUUID(), // fresh per attempt: a 502 retry must not be deduplicated
      };
      if (this.cfg.teammateId) body.teammate_id = this.cfg.teammateId;
      const res = await fetch(`${this.cfg.baseUrl}/v1/external-chat/messages`, {
        method: "POST", headers: this.headers(), body: JSON.stringify(body), signal: AbortSignal.timeout(90_000),
      });
      if ((res.status === 502 || res.status === 429) && attempt < 2) {
        const ra = Number(res.headers.get("retry-after"));
        await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 3000 * (attempt + 1));
        continue;
      }
      const text = await res.text();
      if (!res.ok) throw new Error(`chat ${res.status}: ${text.slice(0, 300)}`);
      const j = JSON.parse(text);
      return {
        thread_id: j.thread_id ?? null, reply: j.reply ?? null, agent_invoked: Boolean(j.agent_invoked),
        reason: j.reason ?? null, steps: Array.isArray(j.steps) ? j.steps : [],
      };
    }
  }

  // Cumulative credits for the workspace. debited_credits is the confirmed figure; fall back to the quote.
  async usage(): Promise<number> {
    const q = new URLSearchParams({ workspace_id: this.cfg.workspaceId });
    const res = await fetch(`${this.cfg.baseUrl}/v1/usage?${q}`, { headers: this.headers(), signal: AbortSignal.timeout(30_000) });
    const text = await res.text();
    if (!res.ok) throw new Error(`usage ${res.status}: ${text.slice(0, 300)}`);
    const j = JSON.parse(text);
    const n = j.debited_credits ?? j.quoted_credits ?? 0;
    return Number(n) || 0;
  }
}
