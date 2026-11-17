# Checkpoint 01 — Instructions, Conflicts, Repository State & Baseline Inventory (Agent #6 — 2026-11-16)

- **Session Date:** `2026-11-16` (UTC)
- **Agent Identity:** Agent #6 (Security, OpenAPI/DAST Scanning & Independent Accounting/Engineering Audit)
- **Working Branch:** `arena/52ac66f7-ledgerflow` (active, clean working tree)
- **Base Commit (`main` / `HEAD`):** `1f183efc54bfce3e026bb2861dbaa6472e8fb727` (`EU-A4b: Odoo import (chart, contacts, products) (#739)`)
- **Upstream Remote (`origin`):** `https://github.com/shmuelbiller1/ledgerflow.git` (push enabled; authenticated via `gh` as `Chaim-Richard`)
- **Google Drive Recovery Archive:** Root folder `1VG4z3otVCVhN2Vmr8jnssok8bIF2J-RK` (`google_drive` connector enabled and verified)

---

## 1. Authoritative Instruction Sources Examined

All authoritative repository instruction files, coordination queues, owner decisions, security specifications, prior audit archives, GitHub issues/PRs, and Google Drive recovery folders were examined prior to modifying any file:

| Category | Exact Source Path / Identifier | Key Mandates & Takeaways |
|---|---|---|
| **Root & Scoped Agent Contracts** | `AGENTS.md`, `CLAUDE.md`, `CURRENT_WORK.md`, `src/AGENTS.md`, `src/components/AGENTS.md`, `src/lib/AGENTS.md`, `src/tests/AGENTS.md` | Non-negotiable accounting & tenant invariants (`sum(debits) === sum(credits)` in home currency, ISO 4217 minor units, `Decimal.js` money math, `workspaceId` + RLS isolation, `runCommand` / registered commands for new server writes, ESLint `--max-warnings 2` ratchet, zero silent financial assertion tampering). |
| **Multi-Agent Coordination & Runbook** | `docs/COORDINATION.md`, `docs/LEAD_RUNBOOK.md`, `docs/TRACKER.md` | Chronological handoffs through 15–16 Nov 2026. **AI #6's #1 assigned task (added 15 Nov 2026, line 1121):** `SEC-SCAN-1` (*"Do this first"*). AI #1 owns `src/server/`, money, posting, tax math, and live DB migrations; AI #6 owns security (`S-*`, `SEC-SCAN-1`) and reports money-code defects to AI #1. |
| **Owner Decisions & Migration State** | `docs/FOR_YOU.md` | Confirms owner approval of `SEC-SCAN-1` (*"so add it"* — local CI server only, never scan live site without written approval). Confirms migrations through `20261115000000_document_commands_server_only.sql` were applied to live Supabase on 15 Nov 2026. |
| **Assigned Task Specs** | `docs/prompts/SEC-SCAN-1-api-and-web-scans.md`, `docs/prompts/CMD-1-checklist.md`, `docs/SECURITY_SWEEP.md`, `docs/SECURITY_CONTROLS.md`, `security-baseline.json` | Exact spec for `.github/workflows/api-fuzz.yml` (Schemathesis against `/api/v1/openapi.json` + test Postgres) and `.github/workflows/zap-baseline.yml` + `.zap/rules.tsv` (ZAP nightly + manual against local production build). `security-baseline.json` documents 24 server routes returning HTTP 500 on auth/role refusal and viewer write grants on `documents` / `supportTickets`. |
| **Release & Audit Gates** | `docs/RELEASE_GATE.md`, `docs/FIRST_TESTERS_GATE.md`, `docs/INDEPENDENT_AUDIT_AGENT.md` | 14 workflow readiness matrix (`W1`–`W14`, 5 green, 9 amber, 0 red as of 21 Oct) and Pass A / Pass B independent accounting & security audit methodology. |
| **Prior Audit Archives (Repo & Drive)** | `audit/agent6-2026-11-10/`, `audit/agent6-2026-11-12/`, `audit/agent6-2026-11-12b/`, `audit/agent7-2026-11-13/`, Drive `MASTER_RECOVERY_INDEX.md` (`1pTGxQhLdqBvH4sLoR-0MZ0XuvKtTP86F`) | Prior Agent #6 PRs `#673` and `#703` (merged via `#705`) and Agent #7 PR `#702` (merged via `#704`). Drive `MASTER_RECOVERY_INDEX.md` was last updated 2026-11-12 04:40 UTC because Drive was disconnected during `2026-11-12b` and `2026-11-13` sessions. |
| **GitHub PRs, Issues & CI** | Upstream `shmuelbiller1/ledgerflow` PRs `#673`–`#743` & issues (`#132`, `#150` open; `#641`–`#662` closed); Fork `Chaim-Richard/ledgerflow` PRs `#4`–`#29` | Open upstream PRs: `#743` (`CMD-1` account/groups commands), `#741` (`EU-G1` Purchases i18n), `#738` (`EU-E3` label tree), `#737` (`EU-I3` free invoice maker). **Zero open upstream PRs belong to Agent #6.** `main` CI at `1f183ef` is green across CI, CodeQL, and Dependency SBOM. |

