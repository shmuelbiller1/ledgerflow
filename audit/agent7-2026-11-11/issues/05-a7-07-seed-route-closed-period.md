**Filed by AI #7 (independent audit, issue #150). Review only — no application code changed.**
Pin: `main` `2ac666b46ca3895456ebee67ad6e01d62f49457e`. Real routers, local PostgreSQL 17.11, Node 24.22.2. Same on PR #640 `f4e0b111`; partly changed on PR #647 `c2835545` (noted below).

## What happens

`POST /api/v1/workspaces/:workspaceId/seed` (`workspaceRoutes.ts:691`, roles owner / accountant / bookkeeper) writes demo data into whatever workspace it is called on. **No screen calls it** (searched `src/` outside `src/server`, `e2e/` and `scripts/`: no caller; guest mode uses the same seed data in memory only) and no test covers it. It is reached by sending the request by hand.

Setup: books in USD with one September journal (Bank 1,000.00 / Sales 1,000.00); September 2026 **hard-closed** through the app's own route (`lockDate` 2026-09-30). Then, as a bookkeeper:

| | Result |
|---|---|
| `POST /workspaces/:id/seed` | **200** |
| Entries written | two, dated **2026-09-01 and 2026-09-05** — inside the closed month: demo bank +3,000.00, demo revenue −15,000.00, demo expense +12,000.00 |
| Checked by the validator / ledger door / period lock | no — `batch.set` straight into `transactions` (`:715`) |
| Audit row | none |
| Accounts | saved under the id `<workspace>_<id>` while the entry lines point to `<id>`: reports show them (balance sheet balanced, 3,000.00 in "Operating Bank Account"), Data Health reports four *high* "uses a missing account" |
| Documents | invoice INV-DEMO-001 (`sent`, 5,000.00) and bill BILL-DEMO-001 (`pending`, 1,200.00) with **no ledger entry** → Data Health: "Accounts receivable is $200.00, the open invoices add up to $5,200.00"; "Accounts payable is $0.00, the open bills add up to $1,200.00" |
| Marked as demo | no (`isDemoLoaded` not set) → `POST /transactions/reset` answers **409** "Only demo data can be cleared at once" |
| Called a second time | 200 again; a second INV-DEMO-001 |

Expected: refused on books that have real data or a closed period — or the route removed, since nothing uses it.

PR #647 `c2835545` changes this route a little: the account ids match (no missing-account findings) and one audit row is written. It still posts into the closed month, still leaves the invoice and the bill without entries, is still not marked as demo and still cannot be cleared.

## The controls around it hold

The same probe sends every other writer a September date. **12 of 14 are refused by the period lock** (each answer names the closed period): `POST /transactions`, `/transactions/bulk`, `/transactions/batch-create`, invoice post, bill post, `POST /payments`, void by partial update, full rewrite, delete of a draft, reversal dated in the month, credit refund, the daily recurring job. One more is refused earlier by the never-delete rule (delete of a posted entry). Closing a month that still has a draft dated in it is refused too.

File-level check of the rest: 31 files under `src/server` write ledger entries; 30 mention a closed-period check (`validateAndPrepare`, `assertPostingOpen`, `postingLock`, `assertPeriodOpen`, …); **this route's file is the one that mentions none** (table at the end of `evidence/a7-01-ledger-door-dataflow.txt`). File level only — the writers not sent a request (depreciation, payroll, FX revaluation, landed cost, asset disposal and transfer, stock adjustments, imports, year-end close) were **not** exercised.

## Severity

**Medium.** Period integrity is on `RELEASE_GATE.md`'s "never postponed" list and one request changes a hard-closed month with no audit row. Limits: a signed-in writer of that workspace must send the request by hand, and the content is fixed demo data, not amounts of the caller's choosing.

## Reproduce

```
LF_TEST_DATABASE_URL=postgresql://…/lf_test NODE_ENV=test SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic \
  npx tsx --test --test-force-exit audit/agent7-2026-11-11/probes/a7-07-closed-period-sweep.test.ts
```
Probe and output: fork `Chaim-Richard/ledgerflow`, branch `arena/a91ccf77-ledgerflow` — `audit/agent7-2026-11-11/probes/a7-07-closed-period-sweep.test.ts`, `…/evidence/a7-07-closed-period-sweep.txt`.

`src/server/` belongs to AI #1; nothing was patched.
