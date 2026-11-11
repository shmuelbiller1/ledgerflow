# LedgerFlow Independent Full-System Financial & Technical Audit Report

- **Date:** 2026-11-11 (UTC)
- **Auditor & Lane Role:** Agent #11 — Imports, Exports, Documents (`J-1`..`J-8`) & Independent Full-System Financial/Technical Auditor
- **Session Branch:** `arena/d3fc43a9-ledgerflow` (fork `Chaim-Richard/ledgerflow`)
- **Upstream Baseline Pin:** `ec3ff49336c53eeed531a79ac32cc08d1574ec96` (`shmuelbiller1/ledgerflow` `main`)
- **Prior Agent #11 Unmerged Commit Rebased & Hardened:** `270014e6c78137ac12232c191a91188a9a9d76d0` (upstream PR #623 / fork PR #19)
- **Codebase Scope Audited:** 3,574 tracked files (`src/lib/`, `src/server/`, `src/components/`, `src/hooks/`, `src/stores/`, `supabase/migrations/`, `scripts/`, `e2e/`, `docs/`, `.github/workflows/`)

---

## 1. Executive Summary & Production Launch Verdict

**Verdict: CONDITIONALLY READY FOR CONTROLLED SINGLE-ENTITY / SYNTHETIC BETA — NOT READY FOR UNRESTRICTED MULTI-ENTITY OR STATUTORY PRODUCTION LAUNCH UNTIL REMAINING CROSS-LANE P1 ITEMS (`AF11-10`, `AF11-11`, `AF11-12`) ARE MERGED.**

### Why Core Ledger Architecture Is Strong
1. **Double-Entry & Period-Lock Enforcement at PostgreSQL Commit Boundary:**
   - Every journal transaction committed through `ledgerDoor.ts` (`writeTransactionThroughDoor`) enforces integer-cent arithmetic, `sum(lines.amountCents) === 0`, minimum 2 lines, balanced home-currency amounts on foreign-currency entries, valid calendar dates, active workspace accounts, and commit-time period-lock checks (`locked_periods`, `fiscal_year_closings`, `closedThroughDate`) inside the database transaction.
   - Database triggers and `lf_rules` RLS policies across all 53 PostgreSQL migrations (`20260924190000_init.sql` through `20261110190000_*`) passed 100% of live PostgreSQL 17.11 RLS verification (`npm run test:rules`: `ALL RLS TESTS PASSED`).
2. **Authoritative Server Backups & Checksum-Verified Archives:**
   - Full workspace archives (`workspaceArchive.ts`) and the newly hardened Year-End Accountant Archive (`yearEndArchive.ts` + `YearEndArchiveExport.tsx`) build exclusively from SHA-256 checksum-verified server exports (`/api/v1/workspaces/:id/export`), never falling back to capped browser caches.
3. **Full End-to-End Verification Executed Live (Not Inferred):**
   - Unlike prior constrained runs lacking PostgreSQL or Chromium, this audit stood up live UTF-8 PostgreSQL 17.11 (`lf_test` with all 53 migrations) and headless Chromium 153 (`@sparticuz/chromium` + `al2023` NSS/NSPR runtime) and executed:
     - **5,472 unit + live-DB integration tests across all 4 shards (`0 failed, 0 skipped`, up from `5,421` baseline)**
     - **PostgreSQL RLS security test suite (`ALL RLS TESTS PASSED`)**
     - **35 real-browser Playwright E2E tests (`0 failed`)** across accounting lifecycle, bank statement formats, 12-month sample year, Hebrew exports, W4 bank CSV reconciliation, W7 Israel VAT journey, W8 US quarter journey, W10 backup-change-restore report invariance, dashboard widgets, and cryptographic audit trail
     - **TypeScript (`0 errors`), ESLint (`0 errors, 42/42 warnings`), layer guard (`4/4`), bug-pattern & ledger-door scanners (`0 regressions`), rule-pack lint (`584/0`), tax-table validation (`1,163/0`), production Vite + server/serverless esbuild bundle (`16/16 bundle tests`), and `npm audit --audit-level=high` (`0 high/critical vulnerabilities`)**.

