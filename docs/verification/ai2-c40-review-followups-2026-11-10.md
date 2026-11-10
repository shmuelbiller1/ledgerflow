# AI #2 — C-40 review follow-ups, 10 November 2026

**Code pin:** `dc40739708a013ad080ffb306fe461554a2391fc` (`main`, branch `arena/a43d823e-ledgerflow`).
**Scope:** review follow-ups on my merged PR **#570** (C-40 Israel VAT Report), delivered as **PR #601**. No money, posting,
tax-rate, server, schema, migration or dependency change; `israelVatReturn`, `withEquipment`,
`ilVatRegistrations` and `computeTaxReturn` are read, not modified. The screen is still
calculation/planning only — it does not file, pay or convert currencies.

## Why this pass exists

PR #570 was merged on 9 November with **seven unresolved bot findings**, a **failed SonarCloud
quality gate** and **nine failed CI jobs** at its head `7078430`. `main` is green again, but the
review findings were never answered in code. This pass answers every one of them with a regression
test, and records the CI/Sonar root cause so it is not lost.

| Bot / finding on #570 | Verified at the pin | Fix | Regression test |
|---|---|---|---|
| Codex P1 — hard-coded `ILS` labels home-currency figures | `const currency = 'ILS'` in the panel while `israelVatReturn` returns `workspace.currency` cents | View passes `workspace?.currency || 'USD'`; panel defaults to ILS only for standalone renders; CSV amount column is `ilVatReportCsvHeaders(currency)`; a non-ILS workspace sees a "filed in ILS, no conversion" notice | `labels a non-ILS workspace with its own base currency, not shekels`, `CSV amount column names the workspace currency, not NIS` |
| Codex P2 — fabricated `vat:IL:default` showed a zero-liability report | `selectedReg \|\| registrations[0]?.registration \|\| 'vat:IL:default'` | `activeReg` is only a real, in-force registration or `''`; no registration ⇒ no report, no CSV, explicit configuration message | `shows a configuration state when no Israeli VAT registration exists` |
| Codex P2 + CodeRabbit Minor — stale selection after the period changes | `selectedReg` was used even when it dropped out of `registrations` | `activeReg` is derived from the current `registrations` list; the `<select>` value can never name an option that is not listed | `falls back to an available registration when the period drops the selected one` |
| Codex P2 — chart of accounts missing from data readiness | `useLedgerCollections` asked for 4 document lists only; `partial` ignored `failed.accounts` / `truncated.accounts`, although `withEquipment` needs accounts | Ask for `accounts` too; account failure/cap makes the report provisional and disables CSV | `treats a failed or capped chart of accounts as provisional and blocks CSV` |
| CodeRabbit Minor — mixed-bill notice counted other periods/registrations | `mixedBillsCount={mixed.length}` over the entire bill list | `countedMixedBills` uses the same counted-purchase status, period, seller profile and registration as `computeTaxReturn`; the full list is still passed to `withEquipment` for vendor credits | `counts only mixed bills that the selected return actually includes` |
| CodeRabbit Minor — CSV used `(cents / 100).toFixed(2)` | Division loses a cent at very large integer magnitudes | `csvMoney` from the shared CSV writer; new JSDoc on both exported helpers | `produces correct CSV export rows` (large-cent and reclaim assertions) |
| CodeRabbit Trivial — no CSV test for a negative `toPayCents` | Only the pay branch was asserted | Added the reclaim branch assertion | same test |
| CodeRabbit Trivial — unverified `workspaceExports` consumer claim | The comment said the view "consumed this re-export" | Reworded: the view imports `tax/ilVatReturn` directly; the re-export keeps the helper reachable | source read, no test needed |
| CodeRabbit pre-merge — docstring coverage 33% on new functions | Functions with complexity ≥2 lacked JSDoc | JSDoc on `IsraelVatReportPanel`, `ilVatReportCsvHeaders`, `ilVatReportCsvRows`, `countedMixedBills` | source check |

**Already answered before this pass:** the three 05:10 CodeRabbit findings (`.csv` filename,
disable CSV while provisional, restore `window.print` in `finally`) were fixed by the autofix
commit `4376cab` on #570. They are re-verified present at the pin and kept by the new tests.

## CI and Sonar root cause (recorded, not re-broken)

