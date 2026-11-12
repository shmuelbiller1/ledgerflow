**POST-REVIEW UPDATE (2026-11-12):** Findings AF6-001 and AF6-002 now have direct route fixes in PR #673 (`workspaceApiRoutes.ts` and `developerApiRoutes.ts`), backed by `src/tests/tenant-create-boundary.test.ts`. They remain unmerged until approval. Patch 01 is archived as a text reference, not executable. A separate four-line explicit-home-cents settlement regression and fix were added in `txFilters.ts` and `home-currency-balance.test.ts`. Details below describe the original pinned baseline. Remaining patches 02–07 are not applied.

# Ledgerflow — Agent #6 Verified Findings Register (`2026-11-12`)

- **Agent**: Agent #6 (Independent Accounting, Financial-Operations, Security & Launch-Readiness Audit)
- **Date**: `2026-11-12` (UTC)
- **Repository**: `shmuelbiller1/ledgerflow` (~3,671 tracked files)
- **Working Branch**: `arena/c3c0cb2e-ledgerflow` (based on `main` @ `c82bead475d9184248265e6f22229813b251a3b2`)

---

## Classification Summary

| Category | Count | IDs |
|---|---:|---|
| **A. Confirmed Accounting, Financial & Security Defects** | **16** | `AF6-001` .. `AF6-015`, `AF6-019` |
| **B. Confirmed CI / Financial-Integrity / Secret-Scan Guard Gaps** | **2** | `AF6-016`, `AF6-017` |
| **C. Prior Security Audit Documentation Clarifications (`PR #618`)** | **1** | `AF6-018` |
| **Total Verified Findings** | **19** | **2 P0 Critical · 9 P1 High · 6 P2 Medium · 2 P3 Low** |

### Fix Delivery Breakdown (Respecting `docs/COORDINATION.md` Lane Ownership)
- **Fixed Directly on Branch `arena/c3c0cb2e-ledgerflow` (6 findings)**: `AF6-003`, `AF6-016` (`#657`), `AF6-017a`, `AF6-017b` (`S-24`/`S-27`), `AF6-018` (`#618`), `AF6-019`.
- **Delivered as Compiler- & Runtime-Verified Standalone Patches (`audit/agent6-2026-11-12/patches/01..07.patch`) + Repro Probes (`audit/agent6-2026-11-12/probes/agent6-reserved-lane-probes.test.ts`) for AI #1's Reserved Lanes (`src/server/**`, `supabase/migrations/**`, `src/lib/tax*`, `src/lib/fx*`) (13 findings)**: `AF6-001`, `AF6-002`, `AF6-004`, `AF6-005`, `AF6-006`, `AF6-007`, `AF6-008`, `AF6-009`, `AF6-010`, `AF6-011`, `AF6-012`, `AF6-013`, `AF6-014`, `AF6-015`.

---

## Section A — Confirmed Accounting, Financial & Security Defects

### `AF6-001` — Full-Tenant Workspace Takeover via Unchecked `POST /api/v1/workspaces`
- **Severity**: **P0 Critical** (Launch Blocker)
- **Area**: Multi-Tenant Authorization / Privileged DB Adapter (`pgFirestore`)
- **Location**: `src/server/routes/workspaceApiRoutes.ts:58-104`, `src/schemas.ts:79-92`, `src/server/db/pgFirestore.ts:294-301`
- **Plain-Language Explanation**: `POST /api/v1/workspaces` validates `req.body` against `WorkspaceSchema` (which accepts optional `id: z.string().optional()`), sets `newId = validation.data.id || ...` and `uid = authReq.user.uid`, and executes `await db.collection("workspaces").doc(newId).set(newWorkspace)` on the privileged PostgreSQL pool (bypassing Supabase RLS). In `pgFirestore`, `.set(doc)` without `{ merge: true }` executes `INSERT INTO public."workspaces" (id, data) ... ON CONFLICT (id) DO UPDATE SET data = excluded.data`.
- **Evidence**:
  - `workspaceApiRoutes.ts:69-79`: `const newId = validation.data.id || ...; await db.collection("workspaces").doc(newId).set(newWorkspace);`
  - Also fails to reject workspace-scoped API keys (`user.developerWorkspaceId`).
- **Financial & Security Impact**: Any authenticated user or API key knowing or guessing a victim `workspaceId` can overwrite the victim workspace document, becoming sole `owner` (`uid: attackerUid`) of **every** ledger transaction, invoice, bill, bank feed, customer, vendor, employee, and report belonging to that `workspaceId`, while locking out the legitimate owner/members and wiping `lockDate` / `softLockDate` / `requireTwoStep`.
- **Reproduction Steps**:
  1. Victim owns workspace `ws_victim` with `lockDate: '2026-09-30'` and posted GL/invoice rows.
  2. Unrelated authenticated user sends `POST /api/v1/workspaces` with `{ "id": "ws_victim", "name": "Pwned", "currency": "USD" }`.
  3. Server responds `201 Created` and overwrites `public.workspaces` row `ws_victim` with `uid: attackerUid`, `lockDate: undefined`.