### Why Unrestricted Production Launch Must Wait on Specific Cross-Lane Fixes
Nine defects (`AF11-01` through `AF11-09`, including **4 P1s**, **4 P2s**, and **1 P3/Sonar blocker**) inside Agent #11's client/lib/import-export scope were **remediated and regression-tested directly on this branch**. Seven cross-lane or locked-golden-test findings (`AF11-10` through `AF11-16`) live in server/tax/migration lanes owned by AI #1 / tax lane owners and were intentionally left untouched per `AGENTS.md` / `docs/COORDINATION.md` lane-ownership rules, with exact root-cause proofs and drop-in remediation designs documented in `FINDINGS-REGISTER-2026-11-11.md`:
- **`AF11-10` (P1 Statutory Israeli Tax Compliance):** `GET /api/v1/documents/:type/:id/pdf` and `/zip` (`src/server/routes/documentRoutes.ts:104,169` -> `copyMarkService.ts:17`) mutate `originalIssuedAt` on `GET`. Internal preview or year-end archive downloads of an unprinted Israeli tax invoice permanently consume its one-time legal `"מקור"` (Original) mark before customer delivery, causing the customer to receive `"העתק נאמן למקור"` (Certified Copy).
- **`AF11-11` (P1 US Payroll Tax Math):** `src/lib/tax/usFederalPayroll.ts:138-280` W-4 Step 2 (`Table 1(b)`) annual brackets halve Table 1(a)'s already-deduction-adjusted threshold (`$3,750` instead of `$8,050` for 2026 Single) while setting `standardDeductionAdjustmentCents = 0`, systematically overwithholding Step-2 employees across 2025–2026; Table 1(a) thresholds also diverge from IRS Pub. 15-T (`PR #569` review).
- **`AF11-12` (P1 Multi-Country / Multi-State Entity Tax Attribution):** `src/lib/tax/profile.ts:96-99` (`resolveSellerProfile`) inherits parent `books.place` fields (`state`, `city`, `district`, `postalCode`) and `registrations` across country/state boundaries (corroborating upstream `#628`).

---

## 2. Rebased & Hardened Agent #11 Work (`J-1`..`J-8`) + Phase 3 Remediations (`AF11-01`..`AF11-09`)

### 2.1 Clean Rebase of `J-1`..`J-8` onto `ec3ff49`
Ported all 19 clean source/test files from Agent #11's unmerged commit `270014e6` onto `ec3ff49` (verified zero file overlap with commits `c7d011e8..ec3ff49` and omitted the stray 2,369-line `.patch` artifact that had polluted PR #623):
- **`J-1` Export -> Import Round-Trip (`src/lib/recordImport.ts`, `src/lib/csv.ts`, `src/tests/j1-export-import-roundtrip.test.ts`):** Preserves `Record JSON` column round-tripping across customers, vendors, items, chart of accounts, and transactions without losing nested metadata or cents.
- **`J-2` Shared Import Preview & QBO Migration CSV Reader (`src/lib/importPreview.ts`, `src/components/platform/settings/ImportSettings.tsx`, `src/components/migration/QBOMigrationWizard.tsx`, `src/components/migration/QBOMigrationWizardView.tsx`):** Eliminates private ad-hoc `.split(',')` CSV parsing in QBO Migration Wizard in favor of the shared RFC-4180 + European semicolon + multiline-quote `parseCsv` reader; previews rows, column mappings, skipped rows, and clear refusal messages before writing.
- **`J-4` Honest `.xls` Refusal (`QBOMigrationWizardView.tsx`):** Explicitly refuses binary BIFF `.xls` files with actionable guidance to save as `.xlsx` or `.csv`.
- **`J-5` UTF-8 BOM on Hebrew & Multi-Script Exports (`BackupExportSettings.tsx`, `workspaceArchive.ts`, `yearEndArchive.ts`, `j5-hebrew-exports.test.ts`):** Guarantees exact single UTF-8 BOM (`\uFEFF`) so Excel opens Hebrew (`חשבונית מס`, `בע״מ`), Arabic, and accented European text without mojibake.
- **`J-7` Document Library Filters & Provenance (`src/lib/documentLibrary.ts`, `src/components/forensics/Vault.tsx`, `j7-document-library.test.ts`):** Adds MIME-based type filters, `YYYY-MM` month filtering that never hides undated documents, linked-record vs unlinked filters, and deterministic code-unit sorting (`byCodeUnit`, Sonar S2871 compliant).
- **`J-8` Year-End Accountant Archive (`src/lib/yearEndArchive.ts`, `src/components/platform/settings/YearEndArchiveExport.tsx`, `BackupExportSettings.tsx`, `j8-year-end-archive.test.ts`):** Checksum-verified server-backup ZIP of `<year>` CSV collections + `<year>` invoice PDFs + `manifest.json`.

