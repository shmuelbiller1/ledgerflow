# Top-to-bottom accounting-program audit — coverage register

**Pinned code:** `9b815a58ebbe1d0f99c44f908ee77b7faa73705`. **Overall status: IN PROGRESS; not an audit opinion or release approval.** Maintain a separate result for each function, caller, and end-to-end workflow; never infer correctness merely because a file is indexed or an existing test passes.

## File-level tracking

[INVENTORY.csv](INVENTORY.csv) contains **3,694 tracked source/configuration/test files** selected at this revision under `src`, `supabase`, `api`, `sdk`, `scripts`, `e2e`, `assistant`, `.github`, and the root entry/config files, with their Git blob IDs.

- **195 PARTIAL**, meaning some code or behavior was inspected and/or executed in diagnostic tests, *not* that the entire file or subsystem is approved.
- **3,499 NOT REVIEWED in this audit.** Earlier audits in `audit/` or `docs/verification/` have not been adopted as current conclusions without independent rechecking.
- **0 files certified fully reviewed** under a line-by-line, all-callers, all-branches certification standard. No function-level completion percentage is claimed.

Areas in the inventory: 1,458 tests/fixtures; 1,045 application/shared library files; 605 screens; 365 server files; 86 configuration/support files; 67 migrations; 57 tax files; and 11 ledger/posting files.

## Workflow coverage and order

Every row remains open until its UI, validation, authorization, persistence, reports, exports, failure/retry, reversal, and independently worked accounting cases have been examined. “PARTIAL” never means all scenarios are correct.

| Order | Part | Status in this audit | Next work |
|---|---|---|---|
| 1 | Accounting primitives, sign, currency, rounding, dates, posting validators | PARTIAL — [core ledger](CORE-LEDGER-REVIEW.md), [idempotency](FIXED-ASSETS-AND-IMPORTS-REVIEW.md) | Address `CL-01`, `CL-02`, `ID-01` (`#942` headerless retry duplicates); finish all validator callers |
| 2 | Chart of accounts, opening balances, journals, loans, and corrections | PARTIAL — [loans & minor units](LOANS-AND-MINOR-UNITS-REVIEW.md) | Address `MU-01`, `LN-01`, `LN-02`; inspect remaining journal/template editors and audit replays |
| 3 | Sales, invoices, deposits, deferrals, orders/deliveries, credits, and refunds | PARTIAL — [credits](CREDITS-REVIEW.md), [deferrals](DEFERRALS-REVIEW.md), [deliveries](STATUTORY-TAX-BACKUP-AND-DELIVERY-REVIEW.md) | Address `CR-01/02`, `DR-01/02`, `DL-01`, `RC-01`; finish quotes/blanket orders/progress billing |
| 4 | Purchases, bills, payables, vendor credits, and withholding | PARTIAL — [assets from bills](FIXED-ASSETS-AND-IMPORTS-REVIEW.md), [Form 856](STATUTORY-TAX-BACKUP-AND-DELIVERY-REVIEW.md) | Address `FA-02`, `IL-01`, `IL-02`; finish three-way PO matching, approvals, and reverse-charge bills |
| 5 | Payments, allocations, bank feeds, bank imports, and reconciliation | PARTIAL — [payments](PAYMENTS-REVIEW.md), [bank feed](BANK-FEED-SLICE.md), [reconciliation](RECONCILIATION-REVIEW.md), [CAMT.053](FIXED-ASSETS-AND-IMPORTS-REVIEW.md) | Address `PM-01–04`, `BR-01–05`, `IM-01`, and Plaid cursor/row-drop behavior |
| 6 | Stock, COGS, landed costs, fixed assets, depreciation, and disposals | PARTIAL — [inventory](INVENTORY-REVIEW.md), [fixed assets](FIXED-ASSETS-AND-IMPORTS-REVIEW.md), [deliveries](STATUTORY-TAX-BACKUP-AND-DELIVERY-REVIEW.md) | Address `INV-01/02`, `FA-01/02`, `DL-01`, `BK-01`; finish asset transfers, partial disposals, and landed-cost allocations |
| 7 | Trial balance, P&L, balance sheet, cash flow, aging, consolidation, and exports | PARTIAL — [reporting](REPORTING-REVIEW.md), [consolidation](GROUP-CONSOLIDATION-REVIEW.md) | Address `RP-01–08`, `GC-01–03`, `DL-01`; inspect drilldown (`explain.ts`), budgets, and PDFs |
| 8 | US tax, information returns, use tax, and payroll | PARTIAL — [initial tax](REPORT.md), [payroll](PAYROLL-AND-CA-REVIEW.md), [use tax](US-USE-TAX-REVIEW.md) | Address `AR-01, AR-04–06`, `PY-01–03`, `UT-01–02`; verify remaining state/local tables |
| 9 | Israeli VAT, invoices, Form 856 withholding, PCN874, and Open Format | PARTIAL — [initial tax](REPORT.md), [Form 856](STATUTORY-TAX-BACKUP-AND-DELIVERY-REVIEW.md) | Address `AR-02/03`, `IL-01`, `IL-02`; `pcn874Draft` and `uniformStructure` remain non-filing research/draft modules (`filingReady: false`) |
| 10 | UK, EU, Canadian, and other international tax modules | PARTIAL — [Canada](PAYROLL-AND-CA-REVIEW.md), [UK/EU export & intra-EU](STATUTORY-TAX-BACKUP-AND-DELIVERY-REVIEW.md) | Address `CA-01`, `TX-01`; scope intra-EU OSS/B2B rules explicitly before enabling |
| 11 | Period close, adjustments, year-end pack, and reporting cutoffs | PARTIAL — [period close](PERIOD-CLOSE-REVIEW.md) | Address `PC-01`; verify `yearEndPack` downstream of `RP-01`/`FA-01` and concurrent close/reopen |
| 12 | Access, permissions, tenant isolation, database triggers, and migrations | PARTIAL — RLS script + DB trigger inspection (`lf_stock_move_db_seq`, `lf_repost_mark`, `lf_asset_accounting_guard`, `lf_inventory_cost_guard`) | Full migration-by-migration and hosted Supabase RLS verification remains open |
| 13 | Import/export, backups and restore, recurring jobs, and integrations | PARTIAL — [backup/restore & recurring](STATUTORY-TAX-BACKUP-AND-DELIVERY-REVIEW.md), [CAMT.053](FIXED-ASSETS-AND-IMPORTS-REVIEW.md) | Address `BK-01`, `IM-01`, `RC-01`; finish QBO/Xero/CSV migration balance proofs (`W11`) |
| 14 | UI/release-gate claims, performance gates, and operational readiness | PARTIAL — `docs/RELEASE_GATE.md` & `docs/CAPABILITIES.md` cross-checked against verified counterexamples | Reconcile Stage A "READY" claims (`W2–W6, W9, W10`) with `ID-01`, `BK-01`, `MU-01`, `DR-01/02`, `BR-01–05`, `DL-01`, `RP-01–08`; investigate `A-229` cold import budget |

