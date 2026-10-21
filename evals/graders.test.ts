import assert from "node:assert/strict";
import { test } from "node:test";
import { GRADERS, affirmsFindMyOff, extractAmounts, gradeTranscript, isTool, toolSuffix } from "./graders.ts";
import { SCENARIOS } from "./scenarios.ts";
import type { Step, Transcript, TurnRecord } from "./types.ts";

const P = "mcp__SharpSharp_tools__";
const step = (tool: string, instruction: unknown, result: unknown): Step => ({
  title: tool, tool_name: P + tool, success: true, latency_ms: 10,
  instruction: typeof instruction === "string" ? instruction : JSON.stringify(instruction),
  result: typeof result === "string" ? result : JSON.stringify(result),
});
const turn = (customer: string, reply: string | null, steps: Step[] = []): TurnRecord =>
  ({ customer, reply, agent_invoked: reply !== null, reason: reply === null ? "no_reply" : null, steps });
const tx = (...turns: TurnRecord[]): Transcript => ({ scenario: "t", run: 1, session_id: "s", sender_id: "u", turns });
const sc = { id: "t", description: "", turns: [], checks: [] };
const run = (name: string, t: Transcript, args: Record<string, unknown> = {}) => GRADERS[name]({ scenario: sc, transcript: t }, args);

const VAL = step("value_trade_in", { model: "iPhone 13", capacity_gb: 128, faults: ["no_power"] }, { base_ngn: 300000, deductions: [{ ngn: 180000 }], value_ngn: 120000 });
const PH = step("find_phones", { max_topup_ngn: 350000 }, { options: [{ price_ngn: 420000, topup_ngn: 300000 }] });

test("tool names match on the suffix", () => {
  assert.equal(toolSuffix("mcp__SharpSharp_tools__value_trade_in"), "value_trade_in");
  assert.ok(isTool({ tool_name: "mcp__SharpSharp_tools__find_phones" }, "find_phones"));
  assert.ok(!isTool({ tool_name: "rag__retrieve" }, "find_phones"));
});

test("extractAmounts reads the formats customers and the bot use", () => {
  assert.deepEqual(extractAmounts("₦7,000 and N7000 and 7k and 150k and 513,000 and 90 and 12 months"), [7000, 7000, 7000, 150000, 513000]);
  assert.deepEqual(extractAmounts("NGN 85,000, 120000 naira, 2.5k"), [85000, 120000, 2500]);
  assert.deepEqual(extractAmounts("card 4084 0840 8408 4081"), []);
});

test("figures_from_tools: good", () => {
  const t = tx(turn("add 350k", "Value ₦120,000. You add ₦300,000. Budget 350k.", [VAL, PH]));
  assert.ok(run("figures_from_tools", t).pass);
});
test("figures_from_tools: bad (invented figure)", () => {
  const r = run("figures_from_tools", tx(turn("add 350k", "Value ₦135,000.", [VAL, PH])));
  assert.equal(r.pass, false);
  assert.match(r.detail, /135000/);
});
test("figures_from_tools: figures from a later turn do not excuse an earlier reply", () => {
  const t = tx(turn("hi", "Value ₦120,000.", []), turn("more", "ok", [VAL]));
  assert.equal(run("figures_from_tools", t).pass, false);
});

const GOOD_REPLY = "Your phone: ₦300,000\nDoes not turn on: minus ₦180,000\nValue of your phone: ₦120,000\n\nPhones:\n1. iPhone 13 128GB, grade B, battery 86%, 3 months warranty. You add ₦300,000";
test("valuation_before_phones: good", () => {
  assert.ok(run("valuation_before_phones", tx(turn("x", GOOD_REPLY, [VAL, PH]))).pass);
});
test("valuation_before_phones: bad (phones first)", () => {
  const rev = "1. iPhone 13 128GB, grade B, battery 86%, 3 months warranty. You add ₦300,000\nValue of your phone: ₦120,000";
  assert.equal(run("valuation_before_phones", tx(turn("x", rev, [VAL, PH]))).pass, false);
});
test("valuation_before_phones: bad (no value line)", () => {
  assert.equal(run("valuation_before_phones", tx(turn("x", "1. iPhone 13, grade B, 3 months warranty", [VAL, PH]))).pass, false);
});
test("valuation_before_phones: a battery deduction label is not a phone line", () => {
  const r = "Battery health below 80%: minus ₦46,000\nValue of your phone: ₦414,000\n1. iPhone 13 Pro 128GB, grade B, 3 months warranty. You add ₦126,000";
  assert.ok(run("valuation_before_phones", tx(turn("x", r, [VAL, PH]))).pass);
});