- **Recommended Fix**: Strip/ignore client-supplied `id`, always generate a server-side `ws_<uuid>`, reject workspace-scoped API keys (`user.developerWorkspaceId`), and execute `tx.create(wsRef, newWorkspace)` inside `db.runTransaction`.
- **Fix Status**: **Tested Standalone Patch Provided** (`audit/agent6-2026-11-12/patches/01-p0-tenant-takeover-and-coa-hijack.patch` — `tsc` 0 errors, `git apply --check` clean).
- **Remaining Risk**: Must be applied by AI #1 / Shmuel before any external multi-tenant exposure.

---

### `AF6-002` — Cross-Tenant `chartAccounts` Hijack & System-Account Overwrite via `POST /api/v1/ledger`
- **Severity**: **P0 Critical** (Launch Blocker)
- **Area**: Multi-Tenant Authorization / Chart of Accounts Integrity
- **Location**: `src/server/routes/developerApiRoutes.ts:151-205`, `src/schemas.ts:69-77`
- **Plain-Language Explanation**: `POST /api/v1/ledger` authorizes the caller against their own `workspaceId`, accepts caller-supplied `req.body.id` via `ChartAccountSchema`, and runs `await db.collection("chartAccounts").doc(newId).set(newAccount)` without checking whether `chartAccounts/<newId>` already exists in **another** tenant's workspace or is an immutable `isSystem: true` control account. In addition, `catch (err)` at line 203 returns HTTP `500` instead of `403` when `authorizeWorkspace` rejects a `viewer` or non-member.
- **Financial & Security Impact**:
  1. **Cross-tenant CoA corruption & hijacking**: Overwriting a victim workspace's `Accounts Receivable`, `Cash`, or `Retained Earnings` account re-parents that `chartAccounts` row to `workspaceId: attackerWorkspaceId`, vanishing the account from the victim's Trial Balance and Balance Sheet and breaking all future victim postings referencing that account ID.
  2. **Intra-workspace system-account tampering**: A `bookkeeper` can change an `isSystem: true` account's `type` (e.g., `liability -> revenue`), corrupting financial statements.
- **Reproduction Steps**:
  1. Victim workspace `ws_victim` has `chartAccounts/acc_ar_victim` (`workspaceId: 'ws_victim'`, `type: 'asset'`).
  2. Attacker (owner of `ws_attacker`) sends `POST /api/v1/ledger` with `{ "workspaceId": "ws_attacker", "id": "acc_ar_victim", "name": "Hijacked", "type": "revenue" }`.
  3. `acc_ar_victim` is overwritten with `workspaceId: "ws_attacker"`.
- **Recommended Fix**: Inside `db.runTransaction`, load `chartAccounts.doc(newId)`; if `existing.exists`, reject (`403`) whenever `existing.data()?.workspaceId !== workspaceId` or `existing.data()?.isSystem === true`; map `FORBIDDEN` / writer-role errors to HTTP `403` and `NOT_FOUND` to `404`.
- **Fix Status**: **Tested Standalone Patch Provided** (`audit/agent6-2026-11-12/patches/01-p0-tenant-takeover-and-coa-hijack.patch`).
- **Remaining Risk**: Must be applied before public Developer API access.

---

### `AF6-003` — Multi-Currency Manual Journal Entry `exchangeRate²` Double-Conversion & Non-2-Decimal (`JPY`/`KWD`) Scaling Bug
- **Severity**: **P0 / P1 High**
- **Area**: General Ledger / Multi-Currency / Financial Statements (`JournalEntryModal`, `DocumentLineEditor`, `txFilters`)
- **Location**: `src/components/ledger/JournalEntryModal.tsx:260-332`, `src/components/common/DocumentLineEditor.tsx:306-345`, `src/lib/txFilters.ts:90-125`
- **Plain-Language Explanation**:
  1. When posting a foreign-currency manual journal entry (e.g., `EUR` `100.00` at `1.65` in an `AUD` workspace), `JournalEntryModal.tsx` pre-converted `amountCents` into home currency (`16,500` AUD cents), set `currency: baseCurrency` (`'AUD'`), left `baseAmountCents` **`undefined`**, and still attached `exchangeRate: 1.65` on the transaction header.
  2. On the server (`crudRoutes.ts:116`), `settleHomeCurrency(tx)` (`txFilters.ts:106-125`) multiplied `[16500, -16500]` by `1.65` → `[27225, -27225]`, saw `residual === 0`, and **returned early without setting `baseAmountCents`**.
  3. Consequently, `lineAmount(line, tx)` (`txFilters.ts:90-96`) — used by Trial Balance, P&L, Balance Sheet, Cash Flow, General Ledger, and Close Anchor — saw `baseAmountCents === undefined` and `tx.exchangeRate === 1.65`, multiplying `16500 * 1.65` a **second time** (`27,225` cents = **`$272.25 AUD` instead of `$165.00 AUD`** = `exchangeRate²`!).
  4. Simultaneously, `DocumentLineEditor.tsx` hardcoded `step="0.01"`, `line.debit / 100`, and `TruthEngine.parseAmountToCents(val)` (omitting `currency`) on journal lines, while `JournalEntryModal.tsx` omitted `convertMinorUnits` (`minorUnitRate`), causing `¥10,000 JPY @ 0.0067` in `USD` books to parse as `1,000,000` and report as `Math.round(1000000 * 0.0067 * 0.0067) = $0.45` instead of **`$67.00`**, and rejecting 3-decimal `KWD` thousandths (`12.345`).
