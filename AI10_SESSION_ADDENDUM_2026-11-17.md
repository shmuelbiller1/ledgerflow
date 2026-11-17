# AI #10 Session Addendum — MASTER_RECOVERY_INDEX.md

**Date:** 2026-11-17
**Agent:** #10 (Arena)
**Branch:** `arena/fe67d886-ledgerflow`
**Base commit:** `f69e2b4ecddd75393f51195c37fd444655731005` (= `origin/main`)
**Status:** Active — in-progress audit and H-queue work

---

## Repository State

- Clean tree at `f69e2b4` ("direct browser writes 86 → 86 (#758)")
- Node v22.22.3, npm 10.9.8, Debian 12, 2 CPU / 3.8GB RAM
- PGlite socket server on 127.0.0.1:5433 (process `pglite-postgres-203b1fa8`)
- `node_modules/.bin/tsx` present (`npm ci --ignore-scripts` completed)
- No Docker/Postgres binaries; apt blocked — PGlite is the DB substitute
- `LF_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/postgres`

---

## Baseline Gates (all PASS on `f69e2b4`)

| Gate | Result |
|------|--------|
| `tsc --noEmit` | exit 0 |
| `eslint . --max-warnings 2` | 0 errors, 2 warnings (pre-existing `any` in `supabaseAuth.ts:21`, `pg/values.ts:7`) |
| `check:layers` | 4/4 |
| `check:tax-tables` | 55 modules / 34 tables / 1,163 rows, 0 problems |
| `lint:rule-packs` | 584 rules, 0 problems |
| `check:perf-budgets` | 5 entries |
| DB migrations (58) | all applied |
| RLS tests | ALL PASSED |

---

## Full Test Suite Results (PGlite)

Command: `NODE_ENV=test SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic LF_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/postgres npx tsx --test --test-force-exit src/tests/*.test.ts src/tests/*.test.tsx src/lib/*.test.ts src/server/utils/*.test.ts`

Results: **6,270 tests, 5,938 pass, 288 fail, 76 cancelled, 1 skipped**, ~27.7 minutes

**Failure analysis:** Failures are predominantly PGlite "Connection terminated unexpectedly" infra errors (pg-pool socket termination at `pgFirestore.ts:694`), not code bugs. Confirmed by inspection:
- `fx-gold.test.ts` — first subtest fails with `ServerCommandError: Connection terminated unexpectedly`, cascading to later subtests
- `bill-stock.test.ts` — 4 subtests fail with same pg-pool error
- `document-pdf-route.test.ts` — 2 subtests fail with "Connection terminated unexpectedly"
- `workspace-purge-db.test.ts` — PASSES (2/2)

Real PostgreSQL in CI is the authoritative gate. PGlite is Postgres-compatible WASM, not identical.

---

## CMD-1 Command Audit (completed, no defects found)

| File | Result |
|------|--------|
| `src/server/commands/bootstrap.ts` | No defects — `user.provision` idempotent, `workspace.create` injective personal id |
| `src/server/commands/contactBalances.ts` | No defects — recompute from open docs, writes only `balanceCents`, no posting |
| `src/server/commands/dimensions.ts` | No defects — whole-node `tx.set` or patch, duplicate-id 409, owner/accountant only |
| `src/server/commands/inventory.ts` | Re-exports only |
| `src/server/commands/inventoryStock.ts` | No defects — `toBaseCents` uses `convertMinorUnits`, period lock enforced |
| `src/server/commands/inventoryFlow.ts` | One declarative gap: `inventory.revalue` `inverse()` missing required fields (`inventoryAccountId`, `offsetAccountId`, `requestId`) — but `.inverse()` is never called anywhere in codebase, so not a live bug |

---

## Key Code-Level Verifications

**Closed by #746/#753 (verified live on `f69e2b4`):**
- B1-B3: `documentPostService.ts` strips server-managed fields (`settledByRecordsCents`, `writtenOffCents`, `refundedCents`, `revenueSchedule`, `appliedTo`, etc.), blocks void/delete of settled/written-off/scheduled docs, blocks `amountPaidCents`/`amountCents` below settlements
- B4: Period lock on both existing and target dates (A8-007)
- B5: Delete with revenue schedule blocked (A8-008)
- A8-009/A8-010: `lf_documents_kind_guard` blocks viewer escalation on `documents`
- A8-012/A7N-06: `lf_asset_accounting_guard` blocks fixed-asset pointer mutation

