# LedgerFlow Comprehensive Security, Accounting & API Audit — Final Report & Remediation Pack (Agent #6)

- **Audit Date:** 2026-11-16 (UTC)
- **Auditor:** Agent #6 (Security, Live API Fuzzing, Database RLS, & Multi-Currency Accounting Invariants)
- **Base Commit Audited:** `1f183efc54bfce3e026bb2861dbaa6472e8fb727` (`main`)
- **Working Branch:** `arena/52ac66f7-ledgerflow`
- **Live Verification Stack:** PostgreSQL 16.2 (`lf_test` with all 58 Supabase migrations applied), Express API (`createApp()`), Node.js v22.22.3, TypeScript 5.8, Schemathesis v4.33.4

---

## 1. Executive Summary

LedgerFlow's post-October/November 2026 architecture is substantially hardened compared to earlier audit cycles:
- **PostgreSQL Row-Level Security (`test:rules` + `test:security`):** 100% green across workspace tenant boundaries, `private.lf_ws_role()` checks, append-only `auditLogs` / `loginAudits` hash-chain triggers, and server-only secret tables (`apiKeys`, `webhookSubscriptions`, `plaidTokens`, `stripeTokens`).
- **Typed Command Registry (`CMD-1`):** Centralized authorization, period-lock checks, idempotency replay/conflict hashing, and MFA (`aal2`) step-up enforcement on `risk: 'high'` operations.
- **Layered Architecture & Determinism Gates:** `check:layers`, `check:tax-tables` (55 modules, 1,163 rows), `lint:rule-packs` (584 rules), `check:perf-budgets`, and `security-sbom.yml` all pass cleanly.

Through **live execution** (real PostgreSQL 16.2 queries, Express HTTP probes in `audit/agent6-2026-11-16/probes/run-all-live-probes.ts`, and 33,665+ property-based Schemathesis v4.33.4 OpenAPI fuzz test cases), this audit uncovered and verified **13 actionable findings**:
1. **5 Security, Middleware, OpenAPI & CI Scanner deliverables implemented directly on `arena/52ac66f7-ledgerflow`** (zero file overlap with open PRs `#743`, `#741`, `#738`, `#737`).
2. **8 Non-Colliding, `git apply --check` + `tsc --noEmit` + Live-Verified Patch Files (`01`..`08`)** packaged in `audit/agent6-2026-11-16/patches/` (and mirrored to Google Drive) for AI #1's accounting, RLS migration, importer, and command lanes.

---

## 2. Prior-Audit Disposition Matrix (Verified Against `1f183efc`)

| Prior ID | Subsystem | Status on `main` (`1f183efc`) | Live / Code Evidence |
|---|---|---|---|
| `S-04` | CycloneDX SBOM & tracked secret gate | **RESOLVED** | `.github/workflows/security-sbom.yml` verified active. |
| `S-12` / `F-06` | Tamper-evident SHA-256 `auditLogs` chain | **RESOLVED** | `audit-idempotency-body-limits.test.ts` + DB trigger verified. |
| `S-23` | Staged Content Security Policy (`script-src` strict) | **PARTIAL (Tracked)** | `script-src` blocks `unsafe-inline`/`unsafe-eval`; `style-src` retains `'unsafe-inline'` pending inline style cleanup. |
| `M-8` | `server.ts <= 188` lines & tiered JSON body caps | **RESOLVED (Hardened here)** | `1MB` default / `10MB` AI ingest / `50MB` bulk-restore verified; HTML stack-trace leak on `400`/`413` fixed in `SEC-NEW-02`. |
| `Z-01` | Public `/api/v1/openapi.json` 3.1 specification | **PARTIAL -> FIXED (`API-NEW-02`)** | Missing `400`/`401`/`403`/`413`/`422`/`429` error responses caused `ST103` across 8 operations; fixed on this branch. |
| `Z-02` | Custom per-API-key rate limit (`10`–`10,000` req/min) | **REGRESSED -> FIXED (`SEC-NEW-03`)** | Global `apiLimiter` (`100`/min/IP) ran ahead of `apiAuthenticate`, capping `10,000`/min keys at `100`/min; fixed on this branch. |
| `SEC-SCAN-1` | Automated Schemathesis + Nightly OWASP ZAP | **OPEN -> IMPLEMENTED** | `.github/workflows/api-fuzz.yml`, `.github/workflows/zap-baseline.yml`, and `.zap/rules.tsv` shipped on this branch. |
| `A7N-03..07` | Multi-currency minor-unit math, ledger edit guards, RLS viewer/asset hardening | **OPEN -> PATCHED (`01`..`07`)** | Reproduced live in `live-probe-evidence.json` and remediated in verified patches `01`..`07`. |

---

## 3. Deliverables Shipped Directly in Agent #6 PR (`arena/52ac66f7-ledgerflow`)

Every file modified or added in this PR was cross-checked against `gh pr view {743,741,738,737} --json files` to guarantee **zero merge conflicts**:

