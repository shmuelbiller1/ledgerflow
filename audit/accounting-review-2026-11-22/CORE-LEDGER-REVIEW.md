# Systematic audit: core bookkeeping and FX — batch 1

**Revision:** `9b815a58ebbe1d0f99c44f908ee77b7fbaa73705` · **Date:** 2026-11-22 UTC · **Status:** in progress; no subsystem below has been fully certified. See [coverage register](COVERAGE.md) and [file inventory](INVENTORY.csv). The [first slice](REPORT.md) remains part of the audit.

## Worked bookkeeping scenario

A new independent synthetic test (`core-worked.test.ts`) applies posting templates and server statement functions, not a live database. Expected figures were calculated independently:

| Event | Debits | Credits |
|---|---:|---:|
| Owner contributes $1,000 | Cash $1,000 | Capital $1,000 |
| Invoice: $1,000 before $100 discount; $162 tax | Receivables $1,062; sales discount $100 | Sales $1,000; output tax $162 |
| Bill: $200 expense + $36 input tax | Expense $200; input tax $36 | Payables $236 |
| Customer pays $300 | Cash $300 | Receivables $300 |
| Pay supplier $100 | Payables $100 | Cash $100 |

Expected closing cash $1,200, receivables $762, input tax $36, payables $136, output tax $162, capital $1,000, net income $700. Assets $1,998 equal liabilities plus capital plus income $1,998. The test verifies these amounts, each journal balances, the trial balance balances, and the remaining document amounts are $762 and $136. It also checks a tax-inclusive example, a deposit, exclusion of void/draft/future entries, and pure hard/soft lock boundaries. **4/4 tests passed.** This is not evidence that the documents are saved, permissions enforced or tax treatment appropriate for any jurisdiction.

## Confirmed issues and exposure

### CL-01 — A missing line FX rate can override the transaction's exchange rate (P0 for affected foreign entries)

**Previously reported, independently reproduced at this revision:** `audit/agent6-2026-11-16/02-LIVE-AUDIT-FINDINGS-AND-SCAN-RESULTS.md` calls out the same schema-default mechanism. We have not repeated that historical audit's production-like refund scenario and do not assume its other claims still apply.

- `src/schemas.ts:12-20` defaults every missing line `exchangeRate` to 1. `src/kernel/validation/TransactionValidator.ts:75-86,132-136` parses, settles, and recalculates the total. `src/lib/txFilters.ts:91-105,133-134` then prefers the line rate and sees all lines as rate 1. `src/server/routes/transactions/crudRoutes.ts:154-165` also parses through the same schema before calling the validator; the validator is used by numerous server commands and services, each of which must be separately traced.
- **Reproduction:** `NODE_ENV=test SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic npx tsx audit/accounting-review-2026-11-22/core-fx-probe.ts`. Using USD books, a balanced ¥1,000,000 debit/credit and a header rate of $0.0067/¥1 should translate to **$6,700** = 670,000 US cents on each side. When the line rates are omitted, the validator produces line rates 1, no stored home amounts, and 1,000,000 cents ($10,000) on both sides; server P&L and balance sheet computations over that prepared synthetic transaction each use $10,000. When the same rate is explicitly placed on both lines, the validator stores the expected 670,000 cents. The journal balances in either case, so balancing alone cannot detect the misstatement.
- **Scope/limitations:** Independently reproduced via `POST /api/v1/transactions` on the real router, with an injected synthetic identity and isolated local PostgreSQL 18.7. The test reads the persisted entry and passes it to the pure report function; it observed exactly the same 1,000,000 vs 670,000 USD-minor-unit amounts. A separately tested actual caller, foreign credit refunds, leaves an A/R control residual; see [CR-01](CREDITS-REVIEW.md). Neither test exercises real authentication, a hosted deployment, or a customer's records. Ordinary invoice/bill posting deliberately converts to base currency before writing and must not be conflated with the raw foreign-entry example. Trace each real writer, explicit home amount and reversal path before estimating incidence.
- **Acceptance:** Preserve the distinction between missing, explicit 1 and already-converted home lines. Independently validate JPY/USD, KWD/USD, same-exponent pairs, explicit line rates, header-only rates, rate exactly 1, missing/invalid rates, mixed-rate journals, stored home amounts, reversals and corrections in actual authenticated routes and a real transactional DB. Reconcile all readers and check existing affected entries before remediation. Financial changes belong to the project lead.

### CL-02 — Client balance computation ignores stored settled home amounts (P1 for affected displayed balances)

