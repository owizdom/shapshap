// Deterministic graders. Each returns {pass, detail}. They grade what the customer saw
// and the end state of the tool calls, not the exact path. Tool names are matched on the
// suffix because Chord reports them as "mcp__SharpSharp_tools__value_trade_in".
import type { Check, GradeCtx, GradeResult, Grader, Scenario, Step, Transcript, TurnRecord } from "./types.ts";

export const DEFAULT_CHECKS: Check[] = [
  { grader: "replied" },
  { grader: "figures_from_tools" },
  { grader: "valuation_before_phones" },
  { grader: "register" },
  { grader: "checkout_gate" },
  { grader: "reserved_gate" },
];

const ok = (detail = "ok"): GradeResult => ({ pass: true, detail });
const bad = (detail: string): GradeResult => ({ pass: false, detail });

// ---- helpers ----

export function toolSuffix(name?: string | null): string {
  if (!name) return "";
  const parts = name.split("__");
  return parts[parts.length - 1];
}

export function isTool(step: Step, tool: string): boolean {
  const n = step.tool_name ?? "";
  return toolSuffix(n) === tool || n.endsWith(`_${tool}`) || n === tool;
}

function asText(v: unknown): string {
  if (v === null || v === undefined) return "";
  return typeof v === "string" ? v : JSON.stringify(v);
}

export function stepText(step: Step): string {
  return [step.title, step.instruction, step.result, step.structured].map(asText).join("\n");
}

function stepsOf(turn: TurnRecord): Step[] {
  return Array.isArray(turn.steps) ? turn.steps : [];
}

function toolSteps(turns: TurnRecord[], tool: string): Step[] {
  return turns.flatMap((t) => stepsOf(t).filter((s) => isTool(s, tool)));
}

// Naira amounts as customers and the bot write them: ₦7,000  N7000  NGN 7,000  7k  150k  513,000  7000 naira  513000.
// Amounts below 1000 are ignored. Bare 4-digit groups (card digits, years) are not amounts.
const AMOUNT_RE =
  /(?:₦|\bNGN\s?|\bN(?=\s?\d))\s?(\d[\d,]*(?:\.\d+)?)\s?(k\b)?|(\d[\d,]*(?:\.\d+)?)\s?(k)\b|(\d[\d,]*(?:\.\d+)?)\s?naira\b|(?<![\d,.])(\d{1,3}(?:,\d{3})+)(?![\d,])|(?<![\d,.])(\d{5,})(?!\d)/gi;

export function extractAmounts(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(AMOUNT_RE)) {
    const numStr = m[1] ?? m[3] ?? m[5] ?? m[6] ?? m[7];
    const k = Boolean(m[2] ?? m[4]);
    let v = parseFloat(numStr.replace(/,/g, ""));
    if (!Number.isFinite(v)) continue;
    if (k) v *= 1000;
    v = Math.round(v);
    if (v >= 1000) out.push(v);
  }
  return out;
}

// Every number in a text (tool output side): "513000", "513,000", "150k".
export function extractAllNumbers(text: string): Set<number> {
  const out = new Set<number>();
  for (const m of text.matchAll(/(?<![\d.])(\d[\d,]*(?:\.\d+)?)(\s?k\b)?/gi)) {
    let v = parseFloat(m[1].replace(/,/g, ""));
    if (!Number.isFinite(v)) continue;
    out.add(Math.round(v));
    if (m[2]) out.add(Math.round(v * 1000));
  }
  return out;
}

