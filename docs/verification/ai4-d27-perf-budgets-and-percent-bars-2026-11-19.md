# AI #4 — D-27 performance budgets enforced in CI, and the remaining #909 / #924 percentage bars

**Agent:** #4 (Arena session, branch `arena/1465d4c1-ledgerflow`, base `5fcf197` = `main`)
**Date:** 2026-11-19
**Lane:** AI #4 — QA/test infrastructure and screens. No money maths, posting, tax tables or
`src/server/` file is touched by this branch.

---

## 1. D-27 — performance budgets now fail CI when the built bundle grows past them

### The defect (confirmed, Medium)

`perf/budgets.json` has carried real budgets (posting, P&L, balance sheet, search, nine screens)
since F-38, and `.github/workflows/nightly-stability.yml` ran `check:perf-budgets` every night. That
script was:

```json
"check:perf-budgets": "node -e \"const b=require('./perf/budgets.json'); if(!b.version) process.exit(1); console.log('Perf budgets valid:', Object.keys(b.budgets).length, 'entries')\""
```

It proves the JSON parses and has a `version`. **No budget value is ever compared with anything**, so
no bundle or latency regression could ever turn CI red. D-27 asked for "bundle size and first-load
time limits that fail CI when exceeded"; the file existed, the enforcement did not. Every audit pass
that recorded "`check:perf-budgets` PASS — 5 entries valid" was recording a parse, not a budget.

### The correction

| File | Change |
|---|---|
| `scripts/check-perf-budgets.mjs` | New. Validates the schema (version, `bundle` section, every latency budget a positive number, grouped `screens` validated leaf by leaf), measures the built client, and **exits 1 when a budget is exceeded**, naming the key, the budget and the overshoot. `--require-dist` makes a missing build an error instead of a silent skip; `--json` for machines. |
| `scripts/check-perf-budgets.d.mts` | Typed signatures so `tsc --noEmit` accepts the test's import (same pattern as `restore-drill.d.mts`). |
| `perf/budgets.json` | `version` 1 → 2 and a new `bundle` section: `firstLoadGzipKb` 360, `totalJsGzipKb` 3200, `maxChunkGzipKb` 300, `cssGzipKb` 60. |
| `package.json` | `check:perf-budgets` now runs the real checker. |
| `.github/workflows/ci.yml` | `Production build` job, new step **Performance budgets (built bundle)** → `node scripts/check-perf-budgets.mjs --require-dist`, after the build and the bundle invariants. The nightly job keeps `npm run check:perf-budgets`. |
| `src/tests/perf-budgets.test.ts` | 8 tests: schema acceptance/refusal, over/at-budget evaluation, real measurement of a synthetic `dist/`, dangling-reference reporting, and a wiring guard that fails if the npm script, the CI step or its order is dropped. |

### Measured on this branch (2026-11-19, `npm run build`, gzip)

| Budget | Measured | Budget | Headroom |
|---|---|---|---|
| `firstLoadGzipKb` | 327.0 | 360 | 10 % |
| `totalJsGzipKb` | 3007.8 | 3200 | 6 % |
| `maxChunkGzipKb` (largest chunk: lazy Excel reader) | 263.6 | 300 | 14 % |
| `cssGzipKb` | 34.8 | 60 | 72 % |

**What is honestly measured:** `firstLoadGzipKb` is the gzip bytes of the scripts and stylesheet
`dist/index.html` itself references (entry chunk + `modulepreload` links + CSS) — the work a browser
must download before the first frame. It is **bytes, not a stopwatch**: first-contentful-paint depends
on the network, the device and the font CDN, so no time budget is claimed. The latency budgets in the
same file remain the load-test jobs' (`scripts/load-test.ts`, `scripts/load/`).

### Verification (this branch, local)

```
node scripts/check-perf-budgets.mjs            → exit 0, table printed, "Every bundle budget holds."
node scripts/check-perf-budgets.mjs --budgets=<totalJs=100>   → exit 1,
   "::error::totalJsGzipKb is 3007.8 KB, over its 100 KB budget by 2907.8 KB"
node scripts/check-perf-budgets.mjs --require-dist --dist=<missing> → exit 1
node scripts/check-perf-budgets.mjs --budgets=<version 0>     → exit 1 (schema)
npx tsx --test src/tests/perf-budgets.test.ts                 → 8/8 pass
```

The three failure paths were run, so the gate is proven non-vacuous, not merely present.

---

## 2. #909 / #924 — every decorative percentage bar now shares one clamp

### The defect class (confirmed; #909 fixed two sites in PR #911, the rest were still unclamped)

A track drawn as `style={{ width: `${share}%` }}` breaks in three ordinary ways:

* a refund or a negative net makes the share negative;
* a share above 100 % (a source bigger than the net) overflows its track;
* a division by a zero total, or a missing value, makes it `NaN`.

