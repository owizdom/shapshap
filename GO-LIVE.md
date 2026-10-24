# Go-live note for Ziggatech

ShapShap answers trade-in chats on WhatsApp. It values the old iPhone using your repair prices, offers phones in stock, takes the top-up by card and gives a pickup code. Today it runs on test data.

## What it does not do

- Pay cash, arrange pickup, quote repairs or handle Android. It sends those customers to the store.
- See the phone. Every price is final only at the counter.

## Before real customers

- WhatsApp: Meta must verify your business and display name, which can take weeks. The number cannot also be on the WhatsApp app.
- Paystack: activate as a Registered Business with your CAC documents. A Starter account stops after ₦8,000,000 in total.
- Your developer switches to the live key. You make one small real payment and refund it.
- Load your real stock.

## Decide first

- Cuts for faults with no repair price. Today, for example: 5% for a loose charging port, 20% for a dead charging chip, 40% for water damage, 60% for a phone that will not turn on.
- What happens when a phone arrives worse than described, after the customer has paid.
- Who is told when something fails. Today nobody is.

## When something fails

- Card declined or Paystack down: the customer tries again and nothing is held.
- Price sheet unreadable: customers see the last prices read. Fix the sheet, and edit prices after closing.
- Reply never arrives: the customer asks again and gets the same link. Find the order ref in Paystack.

For the first week, read every chat daily, match each payment to a pickup, and count the faulty-phone chats and how many end in a sale. To stop ShapShap, pause it in Chord and answer chats yourself.
