# A-109 — US sales-tax holiday calendar (verification)

**AI #3 (Arena), read and built 2026-10-20.** Branch `arena/2cf812b8-ledgerflow`, PR #229.
Deliverables: `src/lib/tax/usSalesTaxHolidayCalendar.ts`, the calendar section of
`src/components/reporting/SalesTaxHolidaysReportView.tsx`, `src/tests/us-sales-tax-holiday-calendar.test.ts`
(6) and 1 added test in `src/tests/sales-tax-holidays-view.test.tsx` (4), catalog entry, CAPABILITIES row 200.
Nothing here posts, files, pays or calculates tax, and no rule was added or changed.

## What the task actually needed

A-58 already shipped the states whose *items and caps* were read (`usSalesTaxHolidays.ts`: Texas
back-to-school 2025/2026, Texas emergency-prep 2026, Florida back-to-school 2025/2026 — 5 dated rows and
15 bands, which become 5 rules) and its screen. The rule pack's gap list carried one row saying "every other state's holidays
(about 20 states)" — no dates for anyone else. A-109's queue line is "*Sales-tax holiday calendar for the
states that have them*", so the delta is **date-grade rows for the other states**, not more taxability rules.

The one design decision worth the lead's attention: a row in `US_SALES_TAX_HOLIDAYS` **always becomes a
Rule** (`usSalesTaxHolidayPack()` maps every row with `holidayRule(row)`). Adding "Connecticut, Aug 16–22,
everything" there would have created a rule exempting *all* sales in Connecticut for a week. So the calendar
is a **separate table** with no `bands` field, and a test proves the separation:

- no calendar-only window produces a rule id in the pack (`us-holiday-<id>` must not exist), and
- the pack still has exactly 5 rules, one per A-58 row — the count A-109 left untouched.

## What is in the table

33 windows: **21 states and Puerto Rico with a 2026 window** (32 windows) plus Puerto Rico's already
published 8–9 January 2027 window and Skagway AK's municipal season (1 Oct 2026 – 31 Mar 2027). Per row:
state, holiday name (stable across years), inclusive `from`/`to`, `kind`, the state's own recurrence `pattern`
where one is published, `source` (authority + url + the day it was read), the state's `statePageUrl`, and a
note carrying what the publication says about items and limits without turning them into bands.

`kind` is split three ways because the relief is not the same thing:

| kind | meaning | rows |
|---|---|---|
| `exempt` | qualifying items carry no sales tax in the window | 30 |
| `reduced-rate` | the rate falls; it is **not** zero and local tax may still apply | Illinois 7–16 Aug (6.25% → 1.25% state, **no local relief**), Skagway AK (municipal 5% → 3% by season) |
| `restricted-purchaser` | only a named class of buyer is relieved | Nevada National Guard weekend 30 Oct – 1 Nov |

Recording Illinois as `exempt` is the mistake this split exists to prevent: a till that zeroes Illinois tax
for that week **under-collects** the 1.25% state rate and every local rate. The note says so and a test
asserts the kind and that wording.

`statuteDerived` marks the one row the compilation flagged as *calculated from the recurring rule because the
agency's page had not been updated* (Skagway's season); the screen shows that warning rather than passing the
date off as announced.

## Sources, and how honestly they are labelled

Primary read today: **Federation of Tax Administrators, "2026 Sales Tax Holidays"**
(`https://taxadmin.org/2026-sales-tax-holidays/`, the association of the state revenue agencies, its own
research dated July 2026; read 2026-10-20, both table chunks). It lists each state's own page beside each
row, and those urls are copied into `statePageUrl` — except South Carolina, whose row the source states
**without a link**, which is said in that row's note and asserted by the test.

`statePageRead: true` is used **once**, where this change actually opened the state's page:
**Virginia** (`https://www.tax.virginia.gov/virginia-sales-tax-holiday`, read 2026-10-20: "August 7-9, 2026
… starts the first Friday in August at 12:01 am and ends the following Sunday at 11:59 pm", with school
supplies $20 or less, clothing and footwear $100 or less, generators $1,000, chainsaws $350, chainsaw
accessories and other specified hurricane items $60, Energy Star/WaterSense $2,500). The module checks that a
row claiming a state-page read is *sourced from that page*, not from the compilation.

Two secondary sources were consulted only to catch errors, and neither is cited by a row:

- **Near-miss, resolved against the state:** a widely-copied commercial calendar dates Virginia's 2026
  holiday **August 1–3**. The Department says August 7–9 and publishes the rule (first Friday in August) that
  fixes it for any year. The row's note records the wrong date in circulation; the anchor in
  `usSalesTaxHolidayCalendarProblems()` pins the right one.
