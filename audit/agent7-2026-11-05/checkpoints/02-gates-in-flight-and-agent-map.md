# Agent #7 — Checkpoint 02: gates in flight, agent map, coordination claim

**When:** 2026-11-05 about 21:10 UTC (the sandbox was suspended for ~9 h between my turns; clocks in logs jump from 11:27 to 21:01, nothing was lost).
**Branch:** `arena/8b539c5d-ledgerflow` (fixed by Arena; never switched). **Code pin:** upstream `main` = `7896cbdcbba520f71614a3445b963b1c88d497bb` (5 Nov, PR #513 merge).
**My HEAD before this commit:** `947b43f8a861134e1a6b41756c885465a9b9a177` (merge of upstream/main into my branch). `git diff upstream/main HEAD` is empty apart from files under `audit/agent7-2026-11-05/`.
**Source identity:** upstream `28b90c2e` (my gate start) → `7896cbdc` changed only `docs/LINE_COUNT.md` and added `src/tests/references-targeted-reads.test.ts`. So every gate result below at `28b90c2e` applies to the same source at `7896cbdc`. The one new test file is run separately (see the test report).
**Nothing merged. No application, money, tax, server, migration or `main` change by me.**

## 1. Who is doing what (so nobody repeats work)

| Agent / session | Branch (fork `Chaim-Richard/ledgerflow`) | What it holds | Status I verified |
|---|---|---|---|
| Agent #6 | `arena/fbffc90a-ledgerflow` (`f3aaaaf3`) | Orientation note only (`audit/agent6-session-assessment-2026-11-05.md`). No tests run. | on GitHub |
| Agent #8, session A (11:15–11:18 UTC) | `arena/51f250b7-ledgerflow` (`5ebcf078`) | Bounded report: 3 files under `audit/agent8-*`; re-confirmed #161 with the AF-012 probe; asked others to re-check open issues #342 #274 #160 #146 #143 #141 #131 #130 #96 #150 against current code and to run the full unit suite with a real DB. | on GitHub |
| Agent #8, session B ("2033", 20:33–20:53 UTC) | `arena/6984648e-ledgerflow` (`42629a03`) | Recovered the Drive-only AF-004 slice onto GitHub, reproduced three tax-return mechanisms, wrote `audit/agent8-2026-11-05-session-2033/*`, `audit/function-audit/AF-004-tax-authority.md`, two acceptance test files (12 tests: 6 pass / 6 intentional failures). **Filed upstream issues #517 (first-line entity label ignored), #518 (US buyer with no state silently omitted), #519 (issued invoice's saved TX destination ignored after the customer moves).** Ran tsc, ESLint, build and the RLS suite on Node 24 (all exit 0). Did NOT run the full unit suite. | on GitHub + Drive (zip `checkpoint-b92b0afb`) |
| **Agent #7 (me)** | `arena/8b539c5d-ledgerflow` | Gates at the pin, the full DB-backed unit suite (4 shards), re-verification of the 12 open issues and prior findings against current code and tests, route-by-route sign-in sweep of the real app, Y-35 tax-rounding fuzz, doc-accuracy defects, delta review of the 193 commits since `a7c20385`. | in progress |

**Claim (please do not repeat these):** (a) the complete unit suite against a real PostgreSQL 17.11 on Node 22.22.3, then again on Node 24 for CI parity; (b) re-verification of the 12 open upstream issues and the prior AF-0xx findings; (c) the route sign-in sweep; (d) the Y-35 fuzz. I will not touch AF-004 (Agent #8 owns it; #517–#519 are theirs) and I will not edit `docs/COORDINATION.md` (Agent #8 session B already appended a handoff there; a second append would conflict when merged).

## 2. Verified so far (executed by me; logs in `audit/agent7-2026-11-05/evidence/`)

| Check | Result |
|---|---|
| `npm run lint:types` (tsc) | exit 0, 55 s (Node 22.22.3) |
| `npm run lint:eslint` | exit 0, **0 errors, 42 warnings = exactly the cap `--max-warnings 42`**; all `no-explicit-any` in `src/server/**` |
| `npm run db:test-setup` on a disposable PostgreSQL 17.11 (UTF8, not Supabase) | stub + all **51** migrations apply |
| `npm run test:rules` | `ALL RLS TESTS PASSED` |
| Unit suite shard 1 of 4 (real DB, so DB-gated suites ran) | **1279 tests, 1279 pass, 0 fail, 0 skipped**, 394 s |
| Agent #8's AF-004 probe (Drive `17c0BOyF…`), re-run verbatim by me | output identical to theirs: P1 P2 P3 P4 P6 P7 P8 DEFECT, P5 control OK (`evidence/06-af004-probe-agent8-rerun.txt`) |
| Y-35 tax rounding fuzz (`probes/y35-fuzz.ts`): 400,000 random documents × 3 modes | every property held: parts add up, net + tax = gross when inclusive, no negatives, integers, `half_up` identical to the pre-Y-35 algorithm, `down` never above exact. Positive control: `down` differs from `half_up` in 14,287 of 28,572 cases, `half_even` in 18. |
| Quality ratchets since `a7c20385` | `suppressionCount` 3 → 0, `max-warnings` unchanged at 42, no test file deleted (875 → 928 in `src/tests`), no `.only`; every added `skip` is the DB-gate pattern |

## 3. Observations that are NOT yet verified (kept separate on purpose)

1. **A green `npm test` without `LF_TEST_DATABASE_URL` hides about 22 % of the suite.** 204 of 942 test files have a DB skip guard. Agent #8 session B noticed the runner can print "0 skipped" while a skipped suite is listed. Any pass count from a sandbox without a database says nothing about those files (L-123 step 4 routes, AUD-09 write routes, give-access, customer groups, payment types, numbering, RLS-adjacent tests).
2. Migrations newer than the "recorded applied" set of the 28 Oct list: `20261027000000_server_fields_allowed`, `20261101000000`, `20261102000000`, `20261102010000`, `20261102020000`, `20261102030000` (plus the three the owner still has to confirm). I cannot see Supabase; whether they are applied in the tester deployment is unknown.
3. Plaid connection binding (`plaidIngest.plaidAccountFor`): the Plaid account a ledger account stands for is never chosen at link time; it is inferred from the first sync's rows. For a bank login with several accounts the rows get no ledger account (stored for review), and a later one-account sync can pin the wrong one. Design limit, not a data-corruption path; needs a product decision.
4. `src/server/routes/plaidWebhookRoutes.ts` `keyCache` never evicts a verification key (mitigated by the 5-minute `maxTokenAge`).
5. `audit/FINAL_ACCURATE_LIST_2026-10-29.md` §3 describes several issues under titles that do not match GitHub (e.g. #143 is listed as "December weekly-balance off-by-one" but is "P1 RMA workflow: enforce approvals and cumulative quantities atomically on server"; #444 as "Conflicting cutover rules" but is "BudgetLeft: preserve locked originals"); it also says 14 open issues, now 12. Details in the final list.

## 4. Remaining work (in order)

Shards 2–4 and the build (running); Node 24 repeat; route sign-in sweep; probes `af011-date-contracts.mjs`, `af012-*.mjs`; `bug-patterns` and atlas; per-issue re-verification; final list, test report, README, PR; Drive uploads with md5 read-back.

## 5. Recovery (another agent can resume from here)

```sh
git clone https://github.com/Chaim-Richard/ledgerflow.git && cd ledgerflow
git fetch origin arena/8b539c5d-ledgerflow && git checkout arena/8b539c5d-ledgerflow   # do not create other branches
git remote add upstream https://github.com/shmuelbiller1/ledgerflow.git && git fetch upstream
HUSKY=0 npm ci --no-audit --no-fund
# disposable database (never a real one): see audit/agent7-2026-11-05/tools/ (embedded-postgres 17, or docker postgres:17)
export LF_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/lf_test DATABASE_URL=$LF_TEST_DATABASE_URL
npm run db:test-setup && npm run test:rules
for i in 1 2 3 4; do NODE_ENV=test SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic npx tsx --test --test-concurrency=2 --test-shard=$i/4 src/tests/*.test.ts src/tests/*.test.tsx src/lib/*.test.ts src/server/utils/*.test.ts; done
```
Do not run the unsharded `npm test` (it exceeded 30 minutes for earlier agents). The repo wants Node 24 (`engines`); get it without root with `npm exec --yes --package=node@24 -- <command>`.

Drive folder: https://drive.google.com/drive/folders/1VG4z3otVCVhN2Vmr8jnssok8bIF2J-RK (id `1VG4z3otVCVhN2Vmr8jnssok8bIF2J-RK`).
