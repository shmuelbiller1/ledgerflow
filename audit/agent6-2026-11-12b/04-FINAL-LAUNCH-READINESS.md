# Agent #6 — launch-readiness assessment at upstream `main` `e33b3f2` (12 Nov 2026, second session)

## Verdict: **NOT READY** for real (multi-tenant, paying-customer) accounting.
## **Conditionally ready** for the synthetic-bookkeeping beta (stage A) — condition: the two fixes on this
branch are reviewed and merged, and the open money-lane issues below are accepted as known limits in writing.

This is the same verdict the earlier Agent #6 session reached at `c82bead4`; what changed is *why*. The two P0
multi-tenant takeovers (AF6-001/AF6-002) and nine of the P1s from that session are now **fixed on `main`**, and
this session verified five more earlier findings as genuinely closed. What keeps the verdict at "not ready" is a
different, smaller set:

| # | What keeps it out of "ready" | Severity | State |
|---|---|---|---|
| 1 | A bookkeeper could edit or reverse an invoice's or payment's ledger entry through the generic API, and un-post a posted entry — the books and the documents then disagree with no record of what the entry was (**#652**, **#662**) | P1 | **fixed on this branch** (409 with a pointer at the document; before/after in the audit row) — not yet merged |
| 2 | Sales-rep commission and cash-basis revenue were 100×/10× out for a foreign payment, and a part-paid foreign invoice recognised its whole posting (**#651** + AF6B-003) | P1 (reporting, feeds tax) | **fixed on this branch** with worked figures |
| 3 | A foreign invoice paid in instalments leaves a permanent cent in A/R (#653) and a recurring job can post a cent out of balance (#654) | P2 | **open**, AI #1's lane, not re-executed here (needs PostgreSQL) |
| 4 | Credit notes/vendor credits were writable from the browser and a forged credit could be applied and refunded (#646) | P1 | partly closed by migration `20261112100000` and `creditService`'s status gate; **not executed here** (no PostgreSQL) |
| 5 | The database gates are now **run**, not deferred: with a local PostgreSQL 16.2, `npm run test:rules` reports ALL RLS TESTS PASSED, unit shard 4/4 (777 tests) is clean and the new endpoint test proves the 409s. Browser suites ran only in CI (5/5 pass) | gate | **verified** (browsers only in CI) |

## What supports the "conditionally ready" half

- **The books' arithmetic holds.** This session ran independent invariants on the code that produces the figures:
  trial balance balances and every row is its own lines; assets = liabilities + equity + profit; the P&L's net
  income is the balance sheet's; the cash-flow statement closes to the balance sheet and its sections add up; the
  general ledger agrees with the trial balance on all eight accounts of the fixture; void entries count nowhere.
  Loan schedules close at zero with principal parts summing to the principal (six shapes incl. 30-year, 0 %, 24 %,
  one month); depreciation sums to cost − salvage and never dips below salvage (five shapes, both methods);
  allocation never loses a cent; US withholding is monotone and its Step-2 relation `2 × Step2(W/2) = Std(W)` holds
  to the cent; FICA stops at the wage base; minor-unit conversions match hand arithmetic.
- **The audit trail is real, not a claim.** A five-entry chain built by the production builder verifies, and a
  changed `details`, a deleted entry, a reordered stream and a forged `prevHash` are each detected at the right id.
- **The two P0 tenant takeovers are closed and pinned by tests** (`tenant-create-boundary`, `home-currency-balance`).
- **Earlier open issues 641/648, 517/518/519, 161, 141, 130, 143, 160 and the 12 Nov patch family are fixed**,
  re-verified here by running the code rather than by reading the changelog.

## What an honest auditor cannot say

- That the whole repository has been audited. This session covers the report/ledger paths named above, plus the
  re-verification list; the ~3,700-file codebase has large areas (inventory costing, payroll posting, banking
  importers, PDF rendering, most React screens) that this session did not read line by line.
- That CI is green *for this branch*: the branch has not been pushed through GitHub Actions yet; the local gates
  (`tsc`, ESLint on touched files, the focused suites, one unit shard) are recorded in
  `03-TEST-AND-EVIDENCE.md`.
- That every DB-gated suite is green: only shards 2/4 and 4/4 were run against PostgreSQL here (both clean after
  the fixes), and the RLS script passed; the remaining DB-gated tests run in CI.

## Recommended order to close the gap

1. Merge the two fixes on this branch (they are small, separated by concern, and each carries its own tests).
2. Take #653 and #654 as one money-lane branch with the DB probes the issues already contain; they are cents, but
   in control accounts and permanent.
3. Close #646 by proving, against a disposable PostgreSQL 17, that a browser session cannot insert or settle a
   credit note — the migration is in place; the proof is not.
4. Run the RLS suite and the six DB-gated integration suites once on the release candidate, and the browser shards;
   attach the run ids to the release gate.
5. Only then move the release gate from "conditionally ready" to "ready".
