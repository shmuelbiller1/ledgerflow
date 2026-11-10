# AI #3 — A-102: Israel, self-employed National Insurance rate table by income band

Date 2026-10-20 · branch `arena/2cf812b8-ledgerflow` (from main `8c89f9c0`) · PR #229 · lane: tax data, **calculation status only**.

## What the task asked, in its own words

> A-102 Israel: National Insurance (Bituach Leumi) self-employed rate table by income band
> (calculation status)

The queue line carries no more than that. The reading used here: **a dated table of the bands and the
rates the Authority publishes for a self-employed person**, plus worked figures a reviewer can check
by hand, and nothing that files, pays or assesses. Two things had to be decided before writing:
what "by income band" means in this law, and what the table is *for* — because the app has no
National Insurance code at all yet (searched: no `nationalInsurance`, no `Bituach`, no
`selfEmployment` in `src/`, so there was nothing to extend and nothing to duplicate).

## The shape of the rule, as the Authority publishes it

A self-employed person's **monthly** income is split at one grade, not marginals of a bracket table:

- the part **up to the reduced-collection grade** (סכום לשיעור מופחת) is charged at the reduced rates;
- the part **above it, up to the maximum assessable income** (הכנסה מרבית), at the regular rates;
- **nothing** is charged above the maximum;
- income **below the minimum assessable income** (הכנסה מזערית) is charged *as if it were the minimum*,
  so a weak month still buys continuity of insurance;
- two contributions ride on that same split — National Insurance (דמי ביטוח לאומי) and health
  insurance (דמי ביטוח בריאות) — each with its own reduced and regular rate.

| from | minimum / month | reduced grade | maximum | NI | health | together, reduced / regular |
| --- | --- | --- | --- | --- | --- | --- |
| 2025-02-01 | ₪3,134 | ₪7,522 | ₪50,695 | 4.47% / 12.83% | 3.23% / 5.17% | 7.70% / 18.00% |
| 2026-01-01 | ₪3,442 | ₪7,703 | ₪51,910 | 4.47% / 12.83% | 3.23% / 5.17% | 7.70% / 18.00% |

## The finding that shaped the module: an advance is not the liability

The Authority charges a **monthly advance** (מקדמה) during the year and settles (תיקון מקדמות) after the
income-tax assessment, and **the settlement is smaller**: section 345 of the National Insurance Law
cuts **52% of the National Insurance contribution itself** out of the income before the rates are
applied, which makes the base a fixed point. The Authority publishes the closed formula and a worked
example, so both numbers are implemented, in two functions with two names:

| | what it is | 2026, ₪12,000 a month |
| --- | --- | --- |
| `ilSelfEmploymentNiMonthlyAdvanceCents` | the rates on the income, clamped to the minimum/maximum assessable income | **₪1,366.59 a month** (₪1,367 rounded to the shekel the Authority uses) |
| `ilSelfEmploymentNiPeriodSettlementCents` | its formula: quarterly base **₪34,690.20** (the Authority prints 34,690), reduced part ₪23,109.00, regular part ₪11,581.20 (it prints 11,581), NI ₪2,518.84, health ₪1,345.17 | **₪3,864.01 a quarter** — the Authority's own example says **₪3,864** |

A test asserts all of those. The advance for the same quarter is ₪4,099.77, so **treating an advance as
the liability overcharges by about 6%**; the test asserts the direction and the size of the gap, and
the screen shows both lines under one income box so a reader cannot confuse them.

Two independent anchors confirm the *advance* half of the table, and they are why the structural lint is
worth having: the Authority's 2026 circular publishes the advance floor and ceiling as **₪265** and
**₪8,550** a month. `ilSelfEmploymentNiProblems()` recomputes the advance on the row's own minimum and
maximum income and requires both to come out at those published figures — a row whose rates or amounts
drift fails the check, not just a date-format check. (Both are reached at whole-shekel precision, which
is how the Authority publishes advances; `ilSelfEmploymentNiRoundToShekelCents` is the one-line bridge
and the exact agorot — 26,504 and 855,039 — are asserted separately so nobody reads the rounding as a
fudge.)

## Sources — every figure read from the Authority today

- `btl.gov.il/…/Self_Employed/Pages/rates.aspx` — the 2026 percentages and amounts, "החל מ- 01.01.2026".
- `btl.gov.il/Mediniyut/GeneralData/rates_1954_2007/Hachnasa/Pages/ovedAtzmaii.aspx` — the Authority's
  own table of minimum / reduced-grade / maximum monthly income **per commencement date, back to 1986**.
  The 2025 and 2026 amounts come from here.
- `btl.gov.il/Insurance/Health_Insurance/…/שיעורי דמי ביטוח בריאות.aspx` — the health rates with **their
  own dates**: 3.23% from 01.01.2025 and 5.17% from 01.02.2025, the grade 7,703 from 01.01.2026.
- the 2026 advances circular (`…מקדמות ודמי ביטוח לעצמאים 2026__.pdf`) — the three amounts, the yearly
  sums 41,304 / 622,920 (= 12 × the monthly ones) and the advance floor/ceiling 265 / 8,550.
- `btl.gov.il/…/Self_Employed/Pages/hishov.dmey.bituach.aspx` — section 345, the 52%, the formula and
  the worked example this module reproduces.
- corroborating, recorded as such in the rows: the Authority's 2025 budget document (reduced band 4.47%
  up to ₪7,522) and the Knowledge Center (Kol Zchut) page of February 2026 (same grade and ceiling, and
  the 18% maximum). The Knesset-style caveat applies: the budget PDF was read as an **excerpt returned by
  search**, not opened in full, and the row says so.

## Decisions a reviewer should see

