# AF-001 — durable bank cursor vs durable bank lines

**Pinned revision:** `8df972dad7e9f282fad317e2c1a8939b9ef96aef` (2026-10-24, `upstream/main`)
**Reviewer:** AI #8, independent audit Pass A · **Date:** 2026-10-25
**Tracked as:** GitHub issue [#151](https://github.com/shmuelbiller1/ledgerflow/issues/151) (open) — this document re-verifies it at the current SHA; it is not a new issue.
**Outcome:** `verified-defect` (data-integrity mechanism; live loss not demonstrated without a Plaid sandbox/Postgres pair).

## Source blobs

| File | Git blob SHA at pin |
|---|---|
| `src/server/routes/plaidRoutes.ts` | `581fc92c3f1b5613fb2db30d902747fdde9d8996` |
| `src/components/banking/Banking.tsx` | `9e7a94eda7956d365f39e5f59cca96fcad2d00e1` |
| `src/components/ledger/BankFeedImport.tsx` | (working tree at pin) |
| `src/tests/plaid-sync-cursor.test.ts` | pagination helper only — does not cover durability |

## What the code actually does

1. `POST /api/v1/plaid/sync` (`plaidRoutes.ts`) loops the workspace's `banks` docs. For each,
   `syncAllPages` reads every `/transactions/sync` page from the saved cursor and returns
   `{ added, modified, removed, cursor }`. The mutation-during-pagination restart is correct and
   has an executable test (`plaid-sync-cursor.test.ts`, 3/3).
2. Still inside the same `try`, the route persists **only the connection state**:
   `await doc.ref.update({ status: 'active', lastSyncedAt, ..., syncCursor: nextCursor, syncLog })`.
   A source-wide search shows the route contains **no `bankLines` read or write at all** — the
   downloaded rows exist only in the HTTP response body.
3. Both browser callers then fail to durably consume the payload:
   - `Banking.tsx → handleSyncNow` reads only `needsReconnect`, `failed`, `success`, `message`.
     `data.transactions/modified/removed` are never referenced. The user gets the toast
     “Synchronized … with bank feed.” even though nothing was stored.
   - `BankFeedImport.tsx → fetchFromPlaid` maps `data.transactions` into a transient review list.
     Persistence requires a manual confirm (`handleConfirm`), and even then the legacy modal emits
     a hardcoded `accountId: 'offset-bank'` line rather than a resolved bank role. `modified` and
     `removed` are ignored.
4. The modern importer (`StatementImporter`, opened from the “Import statement” button) has no
   Plaid path — file upload only — so no other client drains the sync payload.

## Failure sequences (each independently derivable from the code)

- **S1 silent loss, happy path.** User clicks “Sync Feed” on Banking. Server downloads rows A and
  saves cursor C1; the toast says success; the rows are never written anywhere. The next sync starts
  at C1 and Plaid will not return A again. A is unrecoverable from the feed.
- **S2 interrupted review.** Rows reach the legacy review dialog; the user closes the tab or the
  session ends before confirming. Cursor already advanced → same loss.
- **S3 bank-side change/delete.** Plaid returns `modified`/`removed` (merchant/amount corrections,
  removed duplicates). Neither client applies them; previously imported lines stay stale and a
  removed source transaction keeps its line with no marker.
- **S4 misleading contract.** A fully healthy sync with zero changes answers
  `{ success: false, ... }` because success is defined as `transactions.length > 0`.

## Executed evidence

`src/tests/audit-af001-plaid-contract.test.ts` (4/4 passing, no DB needed) pins the structural
contract at this SHA: cursor advancement inside the route, zero `bankLines` references in the
router, no `data.transactions/modified/removed` consumer on either client, the `offset-bank`
literal, and the `success: transactions.length > 0` response shape. When durable ingestion lands,
these assertions must be changed deliberately and this entry closed.

Not executed here (needs `LF_TEST_DATABASE_URL` + fake Plaid client; the exact recipe is already
written in issue #151): the real-Postgres replay/interrupt test S1–S3 and two-simultaneous-sync
behaviour. `plaid.test.ts` currently covers roles, workspace isolation, reconnect, disconnect and
failure isolation — never line persistence, because there is none to assert.

## Severity and scope

- Mechanism = P0 (potential silent loss of bank data + success reported before a durable write;
  G-10 in `docs/FIRST_TESTERS_GATE.md`).
- Practical beta severity = **P1**: the stage-A synthetic beta explicitly excludes real banking
  credentials, so no invited synthetic tester can trigger it today. It becomes P0 the moment a
  real bank connection is used (stage B).
- Owner: AI #1 (server). Suggested correction per issue #151: persist added/modified/removed into
  `bankLines` (dedupe by `importIdentity`, corrections/reversals rather than deletes) in the same
  transaction as the cursor write, or durably stage a replayable import journal and advance the
  cursor only after acknowledgement. Until then, consider hiding the “Sync Feed” button so the UI
  cannot report a success that stores nothing.

## Related observations

- `syncAllPages` caps pagination at 200 pages of 500 (100k changes) and throws “Too many pages”
  beyond that — a safe loud failure, no cursor update on that path (the catch rethrows and the
  bank goes to `failed`). Verified-no-finding.
- `transactionsGet` fallback (no `transactionsSync` on the client) never sets a cursor and repeats
  the last-30-day window each time; dedupe then relies entirely on downstream `importIdentity`.

## Fixed (29 Oct 2026, AI #1, issue #151)

`/plaid/sync` now stores the downloaded rows as pending bank lines **in the same database transaction**
that saves the connection's new `syncCursor` (`src/server/services/plaidIngest.ts`, `storePlaidSync`).
Either both are kept or neither is, so a failure repeats the same rows on the next sync. Each line's
fingerprint is Plaid's `transaction_id` (`plaid:<id>`), so a row sent twice stays one line. Pending card
holds are left out, because Plaid removes them and sends the posted row later. Bank rules suggest an account as for imported lines (EG-9).

Proof: `src/tests/plaid-sync-ingest.test.ts`, run against a real database:
- new rows become lines and the cursor moves;
- a repeated row stays one line;
- a failed store keeps neither the line nor the cursor, and the next sync asks from the old cursor and stores the row.

`audit-af001-plaid-contract.test.ts` F1 now pins this contract in the source.

Review follow-ups in the same PR (#439):
- `/sync` is a writer action (owner, accountant, bookkeeper).
- Only stored rows count as synced.
- Bank Feed Import no longer books the stored rows a second time.
- Bank-side `modified` rows update a line still pending and unmatched, and `removed` rows delete one. A line already matched to a posted entry is only flagged (`bankChange`, `bankCorrection`) for review.
- Each line keeps its Plaid `account_id` and currency. The connection's ledger account is set only for rows of the Plaid account it is tied to (saved on the first sync where all rows share one account) and in the books' currency.

Fixed (31 Oct 2026, AI #1): the CSV path of the legacy Bank Feed Import dialog no longer books to a placeholder `offset-bank` account. The person picks the statement's bank account (cash-role accounts only, the first one pre-selected), and the import is refused when the books have no bank account. Pinned in `audit-af001-plaid-contract.test.ts` (F3).
