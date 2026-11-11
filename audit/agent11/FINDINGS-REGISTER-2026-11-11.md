# Agent #11 Structured Findings Register (`AF11-01` – `AF11-16`)

- **Date:** 2026-11-11 (UTC)
- **Baseline Audited:** `ec3ff49336c53eeed531a79ac32cc08d1574ec96` + Agent #11 `270014e6` (`PR #623`)
- **Branch:** `arena/d3fc43a9-ledgerflow`

---

## Summary Table

| ID | Severity | Domain | Location | Status |
| :--- | :---: | :--- | :--- | :--- |
| `AF11-01` | **P1** | Exports / Stale-Async Safety | `src/components/platform/settings/YearEndArchiveExport.tsx`, `src/lib/yearEndArchive.ts` | **FIXED & VERIFIED** |
| `AF11-02` | **P2** | Exports / Archive Truthfulness | `src/lib/yearEndArchive.ts`, `src/components/platform/settings/YearEndArchiveExport.tsx` | **FIXED & VERIFIED** |
| `AF11-03` | **P2** | Exports / Chart of Accounts Completeness | `src/lib/yearEndArchive.ts:80` | **FIXED & VERIFIED** |
| `AF11-04` | **P3** | ReDoS / Determinism / Fast-Refresh | `src/lib/yearEndArchive.ts`, `src/lib/documentLibrary.ts` | **FIXED & VERIFIED** |
| `AF11-05` | **P1** | Reporting & Integrity Truthfulness | `AccountantExportPackView.tsx`, `IsraelVatReportView.tsx`, `IsraelMonthJourneyReportView.tsx`, `FinancialChartsDashboard.tsx`, `DashboardWidgets.tsx`, `dataChecks.ts` | **FIXED & VERIFIED** |
| `AF11-06` | **P1** | Unsaved-Work Data-Loss Prevention | `src/lib/chunkReload.ts`, `src/components/common/ViewErrorBoundary.tsx` | **FIXED & VERIFIED** |
| `AF11-07` | **P1** | Bank Statement Accounting (`MT940`) | `src/lib/mt940Parser.ts` | **FIXED & VERIFIED** |
| `AF11-08` | **P2** | Bank Statement Accounting (`CAMT.053`) | `src/lib/camt053Parser.ts` | **FIXED & VERIFIED** |
| `AF11-09` | **P2** | US Sales Tax / Sample Year Fixture (`F-01`) | `src/lib/sampleBusinessYear.ts:142,144,214,233,517,524` | **FIXED & VERIFIED** |
| `AF11-10` | **P1** | Israeli Tax Invoice Statutory Compliance | `src/server/routes/documentRoutes.ts:104,169`, `src/server/services/copyMarkService.ts:17` | **OPEN — ESCALATED (Server Lane)** |
| `AF11-11` | **P1** | US Federal Payroll Withholding Math | `src/lib/tax/usFederalPayroll.ts:138-280` | **OPEN — ESCALATED (Tax Lane / Golden Test)** |
| `AF11-12` | **P1** | Multi-Country Tax Attribution (`#628`) | `src/lib/tax/profile.ts:96-99` | **OPEN — ESCALATED (Tax Lane / Product Rule)** |
| `AF11-13` | **P2** | US Quarter Journey & Tax Return Filing (`F-08`, `#627`) | `UsQuarterJourneyReportView.tsx:46`, `usQuarterJourney.ts:321-337`, `taxReturnService.ts:62` | **OPEN — ESCALATED (Tax/Server Lane)** |
| `AF11-14` | **P2** | Co-Owner (`admins[uid]`) Authorization Parity | `src/server/middleware/periodLock.ts:35`, `workspaceRoutes.ts:71`, `documentRoutes.ts:194` | **OPEN — ESCALATED (Server Lane)** |
| `AF11-15` | **P2** | Trial Balance Orphaned-Account Visibility | `src/server/reports/computeReports.ts:176` | **OPEN — ESCALATED (Server Reports Lane)** |
| `AF11-16` | **P2/P3** | Idempotency (`F-10`), Admin Guard (`S-7`), Audit Logs (`F-09`), RLS `allowed_keys`, CSV/IIF Edge Cases | Multiple `src/server/` & `supabase/migrations/` files | **OPEN — ESCALATED (Server/DB/Locked-Test)** |

---

## Part A — Findings Remediated & Verified on `arena/d3fc43a9-ledgerflow` (`AF11-01` – `AF11-09`)

