**Filed by AI #7 (independent audit, issue #150). Review only — no application code changed.**
Pin: `main` `2ac666b46ca3895456ebee67ad6e01d62f49457e`.

## What the gate says, and what is there

`ledger-door-baseline.json` is `{ "server-direct-ledger-write": 0 }`, and `src/tests/bug-patterns.test.ts` ("AU-6: ledger entries written outside the door never increase") passes. `docs/archive/TRACKER_DONE.md` records AU-6 as "ratchet now 0".

The scanner (`scripts/bug-patterns.ts:204-209`) only recognises a write whose own call text contains `collection('transactions')`:

```ts
db.collection('transactions').doc(id).set(entry)        // seen
```

The server code writes entries the other way round:

```ts
const txRef = db.collection('transactions').doc(id);
t.set(txRef, entry);                                     // not seen
```

Following that one assignment with the TypeScript binder (scope-correct, no name matching) finds **18 direct writes in 14 files** where the gate reports 0:

| Kind | Count | Where |
|---|---|---|
| Written as the validator returned it | 8 | `crudRoutes.ts:168`, `:345`; `reconcileRoutes.ts:168`, `:190`; `ledgerBulkCommit.ts:380`; `inventoryRoutes.ts:162`; `leaseRoutes.ts:113`; `revenueRoutes.ts:114` |
| Mark-only update (void / reversed-by) | 6 | `reverseRoutes.ts:219`; `assetDisposalService.ts:173`, `:188`; `assetTransferService.ts:126`; `fxRevaluationService.ts:353`; `placeInServiceService.ts:115` |
| Generic partial update | 1 | `crudRoutes.ts:282` (status, type and metadata may change — see #652) |
| **No shared check at all** | **3** | `workspaceRoutes.ts:715` (demo-seed route), `recurringService.ts:261` (recurring job), `paymentService.ts:490` (payment entry) |

## Why it matters

The gate exists so that a new writer cannot skip the door unnoticed; as written it cannot notice the shape this code base uses, so the count of 0 is not evidence. Two of the three unchecked writers are real defects found by running them: the demo-seed route posts into a closed month, and the recurring job posts an entry 0.01 out of balance in the home currency (both filed separately). The third, the payment entry, balances by construction (checked by reading `paymentService.ts:386-470` and by the payment probes), but nothing would catch a future change that breaks it.

Severity: **Medium** (a control that reports less than is there; not itself a wrong number).

## Reproduce

```
npx tsx audit/agent7-2026-11-11/probes/a7-01-ledger-door-dataflow.ts
```
Output: `audit/agent7-2026-11-11/evidence/a7-01-ledger-door-dataflow.txt` on fork `Chaim-Richard/ledgerflow`, branch `arena/a91ccf77-ledgerflow`. The probe is a read-only scan; no database is needed.

## Why this is an issue and not a patch

Teaching the scanner to follow the assignment makes the count 18 (or 4, if validated and mark-only writes are classed as allowed). Either way `ledger-door-baseline.json` would have to be **raised**, and raising a baseline is not an agent's decision (`docs/COORDINATION.md` rule 4, `src/AGENTS.md`), as is the order: move the three unchecked writers through `ledgerWrite` first, then tighten the scanner at the true count. The probe's detection code (about 60 lines) can be lifted into `scripts/bug-patterns.ts` as it stands.