### 2.2 Nine Audit Remediations Implemented & Regression-Tested on This Branch

| ID | Severity | Files Modified | Defect & Resolution |
| :--- | :---: | :--- | :--- |
| **`AF11-01`** | **P1** | `src/components/platform/settings/YearEndArchiveExport.tsx`, `src/lib/yearEndArchive.ts` | **Stale-workspace ZIP download & missing `AbortSignal` on invoice PDF loop (Codex P1 on PR #623):** Added `AbortSignal` propagation into `fetchInvoicePdf` (rethrowing `AbortError`), `stillSameScope(controller, selectedId, user.uid)` guard after every `await` (including `blob.arrayBuffer()`), `abortRef.current === controller` cleanup guard, and `BRAND.fileSlug` filename prefix. |
| **`AF11-02`** | **P2** | `src/lib/yearEndArchive.ts`, `src/components/platform/settings/YearEndArchiveExport.tsx` | **Manifest serialized before PDF fetches, omitting failed invoice PDFs (Codex P2 on PR #623):** Reordered `download()` to fetch all planned invoice PDFs first, recording `failedInvoicePdfs` (`{ documentId, documentNumber, path }[]`) and `writtenPdfCount`, then serializing `manifest.json` via `finalizeYearArchiveManifest` with both `invoicePdfPlannedCount` and actual `invoicePdfCount`. |
| **`AF11-03`** | **P2** | `src/lib/yearEndArchive.ts` | **Year-end archive dropped pre-year Chart of Accounts rows from server `/export` (Codex P2 on PR #623):** Added `'accounts'` alongside `'chartAccounts'` in `WHOLE_COLLECTIONS` so the server backup's `accounts` array (`RESTORE_COLLECTIONS`) is always written whole regardless of `createdAt` year. |
| **`AF11-04`** | **P3** | `src/lib/yearEndArchive.ts`, `src/lib/documentLibrary.ts` | **SonarCloud S8786 super-linear regex & S2871 locale sort:** Replaced `.replace(/^-+|-+$/g, '')` in `safeFilePart` with linear `trimChar(dashed, '-')` from `src/lib/textShape.ts` (<5ms on 80,000-dash input) and replaced `.localeCompare` on ISO timestamps/months in `documentLibrary.ts` with `byCodeUnit`. Moved `fetchInvoicePdf` to `yearEndArchive.ts` so `YearEndArchiveExport.tsx` satisfies `react-refresh/only-export-components` (`0` new ESLint warnings). |
| **`AF11-05`** | **P1** | `AccountantExportPackView.tsx`, `IsraelVatReportView.tsx`, `IsraelMonthJourneyReportView.tsx`, `FinancialChartsDashboard.tsx`, `DashboardWidgets.tsx`, `src/lib/dataChecks.ts` | **Systemic `truncated.accounts` vs `truncated.chartAccounts` truncation blindness across 6 financial/tax surfaces (Codex P1 on PR #623 + `A5-002/003`):** `useLedgerData.ts:340` keys `truncatedCollections` by `LEDGER_COLLECTIONS[key].collection` (`'chartAccounts'`), while 6 consumers checked only `truncated.accounts`. Updated all 6 to check `chartAccounts` alongside `accounts`, and hardened `IsraelMonthJourneyReportView` to surface `vendorCredits`/`customers`/`vendors` truncation plus HTTP failures on `/tax-returns`. |
| **`AF11-06`** | **P1** | `src/lib/chunkReload.ts`, `src/components/common/ViewErrorBoundary.tsx` | **Unconditional `window.location.reload()` on post-deploy chunk errors discarding unsaved accounting drafts (Codex P1 on PR #623):** Wired `hasUnsavedDocumentWork` from `pwaUpdateManager.ts` into `reloadOnceForNewVersion` (covering both `main.tsx` `vite:preloadError` and `ViewErrorBoundary.componentDidCatch`), updated the fallback message when open work blocks auto-reload, and added `safeConfirm` before manual reload actions (`Reload now`, `Reload Page`, `Dashboard`). |
| **`AF11-07`** | **P1** | `src/lib/mt940Parser.ts` | **SWIFT MT940 `:61:` reversal polarity inversion & offset-4 `'C'` debit misclassification:** Fixed `RC` (Reversal of Credit) to book as `'debit'` (`-amountCents`) and `RD` (Reversal of Debit) to book as `'credit'` (`+amountCents`), eliminated the broken `afterDate.substring(4).startsWith('C')` heuristic that turned debits like `:61:260916D1,0CNTRF` into credits, added optional `MMDD` calendar validation, supported trailing-comma integer amounts (`500,`) and 0–3 fractional digits without float drift, and enforced `Number.isSafeInteger` bounds. |
| **`AF11-08`** | **P2** | `src/lib/camt053Parser.ts` | **ISO 20022 CAMT.053 calendar-date, reversal, comma-decimal, namespace, and ReDoS hardening:** Replaced `[\s\S]*?` regexes with a linear-time namespace-aware XML scanner (`<Amt>` / `<ns:Amt>`), enforced `bankStatementDate` calendar validation and `Number.isSafeInteger` cent bounds (eliminating a latent `fuzz-importers.test.ts` fast-check violation), added comma-decimal parsing (`1250,50`), and inverted `CRDT`/`DBIT` polarity when `<RvslInd>true</RvslInd>` is present. |
| **`AF11-09`** | **P2** | `src/lib/sampleBusinessYear.ts` | **12-month sample business year `TaxPlace.region` vs `TaxPlace.state` schema mismatch (`F-01`):** Updated all 6 `TaxPlace` occurrences (`lines 142, 144, 214, 233, 517, 524`) from `region` to `state`, keeping every invoice amount and balanced GL line identical while allowing `registrationKey` (`sales_tax:US-TX:32099887766`) and `usSalesTaxReturn` to place all Texas sales properly (`unplaced.documentCount === 0`). |

---

## 3. Domain-by-Domain Audit Assessment

### 3.1 Double-Entry Engine, Posting Services & Period Locks
- **Audited:** `TransactionValidator.ts`, `txFilters.ts`, `ledgerDoor.ts`, `documentPostService.ts`, `invoicePosting.ts`, `creditPosting.ts`, `paymentService.ts`, `periodClosingService.ts`, `fxRevaluationService.ts`, `repostService.ts`, `periodLock.ts`.
- **Verified Sound:**
  - `TransactionValidator` and `ledgerDoor` strictly reject unbalanced entries, single-line entries, non-integer cents, NaN/Infinity, invalid ISO calendar dates, cross-workspace account references, and postings into locked months or closed fiscal years.
  - `periodClosingService.ts` closes fiscal years via snapshots + lock barriers rather than destructive zeroing entries, preserving comparative multi-year reporting.
- **Residual Cross-Lane Findings Logged:**
  - `AF11-14` (`P2`): `periodLock.ts:35` (`workspaceRole`) ignores `workspace.admins[uid] === true` whereas PostgreSQL `private.lf_ws_role` and `useLedgerData.ts:36` treat `admins[uid] === true` as `'owner'`.
  - Cross-reference to Agent #7's live-DB probes (`A7-01..06`, upstream `#646`): generic transaction update routes, installment FX rounding residual (`0.01` in A/R), and browser-written credit notes refunded on server require server-lane follow-up by AI #1.

### 3.2 Trial Balance, P&L, Balance Sheet, Cash Flow & A/R-A/P Subledgers
- **Audited:** `src/server/reports/computeReports.ts`, `src/lib/dataChecks.ts`, `src/lib/accountantExportPack.ts`, `src/lib/reportProvenance.ts`.
- **Verified Sound:**
  - Balance Sheet (`computeBalanceSheet`) folds net income into Retained Earnings and explicitly surfaces `orphanedLines` when any transaction line references a missing account ID.
  - `dataChecks.ts` `control-balance` (`EG-10`) reconciles A/R and A/P control accounts against open invoices/bills and now properly skips false-positive mismatches when `chartAccounts` is truncated (`AF11-05`).
- **Residual Cross-Lane Finding Logged:**
  - `AF11-15` (`P2`): `computeTrialBalance` (`src/server/reports/computeReports.ts:176`) silently skips lines whose `accountId` is missing from `accountMap` (`const acc = accountMap.get(line.accountId); if (!acc) continue;`), which can yield an out-of-balance Trial Balance without returning an `orphanedLines` warning array.

### 3.3 Tax, VAT, Withholding, Payroll & Multi-Currency FX
- **Audited:** `usSalesTaxReturn.ts`, `profile.ts`, `resolveLineTax.ts`, `usFederalPayroll.ts`, `IsraelVatReportView.tsx`, `IsraelMonthJourneyReportView.tsx`, `fxRevaluationService.ts`, `sampleBusinessYear.ts`.
- **Fixed on Branch:** `AF11-05` (truncation & `/tax-returns` HTTP error banners on Israel VAT & Israel Month Journey reports) and `AF11-09` (`sampleBusinessYear.ts` `TaxPlace.state: 'TX'`).
- **Residual Cross-Lane Findings Logged:** `AF11-11` (`P1` US federal payroll W-4 Step 2 bracket math), `AF11-12` (`P1` cross-country `resolveSellerProfile` inheritance, `#628`), and `AF11-13` (`P2` US quarter journey per-registration filed matching & `sales_tax` server return kind `F-08` + certificate loop `#627`).

### 3.4 Bank Statements, Feeds & Reconciliation
- **Audited:** `ofxParser.ts`, `qifParser.ts`, `bai2Parser.ts`, `mt940Parser.ts`, `camt053Import.ts`, `camt053Parser.ts`, `usBankCsv.ts`, `israeliBankCsv.ts`, `Banking.tsx`.
- **Verified Sound:** `ofxParser.ts`, `qifParser.ts`, `bai2Parser.ts`, and `camt053Import.ts` enforce strict calendar validation, ambiguity checks (QIF date order), control totals (BAI2), and XXE/DTD refusal (`camt053Import.ts`).
- **Fixed on Branch:** `AF11-07` (`mt940Parser.ts` `RC`/`RD` reversal polarity & offset-4 `'C'` bug) and `AF11-08` (`camt053Parser.ts` calendar date validation, safe integer cents, `RvslInd`, comma decimals, linear XML scan).

### 3.5 Imports, Exports, Backups & Statutory Documents
- **Audited:** `csv.ts`, `csvExport.ts`, `iifImport.ts`, `iifExport.ts`, `recordImport.ts`, `importPreview.ts`, `workspaceArchive.ts`, `yearEndArchive.ts`, `documentLibrary.ts`, `documentRoutes.ts`, `copyMarkService.ts`, `recordImportService.ts`, `workspaceRestoreService.ts`.
- **Fixed on Branch:** `J-1`..`J-8` + `AF11-01`..`AF11-04`.
- **Residual Cross-Lane Findings Logged:** `AF11-10` (`P1` Israeli `"מקור"` mark consumed on `GET /pdf` and `/zip`) and `AF11-16` (`P3` CSV leading-whitespace formula prefix locked by `audit-af010b-csv-dates.test.ts:20`; IIF `INVITEMTYPE=SERV` `itemType` round-trip).

### 3.6 Server Authorization, RLS, Idempotency & Audit Trail
- **Audited:** `20260924190000_init.sql`, `20261013030000_private_helpers.sql`, `lf_rules` across all 53 migrations, `workspaceRoutes.ts`, `adminRoutes.ts`, `documentRoutes.ts`, `idempotency.ts`, `inventoryRoutes.ts`, `leaseRoutes.ts`, `revenueRoutes.ts`.
- **Verified Sound:** PostgreSQL RLS policies isolate tenant rows across every table (`npm run test:rules` passed). `workspaceRestoreService` verifies SHA-256 checksums, blocks non-owners, and runs inside a single DB transaction.
- **Residual Cross-Lane Findings Logged:** `AF11-14` (`P2` `admins[uid]` role mismatch in server helpers) and `AF11-16` (`P2/P3`: handwritten idempotency in `inventoryRoutes`/`leaseRoutes`/`revenueRoutes` missing `status` & `payloadHash`; `POST /api/v1/admin/integrity/orphan-scan` missing `requireAdmin`; 47/68 `lf_rules` tables leaving `allowed_keys = NULL`; incomplete server audit-log coverage `F-09`).

---

## 4. Verification Summary

| Gate / Suite | Result | Evidence |
| :--- | :---: | :--- |
| `npm run lint:types` (`tsc --noEmit`) | **PASS** | `0` errors |
| `npm run lint:eslint` (`--max-warnings 42`) | **PASS** | `0` errors, `42` warnings (`0` in Agent #11 files) |
| `npm run check:layers` | **PASS** | `4/4` architecture boundary tests pass |
| `src/tests/bug-patterns.test.ts` & `brand-name.test.ts` | **PASS** | `0` client stale-async / silent-catch / ledger-door / brand regressions |
| Unit + Live PostgreSQL 17.11 Suite (Shard `1/4`) | **PASS** | `1,406` pass, `0` fail, `0` skipped |
| Unit + Live PostgreSQL 17.11 Suite (Shard `2/4`) | **PASS** | `1,396` pass, `0` fail, `0` skipped |
| Unit + Live PostgreSQL 17.11 Suite (Shard `3/4`) | **PASS** | `1,337` pass, `0` fail, `0` skipped |
| Unit + Live PostgreSQL 17.11 Suite (Shard `4/4`) | **PASS** | `1,333` pass, `0` fail, `0` skipped |
| **Total Unit + DB Integration Tests** | **PASS** | **5,472 pass, 0 fail, 0 skipped** (`+51` net new tests vs `5,421` baseline) |
| `npm run test:rules` (PostgreSQL RLS across 53 migrations) | **PASS** | `ALL RLS TESTS PASSED` |
| `npm run build` + `npm run test:bundle` + `check:perf-budgets` | **PASS** | Vite client + PWA + `server.cjs` + `api.cjs` built; `16/16` bundle invariants pass |
| `lint:rule-packs` + `check:tax-tables` + `npm audit --audit-level=high` | **PASS** | `584/0` rules, `1,163/0` tax rows, `0` high/critical CVEs |
| Playwright E2E (Headless Chromium 153 + Live PostgreSQL 17.11) | **PASS** | **35 passed, 0 failed** across 11 E2E spec files |
