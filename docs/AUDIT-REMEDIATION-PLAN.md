# Accounting Audit Remediation Plan

Source: PR #1002 (`audit/accounting-review-2026-11-22`, branch `audit/accounting-review-2026-11-22`,
base `9b815a58`) — a ~6.3k-line accountant-style review of this repository. The PR is a
DO-NOT-MERGE reference harness: 20 subsystem reviews, FINDINGS-INDEX / COVERAGE / REPRODUCIBILITY
registers, INVENTORY.csv (3,695 rows), and 35 diagnostic tests that intentionally assert the
current defective output. This plan turns that into an ordered remediation on this branch.

Per the PR's own instruction, whenever a finding is fixed here the audit scenario is copied into
`src/tests/` and the assertion **inverted** to assert the correct accounting result (acceptance
tests, not diagnostics). The audit folder itself stays untracked on this branch (belongs to PR
#1002) and is referenced from the local working tree only.

## Ordering rules

1. **P0 first, hardest first**: duplicate/lost postings and wrong money in the ledger outrank
   display and reporting defects.
2. **Root causes before manifestations**: CL-01 is the root cause of CR-01; fixing the root
   fixes both.
3. **Money in / posting / server-authority changes are verified on the isolated PostgreSQL
   harness** (PostgreSQL 18.7 at `127.0.0.1:55439`, database `lf_test`, migrations applied) before
   being called done.
4. Every fix lands with a positive regression test in `src/tests/`.

## Waves

### Wave 1 — Ledger integrity P0 (money, postings, FX)

| ID | Finding | Status |
|---|---|---|
| CL-01 / CR-01 | Missing line FX rates default to `1` (`TransactionLineSchema.exchangeRate`); header-rate-only foreign entries settle 1:1 (¥1M @ 0.0067 → $10,000 instead of $6,700); a full foreign credit refund leaves a control balance (€100 @ 1.20 → $20 stuck in A/R). Root cause: the schema default; every reader already falls back `line.exchangeRate ?? header ?? 1` and the DB trigger already `coalesce`s to the header rate. | **FIXED** — `.default(1)` removed (rate stays optional); regression: `src/tests/audit-cl01-fx-missing-line-rate.test.ts`, `src/tests/audit-cr01-credit-refund-fx.test.ts` |
| CL-02 | Client `LedgerEngine.computeDimensionalBalances` converts `rawAmount × rate` instead of reading the settled `baseAmountCents` / minor-unit-aware `lineAmount`, disagreeing with server statements by 100× on ¥1M @ 0.0067 ($67 vs $6,700). | **FIXED** — engine now reads `lineAmount(line, tx)` (prefers `baseAmountCents`, applies the 10^digits shift); covered by the CL-01 regression test |
| ID-01 | Headerless client retries (no `X-Operation-Id`) on `POST /api/v1/transactions`, `POST /api/v1/payments`, `POST /api/v1/transactions/intercompany/post` create durable duplicate postings (6 rows instead of 3). Known todo `S-5 #942`. | **FIXED** — implicit content-scoped operation id, opted in per money-creating command; S-5 #942 todo activated as the acceptance test |
| PM-01–04 | Payment allocation defects: cross-party allocation identity, mixed invoice/bill payment posts A/R credit with no A/P, cancelled-unposted invoice settles, retainage leaves offsetting control balances. | **FIXED** — `createPaymentInTransaction` now validates in the allocation loop: the payment's party must own every document it settles (customer receipts cannot settle bills, vendor payments cannot settle invoices; payment party must match each document's `customerId`/`vendorId`); one payment may settle only invoices or only bills; `void`/`draft`/`cancelled`/`rejected` documents are refused. PM-04: the offset entry splits what it clears per allocation between the trade control account and the document's retainage account (trade part first, remainder against retainage, resolved by name/type like `invoicePosting.ts`), converted at the payment/document rate so the parts sum exactly to the cleared base; the chart is read only when a document actually withholds retainage. Regression: `src/tests/audit-pm01-04-payment-allocations.test.ts` (400s with documents untouched; retainage paid against both receivables) — full payment suite 57/57 |
| DR-01 / DR-02 | Deferral: spreading a taxed invoice's gross defers output tax as revenue; editing a posted spread invoice down doesn't touch the deferral schedule. | Next in wave |

### Wave 2 — Documents & assets (posting correctness)

