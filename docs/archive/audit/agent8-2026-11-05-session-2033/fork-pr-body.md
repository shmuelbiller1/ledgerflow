# Draft handoff — do not merge this fork comparison

**Important scope warning:** `Chaim-Richard/ledgerflow:main` is behind the upstream main pin. This fork-base PR's Files changed includes **more than 550 files** of already-existing upstream synchronization as well as the audit evidence; it is not an audit-only patch and must not be treated as one. Review the [audit-only comparison against upstream `7896cbd...`](https://github.com/Chaim-Richard/ledgerflow/compare/7896cbdcbba520f71614a3445b963b1c88d497bb...arena/6984648e-ledgerflow) and the [audit evidence](https://github.com/Chaim-Richard/ledgerflow/tree/arena/6984648e-ledgerflow/audit/agent8-2026-11-05-session-2033) instead. No application/tax/server changes were made by this audit.

A draft PR to the intended upstream `shmuelbiller1/ledgerflow:main` was attempted first, but GitHub returned `Resource not accessible by integration` (GraphQL `createPullRequest`; REST HTTP 403). Once pull-request write access is enabled, open the narrowly scoped upstream PR instead; Shmuel decides if and when to merge.

## Findings and checks

- [#519](https://github.com/shmuelbiller1/ledgerflow/issues/519): saved Texas destination ignored after customer moves; synthetic $100 net/$8.25 tax becomes zero on return, screen and CSV. Real Chromium reproduction uses synthetic stores and stubbed API, not a persisted or authenticated journey.
- [#517](https://github.com/shmuelbiller1/ledgerflow/issues/517): first-line seller/entity label ignored by US return.
- [#518](https://github.com/shmuelbiller1/ledgerflow/issues/518): US destination with no state is omitted without a destination warning; do not guess the state.
- Explicit Node acceptance diagnostics: **6 pass / 6 expected contract failures**; real-browser destination control/contract: **1 pass / 1 expected failure**. Existing W7/W8 browser tests **2/2 pass** after Vite preparation with a non-default Chromium 153 binary.
- Full unit runner on isolated PostgreSQL 17: **5,098 pass / 1 timing failure / 0 skipped** (5,099 total), while isolated performance-file rerun passed 3/3. Runner completed after tool timeout, so final OS exit was not captured. RLS and all migrations passed; typecheck, build and ESLint passed, ESLint with 42 existing warnings.
- [Detailed checkpoint](https://github.com/Chaim-Richard/ledgerflow/blob/arena/6984648e-ledgerflow/audit/agent8-2026-11-05-session-2033/06-broad-tests-browser-checkpoint.md) · [Drive backup folder](https://drive.google.com/drive/folders/1VG4z3otVCVhN2Vmr8jnssok8bIF2J-RK).

No filing, posting, production data or merge was performed. Owner triage, fixes, authenticated persisted browser/DB tests and the broader audit remain outstanding.
