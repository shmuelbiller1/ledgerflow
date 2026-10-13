# AI #2: client report pack verification

Branch: `codex/c30-report-pack`. Review the six supported existing server reports,
cover and native print/PDF output. Aging is clearly dated current aging, as
authorized by the owner; arbitrary specialized reports and historical aging are
not claimed complete.

## Evidence and integration boundaries

- On `e7ad0f41` (main through `66132fd7` plus the report pack): clean install,
  types, ESLint 212 warnings / zero errors, production build, 2386 tests in 671
  suites under coverage, zero failures/skips/cancellations. Coverage: 81.20%
  lines, 78.32% branches, 81.02% functions; unchanged floors. Fresh database RLS
  passed. Full Chromium: 196/196, including the actual report-pack PDF and both
  desktop/phone dashboard cases.
- Main through `e79fb72e` was merged normally as `8ac670ce`; both appended
  developer-instruction sections were retained. Latest delta: 31 tests passed
  (chart kinds, startup, Israeli document types, asset metadata, report pack,
  collection and orphan guards), types and production build passed.
- The incoming startup fixture initially hung. Its assertions are unchanged;
  requests now receive collection-shaped responses, and fetch/auth/realtime are
  cleaned up between tests. All three startup cases then completed.
- Latest full lint **fails** in main's `src/lib/assetTagAdapter.ts:36`:
  `preserve-caught-error` requires the duplicate-tag error to retain its cause.
  This was handed to the asset-tag owner without suppressing the check. The owner
  subsequently fixed it on main; the final integration below includes that fix.
- The new unique asset-tag migration was applied to the local test database;
  `assets_workspace_tag_uq` exists. This does not assert deployed migration state.

## GitHub review

The current CI workflow runs automatically on `codex/**` pushes and PRs and
includes coverage/RLS, Chromium and two non-UTC unit suites. The owner explicitly
authorized PRs, manual workflow starts and checking results. However, this
environment's request to list Actions runs returned `Forbidden`; CLI auth also
reports an invalid configured token. Git transport is separate. No PR creation,
workflow run identifier or GitHub success is claimed without a returned result.

## Final follow-up on main `f53ef945`

Normal merge `a1a5eda5` preserves the expanded C-57..C-71 queue, incoming product
features and Claude's startup cleanup. The fixture retains collection-shaped
stubs plus Claude's auth/realtime disposal. Types, ESLint (212 warnings / zero
errors), production build, fresh RLS and 15 focused unit/structural cases passed.
Fresh Chromium: 11/11 passed across the actual report-pack PDF, both dashboard
widths, all chart-kind cases and asset/purchase cases. The earlier full-suite
coverage/browser figures remain pinned to their original integration; no new
all-suite run on `f53ef945` is claimed. GitHub's automatic checks are separate
evidence and still cannot be read through this environment's forbidden API.

## 12 Oct: repair the red GitHub PDF extraction check

PR #73's prior run #702 passed validate and both timezone suites but failed its
PDF browser assertion. The old test helper read only hex text operators with
two-byte glyphs; literal strings and one-byte font codes were missing. The helper
now handles both PDF string forms, escaped literal bytes and the font's codespace.
Three regression cases retain ASCII dates, cents, page labels and mixed Hebrew
glyphs. The browser's existing expected date, amount, page count and print-chrome
assertions are unchanged; explicit checks for books/sales/bank Hebrew words were
added, with extracted text attached for diagnosis. This is a test-reader repair,
not a change to report calculations or a reversal of numeric text.

Merged main `c769abee` normally as `65f6c336`, preserving the four merged Codex
features and Claude's memo/row-key/collection-screen fixes. On repair `b52a9ea1`:
clean npm install using the current lockfile; types; lint **212 warnings / zero
errors**; production build; **2598 tests / 672 suites, all passed with zero
skipped/cancelled** under coverage (**80.86% lines / 78.83% branches / 81.50%
functions**, unchanged gates); and fresh RLS all passed. Fresh Chromium **13/13**
passed across the actual PDF, bookmarks, export templates, price mismatch, tax
profiles, both dashboard widths, chart kinds and the nested record-details flow.
The earlier 196- and 201-case browser results remain separately pinned; no new
full-browser or green GitHub result is inferred from these focused checks.