- **Year confusion:** Tennessee appears in circulation as **July 24–26** and **July 25–27** — those are the
  2025 weekend (last Friday of July). 2026 is **July 31 – August 2** (FTA, citing the TN Department). The note
  says both, plus the two things shopping guides still get wrong: Tennessee's gun-safe holiday became a
  **permanent year-round exemption on 1 Nov 2023** (not a dated window) and the 2023 grocery suspension was a
  **one-time event** (not a recurring holiday). Alabama's severe-weather window also appears as Feb 21–23 in
  one secondary source against **Feb 20–22** in the compilation read here; the compilation's date is used and
  the state's fact-sheet link is on the row.

## The two tables cannot drift

The test *shares its dates with the rule table wherever the two state the same window* — for every id both tables state, `from`/`to` must be equal (today:
`tx-back-to-school-2026` 7–9 Aug, `tx-emergency-prep-2026` 25–27 Apr, `fl-back-to-school-2026` 20 Jul –
20 Aug). And every A-58 row in a year the calendar covers must have a calendar row of the same id, so the
calendar can never quietly lose a state that already has rules. `usSalesTaxHolidayCalendarProblems()` pins
five anchors (VA, TX, FL, WV, IL) so a silent edit to a date fails the run rather than a client's filing plan.

`usSalesTaxHolidayPack`'s gap list was rewritten to point at this table (and the Texas water-efficient row now
says its **dates** are stated while its **product list** is not) — prose only, no rule changed, which
`lint:rule-packs` (584 rules, 0 problems) and `diff:rule-packs` confirm.

## Deliberately not stated

`HOLIDAY_CALENDAR_NOT_STATED` (4 rows, rendered in the screen) keeps the table honest: Florida's two
disaster-preparedness windows (the 2026 compilation lists Florida's back-to-school and
hunting/fishing/camping windows but not those), Alabama's food holiday (May 1 – June 30 2026 in two
professional summaries, absent from the compilation read here, and it suspends only the **state** tax),
every state's 2027 windows except Puerto Rico's, and the items and caps for every calendar row here.

## The screen

Added to Reports → Sales tax holidays, under the A-58 table: a year select (it offers only years the table
has), "next window dated after the checker date", the windows grouped by the month one **starts** in (Florida's
20 Jul – 20 Aug window is listed once, under July) with kind, pattern, warnings, the state-page link and the
note, then the not-stated list, then the source line saying how many rows were read from a state page.

It is a **list, not a second table**, on purpose: `sales-tax-holidays-view.test.tsx` reads
`screen.getByRole('table')` and `getAllByRole('table')` and the CSV button is the *rules* table's export, so a
second `<table>` would break the existing screen contract. The added test asserts
`getAllByRole('table').length === 1` so the next person is told, not surprised.

## Runs

