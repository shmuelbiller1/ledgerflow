# Agent #6 — Checkpoint 02: Live Audit Findings, Schemathesis Fuzzing & PostgreSQL Proofs

- **Date (UTC):** `2026-11-16`
- **Branch:** `arena/52ac66f7-ledgerflow` (base `main` @ `1f183efc54bfce3e026bb2861dbaa6472e8fb727`)
- **Live PostgreSQL Evidence:** `audit/agent6-2026-11-16/probes/run-all-live-probes.ts` -> `audit/agent6-2026-11-16/probes/live-probe-evidence.json`
- **Live OpenAPI Fuzzing:** Schemathesis `v4.33.4` (`17,417` authenticated + unauthenticated requests across all 12 OpenAPI 3.1 operations)

---

## 1. Executive Summary of Newly Discovered Live Defects on `main` (`1f183efc`)

| ID | Severity | Lane | Module(s) | Summary & Live-Reproduced Impact |
|---|---|---|---|---|
| **ACC-NEW-01** | **CRITICAL** | AI #1 (Patch `01`) | `src/schemas.ts:19`, `src/lib/txFilters.ts:88-135,410-415`, `src/server/services/creditService.ts:421-445`, `src/server/commands/periods.ts:106,116` | **Two-layer FX & ISO-4217 minor-unit corruption across `TransactionValidator`, `refundCredit`, and foreign journals:** (1) `TransactionLineSchema.exchangeRate` has `.default(1)` (`src/schemas.ts:19`), so `TransactionSchema.parse` stamps `exchangeRate: 1` onto every line that omits a per-line rate; `settleHomeCurrency` (`txFilters.ts:122`) and `lineAmount` (`txFilters.ts:93`) evaluate `l.exchangeRate ?? t.exchangeRate ?? 1` -> `1`, **completely ignoring `tx.exchangeRate`** on `refundCredit` and foreign journal entries (`EUR`, `GBP`, `JPY`, `KWD`, etc.). (2) Even when `l.exchangeRate` is supplied, `settleHomeCurrency`, `lineAmount`, and `baseAbsoluteTotal` multiply `Math.round(raw * rate)` without `convertMinorUnits`, misstating `JPY` (0 decimals) by **100x** and `KWD` (3 decimals) by **10x**. Live proof: refunding `¥100,000` JPY (`$670.00`) and `KWD 100.000` (`$325.00`) marks both credits `applied` (`remainingCents = 0`) while booking `+$1,000.00` each (`100,000` USD cents at `rate = 1`), stranding **`+$1,005.00` (`100,500c`) phantom A/R** on the Balance Sheet with **0 `auditLogs` rows**. Also `period.yearclose` (`periods.ts:106,116`) hardcodes `/ 100` for `JPY`/`KWD` net income descriptions. |
| **SEC-NEW-01** | **HIGH** | AI #6 (Fixed in PR) | `src/server/auth/apiAuthenticate.ts:20-35` | **API-key scope privilege escalation on `period.*` commands:** `requiredApiKeyScope` enumerates `/^period\.(close\|closesteps\|depreciation\|relock\|reopen\|signoff\|unlock)$/` instead of `/^period\./`, letting an integration API key scoped **only** to `write:transactions` (without MFA `aal2` and without `write:workspaces`) execute `period.yearclose` (`lockPeriod: true`, setting `workspaces.lockDate`), `period.fxrevaluation`, `period.fxrevaluationundo`, and `period.balancesrebuild`. Additionally, `POST /api/v1/commands/:name/preview` (a zero-write dry run) is classified as `isWrite = true` instead of read-scoped, and unknown command domains fail open to `'write:transactions'`. |
| **SEC-NEW-02** | **HIGH / MED** | AI #6 (Fixed in PR) | `src/server/http/securityMiddleware.ts:95-113` | **Express HTML stack-trace & filesystem-path leak (`ST105`):** `applyJsonBodyParser` passes `body-parser` `SyntaxError` / `PayloadTooLargeError` to `next(err)` with no JSON error middleware registered, returning `400 text/html` containing `SyntaxError ... at createStrictSyntaxError (/home/user/ledgerflow/node_modules/body-parser/lib/types/json.js:139:10)` on any `/api/*` request with invalid or primitive JSON (`"AAA"`, `{`). |
| **SEC-NEW-03** | **MEDIUM** | AI #6 (Fixed in PR) | `src/server/middleware/rateLimiters.ts:88-126` | **`Z-02` per-API-key rate limits (`10`–`10,000`/min) overridden by global IP limiters:** `limiter` (`1,000`/15m/IP) and `apiLimiter` (`100`/min/IP) run on `/api/` and `/api/v1/` before `apiAuthenticate` -> `apiKeyRateLimiter` without skipping `lf_` API-key requests, throttling an API key configured at `rateLimitPerMinute: 5000` with `429` at ~100 req/min. |
| **SEC-NEW-04** | **HIGH** | AI #1 (Patch `02`) | `supabase/migrations/20260924190000_init.sql:476,505`, `20261111000000_ledger_integrity_and_rls_hardening.sql:392` | **Direct PostgREST RLS write surfaces for read-only `viewer` role:** `public.documents` (`own_insert` / `own_update`) and `public."supportTickets"` (`ticket_update`) check `lf_is_member(workspace_id)` rather than `lf_can_write(workspace_id)` / ticket ownership, allowing a read-only `viewer` to insert/update billable time entries (`hours`, `rateCents`, `paidRunId`, `status`) in `public.documents` and close/mutate any member's support ticket. |
| **API-NEW-01** | **HIGH** | AI #1 (Patch `03`) | `src/server/routes/transactions/crudRoutes.ts:148-156, 224-236` | **`ST101` HTTP `500` crashes on `POST /api/v1/transactions` & `POST /api/v1/transactions/batch-create`:** (1) `POST /api/v1/transactions` catches plain `Error` throws from `TransactionValidator.validateAndPrepare` (unknown account, unbalanced lines, closed period) with `err.status \|\| 500` -> `500 Internal Server Error` (violating `openapi.ts:107` which documents `400`/`409`). (2) `POST /api/v1/transactions/batch-create` calls `getAbsoluteTotal(entry)` before `TransactionSchema.safeParse(entry)`, crashing with `TypeError: Cannot read properties of null (reading 'amountCents')` (`500`) on `lines: [null]`. |
| **API-NEW-02** | **LOW / MED** | AI #6 (Fixed in PR) | `src/server/openapi.ts` | **OpenAPI 3.1 response conformance gaps (`ST103`):** `openapi.ts` omits `400`, `401`, `403`, `404`, `422`, and `429` response definitions across `/api/v1/*` operations and uses `format: 'date'` where server routes accept arbitrary strings without strict calendar validation, failing automated Schemathesis `status_code_conformance` and `negative_data_rejection` checks. |
| **IMP-NEW-01** | **MEDIUM** | AI #1 (Patch `04`) | `src/lib/odooImport.ts:68-77`, `src/lib/recordImport.ts:307` | **Odoo `#739` (`EU-A4b`) import defects:** (1) Odoo 18 replaced `account.account.deprecated` with `active`; `normalizeOdooCsv` ignores `Active = False` on accounts, resurrecting archived Odoo 18 accounts as active. (2) Import-compatible Odoo exports use `currency_id/id` (`uom_id/id`, `categ_id/id`, `state_id/id`, `country_id/id`) and XML external IDs (`base.EUR`), silently dropping `currency_id/id` (`null`) or failing with `"base.EUR" is not a 3-letter currency code`. |