| ID | Finding | Status |
|---|---|---|
| FA-01 / FA-02 | Depreciation: mid-life cost addition books retroactive catch-up; accepts disposed assets; asset-from-bill copies raw split amount ignoring bill FX and recoverable VAT. | **FIXED** |
| INV-01 / INV-02 | Zero/unknown cost skips invoice-driven stock movement; unit-cost rounding leaves 1¢ remainder at zero qty. | **FIXED** |
| DL-01 | `deliverOrder` omits the location dimension on the Inventory credit line, unbalancing the Balance Sheet by Location. | **FIXED** |
| LN-01 | 4-hex loan reference collisions and reference-only matching. | **FIXED** |
| RC-01 | `recurringService.generateInvoice` allocates invoice numbers outside the transaction. | **FIXED** |
| PC-01 | Timestamped month-end draft evades the close guard. | **FIXED** |

### Wave 3 — Reporting & consolidation

| ID | Finding | Status |
|---|---|---|
| RP-01–08 | Reporting: aging as-of current state, CSV ÷100 scaling for JPY/KWD, scheduled P&L omits COGS, cash-flow noncash gross flows, cash-basis void/advance/spread defects, timestamped end-date query drops rows. | **FIXED** |
| GC-01–03 | Consolidation: pre-control sub consolidated, uneliminated intragroup profit, goodwill labeling. | **FIXED** |
| BR-01–05 | Reconciliation: search hides selected entries from the math, completion not validated, first-rec beginning balance, auto-match header total, duplicate lines → one journal. | **FIXED** |

### Wave 4 — Statutory & policy-heavy (need accounting-policy review before code)

| ID | Finding | Status |
|---|---|---|
| PY-01–03, CA-01 | Payroll: forecast payroll posted to GL, wrong FICA/401(k)/local assumptions, 2026 IRS brackets, 1099 $600 vs $2,000, NB 2015 HST 5% vs 13%. | Planned — block payroll use; needs professional validation |
| TX-01, IL-01, IL-02, AR-01–06, UT-01–02 | Tax classifications (UK/CA/EU exports `exempt` vs `zero_rated`, intra-EU 0% unconditional), Form 856 void inclusion, mileage 70¢ vs 72.5¢, 1099 preview, withholding helpers. | Planned — policy-confirmed rates/classifications first |
| CR-02 | Refund dated before credit issuance — date-policy decision required. | Planned — policy first |
| BK-01 | Backup restore scrambles same-day `stockMoves.dbSeq`, re-dirties `repostQueue`, older backups leave `loans`/`taxReturns` behind. | **FIXED** — the restore transaction now creates a restore-only temporary marker (`pg_temp.lf_restore_stock_moves_active`, dropped at commit; custom GUCs are rejected by this PostgreSQL 18.7 build) and the `lf_stock_move_db_seq` / `lf_repost_mark` insert triggers (migration `20261122060000_restore_preserves_stock_move_order.sql`) honor it: restored moves keep their own `dbSeq` (same-day chronological order survives the ID-sorted export) and the already-reposted backup no longer re-dirties `repostQueue`. The `onlyIfInBackup` rule already keeps tables absent from older backups untouched. Regression: `src/tests/audit-bk01-backup-restore-stock-order.test.ts` (restore suite 26/26, stock suites 44/44) |
| MU-01 / IM-01 | ×100 minor-unit scaling in UI inputs and CAMT.053 imports for JPY/KWD. | **FIXED** — `moneyFormat.parseAmountToCents`/`readAmountCents` now scale by `currencyDigits(opts.currency)` (BM-04 exponent) instead of a fixed 100, keeping the two-decimal convention only when no currency is given; `camt053Parser` extracts the `Ccy=` attribute before parsing and scales the `Amt` by that exponent (half-up when a fraction has more digits than the currency); `OpeningBalancesSetup` and `LoansView` pass the workspace currency when parsing typed amounts. Regression: `src/tests/audit-mu01-im01-minor-units.test.tsx` (parser + both screens, audit scenarios) — money/CAMT/UI suites 127/127 |

## Working agreements

- All work happens on branch `arena/a89eafd1-ledgerflow`; no other branch is touched.
- `docs/COORDINATION.md` assigns money/posting/server changes to "AI #1" queues — this task's
  direct user instruction to fix the audit overrides queue assignment; the coordination queues
  themselves are not edited.
- Every fix: code change + inverted acceptance test in `src/tests/` + run of the surrounding
  related suites + `npm run check:layers`.
- Diagnostic tests under `audit/accounting-review-2026-11-22/` remain the source scenarios;
  they assert the *old* behavior and are expected to fail once their findings are fixed — that
  failure is the signal a finding is addressed, replaced by the `src/tests/` acceptance test.

## Test environment

- PostgreSQL 18.7 on `127.0.0.1:55439`, db `lf_test` (outside the repo, `/home/user/pgenv`).
- DB tests: `LF_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55439/lf_test NODE_ENV=test
  SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic npx -y node@24 --import tsx --test
  --test-force-exit <file>` (project requires Node 24).
- Non-DB tests: `NODE_ENV=test SYSTEM_SALT=... npx -y node@24 --import tsx --test <file>`.
