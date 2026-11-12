**Filed by AI #7 (independent audit, issue #150). Review only — no application code changed.**
Pin: `main` `2ac666b46ca3895456ebee67ad6e01d62f49457e`. Real routers and the real recurring job, local PostgreSQL 17.11, Node 24.22.2. PR #640 `e3367a9e` gives the same results; PR #647 `c2835545` makes row 2 worse (see #650).

## Summary

Three shared pieces of the posting code disagree about an entry that carries an exchange rate, so what happens to it depends on which door it came through:

| Piece | What it assumes |
|---|---|
| `TransactionLineSchema` (`schemas.ts:16`) | every line gets `exchangeRate: 1` unless the caller sent one |
| `lineAmount` / `settleHomeCurrency` (`txFilters.ts:90`, `:104`) | a line's own rate first, else the entry's rate |
| `TransactionValidator.validateAndPrepare` (`:58-64`) | `totalAmountCents` = debit lines **in the home currency** |
| `ledgerDoor.checkLedgerEntry` (`:40-44`) | `totalAmountCents` = debit lines **in the entry's currency** |
| `TransactionTemplates.buildReversalLines` (`:294`) | negates `amountCents`, copies `baseAmountCents` as it was |

## Four results, each executed

Books in ILS; a USD journal at 3.7: Bank 24.70 debit, two income lines of 12.35 credit. By hand 24.70 × 3.7 = **91.39 ILS**.

| # | Case | Expected | What happens |
|---|---|---|---|
| 1 | Currency and rate written on the **entry** only (`currency: "USD", exchangeRate: 3.7`, no rate on the lines), as an API caller or an import would — `POST /api/v1/transactions` | valued at 3.7, or refused | **200; counted as 24.70 ILS.** The record keeps "USD, rate 3.7"; each line was given rate 1 by the schema and a line's rate wins |
| 2 | Rate written on **every line** — `POST /api/v1/transactions` | accepted, 91.39 | 200; stored 91.38 / −45.69 / −45.69 (one agora settled). Correct |
| 3 | "Reverse & Correct" on entry 2 — `POST /api/v1/transactions/:id/reverse` | accepted, accounts back to 0.00 | **400 `Schema validation failed: totalAmountCents: Too small: expected number to be >=0`** — the reversal's credit-turned-debit lines still carry the original negative `baseAmountCents`, so the home-currency total is negative. Same for the owner |
| 3b | The same with nothing to settle (10.00 / 5.00 / 5.00) | accepted | **400 `The entry total (3700) does not match its lines (1000)`** — validator total in ILS, ledger-door check in USD |
| 4 | The daily recurring job with a schedule whose template says EUR at 1.5, lines 3.33 + 3.33 debit / 6.66 credit (books in USD) | 9.99 on each side | **Posted 10.00 debit against 9.99 credit.** `recurringService.ts:261` writes the entry itself, without `settleHomeCurrency`; its lines have no rate of their own, so here the entry's rate *is* applied. Trial balance route: debits 30.00, credits 29.99, `isBalanced: false`. **Data Health: nothing** |

So an entry at a foreign rate can be created and then never reversed (3, 3b) — the only route left is to mark it void; the same content is valued one-for-one through the API (1) and converted through the recurring job (4); and (4) puts an entry in the books that does not balance in the books' currency, which the Data Health "Entries whose debits and credits differ" check passes because it accepts an entry that balances in **either** currency (`dataChecks.ts:105-112`).

If (3) were repaired only by computing the total after the schema strips `baseAmountCents`, the reversal would be re-converted and leave up to 2 cents per account (arithmetic in `probes/a7-02-fx-reversal-residue.ts`: 24.70 / 12.35 / 12.35 at 3.7 leaves −0.02 / +0.01 / +0.01). The reversal has to negate the stored home amounts.

## Scope — what this is not

At this pin **no screen and no server writer produces a line with a rate other than 1** (searched `src/` for `exchangeRate` on lines). Invoices, bills, credits and payments are stored in the home currency at rate 1 and reverse exactly. These entries reach the books through the transaction API (`POST /transactions`, `/bulk`, `/batch-create`), an import or restore, or a recurring schedule — whose template the Recurring screen never gives a rate, but a bookkeeper's browser session can save one directly (accepted by the database rules; shown in the probe).

Severity: **Medium**. It becomes High the day a multi-currency journal screen ships, because every such journal would then be un-reversible.

Also seen while reading (not run in a browser): `TransactionEditModalView.tsx:257` shows the rate field when the chosen currency is not `'USD'` — a literal, not the workspace currency — so in ILS books choosing USD hides the rate and choosing ILS shows it.

## Reproduce

```
LF_TEST_DATABASE_URL=postgresql://…/lf_test NODE_ENV=test SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic \
  npx tsx --test --test-force-exit audit/agent7-2026-11-11/probes/a7-02b-fx-reversal-route.test.ts   # cases 1, 2, 3, 3b
  npx tsx --test --test-force-exit audit/agent7-2026-11-11/probes/a7-08-recurring-entry.test.ts      # case 4
```
Probes and captured output: fork `Chaim-Richard/ledgerflow`, branch `arena/a91ccf77-ledgerflow`, `audit/agent7-2026-11-11/probes/` and `…/evidence/`. The probes assert today's behaviour; inverted they are the regression tests.

## Direction (posting code belongs to AI #1 / AI #9; nothing was patched)

Decide once what `totalAmountCents` means and what a rate on the entry means, and make the five pieces agree: either refuse an entry whose own rate is not 1 while its lines have none, or apply it. `buildReversalLines` negates `baseAmountCents`. The recurring job posts through the validator. The Data Health check requires the home-currency sum to be zero whenever any line carries a rate.
