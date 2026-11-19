# D-43 — which CI tests failed, and which failed then passed (report only, nothing skipped)

**Agent:** #4 (Arena, `arena/1465d4c1-ledgerflow`) · **Date:** 2026-11-19 · **Task:** D-43
"Flaky test quarantine report from the last 30 CI runs, which tests failed then passed; a report, no
skipping."

This is a **report**, not a change: no test was skipped, quarantined, weakened or re-run away. Raw
evidence: [`ci-failures-2026-11-19.json`](../../audit/agent4-2026-11-19/ci-failures-2026-11-19.json).

## Method (reproducible)

```bash
gh api "repos/shmuelbiller1/ledgerflow/actions/workflows/ci.yml/runs?per_page=100&status=completed" \
  --jq '.workflow_runs[] | [.id,.conclusion,.created_at,.head_branch,.head_sha] | @tsv'
# for each failed run: the commit's failed check-runs, then each one's annotations
gh api "repos/shmuelbiller1/ledgerflow/commits/$SHA/check-runs?per_page=100" \
  --jq '.check_runs[] | select(.conclusion=="failure") | [.id,.name] | @tsv'
gh api "repos/shmuelbiller1/ledgerflow/check-runs/$ID/annotations" --jq '.[] | .message'
```

Test names come from the annotations the unit shards and browser shards publish (`✖ <test>` and
`<spec>.spec.ts › <test>: Error:`). Job **logs** are served from Azure blob storage, which this
sandbox cannot reach, so no log line was read — every statement below rests on annotations, run
conclusions and timestamps.

**Sample:** the 100 most recent **completed** `CI` runs at 2026-11-19 ~20:45 UTC —
**35 success, 16 failure, 49 cancelled** (cancelled = superseded by a newer head, not a failure).
That is more than the "last 30 runs" D-43 asked for, and it is the sample used here.

## What failed, and what happened next

"Green later" = a later run on the **same branch** in the sample succeeded.

| Run (UTC) | Branch | Later green on that branch | Named failures |
|---|---|---|---|
| 02:55 | `arena/6e749e1a` | 17:18 | browser shard 4/5, SonarCloud, rollup — no test name annotated |
| 03:05 | `arena/c2f61ba0` | 03:49 | browser shard 1/5 — no test name annotated |
| 03:15 | `arena/b1245963` | 18:04 | Purchases translation guard; `Vault.tsx` shared-file rule (3) |
| 03:16 | `arena/5f427008` | 17:31 | Lint/Typecheck/DB rules (exit 1) |
| 03:19 | `arena/0d3d392a` | 17:31 | truncation key space, on-demand collections (×2), H-8 date guard (7) |
| 03:33 | `arena/c2f61ba0` | 03:49 | browser shard 1/5 — no test name annotated |
| **06:01** | **`main`** | **15:28** | **`share-bar-clamp` class (11 annotations: "share bars clamp to [0,100]", the two bar tests, plus Hebrew H-1 visual baselines)** |
| 15:06 | `arena/145e7090` | 16:39 | same share-bar tests + 8 H-1 Hebrew visual baselines |
| 15:11 | `arena/fc785ac7` | **none** | same share-bar tests + 8 H-1 Hebrew visual baselines |
| 15:29 | `arena/8eb33ff8` | 15:56 | browser shard 1/5 — no test name annotated |
| 16:36 | `arena/6e749e1a` | 17:18 | `ui-language-sales.spec.ts` Hebrew Sales RTL (390 px) |
| 16:39 | `arena/b1245963` | 18:04 | Purchases translation guard; `Vault.tsx` shared-file rule (3) |
| 16:39 | `arena/5f427008` | 17:31 | 2 × `Unexpected any` (ESLint `no-explicit-any`) |
| 17:07 | `claude/…audit-aotyvt` | 17:56 | `ui-language-sales.spec.ts` Hebrew Sales RTL (390 px) |
| 17:44 | `arena/b1245963` | 18:04 | `ui-language-sales.spec.ts` (390 and 1280 px) |
| **18:23** | `arena/b1245963` | **none** | `ui-language-sales.spec.ts` (390 and 1280 px) |

### Recurring names (count over the 16 failed runs)

