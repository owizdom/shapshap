# Go-live note for Ziggatech

ShapShap answers trade-in chats on your WhatsApp line. It prices the old iPhone with your website's formula and repair prices, offers phones from stock, takes the top-up on Paystack and gives a pickup code. Today it runs in a simulator, on test data.

## What it does not do

- Pay cash, arrange pickup, quote repairs or handle Android. Those customers go to the store.
- See the phone. Faults it cannot judge in chat, such as a dead charging chip or water, are priced provisionally. Every value is final only at the counter.
- Find a model the customer names. It offers up to three phones within their budget.

## Decide before go-live

- The cut for faults with no published repair price: now 20% for a charging chip, 40% for water, 60% for a phone that will not turn on.
- Your written policy for a phone worse than described. The agent tells customers it exists, and the top-up is already paid.

## Must be true before real customers

- A live Paystack account, and a WhatsApp Business number connected to Chord.
- Stock read from your real inventory.
- A counter check. Staff can match the order ref to its Paystack payment; checking the pickup code needs a lookup tool not yet built.
- Someone is alerted when two customers pay for one phone, the price sheet cannot be read, or a reply fails to arrive. Today nobody is.
- Prices change outside opening hours. An edit takes about 5 minutes to settle.

## When something fails

- Card declined: the customer is told plainly and offered a new link. Nothing is reserved.
- Paystack down: the customer is asked to try again later. Nothing is called paid.
- Price sheet unreadable: ShapShap uses its last good copy, or the prices bundled at deploy.
- Reply lost: seen in testing. The customer asked again and got the same link back.
