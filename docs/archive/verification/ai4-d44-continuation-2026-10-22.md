# AI #4 — D-44 continuation, 22 October 2026

Base: `46937f09a6970859764bde4914c075f8e24d8a08` on fixed session branch `arena/395851ed-ledgerflow`.

## Scope

Replaced the Reports page's long button strip with a native disclosure containing a search field and grouped native select. All registered IDs remain selectable exactly once. Existing `setActiveReportTab` and report permalink effect remain authoritative; dates, calculations, fetching, exports and financial mutations are unchanged. Menus remain English; Hebrew report labels are searchable. Seven groups, existing report pins, and at most five validated recent IDs are shown. Recent selections are device-local: this is **not D-47 sync**.

Native details/select avoid a custom popup's focus trap and keyboard simulation. Four component tests cover registry completeness, Hebrew/no-result search, exact navigation callback/recent persistence, and valid/stale pins. Browser contracts replace the old scrolling-strip assertions with disclosure keyboard access, URL selection, phone overflow, all seven groups, recent selection and axe, on phone/desktop and light/dark.

## Queue reconciliation

- #324 is merged; do not recreate D-98/D-99 tests.
- D-98: merged browser proof uses actual backup UI and stubbed HTTP boundary. Not a deployment restore drill.
- D-99: screen gating is tested, but real four-account sign-in, posting, approval and payroll journeys are not established. Remains partial.
- D-13 and D-14: ADRs 0003–0007 and five operational runbooks already merged in #324; queue ticked.
- D-12: scripts exist, but authenticated database scenarios have no measured results; remains open.
- D-42: CI already uses four unit shards and merged coverage; no redundant rewrite undertaken.
- D-47: recent/pinned sync across users/devices remains open. Existing device-global pins were reused, not redesigned.
- #329 inspected: open docs-only ERPNext/strategy audit. This change does not duplicate or alter it.

## Verification

- Clean `npm ci --ignore-scripts`: pass.
- Typecheck: pass.
- Full ESLint: 0 errors, 106 warnings (cap 106 unchanged).
- Four new component tests: 4 pass, 0 fail.
- Production build: pass.
- Playwright collection: 4 tests collected. Chromium not installed locally; runtime/browser screenshots and visual review remain required on CI. No baseline refreshed or threshold changed.
- Full unit suite started locally without `LF_TEST_DATABASE_URL`; result recorded in PR follow-up. Database suites are not claimed as passed.

**Status: implementation checkpoint, not final launch sign-off.** D-44 remains open until browser/visual evidence is reviewed. No production operation, self-merge, financial/server/SQL edit, or baseline increase.

## Guard follow-up

The first whole-suite run caught a new `silent-catch` location in recent-history persistence. Fixed without raising a baseline: failed device storage now visibly says the report opened but recent history could not be saved. Picker plus bug-pattern suites on the corrected tree: **15/15 pass**. The initial whole-suite run is not an all-pass result; final integrated verification belongs to the updated PR CI.

Saved for review as **draft PR #340**. This is the final handoff for this implementation checkpoint, not a claim that D-44's browser/visual gate is complete.