- PR #570's head had **two `REPORT_TAB_IDS` string literals** in `src/config/routeIds.ts`; the
  second was a bare `"…".split(' ')` expression. SonarCloud's **C Reliability Rating on New Code**
  was the single `typescript:S2201` bug at `routeIds.ts:31` ("The return value of `split` must be
  used"), queried from the public SonarCloud issues API for PR 570. It also broke the report-ID
  parity test and the production build's bundle invariants — that is why **unit shards 1/4 and
  4/4, the timezone shards, the coverage gate and Production build** failed at `7078430`.
- PR **#576** ("Fix main: duplicate report-ID list and missing help page after #570") removed the
  duplicate. At the pin, `src/config/routeIds.ts` has one clean `REPORT_TAB_IDS` and SonarCloud
  reports **0 open BUG issues** for `shmuelbiller1_ledgerflow`. All 22 checks at `dc40739` are
  green (CI, CodeQL, SBOM, ESLint ratchet, SonarCloud, all unit/browser shards, build).
- **Vercel preview red is the owner's paused deployment for usage, not a code problem.** The
  preview check on #570 was actually "Ready"; it is not treated as a code gate here.
- **Open issue #599** (raw conflict markers in `audit/FINAL_ACCURATE_LIST_2026-11-08.md`) was
  confirmed by source read but deliberately **not patched** here: Agent #7's 10 Nov PR owns that
  fix and superseding list. This pass's final list is a distinctly named AI #2 slice.

## Local checks

| Check | Result |
|---|---|
| `npm ci` | first attempt hit `ECONNRESET`; retry with 8 fetch retries succeeded, 1208 packages |
| `npm run lint:types` (`tsc --noEmit`) | clean, 0 errors |
| `npm run lint:eslint` | **0 errors / 42 warnings** (at the unchanged cap; no new warning) |
| `npm run build` | clean — `dist/`, `build/server.cjs`, `build/api.cjs` produced |
| focused `src/tests/israel-vat-report-view.test.tsx` | **14/14** (7 pre-existing + 7 new) |
| full `npm test` | **4583 / 4589 pass**, **1 fail**, 5 DB skips (`LF_TEST_DATABASE_URL` unset), 0 cancelled. The single failure is the known A-229 cold module-preload leg in `src/tests/report-speed-12m.test.tsx` ("Loading all 10 screen modules took 2653.47 ms, budget 1500 ms"). **Proven pre-existing:** the same focused file on unmodified `main` at `dc40739` failed at 2655.86 ms; with this branch's changes it fails at 2379.65 ms (faster, still over the sandbox's budget). Not caused by this change; the budget was not touched. |
| related guards (`registry-components`, `stage6-footprint`, `ledger-collections-guard`, `screen-help`, `reachability-guard`) | **20/20** |
| `npm run test:rules` / DB-backed gates | not run locally (no `LF_TEST_DATABASE_URL` / Postgres); CI owns them, as COORDINATION allows |
| Chromium browser specs | not run locally (no browser here); `e2e/view-registry-coverage.spec.ts` "Report tab mounts: Israel VAT Report" remains the CI check and only asserts no crash/NaN |

### Non-vacuous regression evidence

Each new behaviour was mutated back to the old code and the focused suite re-run; the suite was
then restored and passed again:

| Mutation | Focused suite |
|---|---|
| `currency = 'ILS'` | 13 pass / **1 fail** |
| old `selectedReg \|\| … \|\| 'vat:IL:default'` | 8 pass / **1 fail** (rest cancelled by the throw) |
| `mixedBillsCount={mixed.length}` | 13 pass / **1 fail** |
| accounts removed from `partial` | 13 pass / **1 fail** |
| `(cents / 100).toFixed(2)` restored | 13 pass / **1 fail** |
| restored working tree | **14 pass / 0 fail** |

## What is explicitly NOT claimed

- No new workflow row in `docs/RELEASE_GATE.md`: this is a truthfulness and review fix on a
  calculation-only screen. W7/W8 statuses are unchanged; no filing-readiness claim.
- No fresh Sonar scan or live-database/browser run by me; the Sonar statement above is a query of
  the public issues API plus source verification, and CI re-runs the gates on this branch.
- Bot comments on other agents' PRs were triaged in
  `audit/FINAL_ACCURATE_LIST_2026-11-10.md`; nothing outside AI #2's screen/report/help lane was
  patched here.

## PR #601 CI

The `pull_request` workflow runs the DB-backed rules, coverage gate, four unit shards, six timezone
shards, five browser shards, CodeQL and the production build — the gates this sandbox cannot run.
Its green run ID and check list are recorded in the PR body and in the session's final answer. The
Vercel preview is excluded from the code gate (owner's paused deployment).