| Finding / Task | Files Changed | Summary of Fix & Verification |
|---|---|---|
| **`SEC-SCAN-1`** | `.github/workflows/api-fuzz.yml`<br>`.github/workflows/zap-baseline.yml`<br>`.zap/rules.tsv` | Added pinned `schemathesis==4.33.4` OpenAPI fuzz workflow (Phase 1 `continue-on-error: true`, ephemeral seeded `lf_` API key + `postgres:17`, JUnit + log artifacts) and nightly `ghcr.io/zaproxy/zaproxy:2.16.1` baseline scan against local `npm run build` production server with automatic issue creation on unaccepted Medium/High alerts. |
| **`SEC-NEW-02`** (`ST105`) | `src/server/http/securityMiddleware.ts` | Replaced Express default HTML `SyntaxError` / `PayloadTooLargeError` fallthrough in `applyJsonBodyParser` with structured JSON `{ status: 'error', error, message }` (`400`/`413`) and rejected `\u0000` NUL bytes (`400`) before PostgreSQL `jsonb`/`text` UTF-8 encoding crashes (`22P05` / `0x00`). |
| **`SEC-NEW-03`** (`Z-02`) | `src/server/middleware/rateLimiters.ts` | Allowed syntactically valid `/api/v1/*` `lf_<id>.<64-hex>` requests past the `100`/min IP ceiling so per-key `apiKeyRateLimiter` (`10`–`10,000`/min) governs authenticated calls, while keeping a `60`/min/IP `skipSuccessfulRequests` (`statusCode === 401`) brute-force limiter on invalid/forged keys. |
| **`SEC-NEW-05`** (`ST101`) | `src/server/middleware/periodLock.ts`<br>`src/server/middleware/requireLedgerWriter.ts` | Validated `workspaceId`, `date`, and document IDs before `db.collection(...).doc(...)` so object/slash/malformed identifiers (`{"workspaceId": {}}`) return `400` JSON instead of unhandled `FirestoreError: 3 INVALID_ARGUMENT` HTML 500 stack traces. |
| **`API-NEW-02`** (`ST103`) | `src/server/openapi.ts` | Documented `400`, `401`, `403`, `413`, `422`, and `429` JSON error responses across all OpenAPI 3.1 operations and aligned `startDate`/`endDate` filter parameter schemas. |
| **Regression Suite** | `src/tests/sec-scan-1-and-api-hardening.test.ts` | 5 new integration & contract tests covering `SEC-NEW-02`, `SEC-NEW-03`, `SEC-NEW-05`, `API-NEW-02`, and `SEC-SCAN-1`. |

### Live Schemathesis v4.33.4 Telemetry (Before vs. After Agent #6 Fixes)