- `src/kernel/ledger/LedgerEngine.ts:281-295` multiplies raw line units by the rate and does not use `baseAmountCents` or currency exponents; server statements use `lineAmount` (`src/lib/txFilters.ts:91-95`), which prefers saved home amounts. `src/stores/useLedgerStore.ts:349-359` calls the former for `computedAccounts`, used by client-side balance consumers. Exact visible screens, snapshot timing and all input paths remain to be traced; do not infer that every statement is affected.
- **Reproduction:** same `core-fx-probe.ts`, with explicit JPY line rates: server statements use the settled **670,000 cents ($6,700)** but `LedgerEngine.computeDimensionalBalances` returns **6,700 cents ($67)** for cash, a 100-fold difference, on the same prepared synthetic entry. `fx-route-database.test.ts` independently reproduced the same divergence on a journal saved via the real transaction HTTP router in isolated PostgreSQL (with an injected test identity). No actual browser screen was exercised. This is a separate mechanism from CL-01.
- **Acceptance:** The client and server must read the same authoritative settled home amounts, including per-line FX rounding and reversal amounts. Compare both readers against independently worked JPY, KWD and USD/EUR examples; cover rounded splits, real server-loaded entries, snapshots/cutoffs, stale caches and screen values. Determine which actual UI workflows consume `computedAccounts` and verify with a browser and real DB before sizing exposure.

## Function/workflow observations in this batch

“Checked” means only the listed evidence, not every branch or caller. No function is marked fully verified under the repository's independent-audit criteria.

| Function or path | Checked | Still required |
|---|---|---|
| `DoubleEntryValidator.validateJournalEntry` | Balanced worked invoice, bill, payments and capital; existing property tests ran | Real writer boundaries, split validation and zero/overflow behavior in DB |
| `TransactionTemplates.buildInvoiceLines`, `buildBillLines`, `buildPaymentLines` | Worked accounting signs and totals above; selected existing randomized tests | Per-account/label, mixed-rate, discounts, retainage, credits, negative input, actual caller and reconciliation |
| `calculateDocumentTax`, `calculateAmountDue` | Selected exclusive, inclusive, explicit amount, discount, deposit, partial-payment examples | All persisted document versions, tax rounding policies, legal tax point, exception validation, overpayments and every caller |
| `postingLock` | Hard/soft date and role cases in pure test | Race against closing/reopening and deployed Postgres trigger semantics |
| `TransactionValidator.validateAndPrepare` / `settleHomeCurrency` / `lineAmount` | CL-01 synthetic repro, previously checked explicit home amounts | Real DB, all callers, authorization, exact-rate and currency boundaries |
| `LedgerEngine.computeDimensionalBalances` | CL-02 synthetic divergence | Actual UI usage, historical data, dimensions and snapshot interactions |
| `computeProfitAndLoss`, `computeBalanceSheet`, `computeTrialBalance` | One hand-worked period; void/draft/future filter | Full-history fetch, openings, date boundaries, orphan accounts, cash basis, year close, dimensions, FX, exports and concurrency |
| `postInvoiceLedger`, `postBillLedger`, `postingCore` | Source tracing of portions only; related existing tests previously run | Every branch from route and entity mutation to DB, idempotency, reversal, inventory, approvals, split accounting and report reconciliation |
| `allocateCents`, currency/parsing helpers | Existing allocation/property and parsing tests passed | Numerical boundaries, callers, and divergent alternate allocator contracts remain unresolved |

## Tests, environment and evidence

- `NODE_ENV=test SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic npx tsx --test audit/accounting-review-2026-11-22/core-worked.test.ts` — **4 passed**.
- The same environment and `npx tsx --test --test-concurrency=2` on `src/tests/allocation.test.ts`, `audit-af010-money-primitives.test.ts`, `property-invariants.test.ts`, `ledger-integrity-slice3.test.ts`, `money-parse-exact.test.ts`, `money-properties.test.ts`, `invoice-deposit.test.ts`, `tx-filters.test.ts` — **44 passed**. Some are source guards rather than runtime DB checks.
- `core-fx-probe.ts` prints both failure examples; it uses an in-memory account map and writes nothing. The separate route/database diagnostic persists and reads both examples, then deletes its isolated synthetic workspace; it intentionally asserts the present defects:
  `LF_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55439/lf_test NODE_ENV=test SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic npx -y node@24 --import tsx --test --test-force-exit audit/accounting-review-2026-11-22/fx-route-database.test.ts` — 1 passed.
- Environment: Node 22.22.3, while the project specifies Node 24. Re-run on supported Node; no full suite, browser or database/RLS tests were run for this batch.
- `node scripts/code-atlas.mjs stats` read the existing older snapshot (`74b8318…`); `validate` failed because that snapshot commit is absent in this shallow checkout. Those snapshot counts do not describe current audit coverage.
- Blob identities: `TransactionValidator.ts` `4d7b004019664c1b82c43a7a1c32d3691325d136`; `schemas.ts` `012e4c8d72a0bf7cf0316c00dded5060fe1d3223`; `txFilters.ts` `341087ad56e8188408a921724edf85f953dffbe9`; `LedgerEngine.ts` `f216227af8b468711b99ea3331486f9ad1604a9b`; `computeReports.ts` `d8e9b58e9aaecfda88a23bacd7dc728f9917eb11`. Recheck if any relevant blob changes.
