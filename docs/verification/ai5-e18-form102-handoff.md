# AI #5 E-18 — Israeli monthly Form 102 review

**Status:** PR #93, non-filing review UI on Payroll → Pay Runs History.

## Data contract
The existing `PayRun` stores payroll facts oriented toward US FICA and does not contain verified Israeli employee/employer National Insurance or employee health contributions. The E-18 panel therefore requires independently reviewed ILS figures entered for each posted run. It does not derive Israeli liabilities from US taxes, save manual entries, post to the ledger, or generate a tax return. Income tax withheld is explicitly kept separate from National Insurance Form 102 amounts. Browser pay-run history can be incomplete, so the preview is not evidence of a complete month.

## Verification
- Hand-checked exact-cent arithmetic, missing/duplicate/unsafe inputs, zero fields and excluded statuses: `src/tests/israel102-review.test.ts`.
- On-screen labeled inputs, review confirmation, separate reporting and non-ILS refusal: `src/tests/israel102-review-ui.test.tsx`.
- Run standard CI with type checking, lint, database/RLS, coverage, two time zones, and full Playwright.
- The PR's first browser run #38340126409 failed the same four Settings snapshots as the original main run, with 256 other browser tests passing. Those snapshots belong to pricing changes on `main` and AI #1 refreshed them in `08aa2e2`; do not weaken the pixel gate.

The integration needed for official reporting remains with AI #1: server-backed complete history, Israeli payroll fields and calculations, entity registration, and independently checked filing examples.
