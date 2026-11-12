# Ledgerflow — Final Launch-Readiness & Independent Audit Report (`2026-11-12`)

- **Author**: Agent #6 (Independent Accounting, Financial-Operations, Security & Launch-Readiness Audit)
- **Date**: `2026-11-12` (UTC)
- **Repository**: `shmuelbiller1/ledgerflow` (~3,671 tracked files)
- **Branch**: `arena/c3c0cb2e-ledgerflow` (based on `main` @ `c82bead475d9184248265e6f22229813b251a3b2`)

---

## Executive Launch-Readiness Verdict: **`NOT READY`** *(Upgrades to **`CONDITIONALLY READY`** immediately upon merging this PR + applying Verified Patches `01`–`07` and running live PostgreSQL `test:rules`)*

### Why `NOT READY` on `main` (`c82bead4`) Today
While Ledgerflow's core double-entry engine (`ledgerBulkCommit`, `paymentService`, `allocationLedger`, `creditService`, `periodCloseService`, `repostService`, PostgreSQL RLS across 75+ tables, and `4,858` passing automated tests) has matured substantially, our deep source audit uncovered **two P0 Critical multi-tenant takeover/corruption vulnerabilities** and **nine P1 High accounting, tax,FX, and audit-chain defects** that block external multi-tenant production launch until applied:

1. **P0 Critical — Full-Tenant Workspace Takeover (`AF6-001`, `workspaceApiRoutes.ts:58-104`)**: Any authenticated user or API key passing `"id": "<victimWorkspaceId>"` to `POST /api/v1/workspaces` overwrites the victim's `workspaces` row on the privileged Postgres pool (`ON CONFLICT DO UPDATE`), becoming sole owner of all victim tenant financial data, locking out legitimate members, and wiping `lockDate` and `requireTwoStep`. *(Turnkey fix in `Patch 01`.)*
2. **P0 Critical — Cross-Tenant Chart-of-Accounts Hijack & System Overwrite (`AF6-002`, `developerApiRoutes.ts:151-205`)**: `POST /api/v1/ledger` executes unchecked `.doc(id).set(...)` on `chartAccounts`, re-parenting another tenant's accounts into the caller's workspace and allowing `isSystem` control accounts to be overwritten. *(Turnkey fix in `Patch 01`.)*
3. **P0/P1 High — Foreign-Currency Manual Journal `exchangeRate²` Double-Conversion & `JPY`/`KWD` Scaling (`AF6-003` + `AF6-019`)**: Foreign manual journal entries multiplied home-currency amounts by `exchangeRate` **twice** across every financial statement (`€100 @ 1.65 → $272.25 AUD` instead of `$165.00 AUD`), broke `JPY`/`KWD` minor units, and failed to negate `baseAmountCents` on auto-reversing accruals (`withReversal`). *(**FIXED DIRECTLY IN THIS PR** + 4 new regression tests.)*
4. **P1 High — US Federal Payroll W-4 Step 2 Over-Withholding (`AF6-004`, `usFederalPayroll.ts`)**: All six 2025/2026 IRS Pub 15-T Step-2 tables halved Table 1(a) thresholds without adding half of the Step 1g deduction (`$4,300` Single/HOH, `$6,450` MFJ), over-withholding `$1,892/yr` on two equal `$52k` Single jobs. *(Turnkey fix + updated golden test in `Patch 02`.)*
5. **P1 High — 100× `JPY`/`KRW` & 10× `KWD` FX Revaluation Error (`AF6-005`, `fxRevaluation.ts:195-196`)**: Month-end unrealized FX revaluation omitted `convertMinorUnits` (`minorUnitRate`), understating `JPY` gains/losses by `100×`. *(Turnkey fix in `Patch 03`.)*
6. **P1 High — Broken Server Audit Hash-Chain Verifier (`AF6-006`, `auditLogService.ts:61-89`)**: `writeServerAuditLog` links `prevHash = prev.entryHash`, whereas `auditLogService.verifyAuditHashChain` checked `prevHash === prev.chainHash`, failing on every real multi-entry stream. *(Turnkey fix in `Patch 04`.)*
7. **P1 High — GL Delete / Batch / Reconcile / Statutory Copy-Mark / SQL Trigger Gaps (`AF6-007`..`AF6-011`)**: `DELETE /transactions/:id` hard-deletes posted/document-linked GL entries; `POST /transactions/batch` and `POST /transactions/reconcile` bypass revaluation/cleared/document locks and `ledgerDoor`; `viewer` PDF downloads permanently consume Israeli statutory original (`מקור`) stamps; SQL settlement triggers allow reverse transitions out of `'paid'`. *(Turnkey fixes in `Patches 05, 06, 07` + direct `#657` CI scanner fix in this PR.)*