- **Financial & Accounting Impact**: Every foreign-currency manual journal entry misstated Trial Balance, Income Statement, and Balance Sheet account totals by a factor of `exchangeRate` (i.e. `exchangeRate²` instead of `exchangeRate`), and 0/3-decimal currencies (`JPY`, `KRW`, `KWD`, `BHD`, `JOD`, `OMR`) were misstated by `10×`–`10,000×`.
- **Fix Applied**:
  1. `src/components/ledger/JournalEntryModal.tsx`: Uses `convertMinorUnits(signedMinor, appliedRate, transactionCurrency, baseCurrency)` and populates explicit `baseAmountCents` on all foreign-currency journal and rounding lines so `lineAmount(l, tx)` reads the exact converted home-currency cents without re-multiplying by `exchangeRate`.
  2. `src/components/common/DocumentLineEditor.tsx`: Uses `amountStep(currency)`, `minorToMajor(..., currency)`, and `TruthEngine.parseAmountToCents(..., currency)` on journal debit/credit inputs.
- **Fix Status**: **FIXED IN BRANCH (`arena/c3c0cb2e-ledgerflow`)**.
- **Tests Added**: `src/tests/agent6-security-and-fx-audit.test.tsx` (`AF6-003a` EUR `1.65`, `AF6-003b` JPY `0.0067`, `AF6-003c` KWD `3.25`) + verified all existing `journal-entry-rates.test.tsx`, `journal-view.test.tsx`, `journal-templates.test.tsx`, and `auto-reversal.test.tsx` pass.

---

### `AF6-004` — IRS Publication 15-T Form W-4 Step 2 Federal Withholding Tables Omit Half of Step 1g Standard Deduction (`$4,300` Single/HOH, `$6,450` MFJ)
- **Severity**: **P1 High**
- **Area**: US Federal Payroll Tax Calculation (`D-15` / `D-18`)
- **Location**: `src/lib/tax/usFederalPayroll.ts:147-168,200-221,272-288`, `src/tests/us-federal-payroll-golden.test.ts:93-110`
- **Plain-Language Explanation**: Under IRS Publication 15-T Section 1 (Percentage Method Tables for Automated Payroll Systems):
  - When W-4 Step 2 is **unchecked** (Table 1(a)), Worksheet 1A Step 1g subtracts `$8,600` (`$12,900` MFJ) from annualized wages, and Table 1(a)'s `0%` bracket covers the remainder of the Standard Deduction (`$7,500` in 2026 Single → `$8,600 + $7,500 = $16,100` total standard deduction).
  - When W-4 Step 2 **is checked** (Table 1(b), two equal jobs), Worksheet 1A Step 1f subtracts **`$0`**, so Table 1(b)'s `0%` bracket in IRS Pub 15-T must equal **half of the full Standard Deduction** (`($7,500 + $8,600) / 2 = $8,050` Single 2026; `($14,900 + $12,900) / 2 = $13,900` MFJ 2026), and every subsequent bracket threshold is `(Table1a_overCents + Step1g_adjustment) / 2`.
  - Instead, all six `*_STEP2` tables (`B2026_SINGLE_STEP2`, `B2026_MFJ_STEP2`, `B2026_HOH_STEP2`, `B2025_SINGLE_STEP2`, `B2025_MFJ_STEP2`, `B2025_HOH_STEP2`) halved **only** `Table1a_overCents` (`$7,500 / 2 = $3,750`), dropping `$4,300` (`$6,450` MFJ) of tax-free wages and shifting every bracket threshold down by `$4,300` / `$6,450`.
- **Evidence (Executable Probe Verified)**:
  - `calculateFederalIncomeTaxWithholding(10400000, 'single', false, 'annually', '2026-05-01')` = **`1,341,000` cents (`$13,410.00`)**.
  - `2 * calculateFederalIncomeTaxWithholding(5200000, 'single', true, 'annually', '2026-05-01')` = **`1,530,200` cents (`$15,302.00`)** — **over-withholding `$1,892.00/yr` (`2 × 22% × $4,300.00` to the exact cent)**.
  - `us-federal-payroll-golden.test.ts:93-110` (Example 4) was hand-calculated from the buggy `$32,150` threshold (`14,713` cents/wk instead of `12,894` cents/wk).
- **Recommended Fix**: Derive all six `*_STEP2` bracket tables via `makeStep2Brackets(std, step1gAdjustmentCents)` (`overCents = Math.round((b.overCents + step1gAdjustmentCents) / 2)`, `baseTaxCents = Math.round(b.baseTaxCents / 2)`) and update Golden Example 4 to `$128.94/wk` (`12,894` cents) with an explicit `2 * Step2(W/2) === Std(W)` invariant assertion.
- **Fix Status**: **Tested Standalone Patch Provided** (`audit/agent6-2026-11-12/patches/02-p1-irs-pub15t-step2-payroll-brackets.patch` — `tsc` 0 errors, `11/11` golden tests pass) + Repro Probe (`Probe AF6-004`).

