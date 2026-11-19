# Form 856 authority-order CSV (E-17)

**What it is:** a CSV whose twenty columns follow the Israel Tax Authority's field order for
record 60 ("רשומת המקבלים" — the payee record) of the yearly withholding report (Form 856 /
טופס 856), for the published 2017–2025 interface. It is produced on **Reports → Withholding
Report (Form 856)** as **Authority-order CSV (draft)**, beside the review worksheet.

**What it is not:** the file the Tax Authority transmits. That file is fixed-width — every record
type (60 detail, 70 payer summary, 80 monthly) is exactly **218 bytes**: content columns 1–216,
carriage return at 217, line feed at 218. This export is CSV and is never filed from Ledgerflow;
`readyForFiling` is hard-coded `false` in `src/lib/tax/form856AuthorityCsv.ts`.

## Sources

| Source | What was taken from it |
|---|---|
| [דיווח - שידור דוחות 126 ו-856 (gov.il)](https://www.gov.il/he/service/report126) — the service page with the official attachments | the authority's own document list; "מבנה קובץ 856 מ שנת המס 2017 עד 2025" (PDF, 14 Jan 2026) |
| [מבנה רשומה 856 לשנים 2017-2025 (official PDF)](https://www.gov.il/BlobFolder/service/report126/he/Service_Pages_Income_tax_annual-report-2026_856-2017-2025.pdf) | reporting rules 1–4 and the field table, cross-checked field-by-field (search-indexed text of the PDF) |
| [טופס 856 – דיווח שנתי על ניכויים (hon.co.il)](https://www.hon.co.il/%D7%98%D7%95%D7%A4%D7%A1-856-%D7%93%D7%99%D7%95%D7%95%D7%97-%D7%A9%D7%A0%D7%AA%D7%99-%D7%A2%D7%9C-%D7%A0%D7%99%D7%9B%D7%95%D7%99%D7%99%D7%9D/) | the complete record-60/70/80 tables in text form |

The two independent renderings agree everywhere they overlap: rules 1–4, record length 218 with
CR/LF at 217–218, field 11 (gross payments) at columns 97–107 width 11, the report code at
10–11, the record-type code at 215–216, and every record-80 monthly field. The field widths of
record 60 sum to **216**, plus CR/LF = **218** — the arithmetic the authority states.

## Record 60 fields, in the authority's order

| # | Columns | Width | Field | Type |
|---|---|---|---|---|
| 1 | 1–9 | 9 | מספר תיק ניכויים — withholding file no. (first digit 9, then office code, serial, check digit) | numeric |
| 2 | 10–11 | 2 | קוד הדיווח — report code, **96** on every record | numeric |
| 3 | 12–15 | 4 | שנת מס — tax year | numeric |
| 4 | 16 | 1 | זיהוי עובד — 2 = Palestinian Authority resident payee, 5 = international company (English names) | numeric |
| 5 | 17 | 1 | payee's Income-Tax file type — 1 self-employed, 2 company, 3 licensed dealer | numeric |
| 6 | 18–26 | 9 | payee's Income-Tax file no. / ID / company no. (zero-padded left to 9) | numeric |
| 7 | 27–40 | 14 | supplier / account no. | numeric |
| 8 | 41–62 | 22 | payee name (no titles, phones or professions) | alpha-numeric |
| 9 | 63–83 | 21 | street / neighbourhood and house number | alpha-numeric |
| 10 | 84–96 | 13 | city | Hebrew |
| 11 | 97–107 | 11 | סה"כ תשלומים ששולמו ברוטו (כולל מע"מ) — gross payments incl. VAT | numeric |
| 12 | 108–116 | 9 | סה"כ מס הכנסה שנוכה — income tax withheld | numeric |
| 13 | 117–124 | 8 | סה"כ מע"מ ששולם למס הכנסה — VAT paid to the Income Tax by the payer (regulation 6a cases) | numeric |
| 14 | 125–132 | 8 | year-end credit balances to the payee | numeric |
| 15 | 133–134 | 2 | שיעור הניכוי — withholding rate, whole percent without `%` (e.g. 10 → `10`); **one record per rate** | numeric |
| 16 | 135–146 | 12 | approving office name and code (e.g. טבריה 01) | alpha-numeric |
| 17 | 147–160 | 14 | payee occupation | Hebrew |
| 18 | 161–212 | 52 | filler | — |
| 19 | 213–214 | 2 | סוג הניכוי — withholding type code (01, 02, 03, 05, 06, 07, 08, 11–15, 18–22) | numeric |
| 20 | 215–216 | 2 | סוג רשומה — record type, **60** | numeric |

Authority reporting rules applied by the writer (their words, rules 1–4 of the 2017–2025
document): a percent field has no `%` sign; **every numeric field has no decimal point**; every
numeric field is **zero-padded with leading zeros, including the empty ones**; a minus (where a
field allows one) sits in the leftmost character.

**Amount unit.** The 856 rules say "no decimal point" but do not spell out the unit in the
published text that could be machine-read here. Ledgerflow stores whole agorot, the sibling
ITA fixed-width instructions state amounts as "including agorot, no decimal point", and the
field widths corroborate minor units (11 digits ≈ 1 billion ILS per payee, 9 digits ≈ 100
million ILS of tax — sensible ceilings only in agorot). The CSV therefore writes **whole
agorot**. If an accountant confirms the authority expects whole shekels, that is a one-line
unit change in `form856AuthorityCsv.ts` — the column order does not move. This is recorded as
an open verification item, not a claim.

## The screen

Reports → Withholding Report (Form 856) → panel **Authority-order CSV (draft)**:

- The **withholding file number** (תיק ניכויים) is required: nine digits, prefilled from the
  books-level tax profile when it holds an Israeli `employer` registration of exactly nine
  digits (`ilWithholdingFileNo`), otherwise typed on the screen. A correction is kept per
  workspace. A number not starting with 9 is flagged.
- The download shares the worksheet's guards: posted payments only, one workspace, no cap hit,
  valid dates, home-currency amounts, the year-scoped acknowledgement.
- Payments are mapped by vendor **and by recorded withholding rate** — one record per rate, as
  field 15 requires. A payment with no usable recorded rate (or a fractional one) is grouped
  separately and reported; a rate is never derived from the effective percentage.
- Fields the books do not record (worker flag, payee file type, supplier account, street, city,
  VAT transferred to the Income Tax, year-end balance, approving office, occupation, withholding
  type code) are written as zeros/blank and enumerated in the export's `notices`; missing tax IDs
  and missing rates are per-record `problems` shown on screen before the download.

## Tests

- `src/tests/form856-authority-csv.test.ts` (9 tests): the field table against the layout
  (20 fields, contiguous columns, widths sum 216, record type at 215–216); a hand-worked typed
  fixture asserting every one of the twenty cells; CSV read-back; empty-numeric zeros and the
  missing-rate report; refusals (bad file number, bad year, negative money, rate outside 0–99,
  malformed type code, nameless record); overflow keeps the full value and says so; the payment
  mapping (per-rate records, unrated grouping, conflicting tax IDs, 10.5% rejected as a rate);
  and the tax-profile prefill rules.
- `src/tests/form-856-view.test.tsx` — the screen needs file number + acknowledgement, then the
  downloaded bytes are parsed back: header order, `912345678,96,2026`, field 6/11/12/15/20
  values in agorot, and the missing ID/rate left as zeros, not invented.

Nothing posts, files, converts or changes how money is calculated; this is a read-only export of
recorded payments in the authority's column order.
