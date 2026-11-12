# AI #7 — audit scorecard

Slice: **how an entry gets into the ledger, how it is changed afterwards, and who may do it.**
Pin: upstream `main` `2708f47cb40711e57032bf6d3d4acc9f10f1061d` · written 11 Nov 2026, 21:00 UTC · review only.

## Counts

| | Total at the pin | Reviewed | With a verified defect | Uncertain | Changed since review |
|---|---|---|---|---|---|
| Source files (`src/`, tests excluded) | 1,529 | about 35 (2%) | 12 | 4 (screens, read only) | 0 |
| Server files (`src/server/`) | 246 | about 14 (6%) | 8 | — | 0 |
| Routes (literal-path registrations, text count) | about 309 | 18 exercised (6%) | 8 | — | 0 |
| Functions and handlers | **not counted** | 33 | 19 | 4 | 0 |
| Migrations | 54 | 54 applied, 2 read in full | 1 | — | 0 |

"Changed since review" is 0 because every probe was re-run at this pin after the last merge. There is no function total: the Code Atlas, which should supply it, is at the revision of 16 October (finding A7-12). "Reviewed" never means more than the row says — a file read in part counts once.

## Known blockers

| Sev. | Issue | Finding |
|---|---|---|
| P1 — fix first | #662 | The ledger list's "Reverse transaction" button un-posts an invoice's or payment's entry; "Undo" reports a success that did not happen |
| P1 | #662 | A payment's entry multiplied by a header field; a posted entry deleted in two requests |
| P1 | #652 | Entries of invoices and payments voided, rewritten or reversed behind the document |
| P1 | #646 | A credit note that was never issued is applied and refunded |

No P0 by this audit's evidence. Open issues from other sessions that claim more (#641, #648, #651) were **not verified** here.

## Functions and handlers examined

Outcome words are those of `docs/INDEPENDENT_AUDIT_AGENT.md`. Line numbers are at the pin.

