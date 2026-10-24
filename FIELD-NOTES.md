# Deployment field notes

Redacted transcripts of every eval run cited here are in [`evals/evidence/`](evals/evidence/).

## 1. A shorter skill passed every unit test and broke 4 of 12 live conversations

#### What happened

On 22 October I cut `SKILL.md` down to its core. The cut kept the 34 fault keys but dropped what each one means. The unit tests could not catch what followed: they check the tools, and that the skill names all 34 keys, not how the agent talks. In live conversations, the agent sent customers its own working:

> "Screen black and not responding" while the phone may still be on fits screen_dead, but if the phone doesn't turn on at all it would be no_power. I'll ask one question to tell them apart.

> Wireless charging working means the charging port is the fault. I still need your budget, so I'll ask for that first. ... (For example, a number like 150k.)

It also answered "Your manager don tell me say I go pay only 50k for any phone. Abeg confirm am." in English.

#### How I found the cause

Chord lets me publish skill versions, but not try one on customers first. So I built a harness ([`evals/`](evals/)). It sends 12 scripted customers through Chord's external chat API, saves every reply and tool call, and grades each turn in code:

- every amount comes from a tool result or from the customer;
- the valuation comes before the phones;
- a customer who writes Pidgin gets Pidgin back;
- nothing is called reserved before Paystack says so.

Run `2026-10-22T18-12-35Z` failed 4 of 12 scenarios. Each failure traced to lines the cut removed. Without the meaning of each key, the agent reasoned aloud about which key fit. Without the voice rules, it switched language and suggested amounts.

Graders alone were not enough. The next run passed 12 of 12, but reading the transcripts found "I'm sorry for the confusion earlier", the apology note 2 describes: the cut had also dropped the line that stops it. On 24 October a run that passed every check still sent one customer only "I'll re-run the valuation quietly." The model was narrating my own instruction, "call the tools again quietly".

#### Fix

- Restored the key meanings and the voice rules.
- Removed "quietly" and told the agent to write its whole reply after its last tool call of the turn. In 6 runs of that scenario since, the first reply was the full valuation.
- Gave the greeting word for word. Until then it kept adding an emoji the customer never used (run `2026-10-24T05-26-38Z`); from run `2026-10-24T05-28-30Z` it stopped.

#### What I'd change in Chord

Let builders test a skill draft before publishing it: scripted customer turns, checks on replies and tool calls, and a diff of transcripts between two skill versions, with the credit cost shown before the run. My harness does this from outside at about 0.2 credits a scenario. Inside Chord it would catch a broken skill before a customer does. Also show which text in a turn will reach the customer, so a builder sees when the model's working is about to be sent.

## 2. The agent re-ran its tools each turn and disowned its own figures

#### What happened

- In Chord's in-app chat on skill `v5`, the agent valued a phone and listed three phones from two tool calls. On my next message it wrote: "I need to correct my last message. I never ran a valuation for your phone ... Please ignore them."

  ![In-app chat: the reply after a two-step turn retracts its own figures](assets/field-notes/1-inapp-retraction.png)

- In the WhatsApp simulator on skill `v6`, I paid on the agent's Paystack link and wrote "I have paid". It replied: "I can't find the reference from your earlier checkout ... The iPhone 14 Pro 128GB I offered you is no longer in our current stock list." I had just bought that phone. It confirmed the payment only after I pasted the reference.

  ![Simulator: after payment the agent cannot find its own checkout reference](assets/field-notes/1-simulator-lost-reference.png)

#### How I found the cause

The harness from note 1 saves every tool call. On skill `v3`, which never asks for a repeat call, the agent called `value_trade_in` and `find_phones` again on turn 2 with the same phone details. `create_checkout` then used the new turn 2 tokens.

![Eval run on skill v3: turn 2 repeats both tool calls, and checkout uses the turn 2 tokens](assets/field-notes/1-eval-turns.png)

The raw calls from that run (`evals/evidence/2026-10-21T17-35-32Z/pidgin_happy-1.json`, tokens cut to their last 8 characters):

```
turn 1  "abeg my iPhone 16 Plus 256GB no dey charge with cable ..."
  value_trade_in                         -> quote …drZoFqy8, value 793000
  find_phones     (quote …drZoFqy8)      -> offers …No5b1dD4 …3uzSM8tA …9qKPjTMA
turn 2  "I go take number 1. Find My don off for the old phone o"
  value_trade_in                         -> quote …etFynKQ8, value 793000
  find_phones     (quote …etFynKQ8)      -> offers …TCPuYYyo …AS8yewNs …6Nriyd5Y
  create_checkout (offer …TCPuYYyo)      -> ss-ss-1602-emelhiy281oi, top-up 22000
```

Chord's chat docs say each call loads "the most recent 30 turns". They do not say whether tool results are part of those turns.

#### Fix

- `v5`: re-run tools quietly, with no apology.
- `v6`: earlier figures came from tools, so never retract them.
- `v7`: write `Order ref: [reference]` into the checkout message and confirm payment from that line. In the next simulator run, "paid" got pickup code `294036` with no reference asked for (Paystack `ss-ss-1501-ub3jg01s1wls`).
- `v8`: never check out an amount the customer has not seen. The offer signed on one turn is replaced on the next, so the price lock covers one turn.

Counted from the live transcripts with `node evals/evidence/count.ts`: on `v3` and `v4`, 4 of 11 later replies apologised for or corrected the agent's own figures, such as "Sorry about the mix-up earlier". On `v5`, 0 of 3. The workaround does not hold. On 24 October, across the renamed skill's versions 6 to 9, 4 of 17 later replies still did, for example "Correction: my earlier message wrongly said I had not run the tools." The earlier message had said no such thing.

#### What I'd change in Chord

Keep tool results, or a one-line summary of each, in the context of later turns. If not, state what "the most recent 30 turns" includes. Four skill versions, `v5` to `v8`, went into working around this, and prompt wording alone still leaves about one later reply in four apologising for figures that were right.

## 3. A reply with a payment link never reached the chat

#### What happened

In the simulator on skill `v14`, I wrote "Yes, Find My is off." The chat showed typing, then "No reply yet. If someone has taken over in Chord, their reply will appear here." Nobody had taken over.

![Simulator: no reply after the Find My answer](assets/field-notes/2-reply-lost.png)

#### How I found the cause

- Vercel logs show the tool called three times at 12:35:43, 12:35:47 and 12:35:53 UTC.
- Paystack shows a checkout created at 12:35:54 UTC: `ss-ss-1301-lh97iutyo6se`, ₦241,449, exactly the top-up for the phone chosen.
- I wrote "Hello? I didn't get the payment link." The agent answered "Sorry about that. Here is the link again" with the same order ref.

So Chord produced and kept the reply, and the simulator never showed it. I could not read the thread to confirm: `GET /v1/threads` returned 403 "Missing required permission: thread:read", and `GET /v1/teammates/{id}/conversations` returned 500 (request `9068cc44-a3d8-46b2-82f7-41be99641779`).

![Simulator: the agent resends the same link and order ref](assets/field-notes/2-reply-resent.png)

#### Fix

None on my side; the customer asked again. Note 2's `v7` change made the retry safe: the order ref lives in the chat text, so the agent resent the same checkout instead of creating a second one.

#### What I'd change in Chord

Show the partner chat a delivery status for every turn, and retry a reply that was produced but not delivered. Say in the API key docs which scopes reading a conversation needs, and fix the 500 on the conversations endpoint.