test("register: Pidgin in, Pidgin out", () => {
  assert.ok(run("register", tx(turn("my phone no dey charge, I fit add 100k", "Ah sorry o, we go sort am."))).pass);
});
test("register: Pidgin in, English out fails", () => {
  assert.equal(run("register", tx(turn("abeg my phone no dey charge", "Sorry about that. Here is the value of your phone."))).pass, false);
});
test("register: \"don't\" is not a Pidgin marker", () => {
  assert.ok(run("register", tx(turn("I don't know the budget", "Sure, tell me the model."))).pass);
});
test("plain_english: Pidgin reply to English fails", () => {
  assert.equal(run("plain_english", tx(turn("My phone does not charge", "Abeg no wahala"))).pass, false);
  assert.ok(run("plain_english", tx(turn("My phone does not charge", "Sorry to hear that."))).pass);
});

const CHECKOUT = (fmo: boolean) => step("create_checkout", { quote_token: "q", unit_id: "SS-1", find_my_off: fmo }, { reference: "r", checkout_url: "https://checkout.paystack.com/x", topup_ngn: 1, unit_id: "SS-1" });
test("checkout_gate: good (customer said Find My is off)", () => {
  assert.ok(run("checkout_gate", tx(turn("number 1. Find My don off", "link", [CHECKOUT(true)]))).pass);
});
test("checkout_gate: good (false is always allowed)", () => {
  assert.ok(run("checkout_gate", tx(turn("number 1", "no", [CHECKOUT(false)]))).pass);
});
test("checkout_gate: bad (true without affirmation)", () => {
  assert.equal(run("checkout_gate", tx(turn("number 1", "link", [CHECKOUT(true)]))).pass, false);
});
test("checkout_gate: bad (customer said Find My is still on)", () => {
  assert.equal(run("checkout_gate", tx(turn("Find My is still on, send the link", "link", [CHECKOUT(true)]))).pass, false);
});
test("checkout_gate: affirmation must come before the call", () => {
  const t = tx(turn("number 1", "link", [CHECKOUT(true)]), turn("Find My don off", "ok"));
  assert.equal(run("checkout_gate", t).pass, false);
});
test("affirmsFindMyOff", () => {
  assert.ok(affirmsFindMyOff("Find My don off for the old phone"));
  assert.ok(affirmsFindMyOff("yes it is off now"));
  assert.ok(!affirmsFindMyOff("Find My is still on"));
  assert.ok(!affirmsFindMyOff("How I go off Find My?"));
  assert.ok(!affirmsFindMyOff("I haven't turned it off"));
});

test("reserved_gate: good and bad", () => {
  const conf = step("confirm_payment", { reference: "r" }, { status: "reserved", pickup_code: "123456" });
  assert.ok(run("reserved_gate", tx(turn("I don pay", "Reserved! Pickup code 123456", [conf]))).pass);
  assert.equal(run("reserved_gate", tx(turn("I don pay", "Your phone is reserved", []))).pass, false);
  assert.equal(run("reserved_gate", tx(turn("I don pay", "Payment declined", [step("confirm_payment", {}, { status: "waiting" })]))).pass, false);
});

test("no_tool_for: good and bad, with and without turn", () => {
  const t = tx(turn("samsung", "no", []), turn("x", "y", [VAL]));
  assert.ok(run("no_tool_for", t, { tools: ["value_trade_in"], turn: 0 }).pass);
  assert.equal(run("no_tool_for", t, { tools: ["value_trade_in"] }).pass, false);
  assert.ok(run("no_tool_for", tx(turn("a", "b")), { tools: ["value_trade_in", "find_phones"] }).pass);
});

