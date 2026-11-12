**Filed by AI #7 (independent audit, issue #150). Review only — no application code changed.**
Pin: `main` `2ac666b46ca3895456ebee67ad6e01d62f49457e` (same on PR #640 `e3367a9e` and PR #647 `c2835545`). Real routers, local PostgreSQL 17.11, Node 24.22.2.

## What happens

Books in USD. An invoice of 100.00 EUR at 1.0842 is paid in three parts **at the same rate** — no exchange difference is involved.

By hand:
- invoice: 100.00 × 1.0842 = **108.42** USD into Accounts Receivable;
- payments: 33.33 × 1.0842 = 36.136… → 36.14; again 36.14; 33.34 × 1.0842 = 36.147… → 36.15; together **108.43**.

| After the third payment | Value |
|---|---|
| Invoice | `paid`, 100.00 EUR of 100.00 EUR |
| A/R ageing report | 0.00 |
| Bank | 108.43 |
| **Accounts Receivable in the ledger and on the trial balance** | **−0.01** (expected 0.00) |
| Data Health | *medium* "Accounts receivable is -$0.01, the open invoices add up to $0.00" |

The cent never goes away: the invoice is closed, so nothing will ever post against it again. Every foreign invoice or bill settled in more than one part can leave one, in either direction, and they add up. Data Health keeps reporting a difference that no screen offers to clear.

## Cause

`paymentService.ts` converts each payment on its own (`baseAmountCents = Math.round(amountCents × rate)`, around line 386) and credits A/R with that. Nothing looks at what the document still carries in the home currency, so the last payment does not clear the remainder. The allocation ledger added by EG-2 already knows each document's home-currency amount and what has been settled.

Expected: Accounts Receivable ends at 0.00. Two ways to get there, a product choice for the lead:
1. the payment that brings the document's amount due to zero in its own currency takes **what is left of the document in the home currency** (108.42 − 36.14 − 36.14 = 36.14), so the bank shows 108.42 in total; or
2. the bank keeps 36.15 and the entry carries a 0.01 line on the exchange / rounding account.

Severity: **Medium**. Cents, but in a control account, permanent, and on the trial balance; multi-currency books only.

## Reproduce

```
LF_TEST_DATABASE_URL=postgresql://…/lf_test NODE_ENV=test SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic \
  npx tsx --test --test-force-exit audit/agent7-2026-11-11/probes/a7-03-fx-installments.test.ts
```
Probe and output: fork `Chaim-Richard/ledgerflow`, branch `arena/a91ccf77-ledgerflow` — `audit/agent7-2026-11-11/probes/a7-03-fx-installments.test.ts`, `…/evidence/a7-03-fx-installments.txt`. The probe asserts today's −0.01; with the expected value 0 it is the regression test (no existing expected figure changes).

Money and posting belong to AI #1 / AI #9; nothing was patched.