---

### `AF6-005` — 100× (`JPY`/`KRW`) and 10× (`KWD`/`BHD`) Error in Month-End Unrealized FX Revaluation & Party Balance Conversion
- **Severity**: **P1 High**
- **Area**: Multi-Currency / Month-End Close (`R-07` FX Revaluation) & Party Reports
- **Location**: `src/lib/fxRevaluation.ts:195-196`, `src/server/reports/partyReports.ts:13-16`
- **Plain-Language Explanation**: Per `src/lib/currencyMinorUnits.ts` (`BM-04`), open document amounts (`openCents`) are stored in the **document currency's own minor units** (`0` decimals for `JPY`/`KRW`, `3` decimals for `KWD`/`BHD`/`JOD`/`OMR`, `2` for `USD`/`EUR`), while `exchangeRate` is major home units per major document unit. However, `planFxRevaluation` (`fxRevaluation.ts:195-196`) computes `bookedBaseCents = toBaseCents(openCents, bookedRate)` (`Math.round(openCents * rate)`) and `todayBaseCents = Math.round(openCents * todayRate)` without `convertMinorUnits(..., currency, base)`.
- **Evidence (Executable Probe Verified)**:
  - Open `JPY` invoice `¥10,000` (`amountCents: 10000`) booked at `0.0067` (`$67.00 USD`) and revalued at `0.0070` (`$70.00 USD`): true unrealized FX gain = **`+$3.00` (`300` cents)**.
  - `planFxRevaluation` computes `70 - 67 = 3` cents (**`$0.03` — 100× understated**). For `KWD` (`3` decimals) in `USD` books, revaluation is **10× overstated**.
- **Recommended Fix**: Use `convertMinorUnits(openCents, rate, currency, base)` in `src/lib/fxRevaluation.ts` and accept optional `(fromCurrency, baseCurrency)` in `partyReports.ts:toBaseCents`.
- **Fix Status**: **Tested Standalone Patch Provided** (`audit/agent6-2026-11-12/patches/03-p1-fx-revaluation-minor-units.patch`) + Repro Probe (`Probe AF6-005`).

---

### `AF6-006` — Server Audit Hash-Chain Verifier (`auditLogService.verifyAuditHashChain`) Fails on Every Multi-Entry Stream Written by `writeServerAuditLog` (`S-12`)
- **Severity**: **P1 High**
- **Area**: Cryptographic Audit Trail (`S-12`)
- **Location**: `src/server/services/auditLogService.ts:61-89,115-160,208-216`
- **Plain-Language Explanation**:
  1. `buildAuditLogRecord` computes **two** distinct SHA-256 digests on every audit record: `chainHash` (`computeAuditChainHash`, hashing an 8-element JSON tuple) and `entryHash` (`computeAuditEntryHash` from `src/lib/auditHashChain.ts`, hashing canonical v1 JSON including `seq` and `details`).
  2. `writeServerAuditLog` (and `pgFirestore.nextAuditChainHead`) sets the **next** entry's `prevHash` to `prev.entryHash`.
  3. However, `auditLogService.verifyAuditHashChain` (`lines 61-89`) updates `expectedPrev = entry.chainHash` (`line 79`) and rejects entry #2 whenever `entry2.prevHash !== entry1.chainHash` (`line 71`). Because `entry1.entryHash !== entry1.chainHash`, `auditLogService.verifyAuditHashChain` **always returns `{ valid: false, brokenAtId: entry2.id }`** on real `writeServerAuditLog` streams (the unit test `audit-idempotency-body-limits.test.ts:221` masked this by manually passing `r1.chainHash` to `buildAuditLogRecord`).
  4. Additionally, when `writeServerAuditLog` is called with `{ tx }` on a store without `tx.nextAuditChainHead` (`lines 208-216`), it mutates in-memory `chainHeadsByWorkspace` before the outer transaction commits; if the outer transaction rolls back, all subsequent sequence numbers/hashes for that workspace are poisoned.
- **Fix Status**: **Tested Standalone Patch Provided** (`audit/agent6-2026-11-12/patches/04-p1-audit-hash-chain-verifier-and-cache.patch`) + Repro Probe (`Probe AF6-006`).

---

