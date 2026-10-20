# AI #4 — D-86 invoice form

Base revision: `6a0863252767bfb9ae8c566e26a1bf0c8a3ebc11` (20 October 2026).
Scope: `InvoiceModal.tsx`, regression tests and this evidence. D-87 is not included.
PR #232 was checked first: no lead request for changes; D-95/D-96 remain there.

## Changes and limits

- Keep labels above controls, including receipt payment selectors; show native constraint errors under the actual field with `aria-invalid`, `aria-describedby` and live announcements.
- All footer save actions check the existing native form constraints; customer/deposit/receipt-account refusal messages now appear beside their controls, retaining the draft. Deposit help stays associated with its field.
- A partial initial invoice now overlays the existing new-document defaults (rather than replacing the entire default object). This preserves the existing fallback invoice number for customer/receipt prefill when the number endpoint is unavailable. Existing invoice numbers are not changed; the existing server number request remains untouched.
- Scroll the form independently of its non-shrinking action footer, compact phone margins, 44px line controls and close/print/remove targets, full-width phone income account and readable amount row. Secondary actions use theme colours; only Save & Close (or Save receipt) is filled.
- Lock all save buttons during an in-flight submission. Financial helpers, totals, statuses, posting payload, server validation, tax rates and posting services are unchanged.

## Verification

- Type check: passed; ESLint: 0 errors / 209 warnings (cap unchanged at 210).
- Clean-lockfile production build: passed. An exploratory browser binary installed without saving temporarily changed the local Babel tree; `npm ci --ignore-scripts` restored the exact lockfile and the clean build passed. No dependency/lockfile edits are included.
- Browser: four new Chromium cases, 390/1280 × actual light/dark classes, passed. Covers required customer, excessive deposit, negative quantity, error clearing/focus, no premature save, retained mixed Hebrew/English customer name, fixed save location during scroll, 44px line controls, no document overflow, and 2 × $12.50 = $25.00 payload. These are UI-boundary captures, not proof of live posting.
- Before captures: four additional Chromium runs passed; images in `images/d86/`. The invoice modal is not part of the existing visual-regression snapshot set; no shared baseline was changed.
- Invoice + receipt component checks passed 13/13 after correcting partial-prefill defaults. Broader focused rerun: 36/36 tests passed (14 suites, no skips), including unchanged attachment, receipt, labels, contact and item-type regressions. Final CI results will be recorded in the PR.
- The first whole local `npm test` attempt was interrupted to avoid contending with browser geometry checks; it is **not** an all-suite pass. A transient label-case regression in that attempt was reverted without changing existing tests or financial expectations. This sandbox has no local Postgres; complete database-backed suite/RLS/coverage must be verified in GitHub CI before marking ready.
- `npm audit --audit-level=high`: passed (two moderate transitive advisories; no high/critical findings in the audited tree). No automatic dependency fixes.

## Release gate

W2: invoice form usability/validation evidence only. Existing W2 Connected / Verified / Browser status is unchanged; DIM-1 and full workflow evidence remain the lead's responsibility. This task is not a complete accounting-system audit or release approval.

Status: implementation under review; final only after the required CI checks pass and AI #1 reviews. Vercel preview is intentionally disabled by the owner and is not treated as an application failure.
