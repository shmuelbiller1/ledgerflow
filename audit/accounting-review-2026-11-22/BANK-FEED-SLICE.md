# Banking review: Plaid sync slice

**Revision:** `9b815a58ebbe1d0f99c44f908ee77b7fbaa73705`. **Status:** partial; not a full bank/reconciliation audit. This slice examines ingestion and cursor design, not live bank feeds or the deployed database.

## Source trace

`syncAllPages` in `src/server/routes/plaidRoutes.ts:208-227` gathers pages and restarts on the designated mutation-during-pagination error. `syncOneBank` (`:239-302`) takes a bank lease, reads the saved cursor, converts provider rows and calls `storePlaidSync`. `src/server/services/plaidIngest.ts:106-205` writes in chunks: earlier successful chunks may remain after a later failure, but only the final chunk writes the cursor; retries are intended to deduplicate. It checks the expected cursor and lease for each chunk. Matched changed/removed lines are flagged rather than automatically editing posted ledger entries. A previous report's description of *all rows in one database transaction* is oversimplified for histories larger than the chunk size.

These are source observations, not proof of crash safety or race safety under actual Postgres transaction isolation.

## Investigate: malformed provider rows and cursor progression

**Status: reproduced with fake provider and isolated real PostgreSQL; real-provider occurrence not established.** `plaidRowsAsBankLines` (`plaidIngest.ts:63-72`) silently skips non-pending rows with missing transaction ID, malformed date shape or non-finite/missing amount. `syncOneBank` (`plaidRoutes.ts:285-299`) passes only converted lines to storage and still supplies the new cursor; its log counts fetched `added` and `modified` rows, not rejected conversions. Pending authorizations are intentionally skipped and are a different case.

Independent `plaid-malformed-database.test.ts` gave `syncOneBank` a fake response containing two posted rows, one missing a date. In an isolated PostgreSQL 18.7 test database it stored **one** line, advanced the persisted cursor from `before` to `after`, and logged **ok / 2**; the next sync started at `after`, with no missing line or rejection record. This confirms the failure behavior under a malformed response, not that Plaid's real contract permits that response or that any live customer's data was lost. The test asserts the current defect, so a correct change should make it fail until updated.

**Next:** Verify the provider contract; extend the fake-provider/Postgres test to malformed modified rows, received/accepted/rejected counts, and the UI/error path. The safe contract should either durably quarantine every rejected non-pending row before advancing, or fail without advancing, with a clear actionable message. Also test interruption after each chunk, simultaneous leases and expirations, retries, duplicate IDs, modified and removed matched lines, account/currency mapping, and the eventual bank reconciliation.

## Tests run

Earlier Node 22 run: **7 tests passed**, while the database suite was explicitly skipped. Subsequent Node 24 run against the isolated PostgreSQL 18.7 database included the `plaid-sync-ingest.test.ts` real-DB cases in a 97-test accounting database batch, all passing. The separate synthetic malformed-row database diagnostic described above passed while asserting the current defect. No real bank credentials or provider call was used.

```sh
LF_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55439/lf_test NODE_ENV=test SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic npx -y node@24 --import tsx --test --test-force-exit audit/accounting-review-2026-11-22/plaid-malformed-database.test.ts
```
