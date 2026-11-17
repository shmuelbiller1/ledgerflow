# SBX-1: overlay storage and data-handle checkpoint

The storage slice of [SBX-1](../prompts/SBX-1-assistant-sandbox.md) merged in #787 after the CMD-1
prerequisites: periods (#731), accounts (#743, chart coverage #774), inventory (#752), workspace
administration and settings (#767, #769). The report/balance slice adds worked HTTP read parity and the
first group of raw-SQL conversions. **No production caller selects a sandbox**. The public report and
balance mounts still use the live handle, and no command, token issuer or screen creates a sandbox.

## Database and server boundary

- `sandbox.sandboxes` and `sandbox."sandboxSteps"` store metadata separately from the 69 document
  overlays. `sandbox_read` provides one read-only, invoker-security view per overlay, using the same
  names as in `public`. Real workspace rows not shadowed by an overlay are read on the next statement;
  a tombstone shadows a row even if that row would have matched the caller's filter. The ordinary
  query compiler filters, sorts, pages and counts the resulting relation in PostgreSQL.
- `getDb({ sandboxId })` is **internal**. Any future caller must first authenticate, verify that the
  sandbox belongs to that person, and check their current role against the **real** workspace. A draft
  membership edit must not authorize any action. The database scope is not a substitute for that
  ownership check. The `workspaces` collection is scoped by the document's id; other collections are
  scoped by `workspace_id`. Unscoped real rows (including person-level recovery codes) are not part of
  a workspace sandbox. Read tools must still allowlist what they return; they must not expose the
  whole server document catalog.
- The adapter checks out one connection and sets `LOCAL ROLE lf_sandbox` and the sandbox id within
  each transaction, including a single read. Commit and rollback both clear the scope. The role is
  `NOLOGIN`, is not a browser or service-key role, and has only `SELECT` on public document tables.
  PostgreSQL refuses live DML, `SELECT FOR UPDATE`, and sequence changes. Copy-on-write uses an
  ordinary MVCC read; only the overlay row is updated. No overlay FK points into `public`.
- A sandbox handle does not expose `.pool`, and its transactions cannot reserve the live audit chain.
  Raw SQL readers use `db.tableSource(name)` and `db.readRows` for trusted parameterized SELECTs outside
  an existing transaction; the adapter uses the sandbox role and a read-only transaction. The default
  `getDb()` and its pool are unchanged. The role and schema are not an execution boundary for
  *arbitrary SQL supplied by a caller*: no entry point takes SQL from a request.
- The first change keeps the SHA-256 of the live JSONB content as `base_version`; subsequent edits
  and tombstones retain it. A new row stores a null base version. This checkpoint records the
  version, but does not rebuild or mark steps for re-check.
- New document-table migrations register the table in `public.lf_rules`, then run
  `call sandbox.install_overlay('tableName');` as the migration owner. Review any table-specific
  trigger or cross-record constraints; do not copy indexes, FKs or triggers wholesale. The database
  guard discovers public document tables by shape, so forgetting both registration and overlay
  still fails the test.

## Public trigger inventory

These are the non-internal triggers on the migrated public document tables. The RLS suite checks
that a new trigger is reviewed rather than silently omitted or copied to the overlay. **Definer**
means `SECURITY DEFINER`.

| Trigger function | Reads other tables or writes elsewhere? | Overlay decision |
| --- | --- | --- |
| `lf_guard` (definer) | `lf_rules` and workspace period settings **only on browser writes** | Reused. On either trusted server path it only maintains `updated_at`; the sandbox connection has no browser JWT. |
| `lf_guard_special` (definer) | Workspace role/membership for browser lock-date writes | Browser-only; not attached. Server authorization must check the real membership and use the same command gates. |
| `lf_guard_invoice_approval` (definer) | Workspace role/membership, only for browsers | Browser-only; not attached. The shared server command is responsible for the approval decision. |
| `lf_chart_account_client_guard` (definer) | No; own row | Reused. |
| `lf_document_settlement_guard`, `lf_guard_document_settlement` (both definer) | No; own row | Reused. |
| `lf_documents_kind_guard`, `lf_asset_accounting_guard` | No; own row | Reused. |
| `lf_rma_guard`, `lf_warranty_guard`, `lf_inventory_cost_guard` (definer) | No; own row | Reused. |
| `lf_enforce_balanced_ledger` (definer) | No; own row, may settle FX rounding into that row | Reused for visible entries, not tombstones. Real and overlay tests compare the same refusal and the same rounded home amounts. |
| `lf_transactions_ledger_integrity` (definer) | Reads chart accounts | The same trigger reads the merged chart on overlay writes, and the live chart on real writes. No balance rule was changed. |
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

## Records and metadata SQL

Account-merge candidates, entry links, stages, tag enumeration/rename, time entries, and watch
lookups now read through the supplied handle's merged table sources. The open-task cap uses the
scoped aggregate API instead of a raw count. The watch sender explicitly refuses a draft, since
it scans workspaces and notifies people. The audit writer exits before reserving a chain head
for a draft, so scoped tag and link edits never reserve or add a real audit entry. This removes
**10** references and takes the SQL ratchet from **36 to 26**. It does not enable assistant
commands or change their live behavior.

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

## Remaining checklist (in SBX-1 order)

| Step | Status |
| --- | --- |
| Overlay schema, role and data handle | Merged in #787. Live migration/login not independently verified in this pass. |
| Empty-overlay equivalence | List/paging/stream and report pack verified in #787; worked single-workspace HTTP report and balance figures verified in #790. Multi-workspace consolidation is not a single-workspace read. |
| Raw SQL, caches and effect stub | Reports and record metadata scoped. Next groups: period/stock and payment allocation readiness (`allocationLedgerReady`), repost and audit; then remaining metering, auth, alerts and jobs. Retain live-only behavior where required, never silently read live from a sandbox. The effect stub and its ratchet are still open. |
| Run steps and prove isolation | Not started. Stable ids, provisional numbering, customer → invoice → payment, live-save concurrency, every command leaving all real tables/sequences/audit and external effects unchanged. |
| Accept/edit/reject and Undo | Not started. Dependency closure, authorization, transactional real replay, inverse and rebuild, high-risk confirmation. |
| Conflicts and housekeeping | Content versions exist; recheck, plan/period changes, fresh previews, quotas and expiry cleanup are not implemented. |
| Tools and screen | Not exposed. Sandbox-only reads, assistant token refusal on all live writes, untrusted-input tests and the review screen still required. |

Remaining raw-SQL groups (one PR per group, counts are relation references):

| Group | References | Files (see `sandbox-sql-baseline.json`) |
| --- | ---: | --- |
| Stock, period and settlement plumbing | 6 | Allocation readiness, audit fallback, period and stock closing, repost marker |
| Live access, usage and jobs | 20 | Auth, plan capacity, asset reminders, book alerts, ledger health, module usage, email digest, practice dashboard |

No new database migration in the report or record-read slices. SBX-2 speed work stays out of these steps.
