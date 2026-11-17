# Agent #7 (2026-11-17) — Re-verification on `f69e2b4` + 5 Reserved-Lane Patches

**Base:** `origin/main` `f69e2b4ecddd75393f51195c37fd444655731005` ("The first two rows a person needs are commands too (direct browser writes 88 → 86) (#758)")
**Branch:** `arena/985167b2-ledgerflow`
**Prior:** PR #753 (Agent #7 2026-11-16, 7 direct fixes A7C-01..07, 28 tests) — **merged** `2026-11-17T01:18Z`, now on `main`.
**What this PR carries:** `audit/agent7-2026-11-17/**` (01–06, PR-BODY, 5 patches, 2 probes) — **no `src/server/**` or
`supabase/migrations/**` edits on the branch** (reserved lane — patches are proposals for AI #1).
**CI:** `tsc` clean, `lint:eslint` 0/0 (cap 2), `check:layers` pass, bug patterns at/below baseline, 28/28 prior
regression tests pass on `f69e2b4`. `git apply --check` on 5 patches (detached `f69e2b4`) — clean. `probe-08` fails on
unpatched (reproduces), passes with patches 08+10. Full DB gates (`test:rules`, probe-11) were green on `3a4ad7d`'s PG
(same migrations) — a PG-bearing runner should re-check before any patch is merged.

---

## Why This Exists

`f69e2b4` is green by Stage A (W1,W2,W3,W4,W5,W6,W9,W10,W14 Connected/Verified/Browser-tested) — the synthetic-
bookkeeping beta. This session re-verified that prior 7 fixes (A7C-01..07) are still on `main` and green (28/28),
and that the 4 reserved-lane patches proposed on `3a4ad7d` still reproduce on `f69e2b4` and still `apply --check` clean
(plus the carry-forward patch 06, also still clean). No new `src/` changes met the bar for a branch commit without
a product decision — the value is the verified queue + evidence + the launch assessment below.

## The 5 Queued Patches (apply in order 06→08→09→10→11; 11's migration first)

| Patch | Finding | One-Line Defect | Severity |
|---|---|---|---|
| `patches/06-reporting-statement-tb-cashflow-and-unposted-filter.patch` | A7N-07/A7N-08 | Statement FX sums raw cents across currencies, TB hides orphaned lines, cash-flow disposal mis-classified, unposted credits leak | **High** (P0 correctness) |
| `patches/08-group-report-non2dec-translation.patch` | A7N-10 | Group consolidation multiplies whole yen/fils by a major-unit rate → 10–100× misstatement | **High** (P0 for JPY/KWD groups) |
| `patches/09-asset-undo-entry-ownership.patch` | A7N-11 | Asset undo voids whatever entry the asset row points at | **High** (P0 auth/integrity) |
| `patches/10-year-close-draft-trap-and-period-scope.patch` | A7S-01 | Year close permanently traps drafts; 4 period commands reachable by a transaction API key | **High** (P1 data loss + scope) |
| `patches/11-document-ledger-link-and-ticket-visibility.patch` | A7S-03 + ledger-link half of A7S-04 | Any member reads any colleague's ticket; any member (viewer incl.) can relink a document | **High** (P0/P1 access-control) |

Probes: `probes/probe-08-translation-and-api-scope.ts` (no DB — A7N-10 + A7S-01 API scope) and
`probes/probe-11-document-links-and-ticket-visibility.ts` (PG role probe — tickets + document link).
Carry-forward `04-fx-revaluation-asof` (from `e33b3f2b`) still looks open and is the next rebase — see `03`.

## Verification (on `f69e2b4`)

```
tsc --noEmit                                          clean
lint:eslint  (--max-warnings 2)                       0 errors / 0 warnings
check:layers                                           pass (4/4)
bug-patterns vs baseline                               at/below (93/96, 6/12, 1/2, 7/13, 28/81, 48/54, 0/0)
src/tests/agent7-2026-11-16-*.test.tsx                  28/28 pass
git apply --check on 5 patches (detached f69e2b4)      clean (11 server halves; Vault hunk is against 3a4ad7d)
probe-08 on f69e2b4 unpatched                          fails (A7N-10 6700 vs 670000 + A7S-01 scope)
probe-08 with 08+10                                   all assertions held
probe-11 + test:rules on 3a4ad7d PG                    ALL RLS TESTS PASSED (same migrations — re-check on PG before merge)
```

## Launch Assessment (evidence-based)

**CONDITIONALLY READY** — the 14 Stage-A gated workflows are safe on the synthetic beta, but the 5 patches above are
**required** before production bookkeeping (JPYX/JOD/KWD groups, year closes holding drafts, ticket privacy, statement FX
across currencies). A separate product decision remains: viewers can currently read every colleague's salary/ACH — patch 11
ships a read-only `lf_employee_directory` view to move screens onto first, but narrowing the table policy needs your
call because `supabase/tests/rls.test.sql` asserts viewers *can* read it. Details + conditions in `05-FINAL-REPORT-AND-PATCH-INDEX.md` §8.

## Files

- `audit/agent7-2026-11-17/01_INSTRUCTION_SOURCES_AND_CONFLICT_RESOLUTION.md`
- `audit/agent7-2026-11-17/02-CHECKPOINT-02-REVERIFICATION-AND-PATCH-QUEUE.md`
- `audit/agent7-2026-11-17/03-RESERVED-LANE-FINDINGS.md`
- `audit/agent7-2026-11-17/04-VERIFICATION-LOG.md`
- `audit/agent7-2026-11-17/05-FINAL-REPORT-AND-PATCH-INDEX.md` (coverage + honest gaps + launch verdict)
- `audit/agent7-2026-11-17/06-MASTER-RECOVERY-INDEX-ADDENDUM.md`
- `audit/agent7-2026-11-17/PR-BODY.md` (this file)
- `audit/agent7-2026-11-17/patches/06,08,09,10,11` + `audit/agent7-2026-11-17/probes/probe-08,11`

No other `src/` or migration edits. Do not merge until Shmuel reviews — patches are for AI #1 to apply on a staging
branch and verify with a PG.

