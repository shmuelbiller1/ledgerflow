# Checkpoint 01 — Deep Independent Audit & Master Findings Register (Agent #8 — 2026-11-16)

- **Session Date:** `2026-11-16` (UTC)
- **Agent:** Agent #8 (Independent Financial, Security, Database & Full-Stack Audit)
- **Branch:** `arena/0b4400c3-ledgerflow`
- **Base Commit (`main`):** `f6ff00511fef2eea283531b8966368c1ad5f2615` (`[AI #9] EU-I3: free invoice maker at the door, plus EU queue docs (#737)`)
- **Live PostgreSQL Verification Environment:** PostgreSQL 16.2 (`127.0.0.1:5432`, db `lf_test`, all 57 migrations applied via `npm run db:test-setup`)
- **Google Drive Recovery Archive:** Root `1VG4z3otVCVhN2Vmr8jnssok8bIF2J-RK` · `08-Independent-Audits` (`1d6WMJSpoCBuTjvSngFeTGT0wxZU-mL3V`)

---

## 1. Baseline Verification at `f6ff005`

All static, structural, rule-pack, and live Postgres baseline gates were executed directly prior to any edits:

| Gate | Command | Result at `f6ff005` |
|---|---|---|
| TypeScript | `NODE_OPTIONS="--max-old-space-size=4096" npm run lint:types` | **PASS** (0 errors) |
| ESLint Ratchet | `NODE_OPTIONS="--max-old-space-size=4096" npm run lint:eslint` | **PASS** (0 errors, 2/2 warnings) |
| Architecture Layers | `npm run check:layers` | **PASS** (4/4) |
| Tax Tables | `npm run check:tax-tables` | **PASS** (0 problems) |
| Rule Packs | `npm run lint:rule-packs` | **PASS** (584 rules, 0 problems) |
| Postgres Migrations | `npm run db:test-setup` (PG 16.2) | **PASS** (57 migrations) |
| Postgres RLS Suite | `npm run test:rules` (PG 16.2) | **PASS** (`ALL RLS TESTS PASSED`) |
| Security Sweep | `npm run test:security` (PG 16.2) | **PASS** (4/4; documents 28 `serverErrors` in baseline) |
| Bug Patterns Scanner | `scripts/bug-patterns.ts` | 30 server/SQL hits (11 direct-ledger-write, 5 partial-batch, 1 unkeyed-payment, 13 sql-trusted-server-exemption) |

### Coordination & Conflict Avoidance
- Active upstream PRs inspected via `gh pr list`:
  - **PR #743** (`CMD-1: person-scoped commands + accountRoutes`): touches `commands-baseline.json`, `scripts/generate-commands.ts`, `src/lib/commandSchemas.generated/*`, `src/server/commands/{registry,defaultRegistry,types,account,groups}.ts`, `src/server/routes/{commandRoutes,accountRoutes}.ts`.
  - **PR #744** (`Raw table sweep, batch 2`): touches UI report views & `RowTable.tsx`.
- **Zero overlap:** None of the files modified by Agent #8 touch any file modified in PR #743 or PR #744.
- **Prior fixes confirmed genuinely closed on `f6ff005`:** `AF6-001`, `AF6-002`; browser writes revoked on `invoices`/`bills`/`creditNotes`/`vendorCredits`/`autoRules` (`20261115000000`); `transactionRouter` & `authorizeWorkspace` enforce writer roles; `workspaces` `lf_guard_special` blocks `bypassBilling`/`plan`/`computeCreditBalance`/`maxSeats` escalation on INSERT; `billPosting.ts:154-156` resets `exchangeRate: 1` via `inBaseCurrency`; `watches`, `alerts`, `warranty.update` clean.

---

## 2. Master Findings Register (32 Verified Defects: 24 Brand-New Agent #8 + 8 Still-Live Prior Agent #7)

### P0 — Launch-Blocking Financial Integrity, Cross-Tenant, RLS & Tax Filing Defects (10)