A browser **drops** an invalid width declaration, the block falls back to `auto`, and the bar fills
the whole track — so a −19 % rebate paints as a 100 % bar while its label says −19.1 %. `Math.max(0,
Math.min(100, NaN))` is still `NaN`, so the clamp used in PR #911 does not cover the third case.

### Sites corrected on this branch

| File | Site | Reachable case |
|---|---|---|
| `src/lib/percentBar.ts` | **new** `clampPercentWidth` / `percentWidthStyle` — finite values unchanged, above max → max, below min → min, non-finite → min | one contract for all bars |
| `components/projects/ProjectsView.tsx` | partner split-rule bar (`rule.percentage`, unvalidated on write — issue #924's UI half) | a rule of −20 or 250 from an API/import |
| `components/platform/settings/TeamSettings.tsx` | seat-capacity bar | `maxSeats` 0/undefined → `NaN` |
| `components/platform/SystemTelemetryPanel.tsx` | bulk-sync bar **and its `…(NaN%)` label** | a 0 progress total |
| `components/charts/ChartDragBrush.tsx` | selection track | an empty report (`0/0` → `NaN`) or a stale/reversed range (negative) |
| `components/inventory/inventoryColumns.tsx` (2), `Inventory.tsx` | integrity and maturity meters | a score outside 0–100 |
| `components/ledger/ReconciliationView.tsx` | match-confidence tube | heuristic score outside 0–100 |
| `components/planning/BudgetManager.tsx`, `projects/ProjectPipeline.tsx`, `ProjectsView.tsx` | progress meters (upper bound only before) | negative progress |
| `components/transactions/PivotView.tsx` | volume bar | negative volume |
| `components/finance/TaxReserveWidget.tsx` (2), `settings/UsagePanel.tsx`, `intelligence/IntelligenceCenter.tsx` | meters | division by zero / out-of-range |
| `components/reporting/{IncomeBySource,ExpenseByCategory}ReportView.tsx` | the two #909 bars | keeps PR #911's behaviour and also covers `NaN` |

Text, the signed percentage, the sorting key and the CSV cell are **unchanged** — only geometry.

### Tests added

| File | What it proves |
|---|---|
| `src/lib/percentBar.ts` + `src/tests/percent-bar-widths.test.ts` | Semantics (unchanged / floored / capped / non-finite → 0, numeric strings, explicit range) **and a scanner** over every `.tsx` under `src/components` that fails when a new `${…}%` width is written without `clampPercentWidth`/`percentWidthStyle`. Includes a non-vacuity case that the pattern really matches the old shape. |
| `src/tests/percent-bar-render.test.tsx` | Rendered boundary for the chart brush: an empty report draws **no** track and no `NaN`/`Infinity` reaches the DOM; a one-of-four selection is still exactly 25 % wide at 25 % offset; a reversed range draws 0 % and a stale range stays inside [0, 100]. |

**Non-vacuity measured:** with the old brush code temporarily restored the suite reports **1 pass /
2 fail**; with the fix, **3/3 pass**.

`src/tests/share-bar-clamp.test.tsx` (Agent #8, PR #911) still passes unchanged — the two report
views render the same `100%` / `0%` widths for the hand-worked Rent/Rebate and Acme/Bob books.

---

## 3. Checks run on this branch (local)

| Check | Result |
|---|---|
| `npx tsc --noEmit` (full project, 2.9 GB heap) | 0 errors |
| `npx eslint` on every changed `.ts/.tsx/.mjs` | 0 errors, 0 warnings |
| `npx tsx --test src/tests/perf-budgets.test.ts` | 8/8 |
| `npx tsx --test src/tests/percent-bar-widths.test.ts` | 7/7 |
| `npx tsx --test src/tests/percent-bar-render.test.tsx` | 3/3 |
| Focused neighbours: `share-bar-clamp`, `team-settings`, `budgets-inline`, `workspace-usage`, `finance-components`, `plain-language-d97` | 34/34 |
| `npm run build` (Vite client + `server.cjs` + `api.cjs`) | passes; sizes above |
| `node scripts/check-perf-budgets.mjs` on that build | exit 0 |
| `npm run check:layers`, `check:tax-tables`, `lint:rule-packs` | not re-run here (untouched); CI covers them |

The whole unit suite and the browser shards are CI's on the PR (owner's 18 Nov rule) — the sandbox
has 2 CPUs, 3.9 GB and no Chromium, so the full suite is not a local gate.

## 4. Not claimed

* No claim about latency budgets: they are unchanged and still measured by the load-test jobs.
* No claim that the visual bar geometry was seen in a browser here (no Chromium in this sandbox);
  the DOM assertions above are the local evidence, and the browser shards are CI's.
* #924's **schema** half (range validation and a sum check on `splitRules`) belongs to AI #1
  (`src/schemas.ts`). Only the rendering half is closed here.
* #923 (shares print `0.0 %` when the period net is negative) is shared money maths
  (`src/lib/reportGenerators.ts`) and stays with AI #1.
