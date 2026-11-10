# YEAR-END-GOLD — a full year, closed and closed again (AI #9, 21 Oct 2026)

`src/tests/year-end-gold.test.ts`, real database, the app's own code (opening-balance route, invoice and bill posting,
`POST /payments`, the December depreciation run, `POST /transactions/close-year`, the month reopen, the report routes).

| 2025 | Entry (cents) |
|---|---|
| 01-01 opening | Checking 1,000,000 / Opening Balance Equity 1,000,000 |
| 01-15 equipment | Equipment 120,000 / Checking 120,000 (5 years: 2,000 a month from February) |
| INV-1 03-10, paid 04-20 | Sales 300,000; Checking +300,000 |
| B-1 04-05, paid 05-01 | Supplies 80,000; Checking −80,000 |
| INV-2 11-20 (open) · B-2 12-10 (open) | Sales 200,000 · Supplies 50,000 |
| December depreciation run | 11 × 2,000 = 22,000 |

- 2025 profit 500,000 − 130,000 − 22,000 = **348,000** (P&L and close-year agree); the year is locked and a posting
  dated 2025-12-20 is refused.
- The next year opens (balance sheet 2026-01-01): Checking 1,100,000 + A/R 200,000 + Equipment 120,000 −
  Accumulated Depreciation 22,000 = **1,398,000** = A/P 50,000 + Opening Balance Equity 1,000,000 + retained earnings
  348,000; 2026's P&L starts at 0.
- Trial balance 2025-12-31: **2,152,000 = 2,152,000**, each account's debits and credits as worked out.
- December reopened (lock back to 2025-11-30), the year closed again: 348,000 again, the same balance sheet and trial
  balance, two close records with the same profit.

Note: close-year posts no closing entry (CA-07); retained earnings are the profit to date on the balance sheet.
