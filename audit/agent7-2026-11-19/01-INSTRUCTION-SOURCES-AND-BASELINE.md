# Agent #7 — 2026-11-19: instruction sources, branch state, conflict resolution

## 1. Sources actually examined (this session)

| # | Source | What was read / used |
|---|---|---|
| 1 | `AGENTS.md` | Tool layers, top-level workspace-scoped collections, absolute totals, plural categories, dynamic role resolution, `isPostable` filtering, bot-review rule. |
| 2 | `CURRENT_WORK.md` | "Start of every session": own PRs first; fast checks before push; batch work; full suite belongs to CI; stage-A status and owner actions. |
| 3 | `CLAUDE.md` | Owner rule: helper AIs push their branch and open a PR; never merge; DB migrations applied only by AI #1. |
| 4 | `docs/COORDINATION.md` | "NOW" rules, "Rules for every helper AI", queue truth, bot-review rule, database-migration rule, **17 Nov rule: file a GitHub issue with reproduction instead of an audit-only PR**, and the latest Messages entries (AI #6, #10, #12, #5). |
| 5 | Root + scoped `src/AGENTS.md`, `src/components/AGENTS.md`, `src/lib/AGENTS.md`, `src/tests/AGENTS.md` | Financial mutations, focused component tests, real call-site assertions, no weakening of gates. |
| 6 | Prior Agent #7 handoffs | `audit/agent7-2026-11-17/01..06`, `05-FINAL-REPORT-AND-PATCH-INDEX.md`, `06-MASTER-RECOVERY-INDEX-ADDENDUM.md`, `audit/agent7-2026-11-16/*`, `audit/agent7-2026-11-13/*`. |
| 7 | Other agents' latest handoffs | `AI10_SESSION_ADDENDUM_2026-11-17.md`, `docs/COORDINATION.md` Messages; used only to avoid duplicated lanes. |
| 8 | GitHub | Open PRs (own: **#882**), PR #882 body/comments/reviews/checks, issues #805/#802/#803/#873/#879/#884/#900/#909/#820/#821-827/#830, and duplicate searches before filing. |
| 9 | Google Drive | Archive folder `1VG4z3otVCVhN2Vmr8jnssok8bIF2J-RK`, session-folder `15St3Aqq7LaQDTcqrtv05nvtF8Nu6gpGn`, canonical `MASTER_RECOVERY_INDEX.md` (`1pTGxQhLdqBvH4sLoR-0MZ0XuvKtTP86F`), prior Agent7 addendum `1E4JHsIa5Nsvz2ATSdv_UHOQkED6jZUl7`. |
| 10 | Baselines and scripts | `package.json` (`--max-warnings 2`, fast-check guidance), `commands-baseline.json`, `supabase/migrations/**`, `scripts/**` (only read). |

## 2. Repo state at session start

- Branch `arena/6540fb3d-ledgerflow`, clean, from `origin/main` **`5eacf71f633f00a5db7ae44d3fdba75b4d3700cf`** ("period commands need the workspace scope (#820); past-date FX revaluation uses that day's documents (#806)").
- Node `v22.22.3`, npm `10.9.8`; `npm ci --ignore-scripts` succeeded; no local PostgreSQL/browser image.
- The 2026-11-17 patches no longer apply cleanly: the code they proposed has largely landed upstream. Re-verification, not blind re-application, was required.

## 3. Conflict resolution

1. **Broad audit mandate vs. reserved lanes.** `AGENTS.md`/COORDINATION reserve `src/server/**`, money, tax, posting and `supabase/migrations/**` for AI #1/AI #9. Resolution: no reserved-lane file was changed. Confirmed live defects were filed as issues #912/#913; already-filed ones (#805/#802/#803/#909) were left with their owners.
2. **Own open PR #882 vs. this Arena branch.** PR #882 (`arena/6499fd1e-ledgerflow`, head `2460d45`, base `bce500c`) is mine from an earlier session. It was inspected first: Gitar **Approved**, Sonar quality gate **Passed**, 26 checks passing / 2 conditional skips, mergeable clean, no inline review threads, no actionable bot request. No push to it was needed or made. The new #873 fix does not touch any of #882's 24 files, so the two branches are independent.
3. **17 Nov issue rule vs. audit-only PR.** New reserved-lane findings go to GitHub issues with evidence; this PR contains a real client fix and focused tests plus the audit register, so it is not audit-only.
4. **Full-suite cost.** Owner's 18 Nov instruction: fast checks before push, full unit/browser shards to hosted CI. Ran type check, scoped ESLint, layers guard and 46 focused tests locally; CI owns the full suite.

## 4. Instruction sources deliberately not re-read

Historical `docs/archive/**` entries and every older agent's patch file were not re-read wholesale; only the items referenced by the current handoffs and by the code paths verified below were consulted.
