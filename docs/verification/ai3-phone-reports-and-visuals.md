# Phone reports, visual references, and browser diagnostics

This batch changes report presentation and browser checks. It does not change financial figures, document mutations, roles, database migrations, test budgets, or the required browser gate.

## A-278: every registered report at 390 px

`e2e/phone-report-registry.spec.ts` opens all **135** registered reports through the real picker on the sample books at **390 px**, in light and dark (**270 report views**, 28 tests). It measures document and child overflow, clipped HTML text, and 44 × 44 px hit areas for standalone controls. Internal table scrolling and inline links in prose are not page overflow or undersized standalone controls.

The red run found 14 affected views. At phone width, Balance Sheet account names now wrap, date controls on party reports fit without hiding their labels, Delivery Notes and Customer Quotes source selectors can shrink, and Sales Tax Liability tables scroll inside named keyboard-focusable regions. Standalone report links use the existing phone target size. All 28 batches passed locally in Chromium 153 after those changes.

## A-281: reviewed screenshots

**12 new references**, each desktop/phone × light/dark: Purchase Orders with an expanded order and a populated line, the Journal entry editor opened through a real record link, and the open Reports picker. The two Balance Sheet phone references were refreshed for wrapping the account names; the review showed the same totals. The [pinned Linux capture and comparison](https://github.com/shmuelbiller1/ledgerflow/actions/runs/44408482990) passed both steps; the 14 reviewed PNGs are in commit `66bfaa3e`. The local Chromium was used for behavioral preflight, not as a source of committed pixels.

## #836: incomplete browser report diagnostics

For the selected unsuccessful browser run, the rollup reads a bounded Playwright JSON merge of uploaded blobs, including nested suites. It distinguishes incomplete results from recorded failures and intentionally skipped tests. Absent/corrupt report data is unknown, not evidence that a spec hung. Success and workflow cancellation do not trigger the diagnostic. The required exit check and live reporter are unchanged. **13/13** helper tests pass, including a real Playwright blob from a run stopped at its failure limit.

## Parallel work: A-279, A-280, A-282

While this batch was underway, [#869](https://github.com/shmuelbiller1/ledgerflow/pull/869) opened for these three items. The independent implementation is available at `66bfaa3e` but is not in this PR's final diff. On that earlier revision, the neighboring browser specs passed **22/22**, the Settings axe test covered all **32** sections at **1280 and 390 px** with no serious or critical violations, and the focused component run passed **93/93** including the linked-record state tests. Those results do not attest that the separate PR is green.

The [follow-on-link finding](https://github.com/shmuelbiller1/ledgerflow/pull/869#issuecomment-6993334391) was reproduced against the transaction-grid changes from #869 at `dd46bf03`: opening a different cached entry while an editor was open kept the original description. Keying the editor by entry ID changed the same test from red to green. The fix and test were handed off there rather than duplicated in this PR.

## Performance follow-ups: #834 and #833 remain open

Node 24.22.3, two available CPUs, PostgreSQL 17 for the integration suite. The source timing runs used the locked dependencies, no concurrent browser/build, and `CI` unset. Reproduce the unchanged assertions with:

```sh
env -u CI NODE_ENV=test SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic \
  node_modules/.bin/tsx --test --test-force-exit --test-concurrency=1 \
  src/tests/r5-every-report-speed.test.tsx src/tests/report-speed-12m.test.tsx
```

- **#834 — cold import vs. cached import.** The ten-module A-229 preload was **2,549.78 ms** in the unchanged test (native budget **1,500 ms**). A scratch probe timed a second import of the same modules in the same process: **2,374.31 / 0.95 ms** cold / warm with the normal tsx cache and **3,209.26 / 0.83 ms** with `TSX_DISABLE_CACHE=1`. A separate source profile on `2b4c5ecb` sampled the main thread only around the preload. Package metadata reads were the largest named bucket (about **1.0 s**); tsx, esbuild, and other Node loader frames were also visible. It is not a profile of the browser or report mounts. The cold assertion still fails locally; the budget was not raised or moved.
- **#833 — report mount vs. computation.** All **151** R-5 views were under **1,000 ms** on the three focused runs; Top Parties took **375–455 ms** there. Separately, on the unchanged scale-4 year (4,880 entries, 1,440 invoices, 864 bills), eight direct calls per mode to the existing `topParties` computation took **411–452 ms** for customers and **331–369 ms** for vendors, excluding fixture construction and DOM work. Those are separate samples, not a subtraction from the jsdom mount. They show that the ranking computation is worth profiling if the mount miss repeats; they do not establish that the previously reported miss is fixed.
- **Built browser.** Local Chromium 153 loaded the production Vite assets with the same scale-4 guest year. Each route was opened in a fresh context, then reloaded with service workers blocked. The wall clock stopped at the route's visible control/heading (populated rows for Top Parties) and confirmed **4,880** entries in the shell. Across the ten A-229 routes, cold navigation took **1.70–2.83 s** and reload **0.86–2.49 s**. Top Parties took **2.22 / 1.57 s**. The browser observed **70–158** distinct same-origin JS requests by route readiness (which can include cached requests on reload). These are single local end-to-end samples, including app boot, guest data hydration, resources, render and locator polling. They are neither the source-preload gate nor production-user latency.

Keep fixture contents, calculations, and native and hosted budget policy unchanged. The next useful samples are repeated built navigations on agreed reference hardware, with script transfer/evaluation and guest workspace hydration timed separately.
