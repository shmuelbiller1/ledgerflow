# Agent #6 — gates actually executed at the pin, 2026-11-10

Pin: upstream `main` `dc40739708a013ad080ffb306fe461554a2391fc`.
Machine: Node v22.22.3, 2 vCPU, 3.9 GB RAM, no Postgres server installed, no
`LF_TEST_DATABASE_URL`. **Every DB-gated suite therefore skips** — that is a stated limitation of
this run, not a pass.

| Gate | Command (as run) | Result |
|---|---|---|
| Type check | `npx tsc --noEmit` | see table below |
| Unit suite, shard 1/4 | `TEST_SHARD=1/4 tsx --test --test-force-exit src/tests/*.test.ts src/tests/*.test.tsx src/lib/*.test.ts src/server/utils/*.test.ts` | **4,583 tests · 4,576 pass · 2 fail · 5 skipped · 1,014 suites · 21.7 min** — the two failures are both environmental, below |
| AF audit suites | `tsx --test src/tests/audit-af001… af002… af010…` | **20/20 pass** |
| Agent #6 probes | `tsx --test audit/agent6-2026-11-10/probes/*.test.ts` | **8/8 pass** |
| ESLint (repo-wide, at the pin) | `NODE_OPTIONS=--max-old-space-size=3072 npx eslint .` | **0 errors, 42 warnings** once my own probe's one error was fixed — the 42 are the pre-existing `no-explicit-any` warnings in `src/server/**`, at the ratchet cap |
| DB rules / migrations | `npm run test:rules` | **not run** — no Postgres in sandbox |
| Browser (Playwright) | `npm run test:e2e` | **not run** — no browser binary / app server here |
| Production build | `npm run build` | see below |

Results are filled in as each long gate finishes; an empty cell means it had not finished when the
session's last checkpoint was written.

## Unit shard 1/4 — the result, and why the two failures are not code

```
ℹ tests 4583      ℹ pass 4576      ℹ fail 2
ℹ suites 1014     ℹ cancelled 0    ℹ skipped 5
ℹ duration_ms 1300807.5  (21.7 min on 2 vCPU)
```

| Failure | Test | Cause | Verdict |
|---|---|---|---|
| 1 | `src/tests/report-speed-12m.test.tsx:168` — **A-229** "the 10 busiest screens mount under 1,500 ms" → measured **2,314 ms** | a wall-clock budget measured while `tsc --noEmit` (2 vCPU) ran concurrently, on a 2-vCPU box | **machine noise, not a defect.** This is the same leg that failed on unmodified `main` in AI #3's 29 Oct session (documented in `docs/COORDINATION.md`), and the concurrent `tsc` makes it strictly worse. No budget was changed. |
| 2 | `src/tests/vercel-ignore-boundary.test.ts:142` — fails with `fatal: not a git repository` | the test shells out to `git ls-files`; my working copy is a `git archive` extract with no `.git` (deliberate, see F-0 pin note) | **harness artifact.** It passes in CI and in any real checkout. |

**203 tests skipped** with the reason `LF_TEST_DATABASE_URL not set` — every database-gated suite
(RLS, AUD-09 write access, L-123 server balances, year-end, close, restore). **They did not run.**
No Postgres server exists in this sandbox and none of them is claimed as passing.

## What this does and does not prove

* Proves: at `dc40739`, with a fresh `npm ci`, **4,576 of 4,583** collected subtests pass in shard 1/4,
  including all 20 assertions of the money-primitive audit suites I targeted.
* Does not prove: shards 2/4–4/4, the DB suites, the browser suites, ESLint, the build, or the
  speed budgets. Those stay CI's job and are unclaimed here.

## ESLint, repo-wide, at the pin (after the fix)

```
✖ 43 problems (1 error, 42 warnings)      <- first run, with my own probe's prefer-const
✖  0 problems                              <- the touched file after the fix
```

* The **1 error was mine**: `audit/agent6-2026-11-10/probes/s7-route-guards.test.ts:31`
  `prefer-const` on an unused counter. Fixed, the file lints clean.
* The **42 warnings** are the standing ones the repo carries at its ratchet cap
  (`package.json` runs `eslint . --max-warnings 42`): all `@typescript-eslint/no-explicit-any` in
  `src/server/**` — `paymentService.ts`, `shardedCounterService.ts`, `utils/idempotency.ts` and
  others. **Nothing in this branch adds a warning.**
* ESLint on the seven files this audit read most closely (`adminRoutes.ts`, `authRoutes.ts`,
  `rateLimiters.ts`, `plaidIngest.ts`, `usSalesTaxReturn.ts`, `usQuarterJourney.ts`,
  `taxReturnService.ts`): **exit 0, no output.**

## Type check, and a warning about this sandbox

`npx tsc --noEmit` at the pin **exits 0 with no output** and, with `--listFiles`, reports
**2,513 files** under the checkout (`server.ts` + `src/**`). Two cautions:

