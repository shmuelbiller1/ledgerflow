# Agent #13 — findings register and verification log

**Date:** 2026-11-11 · **Branch:** `arena/a3a5023d-ledgerflow` (fork `Chaim-Richard/ledgerflow`) · **Base:** `main` `ec3ff49` (merge of #626)
**Lane:** AI #13's queue in `docs/COORDINATION.md` — "reports people check every month" (R-1 month-end checklist, R-5 report speed) plus independent verification.
**Authority:** review and report; no money/posting/tax-maths/`src/server/` changes, no merges. Nothing in this session touched production data, a database, or a live service.

## What was read before starting

| Source | Taken from |
|---|---|
| `AGENTS.md` (root) + `src/AGENTS.md`, `src/lib/AGENTS.md`, `src/components/AGENTS.md`, `src/tests/AGENTS.md` | repository |
| `CLAUDE.md`, `CURRENT_WORK.md` (start-of-session steps, standing failures) | repository |
| `docs/COORDINATION.md` — rules, "NOW", AI #13 queue (R-1…R-5), Messages (latest entries incl. the 10 Nov ease-of-use split to AI #14 and the merge of #626) | repository |
| `docs/INDEPENDENT_AUDIT_AGENT.md`, `docs/FIRST_TESTERS_GATE.md` (gates G-01…G-19, AF-001…AF-006 starters) | repository |
| `audit/README.md`, `audit/agent8-checkpoint-2026-11-10.md`, `audit/FINAL_ACCURATE_LIST_2026-11-10*.md`, `audit/function-audit/*` (prior agents' registers, to avoid duplicates) | repository |
| GitHub: open PRs (#623, #616, #615), merged #603 (previous AI #13 cleanup), #626, #618, #617 | `gh` |
| Google Drive: `Ledgerflow Agent Backups` folder (ID `1VG4z3ot…J-RK`), its numbered archive folders and `MASTER_RECOVERY_INDEX.md` | Drive connector |

No separate agent inbox exists in this repository; agent messages are the Messages section of `docs/COORDINATION.md`, and Shmuel's instructions reach agents through the queue text there and through `CURRENT_WORK.md`. Nothing in the queue reassigned R-1/R-5 to another AI (R-2/R-3/R-4 were completed by AI #9 in #608/#610 and are already marked done).

## Verified findings

Severity uses the audit mission's scale (P0 stop-invitation … P3 later), with the repository's Critical/High/Medium/Low wording in brackets.

### AF13-001 — Month-end "Invoices and bills match the ledger" reports a correct entry as wrong for JPY/KWD-style currencies — **Medium [High] — FIXED**

* **Where:** `src/lib/postingCheck.ts` (`expectedTotal`), used by `postingMismatchesThrough` in `src/lib/closeChecklist.ts`, which feeds the `postings` item of the Month-End Close checklist and its *Repost* action.
* **What it does:** compares each issued invoice/bill with its accrual entry. Expected amount was `amountCents × document.exchangeRate`.
* **Defect:** the posting path converts document minor units to the books' minor units (`documentMinorRate` → `minorUnitRate` = rate × 10^(digits(books) − digits(document)); `src/services/ledgerPost/postingCore.ts`). The check used the bare rate, so for a 0-decimal document currency in a 2-decimal book (JPY, KRW, VND…) the expected figure was **100× too small**, and for a 3-decimal one (KWD, BHD, JOD, OMR, TND…) **10× too large**.
* **Consequence:** a month whose ledger is exactly right shows "N documents whose ledger entry is missing, doubled or wrong. Repost them below", cannot be closed without a sign-off, and invites *Repost* (which reverses and re-posts a correct entry — audit-trail churn, no fix, because the refreshed entry is flagged again).
* **Evidence (real posting service, not a hand-made entry):** `audit/agent13-2026-11-11/probes/af13-001-minor-unit-repost-check.test.ts` drives `LedgerPostService.postInvoiceLedger` for ¥100,000 at 0.0067 in a USD book. The server posts AR = **67,000** cents (independent arithmetic: ¥100,000 × $0.0067 = $670 = 67,000 cents); before the fix the check reported `expected=670 posted=67000` → `issue: 'amount'`. Probe was red before the change and is green after it.
* **Fix:** `expectedTotal` now takes the books' currency and uses `minorUnitRate(rate, doc.currency || baseCurrency, baseCurrency)` — the same formula and the same fallback (`doc.currency || baseCurrency`) as `documentMinorRate`. `findPostingMismatches` and `postingMismatchesThrough` take an optional `baseCurrency`; `MonthEndCloseView` passes `workspace.currency`. Default `'USD'` matches the server default, so every 2-decimal book is unchanged.
* **Tests:** `src/tests/close-checklist-statuses.test.ts` — ¥100,000 → 67,000 accepted as correct; KWD 12.345 at 3.25 → 4,012 cents accepted as correct; an injected 500-cent shortfall is still found (`expected 4012 / posted 3512`).
* **Remaining risk:** a caller that does not pass `baseCurrency` while the books' currency has a different number of decimals than USD would still compare at the USD scale. All in-app callers pass it; the parameter is documented on the function. Credit notes and vendor credits are **not** covered by this check at all (see AF13-007).

### AF13-002 — Cancelled and rejected invoices/bills counted as "old receivables and payables" — **Low [Medium] — FIXED**

* **Where:** `src/lib/closeChecklist.ts`, `isOld` (item `aging`).
* **Defect:** only `paid`, `void` and `draft` were excluded. `cancelled` and `rejected` (both real `Invoice`/`Bill` statuses, and both excluded by `CLOSED_DOCUMENT_STATUSES` in `src/lib/txFilters.ts` and `NOT_POSTED` in `src/lib/postingCheck.ts`) counted as overdue after 60 days.
* **Consequence:** a cancelled invoice permanently keeps "Old receivables and payables reviewed" open → the month cannot close without a manual sign-off for money nobody owes.
* **Evidence:** the probe that was red before the fix (`aging.count === 3` for one genuinely open invoice plus a cancelled and a rejected one) is now the `AF13-002`/`AF13-003` cases of `src/tests/close-checklist-statuses.test.ts` — kept in `src/tests` rather than duplicated in `audit/`, which is where a regression test can actually stop a merge.
* **Fix + test:** one shared `NOT_OWED_STATUSES` set (`paid, void, draft, rejected, cancelled`); regression in `src/tests/close-checklist-statuses.test.ts` (count 1, detail "1 invoice or bill more than 60 days overdue").

### AF13-003 — Bank lines marked `ignored` counted as "not matched yet" — **Low [Medium] — FIXED**

* **Where:** `src/lib/closeChecklist.ts`, `unmatched` (item `reconcile`).
* **Defect:** counted `status === 'pending' || !matchedTransactionId`, so an `ignored` line (deliberately left out of the books — own-account transfer, duplicate) was reported as work outstanding, forever.
* **Consequence:** "Bank lines matched" never reaches *done* in a month containing a deliberately ignored line → sign-off needed every month; the user is told there is reconciliation work that does not exist.
* **Evidence:** same probe (red before: `unmatched === 1` with one matched and one ignored line).
* **Fix + test:** ignored lines are excluded from both the count and the "All N bank lines matched" wording; when only ignored lines exist the item reads "No bank lines left to match in this month" and is *done* (`readyToClose` returns `{ ready: true }`).

### AF13-004 — Three report screens take far longer than the one-second target, and the speed screen claimed more than it measures — **Medium [Medium] — measured; wording corrected; rendering not changed**

* **Measurement:** `audit/agent13-2026-11-11/probes/r5-all-report-views-probe.ts` mounts **every** report/register view module in `src/components/{reporting,ledger,finance}` on the 12-month sample year: **170 modules are discovered and 161 are measured** — nine are helper modules with no component export, or views that need props the shared harness does not build (e.g. `PartyReportLayout`), and they are reported as such rather than dropped (output: `r5-all-report-views-probe.output.txt`). The probe and the test now share one harness, `src/tests/helpers/reportScreens.ts`, so their numbers cannot drift.

| Scale (transactions) | Views measured | Over 1,000 ms | Slowest |
|---|---|---|---|
| 1 (1,238) | 161 of 170 found | 3 | JournalSheetReportView 1,729 ms · PaymentsView 1,520 ms · GeneralLedgerView 1,446 ms (re-run after the harness refactor: 1,840 / 1,482 / 1,470 ms — same three) |
| 4 (4,880) | 161 of 170 found | 7 | JournalSheetReportView 6,519 ms · PaymentsView 5,586 ms · GeneralLedgerView 4,884 ms · ExpiringLotsReportView 2,387 ms · AccountRegisterView 1,816 ms · TransactionsByCustomerView 1,194 ms · ItemRegisterReportView 1,148 ms (re-run: 6,390 / 5,875 / 5,116 / 2,403 / 1,774 / 1,177 / 1,275 ms — same seven) |

* **Cause is rendering, not arithmetic:** `audit/agent13-2026-11-11/probes/r5-compute-vs-render.ts` — `computeJournalSheet` 16.7 ms and `computeGeneralLedger` 17.3 ms for 4,880 entries. The screens render one card + table per entry (Journal Sheet) or one row per document with per-row document lookups (PaymentsView `documentLabel` does a linear `find` per allocation). The figures are correct; the open time is DOM work, and in jsdom that is several times a browser's.
* **Not fixed, deliberately:** Journal Sheet and General Ledger are statement screens (AI #1's lane) and the Journal Sheet is part of the A-277 print loop, so capping or virtualising rows changes what a printed report contains unless print is handled. Recommended fix for AI #1/#9: window the rows (e.g. 100 entries per page with a "show all" control that expands for printing), and replace `documentLabel`'s per-row `find` with a `Map` built once — measurement first, figures untouched.
* **Claim corrected (fixed):** `SampleYearBenchmarkReportView` said it "checks that every report — led by the five heaviest — completes well under 1,000 ms". It times **12** report computations. On the 1,238-entry year my full-surface probe finds 3 screens over 1,000 ms, so the old wording was not true. It now says it times "the N report computations it can measure… not every report screen: the browser-rendered screens are measured separately in the report-speed tests".
* **Coverage extended (fixed):** new `src/tests/report-speed-all-views.test.tsx` mounts **every** report module (≥150) on the sample year, fails if any view passes a 2,500 ms ceiling (3× on CI), and fails if a fourth screen crosses the 1,000 ms target — a ratchet over the three known slow screens instead of a chosen list. It also records, in its header, the measured numbers above.
* **Limitation:** jsdom timings are relative, not browser timings; a real browser profile in Playwright is the correct next step for these three screens.

### AF13-008 — A/R and A/P aging (and customer/vendor balances, lifetime value, FX revaluation) disagree with the ledger by 100× for 0-decimal currencies — **High [Critical for a supported-currency book] — REPORTED, not patched (AI #1's lane)**

* **Where:** `toBaseCents` in `src/server/reports/partyReports.ts` (line 14): `round(amountCents × exchangeRate)`. It is the shared converter for 40 call sites in 14 files, including `src/lib/aging.ts` (A/R aging screen, A/P aging screen, `/aging` API), `src/hooks/useEntityOperations.ts` (the stored customer/vendor `balanceCents`), `src/lib/customerLifetimeValue.ts`, `src/lib/customerCohortReport.ts`, `src/lib/algorithms/working-capital-aging.ts`, `src/lib/fxRevaluation.ts`, `src/lib/projectProfitability.ts`, `src/lib/salesByTerritory.ts`, `src/lib/chartExploration.ts`, `src/lib/invoiceApproval.ts`, `src/lib/israeliAnnualPartySummary.ts` (12), `src/server/reports/itemReports.ts`, `src/server/routes/metricsAuditRoutes.ts`.
* **Defect:** the ledger entry for a document is converted with `documentMinorRate` = rate × 10^(books' digits − document's digits) (`src/services/ledgerPost/postingCore.ts`, BM-04 in `docs/design/BM-04-currency-minor-units.md`), but these figures are converted with the bare rate. So for a **JPY** invoice in a USD book the receivable is **100× too small** in the aging/balances, and for **KWD/BHD/JOD/OMR/TND** (three decimals) **10× too large**. This is the same root cause as AF13-001, in a different helper.
* **Reachable:** `JPY` is in `WORLD_CURRENCIES` (`src/lib/exchangeRates.ts`) and `src/lib/isoCurrencyReference.ts` carries the digit table, so a user can issue such an invoice today. Both currencies round-trip through the invoice form.
* **Consequence:** the monthly A/R aging (and the customer page's "still owed") does not reconcile to the receivables control account — a silently wrong financial report, wrong customer statements, and a wrong stored customer balance after any invoice save. Rounding of the same class as G-13 ("cash, receivables, payables … agree") fails for those currencies.
* **Evidence:** `audit/agent13-2026-11-11/probes/af13-008-fx-aging-vs-ledger.test.ts` — the real `LedgerPostService` posts ¥100,000 at 0.0067 as a **67,000**-cent receivable (independent arithmetic: ¥100,000 × $0.0067 = $670), and `computePartyAging` reports **670**. Probe passes, i.e. it reproduces the defect.
* **Why not fixed here:** `toBaseCents` lives in `src/server/`, and the project's rule is that money/statement maths and `src/server/` belong to AI #1. A partial fix in `src/lib/aging.ts` would make the aging disagree with the customer balance that shares the helper, so the fix belongs in one place with one review.
* **Recommended correction:** make the helper minor-unit aware, e.g. `toBaseCents(amountCents, exchangeRate, documentCurrency?, baseCurrency?)` implemented with `convertMinorUnits(amountCents, rate, documentCurrency || baseCurrency, baseCurrency)` from `src/lib/currencyMinorUnits.ts`, then pass each document's `currency` (documents already carry it) and the workspace currency at the 40 call sites; add a golden case (¥100,000 at 0.0067 → 67,000) per report that consumes it. Until then, either restrict the currency picker to currencies whose digit count matches the books' or warn on the aging screen for those books.
* **Acceptance test:** for one JPY and one KWD invoice, aging total = the A/R control balance from the trial balance, and `syncEntityBalance` writes the same figure.

### AF13-005 — Core accounting identities hold on the sample year — **verified, no finding**

`audit/agent13-2026-11-11/probes/af13-005-report-identities.ts`, expected figures computed from raw posted lines only:

| Check | Result |
|---|---|
| Double entry: every postable entry sums to 0 | 0 unbalanced of 1,238 |
| Net income (independent revenue−expense aggregation vs `computeProfitAndLoss`) | −31,525,060 = −31,525,060 — agree |
| Trial balance: debits = credits at 2026-12-31 | 198,563,697 = 198,563,697 — balanced |
| Balance sheet at 2026-12-31: assets = liabilities + equity + net income | 51,142,751 = 51,142,751 — balanced |
| Balance sheet at 2026-06-30 (mid-year, not just year end) | 57,716,490 = 57,716,490 — balanced |
| Ledger lines on accounts absent from the chart | 0 |

**A probe bug worth recording:** my first run classified revenue only as `type === 'income'`, while this chart also uses `type === 'revenue'`; that produced a 19.7 M-cent "disagreement" that was my error, not the product's. Corrected before anything was reported. This is why expected figures are computed independently and then re-checked account by account.

### AF13-006 — The synthetic 12-month fixture cannot exercise the document-posting check — **note, no defect**

`fixture.transactions` carry **no** `metadata` (0 of 1,238), so `findPostingMismatches` reports all 360 invoices as "missing". That is a property of the fixture, not of the product; it was checked and discarded rather than reported. Suggestion for whoever owns the fixture (`src/lib/sampleBusinessYear.ts`): tag accrual entries with `{ type: 'invoice-accrual', invoiceId }` / `{ type: 'bill-accrual', billId }`, which would let the month-end posting check be exercised end-to-end in the speed and verification tests.

### AF13-007 — Credit notes and vendor credits are outside the month-end posting check — **Low [Low] — reported, not fixed**

The `postings` item claims "Every invoice and bill is in the ledger once, with the right amount"; credit notes and vendor credits (`creditNoteId` / `vendorCreditId`, types `credit-note-issuance` / `vendor-credit-issuance`) are never checked. Extending `postingCheck.ts` to them needs the issuing-side sign conventions confirmed by AI #1, so it is reported rather than patched.

## R-1 and R-5 status against the queue wording

**R-1 Month-end checklist screen** — already implemented before this session (`src/lib/closeChecklist.ts` 8 data-driven items, `MonthEndCloseView` with links per item, per-step sign-offs from the workspace's own close steps, soft/hard close through `periodCloseService`, unlock with a reason, repost action, close package export). Verified in this session by reading the code and running `close-steps`, `close-steps-ui`, `period-close`, `close-package`, `close-comparison*`, `close-journey*` tests (51/51). The three defects above were the real gaps and are now fixed. One wording difference remains: the queue lists "run P&L and balance sheet" as a step; the screen links to Reports through the trial-balance item and every workspace can add its own "print the P&L" step, so no forced item was invented. Reported, not "improved" by adding a fake tick.

**R-5 Report speed check** — **measured and extended, not met.** Every report module is now measured in a test (AF13-004); the computation layer is fast (≤17 ms); three screens (Journal Sheet, Payments, General Ledger) and four more at 5,000 entries exceed the product's one-second target because of DOM size. Not marked done: the fix is row windowing on statement screens, which is AI #1's lane.

## Commands run in this session (this branch)

| Command | Result |
|---|---|
| `npx tsc --noEmit` | pass (0 errors) |
| `npm run lint:eslint` | 0 errors, **42** warnings (cap unchanged) |
| `npm run build` | pass (vite + both server bundles) |
| `npx tsx --test src/tests/close-checklist-statuses.test.ts` | **4/4** pass (new) |
| `npx tsx --test src/tests/report-speed-all-views.test.tsx` | **1/1** pass (new; 170 modules, ≥150 measured) |
| `npx tsx --test` on fx-posting, close-steps, close-steps-ui, period-close, close-package, close-comparison(+ui), close-journey(+panel) | **51/51** pass |
| `npx tsx --test src/tests/report-speed-12m.test.tsx` | **2/3** — the A-229 leg fails on the *cold module preload* of ten screens (2,329 ms vs 1,500 ms) in this sandbox; see below |
| `npm test` (full suite, 18 files × 4 globs, `--test-force-exit`) | **4,659 tests: 4,653 pass, 1 fail, 5 skipped**, 17m30s. The **only** failure is the A-229 cold-module-preload leg above (1,521.74 ms vs 1,500 ms, 1.4 % over — it read 2,329 ms in an earlier run, i.e. this host is flaky there). Everything else, including `report-speed-all-views.test.tsx` and all close/FX suites, passed. DB/RLS suites skip without `LF_TEST_DATABASE_URL` |
| **Fork CI on `42b10bb`** (GitHub Actions, fork `Chaim-Richard/ledgerflow`) | **all 21 checks green**: Unit tests 1-4/4 · Unit tests in Pacific/Auckland 1-3/3 · Unit tests in America/Los_Angeles 1-3/3 · Browser shards 1-5/5 · Lint, Typecheck and Database rules · Production build · Playwright E2E Smoke Suite · CodeQL ×2 · CycloneDX SBOM. SonarQube Cloud reports "The last analysis has failed" — see the note below |

**SonarQube Cloud — was failing, and it was this diff: fixed (see below).** The first reading of the bot's note was wrong and is corrected here. "The last analysis has failed" was an *analysis* error on the first run; the real gate result, visible on the check run and the API, was **Quality Gate failed on two conditions: 25.1 % Duplication on New Code (limit 3 %) and a D Reliability Rating on New Code**. Both were in this PR's own new files, not in the base commit:

| Source | Duplicated lines | Cause |
|---|---|---|
| `probes/af13-001-minor-unit-repost-check.test.ts` | 29 | inline copy of the ledger-context fixture |
| `probes/r5-all-report-views-probe.ts` | 43 | inline copy of the report-screen harness |
| `src/tests/close-checklist-statuses.test.ts` | 49 | the same fixture, again |
| `probes/af13-002-003-checklist-statuses.test.ts` | 22 | near-copy of the new `src/tests` test |
| `src/tests/report-speed-all-views.test.tsx` | 43 | the same harness, again |
| `probes/af13-008-fx-aging-vs-ledger.test.ts` | 13 | the same fixture, again |

The single reliability issue was `typescript:S2871` in the r5 probe: `.sort()` without a comparator on strings. Fix in this branch: two shared harnesses (`src/tests/helpers/postingHarness.ts`, `src/tests/helpers/reportScreens.ts`), the audit probe and the two `src/tests` files now import them instead of copying the fixture, `sort()` compares with `localeCompare`, the redundant `af13-002-003` probe was deleted because `src/tests/close-checklist-statuses.test.ts` is the durable regression for the same two cases, and `probes/helpers/dom-probe.ts` is now a one-line import of `src/tests/helpers/dom`.

**Result after the fix (`2398da9`): Quality Gate passed — 0.0 % duplicated lines on new code, 0 new bugs, 0 new code smells, 0 vulnerabilities, 0 hotspots.** A second pass was still needed: after the harnesses were shared the density fell to 5.8 % because the same Yen-invoice scenario was written out in three files, so it became `JPY_INVOICE` / `jpyInvoice()` / `postJpyInvoice()` in the posting harness. The numbers below are the starting point, kept because the shape of the mistake is the useful part.

**Lesson worth keeping when reading a Sonar result:** the bot's PR comment and the check run disagree. The comment said the *analysis* failed; the check run and `GET /api/issues/search` gave the failing conditions and the exact issue. The API is readable without a token for the public project: `https://sonarcloud.io/api/issues/search?componentKeys=<org>_ledgerflow&pullRequest=<n>&types=BUG&sinceLeakPeriod=true` and `https://sonarcloud.io/api/duplications/show?key=<component>&pullRequest=<n>`.

**Standing local failure (not caused by this branch):** the A-229 subtest times the cold import of ten screen modules (Overview, Sales, Purchases, Banking, Reconcile, P&L, Balance Sheet, Trial Balance, Taxes, Settings) against a 1,500 ms budget and measured 2,329 ms in one run and 1,521.74 ms in the full-suite run here (it is right on the boundary, so this host is marginal). `CURRENT_WORK.md` records this exact leg as a sandbox/machine artefact on unmodified `main`; this branch's diff touches `src/lib/closeChecklist.ts`, `src/lib/postingCheck.ts`, one close view and one report view's text, none of which those ten screens import. It is reported, not "fixed" by raising a budget.
