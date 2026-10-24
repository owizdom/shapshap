Role: Forward-deployed Engineering.

Ziggatech, an iPhone store in Ikeja, Lagos, takes old iPhones as part-payment, but its website offers 70% less for any phone that is not fully working, whatever the fault. My own iPhone 16 Plus 256GB stopped charging: in light wear the website offers ₦217,404 instead of ₦724,681, and its WhatsApp button hands the chat to staff with no field for the fault. ShapShap prices the actual fault on WhatsApp from the store's own repair prices, so the store never pays more than its working price minus its own repair cost, and it closes the upgrade with a Paystack payment and a pickup code. I deliberately left out what needs hands or the store's systems: the pickup inspection, cash payouts and live stock.

## 1. The agent

ShapShap is live on my Chord account. Chat with it in the simulator at https://chat.tsglabs.dev/c/AtKXDtG3IUa-sa9Pfi5i7FNO.

A full run takes four messages:

1. Describe an iPhone and what is wrong with it, with the most you can add. For example: "My iPhone 16 Plus 256GB won't charge, even wirelessly. I can add 300k."
2. Pick a phone from the list.
3. Say Find My is off on the old phone.
4. Pay on the Paystack test link by choosing Success, then say "I have paid". The agent checks Paystack and gives a pickup code.

Everything is test data: Paystack test mode, made-up stock and no real customers. A phone you pay for leaves the stock list, as it would in the shop.

## 2. Code

This repo. The [README](README.md) covers how to run it, how I used AI tools, and what stopped me.

## 3. Recording

[recording link]

## 4. Deployment field notes

[FIELD-NOTES.md](FIELD-NOTES.md)

1. Chord drops tool results between turns, so the agent re-ran its tools and disowned its own figures.
2. A reply with a payment link never reached the simulator chat.
3. The in-app chat shows Markdown that WhatsApp shows as literal asterisks.

## 5. Go-live note

[GO-LIVE.md](GO-LIVE.md)