| # | Test | Branches | Reading |
|---|---|---|---|
| 9 | `Quality Ratchet Suite` / `should not regress against quality-baseline.json` | 0d3d392a, b1245963 | A real ratchet catch while those PRs were in progress (warnings above the cap), green later. **Not a flake.** |
| 9 / 8 | "share bars clamp to [0,100]" and its two cases (`Expense by Category: refund bar…`, `Income by Source: credit bar…`) | 145e7090, fc785ac7, **main** | The #909 test (PR #911) running on commits where the component fix was not there yet. Green later on `main` — i.e. **`main` was red for ~9 h 27 m** (06:01 → 15:28). |
| 8 × 2 | `visual-regression.spec.ts › H-1 Hebrew screen baselines` (`balance-sheet`, `pnl`, `trial-balance`, `vat-report`, `reconcile`) at 1280 **and** 390 px | 145e7090, fc785ac7, **main**, 5f427008 | Reference-image mismatches in the same window as the share-bar failures; green later. The baselines and the rendering changed in parallel branches — the churn is a process risk, not a single test being wrong. |
| 6 | `Purchases: every purchasesText key has its English fallback and Hebrew in the table` | b1245963 | Real guard catch for that PR (PR #925); green later, then **failed again at 18:23**. |
| 4 (2 runs) | `ui-language-sales.spec.ts › Accessibility & language sets Hebrew and Sales uses RTL` (390 px, and at 17:44/18:23 also 1280 px) | 6e749e1a, b1245963, claude/audit | The Hebrew heading `מכירות` did not become visible. **Passed on most other branches**, so it is timing-sensitive, not a wrong expectation (see F-3). |
| 3 | `src/components/forensics/Vault.tsx narrows the address before using it`, `the screens that paint a stored file use the shared rule` | b1245963 | Real guard catch for that PR; green later, **failed again at 18:23**. |
| 3 | truncation key space / on-demand collections / H-8 date guard | 0d3d392a | Real guard catches; green later. |
| 2 | `Unexpected any` (ESLint) | 5f427008 | Real lint failures; green later. |

## Findings

**F-1 — `main` was red for 9 h 27 m on 19 Nov.** The 06:01 run on `main` failed
`src/tests/share-bar-clamp.test.tsx` (three cases) and eight Hebrew H-1 visual baselines; the next
`main` success is 15:28. The share-bar test was added by PR #911 for issue #909; a test that lands
while its component fix is absent (a split merge, or the test merged ahead of a revert) makes `main`
red for everyone. **Process recommendation:** when a PR adds a guard test and its fix, they must be
in the same commit; a merge queue or requiring the PR's own CI on the merged result (which this repo
does) is the check that would have caught it.

**F-2 — H-1 Hebrew visual baselines churn while RTL work is in flight.** Eight baselines failed at
both viewports in the same window as the share-bar failures and then went green without those specs
changing. Baseline refreshes from parallel branches are the plausible cause (`visual-baselines.yml`
publishes candidates back to a source branch). **Recommendation:** refresh the H-1 baselines in one
PR after the last RTL change lands, and do not merge two branches that both refresh the same
reference images.

**F-3 — `ui-language-sales.spec.ts` is the one genuinely flaky-looking test.** It failed on three
different branches (four runs) and passed on many others; the expectation itself is correct on
`main` (`src/config/businessNavigation.ts` maps `sales` → `מכירות`, and the spec passes on most
heads). The failure is `getByRole('heading', {name:'מכירות', exact:true})` never becoming visible
within 30 s while the dev server compiles the heavy Sales screen, i.e. a **time/CPU-dependent wait**,
not a product defect. **Recommendation (not applied here — the spec belongs to the H-1/RTL work):**
wait for the app shell to settle (a stable `main` landmark or the removal of the loading state)
before asserting the heading, and keep the 30 s as a backstop; on a 2-CPU runner the first Sales
compile can exceed it. Chasing this with a longer fixed timeout would mask the same problem again.

**F-4 — Two PRs were still red at the end of the sample.** `arena/fc785ac7` (15:11) and
`arena/b1245963` (18:23, the latest run of PR #925) had no later green run in the sample. Neither is
a flake: b1245963's named failures are its own guards (Purchases translation table, `Vault.tsx`
shared-file rule, `ui-language-sales`). Whoever owns PR #925 should read that run before asking for a
merge.

**F-5 — Annotation coverage is incomplete for browser-only failures.** Eight of the sixteen failed
runs annotate only "Process completed with exit code 1" (the `Playwright E2E Smoke Suite` and the
coverage-gate rollups), so the failing spec is only visible in the shard job's annotation or its log.
Logs live on blob storage; a reader without that access cannot identify the failing spec at all.
**Recommendation:** have the rollup job repeat the shard annotations (it already downloads the blob
diagnostics) so the run page alone names the spec — a small change to the existing annotation step,
and it makes every future report like this one possible without log access.

## What this report does **not** claim

- It does not prove a test is flaky in the sense of "the same commit passes and fails"; the sample has
  one run per commit. It shows which names failed, on which branch, and whether that branch
  later went green.
- No test was skipped, quarantined or re-run. `nightly-stability.yml` (D-29) remains the mechanism
  for repeat runs.
- Cancelled runs (49 of 100) are excluded from "failures": they are superseded heads, not results.
