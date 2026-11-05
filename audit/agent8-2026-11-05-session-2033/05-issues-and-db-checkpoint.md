# Agent #8 — issue filing, broad checks and isolated-DB checkpoint

**Time:** 2026-11-05 around 20:53 UTC. **Fixed branch:** `arena/6984648e-ledgerflow`. **Application pin:** upstream `7896cbdcbba520f71614a3445b963b1c88d497bb`. The most recent verified GitHub SHA before this checkpoint is `b92b0afbfbd7bcbf41d78608f4a0738b1661261d`. No application code changed; no merge.

## Filed and verified upstream

- [#519 — issued destination ignored after customer moves](https://github.com/shmuelbiller1/ledgerflow/issues/519).
- [#517 — first-line seller/entity label ignored](https://github.com/shmuelbiller1/ledgerflow/issues/517).
- [#518 — unassigned US state silently omitted](https://github.com/shmuelbiller1/ledgerflow/issues/518).

`gh issue view` read back all three as OPEN with the expected titles and bodies. They ask for owner decisions; priority suggestions are not owner decisions. The focused evidence and intentional failure log are in [checkpoint 04](04-af004-findings-checkpoint.md).

Attempted `gh issue comment 150 --repo shmuelbiller1/ledgerflow --body-file ...` to update the parent mission, but it returned exit 1, exactly: `Message: Resource not accessible by integration, Locations: [{Line:1 Column:49}]`. The comment was **not posted**; its intended text is preserved in `issue150-update-not-posted.md`. Despite that denial, creating the three distinct issues succeeded; do not imply all GitHub permission checks failed. The `docs/COORDINATION.md` Messages handoff has been pushed.

## New tests actually executed

- Node `v24.22.2` `npm run lint:types`: **exit 0**.
- `npm run lint:eslint`: **exit 0, 0 errors / 42 warnings**, exactly at the configured warning ceiling. Warnings are `@typescript-eslint/no-explicit-any` in existing `src/server` files; the new audit sources had no lint diagnostics. Treat this as pass with warnings, not zero warnings.
- `npm run build`: **exit 0**. Vite/ESBuild built front and server bundles; Zod/Rollup emitted two annotation warnings and server bundle size notices. Build output is generated/ignored, not committed.
- Started a fresh, local-only **PostgreSQL 17.11** using an npm-distributed embedded binary outside the repo. Database `lf_test` was explicitly UTF-8, isolated, and not Supabase or production. `npm run db:test-setup` applied `plain-postgres-stub.sql` and all **51** migrations; `npm run test:rules` exited 0, reporting **`ALL RLS TESTS PASSED`**. Exact output: [`05-db-setup-and-rls-output.txt`](05-db-setup-and-rls-output.txt). This tests the repo's plain-Postgres stub and SQL RLS suite, not a hosted Supabase environment or the entire DB integration suite. DB process and data are disposable and not a backup.
- Full unit suite, real browser, live provider, Supabase deployment and tax-filing paths are still **not run** at this checkpoint. Run full unit suite against an authorized fresh test database using Node 24 and resource-limited concurrency. Never aim the migration/setup command at real customer data.

## GitHub checks investigated without conflating preview failures

The latest upstream-main code pin's GitHub check-runs included successful production build, RLS/type/lint, unit shards, browser shards, and security scans; these are CI results at the **main pin**, not independently repeated local passes or proof of the missing AF-004 contracts.

On PR [#516](https://github.com/shmuelbiller1/ledgerflow/pull/516), [Browser shard 4/5](https://github.com/shmuelbiller1/ledgerflow/actions/runs/42106102596/job/127522195516) failed while the overall workflow was still in progress. GitHub job API reports failure in **Initialize containers**, and its check-run annotation says **`Docker pull failed with exit code 1`**. Thus this job did **not** establish a browser-test or application-code failure. The current Vercel status was pass. Full Action logs could not be fetched: `gh run view --log` said the run was still in progress, and direct job-log retrieval redirected to inaccessible external blob storage and returned EOF. No merge recommendation is implied; check the final run state later.

## Preservation / recovery

- GitHub branch was pushed and remote `ls-remote` exactly matched `b92b0afbfbd7bcbf41d78608f4a0738b1661261d` before this checkpoint.
- Drive [checkpoint 04](https://drive.google.com/file/d/1xetIt_6IvQ0qwFqqF1krag8ipBFhA9zB/view) and [acceptance log](https://drive.google.com/file/d/1D_zNzgNKkj3vIbDeq4jM84MZXH0ADTZo/view) were read back. The [checkpoint b92b archive](https://drive.google.com/file/d/1muvd8g-CiJ36pCzByuKPE3vjB3uzeVKU/view) contains all session files, recovered historical evidence and coordination handoff. It was downloaded from Drive and compared byte-for-byte to the source, with `unzip -t` passing and SHA-256 `21fb82b53ea18bb8f175c143a417ba0964622b5019b497fd1f6f6449c52e786d` matching. This archive predates this checkpoint and the new DB test log; back these up separately.
- Next: commit/push this checkpoint and DB log, verify remote; upload/read back to [Drive folder](https://drive.google.com/drive/folders/1VG4z3otVCVhN2Vmr8jnssok8bIF2J-RK); run more checks; open a clearly draft/review-only PR if allowed; record final results and remaining gate work. Keep historical tests and incomplete/proposed tax contracts accurately labeled. No merge.
