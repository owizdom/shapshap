Role: Forward-deployed Engineering.

Ziggatech, an iPhone store in Ikeja, Lagos, takes old iPhones as part-payment, but its calculator cuts any phone that does not "power on and function normally" to 30%: an iPhone 16 Plus 256GB in light wear drops from ₦724,681 to ₦217,404, whatever the fault. ShapShap answers the calculator's WhatsApp hand-off, asks what is wrong, and takes off Ziggatech's own published repair price for that fault, the repair-cost deduction its FAQ describes. No deduction is smaller than the store's repair price and no offer drops below the website's own figure, so the store can say yes to faulty phones it now prices out. I left out what needs hands or the store's systems: the pickup inspection, cash payouts and live stock.

## 1. The agent

ShapShap is live on my Chord account. Chat with it in the simulator at https://chat.tsglabs.dev/c/AtKXDtG3IUa-sa9Pfi5i7FNO.

A full run takes four messages:

1. Describe an iPhone and what is wrong with it, with the most you can add. For example: "My iPhone 16 Plus 256GB won't charge, even wirelessly. I can add 300k."
2. Pick a phone from the list.
3. Say Find My is off on the old phone.
4. Pay on the Paystack test link by choosing Success, then say "I have paid". The agent checks Paystack and gives a pickup code.

To start where a real customer starts, paste the message Ziggatech's calculator puts in its WhatsApp button for my phone. ShapShap names the website's ₦217,404, asks what is wrong and how much you can add, and prices the fault from your answer:

```
Hi Zigga, I'd like to trade in my *iPhone 16 Plus*.

- Storage: 256GB
- Screen: Light wear
- Sides and back: Light wear
- Battery: Healthy (80%+)
- Parts: All genuine
- Fully working: No

The website quoted me *up to ₦217,404*.

What's the next step?
```

Everything is test data: Paystack test mode, made-up stock and no real customers. A phone you pay for leaves the stock list, as it would in the shop.

## 2. Code

This repo. The [README](README.md) covers how to run it, how I used AI tools, and what stopped me.

## 3. Recording

https://drive.google.com/file/d/1w_Z9FURyHXPx-5FrGx7GGmkR77aF_66a/view?usp=sharing

## 4. Deployment field notes

[FIELD-NOTES.md](FIELD-NOTES.md)

1. The model retypes signed price tokens between tool calls; one dropped character in 144 copies cost a customer the whole answer.
2. A probe shows later turns cannot see earlier tool results: asked for a detail only a tool result had, the agent said it could not see its valuation and took back correct prices.
3. The simulator showed "No reply yet" for a reply Chord had produced; Chord's partner docs say a client should then read the history to recover it.

## 5. Go-live note

[GO-LIVE.md](GO-LIVE.md)