| # | Where | Outcome | Finding |
|---|---|---|---|
| 1 | `crudRoutes.ts:260-323` `PUT /transactions/:id`, partial update | verified-defect | A7-04 a, e, f, g |
| 2 | `crudRoutes.ts:325-392` `PUT /transactions/:id`, full update | verified-defect | A7-04 b, d, h |
| 3 | `crudRoutes.ts:405-470` `DELETE /transactions/:id` | verified-defect, in combination | A7-04 f |
| 4 | `crudRoutes.ts` `POST /transactions` | verified-defect for a rate on the lines; no finding otherwise | A7-02 |
| 5 | `crudRoutes.ts` `POST /transactions/batch-create` | verified-no-finding (closed month refused); rest not-yet-reviewed | — |
| 6 | `ledgerBulkCommit.ts` `POST /transactions/bulk` | verified-no-finding (closed month refused); rest not-yet-reviewed | — |
| 7 | `reverseRoutes.ts` `POST /transactions/:id/reverse` | verified-defect | A7-04 c |
| 8 | `ledgerDoor.ts:18-45` `checkLedgerEntry` | verified-defect | A7-02 |
| 9 | `ledgerDoor.ts:66-79` `LEDGER_MARK_FIELDS`, `ledgerMark` | verified-no-finding; not used by handler 1 | — |
| 10 | `TransactionValidator.validateAndPrepare` | verified-defect (meaning of the total); period lock verified | A7-02 |
| 11 | `txFilters.ts:90-96` `lineAmount` | verified-defect | A7-04 e |
| 12 | `txFilters.ts:104` `settleHomeCurrency` | verified-no-finding (2,277,275 three-line journals at seven rates: every one balances in the books' currency afterwards; no line moves by more than one cent) | — |
| 13 | `txFilters.ts:30` `isPostable` | verified-no-finding | — |
| 14 | `TransactionTemplates.buildReversalLines` | verified-defect | A7-02 |
| 15 | `paymentService.ts:300-520` record a payment | verified-defect | A7-03, A7-04 e |
| 16 | `creditService.ts` apply and refund a credit | verified-defect (read in part) | A7-06 |
| 17 | `recurringService.ts:243-270` `generateEntry` | verified-defect | A7-08 |
| 18 | `workspaceRoutes.ts` `POST /workspaces/:id/seed` | verified-defect | A7-07 |
| 19 | `POST /transactions/reset` | verified-no-finding (refuses books not marked as demo) | — |
| 20 | `POST /workspaces/:id/periods/:month/close` | verified-no-finding | — |
| 21 | `middleware/periodLock.ts` never-delete rule | verified-defect, in combination | A7-04 f |
| 22 | Document posting: invoice, bill | verified-no-finding (single currency; closed month refused) | — |
| 23 | `reportRoutes.ts:1-175` trial balance, balance sheet, P&L, ageing | verified-no-finding on small cases worked by hand | — |
| 24 | `dataChecks.ts:102-116` "Entries whose debits and credits differ" | verified-defect | A7-08 |
| 25 | `postingCheck.findPostingMismatches` | verified-no-finding; covers invoices and bills only | — |
| 26 | `taxReturnService.ts:74-180` `fileTaxReturn` | needs-reproduction | A7-09 |
| 27 | `scripts/bug-patterns.ts` ledger-door scanner | verified-defect | A7-01 |
| 28 | Migration `20261111000000_ledger_integrity_and_rls_hardening.sql` | verified-defect (home currency; open credits); ledger tables server-only verified | A7-06, A7-08 |
| 29 | `transactionEdits.ts` `isDocumentEntry`, `isHandEntered` | verified-no-finding; used for the inline cells only | — |
| 30 | `TransactionEditModal.tsx:156-249` save | unsupported/unknown in a browser; request verified-defect at the server | A7-04 b |
| 31 | `entryActions.ts:32-75` `handleVoidTransaction` and "Undo" | unsupported/unknown in a browser; requests verified-defect at the server | A7-04 g, h |
| 32 | `JournalEntryModal.tsx:242-331` save | verified-no-finding (payload posts and reverses exactly) | — |
| 33 | `TransactionGrid.tsx:50` wiring of the button | unsupported/unknown in a browser | A7-04 g |

## Workflow groups

| Group (`docs/INDEPENDENT_AUDIT_AGENT.md`) | Status |
|---|---|
| 1. Sign-up, setup, returning user | not started |
| 2. Chart, opening balances, posting, correction, period close | **partial** — posting, correction and close executed; chart and opening balances not |
| 3. Invoices, orders, deposits, bills, credits, payments | **partial** — invoice, payment, credit apply and refund; not quotes, orders, deposits, delivery |
| 4. Bank links, imports, matching, reconciliation | not started |
| 5. Inventory | not started |
| 6. Currencies, dimensions, consolidation | **partial** — foreign journals and payments; not revaluation, dimensions, consolidation |
| 7. Tax | not started (one function read) |
| 8. Pay runs | not started |
| 9. Reports, statements, PDF, CSV, email | **partial** — four report routes used as the yardstick on small cases |
| 10. Backup, migrations, database rules, TLS, secrets | **partial** — database rules on ledger and document tables; migrations apply |
| 11. Jobs, queue, notifications | **partial** — the recurring-entry job |
| 12. Admin, billing, invitations, audit log | **partial** — audit rows of entry changes |
| 13. Performance and stability | not started |

No group is complete.

## Tests actually run at the pin

| What | Result |
|---|---|
| `npm run lint:types` | 0 errors |
| `npm run lint:eslint` | 0 errors, 2 warnings |
| `TEST_SHARD=n/4 npm run test:shard`, n = 1…4, real PostgreSQL 17.11 | 5,562 tests, 5,561 pass, 1 fail (speed budget on this machine), 0 skipped |
| `npm run build` | passes |
| `npm run test:rules` | all pass |
| `node scripts/code-atlas.mjs stats`, `validate`, `changes --check` | valid against 16 October; 2,590 changes since |
| `npx tsx scripts/bug-patterns.ts` | runs; counts in `evidence/main-2708f47c/baseline-gates.txt` |
| This audit's 15 probes (`probes/run-all.sh`) | all complete; each asserts the behaviour it reports |
| ESLint and `tsc` over this folder | clean |

**Not run:** browser suites, visual baselines, nightly stability, `npm audit`, the Code Atlas workflow traces.

## Migrations

All 54 apply in order to an empty PostgreSQL 17.11 and the rules test passes on the result. Read in full: the initial migration and `20261111000000_ledger_integrity_and_rls_hardening.sql`. **Unverified:** which migrations are applied in the deployed database.

## Unknowns

- Whether the screens behave as their source reads (no browser here).
- Retries, duplicate clicks and two simultaneous requests on the same record — none tested.
- The 24 server files that write ledger entries and were not sent a request.
- Everything in the groups marked "not started".
- Whether PR #640 at its newest head (`b4f312bf`) changes any finding; it was not tested.

## Next batch, in order

1. `paymentVoidService` — voiding a payment: dates, closed month, release of the allocation.
2. `creditService` apply and refund, read in full, with the test that requires the credit's posted entry.
3. `paymentService` — a payment at a rate different from the invoice's, with withholding and labels.
4. `fxRevaluationService` run and undo, including currencies without two decimals (#641, #648).
5. `ledgerBulkCommit` (imports) — the same request twice, and a failure half-way.
6. Two simultaneous `POST /payments` on one invoice, on a real database.
7. `reconcileRoutes.ts:169`, `:191` — the edit made while reconciling.
8. `depreciationService`, `placeInServiceService` — run, undo, closed month.
9. `payRunService`, `payrollImportService` — posting and closed month.
10. `taxReturnService.fileTaxReturn` — the kept figures of each permit against the screen's computation (A7-09).
