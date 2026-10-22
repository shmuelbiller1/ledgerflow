# D-98 · W10 backup → restore → exact report parity

## Worked figures (USD, cents, January 2026)
Same as AI8 verification, verified against `src/server/reports/computeReports.ts`:

- Accounts (openingBalanceCents):
  - `1000 Cash` asset opening $10,000.00 (1_000_000c)
  - `1200 Accounts Receivable` asset opening $0
  - `2000 Accounts Payable` liability opening $0
  - `3000 Retained Earnings` equity opening $10,000.00
  - `4000 Sales` income opening $0
  - `6000 Office Expense` expense opening $0

- Transactions in the backup (posted, status=completed, type=actual):
  - t1 2026-01-05 Sale  +$3,600.00 → debit Receivables 360000 / credit Sales -360000
  - t2 2026-01-10 Office expense +$600.00 → debit Office Expense 60000 / credit Cash -60000

Derived exactly as `computeProfitAndLoss`, `computeBalanceSheet`, `computeTrialBalance` do:
- P&L income = -amt for income lines = 360000; expense = amt for expense lines = 60000 → net 300000 → $3,000.00
- BS assets = Cash 940000 (1_000_000-60000) + Receivables 360000 = 1_300_000 → $13,000.00; liabilities 0; equity 1_000_000; net 300000 → claims 1_300_000 → balanced
- TB debits = opening Cash 1_000_000 + Receivables 360000 + Office Expense 60000 = 1_420_000 → $14,200.00; credits same (equity 1_000_000 + Sales 360000 + Cash credit 60000) → balanced

Mutation after backup:
- t3 2026-01-20 Extra expense +$2,750.00 → debit Office Expense 275000 / credit Cash -275000
- net = 360000-335000=25000 → $250.00; assets= Cash 665000 + Receivables 360000=1_025_000→$10,250.00; TB=1_695_000→$16,950.00

Restore removes t3 → exact backup figures again (no cent lost).

## Browser journey
`e2e/w10-backup-restore-reports.spec.ts` mounts the real `ProfitAndLossView` (startDate 2026-01-01 endDate 2026-01-31), `BalanceSheetView` (asOfDate 2026-01-31, accounts+formatCurrency) and `TrialBalanceView` (asOfDate 2026-01-31) from the app source against `useLedgerStore` seeded with the accounts/transactions above. Report API calls are stubbed 500 so screens show local calculation (posting verified by server suites). Backup payload is fetched via `GET /api/v1/workspaces/w10-backup/export` stub and restore via `POST /restore` stub; the ledger mutation is applied via `setLedgerField` as the live subscription would.

Steps verified (390px and 1280px):
1. P&L shows $3,000.00, with $3,600.00 income and $600.00 expense lines.
2. Balance Sheet shows $13,000.00 total assets = $13,000.00 claims, "Balanced".
3. Trial Balance shows $14,200.00 debits = credits, "Balanced Double-Entry".
4. Export payload has 2 transactions, 6 accounts.
5. After adding t3, P&L $250.00, BS $10,250.00, TB $16,950.00.
6. After restore (setLedgerField back to 2 txs), P&L $3,000.00 / BS $13,000.00 / TB $14,200.00 again.
7. Axe serious/critical 0 on restored TB table.

Parity checked on both viewports (phone 390, desktop 1280) and light theme.

## Constraints
No server money logic changed; Vercel preview red is intentional (owner stopped merges).