| ID | Category | File(s) & Line(s) | Verified Defect & Concrete Exploit / Accounting Impact | Planned Action |
|---|---|---|---|---|
| **A8-005** | CMD-1 / Financial Integrity | `src/server/commands/documents.ts:62-66`, `src/schemas.ts:225,254-255,318-319,496,522`, `src/server/services/documentPostService.ts`, `src/server/services/ledgerBulkCommit.ts:375-391` | CMD-1 `invoice/bill/creditnote/vendorcredit.create/update` and `POST /documents/:type/:id/post` accept client-supplied server-managed settlement fields (`amountPaidCents`, `settledByRecordsCents`, `depositCents`, `remainingCents`, `writtenOffCents`, `refundedCents`, `revenueSchedule`, `prepaidSchedule`, `writeOffTransactionId`), bypassing Postgres `lf_is_client()` triggers. Enables marking an unpaid invoice `paid` with $0 cash (AR/GL divergence), reopening a paid invoice by setting `amountPaidCents: 0`, and infinite credit-note refund/application loops by resetting `remainingCents: amountCents`. | **Fix + Test in PR** |
| **A8-007** | Period Lock / Tax Compliance | `src/server/services/documentPostService.ts:102-112`, `src/services/ledgerPost/{invoice,bill,credit}Posting.ts` | Updating a posted document checks `assertPostingOpen` ONLY against the NEW `document.date` and passes `lockChecked: true`, ignoring `existing.date` and existing posted transaction dates. Any writer can re-date a locked/filed-period invoice, bill, or credit note into an open period, mutating filed-period documents and silently diverging GL from filed tax returns. | **Fix + Test in PR** |
| **A8-008** | AR/AP Ledger Integrity | `src/services/ledgerPost/deletePostings.ts:1-57`, `src/server/services/documentPostService.ts:121` | `invoice/bill/creditnote/vendorcredit.delete` never checks `settledByRecordsCents`, `amountPaidCents`, `writtenOffCents`, `remainingCents < amountCents`, `refundedCents > 0`, or active `revenueSchedule`/`prepaidSchedule`. Deleting a paid invoice or applied/refunded credit reverses the original accrual while leaving payment/refund/recognition entries live — driving AR/AP negative and corrupting financial statements. | **Fix + Test in PR** |
| **A8-009** | Postgres RLS Escalation | Live Postgres `pg_policies` + `public.lf_rules` on `public.documents` | `own_insert`/`own_update` policies + `lf_rules.allowed_keys` on `public.documents` allow any read-only `viewer` to directly INSERT/UPDATE rows with `kind`, `sets`, `lines`, `status`, `assignee`, `dueDate`, `paidRunId`, `hours`, `employeeId`, `rateCents`. A `viewer` can hijack `${ws}_stageSets`, forge `journal-template` rows, tamper with tasks, or forge approved/paid `time` records. | **Fix (Migration + `rls.test.sql`) in PR** |
| **A8-012** (+ **A7N-06**) | Cross-Tenant Arbitrary Ledger Void | `src/server/services/assetDisposalService.ts:171-173,184-188`, `assetTransferService.ts:124-126`, `placeInServiceService.ts:113-115` + `supabase/migrations/20261111000000`:349-359 | All 4 fixed-asset undo paths fetch `transactions/<txId>` and execute `t.update(txRef, { status: 'void' })` **without verifying `entry.workspaceId === input.workspaceId`** (nor `metadata.assetId`/`metadata.type`). Combined with `public.assets` allowing direct client UPDATE of `disposalTransactionId`, `partialDisposals`, `transfers`, and `placedInService` (`A7N-06`), a bookkeeper in Workspace A can point their asset at any transaction ID in Workspace B and void Workspace B's posted GL entry! | **Fix (Server + Migration + `rls.test.sql` + Test) in PR** |
| **A8-019** | Multi-Currency GL Corruption | `src/server/services/paymentVoidService.ts:129` | Missed sibling of `#654`: `voidPayment` constructs reversal lines via `{ ...l, amountCents: -(Number(l.amountCents) || 0) }` **without negating `l.baseAmountCents`**. `settleHomeCurrency` accepts the lines because `allBase === true` and `netHome === 0`, committing a reversal whose home-currency `baseAmountCents` has the **same sign as the original payment** — **DOUBLING** Cash and A/R in all financial statements (`lineAmount` prefers `baseAmountCents`) while marking the payment void and reopening the invoice! | **Fix + Test in PR** |
| **A8-024** (+ **A7N-04**) | Tax Filing / Multi-Currency | `src/lib/taxCodes.ts:265-267`, `src/lib/taxReturnDocs.ts:22-48,103`, `src/server/services/taxReturnService.ts`, `src/lib/taxRecompute.ts:74-75` | `computeTaxReturn`, `buildTaxReturn`, `taxByRate`, `fileTaxReturn`, and `findTaxDifferences` convert foreign-currency tax/net amounts with raw `cents * exchangeRate` instead of `minorUnitRate(rate, doc.currency, baseCurrency)`. In USD/EUR/GBP/ILS workspaces, JPY invoices file **100x too low** and KWD invoices file **10x too high** compared to the General Ledger! | **Fix + Test in PR** |
| **A8-016** (+ **A8-020**) | Multi-Currency Cash / Missing Undo | `src/server/services/depositService.ts:32-94`, `paymentVoidService.ts:74` | `createDeposit` (1) has no in-transaction role check, (2) has no in-transaction audit log, and (3) sums raw foreign-currency `p.amountCents` into workspace base currency at `exchangeRate: 1` (e.g., ¥10,000 JPY = $67 in Undeposited Funds is deposited as $100 in Bank Cash, driving Undeposited Funds -$33 negative). Also (`A8-020`) `voidPayment` tells users *"undo the deposit first"*, but no `undoDeposit` exists anywhere in the codebase. | **Fix `depositService` + Test in PR; document `A8-020` for AI #1** |
| **A8-017** | Backup Restore Integrity | `src/server/services/workspaceRestoreService.ts:31-76,186-194` | (1) Closed-period restore guard trusts `backupWorkspace.lockDate` from the user-uploaded JSON (bypassed by editing `"lockDate": "2099-12-31"` in the JSON file); (2) Restore replaces `transactions`/`invoices`/`bills`/`payments`/`stockMoves` without clearing derived tables (`paymentAllocations`, `allocationOperations`, `periodBalances`, `periodClosings`, `stockClosings`, `repostQueue`), leaving ghost allocations and stale period/stock snapshots after restore. | **Fix derived-table cleanup + Test in PR; note signed-backup design for AI #1** |
| **A8-013** | Bad Debt / Double Recovery | `src/server/services/badDebtService.ts:96,147-160` | `writeOffInvoice` tags its GL entry with `metadata.invoiceId` (unlike `prepaidService.ts`, which explicitly avoids `invoiceId` and uses `spreadOfInvoiceId`). Any subsequent edit to the written-off invoice triggers `postInvoiceLedger`, which auto-reverses EVERY live entry carrying `metadata.invoiceId` — silently reversing the bad-debt write-off in GL while `writtenOffCents > 0` and `allocationLedger` remain written off; calling `reverseWriteOff` then double-debits A/R and double-credits Bad Debt Expense. Also skips `date < invoice.date`, `date < original.date`, and already-reversed checks. | **Fix + Test in PR** |

