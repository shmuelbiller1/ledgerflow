# Handoff — Agent #6 session of 2026-11-10

Written so another agent can continue without this Arena session.

## State right now
| Thing | Value |
|---|---|
| Pin everything was verified against | upstream `main` `dc40739708a013ad080ffb306fe461554a2391fc` |
| Branch with the work | `arena/9bdf6e26-ledgerflow` on `Chaim-Richard/ledgerflow` (pushed, tip `f738db5e`+) |
| PR | **not open** — the fork token is refused `createPullRequest`. Open it with the one-click link in `PR-BODY.md` |
| Drive folder | `LedgerFlow-Agent6-2026-11-10` = `1gXiKgFoNYDyHgVO2PEAtyNfPE-GO-rrD` |
| Files in the branch | `audit/agent6-2026-11-10/{01-checkpoint,02-findings,03-gates,04-scorecard,05-handoff,PR-BODY}.md` + `probes/` (4 test files, 1 python) |

## What is finished
* Pin reconstruction (the Arena checkout is stale; see `01-checkpoint.md`).
* F-01, F-08, F-03b, F-02 reproduced with runnable probes (**14/14 assertions pass**).
* F-03 counted by parse (47 of 68 collections without a field allowlist).
* F-04 … F-07 verified from source.
* Gates: `tsc` 0 errors (2,513 files), repo ESLint **0 errors / 42 standing warnings**,
  unit **shard 1/4 = 4,583 tests · 4,576 pass · 2 environmental fails**.

## What is NOT finished
1. **Unit shards 2/4, 3/4, 4/4** — shard 2/4 was still running when this was written
   (≈500 subtests in, 0 failures). Log: `/tmp/shard2.log` (session-local, not archived).
2. **DB-gated suites** — 203 skipped, no Postgres in the sandbox. The F-03 live demonstration and
   S-32's `lf_rules` assertions need a real database.
3. **Browser suites, build** — not run.
4. **#517 / #519** (the other two members of the US-sales-tax family) not reproduced; F-01 covers
   #518's mechanism concretely.
5. **F-02 fix** — the registration-level route matrix is written as a *probe*; promoting it into
   `src/tests/route-policy-coverage.test.ts` (replacing the word-grep) is the real fix and is not
   done. It is a test-only change, inside Agent #6's lane, but it must land with AI #1's server fix
   or the test fails on `main`.

## The one-paragraph summary for Shmuel
Two **P1 tax-reporting defects** are live at `main`: the US state sales-tax return silently drops
sales whose saved place uses `region` instead of `state` (the product's own seeded sample book does
exactly that, so the seeded Texas return reads 0.00), and "Recorded as filed" on the US quarter
screen is not connected to what the server actually filed (one filing marks every state; the server
can only ever file a VAT registration). One **P1-latent** engine defect is reproduced (#161 chains).
The security lane is in good shape: the only real gaps are two `/api/v1/system/*` routes with no
middleware, one admin route without an admin check, and 47 collections without a field allowlist.
Nothing in the lane lets a non-member read or change another workspace's books.
