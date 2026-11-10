# AUD-01 — one scope for the statement screen, JSON and PDF (AI #9, 21 Oct 2026)

**Contract** (`src/lib/statementScope.ts`, used by `StatementView`, `GET /reports/statement`, the statement PDF and
emailed/monthly statements through `statementService.loadStatement`):
- **Period:** the dates given; otherwise 1 January of this year to today, in the workspace's time zone (before: the
  screen used this year to date, the JSON and PDF all history to 2099). A date that is not a real YYYY-MM-DD or a
  period that ends before it starts is refused: 400 from the JSON and the PDF, a message on the screen and no PDF
  button (before: the JSON passed any string, the PDF silently dropped bad dates and printed all history).
- **Documents:** the contact's issued invoices or bills, posted payments and credits, picked by `computeStatement`,
  in one order — date, then documents, payments, credits, then number and id (before: same-day rows came in the order
  they were read, so the screen and the server could give different running balances on the same rows). The JSON
  route now reads only this contact's records and checks the contact is in the workspace and of the type asked for
  (before: any workspace's customer id answered).
- **Opening balance:** always the first row, in all three (before: the PDF printed it only when a start date was
  given). The PDF prints the period and is dated at the end of it.

**Worked figures** (`src/tests/aud01-statement-scope.test.tsx`, cents), Acme, 2026-04-01 to 2026-06-30:

| Row | Amount | Running |
|---|---:|---:|
| Opening (INV-1 50,000 − PAY-1 20,000 − CN-1 5,000) | | 25,000 |
| 2026-04-05 Invoice INV-10 | +10,000 | 35,000 |
| 2026-04-05 Invoice INV-11 | +20,000 | 55,000 |
| 2026-04-05 Payment PAY-2 | −10,000 | 45,000 |
| 2026-05-02 Credit note (part refunded) CN-2, 8,000 − 3,000 refunded | −5,000 | 40,000 |

Left out: INV-3 (after the period), INV-4 (draft), PAY-3 (void), another customer's INV-9. Checked on the screen
(store order INV-11 before INV-10), in the JSON and in the PDF (database order reversed): same rows, same balances.
No dates given: all three cover 1 January to today and close at 139,000.