### P1 — High-Severity Security, MFA, Accounting & Concurrency Defects (16)

| ID | Category | File(s) & Line(s) | Verified Defect | Planned Action |
|---|---|---|---|---|
| **A8-010** | MFA RLS Bypass | Live Postgres `pg_policies` across 13 tables | 13 tables created after `20260924220000_two_step_login.sql` lack `RESTRICTIVE` `two_step_login` (`private.lf_mfa_ok()`): `loans`, `purchaseOrders` (R/W/D), `taxReturns`, `paymentAllocations`, `allocationOperations`, `periodBalances`, `periodClosings`, `stockMoves`, `stockClosings`, `repostQueue`, `clientQueries`, `notifications`, `workspaceGroups`. `aal1` sessions bypass MFA on all 13 tables. | **Fix (Migration + `rls.test.sql`) in PR** |
| **A8-003** | Workspace Freeze / Deletion | `src/server/utils/commandExecutor.ts:255-285` | `runRegisteredCommand`/`previewCommand` skip workspace freeze (`concurrentUserLimit === 0`) and `status === 'pending_deletion'` guards enforced by `serverKit.authorizeWorkspace`. | **Fix + Test in PR** |
| **A8-004** | Forged Metadata / TOCTOU | `src/server/commands/ledger.ts:56-74`, `transactions/crudRoutes.ts`, `TransactionValidator.ts` | `journal.create` throws 500 on duplicate ID, checks accounts in `prepare` (TOCTOU); manual journal endpoints accept forged document metadata (`type: 'credit-note-issuance'`, `creditNoteId`, `invoiceId`) usable to satisfy `creditService.ts:62`. | **Fix `journal.create` + metadata guard + Test in PR** |
| **A8-001** | FX Revaluation Deadlock | `src/server/services/fxRevaluationService.ts:242,315,347` | Duplicate-date check counts reversed/void entries, while `undoRevaluation` creates a reversal without marking original void — permanently 409-blocking re-running revaluation for that date. | **Fix + Test in PR** |
| **A8-002** | Multi-Currency Display | `src/server/commands/periods.ts:103-108,116` | `period.yearclose` hardcodes `/ 100` when formatting net income for JPY (0-decimal) and KWD (3-decimal). | **Fix + Test in PR** |
| **A8-006** | Approval TOCTOU | `src/server/services/ledgerBulkCommit.ts:383` | Uses stale pre-transaction `wsData` when evaluating `serverApproval` instead of in-transaction `wsNow`. | **Fix + Test in PR** |
| **A8-011b** | Asset Transfer Undo | `src/server/services/assetTransferService.ts:115-128`, `depreciationService.ts:66` | `undoTransfer` allows undoing an account transfer after post-transfer depreciation was posted, stranding accumulated depreciation in the wrong account; `depreciationService` accepts archived/wrong-role custom asset accounts. | **Fix + Test in PR** |
| **A8-014** | Payroll Approval Period Lock | `src/server/services/payRunService.ts:163-173` | `postPayRun` skips `postingLock` check when `payrollApproval` or `twoPersonOn` saves a run as `awaiting_approval`, locking employee time entries into a closed-period run. (Also note `public.employees` permits direct bookkeeper writes in `security-baseline.json`.) | **Fix + Test in PR** |
| **A8-021** | Serializable Isolation | `src/server/services/stockClosingService.ts:71-73` | `writeStockClosing` reads `transactions`, `chartAccounts`, `inventory` via `db` outside its serializable transaction `t` (snapshot violation + pool exhaustion risk). | **Fix + Test in PR** |
| **A8-022** | Currency & Lock TOCTOU | `src/server/routes/revenueRoutes.ts:53,62`, `leaseRoutes.ts:54,63` | Hardcode `currency: 'USD'` instead of workspace currency; check `assertPeriodOpen` outside the commit transaction. | **Fix + Test in PR** |
| **A8-023** | Public Invoice Link | `src/server/routes/publicInvoiceRoutes.ts:62-84,116` | `payableStatuses` omits `'partially_paid'` (customers cannot pay remaining balance online!); `GET /:token` exposes `draft`/`void` invoices instead of returning 404. | **Fix + Test in PR** |
| **A7N-02** | Prior Agent #7 Still Live | `src/server/services/creditService.ts:397-449` | `refundCredit` drops refund-date FX gain/loss + missing in-transaction audit log. | **Track for follow-up / AI #1** |
| **A7N-03a/b** | Prior Agent #7 Still Live | `src/server/routes/transactions/{bulkRoutes:127-168,reconcileRoutes:159-192,276-310}.ts` | `/batch` & `/reconcile` skip posted guards; `PATCH /bank-lines/:id` skips `assertPostingOpen`. | **Track for follow-up / AI #1** |
| **A7N-05** | Prior Agent #7 Still Live | `src/server/services/fxRevaluationService.ts:118,214-219` | Drops `row.apAccountId` on bills; ignores `asOf` cutoff on settled items. | **Fix `apAccountId` with `A8-001` in PR** |
| **A7N-07a/b/c** | Prior Agent #7 Still Live | `src/server/reports/computeReports.ts:175,248-259,362-415` | `computeStatement` sums raw multi-currency lines; `computeTrialBalance` drops lines for missing accounts; `computeCashFlow` misclassifies asset disposal gain/loss as Operating. | **Track for follow-up / AI #1** |
| **A7N-09** | Prior Agent #7 Still Live | `src/server/services/payrollImportService.ts:105-115` | Missing in-transaction membership/role re-check. | **Track for follow-up / AI #1** |

