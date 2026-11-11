# AI #3 — A-201 and A-202 (bilingual report help, explained totals), 22 Oct 2026

Branch `arena/4c574f50-ledgerflow`, base `main` `5a26cbd`. Both tasks are help/read-only: no money,
posting, tax maths, server, migration, reserved screen or quality-budget change.

## A-201 — Hebrew help for every report on the Reports tab

**What was missing.** Every one of the 113 rows in `REPORT_TABS_REGISTRY` already had English help
(`SCREEN_HELP.reports`), so "a report with no help" no longer existed. The gap was Hebrew: the `? Help`
dialog's עברית button showed `findScreenHelpDoc('reports')` — the *page* summary from
`helpCenterArticles.ts` — so a reader on Financial Ratios was told about reports in general, and a
reader on any other report got the same paragraph.

**What changed.**

| File | Change |
|---|---|
| `src/config/screenHelpHe.ts` (new) | `SCREEN_HELP_HE.reports`: a Hebrew description for all 113 reports, 2–4 sentences each, written from the same facts as the English entry (what the report reads, what it leaves out, what it does not prove). |
| `src/config/screenHelp.ts` | `withScreenHelp()` attaches `helpHe` beside `help`; no generic fallback, exactly like the English side. |
| `src/lib/screenHelpIndex.ts` | `ScreenHelpEntry` carries `labelHe` and `helpHe`; Hebrew help is searchable, so a Hebrew word in a description finds the report. |
| `src/components/support/ScreenHelpHeader.tsx` | The Hebrew view shows the report's own Hebrew help (heading `עזרה: <Hebrew name>`), and falls back to the page summary only when a screen has no Hebrew entry. |
| `src/components/support/AllScreensHelp.tsx` | Each description shows its Hebrew paragraph under the English one (RTL, `lang="he"`). |
| `src/tests/screen-help.test.tsx` | New guard: every registry report has Hebrew help of 2–4 sentences that is actually Hebrew, is not a copy of the English, and is not shared with another report; a second test proves the dialog no longer falls back to the page summary. |

**Honest limit:** the Hebrew sentences are a translation written against the code, not a review by a
Hebrew-speaking accountant. They are short and factual, and they repeat the English limits (a report
does not file, post or verify). A native review is welcome and cheap to apply: one file.

## A-202 — "what does this number mean?" for the ten main report totals

**New:** `src/lib/reportTotalExplanations.ts` and `src/components/reporting/ReportTotalExplainer.tsx`,
rendered once in `Reports.tsx` for the active report (nothing is rendered for a report without an
entry — no empty control).

Each explanation has four parts, in English and Hebrew: what the figure is, what it counts, what it
leaves out, and what it must not be read as proof of. The ten totals and the code each was written
against:

| # | Report | Total | Written against |
|---|---|---|---|
| 1 | P&L | Net profit | `calculateNetIncome` (`src/lib/txFilters.ts`), server P&L |
| 2 | P&L | Gross profit | same |
| 3 | Balance Sheet | Total assets | `computeBalanceSheet` (`src/server/reports/computeReports.ts`) |
| 4 | Balance Sheet | Total equity | same (equity accounts only; profit to date is separate) |
| 5 | Cash Flow | Net change in cash | `computeCashFlow` (same file) |
| 6 | A/R Aging | Total outstanding | `computePartyAging` (`src/lib/aging.ts`), document amounts due |
| 7 | A/P Aging | Total outstanding | same, bill side |
| 8 | Inventory Valuation | Total stock value | `computeInventoryValuation` (`src/server/reports/itemReports.ts`) |
| 9 | Sales Tax Liability | Tax for the period | `buildTaxReturn` (`src/lib/taxReturnDocs.ts`) |
| 10 | Financial Ratios | Current ratio | `financialRatiosReport` (`src/lib/financialRatiosReport.ts`) |

The panel is a `<details>` (`data-print-hide`), so it stays out of print and out of the way until a
reader asks; it follows the workspace language.

**Tests:** `src/tests/report-total-explanations.test.tsx` (4 tests): ten entries, each on a registered
report, English and Hebrew present and translated, the main statements covered, the panel shows only
the active report's totals, is a closed disclosure, prints nothing, renders nothing for a report
without an entry, and follows the language. `e2e/screen-help.spec.ts` gains one phone-size journey:
open a report's help, switch to עברית, read the report's own Hebrew (axe clean), then open the totals
panel and read the Current ratio explanation.

## Checks run here

- `npx tsc --noEmit -p tsconfig.json` — clean (re-run after the last edit).
- New and touched suites: `screen-help` (7 tests), `report-total-explanations` (4) and the touched
  `ai8-onboarding-help` — **22/22 pass** on the final tree.
- Guards: `capabilities-guard`, `no-orphan-modules`, `quality-ratchet`, `reachability-guard`,
  `registry-components`, `money-format-guard` — **17/17 pass**.
- **Whole unit suite** (`npm test` command, local, without `LF_TEST_DATABASE_URL`):
  **3,376 tests, 3,375 pass, 0 fail, 1 skipped** (the database suite skips without a database),
  796 suites, 1,862 s. The one skip is the Postgres-only suite; nothing in this batch touches SQL.
- **ESLint** `npx eslint . --max-warnings 205` — **0 errors, 205 warnings** (at the cap, none added).
- **Production build** — `npm run build` passes (vite + `build/server.cjs`).
- **Playwright**: not run in this sandbox (no browser); the new phone-size journey runs on CI.

## Release-gate effect

These tasks do not change a W-row's Connected/Verified/Browser status. They support **G-02 (one first
hour without dead ends)** by making the `? Help` dialog tell the truth about the screen the reader is
on, in the reader's language, and by naming what each headline total does not prove.

## Small Hebrew label fixes on the way (same file, same branch)

While reading every report's Hebrew name I found two labels from my own earlier stock work that
called a lot "סידות" instead of "אצווה": `expiring-lots` (now **אצוות שפג תוקפן**) and
`serial-lot-lookup` (now **חיפוש מספרים סידוריים ואצוות**). Labels only — no behaviour, and no test
referred to the old strings. If a reader preferred the old wording, it is a one-line revert each.
