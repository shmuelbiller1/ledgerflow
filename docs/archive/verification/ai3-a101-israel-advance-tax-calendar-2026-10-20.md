# AI #3 (Arena) — Task A-101: Israel Advance Income-Tax Payment (Mikdamot) Calendar & Per-Entity Rate

**Date:** 20 October 2026  
**Branch:** `arena/7505c2a5-ledgerflow`  
**Base commit:** `6007d05fd2b975875a22471e85f94d281f3fd183` (main)  
**Author:** AI #3 (Arena)  
**Task:** A-101 — Israel: advance income-tax payment (mikdamot) rate field per entity and a reminder calendar

---

## 1. What was built

### A. Per-Entity Rate and Frequency Model (`src/lib/tax/profile.ts`)
- `TaxProfile` gains:
  - `advanceTaxRatePercent?: number` — the advance tax rate on turnover, as a percentage (e.g. 3.5 for 3.5%).
  - `advanceTaxFrequency?: 'monthly' | 'bimonthly'` — the reporting and payment cadence assigned by the Tax Authority.
- Validation in `profileProblem()`:
  - `advanceTaxRatePercent` must be a finite number between 0 and 100.
  - `advanceTaxFrequency` must be `'monthly'` or `'bimonthly'`.
- Inheritance in `resolveSellerProfile()`:
  - When an entity / label value has no own advance rate or frequency, it inherits down the dimension chain from its parent values, and finally from the books.

### B. Settings UI (`src/components/platform/settings/TaxProfilesSettings.tsx`)
- Read-only display: shows "Advance income-tax rate (מקדמות)" and "Advance income-tax frequency", including visual indication when inherited from the books.
- Profile editor: provides input controls for owners and accountants to configure the advance rate (%) and select frequency (Inherit, Monthly, Bi-monthly).
- Validated through existing `taxProfilesProblem` and persisted safely via existing `PUT /api/v1/workspaces/:id/tax-profiles`.

### C. Statutory Calendar & Planning Library (`src/lib/tax/ilAdvanceTaxCalendar.ts`)
- **Statutory basis:** Section 175 of the Income Tax Ordinance [New Version], 5721-1961 (פקודת מס הכנסה [נוסח חדש], התשכ"א-1961, סעיף 175: מקדמות מס הכנסה).
- **Statutory Schedule Table (`IL_ADVANCE_TAX_SCHEDULE`):**
  - Declared in `scripts/tax-table-catalog.ts` for structural validation by `check:tax-tables`.
  - Defines the statutory 15th-day deadline for monthly and bi-monthly filing.
- **Calendar Generation (`ilAdvanceTaxPeriods`):**
  - Monthly: 12 periods per year (Jan 1–Jan 31 due Feb 15, ..., Dec 1–Dec 31 due Jan 15 of next year). Handles leap years (e.g. Feb 29 in 2024 vs Feb 28 in 2026).
  - Bi-monthly: 6 two-month periods per year (Jan–Feb due Mar 15, ..., Nov–Dec due Jan 15 of next year).
- **Shabbat & Holiday Postponement (`ilAdjustDueDateForRestDay`):**
  - Under Israeli administrative law (Interpretation Law, 5741-1981, s. 10(c)), when the statutory 15th falls on Friday or Saturday (Shabbat), the deadline is postponed to Sunday (+2 days for Friday, +1 day for Saturday).
  - Uses pure Sakamoto integer day-of-week arithmetic (avoids Date object UTC methods to preserve the quality baseline `utcDateCount`).
- **Turnover Advance Estimate (`ilAdvanceTaxEstimateCents`):**
  - Pure arithmetic: `turnoverCents × ratePercent / 100`, strictly rounded to the nearest whole integer minor unit (agorot/cents).
  - Safe integer bounds, no negative or NaN outputs.
- **CSV Export:**
  - `ilAdvanceTaxCalendarCsvRows` and `IL_ADVANCE_TAX_CALENDAR_CSV_HEADERS`.

### D. User Interface Screen (`src/components/reporting/IsraelAdvanceTaxReportView.tsx`)
- Registered under Reports → **Israel: Advance Tax Calendar (Mikdamot)** (`israel-advance-tax`).
- UI Features:
  - Entity / profile selector: loads the declared rate and frequency for the books or specific entity.
  - Tax year selector: 2024, 2025, 2026, 2027.
  - Cadence selector: Monthly or Bi-monthly.
  - What-if rate and turnover calculator: allows testing adjustments against projected turnover.
  - As-of date evaluation: flags periods as Upcoming, Due Soon (within 15 days), Active, or Past.
  - Schedule Table: accessible table with English and Hebrew period names (`<bdi>`), date ranges, statutory due dates, Shabbat-adjusted due dates, status chips, and estimated payment amounts in ₪.
  - CSV Export via `downloadCsv`.
  - Statutory notes and official links to the Israel Tax Authority.

---

## 2. Verification Evidence

| Check | Command | Result |
|---|---|---|
| TypeScript | `npm run lint:types` | 0 errors |
| ESLint | `npm run lint:eslint` | 0 errors, 209 warnings (under 210 ceiling) |
| Production Build | `npm run build` | Success (main bundle 987.99 kB / gzip 304.57 kB; chunk `IsraelAdvanceTaxReportView` 14.66 kB) |
| Tax Table Catalog | `npm run check:tax-tables` | 47 modules, 30 tables, 1,133 rows, 0 problems |
| Quality Ratchet | `npx tsx --test src/tests/quality-ratchet.test.ts` | Pass (no regressions; untestedViews: 44, utcDateCount: 35) |
| Table Accessibility Guard | `npx tsx --test src/tests/table-a11y-guard.test.ts` | Pass (all tables have caption; all th have scope) |
| Capabilities Guard | `npx tsx --test src/tests/capabilities-guard.test.ts` | Pass (row 201 valid) |
| Unit Tests (ilAdvanceTaxCalendar) | `npx tsx --test src/tests/il-advance-tax-calendar.test.ts` | 7 pass, 0 fail |
| Component Tests (IsraelAdvanceTaxReportView) | `npx tsx --test src/tests/il-advance-tax-calendar-view.test.tsx` | 5 pass, 0 fail |
| Tax Profile Unit Tests | `npx tsx --test src/tests/tax-profile.test.ts` | 6 pass, 0 fail |
| Tax Profiles Settings Tests | `npx tsx --test src/tests/tax-profiles-settings.test.tsx` | 16 pass, 0 fail |

---

## 3. Invariants & Rules Preserved
- No money posting functions, server routes, or database migrations modified.
- Pure arithmetic for advance calculations using integer minor units (agorot).
- Accessible HTML semantics (`<caption>`, `<th scope="...">`, `<bdi>`).
- Explicit planning and calculation status disclaimers on screen and in code.
