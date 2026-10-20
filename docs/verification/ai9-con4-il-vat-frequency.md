# AI #9 — CON-4 Israeli VAT reporting frequency drives the VAT report and PCN874 periods

Based on main 2ea24b9. Lane: `src/lib/tax/ilVatFilingFrequency.ts`, `src/lib/tax/pcn874Draft.ts`, the VAT/PCN874 part of
`src/lib/israelMonthJourney.ts` and its screen (Reports → Israel Month Journey). No posting change.

**Before.** The month journey always computed the VAT report and the PCN874 draft for one calendar month. A
registration recorded as `bimonthly` (Settings → Tax profiles) got a one-month report with no due date and a note
that the month "is part of a two-month period". The note also appeared for registrations with no frequency at all.

**Now.**
- `ilVatReportPeriod(month, frequency)` gives the report a month belongs to:
  - monthly: the month itself;
  - bimonthly: January–February, March–April, … November–December;
  - due date: the 15th of the month after the period.
- Each registration's VAT report is computed over its own period, so either month of a pair shows the same two-month
  report. It counts as "recorded as filed" only when the server holds a return for exactly that period.
- The PCN874 draft and its comparison use the period of the registration whose dealer number is typed in.
  `buildPcn874FixtureDraft` accepts `endMonth` (only the next month of the same year) and refuses documents outside
  the period.
- The VAT report table shows each registration's period.
- A registration with no recorded frequency keeps the month and states no due date, as before, now worded truthfully.

**Worked figures** (`src/tests/con4-il-vat-frequency.test.ts`, by hand, agorot). Invoices of 400,000 + 72,000 VAT
(12 Jan) and 600,000 + 108,000 VAT (9 Feb), a bill of 250,000 + 45,000 VAT (20 Feb), and a March invoice that must
never be counted:
- **Monthly:**
  - January: taxable 400,000, VAT 72,000, to pay 72,000, due 15 Feb.
  - February: taxable 600,000, VAT 108,000, input 45,000, to pay 63,000, due 15 Mar.
- **Bimonthly, Jan–Feb (from either month):** taxable 1,000,000, VAT 180,000, input 45,000, to pay 135,000
  (= 72,000 + 63,000), due 15 Mar.
- **PCN874 Jan–Feb:** rows 2001, 2002, 8001; totals ₪10,000 / ₪1,800 / ₪450; no difference from the report.

**Not verified (open question).** The bimonthly draft's header carries the period's **first** month (`202601`). The
gov.il Appendix A PDF could not be fetched from this environment to confirm which month a bimonthly report's header
names. The screen says so, and the draft was already marked not filing-ready.

Release gate: W7. The VAT report period now follows the registration; W7 stays Partly (PCN874 is a historical draft,
#160 open).

**Review fixes (#235, Codex P1 + 4 × P2).** Each has its own test in `con4-il-vat-frequency.test.ts`.
1. **One dealer's documents only.** The PCN874 rows hold only the selected registration's documents, using the same
   `belongsTo` ownership as the VAT report. With two dealers, South's Jan–Feb draft holds only its invoice 3001
   (100,000 + 18,000).
2. **Dealer numbers compared as digits** (`ilReturnForDealer`), so a registration saved as `514-000-000` is found.
3. **January of a bimonthly pair is `pending`.** It is not due and not owed to close January, and the VAT-report step
   is not-applicable. February ends the period, so the report is due there.
4. **Registration in force for the whole period.** A bimonthly registration that starts, ends or changes frequency
   inside the pair shows the month alone, with a problem line saying why. February only: to pay 63,000, never
   labelled Jan–Feb.
5. **The CSV carries each return's own period** ("Report period from/to"). The same Jan–Feb figures (to pay 1,350.00)
   come out from either month.

Full suite with the test database: 3,424 pass / 0 fail. Browser W7/W8 2/2.
