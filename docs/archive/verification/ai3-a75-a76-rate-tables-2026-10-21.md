# A-75 + A-76 — mileage and per-diem rate tables per country, into the expense claim (AI #3, 21 Oct 2026)

## What was built

**`src/lib/tax/expenseRateTables.ts`** (pure): dated rate rows per country, each with the
authority's own page and the day it was read — the claim form suggests the row in force on the
claim's date and fills an **empty** rate field from it; the claim still records the rate the person
types (expenseClaims.ts's rule, kept: "the rate is theirs … never a made-up default" — the table
has sources, so the suggestion is not made up, and a typed rate is never overwritten).

### A-75 mileage rows (verified against the authorities' pages, 21 Oct 2026)

| Country | Vehicle | Rate | In force | Source |
|---|---|---|---|---|
| US | car | per-mile business rate (70¢ in 2025/26, 65.5¢ in 2023 …) | 2020 → | **A-108's `usMileageRates.ts`** (IRS) — the US rows are that table wrapped per country, one source of truth |
| GB | car/van | 45p/mi first 10,000 business miles in the tax year, 25p after | 6 Apr 2011 → 5 Apr 2026 | HMRC, GOV.UK travel mileage and fuel rates |
| GB | car/van | 55p/mi first 10,000, 25p after (set 21 May 2026, backdated to 6 Apr 2026) | 6 Apr 2026 → | same |
| GB | motorcycle | 24p/mi | 6 Apr 2011 → | same |
| GB | bicycle | 20p/mi | 6 Apr 2011 → | same |

Rows are per **mile** in their own currency. A per-mile row never fills a per-kilometre claim line
(no conversion is invented); a row in another currency is shown, never prefilled.

### A-76 per-diem rows

| Country | Allowance | Daily | In force | Source |
|---|---|---|---|---|
| US | standard CONUS M&IE | $68.00 | 1 Oct 2024 → 30 Sep 2025 (FY2025) | GSA per diem |
| US | standard CONUS M&IE | $68.00 | 1 Oct 2025 → 30 Sep 2026 (FY2026, Bulletin FTR 26-01) | GSA |
| US | standard CONUS M&IE | $68.00 | 1 Oct 2026 → 30 Sep 2027 (FY2027, Bulletin FTR 27-01) | GSA / Federal Register 2026-18439 |
| GB | benchmark scale, full day (15h+ ongoing at 8pm / 24h) | £25.00 | 6 Apr 2016 → | HMRC EIM05231 benchmark scale rates |

Notes on the rows say what they do not cover: US lodging is separate and first/last travel day is
75% ($51.00); listed localities run $68–$92 (locality tables and the **A-107 GSA file import** are
separate later work); UK meal tiers (£5 one meal 5h, £10 two meals 10h) are kept in the note.

## The claim form

Mileage and per-diem lines gained a **Country** select and a suggestion line. The empty rate field
fills only when the row matches the claim's currency and the line's distance unit; the suggestion
line always names the amount, the date, the authority, its URL and the read day, and says "what you
type is what the claim records". With no row for the country/date it says to type the rate.

## Verification

- `expense-rate-tables.test.ts` 5/5 (boundaries: UK 5 vs 6 Apr 2026; US rows = A-108's rows;
  FY edges; no row before FY2025; countries without a verified row are absent; every row has
  validFrom and a source with `status: 'calculation'`).
- `expense-claims-rate-suggest.test.tsx` 2/2 + existing `expense-claims.test.tsx` unchanged and
  green: UK mileage fills 0.55 on a mile line and never on a km line; a typed rate survives country
  changes; US per-diem fills 68.00; a date outside the table says to type the rate.
- Type check, ESLint (0 errors / 205 warnings, cap unchanged), production build, full unit suite in
  the PR's checks.

## What this does not claim

- No rate for countries, dates, vehicles or localities without a verified row is invented.
- No currency conversion between the row and the claim.
- No posting, filing or tax calculation — the rows are calculation-status suggestions only.
