# Agent #5 findings register — 20 Nov 2026

**Agent:** AI #5 (Arena) · **Branch:** `arena/2c4fddb3-ledgerflow` · **Base:** `d1f2c8d` (main)
**Scope:** AI #5 queue (E-54) + independent verification of open-PR bot findings. Not a
repository-wide release audit.

## Confirmed defects

### F-01 — Four report screens crash on a malformed workspace currency (FIXED on this branch)
- **Severity:** Medium (report screen crash; no money misstatement — the screen fails to render).
- **Location:** `src/components/reporting/AverageMonthlyReportView.tsx:28`,
  `ExpenseByCategoryReportView.tsx:65`, `IncomeBySourceReportView.tsx:53`,
  `TopExpensesIncomeReportView.tsx:36` — each called `csvMoneyForCurrency(bookCurrency)` in the
  render body. `csvMoneyForCurrency` throws `RangeError` for any non-3-letter code
  (`src/lib/csvExport.ts`), and `useBookCurrency` (`src/hooks/useBookCurrency.ts`) only
  trims/upper-cases the workspace value, so `US$` or `EURO` reached the writer unchanged.
- **Evidence:** Gitar finding on PR #946 (`src/tests/csv-book-currency-guard.test.ts:18`),
  independently verified by code reading and by a failing-then-passing regression test
  (`src/tests/csv-book-currency-malformed.test.tsx`, 11/11; proven non-vacuous by reverting
  one screen to the throwing writer — 2 failures).
- **Fix:** added `csvMoneyForBook` to `src/lib/csvExport.ts` (fallback to the two-decimal
  writer for an unusable code; byte-identical to PR #946's implementation so the two branches
  merge cleanly) and switched the four screens to it. `InventoryValuationReportView` and
  `StatementColumns` already wrap their export in try/catch — no change needed.
- **Status:** FIXED on this branch; PR open. Note for AI #7: PR #946's guard regex accepts
  `csvMoneyForBook(`, so this fix keeps that guard green.

### F-02 — E-54 fixture initially had a wrong record width and an unbalanced journal (FIXED)
- **Severity:** Low (research fixture only; caught by its own tests before commit).
- **Evidence:** `uniform-structure-fixture.test.ts` failed on C100 width (declared 430, fields
  sum to 445) and on journal balance (debits 1,170,000 vs credits 1,000,000 — VAT line missing).
- **Fix:** C100 width corrected to 445 (verified field-by-field against the spec CSV tables);
  fixture gained a VAT-payable account and the matching credit line. All 7 tests pass.

## Suspected / reported, not patched (outside AI #5's lane)

### F-03 — PR #938 carries a server change in a UI-copy PR (reported, not patched)
- **Severity:** Medium (process/ownership; the change itself looks right).
- **Evidence:** Gitar + Codex both flag `src/server/db/pgFirestore.ts` retry limit 8→16 in
  AI #12's N-3 payment-copy PR #938, contradicting the PR description ("no server code
  changed") and AGENTS.md (`src/server/` is AI #1's). CI on #938 is green.
- **Status:** Documented here for AI #1/AI #12. Not patched — not my branch, not my lane.

### F-04 — PR #952 Codex P1 on Hebrew operational labels (reviewed, already answered)
- **Severity:** Low. Codex flagged that UI-2 translates operational controls (Columns,
  pagination) into Hebrew, citing `src/AGENTS.md` ("English menus/options"). The owner
  (shmuelbiller1) replied on the thread with the UI-2/EU-G1 contract (English default;
  Hebrew only after explicit `setLanguage("he")`), pinned by tests. CI on #952 is green.
- **Status:** Reviewed; no action. The owner's answer stands.

## Open-PR CI status (verified 20 Nov 2026)
- #952 (UI-2): all checks pass (2 expected skips: changed-specs browser, docs).
- #946 (CSV currency): all checks pass (2 expected skips).
- #938 (N-3): all checks pass (2 expected skips).
- Vercel previews: not treated as defects per the assignment (automatic previews disabled).

## Remaining risks / unverified
- E-33 writer not yet built; Uniform Structure simulator validation not yet run (see
  `docs/UNIFORM_STRUCTURE_RESEARCH.md` open questions).
- Full unit suite / browser shards / Sonar / Gitar on this branch are CI's (2-CPU sandbox,
  no Chromium, no test Postgres). Local: tsc clean (needs 8 GB heap), ESLint 0 on touched
  files, 39/39 focused tests.
