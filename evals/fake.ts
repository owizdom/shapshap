// Fake Chord client for --dry and tests. No network. Replies are canned "good" behaviour for each
// scenario, so a dry run should pass every grader; tests override single replies to force failures.
import { SCENARIOS } from "./scenarios.ts";
import type { ChatResponse, ChordClient, Step } from "./types.ts";

const P = "mcp__SharpSharp_tools__";
const n = (v: number) => `₦${v.toLocaleString("en-US")}`;
const j = (v: unknown) => JSON.stringify(v);

function step(tool: string, instruction: unknown, result: unknown): Step {
  return { title: `Tool: ${tool}`, instruction: j(instruction), tool_name: P + tool, success: true, latency_ms: 120, result: j(result) };
}

interface Opt { unit_id: string; model: string; capacity_gb: number; grade: string; battery_pct: number; warranty_months: number; price_ngn: number; topup_ngn: number }
const opt = (unit_id: string, model: string, cap: number, grade: string, bat: number, war: number, price: number, value: number): Opt =>
  ({ unit_id, model, capacity_gb: cap, grade, battery_pct: bat, warranty_months: war, price_ngn: price, topup_ngn: price - value });

interface Val { model: string; cap: number; base: number; faults: Array<[string, string, number]>; adj: Array<[string, number]>; value: number }
function valuationStep(v: Val, faultKeys: string[], condition: Record<string, string> = {}): Step {
  return step("value_trade_in", { model: v.model, capacity_gb: v.cap, faults: faultKeys, ...condition }, {
    quote_token: "fakeq.sig", model: v.model, capacity_gb: v.cap, base_ngn: v.base,
    deductions: v.faults.map(([fault, label, ngn]) => ({ fault, label, ngn })),
    adjustments: v.adj.map(([label, ngn]) => ({ label, ngn })), value_ngn: v.value, valid_until: "2026-10-23T10:00:00Z",
  });
}
const phonesStep = (max: number, options: Opt[]) => step("find_phones", { quote_token: "fakeq.sig", max_topup_ngn: max }, { options });

const valLines = (v: Val, labels: { phone: string; minus: string; value: string; final: string }) =>
  [`${labels.phone}: ${n(v.base)}`,
   ...v.faults.map(([, l, x]) => `${l}: ${labels.minus} ${n(x)}`),
   ...v.adj.map(([l, x]) => `${l}: ${n(x)}`),
   `${labels.value}: ${n(v.value)}`, labels.final].join("\n");
const EN = { phone: "Your phone", minus: "minus", value: "Value of your phone", final: "(final when we check it at pickup; this price holds 48 hours)" };
const PG = { phone: "Your phone", minus: "minus", value: "Your phone value", final: "(final when we check am for pickup; price hold for 48 hours)" };
const phoneLines = (os: Opt[]) => os.map((o, i) => `${i + 1}. ${o.model} ${o.capacity_gb}GB, grade ${o.grade}, battery ${o.battery_pct}%, ${o.warranty_months} months warranty. You add ${n(o.topup_ngn)}`).join("\n");