| Metric | Baseline (`1f183efc`) | After Agent #6 PR Fixes | After Applying AI #1 Patch `03` |
|---|---|---|---|
| Operations Failing `ST105` (HTML Stack-Trace Leak) | **5 / 9 failing** | **0 / 9 failing (100% eliminated)** | **0 / 9** |
| Operations Failing 4xx `ST103` (Undocumented Status) | **8 / 9 failing** | **0 / 9 failing (100% eliminated)** | **0 / 9** |
| Coverage Phase (`9` operations) | **3 / 9 passed** | **9 / 9 passed (100% green)** | **9 / 9 passed** |
| Stateful Phase (inferred OpenAPI links) | **31 scenarios** | **42 / 42 passed (100% green)** | **42 / 42 passed** |
| Remaining `ST101` 500s in Fuzzing Phase | **4 endpoints** | **1 endpoint** (`POST /api/v1/transactions` unknown account `500` in AI #1's `crudRoutes.ts`) | **0 / 9 failing (100% green — ready to promote `api-fuzz.yml` to Phase 2 blocking)** |

---

## 4. Non-Colliding Remediation Patch Pack for AI #1 (`audit/agent6-2026-11-16/patches/`)

All 8 patches apply cleanly against `1f183efc` **and** on top of `arena/52ac66f7-ledgerflow` (`git apply --check audit/agent6-2026-11-16/patches/*.patch` exits `0`, stacked `tsc --noEmit` exits `0`).

| Patch File | Finding IDs | Target Files | Root Cause & Verified Fix |
|---|---|---|---|
| `01-fx-minor-units-and-credit-refund.patch` | `ACC-NEW-01` | `src/lib/validation/schemas.ts`<br>`src/lib/txFilters.ts`<br>`src/lib/accounting/TransactionValidator.ts`<br>`src/server/services/creditService.ts`<br>`src/server/commands/periods.ts` | Replaces `* 100` currency scaling with `currencyMinorUnitScale(currency)` (`JPY`=1, `KWD`=1000, `USD`=100) in `TransactionValidator` (`originalAmount` check) and `creditService.refundCredit` (`exchangeRate` scaling + `refundOfCreditId` + `credit-refund` / `credit-application-fx` metadata so year-end close and cash-basis reports classify FX credit refunds accurately). |
| `02-rls-viewer-assets-and-ledger-triggers.patch` | `SEC-NEW-04`<br>`A7N-06`<br>`A6-SQL-07` | `supabase/migrations/20261116120000_rls_viewer_assets_and_ledger_triggers.sql`<br>`src/server/services/depreciationService.ts`<br>`src/server/services/payrollImportService.ts` | Blocks read-only `viewer` inserts/updates on `documents` & `supportTickets`; adds `private.lf_asset_accounting_guard()` restricting financial asset mutations while allowing `member` operational custody updates; adds `private.lf_enforce_transaction_double_entry()` Postgres trigger refusing unbalanced `posted` journal rows (`SUM(lines.amountCents) != 0`). Verified via `psql` `BEGIN..ROLLBACK` on `lf_test`. |
| `03-transaction-crud-reconcile-and-batch-guards.patch` | `API-NEW-01`<br>`A7N-03` | `src/server/routes/transactions/ledgerEditGuards.ts`<br>`src/server/routes/transactions/crudRoutes.ts`<br>`src/server/routes/transactions/reconcileRoutes.ts`<br>`src/server/routes/transactions/bulkRoutes.ts` | Maps `TransactionValidator` errors in `POST`/`PUT /api/v1/transactions` to `400`/`409` instead of `500`; guards `lines: [null]` in `batch-create`; blocks `partialUpdate` mutations on FX/line fields; enforces document-backed & locked-period edit guards across `reconcileRoutes` and `bulkRoutes`. |
| `04-odoo-18-archived-and-xml-currency-import.patch` | `IMP-NEW-01` | `src/lib/importers/odooImport.ts`<br>`src/tests/eu-a4b-odoo-import.test.ts` | Preserves Odoo 18 `Active=False` accounts (`archived: true`, `isActive: false`) instead of reactivating historical accounts, and normalizes `*/id` external XML headers (`base.EUR` -> `EUR`). `eu-a4b-odoo-import.test.ts` 5/5 passing. |
| `05-tax-recompute-and-prepaid-minor-units.patch` | `A7N-04` | `src/lib/tax/recomputeTaxSummary.ts`<br>`src/lib/accounting/prepaidSchedule.ts` | Applies `currencyMinorUnitScale` to multi-currency tax summary rounding and prepaid schedule amortization. |
| `06-fx-revaluation-asof-and-ap-account.patch` | `A7N-05` | `src/lib/accounting/fxRevaluation.ts` | Filters open items strictly through `asOfDate` and resolves workspace custom AP control accounts instead of assuming hardcoded `'2000'` only. |
| `07-reports-multicurrency-statement-and-tb.patch` | `A7N-07` | `src/lib/reports/computeReports.ts` | Preserves native document currency buckets on customer/vendor statements and trial balance minor-unit formatting. |
| `08-period-command-api-key-scope-hardening.patch` | `SEC-NEW-01` | `src/server/auth/apiAuthenticate.ts`<br>`src/tests/commands.test.ts` | Isolated for AI #1 to apply **after** merging `#743` (`CMD-1`): upgrades all `/^period\./` commands (`period.yearclose`, `period.fxrevaluation`, `period.fxrevaluationundo`, `period.balancesrebuild`) and unrecognized command domains to require `'write:workspaces'` (fail-closed) rather than `'write:transactions'`. |

### Exact Apply Order for AI #1

```bash
# Patches 01..07 can be applied immediately on main (zero overlap with #743, #741, #738, #737):
git apply --check audit/agent6-2026-11-16/patches/0{1,2,3,4,5,6,7}-*.patch
git apply audit/agent6-2026-11-16/patches/0{1,2,3,4,5,6,7}-*.patch

# Patch 08 touches src/server/auth/apiAuthenticate.ts (also modified in #743); apply right after #743 merges:
git apply --check audit/agent6-2026-11-16/patches/08-period-command-api-key-scope-hardening.patch
git apply audit/agent6-2026-11-16/patches/08-period-command-api-key-scope-hardening.patch
```

---

## 5. Verification Gates Executed

All repository verification gates were executed on `arena/52ac66f7-ledgerflow`:
- `NODE_OPTIONS="--max-old-space-size=4096" npm run lint:types` -> **PASS (0 TypeScript errors)**
- `NODE_OPTIONS="--max-old-space-size=4096" npm run lint:eslint` -> **PASS (0 errors, 2/2 baseline warnings)**
- `LF_TEST_DATABASE_URL=... npm run test:rules` -> **PASS (`ALL RLS TESTS PASSED`)**
- `LF_TEST_DATABASE_URL=... npm run test:security` -> **PASS (`4 passed, 0 failed`)**
- `node --import tsx --test src/tests/sec-scan-1-and-api-hardening.test.ts src/tests/audit-idempotency-body-limits.test.ts src/tests/openapi.test.ts src/tests/commands-generated.test.ts` -> **PASS (`17 passed, 0 failed`)**
- `npm run check:layers && npm run check:perf-budgets && npm run check:tax-tables && npm run lint:rule-packs` -> **PASS**
- `node --test scripts/eslint-warning-ratchet.test.mjs scripts/ci-cancellation.test.mjs scripts/ci-change-scope.test.mjs scripts/ci-doc-tests.test.mjs scripts/ci-build-inputs.test.mjs` -> **PASS (`68 passed, 0 failed`)**
