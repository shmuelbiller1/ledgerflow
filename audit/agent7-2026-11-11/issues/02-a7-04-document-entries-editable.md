**Filed by AI #7 (independent audit, issue #150). Review only — no application code changed.**
Pin: `main` `2ac666b46ca3895456ebee67ad6e01d62f49457e` (also reproduced unchanged on PR #640 `e3367a9e` and PR #647 `c2835545`). Run through the real routers against a local PostgreSQL 17.11, Node 24.22.2.

## What happens

The entry that belongs to an invoice or a payment can be changed through the **generic** entry routes, as a bookkeeper. The document is not told, so the books and the documents disagree.

Setup, by hand: invoice INV-9 for 500.00, paid in full → Bank +500.00, Accounts Receivable 0.00, Sales −500.00.

| Request (bookkeeper) | Answer | Ledger afterwards | Documents afterwards |
|---|---|---|---|
| (a) `PUT /api/v1/transactions/<payment's entry>` `{ partialUpdate: { status: "void" } }` | **200** | A/R 500.00, Bank 0.00 | invoice `paid`, payment `posted` |
| (b) `PUT /api/v1/transactions/<invoice's entry>` with its lines rewritten to 100.00 | **200** | Sales 100.00 | invoice still 500.00 |
| (c) `POST /api/v1/transactions/<invoice's entry>/reverse` | **200** | nothing left | invoice still issued and `paid`; profit and loss income 0.00 |

Expected: each is refused (409) with a pointer to the document — "void the payment", "edit the invoice" — the way `revaluationEntryLock` (`stockRevaluationService.ts:68`) already refuses a stock-revaluation entry.

(d) The audit rows written for (a) and (b) are `TRANSACTION_UPDATED_PARTIAL` / `TRANSACTION_UPDATED` with only `{"description":"Full update on transaction ref [id]."}` — **no before and no after**. They are also written after the database transaction has committed (`crudRoutes.ts:285-295`, `348-358`, `{ db }` without the transaction), so the change can be saved and the audit row lost. This applies to every in-place edit of a posted entry, including the hand-entered ones the product allows by design.

## Why it matters, and what already limits it

- The rule exists — in the browser only. `src/lib/transactionEdits.ts` (`isDocumentEntry`, `isHandEntered`) stops the list's inline edits ("This entry comes from an invoice, bill, payment or bank line: change it there"), and the Journal view offers Reverse only on hand journals. The server enforces none of it, and the entry dialog (`TransactionEditModal.tsx`) does not use those checks (read in code; not confirmed in a browser — no Chromium here).
- The validator still applies: the edits must balance and stay out of closed months. `DELETE /api/v1/transactions/:id` is refused for a posted entry whoever asks (403 "Posted documents must be voided, never deleted") — that control holds; "voided" is exactly case (a).
- The app notices afterwards: Data Health reports (a) as *high* "Payment PMT-2026-0001 has no entry in the ledger"; the month-end posting check (`lib/postingCheck.ts`) reports (b) as `amount (document 500.00, ledger 100.00)` and (c) as `missing`, and "Repost" repairs them. Nothing reconstructs what the entry was before, because of (d).

Severity: **High** for (a)–(c) — a routine role can make the ledger contradict issued documents through the server's own API; `RELEASE_GATE.md` lists transaction integrity under "never postponed". **Medium** for (d).

## Reproduce

```
LF_TEST_DATABASE_URL=postgresql://…/lf_test NODE_ENV=test SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic \
  npx tsx --test --test-force-exit audit/agent7-2026-11-11/probes/a7-04-system-entries-editable.test.ts
```
Probe and captured output: fork `Chaim-Richard/ledgerflow`, branch `arena/a91ccf77-ledgerflow` — `audit/agent7-2026-11-11/probes/a7-04-system-entries-editable.test.ts`, `…/evidence/a7-04-system-entries-editable.txt`. The probe asserts today's behaviour; turned round (expect 409 and unchanged balances) it is the regression test.

## Direction (for AI #1 — `src/server/` is not this agent's lane)

One server-side predicate, the same as the client's `isDocumentEntry` (metadata carries `invoiceId`, `billId`, `paymentId`, `type`, `isReversal`, …), checked in `PUT /transactions/:id` (both branches) and `POST /transactions/:id/reverse`. For (d): write `before` / `after` (status, date, lines, total) in the audit row, inside the same database transaction.
