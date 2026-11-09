# CI queue analysis — 9 November 2026

## What was observed

GitHub API timestamps are UTC. PR #584's earlier run 42659184896 was superseded at about 17:12:09 but remained in progress until 17:14:17. After its shards were cancelled, two aggregation jobs using `always()` were queued. An earlier superseded run, 42656604933, continued until 16:58:48 after a replacement was pushed at 16:52:47. The replacement can remain pending while the older run's cancellation finishes.

A separate **successful** run, 42656515766, started at 16:36:38 and completed at 17:21:14. Its 19 jobs had a median creation-to-start wait of **20.2 minutes** and a 90th-percentile wait of **32.8 minutes**. For example, its lint/type/database job waited 32.8 minutes and then ran for 3.5 minutes; a browser shard waited 30.4 minutes and then ran for 10.3 minutes. These are individual job timings, not additive workflow durations. A job's `created_at` may be after its dependencies complete, so it is not necessarily the same as workflow creation.

The prior browser hang diagnostic also could not report live hangs: the watcher used an unreferenced timer (so its Node process exited), and Playwright's JSON reporter writes its report in `onEnd`, not while tests are running.

Each CI run creates 17 initial jobs: 4 unit, 6 timezone, 5 browser, validation, and build. Multiple PR and main-branch runs were queued concurrently. This is consistent with shared runner contention, but the API available here does **not** expose the runner concurrency limit, billing status, or GitHub's scheduler decisions; those are not confirmed causes. A workflow being `queued` can still have individual jobs that are running or completed, so inspect the jobs, not the top-level status alone.

## Changes in this PR

- Cancelled workflows no longer intentionally start the coverage and browser aggregation jobs; ordinary failed or skipped shards still make the required gates fail.
- Browser diagnostic and gate steps run after normal failures, but do not insist on continuing after the entire workflow is cancelled.
- A small live Playwright reporter records currently running tests separately from the final JSON report. The watcher stays alive until stopped, emits one escaped annotation per long-running attempt, and does not determine the Playwright result. A real Playwright test checks that the live file is populated before `onEnd`.
- No test suite, timezone, browser shard, coverage threshold, or main-branch run policy has been removed. The cancellation behavior is statically tested; it still needs observation in a real superseding run using the new workflow.

## Reproduce a timing report

```sh
gh api 'repos/shmuelbiller1/ledgerflow/actions/runs/42656515766/jobs?per_page=100' > /tmp/ci-jobs.json
node scripts/ci-timing.mjs /tmp/ci-jobs.json
```

The report distinguishes job wait from execution and excludes cancelled, skipped and queued jobs from timing percentiles because GitHub may provide placeholder start times for jobs that never ran. For a run with more than 100 jobs, collect all pages before analyzing. The tool does not request credentials, change runs, or make API calls itself.

## Follow-up decisions

The remaining queue problem cannot be eliminated by the cancellation fix alone. Before changing runner capacity, the number of shards, matrix coverage, branch protection, or the existing policy that every main push is tested, the owner should compare measured runner availability and duration with the cost and failure-isolation tradeoffs. Do not cancel another branch's run or declare required checks green based on a cancelled run.
