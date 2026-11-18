# SBX-1: overlay storage, scoped reads and private review

The storage slice of [SBX-1](../prompts/SBX-1-assistant-sandbox.md) merged in #787 after the CMD-1
prerequisites: periods (#731), accounts (#743, chart coverage #774), inventory (#752), workspace
administration and settings (#767, #769). The report/balance slice adds worked HTTP read parity and the
first group of raw-SQL conversions. **No production caller selects a sandbox**. The public report and
balance mounts still use the live handle. The review service described below is internal; no assistant
credential, public route, command-registry entry or screen can create or accept a sandbox.

## Database and server boundary

- `sandbox.sandboxes` and `sandbox."sandboxSteps"` store metadata separately from the 69 document
  overlays. `sandbox_read` provides one read-only, invoker-security view per overlay, using the same
  names as in `public`. For allowed book collections, real workspace rows not shadowed by an overlay
  are read on the next statement; a tombstone shadows a row even if it would have matched the caller's
  filter. The query compiler filters, sorts, pages and counts the resulting relation in PostgreSQL.
- `getDb({ sandboxId })` is **internal**. Any future caller must first authenticate, verify that the
  sandbox belongs to that person, and check their current role against the **real** workspace. A draft
  membership edit must not authorize any action. The database scope is not a substitute for that
  ownership check. The `workspaces` collection is scoped by the document's id; other collections are
  scoped by `workspace_id`. Unscoped real rows (including person-level recovery codes) are not part of
  a workspace sandbox. Read tools must still allowlist fields: for example, an allowed invoice can
  contain a payment link. A table-level policy is not permission to expose whole documents.
- The adapter checks out one connection and sets `LOCAL ROLE lf_sandbox` and the sandbox id within
  each transaction, including a single read. Commit and rollback both clear the scope. The role is
  `NOLOGIN`, is not a browser or service-key role, and has only `SELECT` on the allowed live book
  collections. PostgreSQL refuses live DML, `SELECT FOR UPDATE`, and sequence changes. Copy-on-write
  uses an ordinary MVCC read; only the overlay row is updated. No overlay FK points into `public`.
- A sandbox handle does not expose `.pool`, and its transactions cannot reserve the live audit chain.
  Raw SQL readers use `db.tableSource(name)` and `db.readRows` for trusted parameterized SELECTs outside
  an existing transaction; the adapter uses the sandbox role and a read-only transaction. The default
  `getDb()` and its pool are unchanged. The role and schema are not an execution boundary for
  *arbitrary SQL supplied by a caller*: no entry point takes SQL from a request.
- The first change keeps the SHA-256 of the live JSONB content as `base_version`; subsequent edits
  and tombstones retain it. A new row stores a null base version. This checkpoint records the
  version for the review service below.
- New document-table migrations register the table in `public.lf_rules`, then run
  `call sandbox.install_overlay('tableName');` as the migration owner. Registration alone creates an
  overlay-only view, not a live-read grant. A new collection must be explicitly reviewed and added to
  `sandbox.has_live_book_read` before it gets a live source (then configure it with
  `sandbox.configure_overlay_reads`). Review table-specific triggers and cross-record constraints;
  do not copy indexes, FKs or triggers wholesale. The database guard discovers public document tables
  by shape, so forgetting both registration and overlay still fails the test.

### Live-read hardening (#825)

`20261118130000_sandbox_live_read_boundary.sql` leaves the 43 reviewed book collections scoped as
before and removes live access to the other 26 collections. Examples include API keys, bank
connections, invites, cached idempotency responses, recovery codes, personal notifications and
support records. Their `sandbox_read` views read overlays only; they have no dependency on the live
relation. The role's live `SELECT` grant is revoked, backed by a restrictive policy when the
query actually runs as `lf_sandbox`. A live login that can switch to that role keeps its own access
before switching. A new collection starts in overlay-only mode. No new draft commands are admitted.

## Public trigger inventory

These are the non-internal triggers on the migrated public document tables. The RLS suite checks
that a new trigger is reviewed rather than silently omitted or copied to the overlay. **Definer**
means `SECURITY DEFINER`.

| Trigger function | Reads other tables or writes elsewhere? | Overlay decision |
| --- | --- | --- |
| `lf_guard` (definer) | `lf_rules` and workspace period settings **only on browser writes** | Reused. On either trusted server path it only maintains `updated_at`; the sandbox connection has no browser JWT. |
| `lf_guard_special` (definer) | Workspace role/membership for browser lock-date writes | Browser-only; not attached. Server authorization must check the real membership and use the same command gates. |
| `lf_guard_invoice_approval` (definer) | Workspace role/membership, only for browsers | Browser-only; not attached. The shared server command is responsible for the approval decision. |
| `lf_chart_account_client_guard` (definer) | No; own row | Reused, browser-only; opening-balance commands are not admitted to the sandbox. |
| `lf_document_settlement_guard`, `lf_guard_document_settlement` (both definer) | No; own row | Reused, browser-only. The reviewed payment handler must be able to update settlement in both server modes. |
| `lf_documents_kind_guard`, `lf_asset_accounting_guard` | No; own row | Reused, browser-only. Draft documents use a reviewed command schema (such as `tasks.create`); asset commands are not admitted. |
| `lf_rma_guard`, `lf_warranty_guard`, `lf_inventory_cost_guard` (definer) | No; own row | Reused, browser-only. The shared `customer.create` input rejects protected history; inventory cost commands are not admitted. |
| `lf_enforce_balanced_ledger` (definer) | No; own row, may settle FX rounding into that row | Reused for visible entries, not tombstones. The corrupt-fixture switch applies only to live tables. Tests verify that even with that switch set, overlays reject an unbalanced posted journal entry and still settle FX rounding. |
| `lf_transactions_ledger_integrity` (definer) | Reads chart accounts | The same trigger reads the merged chart on overlay writes and the live chart on real writes. Both ledger triggers limit the fixture exception by target schema: `current_user` in a definer function is the owner, not the writer. No balance or account rule was changed. |
| `lf_period_balances_stale` (definer) | Updates public `periodBalances` | **Not attached.** The report/balance slice must avoid using live snapshots when they no longer describe the draft. |
| `lf_repost_mark` (definer) | Reads `stockMoves`, writes public `repostQueue` | **Not attached.** Provisional repost state must be wired to the sandbox before enabling stock commands. |
| `lf_stock_move_db_seq` (definer) | Consumes `public."stockMoves_db_seq"` | **Not attached.** The stock-command slice needs provisional ordering that does not allocate from any live sequence. |

Row `CHECK` constraints are reused. The real unique indexes on normalized asset tags and customer-to-
vendor links are not applied across the merged relation by copying the indexes: an index on an overlay
sees only copied rows. Check the existing service-level validation and add parity coverage for those
commands before enabling them. Do not substitute a second accounting implementation.

## Single-workspace HTTP reports and balances (merged in #790)

- Both router factories take a server-chosen Firestore handle. The sandbox-bound instance checks the
  sandbox's person, workspace and expiry, then checks current membership on the **live** handle. Report
  settings and book entries come from the bound handle, not from caller-supplied scope or role data.
  No production URL or header opts in. Group consolidation reports span multiple workspaces: a bound
  single-workspace router refuses them instead of silently reading the group's live books.
- Explain counts *visible* file links in SQL (no file reads). Entry years use the same `DISTINCT`
  query on the scoped relation. The count for `closed-through` uses the Firestore aggregate API.
  `periodBalances` and `stockMoves` readiness use scoped catalog probes on the checked-out transaction
  connection when present. The SQL inventory drops from **41 to 36** references across the server;
  the first group is at **zero**. `sandbox-sql-baseline.json` caps the remaining references per file.
- Sandbox reports bypass the shared P&L/balance-sheet answer cache and do not populate it. They also
  bypass L-123 snapshots: the live snapshot may cover edits made only in the draft. The same
  full-history calculation is already used when no live snapshot is available. `snapshot`,
  `entriesRead` and `closedThrough` can therefore differ, but not the figures. Sandbox responses are
  not cacheable by the browser. Live cache and snapshot selection still work as before.

## Records and metadata SQL (merged in #792)

Account-merge candidates, entry links, stages, tag enumeration/rename, time entries, and watch
lookups now read through the supplied handle's merged table sources. The open-task cap uses the
scoped aggregate API instead of a raw count. The watch sender explicitly refuses a draft, since
it scans workspaces and notifies people. The audit writer exits before reserving a chain head
for a draft, so scoped tag and link edits never reserve or add a real audit entry. This removes
**10** references and takes the SQL ratchet from **36 to 26**. It does not enable assistant
commands or change their live behavior.

## Stock, period and settlement SQL

- The payment-allocation, period-closing, stock-closing and repost probes use `tablesExist`. A draft
  bypasses all four live readiness flags, and settlement and period probes within a transaction
  use its checked-out client. A live missing-table flag cannot suppress draft stock history.
- The audit fallback reads through the scoped adapter. Draft audit writes still return before
  reserving a chain head. Draft stock history keeps `seq` but never assigns a live `dbSeq`.
  Repost execution refuses a draft until it has a draft dirty queue; the live trigger stays off overlays.
- This lowers the document SQL ratchet **26 → 20** without a migration or any change to ledger figures.

## Verification

- `src/tests/pg-firestore.test.ts` keeps its existing worked list assertions and compares the same
  stored rows, query variants and paginated stream through an empty overlay.
- `src/tests/scheduled-reports.test.ts` runs the existing report-pack builder against both handles
  (P&L, balance sheet, receivables aging). It checks worked figures, then shows that edited and deleted
  rows change only the sandbox pack.
- The existing L-123 report, balance and range fixtures now compare actual HTTP answers over empty
  overlays, including the worked year-end, currency and label ledgers. The report and operational
  route suites and statement JSON keep their original worked assertions and compare both scopes.
  `sandbox-report-reads.test.ts` proves a closed-year edit is reflected despite a fresh live snapshot
  and warm live cache: the sandbox reports 25,000 cents and the real reports still say 12,000. It
  also checks entry years, file-link counts, stock history, unchanged live cache readiness and refusal
  after access removal or expiry.
- `src/tests/sandbox-db.test.ts` covers session-local scope, cross-sandbox and workspace isolation,
  failed and concurrent writes, the no-live-lock case with a flushed overlay write, and base versions
  across a JSONB update, `lf_update` that leaves `updated_at` unchanged, and a ledger trigger write.
  `supabase/tests/rls.test.sql` checks browser refusal, storage coverage, actual role privileges, and
  stock-sequence isolation.
- `sandbox-record-reads.test.ts` checks a draft-wide rename with two matches while live still has
  three original tags. It also checks link visibility and refusals, watch timestamps, merged
  stage assignments, per-person time ordering, account-merge candidate counts and the task limit.

- `sandbox-readiness.test.ts` uses PostgreSQL to compare missing draft relations with warm live flags.
  It checks cold probes on a single connection, a 750-cent draft stock move despite a live missing flag,
  the live audit chain and fallback, and refusal before a draft repost reads the queue.

## Durable steps and review (service layer)

The internal entry points are `openSandbox` and `reviewSandbox` in `src/server/commands/sandboxReview.ts`.
The caller must supply a verified person session, not an API key. The service checks the binding,
current live membership, writer role, workspace status and workspace MFA policy in the batch. An
admin who is not a writer in these books cannot act as the person. Neither the regular command router
nor the public report mounts accept a sandbox id.

- **Draft:** `add` stores successful, schema-parsed inputs with their stable record IDs, row content
  versions and typed effect intentions. The reviewed list is `customer.create`, `invoice.create`
  (no stock-moving writes), `payment.receive` and `tasks.create`. An unreviewed command or table write
  is refused. The draft role cannot reserve an audit head or consume a live sequence. The step can
  only use its scoped transaction: accidental global reads, separate writes and provider-result calls
  fail the stage, even if caught. Other workspaces' rows remain invisible.
- **Review:** `review` rebuilds provisional rows through the same handlers on a current snapshot. Each
  edit, reorder, reject or accept supplies the revision it was shown. A change to a depended-on row,
  an earlier draft or the posting preview can mark an affected step `needs-recheck`; a step that no
  longer validates is `failed` with a reason. A rechecked step needs an explicit selection and
  confirmation of the new revision; Accept All skips it. Invalid edits or orders roll back the rebuild.
- **Accept:** Selection includes required earlier writes and explicit record links. Each selected step uses the shared
  runner’s validation, prepare hook, handler and audit path as the person, inside one serializable
  transaction. The next step sees the previous one's writes in
  that transaction. Live targets must still belong to these books, and a new record cannot overwrite
  an occupied ID. The batch verifies the reviewed write targets, posting date, money and effect
  intentions before committing. It never copies overlay rows to `public`. A failure names the
  step and rolls back the selected writes, audit and draft-state changes. Remaining drafts are rebuilt
  on the result in the same transaction.
- **Numbers and effects:** Payment series reservations are provisional until acceptance, which invokes
  the real allocator. Invoices retain the caller's number as in the existing `invoice.create` contract.
  Draft previews do not run arbitrary `afterCommit` callbacks. Only the committed live attempt runs
  them (best effort, as with direct commands; not a durable mail outbox). Typed preview intents are
  not provider payloads and do not promise delivery. Existing inverse hooks are recorded where
  available; Undo itself is not exposed.
- **Limits:** At most three active sandboxes per person, 200 unresolved steps per sandbox and 50 MB
  of accounted active draft data per workspace. A whole-draft rejection clears the overlay and closes
  the binding. Expired drafts cannot be used; a scheduled cleanup of expired/closed history is still
  needed. No new migration is needed for this slice.

The remaining document SQL ratchet moves **20 → 0**. Module record counts now read the scoped
relation. Auth lookups, usage metering, cross-workspace rollups and scheduled jobs stay live-only.
The outside-effects source guard catches direct transport use in command definitions; it is a review
alarm, not proof about every service a future command might call.

### Verification and remaining scope

`src/tests/sandbox-review.test.ts` runs the service against PostgreSQL. A dependent customer, invoice
and receipt produce **12,500¢ income, 3,000¢ cash, and 9,500¢ receivable** in the draft without
changing live books. The original receipt preview is `PAY-0008`; after a live series change it must be
reviewed again, and acceptance saves `PAY-0019`. An unrelated task stays private. Further cases cover
edit/reorder/reject, stale versions and closed periods, task capacity, a later-step refusal, forced
serialization retries, another sandbox's isolation, occupied live IDs and a concurrent live save.
Run just the local workflow with `LF_TEST_DATABASE_URL` set to a migrated local test DB and
`npx tsx scripts/sandbox-review-smoke.ts`.

| Step | Status |
| --- | --- |
| Overlay schema, role, scoped reads | Foundation #787; reads and settlement #790, #792, #793. Live migration/login capability has not been independently verified here. |
| Draft, review, and real replay | Internal lifecycle above for four reviewed commands. The whole command registry, stock moves, caller-owned counters beyond the reviewed path, and high-risk or plan-metered commands are not admitted. |
| Read tools, assistant credential and review screen | Not implemented. They must enforce private scope and cannot expose a route to accept as an assistant. |
| Undo and housekeeping | Some accepted steps have an inverse; no Undo handler. Active limits and expiry checks work; scheduled deletion is open. |

SBX-2 product speed work is separate.
