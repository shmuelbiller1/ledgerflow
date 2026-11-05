# Agent #8 — broad-test and real-browser checkpoint

**UTC:** 2026-11-05 around 21:17. **Application pin:** upstream `7896cbdcbba520f71614a3445b963b1c88d497bb`. **Branch:** `arena/6984648e-ledgerflow`; latest verified remote SHA before this checkpoint `42629a039edc9f96bc1a167bb288e149ba0c04d9`. Review only; no application changes or merge.

## Full unit run — one real timing failure, not a green suite

- Ran the same four test-file globs as `npm test` with Node `v24.22.2`, `NODE_ENV=test`, the deterministic test salt, the isolated UTF-8 PostgreSQL 17.11 test DB with all 51 migrations applied, and **`--test-concurrency=2`** to fit this 3.8 GiB sandbox. This includes database integration fixtures; it is not a hosted Supabase/deployment run.
- The shell tool's **1,200-second timeout** expired while the runner was still active. The already-started runner continued and wrote a complete Node summary after 1,326 seconds: **5,099 tests, 5,098 pass, 1 fail, 0 cancelled, 0 skipped**. The original shell's final OS exit status was not captured after the timeout; the runner summary unambiguously reports one failure. Full unmodified log: [`06-full-unit-output.txt`](06-full-unit-output.txt), SHA-256 `148d5233324a19cc70b47296261169999e298d89da9f47e8d9433258c6ebfb2f`.
- The failure is `A-229` in `src/tests/report-speed-12m.test.tsx`: cold-loading ten screen modules measured **1,521.99 ms** against a **1,500 ms** non-CI budget. Isolated rerun of that entire file with one worker **passed 3/3**, exit 0; its output includes existing React `act` and relative-URL fallback warnings. This is a time-sensitive test observation; host load or performance causes were not proved, and the isolated pass does **not** turn the full run green. See [`06-performance-isolated-output.txt`](06-performance-isolated-output.txt).
- The diagnostic AF-004 tests are **outside** those project globs; the full suite pass count must not be used as proof that their six contracts passed.

## Real headless browser — synthetic, network-stubbed

The existing `e2e/tax-journeys-browser.spec.ts` ran with Chromium **153.0.8010.0** from `@sparticuz/chromium`, a **non-default binary** supplied via a temporary Playwright config, one worker, development server, isolated DB for server startup and stubbed browser API traffic. After explicitly warming Vite's dependency cache with `npx vite optimize --force`, **both existing W7/W8 tax-journey tests passed** (exit 0; [`06-existing-browser-tax-journeys-optimized-output.txt`](06-existing-browser-tax-journeys-optimized-output.txt)). They do not exercise the destination-change contract.

Prior environment attempts are preserved rather than erased: the first set `NODE_ENV=test`, in which `server.ts` deliberately does not listen (web server exited); the second used development mode but lacked the pre-optimized `react-dom_client.js` file and the two fixture imports failed. The successful run then used the isolated database and pre-optimized dependencies; the two failed-attempt logs are alongside the successful log. This establishes neither a production browser incident nor a standard CI-browser pass.

New [`af004-browser-journey.spec.ts`](af004-browser-journey.spec.ts), with a control and an explicit contract assertion, mounts the real US quarter report in Chromium with synthetic workspace/stores and stubbed API responses. It retains the Texas invoice snapshot in both cases. **1 control passed; 1 expected contract failed:** after changing only current customer state TX→OK, observed row `0 / $0.00 / $0.00` versus expected `1 / $100.00 / $8.25` ([output](06-af004-browser-acceptance-output.txt)). This independently confirms issue [#519](https://github.com/shmuelbiller1/ledgerflow/issues/519) in a real browser rendering path, not an actual saved invoice, authenticated browser session, live database round trip, filing, or deployment.

From repo root with a normal installed Playwright Chromium and an **isolated** development DB:

```sh
# Set DATABASE_URL only to a disposable local/test DB with the repo test stub+migrations.
# If the cold Vite cache lacks react-dom_client.js, first run: npx vite optimize --force
NODE_ENV=development npm run test:e2e -- --config=audit/agent8-2026-11-05-session-2033/af004-playwright.config.ts
```

The config optionally accepts `AUDIT_CHROMIUM_PATH` for a non-default binary. This acceptance command should exit nonzero on the audited code; it is not in the normal e2e glob. Tax-owner decisions remain open for [#517](https://github.com/shmuelbiller1/ledgerflow/issues/517) and [#518](https://github.com/shmuelbiller1/ledgerflow/issues/518); neither was independently reproduced in a real browser here.

## Prior checkpoints and GitHub state

- Three upstream issues [#519](https://github.com/shmuelbiller1/ledgerflow/issues/519), [#517](https://github.com/shmuelbiller1/ledgerflow/issues/517), [#518](https://github.com/shmuelbiller1/ledgerflow/issues/518) were created and individually read back. Mission issue #150 comment was **denied** (`Resource not accessible by integration`), not posted; draft preserved in `issue150-update-not-posted.md`.
- Drive [checkpoint 05](https://drive.google.com/file/d/1KbwdOLzm5HkRxR_L_ueAxX7t2-r8rxh-/view), [RLS log](https://drive.google.com/file/d/11BJh7IL_3TT4ahJr5fJm2lSqkVuo5ees/view), and [unposted update](https://drive.google.com/file/d/12zsprQ3JgLpAy_Cwnzer7AucPWxzgIS1/view) were read back; their server MD5s matched local. Earlier [full evidence archive](https://drive.google.com/file/d/1muvd8g-CiJ36pCzByuKPE3vjB3uzeVKU/view) was downloaded, byte-compared and unzip-tested, but predates this checkpoint. Back up these new logs/tests.
- On #516, the older failed browser job [42106102596 / shard 4](https://github.com/shmuelbiller1/ledgerflow/actions/runs/42106102596/job/127522195516) failed container initialization (`Docker pull failed with exit code 1`), and that workflow was later **cancelled**. A later run for a newer #516 head had browser shards 2–5 and unit shards passing, browser shard 1 pending when observed. Main remained at `7896cbd...`; recheck current status before drawing conclusions. Vercel status was pass at observation; preview policy is not evidence of unit/browser correctness.

## Recovery / remaining work

1. Push this checkpoint, new test/config and logs to the dedicated branch and verify remote. Upload a new evidence archive and this checkpoint to the [Drive folder](https://drive.google.com/drive/folders/1VG4z3otVCVhN2Vmr8jnssok8bIF2J-RK), then download/compare/read back.
2. Try a draft, explicitly no-merge review PR; document any permission denial. Add browser evidence to #519 only if the current issue body has not been changed by anyone else and permissions allow.
3. An owner should settle tax/seller authority and priority, fix and run these acceptance contracts, and perform authenticated persisted journeys, credit-note/legacy/multi-entity cases, real Supabase/RLS and integrations, and broader independent domain review. Do not declare first-tester or production readiness from this bounded audit.