---

## 2. Instruction Conflict Analysis & Authoritative Resolution

| # | Apparent Conflict | Sources Compared | Authoritative Resolution |
|---|---|---|---|
| **C-1** | **Direct patching of money/posting/tax/`src/server/` vs. User Prompt §6 ("Fix real problems... Improve incorrect accounting logic, Fix database and API inconsistencies")** | User Prompt §2.9 & §6 vs. `AGENTS.md`, `docs/COORDINATION.md` Rules 2–3, and `docs/prompts/SEC-SCAN-1-api-and-web-scans.md` (*"security fixes are AI #6's, anything in money code is AI #1's"*) | User Prompt §2.9 explicitly directs: *"Identify conflicting instructions and follow the applicable authoritative project instructions."* Therefore: **(a)** AI #6 directly implements `SEC-SCAN-1` (`.github/workflows/api-fuzz.yml`, `.github/workflows/zap-baseline.yml`, `.zap/rules.tsv`), authorized security/non-money fixes, client-side accounting/UI fixes outside AI #1's reserved files, and regression tests; **(b)** for confirmed defects in AI #1's reserved money/posting/tax/SQL-migration lane (or files touched by open PRs `#743`, `#741`, `#738`, `#737`), AI #6 builds live executable reproduction probes proving the bug on `1f183ef` AND provides standalone, `git apply --check`-verified turnkey patches under `audit/agent6-2026-11-16/patches/` plus clear handoff notes in `docs/COORDINATION.md`. |
| **C-2** | **Branching & PR workflow vs. historical `CLAUDE.md` ("work directly on `main`, no feature branches")** | `CLAUDE.md` / `docs/TRACKER.md` (written for AI #1) vs. `AGENTS.md`, `docs/COORDINATION.md`, User Prompt §7, and Arena session branch lock | `CLAUDE.md` governs AI #1 (lead) only; `AGENTS.md`, `docs/COORDINATION.md`, User Prompt §7, and Arena system rules require helper agents to work exclusively on the assigned branch (`arena/52ac66f7-ledgerflow`), push to `origin arena/52ac66f7-ledgerflow`, open a PR against `main`, drive CI green, and **never merge**. |
| **C-3** | **Avoidance of overlap with in-flight open PRs (`#743`, `#741`, `#738`, `#737`)** | User Prompt §3 & `docs/COORDINATION.md` | None of the files modified on `arena/52ac66f7-ledgerflow` will overlap with `#743` (`accountRoutes.ts`, `commands/account.ts`, `commands/groups.ts`, `scripts/generate-commands.ts`, `commands-baseline.json`), `#741` (`Purchases.tsx`, `screenTranslations.ts`), `#738` (`DimensionsSettings.tsx`, `LabelProfitReportView.tsx`, `labelTree*.ts`), or `#737` (`App.tsx`, `InvoiceModal.tsx`, `Sales.tsx`, `AuthScreen.tsx`). Shared docs (`docs/COORDINATION.md`, `docs/FOR_YOU.md`) are edited minimally and additively only where required by `SEC-SCAN-1` and AI #1 handoff rules. |
| **C-4** | **Scanning targets (`SEC-SCAN-1`)** | User Prompt §4–6 vs. `docs/FOR_YOU.md` & `docs/prompts/SEC-SCAN-1-api-and-web-scans.md` | Both Schemathesis and OWASP ZAP run **exclusively** against local/CI ephemeral servers (`127.0.0.1:3000` backed by disposable PostgreSQL), **never** against `https://ledgerflow-one-pearl.vercel.app` or production Supabase. |

---

## 3. Repository & Baseline Verification Snapshot (`1f183efc`)

- **Tracked Git Files:** `4,118` files (`code-atlas`: `2,141` source/doc/test entries, `1,967` code files, `672` test files, `35` SQL migrations through `20261115000000_document_commands_server_only.sql`, `0` parse errors).
- **Static & Structural Gates Verified at Baseline (`1f183efc`):**
  - `NODE_OPTIONS="--max-old-space-size=4096" npm run lint:types` (`tsc --noEmit`): **PASS** (0 errors; note: requires >2 GB heap on Node v22.22.3 due to 4,118-file codebase + generated command schemas).
  - `NODE_OPTIONS="--max-old-space-size=4096" npm run lint:eslint` (`eslint . --max-warnings 2`): **PASS** (0 errors, 2 warnings — exact ratchet ceiling).
  - `npm run check:layers`: **PASS** (4/4 architecture boundary checks).
  - `npm run check:tax-tables`: **PASS** (55 modules, 34 tables, 1,163 rows, 0 problems).
  - `npm run lint:rule-packs`: **PASS** (584 rules, 0 problems).
  - `npm run check:perf-budgets`: **PASS** (5 budgets valid).
- **Major Post-12-Nov Changes Requiring Fresh Audit Verification (`e33b3f2` → `1f183ef`):**
  1. `CMD-1` server command architecture (`#719`, `#724`, `#725`, `#726`, `#731`, `#732`) + migration `20261115000000_document_commands_server_only.sql` (61 commands registered; OpenAPI `/api/v1/openapi.json` auto-generated from command registry).
  2. Foreign-rate journal & instalment payment fixes (`#711`, `#712`, `#713`) and unapplied portions of Agent #7's 13 Nov patches (`01` `ledgerDoor` FX / `refundCredit`, `04` `fxRevaluationService` cutoff/AP account, `05` `assets` RLS / `payrollImportService` TOCTOU, `06` `computeStatement` multi-currency / `computeTrialBalance` orphan lines / `computeCashFlow` asset disposal).
  3. Automated attacker sweep (`#720` `src/tests/security-sweep.test.ts` + `security-baseline.json`) recording 24 server routes returning HTTP 500 on auth/role refusal and viewer write grants on `documents` and `supportTickets`.
  4. Odoo import (`#739`), tax picker fix (`#728`), W8 filed state return gold tests (`#727`), and RowTable UI sweep (`#714`–`#742`).

---

## 4. Immediate Execution Plan (Next Phases)

1. **Live PostgreSQL + Baseline DB/RLS/Security Verification:** Boot local PostgreSQL 16/17 via `pgserver`, apply all 35 migrations (`npm run db:test-setup`), run `npm run test:rules` and `npm run test:security`, and verify baseline unit/DB suites.
2. **`SEC-SCAN-1` Implementation & Live Fuzzing:** Boot LedgerFlow server locally, inspect `/api/v1/openapi.json`, run live `schemathesis` fuzzing against `/api/v1/openapi.json` to uncover real 500s / schema defects / auth edge cases, implement `.github/workflows/api-fuzz.yml`, `.github/workflows/zap-baseline.yml`, and `.zap/rules.tsv`, and add unit contract tests for workflow/OpenAPI invariants.
3. **Deep Repository-Wide Accounting, Financial Operations & Security Audit:** Re-verify all prior findings on `1f183efc` and audit `CMD-1` commands, Odoo import (`#739`), multi-currency/FX/rounding, GL/period close/reconciliation/tax/reports, RLS policies, and API error/auth boundaries using live PostgreSQL probes.
4. **Authorized Fixes, Turnkey Patches, Full Verification, PR & Continuous Drive Sync:** Implement authorized fixes + regression tests, package reserved-lane turnkey patches (`git apply --check` clean), run full test/build gates, push to `origin arena/52ac66f7-ledgerflow`, open PR (no merge), monitor CI/bots, and sync all checkpoints, findings, patches, logs, and updated `MASTER_RECOVERY_INDEX.md` to Google Drive.
