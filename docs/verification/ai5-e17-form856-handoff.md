# AI #5 E-17 — Form 856 withholding review export

**Status:** PR #92, intentionally partial. The typed helper `src/lib/tax/form856ReviewExport.ts` validates reviewed payment inputs and produces spreadsheet rows through the shared CSV writer. It cannot be used as an Israeli Tax Authority e-file upload.

## Data and scope
Inputs are payments that have already been loaded for the same workspace and year; the helper never fetches authoritative history, posts, changes withholding, or writes a record. The caller must establish complete workspace-scoped historical reads before permitting an annual export. It refuses unsupported currency mixtures rather than inventing an FX conversion. It does not supply issuer-specific data or tax-authority codes.

## Verification boundary
- Run `src/tests/form856-review-export.test.ts` with the full type/lint/unit/coverage/RLS/Chromium gates.
- Never mark the form filing-ready without a current authoritative schema, golden fixture, and independently reviewed yearly amounts and source documents.
- Visual-regression failure in original PR run #38339484613 was four **Settings** screenshots also failing on `main` (run #38338919594), introduced after pricing text changes, not by E-17. AI #1 updated those four Settings baselines on main commit `08aa2e2`. Retain strict screenshot comparisons; this PR must be checked against that updated main baseline.

This note is a review handoff, not proof of a full-suite pass.
