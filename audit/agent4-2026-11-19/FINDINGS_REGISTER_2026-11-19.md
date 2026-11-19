# Ledgerflow — AI #4 findings register, 2026-11-19

**Agent:** #4 (Arena session; branch `arena/1465d4c1-ledgerflow`, base `5fcf197` = `main`)
**Pull request:** [shmuelbiller1/ledgerflow#937](https://github.com/shmuelbiller1/ledgerflow/pull/937)
**Lane:** AI #4 — QA/test infrastructure and screens. Money maths, posting, tax tables, schemas and
`src/server/**` are out of lane and were **reported, not patched**.
**Environment:** 2 vCPU / 3.9 GB, Node 22.22.3, npm 10.9.8, no Chromium, no local Postgres.

Every finding below was reproduced in this session before it was fixed, and every fix has a test.
"Confirmed" = observed in the code path or in a rendered DOM; "Reported" = out of lane, filed/told
to AI #1.

---

## A4-001 — `check:perf-budgets` never compared a budget with anything (Medium, confirmed, **fixed**)

- **Where:** `package.json` script `check:perf-budgets`; `perf/budgets.json`; `.github/workflows/nightly-stability.yml` (`budgets` job); `.github/workflows/ci.yml` (absent).
- **Evidence:** the script was `node -e "const b=require('./perf/budgets.json'); if(!b.version) process.exit(1); console.log('Perf budgets valid:', …)"`. It proves the file parses; no budget value is read. Nothing in `ci.yml` ran it at all.
- **Consequence:** every bundle or latency regression passes silently. Audit reports from 11, 13, 16 and 18 Nov recorded "PASS — 5 entries valid", i.e. a parse, as if it were a budget.
- **Correction:** `scripts/check-perf-budgets.mjs` (schema + measurement + non-zero exit), `perf/budgets.json` `version` 2 with a measured `bundle` section, CI `Production build` step `node scripts/check-perf-budgets.mjs --require-dist`, 8 tests in `src/tests/perf-budgets.test.ts`.
- **Tests performed:** 8/8 new tests; three failure paths exercised by hand (over-budget → exit 1 with the overshoot named; `--require-dist` with no build → exit 1; `version: 0` → exit 1); a real `npm run build` measured and inside every budget.
- **Remaining risk:** the latency half of the file still depends on the load-test jobs; this change does not measure a stopwatch, and says so in the script header, the docs and the PR.

## A4-002 — twelve decorative percentage bars painted a full track for a negative, >100 % or `NaN` share (Low/Medium, confirmed, **fixed**)

- **Where (before):** `components/projects/ProjectsView.tsx` (split-rule bar), `components/platform/settings/TeamSettings.tsx` (seat capacity), `components/platform/SystemTelemetryPanel.tsx` (bulk-sync bar **and its `(NaN%)` label**), `components/charts/ChartDragBrush.tsx` (selection track), `components/inventory/inventoryColumns.tsx` (×2), `components/inventory/Inventory.tsx`, `components/ledger/ReconciliationView.tsx`, `components/planning/BudgetManager.tsx`, `components/projects/ProjectPipeline.tsx`, `components/transactions/PivotView.tsx`, `components/finance/TaxReserveWidget.tsx` (×2), `components/platform/settings/UsagePanel.tsx`, `components/intelligence/IntelligenceCenter.tsx`, and the two report views (whose #911 clamp passes `NaN` through).
- **Evidence:** issue #909 measured Rent +12,445 / rebate −2,000 → "Rent 119.1 % (96 px of 96), rebate −19.1 % (also 96 of 96)"; the same class is present at the sites above. A browser drops `width: -19%` and `width: NaN%`, the declaration falls back to `auto`, and the block fills its track. `Math.max(0, Math.min(100, NaN))` is still `NaN`.
- **Consequence:** the Reader sees the opposite of the printed number (a refund shown as a 100 % contribution); a zero total shows `(NaN%)` in the bulk-sync label.
- **Correction:** `src/lib/percentBar.ts` (`clampPercentWidth`, `percentWidthStyle`) at all sites. Text, signed percentage, sorting order and CSV are unchanged.
- **Tests performed:** `percent-bar-widths` 7/7 (semantics + a scanner over every `src/components/**/*.tsx` that fails on a new unclamped percent width, with a non-vacuity case); `percent-bar-render` 3/3 rendered against the real brush, **1 pass / 2 fail** with the old code restored; `share-bar-clamp` (#909's own suite, Agent #8) still passes.
- **Remaining risk:** the bars were not measured in a real browser here (no Chromium in this sandbox); the browser shards on the PR are the visual evidence. Chart geometry elsewhere (`AccountIcicle` block positions) is not a percentage width and is untouched.

## A4-003 — #924's schema half: `splitRules` percentages are unvalidated (Low, **reported, not patched**)

- **Where:** `src/schemas.ts` (`splitRules: z.array(z.record(z.string(), z.any()))`), `src/components/projects/ProjectsView.tsx`.
- **Status:** the rendering half is fixed (A4-002). The write-side validation (range, typed shape, sum ≤/== 100) is a schema change owned by AI #1; the issue already carries the proposal. Not duplicated here.

## A4-004 — #923: income/expense shares print `0.0 %` when the period net is negative (Low, **reported, not patched**)

- **Where:** `src/lib/reportGenerators.ts` (shared by the browser and `src/server/services/balanceService.ts`).
- **Why not patched:** it is shared money maths (AI #1's lane); the issue describes two acceptable semantics that the owner/lead must pick.

## A4-005 — nothing enforced a bundle budget in CI before this PR (Medium, confirmed, **fixed**)

Same root cause as A4-001, recorded separately because D-27 asked for exactly this and the queue item was open: the owner-visible definition of done is "fails CI when exceeded". Proven by the three hand-run failure paths, not only by the new script's presence.

---

## Coverage and limits of this session

- **Read and used:** `AGENTS.md`, `src/AGENTS.md`, `src/lib/AGENTS.md`, `src/components/AGENTS.md`, `src/tests/AGENTS.md`, `CURRENT_WORK.md`, `docs/COORDINATION.md` (NOW, helper rules, AI #4 queue, Messages), `docs/RELEASE_GATE.md`, `docs/CI_STRATEGY.md`, `docs/perf.md`, `AI10_SESSION_ADDENDUM_2026-11-17.md`, `CLAUDE.md`, the open-issue list and issues #909/#923/#924, `.github/workflows/ci.yml`, `nightly-stability.yml`, and the Drive `MASTER_RECOVERY_INDEX.md`.
- **Not claimed:** no full-suite run, no browser run, no database run locally (no Chromium/Postgres; CI owns those). No accounting engine, posting path, migration or tax table was audited in this session — previous agents' registers cover those lanes and were not re-verified here.
- **Not in this PR:** any change to money maths, schemas, migrations, `src/server/**`, posting, or another agent's reserved screens.
