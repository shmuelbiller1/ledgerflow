# Independent Launch-Readiness & Engineering Audit Report — `main` `f6ff005` (2026-11-16)

- **Pinned Base Commit:** `f6ff00511fef2eea283531b8966368c1ad5f2615` (`shmuelbiller1/ledgerflow` `main` — PR `#737`: `EU-I3: free invoice maker at the door, plus EU queue docs`)
- **Working Branch:** `arena/7d2d63f2-ledgerflow`
- **Active Upstream PR Overlap Guard:** Zero files touched by open PRs `#743` (`CMD-1: person-scoped commands + accountRoutes conversion`) or `#744` (`Raw table sweep, batch 2`) were modified on this branch.
- **Governance & Lane Boundaries (`AGENTS.md`, `docs/COORDINATION.md`, `docs/INDEPENDENT_AUDIT_AGENT.md`):**
  - **Authorized UI / client / non-reserved fixes committed on this branch:** `src/components/common/SpreadDialog.tsx`, `src/components/ui/PdfPreviewModal.tsx`, `src/services/documentDownloads.ts`, `src/tests/audit-2026-11-16-ui-regressions.test.tsx`.
  - **Reserved server / migration / tax / ledger-posting fixes (`src/server/**`, `supabase/migrations/**`, `src/lib/tax/*`, `src/lib/taxCodes.ts`, `src/lib/taxRecompute.ts`, `src/lib/taxReturnDocs.ts`, `src/lib/prepaidSchedule.ts`):** Untouched on this branch; delivered as `git apply --check`-verified, live-PostgreSQL-tested standalone patches under `audit/agent9-2026-11-16/patches/` paired with executable adversarial probes under `audit/agent9-2026-11-16/probes/`.

---

## 1. Complete Test & Verification Execution Ledger at `f6ff005`

### 1.1 Unpatched `main` `f6ff005` Baseline (with Live PostgreSQL 16.2 `lf_test`)
- `npm run lint:types` (`tsc --noEmit`): **PASS** (`0` errors)
- `npm run lint:eslint` (`eslint . --max-warnings 2`): **PASS** (`0` errors, `2` pre-existing warnings)
- `npm run check:layers`: **PASS** (`4/4`)
- `npm run check:tax-tables`: **PASS** (`55` modules, `34` tables, `1,163` rows, `0` problems)
- `npm run lint:rule-packs`: **PASS** (`584` rules, `0` problems)
- `npm run check:perf-budgets`: **PASS** (`5` entries valid)
- `npm run build` & `npm run test:bundle`: **PASS** (`16/16`)
- `npm run db:test-setup` & `npm run test:rules` (PostgreSQL 16.2): **PASS** (`ALL RLS TESTS PASSED`)
- `npm run test:security` (`src/tests/security-sweep.test.ts`): **PASS** (`4/4` active, `1` baseline-write skipped)
- Unit shards (`TEST_SHARD=1..4/4 npm run test:shard`): **PASS** (`5,326` pass, `0` fail, `8` DB-skipped)
- **Full `LF_TEST_DATABASE_URL`-gated DB suite (`218` test files across `src/tests/*.test.ts(x)`):**
  - Batch 1 (files `1–75`): **492 pass, 0 fail, 0 skipped**
  - Batch 2 (files `76–150`): **473 pass, 0 fail, 0 skipped**
  - Batch 3 (files `151–218`): **386 pass, 0 fail, 1 skipped**
  - **Total DB-gated execution:** **1,351 pass, 0 fail, 1 skipped** (closing the hidden `database-tests-notice` skip gap completely).

### 1.2 Re-Verification of Prior Findings (Fixed vs. Still Live on `f6ff005`)
- **Fixed on `main` `f6ff005` since Nov 12–13:**
  - `A7N-01` (`#712`/`#713`): `audit/agent7-2026-11-13/probes/probe-01-payment-void-doubles-fx-base.ts` exits `1` (foreign `voidPayment` now succeeds without `LedgerDoorError` home-vs-foreign total mismatch).
  - `A7N-02` partial (`#712`/`#713`): `audit/agent7-2026-11-13/probes/probe-02-credit-refund-fx-crash-and-unposted.ts` exits `1` (`postedCreditProblem` now blocks unposted credit refund with `409`). *(However `refundCredit` `JPY` minor-unit scaling, explicit `arAccountId`/`apAccountId`, and audit logging remain broken — see Finding `D1` below.)*
  - `#518` & `#519` (`usSalesTaxReturn`): resolved (`800` and `0` respectively).
  - `auditLogService` concurrency (`E`): `12` non-tx, `12` `runTransaction`, `10` dual-`Firestore`-pool, and `10` prior-read `SERIALIZABLE` transactions all produced contiguous `seq 1..N`, `valid: true`, `duplicates: []`.
  - `customTemplates` `stranger: "i"` (`security-baseline.json`): verified safe-by-design personal templates scoped to `uid` (`r/u/d = ""` cross-user).
