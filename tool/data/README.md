# Price data

The shop is made up; its prices follow the Lagos used-iPhone market as of 21 October 2026.

- `trade-in-prices.csv`: what SharpSharp pays for a working phone. Mostly the buy prices Ziggatech (Ikeja) publishes on [its sell page](https://ziggatech.com/pages/sell-iphone), with missing storage sizes scaled by the ratio between Jiji Lagos listing medians.
- `stock.csv`: phones for sale, priced inside the range of [Jiji Lagos used listings](https://jiji.ng/lagos/mobile-phones) for the same model and storage.
- `faults.csv`: the share of the base price taken off for each fault. Where a repair price exists it sets the deduction ([Vanguard on Computer Village repair costs](https://www.vanguardngr.com/2026/10/why-many-nigerians-spend-more-on-phone-repairs-than-buying-new-phones/), [Ziggatech screen prices](https://ziggatech.com/blogs/ziggatech-deck/iphone-screen-replacement-cost-in-nigeria-2026-all-models)). Faults with no published repair price, and the minimum the shop pays for any phone, are the shop's own policy.

The naira traded near ₦1,365 to the dollar on the parallel market that week ([Arbiterz](https://arbiterz.com/naira-dollar-rate-20th-october-2026-naira-closes-at-%E2%82%A61365-in-parallel-market)), so these figures date quickly. To reprice, edit the CSVs and redeploy the tool; Vercel bundles them at deploy time.