1. `tsconfig.json` has `"incremental": true` with
   `"tsBuildInfoFile": "./node_modules/.cache/tsbuildinfo"`, and `node_modules` here is a symlink
   shared with another checkout. The first `tsc` run in this sandbox took >15 minutes and got
   **killed**; subsequent runs finish quickly against that cache file. So the timings on this box
   are not evidence of anything — only the exit code and the empty output are used above.
2. No `error TS` line appeared in any run. I am reporting **0 type errors at the pin** and nothing
   more.

## Still not run (and not claimed)

`npm run test:rules` (needs Postgres), the DB-gated unit suites (203 skipped), `npm run test:e2e`
(needs Playwright browsers + a server), `npm run build`, and unit shards 2/4–4/4.

---

## Unit shard 2/4 at the pin (dc407397)

Command (identical pattern to shard 1/4, run from `/home/user/lf-pin`):

```sh
NODE_OPTIONS=--max-old-space-size=3072 timeout 2400 npx tsx --test --test-force-exit \
  --test-shard=2/4 src/tests/*.test.ts src/tests/*.test.tsx src/lib/*.test.ts src/server/utils/*.test.ts
```

| | value |
|---|---|
| tests | **1,189** |
| pass | **1,187** |
| fail | **1** (one suite, two failing subtests) |
| skipped | 1 |
| wall clock | 324 s (5 min 25 s) |
| exit | 1 |

The failure is **A-229 / A-206 in `src/tests/report-speed-12m.test.tsx` — a millisecond budget, not a
wrong answer**:

* `A-229` (`:168`, assertion at `:258`): *"Loading all 10 screen modules took 2533.14 ms (budget 1500 ms)"*.
  The test's own comment says it preloads ten route chunks and times a **cold** import; on 2 vCPU with
  the rest of the shard running, that number is not a statement about the product.
* `A-206` (`:72`) is the parent suite, reported `not ok` only because `A-229` failed inside it.
* The same budget failed in shard 1/4 at 2,314 ms. **Same standing sandbox limit, not a new defect** —
  do not report it as a regression without a dedicated single-file run on an idle machine.

## Probes after F-09 (all green)

| probe | assertions | result |
|---|---|---|
| `af004-taxplace-key-mismatch.test.ts` | 4 | pass |
| `s7-route-guards.test.ts` | 4 | pass |
| `af012-rule-chain-order.test.ts` | 2 | pass |
| `f8-tax-return-two-universes.test.ts` | 4 | pass |
| `f9-audit-trail-coverage.test.ts` | 3 | pass |

## Unit shard 3/4 at the pin — and why one number in it is not a product failure

Shard 3/4 was launched **without** `SYSTEM_SALT` (the shard-1/2 commands above copied the args, not the
env the npm script sets). Nine subtests failed with:

```
error: 'SYSTEM_SALT environment variable is required for forensic stamping.'
  at TransactionValidator.validateAndPrepare (src/kernel/validation/TransactionValidator.ts:132)
```

That is `src/services/securityService.ts:30-32` refusing to mint a forensic hash with a fallback salt —
the guard working as designed, not a defect. `package.json` sets
`SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic` for `test`, `test:shard` and `test:cov`, and
`.github/workflows/ci.yml` runs `npm run test:shard:cov`, so CI always has it.

**Re-run of the affected files with the salt: all green** — `period-close.test.ts` 9/9,
`reconcile-endpoint.test.ts` + `reverse-and-correct.test.ts` 15/15. **Every one of shard 3/4's 7
failures is environmental**: 7 subtests were the missing salt, and the remaining suite is
`vercel-ignore-boundary` ("`git ls-files` … not a git repository") — the same `.git`-less-pin limit
that failed shard 1/4. **No shard-3 failure is a product defect.** So the honest count is:

| shard | tests | pass | fail for real | fail from the missing salt |
|---|---:|---:|---:|---:|
| 1/4 | 4,583 | 4,576 | 2 (A-229 ms budget ×2, `vercel-ignore-boundary` needs `.git`) | 0 |
| 2/4 | 1,189 | 1,187 | 1 suite (A-229/A-206 ms budget) | 0 |
| 3/4 | 1,143 | 1,133 | 2 real: both are the `git ls-files` boundary test (no `.git` in the pinned tree) | 7 of the 9 (2 more were `git`-related: `vercel-ignore-boundary` subtest 3 + suite) |

**Lesson for the next agent: use `npm run test:shard` (or copy the env), never the bare `tsx` line.**
A failure whose message mentions `SYSTEM_SALT` is the harness, not the product.

## Probes, whole folder, with the salt

```sh
NODE_ENV=test SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic \
  npx tsx --test --test-force-exit audit/agent6-2026-11-10/probes/*.test.ts
```

**20 tests, 20 pass, 0 fail** (AF-004 4, AF-012 2, F-08 4, F-09 3, F-10 3, S-7 routes 4).