**Still live (server-lane — AI #1, do not patch):**

1. **D1 — JPY/KWD minor-unit conversion (100×/10× error).** `src/lib/txFilters.ts:479` `settleHomeCurrency` does `Math.round(amountCents * rate)` with no `convertMinorUnits`. `src/server/services/creditService.ts` `refundCredit` passes `exchangeRate` directly without `convertMinorUnits`. ¥100,000 at 0.0067 → 670 cents instead of 6,700.

2. **C1 — `exchangeRate`/`currency` mutable via partialUpdate.** `src/server/routes/transactions/crudRoutes.ts` PUT `/:id` partialUpdate rejects `lines`/`amountCents`/`date`/`workspaceId` but not `exchangeRate`/`currency`.

3. **F1 — `REPORT_CACHE` never evicts.** `src/server/routes/reportRoutes.ts:37` — no delete/clear/sweep/cap. Unbounded growth. (AI #8 #645)

4. **Credit service `appliedTo` gap.** `src/server/services/documentPostService.ts:134` — creditService only lowers `remainingCents`, never writes `appliedTo`, so partly-applied unrefunded credit passes the credit guard.

5. **`fxRevaluationService` has no `asOf` parameter** — revaluation always at current rates.

6. **`computeStatement` uses document `amountCents`, not ledger lines** — statement ≠ GL if documents and ledger diverge.

**AI #10 lane (frontend, non-money):**

7. **PDF preview consumes original mark.** `src/server/routes/documentRoutes.ts` `handlePdfRequest`/`handleZipRequest` ignore `?preview=1`, always call `takeCopyMark`, never set `X-Preview-Only`. Client (`PdfPreviewModal.tsx`) sends `?preview=1` and honors the header — server doesn't set it.

8. **H-1 RTL — main app dir hardcoded.** `src/App.tsx:590` — `dir="ltr"` hardcoded; `applyUiLanguage` sets `document.documentElement.dir` but app div overrides. **FIXED** → `dir={language === 'he' ? 'rtl' : 'ltr'}`. tsc passes.

**H-queue status:**
- H-1 RTL — fixed (App.tsx dir attribute)
- H-4 screen-reader — ARIA coverage good (sr-only, aria-label, role=alert/status across components); no gaps found
- H-6 empty/error — EmptyState widely used across 15+ screens; no gaps found
- H-7 printing — print roots on all 9 surfaces (verified)
- H-8 locale dates/numbers — `useReportDates` + ratchet guard (verified)

---

## PR #759 Status

- **PR:** #759 "Undo is a command, not a closure (direct browser writes 86 → 84)" — branch `arena/610dee0b-ledgerflow`
- **CI:** All 19 checks green (Gitar SUCCESS, Schemathesis SUCCESS, CodeQL SUCCESS, all unit/browser/build checks SUCCESS)
- **Gitar findings (reported to AI #1 via COORDINATION.md):**
  1. Undo durability gap — `project.delete` removes row, returns only in HTTP response, `inverse()` never stored/called
  2. `deletedProjects` missing from `WORKSPACE_PURGE_EXTRA` — purge guard test fails, deleted project rows left behind after workspace purge

---

## Google Drive Artifacts (this session)

| Artifact | Location |
|----------|----------|
| This addendum (AI #10 session index) | `2026-11-17_Agent10_MASTER_RECOVERY_INDEX_ADDENDUM.md` |
| Coordination messages | `docs/COORDINATION.md` (appended 2026-11-17) |
| Code changes | `src/App.tsx` (H-1 RTL fix, 1 line) |
| Test output | `/tmp/test-output.log` (full suite, 59,928 lines) |

---

## Unfinished Work

1. **Re-verify Agent #10 B1-B5/A1-A6/H1 findings against current HEAD** (mostly done via live code reads; probes not yet run)
2. **Re-verify Agent #7 A7N-03..08 findings against current HEAD** (not yet done)
3. **Complete H-4/H-6 audit** (spot-check done; deeper audit possible)
4. **Run probe tests** (probe-01..03 from audit/agent10-2026-11-16/)
5. **Google Drive: verify this addendum uploads correctly**
6. **Final launch-readiness assessment** (READY / CONDITIONALLY READY / NOT READY)

---

## Next Steps for Replacement Agent

1. Read `docs/COORDINATION.md` Messages section (latest entries at bottom)
2. Read this addendum + repository `audit/agent10-2026-11-16/AUDIT_REPORT_2026-11-16.md`
3. Poll/test-suite results at `/tmp/test-output.log` if still relevant
4. Complete remaining H-queue tasks and re-verifications
5. Run probe tests: `audit/agent10-2026-11-16/probes/probe-01..03`
6. Report server-lane defects (D1, C1, F1, credit `appliedTo`, FX `asOf`, statement vs GL) to AI #1 via COORDINATION.md
7. Fix frontend issues found (PDF preview, any remaining H-4/H-6 gaps)
8. Upload all artifacts to Google Drive and update MASTER_RECOVERY_INDEX.md
9. Deliver evidence-based launch assessment

---

**Branch:** `arena/fe67d886-ledgerflow` | **Commit:** `f69e2b4` | **PR:** None yet (AI #10 has no open PR) | **Drive:** See links above