### `AF6-007` — Hard-Deletion of Posted (`completed`), Reconciled, and Document-Linked GL Entries via `DELETE /api/v1/transactions/:id`
- **Severity**: **P1 High**
- **Area**: General Ledger Immutability / AP-AR / Bank Reconciliation
- **Location**: `src/server/routes/transactions/crudRoutes.ts:386-460`
- **Plain-Language Explanation**: `DELETE /api/v1/transactions/:id` checks only `status === 'certified' || status === 'void' || isCleared === true`. It allows any `bookkeeper`, `accountant`, or `owner` to permanently `t.delete(txRef)` a posted `status: 'completed'` GL entry in an open period — even when `reconciled === true` / `isReconciled === true` (without `isCleared`) or when the entry was posted by an issued invoice, bill, payment, or credit note (`metadata.invoiceId` / `billId` / `paymentId` / `creditNoteId` / `vendorCreditId`).
- **Financial & Accounting Impact**: Breaks double-entry auditability (posted entries should be reversed via `/reverse`, never erased), desynchronizes AR/AP subledgers (`invoices`/`bills`/`payments` remain `sent`/`paid` while their GL entries vanish), and silently breaks completed bank reconciliations.
- **Fix Status**: **Tested Standalone Patch Provided** (`audit/agent6-2026-11-12/patches/05-p1-gl-delete-batch-reconcile-intercompany-guards.patch`).

---

### `AF6-008` — `POST /api/v1/transactions/batch` Bypasses Revaluation Locks, Cleared/Reconciled Locks, Source-Document Guards, `settleHomeCurrency`, and `ledgerDoor`
- **Severity**: **P1 High**
- **Area**: General Ledger Batch Mutation Safety
- **Location**: `src/server/routes/transactions/bulkRoutes.ts:80-160`
- **Plain-Language Explanation**: `POST /api/v1/transactions/batch` permits mutating `lines`, `status`, `metadata`, `isCleared`, and `reconciled` on up to 2,000 posted entries per call, but omits:
  1. `revaluationEntryLock(txData)` (`ISS-130`),
  2. `isCleared === true || reconciled === true || isReconciled === true` lock checks (checking only `certified` and `void`),
  3. Source-document protection (`metadata.invoiceId`/`billId`/`paymentId`/`creditNoteId`/`vendorCreditId`),
  4. `settleHomeCurrency` (so batch-edited FX lines lose `baseAmountCents` penny settlement), and
  5. `checkLedgerEntry` (`ledgerDoor`).
- **Fix Status**: **Tested Standalone Patch Provided** (`audit/agent6-2026-11-12/patches/05-p1-gl-delete-batch-reconcile-intercompany-guards.patch`).

---

### `AF6-009` — Bank Reconciliation `POST /api/v1/transactions/reconcile` TOCTOU Window & `updateTransaction` Lock/`ledgerDoor` Bypass (`#657`)
- **Severity**: **P1 High**
- **Area**: Banking & Reconciliation / Period Lock Concurrency / `ledgerDoor`
- **Location**: `src/server/routes/transactions/reconcileRoutes.ts:37-46,65-85,149-208`
- **Plain-Language Explanation**:
  1. `handleReconcile` reads `workspaces.doc(workspaceId)` and `getWorkspaceUserRole` **outside** `db.runTransaction` (`lines 37-46`) and reuses that stale `wsData` inside `runTransaction` (`lines 80-84`), creating a TOCTOU race if an owner closes the period or revokes a bookkeeper's role concurrently.
  2. `updateTransaction` omits `revaluationEntryLock`, `certified`/`void` status checks, source-document line-rewrite protection, `settleHomeCurrency`, and `checkLedgerEntry`, and `createTransaction` calls `t.create(txRef, ...)` directly instead of `ledgerCreate`.
- **Fix Status**: **Tested Standalone Patch Provided** (`audit/agent6-2026-11-12/patches/05-p1-gl-delete-batch-reconcile-intercompany-guards.patch`) + **Direct CI Scanner Fix Shipped on Branch** (`AF6-016` / `#657`).

---

### `AF6-010` — Read-Only `viewer` Consumes One-Time Israeli Statutory Original (`מקור`) Stamp on PDF / ZIP Download
- **Severity**: **P1 High**
- **Area**: Israeli Tax Document Compliance (`PLAN IL-2`) / Role Authorization
- **Location**: `src/server/routes/documentRoutes.ts:75-169`, `src/server/services/copyMarkService.ts:17-28`
- **Plain-Language Explanation**: Under Israeli VAT / bookkeeping regulations (`הוראות ניהול ספרים`), a tax invoice (`חשבונית מס`), credit invoice, or receipt may be issued **once** as `מקור` (`original`), and all subsequent prints must bear `העתק נאמן למקור` (`copy`). `handlePdfRequest` (`GET/POST /:type/:id/pdf`) and `handleZipRequest` (`POST /zip`) allow any workspace member — including a read-only **`viewer`** — to download PDFs and unconditionally invoke `takeCopyMark`, which executes `t.update(ref, { originalIssuedAt: ... })`, permanently burning the customer's sole statutory original. Both handlers also call `validateWorkspaceMember` instead of `assertWorkspaceAccess` (skipping `requireWorkspaceTwoStep`).
- **Fix Status**: **Tested Standalone Patch Provided** (`audit/agent6-2026-11-12/patches/06-p1-copymark-2fa-consolidation-recurring-guards.patch` — `viewer` receives `'copy'` via `{ readOnly: true }` without mutating `originalIssuedAt`, and `assertWorkspaceAccess` enforces 2FA).

---

