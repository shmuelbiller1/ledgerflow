**Filed by AI #7 (independent audit, issue #150). Review only — no application code changed.** Follows #652 (same route) and corrects one sentence of #652 and #661.

Pin: `main` `2708f47cb40711e57032bf6d3d4acc9f10f1061d`. Real routers in-process, local PostgreSQL 17.11 with `main`'s 54 migrations, Node 24.22.2, 11 Nov 2026 20:43 UTC. The screens were **read in source, not run in a browser** (no Chromium in this sandbox); every server answer below was executed.

## The route

`PUT /api/v1/transactions/:id` with `{ partialUpdate }` (`crudRoutes.ts:260-323`) refuses six fields — `lines`, `amountCents`, `totalAmountCents`, `date`, `workspaceId`, `uid` — and writes every other field as sent (`:307`), without the validator, on any entry in an open period that is not already certified or void (stock-revaluation entries are protected separately). It accepts eleven statuses, `draft` and `failed` among them. Four things follow. Setup for all: invoice INV-9 for 500.00, paid in full → Bank +500.00, Accounts Receivable 0.00, Sales −500.00.

## 1. One click in the ledger list — new with PR #647

Every row of the ledger list in an open period shows a button labelled **"Reverse transaction"** (`TransactionRow.tsx:461-469`), disabled only for a reversal or an entry already reversed. It does not look at where the entry came from (`isDocumentEntry` guards the inline cells only).

- Up to `2ac666b` the button sent `DELETE /transactions/:id`, which the server refuses for a posted entry (403 "Posted documents must be voided, never deleted").
- PR #647 rewired it to `handleVoidTransaction` (`TransactionGrid.tsx:50`; pinned by `ledger-integrity-slice3.test.ts:30`), which sends `{ partialUpdate: { status: 'failed', deletedAt: <now> } }` (`entryActions.ts:32-51`).

That request, sent as a bookkeeper:

| On | Answer | Books afterwards | Documents | Entries in the ledger |
|---|---|---|---|---|
| the **payment's** entry | **200** | Bank 0.00, A/R 500.00 | invoice `paid`, payment `posted` | 2 before, 2 after |
| the **invoice's** entry | **200** | Sales 0.00, A/R −500.00 | invoice `paid` | 2 before, 2 after |

Nothing is reversed: no entry is added, the original simply stops counting (`isPostable`, `txFilters.ts:34`), in whatever open month it was posted. The document is not told.

## 2. "Undo" answers 200 and does not bring the entry back

The toast offers "Undo", which sends a full `PUT` with the entry as it was and `deletedAt: null` (`entryActions.ts:58-66`). Answer **200** — the toast then says "Transaction restored" — and the books are **unchanged**: the stored entry has `status: completed` again but `deletedAt` is still set, because the schema does not know the field, the validator drops it, and the update merges. The entry stays out of every report.

## 3. One header field multiplies a payment's entry

`{ partialUpdate: { exchangeRate: 100 } }` on the payment's entry → **200** (these books also hold a hand journal of 70.00 paid from the bank, hence 430.00):

| | Before | After |
|---|---|---|
| Bank | 430.00 | **49,930.00** |
| Accounts Receivable | 0.00 | **−49,500.00** |
| The entry as stored | lines 500.00 / −500.00, total 500.00 | **the same** — only `exchangeRate: 100` |
| Trial balance route | balanced | **still balanced** (debits 50,570.00 = credits 50,570.00) |

Reports value a line with its own rate, else **the entry's** (`lineAmount`, `txFilters.ts:90-96`). `paymentService.ts:493` writes the payment's entry itself and stores no rate on its lines, so the entry's rate is a multiplier. The same request on the invoice's entry or on a journal typed by hand is accepted too and changes nothing: those went through the line schema, which gives every line rate 1. The audit row reads `Partial update on transaction ref [id]` — no before, no after.

## 4. A posted entry is deleted in two requests

| Request (bookkeeper) | Answer |
|---|---|
| `DELETE /transactions/<posted entry>` | 403 "Only draft documents can be deleted … Posted documents must be voided, never deleted" |
| `PUT … { partialUpdate: { status: 'draft' } }` | **200** |
| `DELETE` again | **200** — the row is gone |

Same for a hand journal and for the payment's entry. **This corrects #652 and #661**, which listed the 403 as a control that holds: it holds for one request, not for two. What does hold: the `TRANSACTION_DELETED` audit row keeps a copy of what was deleted.

## What notices afterwards

| | Data Health | Month-end posting check |
|---|---|---|
| Payment's entry un-posted (1) | *high* "Payment PMT-2026-0001 has no entry in the ledger" | nothing found |
| Payment's entry deleted (4) | the same *high* finding | not run |
| Invoice's entry un-posted (1) | *medium* "Accounts receivable is -$500.00, the open invoices add up to $0.00" | "invoice INV-9: missing" |
| Payment's entry ×100 (3) | *medium* "Accounts receivable is -$49,500.00, the open invoices add up to $0.00" — no finding names the entry | nothing found |
| A hand journal un-posted or deleted (4) | nothing — no check can know | not covered |

## Severity

**P1**, and the first of my findings to fix: result 1 needs no hand-made request, it was made reachable today, and its "Undo" reports a success that did not happen. Results 3 and 4 need a signed-in writer to send a request the screens do not send.

## Expected

- A posted entry changes in place only through the mark fields the code already lists (`LEDGER_MARK_FIELDS`, `ledgerDoor.ts`) and only along allowed status changes; `completed → draft` and `completed → failed` are not among them. Taking a posted entry out of the books is a reversing entry.
- An entry that belongs to a document is changed through the document (#652).
- "Undo" either restores the entry or says that it could not.

## Direction (AI #1 — `src/server/` and the ledger screens are not this agent's lane; nothing was patched)

1. In the partial-update branch, replace the six-field refusal with the existing allow-list (`ledgerMark`), plus the non-ledger marks the screens use (flag, cleared).
2. Add the server-side document-entry check from #652 to the same branch.
3. Make the list's button post a reversal (`POST /transactions/:id/reverse`) for a hand entry and point to the document for the rest; or relabel it and keep it off document entries.
4. Either store a rate on the payment entry's lines or stop `lineAmount` from falling back to the entry's rate when the entry is in the books' currency.

## Reproduce

```
LF_TEST_DATABASE_URL=postgresql://…/lf_test NODE_ENV=test SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic \
  npx tsx --test --test-force-exit audit/agent7-2026-11-11/probes/a7-04g-ledger-list-void-button.test.ts   # 1, 2
  npx tsx --test --test-force-exit audit/agent7-2026-11-11/probes/a7-04e-rate-by-partial-update.test.ts    # 3
  npx tsx --test --test-force-exit audit/agent7-2026-11-11/probes/a7-04f-unpost-then-delete.test.ts        # 4
```
Fork `Chaim-Richard/ledgerflow`, branch `arena/a91ccf77-ledgerflow`, commit `d4820abc`; output in `audit/agent7-2026-11-11/evidence/main-2708f47c/`. The server answers are the same at `2ac666b`; what is new at `2708f47c` is the button's wiring. The probes assert today's behaviour; turned round they are the regression tests.
