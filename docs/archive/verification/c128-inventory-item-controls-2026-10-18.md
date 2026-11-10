# C-128: item bundle and unit configuration

AI #2, 18 Oct 2026. Base `26d3275c`; branch `codex/c128-inventory-item-controls`.

The item form already had bundle, unit and package fields. This batch hardens those existing controls rather than adding duplicate screens. It consumes the existing `bundleProblem` for candidate validation, disables invalid additions, blocks invalid saved parts on both save-button and direct form-submit paths, and retains the draft. Adding a part again updates its quantity; removal explicitly clears it. Existing helpers, monetary fields and posting handlers are unchanged.

The dialog has a viewport height limit and scrolls. Full-width fields span the correct responsive columns; part choices fit the phone width, and close/remove controls are at least 44px. Original Hebrew/mixed unit text is preserved. Help explicitly says automatic invoice expansion is not available here and that configuring units does not convert posted stock or invoice quantities.

## Evidence

- Full `test:cov` against the previously fully migrated local Postgres: **3,256 tests, 731 suites, all passed, zero failures/cancellations/skips**. Coverage **81.03% lines / 78.91% branches / 82.41% functions**, existing thresholds pass.
- Typecheck, full ESLint and production build pass. **0 errors / 210 warnings**, unchanged.
- Five component cases cover the actual submitted fields, unchanged prices, Hebrew unit labels, package size, duplicate-part updates/removal, invalid quantities, missing saved parts, direct submit refusal, self/nested choices and truthful help.
- One real PostgreSQL/RLS case persists and reads back bundle/unit/package settings through `lf_update`, verifies viewer/non-member refusal, owner removal, unchanged quantity/prices and zero financial entries. This proves metadata persistence/permissions, not invoice expansion or stock conversion. The fixture includes both the kit and its referenced part.
- Chromium **4/4 pass**, 390px/1280px × light/dark. Before captures were taken in all four configurations; after captures exercise the same real dialog in a synthetic component host. Tests cover invalid part quantity, fractional package refusal, valid form submission, retained original text, 44px remove targets, bounded page width, scroll, Escape and focus return. Phone before/after images inspected: the old implicit columns compressed the part controls; the new layout is readable and scrolls to Save.

The first browser attempt incorrectly tried to serialize the native ValidityState with an asymmetric property matcher. The final test directly checks `validity.stepMismatch` and retains the assertion that no submission occurred. No production change was needed for that fixture correction.

Logs and pictures are current-instance artifacts under `/workspace/scratch/c128-*` and ignored `test-results/`. No visual baseline was edited; this dialog is outside the current fixed visual-regression screen list. Full Playwright/GitHub CI and merge are not claimed.

## Queue and scope

Capabilities 143/144 remain **Partial**: the reserved invoice form still needs bundle expansion/unit controls, and posted quantity conversion is separate. C-128's item-configuration scope is complete. Capabilities 151/152 now describe the real notes/custom-field screens, with their limits; the earlier verified hosts are unchanged. Prior completed C-103/104/107/109/110/111/112/113 ticks are carried forward, without claiming new implementations.

W13 records this configuration evidence but retains its existing statuses and stock-valuation/label blockers. No money, stock math, server, migrations, dependencies or quality budgets changed.

## Integration check

Merged main `0ace84f1` normally, preserving Claude's changes and both C-127/C-128 handoff messages. Inventory source is byte-identical to the version used for the full coverage and four browser checks. Removed duplicate C-102…C-114 queue entries only after confirming each generic line was a prefix of the retained detailed entry; completed states and evidence links are retained.

After the merge, **9/9 focused component/persistence/capability cases passed**, with no skips, and RLS passed again. The 3,256-test full run belongs to the pre-merge base plus this feature; complete combined-main CI is still pending. Type checking was repeated on the merged branch. No duplicate full-suite run was needed for the documentation merge and unrelated main changes.