---

## Path to `CONDITIONALLY READY` / `READY` (Ordered Action Checklist for Shmuel & AI #1)

1. **Merge this PR (`arena/c3c0cb2e-ledgerflow`)** — Lands direct fixes for `AF6-003` (`JournalEntryModal` + `DocumentLineEditor`), `AF6-019` (`autoReversal`), `AF6-016` (`#657` variable-held `txRef` `ledgerDoor` scanner + per-file baseline), `AF6-017` (`--max-warnings 2` + 9-class CI secret scanner), and `AF6-018` (`#618` CodeRabbit audit doc updates).
2. **Apply All 7 Pre-Verified Reserved-Lane Patches in One Command**:
   ```bash
   git apply audit/agent6-2026-11-12/patches/*.patch
   ```
   *(All 7 patches were verified together via `git apply --check` and `tsc --noEmit` with 0 errors.)*
3. **Execute Live PostgreSQL 17 Migration & RLS Suite (`S-32` / `S-37..S-40`)**:
   - Apply migrations through `20261112000000_close_ledger_and_settlement_trigger_gaps.sql` on disposable Postgres 17 and run `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls.test.sql` + the 6 `LF_TEST_DATABASE_URL`-gated integration suites.
4. **Production Cutover Preflight (`S-02` / `S-03`)**:
   - Run `NODE_ENV=production npm run check:prod-env` against production environment variables and execute one `scripts/restore-drill.mjs` backup/restore rehearsal on staging.

---

## Honest Audit Scope & Limitations Statement

- **Directly Inspected & Verified**: All server entrypoints, auth/JWT/API-key/2FA/CSRF/CSP/rate-limit/upload middlewares, DB adapters (`pgFirestore`, `firestore`), core schema & latest hardening migrations (`20260924190000`, `20261111000000`, `20261111120000`) + `rls.test.sql`, GL routes (`crud`, `bulk`, `reconcile`, `reverse`, `period`, `consolidation`), core posting/settlement services (`ledgerDoor`, `ledgerBulkCommit`, `documentPostService`, `paymentService`, `paymentVoidService`, `creditService`, `allocationLedger`, `periodCloseService`, `repostService`, `recurringService`, `copyMarkService`, `auditLogService`, `workspaceRestoreService`), FX/minor-unit math (`currencyMinorUnits`, `fxRevaluation`, `txFilters`), US federal payroll & pay-run posting (`usFederalPayroll`, `payRunPosting`, `payRunService`), manual journal UI (`JournalEntryModal`, `DocumentLineEditor`, `autoReversal`), and CI/security workflows.
- **Automated Verification Executed**: Full 4-shard suite (`4,858/4,864` pass, `0` fail) + new 2026-11-12 security/FX/probe suites (`13/13` pass), `tsc`, ESLint, layers, rule-packs, tax-table schemas, Vite/esbuild production builds, bundle budgets, and `npm audit`.
- **Environment Limitation Disclosed**: No live PostgreSQL server (`LF_TEST_DATABASE_URL`) is running inside this sandbox, so the 6 DB-gated Node suites and `supabase/tests/rls.test.sql` were audited statically at the SQL/PLpgSQL source level rather than executed against a live Postgres daemon in this session. Not every individual React view component among the ~3,671 files was read line-by-line where covered by existing shard/type/bundle checks and active sibling UI PRs (`#663, #667, #670, #671, #672`).