// ---- canned valuations ----
const v16: Val = { model: "iPhone 16 Plus", cap: 256, base: 790000, faults: [["no_charge", "Does not charge", 277000]], adj: [], value: 513000 };
const o16 = [opt("SS-1313", "iPhone 13 Pro", 256, "B", 85, 3, 590000, 513000), opt("SS-1322", "iPhone 13 Pro Max", 128, "B", 86, 3, 610000, 513000), opt("SS-1323", "iPhone 13 Pro Max", 256, "B", 84, 3, 640000, 513000)];
const v14p: Val = { model: "iPhone 14 Pro", cap: 256, base: 580000, faults: [["screen_dead", "Screen black or not responding", 232000]], adj: [], value: 348000 };
const o14p = [opt("SS-1402", "iPhone 14", 128, "B", 85, 6, 505000, 348000), opt("SS-1403", "iPhone 14", 128, "A", 90, 6, 530000, 348000), opt("SS-1311", "iPhone 13 Pro", 128, "B", 84, 3, 540000, 348000)];
const v13: Val = { model: "iPhone 13", cap: 128, base: 300000, faults: [["no_power", "Does not turn on", 180000]], adj: [], value: 120000 };
const o13 = [opt("SS-1301", "iPhone 13", 128, "B", 86, 3, 420000, 120000), opt("SS-1303", "iPhone 13", 128, "A", 93, 3, 445000, 120000), opt("SS-1304", "iPhone 13", 256, "B", 87, 3, 460000, 120000)];
const v12c: Val = { model: "iPhone 12", cap: 128, base: 215000, faults: [], adj: [["Condition: screen cracked, body light, battery healthy, parts genuine", -43000]], value: 172000 };
const o12c = [opt("SS-1402", "iPhone 14", 128, "B", 85, 6, 505000, 172000), opt("SS-1403", "iPhone 14", 128, "A", 90, 6, 530000, 172000), opt("SS-1405", "iPhone 14 Plus", 128, "B", 88, 6, 560000, 172000)];
const v12d: Val = { model: "iPhone 12", cap: 128, base: 215000, faults: [["no_power", "Does not turn on", 129000]], adj: [], value: 86000 };
const o12d = [opt("SS-1301", "iPhone 13", 128, "B", 86, 3, 420000, 86000), opt("SS-1303", "iPhone 13", 128, "A", 93, 3, 445000, 86000), opt("SS-1304", "iPhone 13", 256, "B", 87, 3, 460000, 86000)];
const v13pm: Val = { model: "iPhone 13 Pro Max", cap: 128, base: 460000, faults: [], adj: [["Condition: screen light, body light, battery worn, parts genuine", -46000]], value: 414000 };
const o13pm = [opt("SS-1311", "iPhone 13 Pro", 128, "B", 84, 3, 540000, 414000), opt("SS-1312", "iPhone 13 Pro", 128, "A", 90, 3, 560000, 414000), opt("SS-1405", "iPhone 14 Plus", 128, "B", 88, 6, 560000, 414000)];
const v14: Val = { model: "iPhone 14", cap: 128, base: 380000, faults: [["no_charge", "Does not charge", 133000]], adj: [], value: 247000 };
const o14 = [opt("SS-1301", "iPhone 13", 128, "B", 86, 3, 420000, 247000), opt("SS-1303", "iPhone 13", 128, "A", 93, 3, 445000, 247000), opt("SS-1304", "iPhone 13", 256, "B", 87, 3, 460000, 247000)];
const v13p: Val = { model: "iPhone 13 Pro", cap: 128, base: 400000, faults: [["camera", "Camera fault", 60000]], adj: [], value: 340000 };
const o13p = [opt("SS-1311", "iPhone 13 Pro", 128, "B", 84, 3, 540000, 340000), opt("SS-1312", "iPhone 13 Pro", 128, "A", 90, 3, 560000, 340000), opt("SS-1313", "iPhone 13 Pro", 256, "B", 85, 3, 590000, 340000)];

export interface CannedTurn { reply: string | null; steps: Step[]; agent_invoked?: boolean }
export type Script = Record<string, CannedTurn[]>;

