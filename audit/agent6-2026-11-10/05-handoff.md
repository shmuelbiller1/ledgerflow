# Handoff — Agent #6 session of 2026-11-10

Written so another agent can continue without this Arena session.

## State right now
| Thing | Value |
|---|---|
| Pin everything was verified against | upstream `main` `dc40739708a013ad080ffb306fe461554a2391fc` |
| Branch with the work | `arena/9bdf6e26-ledgerflow` on `Chaim-Richard/ledgerflow` (pushed; tip at the last commit of this session, see `git ls-remote origin arena/9bdf6e26-ledgerflow`) |
| PR | **not open** — the fork token is refused `createPullRequest`. Open it with the one-click link in `PR-BODY.md` |
| Drive folder | `LedgerFlow-Agent6-2026-11-10` = `1gXiKgFoNYDyHgVO2PEAtyNfPE-GO-rrD` |
| Files in the branch | `audit/agent6-2026-11-10/{00-INDEX,01-checkpoint,02-findings,03-gates,04-scorecard,05-handoff,PR-BODY,README}.md` + `probes/` (**6 test files, 1 python**) |

## What is finished
* Pin reconstruction (the Arena checkout is stale; see `01-checkpoint.md`).
* F-01, F-01b, F-08, F-09, F-10, F-03b, F-02 reproduced with runnable probes (**20/20 assertions pass**).
* F-03 counted by parse (47 of 68 collections without a field allowlist).
* F-04 … F-07 verified from source.
* Gates: `tsc` 0 errors (2,513 files), repo ESLint **0 errors / 42 standing warnings**,
  **all four unit shards: 8,026 tests · 8,007 pass · 10 failing subtests, every one environmental**
  (5 ms-budgets, 4 missing `SYSTEM_SALT`, 1 needs `.git`) — **0 product failures**.

## What is NOT finished
1. ~~Unit shards 2/4, 3/4, 4/4~~ — **done**, see `03-gates.md`. Use `npm run test:shard`
   (which sets `SYSTEM_SALT`), not the bare `tsx` line.
2. **DB-gated suites** — 203 skipped, no Postgres in the sandbox. The F-03 live demonstration and
   S-32's `lf_rules` assertions need a real database.
3. **Browser suites** — not run (no Playwright browsers). **`npm run build` — RUN, PASSES**:
   4,885 modules, 87 precache entries, `build/server.cjs` 6.8 MB + `build/api.cjs` 6.7 MB, exit 0.
4. **#517 / #519** (the other two members of the US-sales-tax family) not reproduced; F-01 covers
   #518's mechanism concretely.
5. **F-02 fix** — the registration-level route matrix is written as a *probe*; promoting it into
   `src/tests/route-policy-coverage.test.ts` (replacing the word-grep) is the real fix and is not
   done. It is a test-only change, inside Agent #6's lane, but it must land with AI #1's server fix
   or the test fails on `main`.
6. **F-09 / F-10 fixes** — both are shaped in `02-findings.md`; neither is implemented (audit lane only).
7. **Not swept**: the ~40 remaining workflows in `docs/DEEP_CODE_AUDIT.md` (AUD-05…AUD-20) were read
   for scope but only AUD-01, AUD-07, AUD-08, AUD-09 and the AF/EG families were re-verified here.

## The gates, in one line each (details in `03-gates.md`)

| gate | result |
|---|---|
| `tsc --noEmit` | 0 errors, 2,513 files |
| repo ESLint | 0 errors, 42 standing `no-explicit-any` warnings |
| unit suite, all 4 shards | **8,026 tests · 8,007 pass · 10 failing subtests, all environmental · 0 product failures** |
| `npm run build` | **passes** (4,885 modules, 26.4 s, `server.cjs` + `api.cjs`) |
| probes | **20/20** (6 files) |
| targeted tax/close/reconcile suites | 120 assertions, 0 fail |
| DB/RLS suites | **NOT RUN** — no Postgres (203 skipped) |
| Playwright | **NOT RUN** — no browsers |

## The one-paragraph summary for Shmuel
Two **P1 tax-reporting defects** are live at `main`: the US state sales-tax return silently drops
sales whose saved place uses `region` instead of `state` (the product's own seeded sample book does
exactly that, so the seeded Texas return reads 0.00), and "Recorded as filed" on the US quarter
screen is not connected to what the server actually filed (one filing marks every state; the server
can only ever file a VAT registration). One **P1-latent** engine defect is reproduced (#161 chains).
The security lane has no cross-workspace hole, but its **evidence** lane is weaker than the
documentation says: 23 of the 33 routes that persist money in their own handler write no audit entry,
"last sign-in" comes from a browser `void addDoc` that the server never writes and that fails silently,
the one server-written sign-in log (`loginAudits`) has no reader and no RLS policy, and three money
routes keep handwritten idempotency records with no status and no request hash. Plus the older gaps:
two `/api/v1/system/*` routes with no middleware, one admin route without an admin check, and 47
collections without a field allowlist. Nothing in the lane lets a non-member read or change another
workspace's books.
