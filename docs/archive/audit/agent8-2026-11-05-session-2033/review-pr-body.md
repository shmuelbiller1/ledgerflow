## Review only — do not merge automatically

Agent #8's independent audit recovers earlier AF-004 evidence and adds reproducible tax-report diagnostics, checkpoints, logs and an owner handoff. This PR changes **no application/tax/server code**, proposes no tax-owner decision, and is not a launch approval. Application under review: upstream `7896cbdcbba520f71614a3445b963b1c88d497bb`.

Three separate issues are filed for owner triage:

- #519 — a Texas invoice's saved destination is ignored after its customer moves, changing a synthetic $100.00 sale and $8.25 tax to zero in the Texas return, quarter screen and CSV. Reproduced in helpers, jsdom and a real headless browser with stubbed stores/API.
- #517 — the US return ignores the first-line seller/entity label used by the invoice editor; a synthetic separately registered Israeli entity is counted under the Texas books' permit.
- #518 — a taxed sale with no known US destination state is silently omitted without a destination warning; no state should be guessed.

[Detailed findings and reproduction](audit/agent8-2026-11-05-session-2033/04-af004-findings-checkpoint.md) · [Latest test/recovery checkpoint](audit/agent8-2026-11-05-session-2033/06-broad-tests-browser-checkpoint.md) · [Drive backup folder](https://drive.google.com/drive/folders/1VG4z3otVCVhN2Vmr8jnssok8bIF2J-RK).

## Actual checks, including failures

- Explicit review-only AF-004 Node diagnostics: **12 tests, 6 pass / 6 intentional contract failures** across the three mechanisms; four failures are different surfaces of #519. They are outside the normal test glob and are not represented as passing.
- Real-browser AF-004 diagnostic using Chromium 153 with synthetic stores/stubbed API: **1 control passed, 1 expected contract failed** for #519. The existing W7/W8 browser tax-journey tests passed **2/2** after Vite cache preparation, using a non-default Chromium binary; initial environment/setup failures are retained. No authenticated/persisted browser journey was tested.
- Full project Node test-file globs, isolated PostgreSQL 17 and concurrency 2: **5,098 pass / 1 fail / 0 skipped**, 5,099 total. The failure was a timing assertion (1,521.99 ms vs 1,500 ms); the same performance file passed **3/3** when rerun alone. The tool timeout occurred before the runner subsequently wrote its full summary, so the original final OS exit status was not captured. The full run is **not green**.
- All 51 migrations and the repository RLS suite passed on isolated local PostgreSQL 17; this is not hosted Supabase. Typecheck passed; ESLint passed with its existing **42 warnings**; production build passed with dependency annotation/size warnings.

Remaining: owner-prioritized fixes and acceptance reruns, real persisted/authenticated browser and provider/hosted-Supabase checks, credit-note/legacy/multi-entity cases, and broader domain audit. No filing, posting or payment was performed. Shmuel decides priorities and any merge.
