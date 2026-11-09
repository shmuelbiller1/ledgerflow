# AI #4 audit slice — AF-001 durable bank cursor

**Reviewed revision:** `48aed6bcc7b6172588b11085dbc653cab7bddb27` (branch base / `main` in this checkout)  
**Date:** 2026-10-21  
**Scope:** Plaid `/sync` cursor advancement and the two UI callers; source review only, no financial/server code changed.  
**Status:** Confirmed data-loss risk; report to AI #1 for ownership. Not fixed in this slice.

## Finding AF-001A — Cursor commits before the feed rows are durably imported

**Severity:** P0 candidate / stop invitation until owner triage. The source demonstrates the unsafe ordering, but this audit did not execute a live Plaid + real database crash/replay test; final impact classification requires that verification.

**Evidence (at reviewed SHA):**

- `src/server/routes/plaidRoutes.ts:242-245`: `/sync` reads all changes from the saved cursor via `syncAllPages` and accumulates added, modified, and removed rows in response-local arrays.
- `src/server/routes/plaidRoutes.ts:261`: the route persists `syncCursor: nextCursor` before responding with the row arrays at `:287`.
- `src/components/banking/Banking.tsx:41-64`: the Banking “Sync now” caller reads JSON but never reads or persists `data.transactions`, `data.modified`, or `data.removed`; it only updates reconnect UI and shows a toast. A successful response can therefore acknowledge cursor advancement while dropping the returned changes from this caller entirely.
- `src/components/ledger/BankFeedImport.tsx:94-122`: the import caller does consume only `data.transactions` into a review draft, but cursor advancement has already occurred. Rows not selected, a dismissed review, or failure before `onImport` leaves the cursor past those changes. The sync response also returns modified/removed separately, and this caller does not map those arrays into the import draft.

**Shortest source-level reproduction:** With a linked connection whose cursor is `c0`, Plaid returns an added transaction and `next_cursor=c1`. The server persists `c1`; the Banking “Sync now” handler ignores the transaction arrays. Reload and sync from `c1` returns no copy of that addition. For the importer, fetch the feed, then dismiss the review without confirming; the cursor remains `c1`, so the addition is no longer delivered by an incremental sync.

**Expected:** Do not advance the durable cursor until all additions/modifications/removals are committed durably and idempotently, or durably stage the full change batch before cursor advancement and expose recoverable pending work. UI success must mean the batch is safely retained, not merely that Plaid answered.

**Limits / verification still needed:** No live Plaid credentials or isolated PostgreSQL concurrency/crash fixture was used. The audit established control flow from source; exact persistence semantics of `onImport` and real server DB transaction boundaries need owner follow-up. Plaid mutation-during-pagination handling is covered separately by unit tests but does not address the consumer/cursor commit boundary.

## Executed check

`npm ci` — passed (Node v22.22.3; package requests Node 24.x, so runtime mismatch noted).  
`NODE_ENV=test SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic npx tsx --test src/tests/plaid-sync-cursor.test.ts` — passed 3/3 tests. These test pagination/restart behavior, not UI persistence or crash/replay. A first attempt before `npm ci` failed because dependencies were absent; not counted as a code failure.

## Coverage scorecard (this slice only)

- Functions / paths identified: 4 (`syncAllPages`, server sync handler, Banking caller, importer caller)
- Reviewed for AF-001: 4/4; independently exercised end-to-end: 0/4
- Verified findings: 1 unsafe cursor-consumer ordering; uncertain live-DB impact/recovery semantics: 1
- Changed since review: 0 (no source changes)
- Other AF cases, workflows, and repository-wide function coverage: not reviewed

## Proposed correction owner

AI #1 owns `/sync` and financial/data persistence. Coordinate an atomic-or-staged ingestion contract with both UI callers, then add a regression test that proves reload/retry recovers additions, modifications, and removals after interruption between Plaid response and user confirmation. Do not treat the existing pagination unit tests as sufficient evidence.
