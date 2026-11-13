# Agent #6 — tests, gates and evidence, second session of 2026-11-12

Pin `e33b3f2`. Node v22.22.3, npm 10.9.8, 2 vCPU / 3.9 GB. **A real PostgreSQL 16.2 was available for the last
part of this session** (the `pgserver` wheel from PyPI, a TCP proxy onto its socket, `npm run db:test-setup` applied
the stub and all 24 migrations) — so the RLS suite, the DB-gated unit tests and the new endpoint test were run, not
deferred. Nothing below is an estimate.

## 1. Focused suites

| Command | Result |
|---|---|
| `src/tests/currency-minor-units-reports.test.ts` | **5/5 pass** (before the AF6B-003 fix the part-payment case failed `67000 !== 33500`) |
| `src/tests/ledger-edit-guards.test.ts` | **9/9 pass** (6 originally, +2 flag/annotate, +1 system-run scoping) |
| **`src/tests/ledger-edit-guards-db.test.ts` (new, PostgreSQL)** | **4/4 pass** — the running transaction router: void / un-post / re-link / rewrite of an invoice's accrual → 409 with the row untouched; `isFlagged` and `notes` on that row → 200 and saved; a flag riding with a status change → 409; `POST /:id/reverse` on it → 409 and no `reversalEventId`, on a hand entry → not 409; a posted hand entry → `status: failed` 409, `memo` 200 |
| `src/tests/cash-basis.test.ts`, `sales-reps.test.tsx`, `sales-reps-groups.test.tsx` | **15/15** |
| `src/tests/invoice-cogs.test.ts` + `src/tests/pay1-payroll-import.test.ts` (PostgreSQL) | **25/25** — both failed with 409 before the scoping correction (see §5) |
| `npx tsc --noEmit -p tsconfig.json` | **0 errors** |
| `npx eslint` on every touched file | **0 errors, 0 warnings** |

## 2. Database gates (first time in this audit they could be run)

| Gate | Result |
|---|---|
| `npm run db:test-setup` (stub + all migrations) | applied cleanly on PostgreSQL 16.2 |
| **`npm run test:rules`** (`supabase/tests/rls.test.sql`) | **ALL RLS TESTS PASSED** |
| DB-gated unit tests inside the unit shards | run in shards 2/4 and 4/4, see §4 |

## 3. Independent probes

| Probe | Cases | Result |
|---|---|---|
| `audit/function-audit/probes/af008-641-aging-vs-ledger.ts` | 20 | **20/20 OK** (V7/V8 were DEFECT before this branch) |
| `audit/agent6-2026-11-12b/probes/invariants.ts` | 26 | **all OK** — loans, depreciation, allocation, withholding/FICA, minor units |
| `audit/agent6-2026-11-12b/probes/statements.ts` | 11 | **all OK** — TB balances and agrees row by row; assets = liabilities + equity + profit; P&L = balance-sheet net income; cash flow closes; GL = TB on all 8 accounts; void counts nowhere |
| `audit/agent6-2026-11-12b/probes/audit-chain.ts` | 7 | **all OK** — clean chain verifies; details tamper, deletion, reorder and a forged `prevHash` each detected at the right id |

## 4. Full unit matrix

| Run | Result |
|---|---|
| Local `TEST_SHARD=2/4` **without** a database | 583 tests, 1 failure: `R-5 all 151 report views open under 1000 ms` (`TopPartiesReportView` 1082.38 ms) — the standing 2-vCPU speed flake |
| Local `TEST_SHARD=4/4` **without** a database | 0 failures |
| Local `TEST_SHARD=4/4` **with PostgreSQL** (after the scoping correction) | **777 tests, 0 failures** |
| Local `TEST_SHARD=2/4` **with PostgreSQL** | see the session summary; the run was started after the fixes |
| Local `TEST_SHARD=1/4`, `3/4` | not run to completion on this 2-vCPU box (1/4 had ~470 tests and no failure when abandoned); CI runs them |
| `npm run build` | **exit 0** — client built in 30.1 s, `build/server.cjs` / `build/api.cjs` 6.7 MB each, PWA 92 precache entries |
| CI run 1 (fork PR #28, commit `9917cd0`) | `Lint, Typecheck, and Database rules` **pass**, `Production build` **pass**, `CodeQL` **pass**, `SonarCloud` **pass**, `Produce CycloneDX inventory` **pass**, browser shards 5/5 **pass**, `Unit tests 1/4` **pass**; `Unit tests 2/4`, `4/4` and 4 of 6 time-zone shards **failed** |
| CI run 2 (commit `44b0f51`) | same jobs failed again — consistent, not random |
| **Cause, found by reproducing locally with PostgreSQL** | the first version of the #652 guard reused the client's `isDocumentEntry`, which counts any `metadata.type`; it therefore refused to reverse a **cost-of-goods-sold** entry (`invoice-cogs`, the documented way stock comes back) and a **payroll import** entry (how a corrected file is re-imported). `invoice-cogs` and `pay1-payroll-import` answered 409 instead of 200. Fixed in `9824a43`; both suites are 25/25 now and shard 4/4 with PostgreSQL is clean |
| CI failure logs | **not readable from this sandbox** (`gh run view --log-failed` and the job-logs API redirect to `*.blob.core.windows.net`, outside the allowed network); the failures were diagnosed by running the same shards against a local PostgreSQL instead of by reading CI output |

## 5. What the first version of the guard got wrong (kept, because it is the interesting part)

`isDocumentEntry` (`src/lib/transactionEdits.ts`) is the browser's rule for hiding list actions: *any* metadata
`type`, any `…Id` key or `isReversal`. Applying it unchanged on the server is too wide, because the product
deliberately reverses some system-run entries through the same route — `reverseRoutes.ts:213` restores stock when a
cost-of-goods entry is reversed, and the payroll importer reverses its own entry so a corrected file can post. The
server rule is now `isDocumentPosting`: a document link (invoice/bill/payment/credit note/vendor credit/estimate/
expense/deposit/purchase order) **and** no type, or one of the nine posting types the invoice, bill, payment and
credit postings write. That is exactly what #652 reported and nothing else.

## 6. Gates still not run here

| Gate | Why |
|---|---|
| Playwright browser suites locally | no browsers installed (CI's browser shards passed on the first run) |
| `npm audit`, the coverage gate | out of scope for this session; CI runs them |
| Google Drive backup | the connector is not connected to this account; per the owner's instruction everything is preserved on GitHub only and nothing is claimed to be on Drive |
