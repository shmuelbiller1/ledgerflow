# C-47 customer certificate review — 12 October 2026

AI #2 Codex; branch `codex/c47-tax-certificates`, based on main `c769abee`.

The customer detail button keeps the original page mounted in a named review dialog. Reports mounts the same view. The existing T-05 metadata is read without changing invoice eligibility. Real calendar dates determine an inclusive 30-day expiry window; malformed values require review, and current stored declarations are not legal verification or historical exemption evidence.

A complete workspace read, dated snapshot and unchanged cache reference are required for CSV. Failure, pending refresh, sign-out, workspace changes and edits block complete export. The native overflow region has a single gated CSV action. Original Hebrew names/references are preserved. Related addresses use the existing drawer and retain refused edits.

## Verification

- Fresh frozen-lockfile installation, types, ESLint (212 warnings / zero errors) and build passed before the first full run.
- The first full run had 2 quality failures: the report had no registry mount sample, and help had five sentences. Removed an unnecessary duplicate lazy registry key, added a real report-navigation browser sample and reduced help to four sentences. Baseline 212/44 and all assertions remain unchanged.
- Corrected targeted run: 12/12 tests, zero skipped/cancelled, including six certificate cases plus screen-help and quality ratchet.
- Final Chromium: 2/2 pass. Actual customer detail, nested drawer refusal/retry, exact Hebrew CSV, refresh after edit, 44px targets, horizontal keyboard scrolling, axe and focus restoration all pass; registered Reports entry mounts.
- The phone test found the existing attachment input's clipped position causing document overflow. Positioned the visually hidden native file input inside its relative label; keyboard/native input semantics are retained. The unchanged no-overflow assertion now passes.
- An additional regression covers an edit while the complete read is in flight. The snapshot now retains the cache reference from request start, so that response remains stale until another refresh. Seven certificate cases pass; the full pipeline was stopped before applying this correction and will run again on the final source.
- Final frozen-source run: **2597/2597 tests, 672 suites, zero failures/skips/cancellations**. Coverage **80.84% lines / 78.80% branches / 81.50% functions**, thresholds unchanged. Final types, ESLint **212 warnings / zero errors**, production build and **ALL RLS TESTS PASSED**. Chromium after the in-flight guard: **2/2 pass**. These results are pinned to the C-47 source based on main `c769abee`; newer main will be preserved before publication and GitHub will verify that integration.

No money calculations, server routes, schema, primary forms, dependency declarations or quality baselines were changed. A complete CSV describes current recorded declarations only.


## Preserved current main before publication

Merged main `363dec0e` normally, retaining both coordination histories and every upstream feature. The integrated source passes **13/13 targeted** (seven certificate cases plus help/quality), types, ESLint **212 warnings / zero errors**, and build. Its complete GitHub suites remain pending. Adding the report changes the always-visible P&L/balance-sheet navigation; a temporary CI-browser capture saves candidate images on an isolated review branch. Only inspected images will be brought into the feature branch, and the temporary capture workflow will be removed. Existing screenshot thresholds and money assertions stay unchanged.


## Reviewed visual references

Matching GitHub Chromium capture run **38329107479** passed all **40 visual comparisons** after capturing the eight intentionally changed P&L/balance-sheet navigation references. Candidate commit `a05efd78` changed those eight PNGs only. Inspected desktop/phone, light/dark menus and compared report bodies with main: the added certificate tab wraps normally, original controls remain visible, and assets/equity **$3,000**, P&L revenue **$15,000**, expenses **$12,000**, surplus **$3,000** are retained. The reviewed images are committed; the temporary capture workflow is removed. Pixel limits, expected money values and test selection are unchanged. Complete CI on this final review head remains pending.
