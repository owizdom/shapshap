# Go-live note for Ziggatech

ShapShap answers trade-in chats on your WhatsApp line. It values the old iPhone the way your website does, using your repair prices for a broken screen or camera, offers phones in stock, takes the top-up by card and gives a pickup code. Today it runs on test data.

## What it does not do

- Pay cash, arrange pickup, quote repairs or handle Android. Those customers are sent to the store.
- See the phone. Faults it cannot judge in chat, such as water damage, are priced as not final. Every price is final only at the counter.
- Find a model the customer names. It offers up to three phones they can afford.

## Decide before go-live

- How much to take off for faults you have no repair price for. Today: 20% for a charging fault, 40% for water damage, 60% for a phone that will not turn on.
- What you do when a phone arrives worse than described. The agent tells customers you have a written policy, and they will already have paid the top-up.

## Must be true before real customers

- A live Paystack account, and your WhatsApp Business number connected to Chord.
- Stock taken from your real inventory.
- A check at the counter. Staff can match the order ref in the chat to the payment in Paystack. Checking the pickup code itself is not built yet.
- Someone is told when two customers pay for the same phone, your price sheet cannot be read, or a reply does not arrive. Today nobody is.
- Prices changed only when the shop is closed. A change takes about 5 minutes to reach every chat.

## When something fails

- Card declined: the customer is told plainly and offered a new link. The phone is not held for them.
- Paystack down: the customer is asked to try again later. Nothing is marked as paid.
- Price sheet cannot be read: ShapShap uses the last prices it read, or the prices it was set up with.
- Reply never arrives: this happened in testing. The customer asked again and got the same payment link back.
