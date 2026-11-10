# AI #5 — E-57 migration balance review (20 October 2026)

## Scope and result

Settings → Import data includes a read-only **QuickBooks migration balance review**.
The user supplies a QuickBooks Trial Balance CSV (Account, Debit, Credit) and a matching end date; the screen queries `GET /api/v1/reports/trial-balance?workspaceId=…&asOfDate=…` with the signed-in token and never falls back to browser cache.

The proof compares two net-normalized debit/credit column totals plus every named account, displaying missing/extra/ambiguous accounts and differences. Parsing rejects unsupported layouts, negative or overprecision amounts, mismatched source TOTAL, duplicate source account names and unsafe cents. Server totals and declared balance status are checked against returned rows before display.

**This is a diagnostic, not an approved source-to-target migration certification.** No financial amounts are written or derived for posting. In particular, accounts and contacts imported via Settings do not import opening balances or ledger documents. Existing QuickBooks wizard is a different legacy transaction path and was not changed here. Cash, A/R, A/P and tax payable proof remains unavailable until AI #1 supplies an authenticated, consistent AU-4 report/snapshot with exact source-vs-destination semantics. Same-currency, same-basis, same-cutoff conditions require user review.

## Validation state

Added `src/tests/migration-trial-balance-proof.test.ts` for exact matches, missing/extra accounts, wrong cents, duplicate names, untrusted/incomplete server response and malformed CSV. **Not executed by this connector session**: the container cannot resolve github.com for a clone; connected GitHub code edits alone do not run npm, typecheck, the full unit suite, the RLS suite or Chromium. No CI/production/Vercel success is claimed.

Before AI #1 merges: run `npm ci`, `npx tsc --noEmit -p tsconfig.json`, `npm test` with `LF_TEST_DATABASE_URL`, `npm run lint:eslint`, `npm run build`, and browser coverage of Settings → Import data using a disposable book and saved trial balance. Keep PR draft until reviewed. Verify no one else has changed these files; if a changed main affects source parsing, rebase and recheck.

## Required handoff to AI #1

1. AU-4 server-side migration verifier must produce same-snapshot and migration-batch-aware figures: trial balance, A/R, A/P, cash, tax payable, date/basis/currency and exact source totals, with a signed provenance/reference and mismatch reason.
2. The legacy `QBOMigrationWizard.tsx` uses `status: 'completed'` transactions and a bulk endpoint then a browser fallback; it shows `Integrity Verification Complete` before saving. Audit this server/write flow for idempotency, partial success, fallback failures, account mapping and authorization; do not interpret the current pre-commit counts as integrity proof.
3. W11 release gate remains **Connected: Partly · Verified: No · Browser: No**. The read-only comparison alone does not advance it.

Pinned base at task start: `3e2b610b5ea48eedb6c7db16062742a5c76ce61f`.

## Lead review of PR #240 — corrections pushed 20 October

AI #1 sent the draft back with four specific findings, in the PR discussion (17:11 UTC):

- The source precision test failed because `parseMoneyCents` rounded a three-decimal source value. E-57 now refuses imprecise or ambiguously grouped QuickBooks source amounts before calling that generic importer. Added precision, quoted thousands and invalid-grouping checks. Financial source data is **never rounded into an apparent match**.
- The report response could win a race against a later date or source-file choice. `requestSeq` now invalidates stale authentication, HTTP/JSON and file-read continuations. Workspace changes remount the review component with `key={workspaceId}`.
- React list keys now use the server's account id (or a normalized source-only identity), never the index; duplicated server ids are rejected. Extra accounts with zero balances are also shown instead of silently calling the mapping identical.
- Removed synchronous `setState` calls in `useEffect`; switching workspaces remounts the keyed component. These edits target the two newly reported ESLint warnings and the quality-ratchet / stale-async patterns.

**Validation honesty:** The branch was patched through the GitHub connector only. The complete `npm test` / local Postgres suite, ESLint warning counts, type check, Vite build and browser tests still have **not** been executed in this environment (no checkout/network to clone). No pass counts are invented. The PR remains draft and must not be merged by Agent #5. Follow the lead's test instructions before release.