| check | result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm run check:tax-tables` | 46 modules · 29 tables · 1,131 rows · **0 problems** (the catalog now carries `US_SALES_TAX_HOLIDAY_CALENDAR` in `holiday` mode, keys `state`+`name`) |
| `npm run lint:rule-packs` | 584 rules · **0 problems** — no rule added, no rule changed |
| `npm run diff:rule-packs` | 195 added / 0 ended / 4 changed against the 2026-10-12 snapshot, all from other lanes' work in main; **nothing from A-109** |
| guards + screen-help + registry + sales-tax + calendar (55 files) | **101/101** |
| `us-sales-tax-holiday-calendar.test.ts` | **6/6** |
| `sales-tax-holidays-view.test.tsx` | **4/4** (3 pre-existing, unchanged; 1 new) |
| US/IL/tax/golden batch | **286/286** |
| `npm run lint:eslint` | **0 errors / 210 warnings** — cap unchanged, nothing raised |
| `npm run build` | exit 0 |

## What GitHub CI ran, what failed there, and what it turned out to be

`gh pr checks 229` / `gh run list --branch arena/2cf812b8-ledgerflow --workflow CI` on 2026-10-20:

- the only completed **CI** run on this PR is **39361700201, on head `a2a2e0dd`** — i.e. A-99 + A-100 + main's
  lint fix, *before* A-102, the mileage fix and A-109. It **failed in exactly two jobs**:
  `Unit tests in Pacific/Auckland` (10m44s) and `Unit tests in America/Los_Angeles`; `Production build`,
  both Playwright browser shards and `Playwright E2E Smoke Suite` passed, and **CodeQL security scanning
  passed**. An earlier run (39361691143, head `e1f9ac4f`) was `cancelled` by `ci.yml`'s own concurrency rule.
- **No CI run exists for `88ce2d76` or `90156b72`.** Later pushes did not create runs, and this sandbox's
  GitHub token cannot start one: `gh workflow run ci.yml` answers `403 Resource not accessible by
  integration`. So the CI signal on the final head needs a re-run or any push from the lead.
- The CI log itself is unreadable from this sandbox: job logs are served from
  `*.blob.core.windows.net`, which is outside the allowed hosts, so every download ends in EOF. **So the
  failure was reproduced locally instead** — `npm test` is what those jobs run — and that found the real
  cause, which is not a timezone problem at all:

  ```
  not ok - should not regress against quality-baseline.json
    error: "Quality regression detected for 'untestedViews': current value 45 exceeds baseline 44"
  ```

  `scripts/quality-metrics.ts` counts a report view as covered when its registry `componentName` is quoted
  in some `e2e/*.spec.ts`; **A-102's new `IlSelfEmploymentNiReportView` had no row in
  `e2e/view-registry-coverage.spec.ts`**, so the branch sat one above the ratchet baseline in every
  timezone. Fixed by adding that row (the spec's own convention: label + componentName) — `untestedViews`
  is back to 44, `quality-ratchet.test.ts` passes, and the baseline file was **not** touched or raised.
  Both mileage rows are worth noting for the lead: `MileageRatesReportView` (A-108) sits inside the
  baseline's 44 and is still untested by the browser specs — one row would take the metric to 43.
- **Attribution I could do locally, and did:** both timezone jobs are `npm test` with `TZ` set. Every file
  this branch touched passes under both failing timezones — 50/50 (`us-sales-tax-holiday-calendar`,
  `sales-tax-holidays-view`, `us-sales-tax-holidays`, the two A-102 files, `il-eilat-area-facts`,
  `il-osek-patur-ceilings`, `registration-threshold-watch-report`, both mileage files, `rule-coverage-view`,
  `delivery-note-document`) under `Pacific/Auckland` **and** `America/Los_Angeles`, and a wider 157/157 of
  every `il-*`, `tax-*`, `golden-*` and date-behaviour test (`local-date`, `date-display`, `calendar-dates`,
  `report-date-sync`, `hebrew-data`, `pcn874-draft`) under `Pacific/Auckland`. Main's newest CI run
  (39361963636) succeeded 30 minutes later. Nothing in A-99/A-100/A-102/A-109 reads `new Date()` or the
  machine timezone — all four modules compare `YYYY-MM-DD` **strings**, which is what makes them
  timezone-immune, and the data rows carry no `T00:00:00` timestamps that a timezone shift could move.
  (A full `npm test` under `TZ=Pacific/Auckland` is what named the failing test; `MileageRatesReportView`
  and 43 other views are the pre-existing untested set the baseline already carried.)

**So, plainly: the red on this PR was AI #3's, it was the quality ratchet and not a timezone, and it is
fixed** (`e2e/view-registry-coverage.spec.ts` gained the row A-102's new view needed; `untestedViews` is back
to 44 with `quality-baseline.json` untouched). Nothing in it came from A-109 — the calendar adds no view id,
so it cannot move that metric, which is also why the fix belongs to the A-102 commit's coverage, not this
task's data. A CI run of the final head is still the confirmation the lead should look at before merging:
the browser shards now mount the A-102 tab for the first time, and Playwright cannot be run in this sandbox.

## For the lead

1. **A-58's rule table is now the bottleneck, and it is small.** 30 of the 33 windows have no bands, so no
   taxability rule. Each needs its state's publication read into `usSalesTaxHolidays.ts` (Connecticut's
   $300 limit is a 2026 change; Alabama's caps are now CPI-indexed under Act 2025-309; Maryland's backpack
   relief is the *first $40*, which a per-item cap cannot express; Missouri exempts the first $1,500 and
   taxes the remainder; New Mexico's Small Business Saturday depends on the **seller**, which no band shape
   can carry either). Those are data rows and one `bands` entry each — but the last two show the band model
   needs a "partial exemption"/"per-seller" shape before some states can be stated correctly.
2. **Nothing in this lane files a holiday.** A holiday changes which sales are taxable inside the window; the
   return still reports the period, so `usSalesTaxReturn` needs no change and got none.
3. **This table needs a refresh each spring.** Most states publish next year's dates in spring/summer; the
   rows carry `source.retrieved` (2026-10-20) so a stale year is visible, and the 2027 select on the screen
   shows one row rather than pretending to be complete.
4. Playwright specs (including `e2e/view-registry-coverage.spec.ts`) cannot run in this sandbox — no browsers
   installed and the Vercel preview is deliberately paused by the owner. No registry id was added here, so the
   e2e registry list is unaffected; CI on the PR is the browser-side confirmation.
