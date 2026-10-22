# Go-live note for Ziggatech

ShapShap answers trade-in chats on WhatsApp. It values the old iPhone the way your website does, using your repair prices for a broken screen or camera, offers phones in stock, takes the top-up by card and gives a pickup code. Today it runs on test data.

## What it does not do

- Pay cash, arrange pickup, quote repairs or handle Android. It sends those customers to the store.
- See the phone. Faults it cannot judge in chat, such as water damage, are priced as not final. Every price is final only at the counter.

## Before real customers

- WhatsApp: Meta must verify the business and approve its display name, which can take weeks. The number cannot be on the WhatsApp app; moving your current number means deleting it from the app first.
- Paystack: activate as a Registered Business with your CAC documents. A Starter account stops taking payments after ₦8,000,000 in total.
- Your developer switches to the live Paystack key. You make one small real payment and refund it.
- Stock comes from your real inventory, and staff can match an order ref to its payment at the counter.

## Decide before go-live

- How much to take off for faults with no repair price. Today: 20% for a charging fault, 40% for water damage, 60% for a phone that will not turn on.
- What you do when a phone arrives worse than described. Customers are told you have a written policy, and they have already paid.
- One person who is told when two customers pay for one phone, the price sheet fails or a reply does not arrive. Today nobody is.

## First week

Start with staff and a few customers. Read every chat each day, and match each Paystack payment to a pickup.

## When something fails

| What happens | The customer | You |
|---|---|---|
| Card declined | Gets a new link; the phone is not held | Nothing |
| Paystack down | Is asked to try again later | Nothing |
| Price sheet unreadable | Sees the last prices read | Fix the sheet; change prices only after closing, a change takes 5 minutes |
| Reply never arrives | Asks again and gets the same link | Find the order ref in Paystack |

To stop ShapShap, pause it in Chord and answer chats yourself.