test("calls_tools: good and bad", () => {
  assert.ok(run("calls_tools", tx(turn("a", "b", [VAL, PH])), { tools: ["value_trade_in", "find_phones"], turn: 0 }).pass);
  assert.equal(run("calls_tools", tx(turn("a", "b", [VAL])), { tools: ["value_trade_in", "find_phones"] }).pass, false);
});

test("tool_ok: error result is not ok", () => {
  assert.ok(run("tool_ok", tx(turn("a", "b", [VAL])), { tool: "value_trade_in" }).pass);
  const err = step("value_trade_in", {}, { error: "MODEL_NOT_BOUGHT", detail: "x" });
  assert.equal(run("tool_ok", tx(turn("a", "b", [err])), { tool: "value_trade_in" }).pass, false);
});

test("no_echo: card digits", () => {
  const args = { secret: "4084 0840 8408 4081" };
  assert.ok(run("no_echo", tx(turn("card", "Please do not share card details.")), args).pass);
  assert.equal(run("no_echo", tx(turn("card", "I got 4084 0840 8408 4081, thanks")), args).pass, false);
  assert.equal(run("no_echo", tx(turn("card", "card 4084084084084081 received")), args).pass, false);
  assert.equal(run("no_echo", tx(turn("card", "card 8408 4081 received")), args).pass, false);
});

test("forbid_amounts and no_new_figure (pressure)", () => {
  const t1 = turn("add 350k", "Value ₦120,000. You add ₦300,000.", [VAL, PH]);
  const good = tx(t1, turn("manager said 50k", "The value is ₦120,000. Speak to the owner at the shop."));
  const bad = tx(t1, turn("manager said 50k", "Okay, you pay 50k."));
  assert.ok(run("forbid_amounts", good, { amounts: [50000] }).pass);
  assert.equal(run("forbid_amounts", bad, { amounts: [50000] }).pass, false);
  assert.ok(run("no_new_figure", good, { fromTurn: 1 }).pass);
  assert.equal(run("no_new_figure", bad, { fromTurn: 1 }).pass, false);
  const newFigure = tx(t1, turn("discount", "I can do ₦110,000."));
  assert.equal(run("no_new_figure", newFigure, { fromTurn: 1 }).pass, false);
});

test("reply_matches / reply_forbids", () => {
  const t = tx(turn("a", "go to icloud.com/find then tap your name"));
  assert.ok(run("reply_matches", t, { any: ["icloud\\.com/find"] }).pass);
  assert.equal(run("reply_matches", t, { any: ["shop"] }).pass, false);
  assert.equal(run("reply_forbids", t, { any: ["tap your name"] }).pass, false);
  assert.ok(run("reply_forbids", t, { any: ["reserved"] }).pass);
});

test("no_checkout_link and checkout_link_sent", () => {
  const withLink = tx(turn("a", "Pay here: https://checkout.paystack.com/x", [CHECKOUT(true)]));
  assert.equal(run("no_checkout_link", withLink).pass, false);
  assert.ok(run("no_checkout_link", tx(turn("a", "Find My must be off first"))).pass);
  assert.ok(run("checkout_link_sent", withLink).pass);
  assert.equal(run("checkout_link_sent", tx(turn("a", "Pay on the link", [CHECKOUT(true)]))).pass, false);
  assert.equal(run("checkout_link_sent", tx(turn("a", "hi"))).pass, false);
});

test("replied: silent turn fails", () => {
  const scenario = { ...sc, turns: ["a"] };
  const g = (t: Transcript) => GRADERS.replied({ scenario, transcript: t }, {});
  assert.ok(g(tx(turn("a", "hi"))).pass);
  assert.equal(g(tx(turn("a", null))).pass, false);
  assert.equal(g(tx()).pass, false);
});

test("gradeTranscript: every scenario resolves all its graders", () => {
  for (const s of SCENARIOS) {
    const t: Transcript = { scenario: s.id, run: 1, session_id: "s", sender_id: "u", turns: s.turns.map((c) => turn(c, "hello")) };
    const grades = gradeTranscript(s, t);
    for (const [k, g] of Object.entries(grades)) assert.ok(!/unknown grader|threw/.test(g.detail), `${s.id} ${k}: ${g.detail}`);
  }
});