### `AF6-011` — PostgreSQL Double-Entry & Document-Settlement Trigger Escape Hatches
- **Severity**: **P1 / P2 Medium-High**
- **Area**: Database Integrity Triggers & RLS Field Guards
- **Location**: `supabase/migrations/20261111000000_ledger_integrity_and_rls_hardening.sql:85-105,184,210,332-334`, `supabase/migrations/20261111120000_ledger_server_only_and_balance_check.sql:50-56,104,120-165`
- **Plain-Language Explanation**:
  1. Both `lf_transactions_ledger_integrity` and `lf_enforce_balanced_ledger` return `new` early when `metadata.isYearEndClose = true` or when `lines` is `null` / `[]` (`line_count = 0`) even on `status = 'completed'` posted rows, and when `exchangeRate <> 1` with partial `baseAmountCents` lines, SQL sums raw `amt_cents` on un-annotated lines while TypeScript `lineAmount` multiplies by `exchangeRate`.
  2. `lf_document_settlement_guard` and `lf_guard_document_settlement` block client `UPDATE` transitions **into** `('paid','partially_paid','partial','applied')`, but allow a client writer (`bookkeeper`) to flip an already-`paid` invoice or bill **out of** `'paid'` (e.g., `'paid' -> 'sent'` or `'paid' -> 'void'`), and omit `refundedCents` on `creditNotes`/`vendorCredits` (which `partyReports.ts:63` subtracts directly from customer/vendor credit balances).
  3. `recurring` (`20261111000000:332-334`) includes `uid` in `allowed_keys` without `immutable_keys`, letting a `bookkeeper` rewrite `uid` to the workspace `owner`'s UID so `recurringService` bypasses `softLockDate`.
- **Fix Status**: **Tested Standalone SQL Migration Patch Provided** (`audit/agent6-2026-11-12/patches/07-p1-sql-ledger-and-settlement-triggers.patch`).

---

### `AF6-012` — Intercompany Transfer Self-Post, Non-Atomic Two-Entity `db.batch()`, and Arbitrary Expense/Asset Fallback Account
- **Severity**: **P2 Medium**
- **Area**: Multi-Entity / Intercompany Accounting
- **Location**: `src/server/routes/transactions/reverseRoutes.ts:272-460`
- **Plain-Language Explanation**: `POST /api/v1/transactions/intercompany/post`:
  1. Allows `sourceWorkspaceId === targetWorkspaceId` (creating bogus Due From / Due To intercompany balances inside a single entity),
  2. Uses `db.batch()` rather than `db.runTransaction(...)` when creating clearing accounts + posting two reciprocal GL entries across two entities, and
  3. Falls back to `targetAccounts.find(a => a.type === 'expense' || a.type === 'asset')?.id` (`line 418`) when `targetAccountId` is omitted, debiting whichever expense or fixed-asset account happens to sit first in `targetAccounts` instead of a Cash/Bank clearing account.
- **Fix Status**: **Tested Standalone Patch Provided** (`audit/agent6-2026-11-12/patches/05-p1-gl-delete-batch-reconcile-intercompany-guards.patch`).

---

### `AF6-013` — `/api/v1/ai/process` Bypasses Workspace `requireTwoStep` (AAL2) & Lacks Dedicated Per-User Rate Limiter (`S-22`)
- **Severity**: **P2 Medium**
- **Area**: Authentication / Two-Step Login (`Y-30`) & Rate Limiting (`S-22`)
- **Location**: `src/server/routes/aiRoutes.ts:55-106`, `src/server/middleware/rateLimiters.ts:8-11`
- **Plain-Language Explanation**: `aiRouter.post('/process')` calls `verifyIdToken` + `validateWorkspaceMember` instead of `assertWorkspaceAccess`, omitting the workspace-level `requireWorkspaceTwoStep` check enforced by `authenticate`/`assertWorkspaceAccess` (for tokens where `workspacesRequiringTwoStep` cache or API-key/session paths differ), and mounts no per-user `brainRateLimiter` (relying only on the coarse 100/min IP `apiLimiter` and 1,000/15m `limiter`). `authRateLimiter` in `rateLimiters.ts` also remains unmounted.
- **Fix Status**: **Tested Standalone Patch Provided** (`audit/agent6-2026-11-12/patches/06-p1-copymark-2fa-consolidation-recurring-guards.patch`).

---

### `AF6-014` — Multi-Entity Consolidation Routes Bypass `requireTwoStep`, Subsidiary Writer-Role Checks, and `developerWorkspaceId` API-Key Scope
- **Severity**: **P2 Medium**
- **Area**: Multi-Entity Consolidation Authorization & API-Key Scoping
- **Location**: `src/server/routes/consolidationRoutes.ts:25-65,108-125`
- **Plain-Language Explanation**: `POST /api/v1/consolidation/eliminate` and `GET /api/v1/consolidation/close-status` call `validateWorkspaceMember` instead of `assertWorkspaceAccess` (skipping `requireWorkspaceTwoStep`), never enforce `user.developerWorkspaceId` (allowing an API key scoped strictly to Workspace A to read transactions across subsidiary Workspace B if the key creator belongs to both), and check writer role only on `primaryWorkspaceId` rather than all `entityWorkspaceIds`.
- **Fix Status**: **Tested Standalone Patch Provided** (`audit/agent6-2026-11-12/patches/06-p1-copymark-2fa-consolidation-recurring-guards.patch`).

