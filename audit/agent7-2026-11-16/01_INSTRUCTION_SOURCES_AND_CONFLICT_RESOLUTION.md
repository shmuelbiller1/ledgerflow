# Agent #7 Session (2026-11-16) — Checkpoint 01: Instruction Sources, Conflict Resolution & Baseline State

- **Date (UTC):** 2026-11-16
- **Agent:** Agent #7 (Maximum-Capability Engineering, Accounting, Security & Launch-Readiness Audit)
- **Repository:** `shmuelbiller1/ledgerflow` (`/home/user/ledgerflow`, ~3,240 tracked source/script/migration/test files)
- **Active Working Branch:** `arena/93656b5f-ledgerflow` (branched from `1f183efc54bfce3e026bb2861dbaa6472e8fb727`, fast-forwarded cleanly to `origin/main` `9c859dd16d4fe77b9713215deeb7f066a1866c71`)
- **Final Decision-Maker:** Shmuel (`shmuelbiller1`) — no pull request will ever be merged or closed without his explicit decision.

---

## 1. Instruction Sources Examined

Every authoritative repository rule file, architecture prompt, prior audit directory, GitHub coordination surface, and Google Drive recovery folder was read and reconciled before code edits:

| # | Source | Path / Location | Key Rules & Takeaways |
|---|---|---|---|
| 1 | Root Engineering & Governance Rules | `AGENTS.md`, `CLAUDE.md` | Non-negotiable accounting invariants (`amountCents` integers, `sum(lines) === 0`, posted immutability, multi-currency `exchangeRate`, audit hash chain, workspace isolation); helper-AI scope rules; mandatory `check:layers`, `lint:types`, `lint:eslint`, tests, and build verification. |
| 2 | Live Status & Blocker Log | `CURRENT_WORK.md` | Current launch gates, #719 command-architecture migration status, Supabase/RLS status, open P0/P1 tracking. |
| 3 | Multi-Agent Coordination & Lane Rules | `docs/COORDINATION.md` | Lane boundaries: `src/server/**`, `supabase/migrations/**`, and money/posting/tax math are reserved to AI #1 unless authorized; helper-AI queue assigns AI #7 stability items `F-1`..`F-40`; chronological Messages log reviewed. |
| 4 | Scoped Subtree Rules | `src/AGENTS.md`, `src/components/AGENTS.md`, `src/lib/AGENTS.md`, `src/tests/AGENTS.md` | Layer boundaries (`lib -> services -> hooks -> components`), UI design/i18n/accessibility rules, pure deterministic `src/lib` rules, real-behavior test rules (no tautological mocks). |
| 5 | Active Architecture Prompts (Nov 15–16) | `docs/prompts/CMD-1-commands.md`, `CMD-1-checklist.md`, `SBX-1-assistant-sandbox.md`, `SEC-SCAN-1-api-and-web-scans.md` | `CMD-1` migrates mutating routes to typed `CommandDefinition` handlers (`POST /api/v1/commands/:id`) with `runCommand` on client; `SBX-1` designs overlay-schema assistant sandbox; `SEC-SCAN-1` specifies Schemathesis & ZAP scans. |
| 6 | Release & Audit Runbooks | `docs/INDEPENDENT_AUDIT_AGENT.md`, `docs/RELEASE_GATE.md`, `docs/FIRST_TESTERS_GATE.md`, `docs/FOR_YOU.md`, `docs/LEAD_RUNBOOK.md` | Release-blocking criteria, security/RLS verification expectations, tester-readiness gates. |
| 7 | Prior Repo Audits & Patches | `audit/agent7-2026-11-13/01..05.md` + `patches/01..06.patch` + `probes/probe-01..06.ts`; `audit/claude-2026-11-11/README.md` | Prior Agent #7 session merged via PR `#704`; Nov 11 whole-project audit remediated in PR `#647`. |
| 8 | Security & Ratchet Baselines | `security-baseline.json`, `commands-baseline.json`, `quality-baseline.json`, `package.json` | ESLint hard cap `--max-warnings 2` (currently 2/2 used on `main`); `security-sweep.test.ts` locks route/RLS matrix (`serverErrors` currently records 28 5xx responses, 24 of which are 500s on auth/role rejection!). |
| 9 | GitHub PRs, Issues & CI | Open PRs `#743`, `#744`, `#490`; recent merged PRs `#704`, `#705`, `#711`, `#712`, `#719`, `#720`, `#724`–`#742`; open issues `#645`..`#692` | Mapped active parallel work to guarantee zero file collisions. |
| 10 | Google Drive Permanent Headquarters | Folder `1VG4z3otVCVhN2Vmr8jnssok8bIF2J-RK` (`MASTER_RECOVERY_INDEX.md` `1pTGxQhLdqBvH4sLoR-0MZ0XuvKtTP86F` + folders `01`–`10`) | Full backup of `MASTER_RECOVERY_INDEX.md` saved prior to edits; all prior Agent #5/#6/#7/#8/#11 artifacts indexed. |