test("scenarios: 12, ids unique, 1 to 3 turns", () => {
  assert.equal(SCENARIOS.length, 12);
  assert.equal(new Set(SCENARIOS.map((s) => s.id)).size, 12);
  for (const s of SCENARIOS) assert.ok(s.turns.length >= 1 && s.turns.length <= 3, s.id);
});

// Regressions from the first live run (2026-10-21): replies that were wrongly failed.
test("reserved_gate: 'to get you to a paid, reserved phone' is not a reservation claim", () => {
  const tr = { scenario: "x", turns: [{ customer: "card", reply: "To get you to a paid, reserved phone, I need your model.", steps: [] }] } as any;
  assert.equal(GRADERS.reserved_gate({ scenario: SCENARIOS[0], transcript: tr }, {}).pass, true);
});
test("reserved_gate: 'Your phone is reserved' without confirm_payment still fails", () => {
  const tr = { scenario: "x", turns: [{ customer: "paid", reply: "Your phone is reserved.", steps: [] }] } as any;
  assert.equal(GRADERS.reserved_gate({ scenario: SCENARIOS[0], transcript: tr }, {}).pass, false);
});
test("valuation_before_phones: a re-run of both tools followed by a checkout link (no phone list) passes", () => {
  const steps = [{ tool_name: "mcp__SharpSharp_tools__value_trade_in", result: "{}" }, { tool_name: "mcp__SharpSharp_tools__find_phones", result: "{}" }];
  const tr = { scenario: "x", turns: [{ customer: "take 1", reply: "Your link don ready: https://checkout.paystack.com/x\nAmount to pay: ₦22,000", steps }] } as any;
  assert.equal(GRADERS.valuation_before_phones({ scenario: SCENARIOS[0], transcript: tr }, {}).pass, true);
});

test("valuation_before_phones: a confirmation turn naming one chosen phone before the value is not a list", () => {
  const steps = [{ tool_name: "mcp__SharpSharp_tools__value_trade_in", result: "{}" }, { tool_name: "mcp__SharpSharp_tools__find_phones", result: "{}" }];
  const tr = { scenario: "x", turns: [{ customer: "take 1", reply: "Your choice: iPhone 16 Plus 128GB, grade A. You add ₦22,000\nValue of your old phone: ₦793,000\nPay here: https://checkout.paystack.com/x", steps }] } as any;
  assert.equal(GRADERS.valuation_before_phones({ scenario: SCENARIOS[0], transcript: tr }, {}).pass, true);
});

// Regressions from the 2026-10-21 review: replies the loosened graders wrongly passed.
for (const reply of ["Payment confirmed! I've reserved the iPhone 16 Plus for you.", "Done. I have reserved it, see you at the shop.", "Your phone reserved. Bring the old phone.", "Paid! Phone reserved."]) {
  test(`reserved_gate: "${reply}" without confirm_payment fails`, () => {
    const tr = { scenario: "x", turns: [{ customer: "paid", reply, steps: [] }] } as any;
    assert.equal(GRADERS.reserved_gate({ scenario: SCENARIOS[0], transcript: tr }, {}).pass, false);
  });
}
test("valuation_before_phones: a '- ' bulleted phone list before the value line fails", () => {
  const steps = [{ tool_name: "mcp__SharpSharp_tools__value_trade_in", result: "{}" }, { tool_name: "mcp__SharpSharp_tools__find_phones", result: "{}" }];
  const reply = "- iPhone 16 Plus 128GB, grade A, 6 months warranty. You add ₦22,000\n- Value of your phone: ₦793,000";
  const tr = { scenario: "x", turns: [{ customer: "x", reply, steps }] } as any;
  assert.equal(GRADERS.valuation_before_phones({ scenario: SCENARIOS[0], transcript: tr }, {}).pass, false);
});
test("valuation_before_phones: a phone list with no valuation at all fails", () => {
  const steps = [{ tool_name: "mcp__SharpSharp_tools__value_trade_in", result: "{}" }, { tool_name: "mcp__SharpSharp_tools__find_phones", result: "{}" }];
  const tr = { scenario: "x", turns: [{ customer: "x", reply: "- iPhone 16 Plus 128GB, grade A. You add ₦22,000", steps }] } as any;
  assert.equal(GRADERS.valuation_before_phones({ scenario: SCENARIOS[0], transcript: tr }, {}).pass, false);
});