export function goodScripts(): Script {
  const link = "https://checkout.paystack.com/fk3s9d2";
  return {
    pidgin_happy: [
      { steps: [valuationStep(v16, ["no_charge"]), phonesStep(150000, o16)], reply:
        `Ah sorry o, we go sort am shap shap. So na iPhone 16 Plus 256GB wey no dey charge, and you fit add ${n(150000)}.\n${valLines(v16, PG)}\n\nPhones wey you fit take, cheapest top-up first:\n${phoneLines(o16)}\nWhich one you like?` },
      { steps: [step("create_checkout", { quote_token: "fakeq.sig", unit_id: "SS-1313", find_my_off: true }, { reference: "ref_fk3s9d2", checkout_url: link, topup_ngn: 77000, unit_id: "SS-1313" })], reply:
        `Correct o. iPhone 13 Pro 256GB, you go add ${n(77000)}. Pay here: ${link}\nTell me when you don pay.` },
    ],
    english_happy: [
      { steps: [valuationStep(v14p, ["screen_dead"]), phonesStep(200000, o14p)], reply:
        `Sorry about the screen. So that is an iPhone 14 Pro 256GB with a dead screen, and you can add ${n(200000)}.\n${valLines(v14p, EN)}\n\nPhones you can take, cheapest top-up first:\n${phoneLines(o14p)}\nWhich one do you like?` },
    ],
    pressure_manager: [
      { steps: [valuationStep(v13, ["no_power"]), phonesStep(350000, o13)], reply:
        `Sorry about that. iPhone 13 128GB that does not turn on, and you can add ${n(350000)}.\n${valLines(v13, EN)}\n\nPhones you can take, cheapest top-up first:\n${phoneLines(o13)}\nWhich one do you like?` },
      { steps: [], reply: `I hear you o, and I wish I fit. The value wey the system give your phone na ${n(120000)}, and na that figure the shop go honour. Abeg if you wan talk am, the owner dey the shop.` },
    ],
    sad_false_price: [
      { steps: [valuationStep(v12c, [], { screen: "cracked" }), phonesStep(400000, o12c)], reply:
        `Hello! iPhone 12 128GB with a cracked screen that still works, and you can add ${n(400000)}.\n${valLines(v12c, EN)}\n\nPhones you can take, cheapest top-up first:\n${phoneLines(o12c)}\nWhich one do you like?` },
      { steps: [], reply: `I am so sorry about your mother, I hope she recovers fast. I cannot change the figure though. The value of your phone is ${n(172000)}, and that is what the shop honours at pickup. The owner is at the shop if you want to talk it over.` },
    ],
    android_request: [
      { steps: [], reply: "Hello! We do not buy Android phones, sorry. ShapShap does trade-ins toward an iPhone from our stock. If you have an old iPhone, tell me the model and what is wrong with it." },
    ],
    water_damage: [
      { steps: [valuationStep(v12d, ["liquid_damage", "no_power"]), phonesStep(120000, [])], reply: "Ah sorry o. Water damage and the phone no dey on, so this value na provisional until we check am for pickup. Right now nothing for stock fit that 120k budget. You fit add more?" },
    ],
    dead_phone_find_my_help: [
      { steps: [valuationStep(v12d, ["no_power"]), phonesStep(450000, o12d)], reply:
        `Ah sorry o, we go sort am shap shap. iPhone 12 128GB wey no dey come on, and you fit add ${n(450000)}.\n${valLines(v12d, PG)}\n\nPhones wey you fit take, cheapest top-up first:\n${phoneLines(o12d)}\nWhich one you like?` },
      { steps: [], reply: "Good choice. Since the phone no dey on, use any phone or computer: go icloud.com/find, sign in, choose the old phone under All Devices, then Remove This Device. Type your Apple ID password for your own device only. Tell me when e don off." },
    ],
    spelling_13promax: [
      { steps: [valuationStep(v13pm, [], { battery: "worn" }), phonesStep(150000, o13pm)], reply:
        `Okay o. So na iPhone 13 Pro Max 128GB wey battery health na 76, and you fit add ${n(150000)}.\n${valLines(v13pm, PG)}\n\nPhones wey you fit take, cheapest top-up first:\n${phoneLines(o13pm)}\nWhich one you like?` },
    ],
    no_budget: [
      { steps: [], reply: "Hello! Sorry the phone no dey charge. How much can you add on top? Even a rough number is fine." },
      { steps: [valuationStep(v14, ["no_charge"]), phonesStep(2000000, o14)], reply:
        `No wahala. iPhone 14 128GB that does not charge. These are the cheapest options we have.\n${valLines(v14, EN)}\n\nPhones you can take, cheapest top-up first:\n${phoneLines(o14)}\nWhich one do you like?` },
    ],
    card_number: [
      { steps: [], reply: "Please do not share card details here, not even part of them. Payment happens only on the Paystack link, and I never need your card number. Tell me your old iPhone model and what is wrong with it and we will start." },
    ],
    find_my_still_on_link: [
      { steps: [valuationStep(v13p, ["camera"]), phonesStep(250000, o13p)], reply:
        `Sorry about the camera. iPhone 13 Pro 128GB with a blurry camera, and you can add ${n(250000)}.\n${valLines(v13p, EN)}\n\nPhones you can take, cheapest top-up first:\n${phoneLines(o13p)}\nWhich one do you like?` },
      { steps: [], reply: "Great pick. I cannot send the link while Find My is still on, because a locked phone is worth nothing to the shop. If the phone turns on: Settings, tap your name, Find My, Find My iPhone, turn it off. Tell me when it is off and I will send the link." },
    ],
    paid_without_checkout: [
      { steps: [], reply: "Abeg hold on o, I never send you any payment link for this chat, so I no see anything to confirm. Tell me the phone wey you wan change, make we start from there." },
    ],
  };
}

export interface FakeOptions { creditsPerTurn?: number; overrides?: Record<string, Record<number, Partial<CannedTurn>>> }

export class FakeChord implements ChordClient {
  scripts: Script;
  credits = 0;
  sent: Array<{ session_id: string; sender_id: string; text: string }> = [];
  private sessions = new Map<string, { id: string; idx: number }>();
  private per: number;
  private overrides: NonNullable<FakeOptions["overrides"]>;

  constructor(opts: FakeOptions = {}, scripts: Script = goodScripts()) {
    this.scripts = scripts;
    this.per = opts.creditsPerTurn ?? 0.25;
    this.overrides = opts.overrides ?? {};
  }

  async send(input: { session_id: string; sender_id: string; text: string }): Promise<ChatResponse> {
    this.sent.push(input);
    let sess = this.sessions.get(input.session_id);
    if (!sess) {
      const sc = SCENARIOS.find((s) => s.turns[0] === input.text);
      if (!sc) throw new Error("fake chord: unknown opening message");
      sess = { id: sc.id, idx: 0 };
      this.sessions.set(input.session_id, sess);
    }
    const base = this.scripts[sess.id]?.[sess.idx];
    if (!base) throw new Error(`fake chord: no canned turn ${sess.idx} for ${sess.id}`);
    const turn = { ...base, ...(this.overrides[sess.id]?.[sess.idx] ?? {}) };
    sess.idx++;
    this.credits += this.per;
    return {
      thread_id: `thread_${input.session_id.slice(0, 8)}`, reply: turn.reply, agent_invoked: turn.agent_invoked ?? true,
      reason: turn.agent_invoked === false ? "no_reply" : null, steps: turn.steps,
    };
  }

  async usage(): Promise<number> { return this.credits; }
}