---

## 2. Live Re-Verification of Prior Agent #6 / Agent #7 Findings on `1f183efc`

| Prior ID | Status on `1f183efc` | Verification Evidence |
|---|---|---|
| `ACC-01` (`#654` line-rounding vs `totalAmountCents`) | **FIXED** (`4b5f7bb` / `#711`) | `TransactionValidator.ts:129` recomputes `totalAmountCents = getAbsoluteTotal(validatedTx)`. |
| `ACC-02` (`#646` foreign credit application FX difference) | **FIXED** (`7f10ca3` / `#712`) | `creditService.ts` records `credit-application-fx` on `applyCredit` (while `refundCredit` remains broken via `ACC-NEW-01`). |
| `ACC-03` (`#653` foreign bill vendor payment FX gain/loss) | **FIXED** (`4cfb57f` / `#713`) | `payments.ts` posts realized FX gain/loss on multi-currency vendor bill payments. |
| `SEC-01` (Direct client mutation of `invoices`/`bills`/`payments`/`creditNotes`/`vendorCredits`) | **FIXED** (`fa70227` / `#719`) | `20261115000000_document_commands_server_only.sql` revokes `authenticated` writes on all 5 document tables. |
| `A7N-03` (`reconcile` / `batch` / `partialUpdate` bypasses) | **STILL LIVE** | Reproduced live: `PUT /api/v1/transactions/:id` with `{ partialUpdate: { exchangeRate: 999 } }` returns `200` and mutates `exchangeRate` to `999` while `totalAmountCents` stays `11000`; `reconcileRoutes` & `bulkRoutes` still lack `postedStatusRefusal`/`documentEntryRefusal` on status/system-entry mutations. Consolidated into AI #1 Patch `03`. |
| `A7N-04` (`taxRecompute` / `taxCodes` JPY 100x & KWD 10x) | **STILL LIVE** | `taxRecompute.ts:78` and `taxCodes.ts:238` still multiply raw `rate` without `convertMinorUnits`. Consolidated into AI #1 Patch `05`. |
| `A7N-05` (`fxRevaluationService` ignores `asOf` cutoff & drops `bill.apAccountId`) | **STILL LIVE** | `fxRevaluationService.ts:121,196` unchanged on `main`. Consolidated into AI #1 Patch `06`. |
| `A7N-06` (`assets` RLS bookkeeper depreciation reset & payroll role check) | **STILL LIVE** | Reproduced live: `bookkeeperResetAssetDepr: true` under `ROLE authenticated`. Consolidated into AI #1 Patch `02`. |
| `A7N-07` (`computeStatement` sums raw multi-currency cents; TB/CashFlow gaps) | **STILL LIVE** | `computeReports.ts:384-455` unchanged on `main`. Consolidated into AI #1 Patch `07`. |
| `A6-SQL-07` (`lf_enforce_transaction_integrity` DB triggers) | **STILL LIVE** | `public.transactions` still relies solely on `lf_guard` key allowlist without double-entry/home-currency DB trigger enforcement. Consolidated into AI #1 Patch `02`. |

