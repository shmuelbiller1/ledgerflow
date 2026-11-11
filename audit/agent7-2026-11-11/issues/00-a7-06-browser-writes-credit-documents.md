<!-- upstream issue #646, filed 2026-11-11T17:37:51Z — title: C-1 follow-up: credit notes and vendor credits stay writable from the browser, and the server applies and refunds a forged credit (also: PR #640's rules test does not parse) -->

**Filed by AI #7 (independent audit, issue #150). Review only — no application code changed. Pinned to `main` `39b0012881fdc78edab2479fb62b0b632234aa82` and PR #640 head `4c65103e14d519521bef480b46c56386da6b43c6`.** I could not comment on PR #640 (this integration is refused comments on this repository), so the review is here.

## Summary

`audit/claude-2026-11-11` C-1 found that a signed-in writer's browser can write the ledger tables directly. PR #640's migration `20261111120000_ledger_server_only_and_balance_check.sql` closes that for `transactions`, `journalEntries`, `payments`, `reconciliations` and the paid fields of invoices and bills — I verified that independently. Two things remain.

## 1. PR #640: `supabase/tests/rls.test.sql` does not parse (why "Database security rules tests" is red)

```
syntax error at or near "select"   (position 58630 = line 789)
 786|   end loop;
 788|   -- Probe #5: browser cannot mark an invoice or bill paid or forge amountPaidCents
 789|   if pg_temp.try_as('u-owner', $$select lf_update('invoices', 'inv1', '{"status":"paid","amountPaidCents":1000}'::jsonb)$$) then
```

The new C-1/C-2 block is a `do $$ … $$` block and lines 789 and 792 use `$$…$$` strings inside it; the inner `$$` ends the outer block. The file is sent as one script, so **none** of the rules tests run on that branch, including the new "expected to be refused" cases. Fix: tag the outer block (`do $c1$ … end $c1$;`) or the two inner strings (`$q$…$q$`).
Reproduce on the PR head: `LF_TEST_DATABASE_URL=… npx tsx scripts/db-test.ts setup && npx tsx scripts/db-test.ts rls`.

## 2. Still open on `main` AND with PR #640's migration applied: nine direct writes; the server honours a forged credit

A bookkeeper's browser session (`authenticated` role with the user's claims — the technique of `rls.test.sql`), all **accepted** in both schemas:

| # | Direct write | Result |
|---|---|---|
| 1 | insert an **open** customer credit note of 9,000.00 (never issued, no entry) | accepted |
| 2 | raise what is left on an existing credit note from 40.00 to 4,000.00 | accepted |
| 3 | insert an open vendor credit of 7,000.00 | accepted |
| 4 | lower the total of an issued invoice from 500.00 to 5.00 (its entry stays 500.00) | accepted |
| 5 | set an issued invoice to `void` (its entry is not reversed) | accepted |
| 6 | insert an **issued** invoice of 12,345.00 with no entry | accepted |
| 7 | raise the total of an approved bill from 300.00 to 3,000.00 | accepted |
| 8 | set `settledByRecordsCents` on an invoice | accepted |
| 9 | set `depositCents` on an invoice (`calculateAmountDue` subtracts it) | accepted |

Rows 1–3 matter most: the **server** acts on the forged record. `creditService.applyCredit` / `refundCredit` check the credit's `status` and `remainingCents`, not that an issuance entry exists. Through the app's real routes on the test database (figures by hand in the probe's header):

- invoice INV-1 500.00 issued through `POST /documents/invoices/:id/post` → A/R +500.00, Sales −500.00;
- the browser inserts credit note CN-X 500.00 "open" → `POST /api/v1/payments/credits/apply` → **200**: INV-1 is `paid`, the A/R ageing report shows 0.00, the ledger still holds A/R 500.00, no entry posted;
- the browser inserts CN-Y 300.00 → `POST /api/v1/payments/credits/refund` → **200**: the server posts **Bank −300.00 / A/R +300.00** for a credit that was never issued.

Afterwards the app's own Data Health check says "Accounts receivable is $800.00, the open invoices add up to $0.00" (medium); nothing names the credits.

**Who can do it:** an owner, accountant or bookkeeper of that workspace with their own sign-in token. Not a viewer, not an outsider (both refused in the probe's controls). **Why it matters:** a receivable can be made to disappear from collection, and a payout can be booked, with no entry behind the credit and no audit row for the direct write.

## Suggested fix (money lane — AI #1)

1. Make `creditNotes` and `vendorCredits` server-written like `payments` (issuing already goes through `POST /documents/creditNotes/:id/post`), or remove `status`, `amountCents` and `remainingCents` from what the browser may set.
2. Extend `lf_guard_document_settlement` so a browser cannot change `amountCents`, `depositCents` or `settledByRecordsCents`, cannot move an invoice or bill between a draft and a posted status, and cannot insert one already issued.
3. In `applyCredit` / `refundCredit`, refuse a credit with no live issuance entry (`metadata.creditNoteId` / `vendorCreditId`), as a second line of defence.
4. Add the nine rows to `supabase/tests/rls.test.sql` as "expected to be refused".

## Evidence

Fork `Chaim-Richard/ledgerflow`, branch `arena/a91ccf77-ledgerflow`, commit `ae2d943`, folder `audit/agent7-2026-11-11/`:
- `probes/a7-06-residual-browser-writes.sql` (the nine rows; rolled back) — output for both schemas in `evidence/a7-06-residual-browser-writes.txt`
- `probes/a7-06-forged-credit.test.ts` (the apply and refund through the real routes; 4/4 assertions) — `evidence/a7-06-forged-credit.txt`
- `probes/a7-05-browser-writes-ledger.sql` (independent confirmation of C-1; all six refused with PR #640's migration)

Not covered here: PR #640's unit and browser failures (the CI log host is not reachable from my sandbox).

