# API/UI parity audit status

This is a scoped audit, **not a release approval or complete end-to-end verification**. Detailed evidence, limitations and handoffs are in `api-ui-parity-review.json` and `api-ui-verification-matrix.json`.

## Final status (26 Nov 2026)

All 35 findings have been worked. Each one's `resolution` in `api-ui-parity-review.json` names its status and the PR that fixed it.

| status | count | findings |
|---|---|---|
| Fixed on the server (and screen), merged, with regression tests | 18 | AUP-01, 05, 08, 10, 14, 15, 19, 21, 22, 25, 26, 27, 28, 29, 30, 31, 32, 34 |
| Fixed in the screen; no server change needed | 13 | AUP-03, 06, 07, 09, 11, 12, 13, 16, 17, 20, 23, 24, 35 |
| Already safe by design | 1 | AUP-33 |
| Safe part fixed; the rest waits for the owner | 1 | AUP-04 (re-enabling workspace edit and bulk sync) |
| Waits for the owner | 1 | AUP-02 (a stock-closing button) |
| Not started | 1 | AUP-18 (server records of failed sign-ins, part of issue #945) |

Fixes landed in PRs #1039, #1040, #1041, #1043 and #1044; the UI mitigations in #1038. The two owner decisions are written up in `docs/FOR_YOU.md` with the default in use.

**What this does not prove.** The fixes are tested against a disposable database, mocked screens and synthetic identities. None was verified on the deployed site, with real sign-in, or with live Stripe, Plaid or email. That is still the remaining work for the 13 screen fixes and for AUP-05.

## Coverage and safety

The static scanner identifies 386 route registrations; each matrix row links to at least one narrowly described scenario. This is not proof that every endpoint succeeds or is reachable from the UI: 12 registrations have only a local-app refusal, three only forged-admin refusals, and other evidence uses mocks, synthetic identities or narrow examples. Live authentication, third-party providers, production and complete browser workflows have not been verified.

**AUP-34 (fixed, 24 Nov):** undoing an FX revaluation whose next-day reversal has already taken effect is now refused by the server for every caller (HTTP, named command, UI), so earlier as-of balances can no longer change. Undo stays available, and the panel offers it again, while the reversal is still ahead. Regression: `src/tests/aup34-fx-undo-after-reversal.test.ts`; the audit probe now asserts the fixed behaviour.

The billing duplicate-credit (AUP-15), CSV row/date (AUP-30) and financial-metric (AUP-28/29) findings listed here before are fixed; see the final status above. UI mitigations alone do not make direct server callers safe, which is why those were fixed on the server.

## Verification

- Full Node 24 source suite, concurrency 4, against a freshly migrated disposable PostgreSQL database: **7,730 passed, 3 failed, 1 skipped** (7,734 total). All failures were performance budgets; this was not a green full-suite run.
- Serial retest of the three affected files: **4 passed, 1 failed**. Both R-5 tests passed; A-229 still failed because loading ten screen modules took 2,329.97 ms against a 1,500 ms budget. Performance cause and environment attribution are unproven; budgets were not changed.
- Recent local probes: public status DOM/API 1/1; demo reset 1/1; billing portal with stubbed Stripe 1/1; FX local HTTP/DB 2/2; FX scoped UI 13/13. These are scoped evidence, not live-provider or deployed-browser proofs.
- Scanner fixtures 8/8, CSV observation 2/2, targeted lint, JSON parsing and `git diff --check` passed. Audit probes are separate from the full source-suite glob.

No live Stripe, Plaid or production data was used. Full findings, route-by-route evidence and limitations remain in the JSON files; previously documented handoffs and release blockers remain open.

## CI follow-up and visual review

The scanner fixture is registered in the CI script-test job. Its root is the current working directory, query matching uses linear string operations, and revision metadata is read without invoking a PATH-resolved executable. The synthetic authentication test route has an explicit rate limiter. On the intermediate CI head, the lint/rules job, CodeQL check, and Sonar quality gate passed; that does not establish the final head's result.

Linux Chromium baseline workflow runs 45439520913 and 45440170631 captured and rechecked affected visual tests. Review of representative before/after images: guest admin telemetry now shows refusal instead of a fabricated populated view; the opening-invoice dialog includes the partial-save warning; the guest bank-connect button is disabled; the watch summary shows unavailable after refusal rather than claiming zero or appearing perpetually loading. The guest task screenshot now explicitly waits for that settled state. The existing cramped phone opening-preview columns remain a usability concern. These screenshots use fixtures and do not verify hosted authentication, providers or accounting correctness.
