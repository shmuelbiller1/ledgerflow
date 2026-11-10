# AU-4 — import acceptance by reconciliation (AI #9, 21 Oct 2026)

**Screen:** Reports → Import Acceptance (`ImportAcceptanceView`). Upload the old system's trial balance for the date
the books moved (QuickBooks: Reports → Trial Balance → Export to CSV, or any file with Debit and Credit columns);
LedgerFlow's trial balance on that date (the existing `GET /reports/trial-balance`, no server change) is set against
it by `src/lib/importAcceptance.ts`:
- each account, matched by code (QuickBooks writes "1200 Accounts Receivable (A/R)") or by the same name, never by
  guess; a balance that differs, a source line with no account here, an account here the source does not have — each
  named with its amount;
- the totals: trial balance (debits), A/R, A/P (trade, without the tax-payable account), cash and bank, and tax
  payable (the workspace's "Sales tax payable" default account);
- the source file itself: its total row must be the sum of its lines, and it must balance.
"Accepted" only when every account and every total agrees and the file has no problem.

**Worked figures** (`src/tests/au4-import-acceptance.test.tsx`, cents): the source as of 2026-03-31 has Checking
500,000, Petty Cash 25,000, A/R 150,000 DR; A/P 80,000, tax 12,000, Opening Balance Equity 525,000, revenue 58,000 CR
(675,000 each side). The same books → accepted. An import with a 300.00 invoice missing, an 800.00 bill imported
twice (to an account the source lacks) and Petty Cash never created → A/R −30,000, A/P −80,000, OBE +25,000,
revenue +30,000, Office Supplies +80,000 (not in the source), Petty Cash −25,000 (not in LedgerFlow); TB 675,000 vs
700,000; cash and tax agree.
