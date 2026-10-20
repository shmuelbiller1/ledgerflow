# PAY-1: payroll accounting from an outside provider (AI #9)

**Task:** PAY-1 (P1, stage A/B). **Branch:** `ai9/PAY-1` from main 2cca8686. This records what a payroll provider ran. It
does not run payroll, and it claims no provider integration beyond reading a CSV.

## What changed

| Piece | File |
|---|---|
| Reading the CSV, one entry per pay date | `src/lib/payrollProviderImport.ts` |
| Posting (server, one database transaction) | `src/server/services/payrollImportService.ts` |
| Route | `src/server/routes/payrollImportRoutes.ts`: `POST /api/v1/workspaces/:id/pay-runs/imports` (owners, accountants) |
| Screen | `src/components/hr/PayrollImportDialog.tsx`; Payroll → **Import from payroll provider** |

**The entry for a pay date:**
- **Debits:** wages, employer taxes and employer benefits, each to an expense account and split by the chosen label.
- **Credits:** withholdings, employee deductions, employer taxes owed and employer benefits owed, each to a liability
  account. Net pay goes to a payroll clearing account.
- **Clearing:** the bank payment clears the clearing account: a bank line split to it, or a matched entry.

## Nothing is guessed

The import stops, names the problem and posts nothing when:
- a column is not in the chosen provider's column set;
- a row does not add up (gross − withholdings − deductions ≠ net);
- an amount has no account chosen;
- an account is of the wrong kind (an expense role needs an expense account; a liability role needs a liability
  account; the clearing account must not be a bank account);
- a label value is not one of the workspace's (matched exactly by code, name or alias, never a near match);
- any pay date is in a closed period.

The server reads the file again itself and does not trust the browser's preview.

## The same file twice, reversals and corrections

- **Same file twice.** Each pay date's entry id comes from a key of the provider, the pay date and every total. A second
  import of the same figures is refused with the date, the gross and the head count, and nothing from the file is
  posted.
- **Correcting a pay date.** Use **Reverse & Correct** on its entry (the existing `POST /transactions/:id/reverse`).
  After that the corrected file posts. The same figures can also be imported again, under a new entry id.

## Worked figures (cents), `src/tests/pay1-payroll-import.test.ts`

Five facilities, one person each, pay date 2026-05-15:

| Facility | Gross | Withheld | Deductions | Net | Employer tax | Benefits | Cost |
|---|---:|---:|---:|---:|---:|---:|---:|
| F1 Maple | 400,000 | 80,000 | 20,000 | 300,000 | 30,600 | 12,000 | 442,600 |
| F2 Oak | 300,000 | 60,000 | 15,000 | 225,000 | 22,950 | 9,000 | 331,950 |
| F3 Pine | 250,000 | 50,000 | 0 | 200,000 | 19,125 | 0 | 269,125 |
| F4 Cedar | 350,000 | 70,000 | 17,500 | 262,500 | 26,775 | 10,500 | 387,275 |
| F5 Birch | 200,000 | 40,000 | 10,000 | 150,000 | 15,300 | 6,000 | 221,300 |
| **Total** | **1,500,000** | **300,000** | **62,500** | **1,137,500** | **114,750** | **37,500** | **1,652,250** |

- **Debits:** 1,500,000 + 114,750 + 37,500 = 1,652,250.
- **Credits:** 300,000 + 62,500 + 114,750 + 37,500 + 1,137,500 = 1,652,250. The entry balances.
- **Bank payment:** the bank pays 1,137,500 on 15 May, which leaves payroll clearing at 0.
- **Second pay date (29 May):** 100,000 gross, 75,000 net, cost 110,650. It gets its own entry.
- **Correction:** the 29 May entry is reversed and a corrected file (110,000 gross) posts. Wages are then
  1,500,000 + 110,000 = 1,610,000.

## Results

- `pay1-payroll-import.test.ts`: 10/10 pass (5 pure, 5 on the local test database).
- Browser: `e2e/payroll-provider-import.spec.ts`.
  - It previews the 16,522.50 entry and sends the file and accounts.
  - It shows the server's refusal of the same file, and stops a file with an unknown column before anything is sent.
- No migration: entries are ordinary journal entries with `metadata.type = 'payroll-import'`.

## Open

The column sets have not been checked against real exports from each provider (FOR_YOU, 20 Oct). Until they are, a
different export is refused by name, not read wrongly.

## #261 review (11 findings)

`pay1-payroll-import.test.ts` is 16/16.

1. **Import key.** It now includes the workspace, so another workspace with the same figures imports its own payroll.
2. **Clearing account.** It is judged on the whole account record (subtype, role). An asset with subtype "Checking"
   is refused.
3. **Label text.** Labels are compared as text: Unicode form, case, Hebrew points and direction marks are folded. Codes
   must match exactly.
4. **File read.** A later choice of file wins, whichever read finishes first.
5. **Payroll approval** applies to imports too. Under the two-person rule, or when approval is required and the importer
   is not an owner, nothing is posted and the reason is given. Imports cannot wait for approval yet (FOR_YOU).
6. **Shared label name.** A name or alias shared by two labels is refused; the file must use the label's code.
7. **Zero rows.** Rows with nothing paid are left out. A file of only such rows is refused.
8. **Line limit.** Over 100 lines split by label is refused in the preview and on the server, with the line count.
9. **No dismissing while posting.** While the import posts, Cancel, the close button and Escape do nothing.
10. **Reverse & Correct.** When a replacement exists (`metadata.correctsTxId`), the corrected entry stands and the same
    pay date is refused. The dialog says to reverse without a replacement before importing a corrected file.
11. **Phone layout.** The Payroll header buttons wrap on phones.