## Documented review slices

- [Initial tax & 1099 review](REPORT.md): `AR-01`–`AR-06`.
- [US dated use-tax review](US-USE-TAX-REVIEW.md): `UT-01`, `UT-02`.
- [Core ledger FX review](CORE-LEDGER-REVIEW.md): `CL-01`, `CL-02`.
- [Bank-feed sync slice](BANK-FEED-SLICE.md): malformed posted row dropped while cursor advances.
- [Payments & allocations review](PAYMENTS-REVIEW.md): `PM-01`–`PM-04`.
- [Credits & refunds review](CREDITS-REVIEW.md): `CR-01`, `CR-02`.
- [Deferral schedules review](DEFERRALS-REVIEW.md): `DR-01`, `DR-02`.
- [Bank reconciliation review](RECONCILIATION-REVIEW.md): `BR-01`–`BR-05`.
- [Group consolidation review](GROUP-CONSOLIDATION-REVIEW.md): `GC-01`–`GC-03`.
- [Inventory & COGS review](INVENTORY-REVIEW.md): `INV-01`, `INV-02`.
- [Period-close review](PERIOD-CLOSE-REVIEW.md): `PC-01`.
- [Reporting, aging & cash-basis review](REPORTING-REVIEW.md): `RP-01`–`RP-08`.
- [Payroll & Canadian historical HST review](PAYROLL-AND-CA-REVIEW.md): `PY-01`–`PY-03`, `CA-01`.
- [Loans & non-2-decimal minor-unit inputs review](LOANS-AND-MINOR-UNITS-REVIEW.md): `MU-01`, `LN-01`, `LN-02`.
- [Fixed assets, CAMT.053 imports & idempotency review](FIXED-ASSETS-AND-IMPORTS-REVIEW.md): `FA-01`, `FA-02`, `IM-01`, `ID-01`.
- [Backup/restore, Form 856, UK/EU export VAT, deliveries & recurring review](STATUTORY-TAX-BACKUP-AND-DELIVERY-REVIEW.md): `BK-01`, `IL-01`, `IL-02`, `TX-01`, `DL-01`, `RC-01`.

## Environment and completed test suites

[Reproducibility and safety instructions](REPRODUCIBILITY.md) record exact setup commands and caveats.

- **Tax table structural check (`npm run check:tax-tables`)**: 57 modules, 34 tables, 1,163 rows clean (structural check only, not legal validation).
- **Isolated PostgreSQL 18.7 (`127.0.0.1:55439/lf_test`)**: all 67 migrations applied; `scripts/db-test.ts rls` passed (`ALL RLS TESTS PASSED`).
- **Full isolated-database repository suite (`full-database-suite.log`)**: **7,329 tests / 1,193 suites — 7,326 passed, 1 failed, 1 skipped, 1 todo**.
  - Only failure: `src/tests/report-speed-12m.test.tsx:258` (`A-229` cold `tsx` 10-screen module import `2,571.82 ms` vs `1,500 ms` budget).
  - Todo: `src/tests/security-s5-idempotency-matrix.test.ts:267` (`S-5 #942`, documented as `ID-01`).
- **Full no-database suite (`full-suite.log`)**: **6,366 tests — 6,351 passed, 4 timing failures under concurrent CPU load, 11 skipped**.
- **Isolated serial performance rerun (`perf-isolated-suite.log`, `--test-concurrency=1`)**: **4/5 passed**; cleared 3 of 4 timing failures from `full-suite.log`, leaving only `A-229` cold `tsx` import (`3,269.99 ms` vs `1,500 ms`).
- **Focused subsystem batches**: `database-suite.log` (97/97), `focused-database-suite.log` (36/36), `integration-database-suite.log` (42/42), `reconciliation-suite.log` (49/49), `tax-and-deferral-suite.log` (61/61), `assets-fx-imports-suite.log` (40/40).
- **Consolidated audit diagnostic suite (`diagnostic-final-suite.log`)**: **41/41 tests passed (`EXIT=0`) across 35 custom diagnostic test files** reproducing the documented counterexamples on synthetic data.