---

## 2. Explicit Conflict Resolution Record

### Conflict 1 — Broad Prompt Remediation Scope vs. Repository Helper-AI Reserved Lanes (`AGENTS.md` / `docs/COORDINATION.md`)
- **Conflict:** User mission prompt Section 6 instructs Agent #7 to fix confirmed defects across accounting, APIs, security, permissions, and frontend/backend consistency, whereas `AGENTS.md` ("Scope for helper AIs") and `docs/COORDINATION.md` reserve `src/server/**`, `supabase/migrations/**`, and money/posting/tax calculation modules to AI #1 unless explicitly authorized, and historical PR `#702` was superseded by `#704` specifically to respect that lane split.
- **Authoritative Resolution (proven `#704` precedent):**
  1. **Direct Branch Commits (PR-safe, zero lane conflict):** Commit direct fixes in authorized client/UI/hook/pure-helper/test scope (`src/components/**`, non-money/tax `src/lib/**`, `src/hooks/**`, `src/tests/**`, and `audit/agent7-2026-11-16/**`), strictly avoiding any file touched by open upstream PRs `#743` and `#744`.
  2. **Turnkey Standalone Patches + Live DB Probes for Reserved Lanes:** Every confirmed defect in `src/server/**`, `supabase/migrations/**`, or money/posting/tax math is engineered, tested against live PostgreSQL 16.2 (`lf_test`), and delivered as a clean `git apply --check`-verified patch against `9c859dd` in both `audit/agent7-2026-11-16/patches/` and Google Drive `05 Code Changes and Recovery Patches`, paired with deterministic reproduction/verification probes in `audit/agent7-2026-11-16/probes/`.

### Conflict 2 — Parallel Open Upstream PRs (`#743`, `#744`)
- **Active Open PRs at `2026-11-16T21:35Z`:**
  - **PR `#743` (`arena/4837312d-ledgerflow`):** `CMD-1: person-scoped commands + accountRoutes conversion` (`commands-baseline.json`, `docs/FOR_YOU.md`, `docs/prompts/CMD-1-checklist.md`, `scripts/generate-commands.ts`, `sdk/commands.generated.ts`, `src/lib/command*.generated/**`, `src/server/commands/{account,groups,defaultRegistry,registry,types}.ts`, `src/server/routes/{accountRoutes,commandRoutes}.ts`, `src/server/services/notificationEmailService.ts`).
  - **PR `#744` (`arena/357091c8-ledgerflow`):** `Raw table sweep, batch 2` (`docs/SCREEN_REBUILD_CHECKLIST.md`, `quality-baseline.json`, `scripts/codemod-row-table.ts`, `ConsignmentStockPanel.tsx`, `DrillDownModal.tsx`, `AssetRegisterReportView.tsx`, `BackordersReportView.tsx`, `DepreciationLedgerReportView.tsx`, `GoodsNotBilledReportView.tsx`, `ItemRegisterReportView.tsx`, `PublicEstimatePage.tsx`, `RowTable.tsx`, `row-table-codemod.test.ts`, `row-table.test.tsx`).
