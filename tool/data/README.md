# Price data

Modelled on Ziggatech (Ikeja), not affiliated; its prices follow the Lagos used-iPhone market as of 21 October 2026.

- `trade-in-prices.csv`: what the store pays for a flawless, working phone, from the pricing formula on [Ziggatech's trade-in calculator](https://ziggatech.com/pages/iphone-funnel) (base price times storage steps), plus Ziggatech's published screen and camera repair prices from [its repair page](https://ziggatech.com/pages/repair-iphone). Read 22 October 2026.
- `stock.csv`: phones for sale, priced inside the range of [Jiji Lagos used listings](https://jiji.ng/lagos/mobile-phones) for the same model and storage.
- `faults.csv`: the share taken off the working price for each fault. Where Ziggatech publishes a repair price for the part (`repair` column), the deduction is at least that price. The other percentages are demo policy, partly informed by [Vanguard on Computer Village repair costs](https://www.vanguardngr.com/2026/10/why-many-nigerians-spend-more-on-phone-repairs-than-buying-new-phones/).

The naira traded near ₦1,365 to the dollar on the parallel market that week ([Arbiterz](https://arbiterz.com/naira-dollar-rate-20th-october-2026-naira-closes-at-%E2%82%A61365-in-parallel-market)), so these figures date quickly. To reprice, edit the owner's Google Sheet; these CSVs are the fallback, bundled at deploy time.
