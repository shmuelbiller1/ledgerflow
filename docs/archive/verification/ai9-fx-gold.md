# FX-GOLD — foreign currency with worked figures (AI #9, 21 Oct 2026)

`src/tests/fx-gold.test.ts`, real database, USD books, through invoice and bill posting,
`POST /transactions/revaluation/run`, `POST /payments` with the day's rate and the report routes.

| Date | Event | Entry (cents) |
|---|---|---|
| 2025-03-10 | INV-E1 €1,000.00 at 1.10 | A/R 110,000 / Sales 110,000 |
| 2025-03-20 | B-E1 €500.00 at 1.10 | Supplies 55,000 / A/P 55,000 |
| 2025-03-31 | revaluation at 1.15 | A/R +5,000; A/P +2,500 owed; unrealized gain 2,500 |
| 2025-04-01 | its reversal | the same lines turned round |
| 2025-04-15 | INV-E1 paid €1,000 at 1.12 | Checking +112,000; A/R −110,000; realized gain 2,000 |
| 2025-04-20 | B-E1 paid €500 at 1.08 | Checking −54,000; A/P +55,000; realized gain 1,000 |

- Balance sheet 31 Mar: A/R 115,000 = A/P 57,500 + profit 57,500; 1 Apr: 110,000 = 55,000 + 55,000 (reversed);
  30 Apr: Checking 58,000 = profit 58,000.
- P&L March 57,500; April −2,500 (reversal) + 3,000 (realized) = 500.
- The same date cannot be revalued twice.