- **Resolution:** Zero direct edits on our branch to any file modified in `#743` or `#744`. Any defect discovered inside those files is documented in the Findings Register and delivered as a non-conflicting standalone patch.

### Conflict 3 — ESLint Warning Cap (`--max-warnings 2`)
- `package.json` enforces `eslint . --max-warnings 2`, and `main` (`9c859dd`) currently uses **2 of 2** warnings (`src/server/auth/supabaseAuth.ts:21`, `src/server/db/pg/values.ts:7`). Every file added or modified by Agent #7 must introduce **0 ESLint warnings**.

---

## 3. Baseline Verification & Re-Test of Nov 13 Reserved-Lane Findings on `9c859dd`

### 3.1 Environment & Gate Baseline on `9c859dd`
- **PostgreSQL 16.2 (`lf_test`):** Provisioned locally on `127.0.0.1:5432`; all **58 SQL migrations** (`0001_init.sql` .. `0058_workspace_writes_via_server.sql`) applied cleanly.
- **Static & DB Gates:**
  - `npm run lint:types`: **PASS (0 errors)**
  - `NODE_OPTIONS="--max-old-space-size=3072" npm run lint:eslint`: **PASS (0 errors, 2 warnings)**
  - `npm run check:layers`: **PASS**
  - `npm run check:tax-tables`: **PASS**
  - `npm run lint:rule-packs`: **PASS**
  - `npm run check:perf-budgets`: **PASS**
  - `npx tsx scripts/bug-patterns.ts`: **PASS**
  - `npm run test:rules`: **PASS (`ALL RLS TESTS PASSED`)**
  - `npm run test:security` (`src/tests/security-sweep.test.ts`): **PASS (4 passed, 1 skipped)**

### 3.2 Live Runtime Re-Verification of Agent #7 (2026-11-13) Reserved-Lane Findings (`A7N-01`..`A7N-08`)
All 6 PostgreSQL probes (`audit/agent7-2026-11-13/probes/probe-01..06.ts`) were executed against `9c859dd` (`lf_test`):

