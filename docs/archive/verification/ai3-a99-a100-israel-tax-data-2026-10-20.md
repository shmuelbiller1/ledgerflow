# AI #3 (Arena) — A-99 and A-100: Israel VAT data rows, worked by hand

Date: 2026-10-20. Branch `arena/2cf812b8-ledgerflow`, from `main` at `8c89f9c0`.
Release-gate rows touched: **none moved** — W7 and W8 keep their existing blockers (CON-1…CON-4,
#160, the PCN874 draft). This PR adds sourced data and the screen that shows it; it changes no posting,
no server code, no migration, and no money calculation of AI #1's.

## A-100 — Israel: osek patur yearly threshold history (`validFrom` per year)

**What was there:** `src/lib/tax/registrationThresholds.ts` (A-39) carried three Israeli rows, typed by
hand: 2024, 2025, 2026. A past period — a 2019 or a 2022 year — had no answer at all, and the figures
were not tied to any other table.

**What this adds:** `src/lib/tax/ilOsekPaturThresholds.ts` — one dated row per tax year, 2017 through
2026, each with `validFrom` on 1 January (the VAT Law's own indexation day), the figure in whole agorot,
how that year's figure came about (`indexed` / `statute` / `unchanged`), the authority page it was read
from, a second citation, and a note saying what the figure does and does not decide.

| Tax year | Ceiling | How the figure came about |
|---|---|---|
| 2017 | ₪98,707 | indexed |
| 2018 | ₪99,003 | indexed |
| 2019 | ₪100,187 | indexed |
| 2020 | ₪100,491 | indexed |
| 2021 | ₪99,893 | indexed — **lower than 2020**: the consumer price index fell, and the law indexes to the index |
| 2022 | ₪102,292 | indexed |
| 2023 | ₪107,692 | indexed |
| 2024 | ₪120,000 | fixed in the definition of "עוסק פטור" (the ~₪108k figure before it was re-set) |
| 2025 | ₪120,000 | unchanged — the published figure did not move for that January |
| 2026 | ₪122,833 | indexed |

**One answer, not two.** The three rows the Registration Threshold Watch and the `registration-thresholds`
rule pack use are now *built from* this table (`israelCeilingRow(year)` in `registrationThresholds.ts`),
so the watch, the pack and the history cannot hold different figures for the same year.
`src/tests/il-osek-patur-ceilings.test.ts` asserts exactly that, row by row: same amount, same dates,
same citation, same figure in the rule's effect. The older years stay out of the pack on purpose, so a
2026 comparison can never pick up a 2017 rule — and a year the table does not state answers `undefined`,
never zero, never the neighbour's figure.

**Worked figures** (the test holds all of these): a year at exactly the ceiling is *inside* it
("אינו עולה על" = does not exceed); one agora more is outside. ₪100,187 on a 2019 date is inside that
year's ₪100,187; ₪100,188 is not. `osekPaturCeilingOn('2025-12-31')` is ₪120,000 and
`osekPaturCeilingOn('2026-01-01')` is ₪122,833 — the boundary is the day, not the report run.

**Screen:** Reports → Registration threshold watch gains a disclosure, "Israel: the osek patur ceiling,
year by year (A-100)" — one row per year with the amount, the dates, how the figure came about, the
authority's own note, and the page it was read from (https links, two per year where there is a second
citation). It states plainly that eligibility also turns on Regulation 13's occupation list, the
prior-year / expected-turnover basis, equipment sales left out of "מחזור עסקאות", and every business the
person runs — none of which the table can see.

**Catalog:** `scripts/tax-table-catalog.ts` declares the new table (`mode: 'year'`, `amounts:
['ceilingCents']`), so `npm run check:tax-tables` validates it with everything else
(44 modules · 27 tables · 1,096 rows · **0 problems**).

**Sources, and an honest limit on them.** The 2026 figure was read on the day of writing from the Israel
Tax Authority's own service page (last updated 18.01.2026: "בשנת 2026 – 122,833 ₪") and from the
consolidated text of the VAT Law ("עוסק פטור" – … אינו עולה על 122,833 שקלים חדשים לשנה), both re-opened
for this change. 2024 and 2025 keep the Authority's yearly guide pages A-39 already cited. 2017–2023 are
read from the Knesset Research and Information Center's note on the ceiling and cross-checked against two
professional rate tables; the Knesset file itself was **not reachable from this sandbox** (knesset.gov.il
answered its geo-block page), so those seven rows are recorded as read from a source the reviewer should
re-open — `npm run check:rule-sources` does that and writes its dated report. Nobody should treat a past
year's figure as settled until that report is green for these URLs.

The report could not be produced from here: `npm run check:rule-sources` in this sandbox answered **0 of 110 URLs** and marked
every one of them `unreachable`, including two pages opened minutes earlier, so its dated file was **deleted rather than committed** —
a verdict that says nothing about the links. CI runs it with network access; its report is the record.

**One near-miss worth recording:** ₪120,000 in 2024–2025 is *also* the §46 threshold at which a buyer
must ask for a VAT invoice, and the Tax Authority page that states the §46 figure calls it
"the exempt dealer turnover threshold". Only the Knesset note's own per-year series for 2017–2023, which
continues into exactly 120,000 for 2024, and a second professional table for 2023 → 2024, settle that the
osek patur ceiling is ₪120,000 for those years and not a copy of the invoice threshold. The coincidence
is worth knowing before anyone "corrects" one with the other; the §46 threshold is a different rule.

## A-99 — Israel: Eilat VAT-exempt area facts and rule

**What was there:** A-29's `IL_VAT_SPECIAL_AREAS` (the place rows) and A-38's `il-vat` rule pack, which
turns the zero areas into an override rule on the `district` fact.

**What was wrong, and is fixed here:**

1. **The row's own dates were invented.** It said the Eilat relief runs from `1986-01-01`. The Eilat Free
   Trade Zone (Tax Exemptions and Relief) Law, 5745-1985 was enacted on 31 July 1985 and came into force
   on **1 November 1985**, so the row now starts there. A line dated October 1985 is an ordinary place; 1
   November 1985 is not — both are asserted in the test.
2. **Its citation was a dead page.** `gov.il/he/departments/general/eilat_vat` answers the gov.il 404 page
   today (checked 2026-10-20). The row now cites the consolidated statute text, names the statute as the
   authority (a law is not the Tax Authority's page), and records the dead link in its note rather than
   quietly replacing it.
3. **A Hebrew address was not the same place as an English one.** The table matched `place.district ||
   place.city` against its own keys, case-insensitively. A book written `Eilat` answered 0%; the same book
   written `אילת` — the ordinary way a workspace writes it — answered **18%**. That is a wrong figure on a
   report, not a wording problem. `ilVatAreaKeyFor()` is now the one recognition the rate table, the facts
   helper and the rule pack all read; every row answers for its key, its English name, its Hebrew name and
   its aliases, and nothing else. An unstated place is the ordinary area — no area is inferred from a
   street, a zip code or a hunch.
4. **The facts half, which the task names.** `ilVatAreaFacts(place)` gives the rule graph the *canonical*
   `district` fact (`eilat`, not `אילת`) for an Israeli place, so the pack's override fires for the same
   invoice the rate table already answers 0% for. The pack lists every spelling each row recognises as
   rule values, from the same rows. The last test in `src/tests/il-eilat-area-facts.test.ts` walks every
   row × every recognised name and requires the rate table and the rule to give the same answer, so the
   two cannot drift again.
5. **What the row says it is.** An *exemption* is not a zero rate: the resident dealer charges no VAT and
   gets no input credit (s.5(b) and 5(e) of the law), while a sale *into* the area by a non-resident dealer
   is at the zero rate where the law applies (s.5(a)). The note now states the distinction, the schedule
   that carves goods out, and that residence and place of consumption are what actually govern — none of
   which a place row can decide. The screen repeats the distinction in one line.

**Worked figures** (test-asserted): ₪1,000.00 net in Eilat is ₪1,000.00 gross; in Tel Aviv it is
₪1,180.00 at 18% (2026) and ₪1,170.00 at 17% (2024). Through the rule graph: Eilat → `il-vat-area-eilat`
applied at rate 0, the standard row in force displaced by it; Tel Aviv → the country row at 0.18; on
2024-06-01 in Eilat the 17% row is the one displaced.

**Screen:** Reports → Tax rule coverage gains "Israel: the places outside the ordinary rate (A-99)" — the
rows, the spellings each recognises, treatment, rate, dates, the note and the source, plus the line
showing what the recognition answers for `אילת`, `Eilat`, `eilat` and `Tel Aviv` on the screen's own date.
It is a list, not a table, so the screen's existing table (and its tests) stay exactly as they were.

## Unrelated fix this PR carries, so CI can be read

`main` at `8c89f9c0` fails `npm run lint:eslint`: **1 error** in `src/config/registry.tsx:550` — the
Hebrew label of the A-108 mileage-rates screen, `'תעריפי נסיעה ארה\"ב'`, has a `\"` inside a
single-quoted string (`no-useless-escape`) — and the run lands at **211 warnings** against the 210 cap.
The escape is removed (same characters on screen), and one dead import in the file this PR already edits
(`taxRulePacks` in `RulePackCoverageReportView.tsx`) is dropped in the A-99 commit, which brings the count back to
**0 errors / 210 warnings** — the cap, unchanged. `npm run ratchet:update` was therefore not needed: no
budget moved. If the lead prefers these in a separate commit, they are the first two commits on this
branch and can be cherry-picked alone.

## Checks run here (Node 22 in this sandbox; the repo asks for 24)

- `npx tsc --noEmit -p tsconfig.json` — clean.
- Focused unit files: `il-osek-patur-ceilings` (4), `il-eilat-area-facts` (6), `il-vat-areas` (6),
  `registration-thresholds` (7), `registration-threshold-watch-report` (7), `rule-coverage-view` (4) —
  all pass; the whole tax/IL/golden area — **356 tests in 57 files, 356 pass, 0 fail**.
- Guard suites: `tax-rule-packs`, `rule-pack-lint`, `rule-pack-diff`, `rule-coverage`, `capabilities`,
  `screen-help`, `no-orphan-modules`, `test-discovery`, `tax-table-validator`, `main-path` — 46 pass.
- `npm run check:tax-tables` — 44 modules · 27 tables · 1,096 rows · 0 problems.
- `npm run lint:rule-packs` — 584 rules, 0 problems.
- `npm run lint:eslint` — 0 errors / 210 warnings (cap 210, unchanged; see the fix above).
- `npm run build` — passes: `vite build` built in 26.12s (PWA generateSW, 347 precached entries) and `esbuild` wrote `build/server.cjs`.
- **Not run here:** Playwright (no Chromium in this sandbox) and the Postgres suites (no
  `LF_TEST_DATABASE_URL`). Both run on this PR's CI, which is the record to read.

No test input or expected number was changed. `quality-baseline.json`, the `--max-warnings` number,
screenshot baselines, migrations and `src/server/` are untouched.

## Left for the lead (not taken, deliberately)

- **A finding on the Israel VAT return's zero-rated vs exempt split.** In Eilat the resident dealer's sale
  is an *exemption* (no input credit), while the special-areas table — and so the golden fixtures —
  models it as a zero rate. That is a `src/lib/tax/ilVatReturn.ts` / report-scope question with figures
  attached (D-32 goldens, A-152, A-198), so it is reported here and not patched: an accountant reading the
  VAT report could otherwise see ₪ of "zero-rated sales" where the return has an "exempt sales" line.
  `ilVat.ts` now says the distinction in words, and nothing more was changed.
- `TaxPlace.district` has no field on the IL tax-profile editor for choosing a special area, so today the
  fact arrives from an entity's saved place rather than from a picker. A screen change for that belongs to
  AI #2's settings lane; the data side answers correctly either way.