---

## 3. Lane-Safe Delivery Plan (Step 3)

1. **Direct Implementation in Agent #6's PR (Security / Scanner / OpenAPI / Middleware Lane — Zero Collision with `#743`, `#741`, `#738`, `#737`):**
   - `SEC-SCAN-1` deliverables:
     - `.github/workflows/api-fuzz.yml` (Schemathesis `v4.33.4` OpenAPI fuzz workflow against live PostgreSQL 16 + Express, uploading JUnit XML artifact).
     - `.github/workflows/zap-baseline.yml` (OWASP ZAP Baseline DAST workflow against built production preview + `.zap/rules.tsv`).
     - `.zap/rules.tsv` (explicitly documented rule config with zero blanket `IGNORE`s on real security headers).
   - Non-colliding Security & API conformance fixes:
     - `src/server/auth/apiAuthenticate.ts`: tighten `/^period\./` to `'write:workspaces'`, fail closed to `'write:workspaces'` on unrecognized command namespaces instead of `'write:transactions'`, and treat `POST /commands/:name/preview` as read-scoped (`read:customers`, `read:vendors`, `read:transactions`, `read:workspaces`, `read:rules` -> `read:transactions`) so dry-run previews never require write scope while period/workspace commands remain protected.
     - `src/server/http/securityMiddleware.ts`: return structured `application/json` (`400` / `413`) from `applyJsonBodyParser` on `SyntaxError` / `PayloadTooLargeError` instead of falling through to Express's HTML stack-trace renderer (`SEC-NEW-02` / `ST105`).
     - `src/server/middleware/rateLimiters.ts`: skip IP-level `limiter` and `apiLimiter` when a syntactically valid `lf_` API key is presented (`Authorization: Bearer lf_id_...` or `X-API-Key: lf_id_...`) so authenticated keys are governed by their configured `apiKeyRateLimiter` (`Z-02`, up to `10,000`/min) while invalid/unauthenticated tokens remain IP-throttled (`SEC-NEW-03`).
     - `src/server/openapi.ts`: add complete `400`/`401`/`403`/`404`/`413`/`422`/`429` JSON error response schemas so OpenAPI 3.1 matches actual server contracts (`API-NEW-02` / `ST103`).
     - Regression test suite `src/tests/sec-scan-1-and-api-hardening.test.ts` verifying every fix above + workflow/ZAP invariants.
2. **Patch Handoff Package for AI #1 (`audit/agent6-2026-11-16/patches/01..07-*.patch`, each verified `git apply --check` clean against `1f183efc`):**
   - `01-fx-minor-units-and-credit-refund.patch` (`ACC-NEW-01`: `schemas.ts`, `txFilters.ts`, `TransactionValidator.ts`, `creditService.ts`, `periods.ts`)
   - `02-rls-viewer-assets-and-ledger-triggers.patch` (`SEC-NEW-04` + `A7N-06` + `A6-SQL-07`: new Supabase hardening migration)
   - `03-transaction-crud-reconcile-and-batch-guards.patch` (`API-NEW-01` + `A7N-03`: `crudRoutes.ts`, `reconcileRoutes.ts`, `bulkRoutes.ts`)
   - `04-odoo-18-archived-and-xml-currency-import.patch` (`IMP-NEW-01`: `odooImport.ts`, `recordImport.ts`)
   - `05-tax-recompute-and-prepaid-minor-units.patch` (`A7N-04`: `taxRecompute.ts`, `taxCodes.ts`, `prepaidService.ts`)
   - `06-fx-revaluation-asof-and-ap-account.patch` (`A7N-05`: `fxRevaluationService.ts`)
   - `07-reports-multicurrency-statement-and-tb.patch` (`A7N-07`: `computeReports.ts`)