### `AF11-01` (P1) — `YearEndArchiveExport` Stale-Workspace Download & Missing `AbortSignal` on Invoice PDFs
- **Source:** `src/components/platform/settings/YearEndArchiveExport.tsx`, `src/lib/yearEndArchive.ts` (Codex P1 review on PR #623).
- **Failure Mechanism:** `fetchInvoicePdf` did not accept or pass `AbortSignal` and caught all errors as `null`. `download()` did not verify `controller.signal.aborted` or current `workspaceId`/`uid` after awaiting the PDF loop, so switching workspaces or changing the archive year mid-download allowed the old promise chain to finish building a partial ZIP and trigger a browser file download + success toast for the wrong workspace.
- **Fix Applied:** Added `signal?: AbortSignal` to `fetchInvoicePdf` (rethrowing `AbortError`), added `stillSameScope(controller, selectedId, user.uid)` checks after every `await` in `preview()` and `download()` (including `blob.arrayBuffer()`), guarded `finally` state resets with `abortRef.current === controller`, aborted in-flight controllers on year input changes, and used `BRAND.fileSlug` for the download filename.
- **Regression Test:** `src/tests/agent11-audit-remediations.test.tsx` (`AF11-01 & AF11-02`).

### `AF11-02` (P2) — `YearEndArchiveExport` Serialized `manifest.json` Before Knowing Which Invoice PDFs Failed
- **Source:** `src/lib/yearEndArchive.ts`, `src/components/platform/settings/YearEndArchiveExport.tsx` (Codex P2 review on PR #623).
- **Failure Mechanism:** `buildYearArchiveCsvEntries` wrote `manifest.json` with `invoicePdfCount = planned` before `download()` fetched any invoice PDFs, while the toast claimed failed PDFs were recorded in the manifest.
- **Fix Applied:** Added `finalizeYearArchiveManifest(manifest, outcome)` and `pdfOutcome` parameter to `buildYearArchiveCsvEntries`. `download()` now fetches all planned invoice PDFs first, collects `failedInvoicePdfs` (`{ documentId, documentNumber, path }[]`) and `writtenPdfCount`, and writes both `invoicePdfPlannedCount` and actual `invoicePdfCount` plus `failedInvoicePdfs` into `manifest.json`.
- **Regression Test:** `src/tests/j8-year-end-archive.test.ts` (`manifest records failedInvoicePdfs and actual writtenPdfCount`).

### `AF11-03` (P2) — `WHOLE_COLLECTIONS` Omitted Server Backup Key `'accounts'`
- **Source:** `src/lib/yearEndArchive.ts` (Codex P2 review on PR #623).
- **Failure Mechanism:** Server `/api/v1/workspaces/:id/export` serializes the Chart of Accounts under key `'accounts'` (`RESTORE_COLLECTIONS` in `workspaceRestoreService.ts`), whereas `WHOLE_COLLECTIONS` listed `'chartAccounts'` only. `planYearArchive` therefore filtered `collections.accounts` by `recordYear(account) === year`, dropping every account created in an earlier year from the year-end archive.
- **Fix Applied:** Added `'accounts'` alongside `'chartAccounts'` in `WHOLE_COLLECTIONS`.
- **Regression Test:** `src/tests/j8-year-end-archive.test.ts` (`server backup accounts collection is written whole regardless of creation year`).

### `AF11-04` (P3) — SonarCloud S8786 Super-Linear Regex, S2871 `.localeCompare` Sort & React Fast-Refresh Export
- **Source:** `src/lib/yearEndArchive.ts`, `src/lib/documentLibrary.ts`, `src/components/platform/settings/YearEndArchiveExport.tsx`.
- **Failure Mechanism:** `.replace(/^-+|-+$/g, '')` in `safeFilePart` triggered SonarCloud S8786 (polynomial regex backtracking on dash-heavy strings); `.localeCompare` in `documentLibrary.ts` violated the repo's deterministic code-unit sort standard (`byCodeUnit`); exporting `fetchInvoicePdf` from `YearEndArchiveExport.tsx` triggered ESLint `react-refresh/only-export-components` (pushing warnings from 42 to 43, over the `--max-warnings 42` CI gate).
- **Fix Applied:** Used `trimChar(dashed, '-')` from `src/lib/textShape.ts`, `byCodeUnit` from `src/lib/codeUnitOrder.ts`, and exported `fetchInvoicePdf` from `src/lib/yearEndArchive.ts`.
- **Regression Test:** `src/tests/j8-year-end-archive.test.ts` (80,000-dash adversarial input <5ms) + `npm run lint:eslint` (`0` errors, `42` warnings).

### `AF11-05` (P1) — Systemic `truncated.accounts` vs `truncated.chartAccounts` Truncation Blindness Across 6 Surfaces
- **Source:** `AccountantExportPackView.tsx:133`, `IsraelVatReportView.tsx:137`, `IsraelMonthJourneyReportView.tsx:100`, `FinancialChartsDashboard.tsx:29`, `DashboardWidgets.tsx:143`, `src/lib/dataChecks.ts:523` (Codex P1 on PR #623 + Agent #5 `A5-002/003`).
- **Failure Mechanism:** `useLedgerData.ts:340` records collection caps under `LEDGER_COLLECTIONS[key].collection` (`'chartAccounts'` for `accounts`), but 6 downstream report, export, dashboard, and data-health surfaces checked `truncated.accounts` only. When a workspace's Chart of Accounts hit the browser load cap:
  - `AccountantExportPackView` exported an incomplete Trial Balance & General Ledger ZIP as if complete;
  - `IsraelVatReportView` and `IsraelMonthJourneyReportView` omitted the provisional-figures banner (and `IsraelMonthJourneyReportView` silently treated HTTP 500 on `/tax-returns` as "0 returns filed");
  - `dataChecks` `control-balance` reported false A/R or A/P control-account discrepancies instead of skipping due to incomplete data.
- **Fix Applied:** Updated all 6 surfaces to check `chartAccounts` alongside `accounts` (`LEDGER_COLLECTIONS[key].collection`), and updated `IsraelMonthJourneyReportView` to check `truncated.vendorCredits`, `truncated.customers`, `truncated.vendors`, `failed.vendorCredits`, `failed.accounts`, and `filedLoadFailed`.
- **Regression Test:** `src/tests/agent11-audit-remediations.test.tsx` (`AF11-05` suite — all 4 tests pass).

### `AF11-06` (P1) — Post-Deploy Chunk Failure Auto-Reload Discarded Open Modals & Dirty Accounting Drafts
- **Source:** `src/lib/chunkReload.ts:13`, `src/components/common/ViewErrorBoundary.tsx:32,54,93,99` (Codex P1 on PR #623).
- **Failure Mechanism:** `reloadOnceForNewVersion` called `window.location.reload()` unconditionally whenever a lazy chunk 404'd after a deploy (`vite:preloadError` in `main.tsx` or `ViewErrorBoundary.componentDidCatch`), wiping out any open Invoice, Bill, Reconciliation, or Journal Entry modal draft in the tab.
- **Fix Applied:** Wired `hasUnsavedDocumentWork` from `src/lib/pwaUpdateManager.ts` into `reloadOnceForNewVersion` (without consuming the 60s sessionStorage cooldown when blocked), updated `ViewErrorBoundary` to display `"Save or close your open work, then reload"` when unsaved work is open, and guarded manual reload buttons (`Reload now`, `Reload Page`, `Dashboard`) with `safeConfirm`.
- **Regression Test:** `src/tests/agent11-audit-remediations.test.tsx` (`AF11-06` suite).

### `AF11-07` (P1) — SWIFT MT940 `:61:` Reversal Polarity Inversion (`RC`/`RD`) & Offset-4 `'C'` Debit Bug
- **Source:** `src/lib/mt940Parser.ts`.
- **Failure Mechanism:**
  1. `afterDate.startsWith('C') || afterDate.substring(4).startsWith('C') || afterDate.startsWith('RC')` booked SWIFT `RC` (Reversal of Credit = chargeback/debit) as `'credit'` (`+amountCents`) and `RD` (Reversal of Debit = refund/credit) as `'debit'` (`-amountCents`) — reversing the bank account's cash movement by `2 × amount`!
  2. For a `:61:` line without the optional 4-digit `MMDD` entry date, `afterDate.substring(4)` pointed inside the amount/transaction code (e.g., `:61:260916D1,0CNTRF` has `'C'` at index 4 of `D1,0CNTRF`), misclassifying a debit as a credit!
  3. Trailing-comma integer amounts (`500,NTRF`, standard in European/Israeli SWIFT MT940) were ignored by `firstTwoPlaceAmount`, producing `0` cents.
- **Fix Applied:** Replaced heuristic string slicing with structured `:61:` tail parsing (`MT940_TAIL`), mapping `C` and `RD` to `'credit'` (`+rawCents`) and `D` and `RC` to `'debit'` (`-rawCents`), validating optional `MMDD` entry dates via `bankStatementDate`, parsing 0–3 fractional digits with exact integer cent rounding, and rejecting unsafe integer overflows.
- **Regression Test:** `src/tests/agent11-audit-remediations.test.tsx` (`AF11-07 & AF11-08` suite) + `src/tests/fuzz-importers.test.ts`.

### `AF11-08` (P2) — ISO 20022 CAMT.053 Calendar Validation, Safe Cents, Comma Decimals, `RvslInd` & Linear XML Scan
- **Source:** `src/lib/camt053Parser.ts`.
- **Failure Mechanism:** `parseCamt053Statement` accepted impossible calendar dates (`2026-02-30`, `2026-13-45`) and overflowing integer amounts (violating `fuzz-importers.test.ts` invariants), ignored comma decimals (`1250,50 -> 0`), ignored `<RvslInd>true</RvslInd>`, missed XML namespace prefixes (`<ns:Ntry>`, `<ns:Amt>`), and used `[\s\S]*?` regexes.
- **Fix Applied:** Implemented linear-time namespace-aware tag extraction (`extractBlocks`, `extractFirstAmt`, `firstLeafText`), `bankStatementDate` validation, `Number.isSafeInteger` cent bounds, comma/dot decimal parsing, and `<RvslInd>true</RvslInd>` polarity inversion.
- **Regression Test:** `src/tests/agent11-audit-remediations.test.tsx` + `src/tests/fuzz-importers.test.ts` + `src/tests/local-date.test.ts`.

### `AF11-09` (P2) — 12-Month Sample Business Year Used `TaxPlace.region` Instead of `TaxPlace.state` (`F-01`)
- **Source:** `src/lib/sampleBusinessYear.ts:142,144,214,233,517,524`.
- **Failure Mechanism:** `TaxPlace` in `src/lib/tax/profile.ts` defines `state?: string`, whereas `sampleBusinessYear.ts` populated `region: 'TX'`. As a result, `registrationKey` produced `sales_tax:US:32099887766` instead of `sales_tax:US-TX:32099887766`, and `usSalesTaxReturn` treated all US invoices in the 12-month sample business fixture as `unplaced` (`taxCollectedCents === 0`).
- **Fix Applied:** Replaced `region` with `state` across all 6 `TaxPlace` lines in `sampleBusinessYear.ts`. Invoice calculations and balanced GL transactions remain 100% identical while `usSalesTaxReturn` now computes Texas sales tax with `unplaced.documentCount === 0`.
- **Regression Test:** `src/tests/agent11-audit-remediations.test.tsx` (`AF11-09`) + `src/tests/sample-business-year.test.ts` + Playwright `e2e/data-quality-and-sample-year.spec.ts`.

---

## Part B — Cross-Lane / Locked-Test Findings Escalated to Lead & Lane Owners (`AF11-10` – `AF11-16`)

### `AF11-10` (P1 Statutory Compliance) — `GET /api/v1/documents/:type/:id/pdf` and `/zip` Mutate `originalIssuedAt` on `GET`
- **Location:** `src/server/routes/documentRoutes.ts:104,169` -> `src/server/services/copyMarkService.ts:17` (`claimOriginalMark`).
- **Proof & Impact:** Under Israeli Bookkeeping Regulations (הוראות מס הכנסה (ניהול פנקסי חשבונות)), a computerized tax invoice (`חשבונית מס`) may bear `"מקור"` (Original) **once**, for delivery to the buyer; every subsequent print/PDF must bear `"העתק נאמן למקור"`. Currently, `GET /api/v1/documents/invoice/:id/pdf` unconditionally calls `claimOriginalMark` inside a `GET` handler. When an owner previews an invoice PDF internally or runs "Download everything for `<year>`" (`YearEndArchiveExport`) / batch `/zip` before sending the invoice to the customer, `originalIssuedAt` is stamped immediately — so the customer subsequently receives a `"Copy"` instead of `"Original"`. Furthermore, HTTP `GET` violates RFC 9110 safe-method idempotency by mutating accounting records.
- **Recommended Fix (for AI #1 / Server Lane):**
  1. Add `?purpose=preview|archive` (or default `GET` to read-only copy/preview mark: `"העתק נאמן למקור"` if `originalIssuedAt` is set, or `"טיוטת תצוגה / העתק ארכיון — לא הונפק מקור"` when `originalIssuedAt` is null and `purpose=archive`), and only call `claimOriginalMark` on an explicit `POST /api/v1/documents/:type/:id/issue-original` or customer-delivery action (`purpose=issue`).
  2. Update `YearEndArchiveExport` `fetchInvoicePdf` to pass `purpose=archive` once the server parameter lands.

### `AF11-11` (P1 US Payroll Tax Math) — `usFederalPayroll.ts` W-4 Step-2 (`Table 1(b)`) Bracket Halving Bug & Pub. 15-T Threshold Drift
- **Location:** `src/lib/tax/usFederalPayroll.ts:138-280` (locked by `src/tests/us-federal-payroll-golden.test.ts`).
- **Proof & Impact:**
  - In IRS Publication 15-T (2025 & 2026 Percentage Method Tables for Automated Payroll Systems), **Standard (`Table 1(a)`)** subtracts `$8,600` (Single/MFS) or `$12,900` (MFJ) in Step 1(f) (`standardDeductionAdjustmentCents`), so Table 1(a)'s `0%` row (`$7,500` Single in 2026 = `$16,100` standard deduction minus `$8,600`) is **only the residual above `$8,600`**.
  - **Step 2 Checked (`Table 1(b)`)** sets Step 1(f) deduction adjustment to `$0` and puts **exact half of the full `$16,100` standard deduction (`$8,050` Single; `$16,100` MFJ)** as the `0%` bracket threshold, then shifts every bracket threshold accordingly (`$8,050`, `$20,450`, `$58,600`, `$111,850`, `$209,850`, `$264,075`, `$659,950` for 2026 Single).
  - `usFederalPayroll.ts` instead halved Table 1(a)'s `$7,500` residual to **`$3,750`** (`375_000` cents) while ALSO setting `standardDeductionAdjustmentCents: 0`! Every W-4 Step-2 Single employee in 2026 is taxed on **`$4,300/year` (`$8,050 - $3,750`) of tax-free wages**, overwithholding `$430`–`$1,591/year`! Table 1(a) 2026 thresholds (`$19,500`, `$55,900`, …) also diverge from IRS Pub. 15-T (`$19,900`, `$58,050`, …; see PR #569 review).
- **Recommended Fix (for Tax Lane + Owner Sign-Off on Golden Test Update):** Replace `TABLES['2025']` and `TABLES['2026']` `standard` and `step2` arrays in `src/lib/tax/usFederalPayroll.ts` with verbatim IRS Pub. 15-T Automated Percentage Method tables and update `src/tests/us-federal-payroll-golden.test.ts` against hand-computed Pub. 15-T Worksheet 1A examples.

### `AF11-12` (P1 Multi-Country Tax Attribution — **RESOLVED UPSTREAM in PR `#635` / `b5cd6374b`**) — `resolveSellerProfile` Inherited `place` Subfields & `registrations` Across Countries (`#628`)
- **Location:** `src/lib/tax/profile.ts:96-99`.
- **Proof & Impact (at `ec3ff49`):** `const place: TaxPlace = { ...books.place, ...chosen.place }` merged `books.place.state`, `city`, `district`, and `postalCode` into a child entity even when `chosen.place.country !== books.place.country`, and concatenated `books.registrations` with `chosen.registrations` across countries. Corroborated Agent #8's upstream issue `#628`.
- **Resolution Status:** Merged upstream by AI #1 in PR `#635` (`b5cd6374b`, `39b0012`) and synced onto `arena/d3fc43a9-ledgerflow` (verified 4/4 in `src/tests/tax-profile.test.ts` `#628` suite).

### `AF11-13` (P2 Tax Filing & US Quarter Journey) — Per-Permit Filed Matching & `sales_tax` Server Return Kind (`F-08`, Open); Certificate Loop (`#627`, Resolved Upstream in `#635`)
- **Location:** `src/components/reporting/UsQuarterJourneyReportView.tsx:46`, `src/lib/usQuarterJourney.ts:321-337`, `src/server/services/taxReturnService.ts:62`.
- **Proof & Impact:**
  1. `UsQuarterJourneyReportView.tsx:46` strips `registration` when mapping `/tax-returns` into `filedPeriods`, so filing one state's return marks every US state permit in that quarter as filed (`F-08` — **still open**).
  2. `taxReturnService.ts:62` only accepts `kind === 'vat'`, blocking server-side recording of US `sales_tax` returns (`F-08` — **still open**).
  3. `usQuarterJourney.ts:321-337` read current customer `metadata` and `doc.dimensions` instead of saved destination snapshots and `documentEntityLabels` (`#627` — **resolved upstream in PR `#635` / `b5cd6374b`**, verified 3/3 in `src/tests/us-quarter-journey.test.ts`).

### `AF11-14` (P2 Authz Parity) — Co-Owners (`workspace.admins[uid] === true`) Downgraded to `'viewer'` in Server Helpers
- **Location:** `src/server/middleware/periodLock.ts:35` (`workspaceRole`), `src/server/routes/workspaceRoutes.ts:71` (`getWorkspaceUserRole`), `src/server/routes/documentRoutes.ts:194`.
- **Proof & Impact:** PostgreSQL RLS helper `private.lf_ws_role` (`20261013030000_private_helpers.sql:19`) and client `useLedgerData.ts:36` resolve `admins[uid] === true` to `'owner'`, whereas the three server TypeScript helpers check only `ws.uid === uid` and `ws.roles[uid]`, treating co-owners in `ws.admins` without a redundant `ws.roles[uid] = 'owner'` entry as `'viewer'` (`403` on export, period unlock, and document routes).
- **Recommended Fix:** Add `if ((workspace.admins as Record<string, boolean> | undefined)?.[uid] === true) return 'owner';` right after `if (workspace.uid === uid) return 'owner';` in `workspaceRole` and share that single helper across `workspaceRoutes.ts` and `documentRoutes.ts`.

### `AF11-15` (P2 Reporting) — `computeTrialBalance` Silently Drops Lines Referencing Missing Accounts
- **Location:** `src/server/reports/computeReports.ts:176`.
- **Proof & Impact:** `const acc = accountMap.get(line.accountId); if (!acc) continue;` omits orphaned transaction lines from `computeTrialBalance` without tracking them (unlike `computeBalanceSheet` at line 292 which returns `orphanedLines`). If a legacy/corrupted record references a missing account ID, `totalDebits !== totalCredits` on the Trial Balance with no explanation of which transaction line was skipped.
- **Recommended Fix:** Collect `orphanedLines` (`{ txId, accountId, amountCents }[]`) in `computeTrialBalance` just as `computeBalanceSheet` does, and surface a high-visibility warning banner if `orphanedLines.length > 0`.

### `AF11-16` (P2/P3 Security, Governance & Format Hardening)
1. **Handwritten Idempotency (`F-10`, P2):** `src/server/routes/inventoryRoutes.ts`, `leaseRoutes.ts`, and `revenueRoutes.ts` bypass `runWithIdempotency` (`src/server/utils/idempotency.ts`), omitting `status` (`processing`/`completed`) and SHA-256 `payloadHash` conflict detection (`409` on key reuse with mutated payload).
2. **Missing `requireAdmin` Middleware (`S-7`, P2):** `POST /api/v1/admin/integrity/orphan-scan` in `src/server/routes/adminRoutes.ts:127` relies on handler checks rather than route-level `requireAdmin`, and `src/tests/route-policy-coverage.test.ts` checks file-level substring presence rather than per-route AST middleware registration.
3. **Server Audit-Log Coverage (`F-09`, P2):** Only 10 of 33 money-mutating server route modules call `writeServerAuditLog`, and `USER_LOGIN` remains client-emitted.
4. **PostgreSQL `lf_rules` `allowed_keys = NULL` (P3):** 47 of 68 RLS-governed tables leave `allowed_keys` as `NULL` (permissive JSONB keys on direct Supabase writes).
5. **CSV Leading-Whitespace Formula Prefix (`AF-010-F5`, P3 — Locked Test):** `sanitizeCsvCell(' =1+1')` in `src/lib/csv.ts` quotes without prepending `'` because `^[=+\-@]` tests raw `str` rather than `str.trimStart()`; currently locked as an observed-behavior assertion in `src/tests/audit-af010b-csv-dates.test.ts:20`.
6. **IIF Service Item Round-Trip (`A5-001`, P3):** `src/lib/iifImport.ts:285` stores `INVITEMTYPE` (`SERV` / `INVENTORY`) in `category` without setting `itemType: 'service'`, so `iifExport.ts:154` re-exports imported service items as `INVENTORY`.
7. **Git Conflict Markers in Historical Audit Doc (`A5-004`, P3):** `audit/function-audit/FINAL_ACCURATE_LIST_2026-11-08.md` on `main` contains unresolved `<<<<<<<` / `=======` / `>>>>>>>` conflict markers.