| Prior ID | Summary | Status on `9c859dd` (`2026-11-16`) | Evidence |
|---|---|---|---|
| `A7N-01` | `ledgerDoor` FX check blocked `voidPayment` & doubled `totalAmountBaseCents` | **FIXED UPSTREAM** (`PR #711`) | `probe-01` shows `paymentStatusAfter: "void"` for both header-FX and line-FX payments. |
| `A7N-02b` | `refundCredit` allowed refunding unposted (`posted: false`) credit notes | **FIXED UPSTREAM** (`PR #712`) | `probe-02` throws `409 CreditError: Credit note CN-UNPOSTED-001 has no entry in the books`. |
| `A7N-02a` | `refundCredit` non-2-decimal FX minor-unit bug (`JPY`/`KWD`), custom `arAccountId`/`apAccountId` ignored, missing server audit log | **STILL OPEN ON `main`** | Confirmed in `src/server/services/creditService.ts:417-447` (uses `credit.exchangeRate` instead of `minorUnitRate`, ignores `credit.arAccountId`/`apAccountId`, omits `writeServerAuditLog`). |
| `A7N-03` | `POST /api/v1/transactions/reconcile` & `POST /api/v1/transactions/batch` bypass posted-ledger immutability | **STILL OPEN ON `main`** (`PR #705` only fixed `crudRoutes`!) | `probe-03` returned `200 OK`: voided posted invoice entry, mutated depreciation line to `1` cent, and downgraded posted journal entry to `draft`. |
| `A7N-04` | Non-2-decimal (`JPY`/`KRW`/`KWD`/`BHD`/`JOD`/`OMR`) 100×/10× tax recompute GL corruption, tax return, IL VAT, US nexus, prepaid schedule | **STILL OPEN ON `main`** (`Patch 03` applies cleanly) | `probe-04` confirmed `-6,633` USD cents (`-$66.33`) corrupted GL adjustment posted on `¥100,000` JPY invoice + 100×/10× statutory box errors. |
| `A7N-05` | `revaluateForeignBalances` ignores `asOf` cutoff and bills' custom `apAccountId` | **STILL OPEN ON `main`** (`Patch 04` applies cleanly) | `probe-05` confirmed Sep 30 revaluation skipped Sep invoice paid in Oct, included future Oct bill, and posted to default AP instead of custom AP. |
| `A7N-06` | `assets`/`fixedAssets` browser RLS `bookkeeper: riud` allows depreciation tamper & double-post; `payrollRoutes` missing role check | **STILL OPEN ON `main`** (`Patch 05` applies cleanly) | `probe-05` confirmed `glDepreciationExpenseCents: 100000` (2× double-post). |
| `A7N-07` | Customer/vendor statements sum raw foreign cents across currencies; TB/Cash-Flow unposted filter gaps | **STILL OPEN ON `main`** (`Patch 06` applies cleanly) | `probe-06` confirmed `statementEndingBalanceCents: 150000` vs `customerBalanceSummaryBaseCents: 117000`. |
| `A7N-08` | `crudRoutes` `PUT /api/v1/:col/:id` returns stale `data.updatedAt` instead of new server timestamp, causing 409 self-conflict on second save | **STILL OPEN ON `main`** (`PR #705` omitted this hunk) | `probe-06` confirmed `put1Status: 200` followed by `put2StatusUsingReturnedUpdatedAt: 409`. |

---

## 4. Audit Execution Plan for This Session

1. **Deep Audit of All Post-Nov-13 Merged Subsystems (`#719`..`#742`):**
   - `CMD-1` command runner & all command handlers (`src/server/commands/**`, `src/lib/runCommand.ts`, `commands-baseline.json`, idempotency, permissions, audit logging, transaction atomicity, schema validation).
   - `#725` audit hash-chain & invoice/customer save changes.
   - `#737` `EU-I3` public unauthenticated free invoice maker (security, XSS/HTML/PDF injection, storage/API exposure, tax/rounding math).
   - `#738` `EU-E3` hierarchical parent-child dimensions (`Region -> Property -> Unit`: cycle prevention, deletion cascades, P&L/report rollup double-counting!).
   - `#739` `EU-A4b` Odoo import (CSV parsing, CoA account mapping, currency/minor-unit conversion, duplicate/injection guards).
2. **Deep Audit of Core Accounting, Financial Operations, Security & RLS:**
   - Complete review of `security-baseline.json` anomalies (`customTemplates` `stranger: "i"`, `documents` `viewer: "ri"`, `supportTickets` `viewer: "ru"`, 24 HTTP-500 auth/role error routes, `selfRoutes`).
   - Accounting/GL/AP/AR/payments/allocations/bank-reconciliation/period-close/consolidation/inventory/COGS/payroll/tax/multi-currency across `src/server/**`, `src/services/**`, `src/kernel/**`, `src/lib/**`.
3. **Deep Audit of Frontend/Client & AI #7 Stability Queue (`F-1`..`F-40`):**
   - Audit client hooks, stores, forms, reporting views, error boundaries, stale-closure/race hazards, and UI-to-backend contract mismatches; implement safe, high-value direct fixes in authorized client/lib/hook/test scope.
4. **Verification, GitHub PR Management & Continuous Google Drive Backup:**
   - Refresh and expand standalone reserved-lane patches + live PostgreSQL probes for `9c859dd`, add comprehensive unit/integration tests, run full test & build verification, push to `arena/93656b5f-ledgerflow`, open/update PR (never merge), inspect CI/bot comments, and verify all artifacts in Google Drive + `MASTER_RECOVERY_INDEX.md`.