- **Prior Agent #7 Findings STILL LIVE on `main` `f6ff005` (`exit 0`):**
  - `A7N-03` (`probe-03`): `POST /api/v1/transactions/reconcile` voids `invoice-posting` and rewrites `depreciation` lines (`200`); `POST /api/v1/transactions/batch` demotes `completed -> draft` (`200`). *(Note: `agent7` patch `02` conflicts on `f6ff005`; rebased cleanly in `audit/agent9-2026-11-16/patches/02`.)*
  - `A7N-04` (`probe-04`): `recomputeDocumentTax` posts corrupted `-6,633` cent GL `tax-adjustment` on valid `JPY` bill; `buildTaxReturn` `67` vs `6700`; `taxByRate` `67` vs `6700`; `kwdBox1Cents` `32500` vs `3250`; `ilVat` `67` vs `6700`; `taxReturnService` omits `4a`/`4b` boxes; `ilAllocation` returns `false` on `₪120,000 > ₪5,000`; `usNexusWatch` misses `$134,000 > $100,000`; `usSalesTaxReturn` returns `67` vs `6700`; `prepaidSchedule.documentLine` returns `670` vs `67000`.
  - `A7N-05` & `A7N-06` (`probe-05`): `revaluateForeignBalances` ignores `asOf` cutoff (`2026-09-30`) and bill `apAccountId`; bookkeeper `ROLE authenticated` `UPDATE public.assets` doubles GL depreciation (`50,000 -> 100,000`). *(Agent #7 patches `04` & `05` still `git apply --check` cleanly on `f6ff005`.)*
  - `A7N-07` & `A7N-08` (`probe-06`): `computeStatement` returns `150,000` vs `computeCustomerBalanceSummary` `117,000`; `PUT /api/v1/transactions/:id` returns client's stale `updatedAt`, triggering immediate `409` self-conflict. *(Agent #7 patch `06` still applies cleanly; `A7N-08` rebased in `audit/agent9-2026-11-16/patches/02`.)*

---

## 2. Newly Verified Findings on `main` `f6ff005`

| ID | Severity | Defect Summary & Evidence | Probe | Remediation |
|---|---|---|---|---|
| **B1** | **P0** | `invoice.update` (and `bill.create`/`update`) accepts client-forged `settledByRecordsCents` (`{ status: 'paid', amountPaidCents: 10000, settledByRecordsCents: 10000 }`), returning `200` and closing invoice A/R with **no** payment record and **no** cash journal entry (`hasCashEntry: false`). (`src/server/services/documentPostService.ts`) | `probe-01` | Patch `01` (`409` / `400` refusal) |
| **B2** | **P0** | `invoice.update({ status: 'void' })` voids an invoice already settled via `payment.receive`, returning `200`, reversing `invoice-accrual`, leaving `payment-posting` (`-10,000` A/R) and live `paymentAllocations` (`reversedBy: null`) orphaned. | `probe-01` | Patch `01` (`409` refusal) |
| **B3** | **P0** | `creditnote.update` accepts forged `{ remainingCents: 10000, status: 'open' }` on a fully applied credit (`200`), enabling `2x` credit application (`20,000` applied on a `10,000` credit). | `probe-01` | Patch `01` (`409` refusal) |
| **B4** | **P0** | `invoice.update({ date: '2026-10-15' })` moves a posted invoice out of a hard-closed period (`2026-09-15`, `lockDate: '2026-09-30'`) because `documentPostService.ts:100` checks only the new `document.date` on `update` and `ledgerBulkCommit.ts` checks only incoming `tx.date` at commit. | `probe-01` | Patch `01` (`409 Period Locked`) |
| **B5** | **P1** | `invoice.delete` / `bill.delete` deletes a document with an active `revenueSchedule` / `prepaidSchedule` spread or live `paymentAllocations` (`200`). (`documentPostService.ts`, `ledgerBulkCommit.ts`) | `probe-01` | Patch `01` (`409` refusal) |
| **C1** | **P1** | `PUT /api/v1/transactions/:id` as bookkeeper allows `partialUpdate: { exchangeRate: 9.99, currency: 'JPY' }` (`200`), corrupting ledger currency/rate in place (`crudRoutes.ts:310`). | `probe-02` | Patch `02` (`400` / `409` refusal) |
| **D1** | **P1** | `creditService.ts` `refundCredit` passes raw `JPY` minor units to `settleHomeCurrency` (which exits early when `residual === 0`), posting `100,000` as `$6.70` (`670` USD cents instead of `67,000` — `100x` off), ignores `credit.arAccountId`/`apAccountId`, and writes `0` audit logs (`agent7` patch `01` no longer applies cleanly on `f6ff005`). | `credits` + Patch `02` test | Patch `02` (`convertMinorUnits` + control account + `CREDIT_REFUNDED` audit) |
| **F** | **P1** | (1) `reportRoutes.ts` (`balance-sheet`, `trial-balance`, `cash-flow`, `budget-vs-actual`, `general-ledger`, `aging`, `statement`) and `operationalReportRoutes.ts` return `500` on non-member `stranger` (`errorMessage` omits `"FORBIDDEN"`). (2) `brainRoutes.ts` `/analyze` & `/classify` return `500` instead of `403`/`402` on cross-workspace API key, `viewer`, and depleted compute credits. (3) `rememberReport` wipes all `500` `REPORT_CACHE` entries via `.clear()` on saturation (`cacheSizeAfterFlood: 6`). | `probe-02` | Patch `03` (`403`/`404`/`402` + single-entry FIFO/LRU eviction) |
| **G** | **P1** | `AF11-10`: Owner modal preview (`PdfPreviewModal.tsx` -> `GET /api/v1/documents/invoice/:id/pdf`) stamps `originalIssuedAt` on Israeli tax documents before download/email (`takeCopyMark` subsequently emits `'copy'`). | `probe-02` | **UI fixed on branch** (`?preview=1` on preview, non-preview on Download) + Server `?preview=1` in Patch `03` |
| **A1–A6** | **P0** | Under PG `ROLE authenticated`: `viewer` inserts `${ws}_stageSets` (`kind: 'stageSets'`), `kind: 'journalTemplate'` (served `200` to owner by `GET /api/v1/workspaces/:ws/journal-templates`), `kind: 'timeEntry'`, and attachments (`linkedCollection`/`linkedId`) into `public.documents`, and updates owner's `public."supportTickets"` status to `'closed'`. (`supabase/migrations/20260924190000_init.sql` + `20261111000000`) | `probe-03` | Patch `04` (SQL migration `20261116000001_harden_documents_and_support_tickets_rls.sql`) |
| **H1** | **P1** | `SpreadDialog.tsx` hardcodes `/ 100).toFixed(2)` and `readAmountCents` (`* 100`) without `convertMinorUnits`, corrupting `JPY`/`KWD`/cross-currency spreads `100x`/`10x`; `usSalesTaxReturn.ts:53` returns `67` instead of `6700` on `JPY` sales (`agent7` patch `03` + `ilVatReturn`/`usSalesTaxReturn` `homeCurrency`). | `probe-03`, `probe-04`, UI tests | **UI fixed on branch** (`SpreadDialog.tsx`) + Patch `05` |

---

## 3. Standalone Patches & Verification Matrix (`audit/agent9-2026-11-16/patches/`)

All 5 patches below were verified individually via `git apply --check` on `main` `f6ff005` (`CLEAN`) and **applied together in an isolated verification workspace** against live PostgreSQL 16.2 (`lf_test`) + `tsc --noEmit` (`0` errors) + `eslint --max-warnings 2` (`0` errors, `2` warnings) + `npm run test:rules` (`ALL RLS TESTS PASSED`) + `npm run test:security` (`PASS`) + `l94-step2`, `l94-step2b`, `prepaid-spread`, `revenue-spread`, `tax-return`, `tax-recompute`, `report-routes`, `document-pdf-route`, `copy-mark`, `ledger-edit-guards-db`, `transaction-batch-safety`, `etags-if-match`, `audit-f1-f2`, `audit-f3`, `eg2-*`, `eg10`, and `bug-patterns` (**0 failures**; note `credits` DB suite passed prior to adding the 1-line audit `description` field to `creditService.ts` in Patch `02`, after which `tsc` and `eslint` passed cleanly):

1. `01-document-commands-settlement-period-spread-guards.patch` (`src/server/services/documentPostService.ts`, `src/server/services/ledgerBulkCommit.ts`) — Resolves `B1`–`B5`.
2. `02-credit-refund-fx-and-posted-tx-immutability.patch` (`src/server/services/creditService.ts`, `src/server/routes/transactions/{postedImmutabilityGuard,crudRoutes,bulkRoutes,reconcileRoutes}.ts`) — Resolves `C1`, `D1`, and rebased `A7N-03` & `A7N-08`.
3. `03-report-and-brain-error-mapping-cache-and-copymark-preview.patch` (`src/server/routes/{reportRoutes,operationalReportRoutes,brainRoutes,documentRoutes}.ts`) — Resolves `F` and server half of `G`.
4. `04-rls-documents-support-tickets-hardening.patch` (`supabase/migrations/20261116000001_harden_documents_and_support_tickets_rls.sql`) — Resolves `A1`–`A6`.
5. `05-non2dec-jpy-kwd-tax-and-prepaid-fixes.patch` (`src/lib/{prepaidSchedule,taxCodes,taxRecompute,taxReturnDocs}.ts`, `src/lib/tax/{ilAllocation,ilVatReturn,usNexusWatch,usSalesTaxReturn}.ts`, `src/server/services/taxReturnService.ts`) — Resolves `H1` and `A7N-04`.

*Existing Agent #7 patches that still apply cleanly (`git apply --check` = `CLEAN`) on `f6ff005` for remaining `A7N-05`, `A7N-06`, `A7N-07`, `A7N-09`:*
- `audit/agent7-2026-11-13/patches/04-fx-revaluation-asof-cutoff-and-ap-account.patch`
- `audit/agent7-2026-11-13/patches/05-rls-assets-hardening-and-payroll-role-check.patch`
- `audit/agent7-2026-11-13/patches/06-reporting-statement-tb-cashflow-and-unposted-filter.patch`
