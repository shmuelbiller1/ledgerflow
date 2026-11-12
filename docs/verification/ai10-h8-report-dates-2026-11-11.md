# H-8 (AI #10) — the reader's date format did nothing on report headers

Date: 11 Nov 2026. Branch: the Arena session branch, based on `c82bead4` (main after #666).
Lane: daily screens (display only — no figure, filter, stored value, CSV, tax or `src/server/` code).

## The defect

Preferences → **Date Display Format** (`useUIStore.dateFormatPref`, persisted as `lf_date_format`)
is read by `formatDate()` and used by 118 call sites — the transaction grid, ledgers, documents. The
**report header** ignored it. `ReportPeriodHeading` resolved dates from the *locale* only
(`moneyDisplay.locale` → `language` → `en-US`), so a reader who chose `YYYY-MM-DD` or `DD/MM/YYYY`
got `Oct 1, 2026` on the report heading and `2026-10-01` in the rows beneath it: one page, one day,
written two ways. Two report lines also printed the **stored ISO string** with no formatting at all:

| surface | before | now (reader chose `DD/MM/YYYY`) |
| --- | --- | --- |
| Profit & loss / balance sheet period line (`StatementColumns`) | `2026-10-01 to 2026-10-31` | `01/10/2026 – 31/10/2026` |
| Statement column headings | `2026-10-01 – 2026-10-31` | `01/10/2026 – 31/10/2026` |
| General ledger print title/period | `2026-10-01 to 2026-10-31` | `01/10/2026 – 31/10/2026` |
| General ledger row dates | `2026-10-01` (raw field) | `01/10/2026` |
| Report pack cover, section headings, aging/stock notes | `2024-01-01 – 2024-01-31` | `Jan 1, 2024 – Jan 31, 2024` |

## The fix

- `src/lib/reportLocale.ts`: `reportLocaleFor()` (the reader's format, else the locale — unchanged
  for a reader who never opened Preferences), `reportDateTextFor()` and `reportPeriodTextIn()`.
  The numeric layouts are written from the date's own parts, zero-padded, exactly as `formatDate()`
  writes them; `Intl` has no option set that prints `2026-10-01`, so a "numeric-looking" locale
  would have kept printing `Oct 1, 2026`.
- `src/components/reporting/useReportDates.ts` (new): one hook resolving `{ locale, dateFormat,
  dateText(), periodText() }` from the two stores, so a report and the rows under it cannot
  disagree. Kept out of the component file so that file exports only a component.
- `ReportPeriodHeading` now uses the hook (its own output is unchanged when no format was chosen).
- Applied to `StatementColumns` (period line, column headings, drill-down sentence),
  `GeneralLedgerView` (print title/period and row dates) and `ReportPackDialog` (cover, section
  headings, aging and stock notes) — the three headers this task's brief names. Case kept: a
  drill-down **filter** and every **CSV file name** keep the stored ISO date (data, not a page).

## Tests

- `src/tests/report-locale.test.ts`: +4 checks (hand-worked strings for the four layouts, unknown
  preference falls back to the locale, the rendered heading in each layout, and the statement
  period line rendering `01/10/2026 – 31/10/2026` with no `2026-10-01 to`).
- `src/tests/report-date-display-guard.test.ts` (new): a source-level guard over every report and
  ledger view — a reader-visible interpolation of a date-named field that does not go through the
  resolver fails. The three fixed files must stay clean; everything the scan still sees is a
  **ratchet** in `src/tests/fixtures/report-date-backlog.json` (87 files): a new offender fails,
  and a fixed file must be removed in the same commit. It ignores form `value`/`min`/`max`,
  `dateTime=`, CSV/URL templates and `toLocale*`.
- `src/tests/report-pack-ui.test.tsx` and `e2e/report-pack.spec.ts`: two assertions pinned the raw
  ISO string (`It is not a historical balance at 2024-01-31`). The **date is unchanged** (31 Jan
  2024); only its written form is, so the expected text is `Jan 31, 2024`. Changed deliberately and
  called out here rather than quietly: no figure, total or filter moved.

## What this does NOT do

- The remaining 87 files in the backlog still print a stored date on some line (most are report
  tables showing a row's `date` field). That is real, it is visible, and it is now counted and
  cannot grow. It is not money and not this task's three headers; each file needs its own look.
- The month-name case still says `Oct 1, 2026` for an `en-US` workspace even when the reader's
  format is `DD/MM/YYYY`… no: it says `01/10/2026`. The **`MMM DD, YYYY`** choice keeps month
  names by design (that is what the choice means), so an `en-GB` workspace reads `1 Oct 2026`.
- Printable PDFs generated on the server (invoice/statement PDFs) are outside this lane.

## Checks run (this branch)

| check | result |
| --- | --- |
| `npx tsc --noEmit` | pass, 0 errors |
| `npm run lint:eslint` | 0 errors, 2 warnings (both pre-existing in `src/server`; the repo cap on this base is 12) |
| focused suites (report-locale, report-date-display-guard, report-pack-ui, statement-columns, l123-step5a GL, report-period, report-period-layout, report-date-sync, print-root, print-root-guard) | 58/58 pass |
| `npm run build` | pass (`dist`, `build/server.cjs`, `build/api.cjs`) |
| `npm test` (whole suite) | 4,881 tests: 4,873 pass, **2 fail**, 6 skipped. Both fail on unmodified base in this sandbox too (R-5 ledger mount and the A-229 cold-module-load timing); no budget or expected number was touched. This task's own first draft made R-5 worse (7,144 ms) and the cached formatter brought it back to the baseline — see the H-7 note. |
| `npm run test:e2e` | **not runnable here** (no Chromium download in this sandbox); the report-pack case is updated but CI-only |

## Residual risk

- A reader with a saved preference of `MMM DD, YYYY` (the default) sees exactly what they saw
  before, so this is invisible to most workspaces — the change is for the readers who chose
  otherwise, which is who the task was about.
- The guard is textual: a cleverly split expression could slip past it. It is a ratchet, not a
  proof, and it says so in its docstring.
- `data-report-locale` on the heading still reports the locale, not the chosen layout; a screen
  reader gets the right text but a test asserting the attribute will not see the format. Left as
  is to avoid breaking A-220's contract.
