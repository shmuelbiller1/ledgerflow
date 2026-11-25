# API/UI parity audit status

This is a scoped audit, **not a release approval or complete end-to-end verification**. Detailed evidence, limitations and handoffs are in `api-ui-parity-review.json` and `api-ui-verification-matrix.json`.

## Coverage and safety

The static scanner identifies 386 route registrations; each matrix row links to at least one narrowly described scenario. This is not proof that every endpoint succeeds or is reachable from the UI: 12 registrations have only a local-app refusal, three only forged-admin refusals, and other evidence uses mocks, synthetic identities or narrow examples. Live authentication, third-party providers, production and complete browser workflows have not been verified.

**AUP-34 (fixed, 24 Nov):** undoing an FX revaluation whose next-day reversal has already taken effect is now refused by the server for every caller (HTTP, named command, UI), so earlier as-of balances can no longer change. Undo stays available, and the panel offers it again, while the reversal is still ahead. Regression: `src/tests/aup34-fx-undo-after-reversal.test.ts`; the audit probe now asserts the fixed behaviour.

Other unresolved issues include billing webhook order-dependent duplicate credits (AUP-15), unsafe legacy CSV row/date handling (AUP-30), financial telemetry semantics (AUP-28/29), and uncertain/partial writes and stale balance risks. See the review and `docs/COORDINATION.md` for the complete AUP-01–35 findings and ownership. UI mitigations do not make direct server callers safe.

## Verification

- Full Node 24 source suite, concurrency 4, against a freshly migrated disposable PostgreSQL database: **7,730 passed, 3 failed, 1 skipped** (7,734 total). All failures were performance budgets; this was not a green full-suite run.
- Serial retest of the three affected files: **4 passed, 1 failed**. Both R-5 tests passed; A-229 still failed because loading ten screen modules took 2,329.97 ms against a 1,500 ms budget. Performance cause and environment attribution are unproven; budgets were not changed.
- Recent local probes: public status DOM/API 1/1; demo reset 1/1; billing portal with stubbed Stripe 1/1; FX local HTTP/DB 2/2; FX scoped UI 13/13. These are scoped evidence, not live-provider or deployed-browser proofs.
- Scanner fixtures 8/8, CSV observation 2/2, targeted lint, JSON parsing and `git diff --check` passed. Audit probes are separate from the full source-suite glob.

No live Stripe, Plaid or production data was used. Full findings, route-by-route evidence and limitations remain in the JSON files; previously documented handoffs and release blockers remain open.

## CI follow-up and visual review

The scanner fixture is registered in the CI script-test job. Its root is the current working directory, query matching uses linear string operations, and revision metadata is read without invoking a PATH-resolved executable. The synthetic authentication test route has an explicit rate limiter. On the intermediate CI head, the lint/rules job, CodeQL check, and Sonar quality gate passed; that does not establish the final head's result.

Linux Chromium baseline workflow runs 45439520913 and 45440170631 captured and rechecked affected visual tests. Review of representative before/after images: guest admin telemetry now shows refusal instead of a fabricated populated view; the opening-invoice dialog includes the partial-save warning; the guest bank-connect button is disabled; the watch summary shows unavailable after refusal rather than claiming zero or appearing perpetually loading. The guest task screenshot now explicitly waits for that settled state. The existing cramped phone opening-preview columns remain a usability concern. These screenshots use fixtures and do not verify hosted authentication, providers or accounting correctness.
