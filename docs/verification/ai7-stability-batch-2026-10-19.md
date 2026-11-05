# AI #7 — stability batch (19 Oct 2026)

Branch `arena/3125e92e-ledgerflow` (from `48aed6b`). No money calculation, posting, server route,
migration, screenshot baseline or quality budget was changed.

## Done in this batch

| Task | What | Evidence |
|---|---|---|
| F-14 | time zone scan | `src/tests/timezone-scan.test.ts`; the one real hit (API-key default name) now uses `getLocalDateISO()` |
| F-30 | 50-user load test | `perf/load-test.js`, `docs/PERF_LOAD.md` (no run recorded here) |
| F-32 | flaky detector | `src/lib/flakyReport.ts`, `scripts/flaky-tests.ts`, `.github/workflows/nightly-stability.yml` |
| F-33 | connection pool notes | `docs/DB_POOLING.md` (settings read from `pgFirestore.ts`) |
| F-34 | uptime check | nightly workflow `uptime` job (skips cleanly when `HEALTH_URL` is unset) |
| F-35 | log redaction | `src/lib/logRedaction.ts`, wired into `errorTracker.sanitizeText`; 5 tests |
| F-36 | release notes | `src/lib/releaseNotes.ts`, `scripts/release-notes.ts`; 6 tests |
| F-37 | importer fuzzing | `src/tests/fuzz-importers.test.ts` (12 targets × 150 runs) — **found and fixed** the MT940 impossible-date defect |
| F-38 | perf budgets | `perf/budgets.json`, `npm run check:perf-budgets` |
| F-39 | scorecard | `docs/SCORECARD.md`, `scripts/scorecard.ts`, `npm run scorecard:update` |
| F-40 | layer guard | `src/tests/layers-guard.test.ts` (lib ∤ components; lib/components ∤ server except the shared pure `src/server/reports/`) |
| F-41…F-45 | browser journeys W2/W3/W4/W6/W9 | `e2e/journeys-w2-w9.spec.ts`; see `docs/verification/ai7-journeys-w2-w9.md` |

## Defect found by the fuzz run

`parseMT940Statement(':61:991332C123,45NTRF')` returned a line dated `2099-13-32` — 13 months and
32 days — which the import preview would have accepted as a real bank line. The parser now validates
`YYMMDD` with the existing `bankStatementDate` helper and refuses the file: *"MT940: the statement
line date \"991332\" is not a real calendar date (expected YYMMDD)."* The existing integration test
(`integrations-formats.test.ts`, two real statement lines) still passes unchanged.

## Checks run here

- `npm ci` — clean
- `npx tsc --noEmit` — clean
- `npx eslint . --max-warnings 210` — 0 errors, 210 warnings (cap unchanged)
- `npm test` — **2,949 pass / 0 fail / 1 skipped** (738 suites; the skip is the database suite,
  which needs `LF_TEST_DATABASE_URL`, so `test:rules` runs on GitHub)
- Structural guards pass: quality ratchet (baseline untouched), orphan modules, screen help,
  capabilities, ledger collections, bug patterns, money format, table a11y, allowed fields, schema drift
- `npm run check:perf-budgets`, `npm run release:notes` — run and produce their output
- Not run here: Playwright (no browser download in this sandbox) and the Postgres/RLS suite; both
  run on GitHub CI for this branch, including the five new journey specs

## Limits stated plainly

- `perf/load-test.js` has not been run: no server and no disposable workspace here. `docs/PERF_LOAD.md`
  says so.
- F-34 skips itself when the `HEALTH_URL` repository variable is missing rather than failing.
- F-35 covers the browser crash reporter. `src/server/utils/logger.ts` is AI #1's file and still
  writes the fields its callers pass; server-side redaction is handed off, not claimed.
- The nightly workflow is additive: it does not refresh screenshots, change assertions or merge.
