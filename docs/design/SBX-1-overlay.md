# SBX-1: overlay storage and data-handle checkpoint

This is the first reviewable slice of [SBX-1](../prompts/SBX-1-assistant-sandbox.md), with the empty-overlay
read proof. The pinned base `6b1fb514` has the CMD-1 prerequisites: periods (#731), accounts (#743;
chart writes in #774), inventory (#752), and workspace administration and settings (#767, #769).
The assistant **cannot use this yet**. No production route, command, token issuer or screen constructs
this handle. It does not change how a person runs a command or a report today.

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
  Raw SQL readers must be migrated to `db.tableSource(name)` and an appropriately scoped read path
  before enabling them. The default `getDb()` and its pool are unchanged. The sandbox role and
  schema are not an execution boundary for *arbitrary SQL supplied by a caller*: the entry point
  never takes SQL from a request.
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

## Verification and next gate

- `src/tests/pg-firestore.test.ts` keeps its existing worked list assertions and compares the same
  stored rows, query variants and paginated stream through an empty overlay.
- `src/tests/scheduled-reports.test.ts` runs the existing report-pack builder against both handles
  (P&L, balance sheet, receivables aging). It checks worked figures, then shows that edited and deleted
  rows change only the sandbox pack. This does **not** certify the HTTP reports that still use direct
  SQL or caches.
- `src/tests/sandbox-db.test.ts` covers session-local scope, cross-sandbox and workspace isolation,
  failed and concurrent writes, the no-live-lock case with a flushed overlay write, and base versions
  across a JSONB update, `lf_update` that leaves `updated_at` unchanged, and a ledger trigger write.
  `supabase/tests/rls.test.sql` checks browser refusal, storage coverage, actual role privileges, and
  stock-sequence isolation.

Next: split the raw SQL migrations by report/balance/service group and install the raw-SQL ratchet.
Bypass or partition the books caches, and prove equivalence for the rest of the database-backed
reports before exposing report tools. Stub outside calls and cover every command's side effects
before wiring the registry. Creation/expiry cleanup and limits, stable step ids, acceptance, Undo,
re-check, assistant tokens/tools and the screen are later slices. The metadata has fields for size
and rebuild timing; this slice does not enforce quotas or schedule cleanup.
