# Evidence

Start with these files; the run folders behind them are only needed to recount.

| Field note | File |
|---|---|
| 1. A retyped token loses one character | [token-copy-2026-10-24T05-23-59Z.json](token-copy-2026-10-24T05-23-59Z.json): both tokens, the error and the only reply the customer got |
| 2. Later turns cannot see tool results | [probe-2026-10-24T16-15-55Z/memory-probe-1.json](probe-2026-10-24T16-15-55Z/memory-probe-1.json): the probe transcript; `node evals/evidence/count.ts` recounts the table |
| Also hit: the shorter skill | [2026-10-22T18-12-35Z/summary.md](2026-10-22T18-12-35Z/summary.md): 4 of 12 scenarios failed |
| The calculator hand-off | [2026-10-24T15-48-53Z/summary.md](2026-10-24T15-48-53Z/summary.md): the full set on the current skill, 14 of 14 |

Note 3's evidence is in Vercel's logs and Paystack, outside the repo; its screenshots are in `assets/field-notes/`.

Every other folder is one live eval run, named by its UTC start time, with one JSON transcript per scenario run and a `summary.md`. Tokens are cut to their last 8 characters, checkout links are removed, and session and sender ids are dropped.
