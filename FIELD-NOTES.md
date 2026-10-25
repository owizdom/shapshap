# Deployment field notes

A harness ([`evals/`](evals/)) found most of these. It sends scripted customers through Chord's external chat API and keeps every reply, tool call, argument and result, at about 0.2 credits a scenario. [`evals/evidence/README.md`](evals/evidence/README.md) lists the file behind each note, and the probes are in [`evals/probes/`](evals/probes/).

## 1. The model retypes signed prices between tool calls, and one dropped character cost a customer the whole answer

#### What happened

On 24 October a scripted customer wrote "Hello, my iPhone 13 Pro 128GB back camera is blurry. I can add 250k." In one turn, `value_trade_in` returned a signed quote token of 334 characters and `find_phones` received 333: the model had dropped the third character of the signature. `find_phones` answered `QUOTE_INVALID`, and the only reply the customer received was:

> I'll re-run the valuation quietly.

Nothing followed in that turn. Every grader passed the run; I found it by reading the transcript.

#### How I found the cause

The tool signs each valuation and offer so the model cannot invent prices. To pass a token on, the model writes it out again in the next call's arguments. The two tokens differ by one deleted character ([`evals/evidence/token-copy-2026-10-24T05-23-59Z.json`](evals/evidence/token-copy-2026-10-24T05-23-59Z.json)). Across every live run I kept in full, the model copied a token 144 times in 17 runs and got 1 wrong ([`evals/probes/token-copies.ts`](evals/probes/token-copies.ts)).

#### Fix

A token with one wrong character is refused, so a bad copy costs a turn, never a wrong charge. The skill already says to value the phone again after `QUOTE_INVALID`; here the model wrote that it would and ended the turn instead. On my side, the next step is a short signed id with fewer characters to get wrong.

#### What I'd change in Chord

Let a tool mark an output field as opaque: Chord keeps the value, gives the model a short handle to pass on, and puts the real value into the next call. Any agent that hands signed prices, cart ids or idempotency keys between tools depends today on the model copying them exactly. Until then, the tool docs could say that values passed between tools are retyped by the model and should be short.

## 2. A later turn cannot see the earlier turn's tool results, so the agent disowns prices it got right

#### What happened

- In Chord's in-app chat on 21 October, the agent valued a phone and listed three phones from two tool calls. On my next message it wrote: "I need to correct my last message. I never ran a valuation for your phone ... Please ignore them."

  ![In-app chat: the reply after a two-step turn retracts its own figures](assets/field-notes/1-inapp-retraction.png)

- In the WhatsApp simulator the same day, I paid on the agent's Paystack link and wrote "I have paid". It replied: "I can't find the reference from your earlier checkout ... The iPhone 14 Pro 128GB I offered you is no longer in our current stock list". I had just bought that phone. It confirmed the payment only after I pasted the reference.

  ![Simulator: after payment the agent cannot find its own checkout reference](assets/field-notes/1-simulator-lost-reference.png)

#### How I found the cause

The harness showed later turns calling `value_trade_in` and `find_phones` again with the same phone details (9 of 14 later turns in the 21 October runs), and checkout used the new tokens.

![Eval run on 21 October: turn 2 repeats both tool calls, and checkout uses the turn 2 tokens](assets/field-notes/1-eval-turns.png)

Chord's docs say each call loads "the most recent 30 turns" and define a turn as "the inbound message and the reply produced for it". Whether tool results count is not stated, so a probe tests it ([`evals/probes/memory-probe.ts`](evals/probes/memory-probe.ts), 0.38 credits for two runs). Turn 1 gets a valuation whose tool result carries an exact expiry (in run 1, `valid_until: 2026-10-26T16:16:01.406Z`); the reply only says the price holds 48 hours. Turn 2 asks for the exact time. In 2 of 2 runs the agent made no tool call and began "I don't have an exact expiry date or time". In the same reply it took back the correct valuation. Run 1:

> I can't see any valuation results in this chat. Please don't rely on those amounts yet.

So later turns see the text of earlier replies but not the tool results behind them, and the agent reads its own figures as invented. Every turn also signs a fresh price, so the price lock lasts one turn.

#### Fix

- The order ref goes into the checkout message as text, and `confirm_payment` reads it from there. In the next simulator run, "paid" got pickup code 294036 with no reference asked for (Paystack `ss-ss-1501-ub3jg01s1wls`).
- The skill treats the agent's earlier messages as the record and never checks out an amount the customer has not seen: if a re-run gives a different figure, the agent shows it and asks again.

Later replies that apologise for, correct or cast doubt on the agent's own figures, counted with [`evals/evidence/count.ts`](evals/evidence/count.ts). Most apologise and then confirm the same figures; the probe replies retract them.

| Runs | Later replies |
|---|---|
| 21 Oct, first runs | 4 of 11 |
| 21 Oct, after a no-apology rule | 0 of 3 |
| 22 Oct | 3 of 12 |
| 24 Oct morning | 4 of 17 |
| 24 Oct afternoon | 1 of 34 |
| 24 Oct probe: the customer asks for a detail only a tool result had | 2 of 2 |

Prompt wording brings the rate down while the customer talks about what is in the chat, and fails once they ask for something that lived only in a tool result.

#### What I'd change in Chord

Next to "the most recent 30 turns" in the chat docs, say that tool results are not carried to later turns. Better, keep a one-line summary of each earlier tool call (name and key fields) in the context of later turns. The probe settles the question in one run and would make a good regression test on Chord's side.

## 3. The simulator showed "No reply yet" for a reply Chord had produced

#### What happened

On 22 October, in the simulator, the customer wrote "Yes, Find My is off." The chat showed typing, then "No reply yet. If someone has taken over in Chord, their reply will appear here." Nobody had taken over.

![Simulator: no reply after the Find My answer](assets/field-notes/2-reply-lost.png)

#### How I found the cause

- Vercel logs show three tool calls at 12:35:43, 12:35:47 and 12:35:53 UTC, priced from the tool's cached copy because the published Google Sheet had been timing out since 12:31.
- Paystack shows a checkout created at 12:35:54 UTC: `ss-ss-1301-lh97iutyo6se`, ₦241,449, exactly the top-up for the phone chosen.
- The customer wrote "Hello? I didn't get the payment link." The agent answered "Sorry about that. Here is the link again" with the same order ref. Each checkout gets a new random ref, seen only in that turn's tool result and reply. Tool results do not reach later turns (note 2), so Chord had produced and stored the reply.

![Simulator: the agent resends the same link and order ref](assets/field-notes/2-reply-resent.png)

Chord's partner chat docs say "a turn producing no reply returns status: "accepted" and reply: null" and tell clients to "read history to recover a reply after a timeout", but give the partner call no time budget. My API key lacks `thread:read`, so I could not see from Chord's side why the reply missed the chat. The reply existed, and the simulator did not recover it.

#### Fix

None in code. The customer got the link by asking again.

#### What I'd change in Chord

- After an `accepted` response with no reply, the simulator should read the thread's history, as the partner docs tell clients to.
- "No reply yet" should not suggest a takeover when the thread is still agent-controlled.
- Publish the partner endpoint's time budget. The tenant chat docs give 60 seconds, or 120 when streaming; the partner page gives none.