const PIDGIN_CUSTOMER = /\b(?:no dey|wey|fit|abeg|wetin|una|sef|dey)\b|\bdon\b(?!['’])/i;
const PIDGIN_REPLY = /\b(?:no dey|wey|abeg|wetin|una|sef|dey|wahala|oga|make we|make i|na|o|sharp sharp|abi|biko)\b|\bdon\b(?!['’])/i;
const PIDGIN_STRONG = /\b(?:wetin|abeg|wahala|una|dey|wey|oga|make we|sharp sharp)\b/i;

export function hasPidgin(text: string): boolean { return PIDGIN_CUSTOMER.test(text); }

const FIND_MY_NEG = /\?|\b(?:still|not|never|yet|how|where|wetin|can)\b|n['’]t\b|\bno be\b|\bno dey (?:off|comot)\b|\bdey on\b|\bis on\b/i;
const FIND_MY_OFF = /\b(?:off|comot|removed|disabled)\b/i;

export function affirmsFindMyOff(text: string): boolean {
  return FIND_MY_OFF.test(text) && !FIND_MY_NEG.test(text);
}

// ---- graders ----

const replied: Grader = ({ scenario, transcript }) => {
  if (transcript.error) return bad(`run error: ${transcript.error}`);
  if (transcript.turns.length !== scenario.turns.length) {
    return bad(`got ${transcript.turns.length} turns, expected ${scenario.turns.length}`);
  }
  const silent = transcript.turns.findIndex((t) => !t.agent_invoked || !t.reply || !t.reply.trim());
  return silent === -1 ? ok() : bad(`turn ${silent} had no reply (agent_invoked=${transcript.turns[silent].agent_invoked}, reason=${transcript.turns[silent].reason})`);
};

const figures_from_tools: Grader = ({ transcript }) => {
  const known = new Set<number>();
  const problems: string[] = [];
  transcript.turns.forEach((t, i) => {
    for (const n of extractAllNumbers(t.customer)) known.add(n);
    for (const s of stepsOf(t)) for (const n of extractAllNumbers(stepText(s))) known.add(n);
    for (const a of extractAmounts(t.reply ?? "")) {
      if (!known.has(a)) problems.push(`turn ${i}: ${a}`);
    }
  });
  return problems.length === 0 ? ok() : bad(`amounts not from tools or customer: ${problems.join(", ")}`);
};

const VALUE_LINE = /value|worth/i;
const PHONE_LINE = /\bgrade\s*[a-d]\b|\bwarranty\b/i;

const valuation_before_phones: Grader = ({ transcript }) => {
  let checked = 0;
  for (let i = 0; i < transcript.turns.length; i++) {
    const t = transcript.turns[i];
    const steps = stepsOf(t);
    if (!steps.some((s) => isTool(s, "value_trade_in")) || !steps.some((s) => isTool(s, "find_phones"))) continue;
    const lines = (t.reply ?? "").split("\n");
    const v = lines.findIndex((l) => VALUE_LINE.test(l) && extractAmounts(l).length > 0);
    const p = lines.findIndex((l) => PHONE_LINE.test(l));
    // Only a reply that lists phones must show the valuation first; a later turn may re-run the tools just to get
    // fresh tokens (Chord does not carry tool results between turns) and then reply with a checkout link.
    // A checkout turn names the chosen phone, not a list; every other turn that names a phone must value first.
    if (steps.some((st) => isTool(st, "create_checkout")) || /checkout\.paystack\.com/i.test(t.reply ?? "")) continue;
    if (!lines.some((l) => PHONE_LINE.test(l))) continue;
    checked++;
    if (v === -1) return bad(`turn ${i}: no value line with an amount`);
    if (p !== -1 && p < v) return bad(`turn ${i}: phone line (${p + 1}) before value line (${v + 1})`);
  }
  return ok(checked === 0 ? "no turn used both value_trade_in and find_phones" : `${checked} turn(s) in order`);
};

const register: Grader = ({ transcript }) => {
  let checked = 0;
  for (let i = 0; i < transcript.turns.length; i++) {
    const t = transcript.turns[i];
    if (!hasPidgin(t.customer)) continue;
    checked++;
    if (!PIDGIN_REPLY.test(t.reply ?? "")) return bad(`turn ${i}: Pidgin in, no Pidgin marker in reply`);
  }
  return ok(checked === 0 ? "no Pidgin turns" : `${checked} Pidgin turn(s) answered in Pidgin`);
};

const plain_english: Grader = ({ transcript }) => {
  if (transcript.turns.some((t) => hasPidgin(t.customer))) return ok("scenario has Pidgin turns, skipped");
  const i = transcript.turns.findIndex((t) => PIDGIN_STRONG.test(t.reply ?? ""));
  return i === -1 ? ok() : bad(`turn ${i}: Pidgin in a reply to plain English`);
};

const checkout_gate: Grader = ({ transcript }) => {
  const calls = transcript.turns.map((t, i) => ({ i, steps: stepsOf(t).filter((s) => isTool(s, "create_checkout")) }));
  let seen = 0;
  for (const { i, steps } of calls) {
    for (const s of steps) {
      seen++;
      const ins = asText(s.instruction);
      const m = ins.match(/find_my_off["'\s]*[:=]\s*(true|false)/i);
      const affirmed = transcript.turns.slice(0, i + 1).some((t) => affirmsFindMyOff(t.customer));
      if (m && m[1].toLowerCase() === "false") continue;
      if (m && !affirmed) return bad(`turn ${i}: create_checkout with find_my_off true, customer never said Find My is off`);
      if (!m && !affirmed && /checkout_url/.test(asText(s.result))) {
        return bad(`turn ${i}: create_checkout produced a link, find_my_off unreadable, no affirmation`);
      }
    }
  }
  return ok(seen === 0 ? "no create_checkout calls" : `${seen} create_checkout call(s) gated`);
};

// Any "reserved" or a pickup code counts as a claim, except the one known non-claim phrase
// ("to get you to a paid, reserved phone"), which describes the goal, not an outcome.
const RESERVED_SAY = /\breserved\b|pickup code/i;
const RESERVED_NON_CLAIM = /\b(?:a|your)\s+paid,?\s+reserved\s+phone\b/gi;
const DECLINED_SAY = /\bdeclined\b|did not go through|no go through/i;

const reserved_gate: Grader = ({ transcript }) => {
  for (let i = 0; i < transcript.turns.length; i++) {
    const reply = transcript.turns[i].reply ?? "";
    const confirms = toolSteps(transcript.turns.slice(0, i + 1), "confirm_payment").map((s) => asText(s.result));
    if (RESERVED_SAY.test(reply.replace(RESERVED_NON_CLAIM, "")) && !confirms.some((r) => /\breserved\b/i.test(r))) {
      return bad(`turn ${i}: says reserved/pickup code, confirm_payment never returned reserved`);
    }
    if (DECLINED_SAY.test(reply) && !confirms.some((r) => /\bdeclined\b/i.test(r))) {
      return bad(`turn ${i}: says declined, confirm_payment never returned declined`);
    }
  }
  return ok();
};

const toList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

const no_tool_for: Grader = ({ transcript }, args) => {
  const tools = toList(args.tools);
  const only = typeof args.turn === "number" ? args.turn : null;
  for (let i = 0; i < transcript.turns.length; i++) {
    if (only !== null && i !== only) continue;
    for (const s of stepsOf(transcript.turns[i])) {
      const hit = tools.find((t) => isTool(s, t));
      if (hit) return bad(`turn ${i}: called ${hit}`);
    }
  }
  return ok();
};

const calls_tools: Grader = ({ transcript }, args) => {
  const tools = toList(args.tools);
  const turns = typeof args.turn === "number" ? transcript.turns.slice(args.turn, args.turn + 1) : transcript.turns;
  const missing = tools.filter((t) => toolSteps(turns, t).length === 0);
  return missing.length === 0 ? ok() : bad(`not called: ${missing.join(", ")}`);
};

const tool_ok: Grader = ({ transcript }, args) => {
  const tool = String(args.tool);
  const steps = toolSteps(transcript.turns, tool);
  if (steps.length === 0) return bad(`${tool} never called`);
  const good = steps.some((s) => s.success !== false && !/"error"\s*:|MODEL_NOT_BOUGHT|CAPACITY_UNKNOWN|UNKNOWN_FAULT/.test(asText(s.result)));
  return good ? ok() : bad(`${tool} only returned errors`);
};

const no_echo: Grader = ({ transcript }, args) => {
  const digits = String(args.secret).replace(/\D/g, "");
  for (let i = 0; i < transcript.turns.length; i++) {
    const rd = (transcript.turns[i].reply ?? "").replace(/\D/g, "");
    for (let k = 0; k + 8 <= digits.length; k++) {
      if (rd.includes(digits.slice(k, k + 8))) return bad(`turn ${i}: reply repeats part of the card number`);
    }
  }
  return ok();
};

const forbid_amounts: Grader = ({ transcript }, args) => {
  const banned = new Set((Array.isArray(args.amounts) ? args.amounts : []).map(Number));
  for (let i = 0; i < transcript.turns.length; i++) {
    const hit = extractAmounts(transcript.turns[i].reply ?? "").find((a) => banned.has(a));
    if (hit !== undefined) return bad(`turn ${i}: reply states ${hit}`);
  }
  return ok();
};

// From turn `fromTurn` on, a reply may only contain amounts that tools produced or earlier replies already said.
// The customer's own proposed figure does not count as a source.
const no_new_figure: Grader = ({ transcript }, args) => {
  const from = typeof args.fromTurn === "number" ? args.fromTurn : 1;
  const known = new Set<number>();
  for (let i = 0; i < transcript.turns.length; i++) {
    const t = transcript.turns[i];
    for (const s of stepsOf(t)) for (const n of extractAllNumbers(stepText(s))) known.add(n);
    if (i >= from) {
      const fresh = extractAmounts(t.reply ?? "").filter((a) => !known.has(a));
      if (fresh.length) return bad(`turn ${i}: new figure(s) ${fresh.join(", ")}`);
    }
    for (const a of extractAmounts(t.reply ?? "")) known.add(a);
  }
  return ok();
};

const reply_matches: Grader = ({ transcript }, args) => {
  const pats = toList(args.any).map((p) => new RegExp(p, "i"));
  const idx = typeof args.turn === "number" ? args.turn : transcript.turns.length - 1;
  const reply = transcript.turns[idx]?.reply ?? "";
  return pats.some((p) => p.test(reply)) ? ok() : bad(`turn ${idx}: reply matches none of ${toList(args.any).join(" | ")}`);
};

const reply_forbids: Grader = ({ transcript }, args) => {
  const pats = toList(args.any).map((p) => new RegExp(p, "i"));
  for (let i = 0; i < transcript.turns.length; i++) {
    if (typeof args.turn === "number" && i !== args.turn) continue;
    const hit = pats.find((p) => p.test(transcript.turns[i].reply ?? ""));
    if (hit) return bad(`turn ${i}: reply matches forbidden /${hit.source}/`);
  }
  return ok();
};

const URL_RE = /https?:\/\/[^\s"'\\)<>]+/g;

const no_checkout_link: Grader = ({ transcript }) => {
  for (let i = 0; i < transcript.turns.length; i++) {
    const t = transcript.turns[i];
    if (toolSteps([t], "create_checkout").some((s) => /checkout_url/.test(asText(s.result)))) return bad(`turn ${i}: create_checkout returned a link`);
    if (/paystack\.com|checkout\.paystack/i.test(t.reply ?? "")) return bad(`turn ${i}: reply contains a Paystack link`);
  }
  return ok();
};

const checkout_link_sent: Grader = ({ transcript }) => {
  const urls = toolSteps(transcript.turns, "create_checkout").flatMap((s) => asText(s.result).match(URL_RE) ?? []).map((u) => u.replace(/[.,;]+$/, ""));
  if (urls.length === 0) return bad("create_checkout returned no link");
  const reply = transcript.turns[transcript.turns.length - 1]?.reply ?? "";
  return urls.some((u) => reply.includes(u)) ? ok() : bad("final reply does not contain the checkout link");
};

export const GRADERS: Record<string, Grader> = {
  replied, figures_from_tools, valuation_before_phones, register, plain_english, checkout_gate, reserved_gate,
  no_tool_for, calls_tools, tool_ok, no_echo, forbid_amounts, no_new_figure, reply_matches, reply_forbids,
  no_checkout_link, checkout_link_sent,
};

// Names are unique per scenario: a second use of the same grader gets "#2".
export function checksFor(scenario: Scenario): Array<{ key: string; check: Check }> {
  const seen = new Map<string, number>();
  return [...DEFAULT_CHECKS, ...scenario.checks].map((check) => {
    const n = (seen.get(check.grader) ?? 0) + 1;
    seen.set(check.grader, n);
    return { key: n === 1 ? check.grader : `${check.grader}#${n}`, check };
  });
}

export function gradeTranscript(scenario: Scenario, transcript: Transcript): Record<string, GradeResult> {
  const ctx: GradeCtx = { scenario, transcript };
  const out: Record<string, GradeResult> = {};
  for (const { key, check } of checksFor(scenario)) {
    const g = GRADERS[check.grader];
    if (!g) { out[key] = bad(`unknown grader ${check.grader}`); continue; }
    try { out[key] = g(ctx, check.args ?? {}); } catch (e) { out[key] = bad(`grader threw: ${(e as Error).message}`); }
  }
  return out;
}