---

### `AF6-015` — Recurring Entry Engine Trusts Mutable `rule.uid` Outside `runTransaction` & Skips `settleHomeCurrency` / `ledgerWrite`
- **Severity**: **P2 Medium**
- **Area**: Recurring Journal Entries / Period Lock / FX Rounding
- **Location**: `src/server/services/recurringService.ts:239-275`
- **Plain-Language Explanation**: `generateEntry` checks `assertPostingOpen(date, workspace, rule.uid)` outside `db.runTransaction`, never verifies that `rule.uid` is still a current member with writer permissions in `rule.workspaceId` (so a removed or demoted user's recurring schedule continues posting, or a bookkeeper who edited `recurring.uid` bypasses `softLockDate`), omits `settleHomeCurrency` on multi-line FX templates, and writes via `tx.set(txRef, ...)` instead of `ledgerWrite`.
- **Fix Status**: **Tested Standalone Patch Provided** (`audit/agent6-2026-11-12/patches/06-p1-copymark-2fa-consolidation-recurring-guards.patch`).

---

### `AF6-019` — `withReversal` (`autoReversal.ts`) Negates `amountCents` Without Negating `baseAmountCents`
- **Severity**: **P2 Medium**
- **Area**: Auto-Reversing Accrual Journal Entries (`R-05`) / Multi-Currency
- **Location**: `src/lib/autoReversal.ts:27-37`
- **Plain-Language Explanation**: `withReversal` builds the next-month reversal entry via `entry.lines.map(l => ({ ...l, amountCents: -l.amountCents }))`. Whenever an accrual carries `baseAmountCents` (any foreign-currency accrual), `baseAmountCents` remained **positive** on debit lines and **negative** on credit lines in the reversal entry! Because `lineAmount(l, tx)` prefers `baseAmountCents` over `amountCents`, the reversal **doubled** the home-currency accrual in month `M+1` (`+base + +base = 2×`) instead of cancelling it to `0`!
- **Fix Status**: **FIXED IN BRANCH (`arena/c3c0cb2e-ledgerflow`)** (`src/lib/autoReversal.ts:33-37` + regression test `AF6-019` in `src/tests/agent6-security-and-fx-audit.test.tsx`).

---

## Section B — CI / Financial-Integrity / Secret-Scan Guard Gaps

### `AF6-016` — `AU-6` `ledgerDoor` Scanner (`scripts/bug-patterns.ts`) Missed All 13 Variable-Held `DocumentReference` Writes (`Issue #657`)
- **Severity**: **P2 Medium**
- **Area**: CI Financial-Integrity Ratchet (`AU-6` / Issue `#657`)
- **Location**: `scripts/bug-patterns.ts:204-209`, `ledger-door-baseline.json`, `src/tests/bug-patterns.test.ts:141-145`
- **Plain-Language Explanation**: `scanFinancialIntegrity` matched `server-direct-ledger-write` only when `collection('transactions')` appeared literally inline inside `.set/.update/.create/.add(...)`, reporting `0` direct writes in `ledger-door-baseline.json` while missing **13 real variable-held `DocumentReference` writes** across 9 server files (`crudRoutes.ts:307,370`, `reconcileRoutes.ts:169,191,500`, `reverseRoutes.ts:220`, `assetDisposalService.ts:173,188`, `assetTransferService.ts:126`, `fxRevaluationService.ts:353`, `paymentService.ts:493`, `placeInServiceService.ts:115`, `recurringService.ts:261`).
- **Fix Status**: **FIXED IN BRANCH (`arena/c3c0cb2e-ledgerflow`)** — `scripts/bug-patterns.ts` now resolves `collection('transactions')` and `.doc(...)` variable bindings, `ledger-door-baseline.json` records both `"server-direct-ledger-write": 13` and per-file `"sites"` counts, and `src/tests/bug-patterns.test.ts` enforces per-file site ceilings + unit-tests variable-held detection.

---

### `AF6-017` — Incomplete CI Secret-Scan Coverage (`S-24`/`S-27`) & Loose `--max-warnings 12` ESLint Cap
- **Severity**: **P3 Low**
- **Area**: CI Security & Code-Quality Ratchets
- **Location**: `.github/workflows/security-sbom.yml:40-58`, `package.json:27`
- **Plain-Language Explanation**:
  1. `.github/workflows/security-sbom.yml` scanned tracked files for only 4 secret patterns (`PEM`, `sk_live_`, `ghp_`, `sbp_`), omitting `.gitleaks.toml`'s rules for Stripe `rk_live_`, GitHub fine-grained `github_pat_`, Resend `re_`, SendGrid `SG.`, Google/Gemini `AIza`, Slack `xox*`, and AWS `AKIA`/`ASIA` keys.
  2. `package.json` allowed `--max-warnings 12` while actual codebase warnings are `2` (`supabaseAuth.ts:21`, `pg/values.ts:7`), leaving a 10-warning regression buffer.
- **Fix Status**: **FIXED IN BRANCH (`arena/c3c0cb2e-ledgerflow`)** — Expanded `security-sbom.yml` to all 9 secret classes (0 false positives across 3,671 tracked files) and tightened `package.json` `lint:eslint` to `--max-warnings 2`.

---

## Section C — Prior Audit Documentation Clarifications (`PR #618`)

### `AF6-018` — CodeRabbit Factual Clarifications on `audit/ai6/security-audit-2026-11-05.md`
- **Severity**: **P3 Low (Documentation)**
- **Location**: `audit/ai6/security-audit-2026-11-05.md`
- **Fix Status**: **FIXED IN BRANCH (`arena/c3c0cb2e-ledgerflow`)** — Clarified `S-19` (`LF_ALLOW_GUEST_AUTH=1`), `S-20` (`orphan-scan` missing `requireAdmin`), `S-24`/`S-27` (`.gitleaks.toml` valid TOML + CI secret scan in `security-sbom.yml`), `S-30` (`validateUploadedFile` on CSV upload), and `2026-11-12` re-verification status (`F-06` resolved by migration `20261111000000`).

---

## Section D — Ground-Truth Security Queue (`S-01 .. S-40`) Verification Matrix at `c82bead4`

| Item(s) | Control Description | Verified Status (`2026-11-12`) | Evidence |
|---|---|---|---|
| `S-01` | Shared cross-instance rate limiter | **Verified Present** | `sharedRateLimiter.ts` + migration `20261021000000_shared_rate_limit_entries.sql` |
| `S-02` | Production environment preflight | **Verified Present** | `scripts/check-prod-env.ts` (`npm run check:prod-env`) + unit test in `agent6-security-and-fx-audit.test.tsx` |
| `S-03` | Backup & point-in-time restore drill | **Verified Present** | `scripts/restore-drill.mjs` + `workspaceRestoreService.ts` (`ledgerDoor` validated) |
| `S-04` | CycloneDX SBOM & license inventory | **Verified Present** | `.github/workflows/security-sbom.yml` |
| `S-05` | Idempotency enforcement across money writes | **Verified Present** (with `#114` legacy fallback tracked) | `idempotency.ts`, `ledgerBulkCommit.ts`, `audit-idempotency-body-limits.test.ts` |
| `S-06` / `S-23` / `S-34` | Content-Security-Policy & security headers | **Verified Present** | `contentSecurityPolicy.ts`, `securityMiddleware.ts`, `cspReportRoutes.ts`, `scripts/vercel-csp.ts` |
| `S-10` / `S-25` | Dependabot & `npm audit` CI gate | **Verified Present** (`0` high/critical) | `.github/dependabot.yml`, `.github/workflows/ci.yml` |
| `S-12` | SHA-256 hash-chained audit logs | **Partial — Defect `AF6-006`** | `auditHashChain.ts` + `auditLogService.ts` (`Patch 04` fixes `verifyAuditHashChain` mismatch) |
| `S-16` / `S-18` | AI payload allowlist, PII scrubbing & PAN masking | **Verified Present** | `aiGateway.ts` (`allowedPayload`), `SecurityService.scrubPII`, `cardNumberMask.ts` |
| `S-19` | Guest-auth opt-in guard | **Verified Present** | Dev-only `LF_ALLOW_GUEST_AUTH=1`; `verifyIdToken` enforces signed Supabase JWT + email confirmation |
| `S-20` / `S-26` | Admin route authorization & audit logging | **Partial — Low `F-03`** | All `/api/v1/admin/*` audited & `requireAdmin` except `orphan-scan` (workspace-member gated) |
| `S-21` | Workspace access review & 2FA visibility | **Verified Present** | `src/lib/accessReview.ts` (`BJ-03` / `C-35`) |
| `S-22` | Per-user limits on auth & AI endpoints | **Open — Defect `AF6-013`** | `brainRateLimiter` active on `/brain`; missing on `/ai/process` + `requireTwoStep` gap (`Patch 06`) |
| `S-24` / `S-27` | Secret scanning in CI | **Hardened in Branch (`AF6-017b`)** | `.gitleaks.toml` + expanded 9-class scanner in `.github/workflows/security-sbom.yml` |
| `S-30` | Upload MIME/magic-byte inspection | **Verified Present** | `validateUploadedFile` (`fileValidation.ts`) + temp-file unlink on `logsUploadRoutes.ts` |
| `S-31` | Webhook signature verification | **Verified Present** | Stripe `constructEvent`, Plaid JWT/timestamp + `plaidWebhookLimiter`, email `timingSafeEqual` |
| `S-32` | PostgreSQL RLS & `lf_rules` allowlists | **Hardened + Residual `AF6-011`** | 75+ RLS tables + `20261111000000` & `20261111120000` (`Patch 07` closes remaining trigger gaps) |
| `S-37..S-40` | `AUD-09` write-route authorization matrices | **Partial — P0 `AF6-001` & `AF6-002` Found!** | `aud09-*` missed `POST /api/v1/workspaces` & `POST /api/v1/ledger` `.doc(id).set(...)` overwrites (`Patch 01`) |
