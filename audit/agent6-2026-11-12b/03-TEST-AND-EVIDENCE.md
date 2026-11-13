# Agent #6 — tests, gates and evidence, second session of 2026-11-12

Pin `e33b3f2`. Node v22.22.3, npm 10.9.8, 2 vCPU / 3.9 GB. Nothing in this file is an estimate: each line is a
command that ran and its output, or an explicit statement that the gate could not run here.

## 1. Focused suites (run more than once, after every edit)

| Command | Result |
|---|---|
| `NODE_ENV=test npx tsx --test --test-force-exit src/tests/currency-minor-units-reports.test.ts` | **5/5 pass** (before the AF6B-003 fix the part-payment case failed with `67000 !== 33500`) |
| `NODE_ENV=test npx tsx --test --test-force-exit src/tests/ledger-edit-guards.test.ts` | **8/8 pass** (6 originally, +2 after the flag-only refinement) |
| `… src/tests/cash-basis.test.ts … src/tests/sales-reps.test.tsx … src/tests/sales-reps-groups.test.tsx` | **15/15 pass** (neighbours of the changed files) |
| `npx tsc --noEmit -p tsconfig.json` | **0 errors** (run after each commit; 20–24 s) |
| `npx eslint <each touched file>` | **0 errors, 0 warnings** |

## 2. Independent probes (assert today's behaviour, arithmetic computed by hand in the probe)

| Probe | Cases | Result |
|---|---|---|
| `audit/function-audit/probes/af008-641-aging-vs-ledger.ts` | 20 | **20/20 OK** — V7/V8 were DEFECT before this branch (67¢ commission, 1 % cash-basis revenue), now 6,700¢ and 100 % |
| `audit/agent6-2026-11-12b/probes/invariants.ts` | 26 | **all OK** — loans close at zero, depreciation sums to cost − salvage, allocation loses nothing, withholding monotone, FICA cap, minor units |
| `audit/agent6-2026-11-12b/probes/statements.ts` | 11 | **all OK** — TB balances 10,315,500 both sides and 8/8 rows equal their lines; assets 10,075,500 = 17,000 + 10,000,000 + 58,500; P&L net 58,500 = balance-sheet net; cash flow 10,075,500 = bank, 75,500 operating + 10,000,000 financing; GL = TB for all 8 accounts; the void entry counts nowhere |
| `audit/agent6-2026-11-12b/probes/audit-chain.ts` | 7 | **all OK** — clean 5-entry chain verifies; details tamper → `aud_3`, deletion → `aud_4`, reorder → `aud_3`, forged `prevHash` → `aud_4` |

## 3. Build

`npm run build` → **exit 0**, client bundle built in 30.1 s, `build/server.cjs` 6.7 MB, `build/api.cjs` 6.7 MB,
PWA precache 92 entries.

## 4. Full unit matrix

| Run | Result |
|---|---|
| Local `TEST_SHARD=1/4` | ~470 tests, **0 failures** at the point it was stopped (the sandbox took ~25 min and the run was abandoned in favour of CI; not counted as a pass) |
| Local `TEST_SHARD=2/4` | 583 tests, **1 failure**: `R-5: all 151 report views open under 1000 ms` — `reporting/TopPartiesReportView.tsx 1082.38 ms` against the 1000 ms budget. This is the standing 2-vCPU speed-budget flake that reproduces on a clean tree as well |
| Local `TEST_SHARD=4/4` | **0 failures** |
| Local `TEST_SHARD=3/4` | not run (time), covered by CI |
| CI run 43334269305 (fork PR #28) | `Lint, Typecheck, and Database rules` **pass** (this job runs `npm run test:rules` against a real PostgreSQL, so the RLS/migration rules pass on this branch), `Production build` **pass**, `CodeQL` **pass**, `SonarCloud` **pass**, `Produce CycloneDX inventory` **pass** (it failed on the first push — an accidental `node_modules` symlink had been committed; the branch history was rewritten to drop it and the job is green since), browser shards **4/5 pass** (1/5 still running at the time of writing), `Unit tests 1/4` **pass**; `Unit tests 2/4`, `4/4` and 4 of the 6 time-zone shards **failed** |
| CI failure detail | **Not retrievable from this sandbox**: `gh run view --log-failed` and the job-logs API both redirect to `*.blob.core.windows.net`, which is outside the network this session is allowed to reach. Local reproduction of the same shards gives only the R-5 timing failure (2/4) and a clean 4/4, so the CI failures are consistent with the documented speed-budget flake on shared runners — **but that is an inference, not a verified fact**, and it is not claimed as a pass |

## 5. Gates that could not run in this sandbox

| Gate | Why |
|---|---|
| `supabase/tests/rls.test.sql` and the DB-gated suites (`LF_TEST_DATABASE_URL`) | no PostgreSQL, no Docker |
| Playwright (`npm run test:browser`) | no browsers installed |
| `npm run test:rules` locally | no PostgreSQL — CI's "Lint, Typecheck, and Database rules" job does run it and passes |
| Google Drive backup | the Drive connector is disconnected in this session |

## 6. What these results do and do not prove

- **Proved:** the three figures in AF6B-001/002/003 are now correct on worked examples; the new guards live in the
  route handlers and refuse document entries while letting flags through; the reports reconcile to the cent on the
  fixture; the hash chain detects four kinds of tampering; the branch typechecks, lints, builds and passes the
  database-rules job.
- **Not proved here:** that the routes return 409 end to end (needs the DB-gated endpoint tests), that the UI flows
  behind them behave (needs the browser), and that the whole suite is green (CI's unit shards are red on timing
  budgets that also fail locally on this 2-vCPU box, with the logs unreadable from here).