### P2 — Medium-Severity Hardening & Correctness Defects (6)

| ID | Category | File(s) & Line(s) | Verified Defect | Planned Action |
|---|---|---|---|---|
| **A8-011** | Auth Status / RLS Hygiene | `security-baseline.json`, `developerApiRoutes.ts:147`, `pg_policies` (`auditLogs`, `supportTickets`) | 24 of 28 `serverErrors` return HTTP 500 instead of 403 on unauthorized/read-only calls; `auditLogs` allows direct bookkeeper INSERT; `supportTickets` `ticket_update` allows any `viewer` to overwrite other members' tickets. | **Document for AI #6 / AI #1** |
| **A8-025** | Cross-Workspace Refs | `src/server/commands/autoRules.ts:22-41` | `autorule.create`/`update` skip workspace ownership validation on `targetAccountId`, `bankAccountId`, `contactId`, `targetNodeId`. | **Document for AI #1** |
| **A8-026** | Multi-Reg Tax Preview | `src/server/routes/taxRoutes.ts:39` | `GET /preview` omits `registration` query parameter supported by `POST /`. | **Document for AI #1** |
| **A8-027** | Minor-Unit Notification | `src/server/services/onlinePaymentService.ts:154` | Hardcodes `/ 100` in Stripe overpayment refund-review notification. | **Fix with Pack B** |
| **A7N-08** | Stale API Response | `src/server/routes/transactions/crudRoutes.ts:440` | Returns stale input object instead of updated document. | **Document for AI #1** |
| **A8-028** | CoA Browser Integrity | Live Postgres `public.chartAccounts` | Allows direct browser `UPDATE` changing account `type` or `DELETE` of non-system accounts referenced by posted `transactions`. | **Document for AI #1** |