1. **The 2025 row begins on 1 February, not 1 January.** The Authority's own page dates the two health
   rates to different days (3.23% on 1 Jan 2025, 5.17% on 1 Feb 2025), and no page read here gives the
   upper-band health rate for January 2025. One day-range therefore has **no row** rather than a guessed
   figure; `ilSelfEmploymentNiProblems()` asserts exactly that, and a test asserts `undefined` for
   `2025-01-31` and for all of 2024.
2. **2024 and earlier are not encoded, on purpose.** The amounts for them are on the Authority's archive
   page (back to 1986), but each year's *rates* live in that year's circular, and this table does not
   carry a rate it has not read. This is the difference between a reference table and a plausible one.
3. **The published amounts are not all indexed to one wage**, so nothing here is derived. For 2026,
   ₪3,442 is a quarter of the ₪13,769 the Authority's own January 2026 example names, but ₪7,703 is
   *not* 60% of ₪13,769 (that would be ₪8,261). Both amounts are recorded as published, and the row's
   note says this, so nobody "corrects" one from the other. (The circulars describe the grade as 60% of
   the average wage, which is true for 2023–2025 and is not what the 2026 page's numbers show.)
4. **Status categories are out of scope and the screen says so**: a minor, a person of retirement age, a
   recipient of an old-age benefit, a self-employed person who is also an employee (whose self-employed
   income is charged at the regular rate on everything above the grade) and the flat ₪123 health payment
   of someone who does not work are all different rows of the law, not this table.
5. **Pension contributions are not modelled**: they are the other deduction section 345 makes from the
   base, and the screen states the settlement shown is *before* them.
6. **The division shape is behind named divisors.** `src/tests/document-math-tax.test.ts` forbids the
   string `'/ (1 +'` anywhere outside `src/lib/documentMath.ts`, because gross-up arithmetic belongs
   there. The first draft of this module tripped that guard — a good catch, and the honest fix was to
   name `fullRateDivisor` / `reducedRateDivisor` and keep the section-345 fixed point in the data module,
   where it is a reference estimate for a report screen and not a document calculation. **If the lead
   would rather this arithmetic live in AI #1's file, say so and it moves** — no figure changes.

## Screen

Reports → **Israel: Self-Employed National Insurance** (`il-self-employment-ni`, lazy-registered in
`src/config/registry.tsx`, help text in `src/config/screenHelp.ts`, capability row 199). A date
checker, one income box returning both the advance and the settlement, the Authority's example quoted
beside it, the full dated table with both rates per band and the published advance floor/ceiling (— where
nothing was read, never 0), every row's source and the day it was read, the CSV, and a paragraph saying
what the table is not. Nothing posts, files or pays.

## Independent of A-102, in this PR: the mileage screen printed a rate 100× too large

`npm run test` is **red on main** at `8c89f9c0`, beyond the lint error already reported. Two tests in
`src/tests/money-format-guard.test.ts` fail against `src/components/reporting/MileageRatesReportView.tsx`
(A-108, merged), which rendered

```
`$${(r.rateCentsPerMile / 100).toFixed(2)}`   →  "$65.50/mi"
```

while the field it prints is **tenths of a cent** (`6550` = 65.5¢ = $0.655, per its own comment). So the
screen showed a 2023 rate of **$65.50 per mile instead of 65.5¢** — 100× — and the guard is right on both
counts: the scale and the hard-coded `$` in front of its own division by 100, which ignores the workspace
currency. Fixed by printing the unit the data actually holds — `65.5¢ per mile` — with the raw
tenths-of-a-cent column relabelled in the table and the CSV. **No number in the table, in
`US_MILEAGE_RATES`, in `usMileageRateProblems()` or in any test changed**, and `mileage-rates-view.test.tsx`
and `us-mileage-rates.test.ts` pass as they did before. The `rateCentsPerMile` field name is still a
misnomer; renaming it would touch tests that read it, so it is reported instead (its doc comment now
states the unit).

## Checks run for A-102

| command | result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| `src/tests/il-self-employment-ni.test.ts` | 6 / 6 pass |
| `src/tests/il-self-employment-ni-view.test.tsx` | 2 / 2 pass |
| guard batch: `capabilities-guard`, `screen-help`, `no-orphan-modules`, `test-discovery-guard`, `table-a11y-guard`, `reachability-guard`, `money-format-guard`, `index-guard`, `rules-coverage-guard`, `allowed-fields-guard` + the A-99/A-100 view tests + `registration-thresholds`, `il-vat-areas` | **65 / 65 pass** |
| tax/IL/golden batch (`il-*`, `*israel*`, `golden-*`, `*vat*`, `resolve-line-*`, `pcn-*`, `*tax*`, `*mileage*`, `*self-employment*`) — 62 files | **365 tests, 365 pass, 0 fail** |
| `src/tests/document-math-tax.test.ts` | pass (after the named-divisor change; it failed the first draft) |
| `npm run check:tax-tables` | 45 modules · 28 tables · 1,098 rows · **0 problems** |
| `npm run lint:rule-packs` | 584 rules · 0 problems (untouched by this task) |
| `npm run lint:eslint` | **0 errors / 210 warnings** — the cap, unchanged, no ratchet update |
| `npm run build` | passes |
| Playwright, Postgres suites | cannot run in this sandbox — CI is the record |

`scripts/tax-table-catalog.ts` gained the new table (three required amounts, three optional ones,
`keys: []`), so the structural validator enforces its dates, order, overlaps and integer cents.

## Not touched

`src/server/`, migrations, any posting path, `quality-baseline.json`, the ESLint cap, screenshot
baselines, and every test's inputs and expected numbers (the only line edited in a test file was an
assertion **message** string in my own new test, to keep it out of the `'/ (1 +'` textual guard). No
RELEASE_GATE row moved.
