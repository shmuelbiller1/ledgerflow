# UI-2 · The final 42 raw-table files

Based on `98b60c5` (queue at that commit), one pull request migrating every file in
`src/tests/fixtures/raw-table-migration-queue.json` — 52 table sites across 42 files, including the
eight files that overlap open #946, without touching #946's CSV currency behaviour. With this batch
the queue is empty and `rawTables` is **2**: `PivotSheetView` (the dynamic pivot) and `RowTable`
(the shared embedded-table renderer itself). No financial formula, posting implementation or server
endpoint changed.

| Independent measure | Base `98b60c5` | This batch |
|---|---:|---|
| Component files containing raw tables | 84 | 2 (pivot + renderer) |
| Queued screen files | 42 | 0 |
| Codemod: directly convertible / refused | 39 sites / 13 sites | 0 / 0 |
| Hand-typed API / direct database writes / many-primary-button screens | 5 / 0 / 0 | 5 / 0 / 0 |

39 sites in 33 files were converted by `scripts/codemod-row-table.ts --write` (refusal reasons in
the codemod's `--files` report); the remaining 13 sites were converted by hand: TaxManager,
DiscountMismatchView, CustomerCohortsReportView, PeriodClosingPanel (×3 tables), StockSourcesUses
(+ its orphaned-notes tail), LabelBalanceSheet, LabelProfit, GroupSummary (×2), StatementColumns,
TrialBalanceView (the token-substitution template), StatementImporter's CSV preview — plus
`RowTable` itself gained `rowProps`, `headerRowClassName`, `bodyEnd` and the `GroupedRowTable`
export, and `src/lib/tableBands.ts` (Bands/BandCell/BandRow/RowGroup) now describes multi-head,
grouped and footered tables declaratively.

## How to verify

- **Unit gates:** `npm run lint` (tsc + eslint clean), the ratchet tests
  (`raw-table-decisions.test.ts` asserts the remaining raw-table set is exactly RowTable +
  PivotSheetView; the queue fixture is `[]`; `quality-baseline.json` says `rawTables: 2`), and the
  132-file affected unit run — 973 tests, 971 pass on a quiet machine. The failures are the
  three CPU-timing budgets, and they are environmental, not regressions: this sandbox's timings
  drifted over the four-hour session, and re-run under the same degraded conditions the **base
  commit fails the same three tests with worse numbers** — A-229's 10-module load takes 7,947 ms
  on base vs 4,032 ms on this branch, A-206 takes 14.6 s on base vs 9.5 s here, and R-5's
  slowest view (InboxView, which imports nothing from this batch) sits at 1,047–1,458 ms on both
  commits, bouncing run to run while the whole slowest-list rotates. CI gets a 3× budget for
  these.
- **Browser gates:** `npx playwright test e2e/final-queue-visual.spec.ts e2e/final-queue-journey.spec.ts`
  — 176 tests. Every screen of this batch opens on its production route against one deterministic
  book (`e2e/helpers/finalQueueBooks.ts`: the 12-month sample year the benchmark report uses, plus
  the journal transaction, tax rates, rules and a second book that screen needs), in both themes at
  390 and 1280, with axe (all rules but `color-contrast`, whose emerald/rose money-cell findings
  predate this batch and fail on the base commit too) and with the worked figures of that book
  asserted on screen. The 390-light and 1280-dark combinations run in Hebrew/RTL. Four interactive
  pieces the guest sample cannot populate — the practice register (a signed-in server command), the
  bank-statement import preview, a report figure's drill-down, and the document line editor — are
  mounted from their real production modules in `final-queue-journey.spec.ts` on the shared journey
  fixture with stubbed network. The remaining file, `QBOMigrationWizardView`, is covered by
  `j2-qbo-migration-shared-csv.test.ts`'s populated tables.
- **Before/after evidence:** the same two specs run against the base commit (with the six a11y
  rules this batch fixed disabled) also pass 176/176, and `LF_FINAL_EVIDENCE=<dir>` records each
  viewport's visible tables and phone cards as text. Of the 176 dumps, **144 are byte-identical**;
  the 32 that differ differ only by: the grid lists rendering the app's standard phone cards at 390
  (base printed squeezed tables), virtualised/paginated grids showing their first page where the
  base hand table rendered every row (the payments register still pages on screen and prints all
  rows), the cohort month headers now reading `חודש 0…` in Hebrew (the translation fix), the
  custom-fields table's previously empty header cell now reading the screen-reader-only "Actions",
  and the benchmark screen — its two timing tables are ordered by the live measurement and its
  intro sentence embeds the live maximum, so those bodies and that sentence are masked out of its
  pixel comparisons while the headers and the static monthly-counts table are still compared.
- **#946 overlap:** the eight shared files keep their CSV currency behaviour — the CSV columns are
  built from the same specs the table renders, and `discount-mismatch`, `label-*`,
  `party-*`, `stock-sources-uses`, `import-acceptance`, `profitability-by` and
  `sample-year-benchmark` money figures above are asserted in the app's own format on screen.

## Six findings the new coverage surfaced (all fixed here, all pre-existing on the base commit)

1. `CustomFieldsSettings` — the remove column's header cell was empty (base and branch); it now
   reads a screen-reader-only "Actions" without changing a pixel.
2. `SampleYearBenchmarkReportView` (three tables) and `CustomFieldsSettings` (two) gave every
   `ReportTableScroll` region the same label; they now pass `nameFromCaption`, the mechanism the
   already-verified report screens use, so `landmark-unique` passes.
3. `Ledger.tsx`'s brass button said "Add account" while reading "Append Node" on screen; its
   accessible name now contains its visible text.
4. `TrialBalanceView`'s print button's Hebrew label did not contain the visible word ("הדפסה" vs
   "הדפסת מאזן הבוחן"); the name now starts with the visible word.
5. `StatementImporter`'s preview scroll and `DimensionsSettings`' per-label value tables scrolled
   without being keyboard-focusable at phone width; both now carry the repo's established
   region + tabIndex pattern.
6. `RowTable` rendered a guarded footer (`footer={cond && <tr>…}`) as an empty `<tfoot>` when the
   condition was false; a false footer now renders nothing, like an omitted one — this was the
   party-report-layout SIGKILL: an empty tfoot with column reordering recursed forever.

Also recorded, not fixed (identical numbers on the base commit, measured with the same probe): the
customer portal page itself scrolls sideways at 390 (its invoices table's min-content is wider than
the viewport), and `#main-content` scrolls wide report tables sideways internally at 390 — the
page-level check in the spec mirrors `visual-regression.spec.ts` and passes; the portal's
pre-existing sideways state is pinned in the spec comment.

## What to look for

| Screen | Expected result |
|---|---|
| Statement | Beacon Market Group 1: INV-2026-0001 dated Jan 2, 2026, $195.93 paid; reference numbers in the row-header cell, all body cells plain `td`. |
| Payments register | newest first: Dec 27, 2026, card +$431.66; pages on screen, prints all rows. |
| Trial balance | 20 accounts, Operating Checking first; print button labelled with its visible word. |
| Fixed assets | Electric Reach Forklift FA-2026-001, bought Jan 5, 2026, $48,000.00, straight line, book value $48,000.00. |
| Ledger & journal | Accountant Lens → General Journal: the worked February depreciation adjusting entry, $700.00 debits. |
| Estimates | newest first: EST-2026-0060, Dec 19, 2026, $306.90. |
| A/R aging | Beacon Market Group 11 owes $340.20 in the 1–30 bucket; $17,111.87 total outstanding as of Dec 31, 2026. |
| Customer cohorts | month headers read Month 0… in English, חודש 0… in Hebrew; 2026-01 cohort rows. |
| Customer portal (signed out) | Invoices for Beacon Market Group 1: $560.36 still to pay, INV-2026-0271 overdue. |
| Settings → Import data | the E-36/E-37 preview keeps source values uppercase/local until explicitly accepted (unit-pinned). |

## Review images

Before: the base commit's actual populated 1280-light viewport (`LF_FINAL_EVIDENCE` run). After:
the screenshots the spec writes on CI. All 176 combinations are in `e2e/__screenshots__/finalq-*`;
a subset is linked here.

| Screen | 1280 light |
|---|---|
| [StatementView](../../src/components/reporting/StatementView.tsx) | [before](images/ui2-final-42/statement-1280-light-before.webp) · [after](../../e2e/__screenshots__/finalq-statement-1280-light-chromium-linux.png) |
| [TrialBalanceView](../../src/components/ledger/TrialBalanceView.tsx) | [before](images/ui2-final-42/trial-balance-1280-light-before.webp) · [after](../../e2e/__screenshots__/finalq-trial-balance-1280-light-chromium-linux.png) |
| [CustomerCohortsReportView](../../src/components/reporting/CustomerCohortsReportView.tsx) | [before](images/ui2-final-42/customer-cohorts-1280-light-before.webp) · [after](../../e2e/__screenshots__/finalq-customer-cohorts-1280-light-chromium-linux.png) |
| [PaymentsView](../../src/components/finance/PaymentsView.tsx) | [before](images/ui2-final-42/payments-1280-light-before.webp) · [after](../../e2e/__screenshots__/finalq-payments-1280-light-chromium-linux.png) |
| [FixedAssetsView](../../src/components/assets/FixedAssetsView.tsx) | [before](images/ui2-final-42/assets-1280-light-before.webp) · [after](../../e2e/__screenshots__/finalq-assets-1280-light-chromium-linux.png) |
| [Ledger (journal)](../../src/components/ledger/JournalView.tsx) | [before](images/ui2-final-42/ledger-1280-light-before.webp) · [after](../../e2e/__screenshots__/finalq-ledger-1280-light-chromium-linux.png) |
| [EstimatesView](../../src/components/sales/EstimatesView.tsx) | [before](images/ui2-final-42/estimates-1280-light-before.webp) · [after](../../e2e/__screenshots__/finalq-estimates-1280-light-chromium-linux.png) |
| [CustomerPortalPage](../../src/components/sales/CustomerPortalPage.tsx) | [before](images/ui2-final-42/customer-portal-1280-light-before.webp) · [after](../../e2e/__screenshots__/finalq-customer-portal-1280-light-chromium-linux.png) |
| [ARAgingReportView](../../src/components/reporting/ARAgingReportView.tsx) | [before](images/ui2-final-42/ar-aging-1280-light-before.webp) · [after](../../e2e/__screenshots__/finalq-ar-aging-1280-light-chromium-linux.png) |
| [TaxManager](../../src/components/finance/TaxManager.tsx) | [before](images/ui2-final-42/taxes-1280-light-before.webp) · [after](../../e2e/__screenshots__/finalq-taxes-1280-light-chromium-linux.png) |
| [ImportSettings](../../src/components/platform/settings/ImportSettings.tsx) | [before](images/ui2-final-42/settings-import-1280-light-before.webp) · [after](../../e2e/__screenshots__/finalq-settings-import-1280-light-chromium-linux.png) |
