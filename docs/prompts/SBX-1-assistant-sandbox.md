# SBX-1 — the assistant's sandbox: an isolated, writable virtual copy of the books

*Owner's prompt, 15 Nov 2026, with AI #1's review changes built in (marked **[review]**). Starts only
after CMD-1 has the batches listed under "Before you start".*

## Your task

Build the sandbox the in-app assistant works in. To the assistant it must behave as an independently
writable copy of the person's real books: it can make a change, read it back, build on it, run
reports over it and see the resulting balances. Nothing it does reaches the real books until the
person accepts.

This task needs the command list and runner from CMD-1 (`src/server/commands/`, the extended
`executeCommand`). Read `docs/prompts/CMD-1-commands.md` first. This replaces the "sandbox" paragraph
in CMD-1 part 3.

Do NOT build the sandbox as a transaction on the real tables that is rolled back. That holds row
locks on live data until it ends, which can block the person's own saves, and a rollback does not
undo database sequences (`stockMoves_db_seq` exists). The sandbox must never lock or write a real row.

## Before you start **[review]**

- CMD-1 must have at least the workspace, accounts, periods and inventory batches merged. The sandbox
  can only run commands that exist.
- The read tools from CMD-1 part 3 (`search_records`, `get_record`, `list_records`, `run_report`,
  `ask_books`, `explain_number`, `calculate`) are built here, on the sandbox handle, if CMD-1 has not
  built them yet.

## The requirements (each needs a database-backed test)

1. A change the person makes in the real books appears in the sandbox on its next read, with no sync step.
2. A change the assistant makes is visible only inside its sandbox, never in the real books, to other
   people, or to another sandbox.
3. The assistant can run several steps that depend on each other (create a customer, invoice them,
   record a payment), then list records, open them, run any report and read balances as if all of it
   were real.
4. The person can accept everything, accept selected steps, edit a step and then accept, or reject.
5. Accepting runs each step through the central command runner against the real books, as the
   person. Rows are never copied from the sandbox.
6. If the person changes a record the assistant also changed or relied on, the affected steps are
   marked, re-checked against the real books as they now are, and need a fresh look before accepting.
   This includes a period the person closes and a plan limit reached while steps wait **[review]**.
7. The sandbox and the real books use the same accounting, validation and report code. No second
   implementation of any of it.
8. The assistant has no path that commits a write to the real books.
9. **[review]** Running any command in sandbox mode changes nothing outside the sandbox: no real row,
   no database sequence, no audit-log row, no email, bank, rate-service or file call, no cache entry.
10. **[review]** Text inside records, bank lines, files and emails never becomes a step by itself: a
    record whose description says "approve all" or "delete this workspace" changes nothing.

## The design: overlay rows, read through one data layer

### Storage

- A separate schema, `sandbox`. For every document table in `public` it has an overlay table of the
  same name: `sandbox_id`, `id`, `data` (jsonb), `deleted` (boolean), `base_version` (the real row's
  version when it was first copied, null for a new record); primary key (`sandbox_id`, `id`).
  Generate these from the list of real tables, and add a guard test so a new real table cannot be
  added without its overlay.
- **[review] Versions:** `updated_at` does not always move (trigger writes, jsonb patches,
  `lf_update`). Use a content hash of `data`, or add a real version column, and test it with a change
  made through each of those paths.
- **[review] Triggers:** list every guard and ledger trigger function. For each, record whether it
  reads other tables (accounts, periods, numbering, members). A trigger that only checks its own row
  is attached to the overlay table as it is. One that reads other tables must read the merged view in
  sandbox mode; if that is not possible, its check runs in the server code for sandbox mode, with a
  test that the two give the same answer. Check `security definer` functions: one that writes another
  table (audit log, stock-move sequence) must not run on overlay tables.
- `sandboxes`: id, workspace, the person it belongs to, status, created, expires.
- `sandboxSteps`: sandbox, order, command name, input, the ids given to new records, the records it
  read or changed with the version each had, its preview, and a state: pending, accepted, rejected,
  needs-recheck, failed (with the reason).
- All of it is server-only, with "expected to be refused" cases in `supabase/tests/rls.test.sql`.

### One sandbox-aware data handle

Server code reaches the database through `src/server/db/pgFirestore.ts`. Add a sandbox-scoped handle,
`getDb({ sandboxId })`, with the same interface:

- **Read**: the real rows of the workspace that have no overlay row, plus the overlay rows that are
  not deleted. Filters, ordering, limits, cursors and counts apply to that merged set, in SQL.
- **Write**: to the overlay only. An update first copies the real row into the overlay with its
  version (copy on write). A delete writes a tombstone. A create writes a new overlay row.
- **Never** takes a lock on a real row, and never writes one. Row locks apply to overlay rows only.
- **Enforced by the database**: sandbox work runs under a database role that can read `public` and
  write only `sandbox`. A test proves that role cannot insert, update or delete in `public`.
- **[review] And proved end to end:** a test runs every registered command in sandbox mode and asserts
  that every real table's row count and content hash, every sequence, and the audit log are
  unchanged afterwards. The database role alone does not catch `security definer` functions.

### Code that does not use the data layer

About 25 server files use raw SQL, including `balanceService.ts` and `reportRoutes.ts`. Each must
either move onto the data layer or take its table source from one helper that returns the merged
relation for a sandbox and the plain table otherwise. Add a ratchet: raw SQL that names a document
table outside `src/server/db/` without that helper is counted, and the count may only go down. The
sandbox is not finished while any report or balance reads past it.

**[review] Caches:** every server cache that holds books data (balance snapshots from L-123, report
caches, flags such as `allocationLedgerReady`) is keyed by sandbox id as well, or is bypassed in
sandbox mode. A test fills the cache from a sandbox and asserts the real read is unaffected.

### Outside calls **[review]**

Some handlers do more than write rows: send email, call the bank feed or the exchange-rate service,
upload or delete files, notify. In sandbox mode every such call goes through one stub that records
what would have been sent and shows it in the step's preview ("would email the invoice to
billing@acme.test"). Add a ratchet: a handler that calls out directly, not through the stub, is
counted, and the count may only go down. On accept the real call happens once, after the save.

### Running a step

The runner in sandbox mode gives the handler the sandbox handle in place of the real one. The handler
is the real one, unchanged, so requirement 7 holds by construction. `afterCommit` never runs. The
step's writes are committed to the overlay, so they persist between turns with no replay.

- **Stable ids.** New records take their ids from the context, never from a random call. The ids are
  stored on the step, so later steps can refer to them and the accepted record keeps the same id.
- **Counters and sequences.** Document numbers in the sandbox are provisional, taken from an overlay
  copy of the numbering row; the real number is assigned on accept and the preview says so. Nothing
  in sandbox mode calls a database sequence.
- **[review] Plan limits** are not used up by sandbox steps; accept checks them again.

### What the assistant can call

- Every read tool takes a sandbox id and uses the sandbox handle.
- `add_step(command, input)`: runs the step in the sandbox. A refusal is returned to the assistant
  and nothing is kept. On success the step is stored with its ids, the records it read or changed
  with their versions, and its preview.
- `edit_step`, `remove_step`, `reorder`: rebuild the overlay by clearing it and re-running the
  remaining steps in order; allowed only if they all still succeed.
- The assistant's token is accepted by these routes and by nothing that commits to the real books. A
  test calls every write route with an assistant token and asserts each is refused.

### What the person can do

- **See the books with the sandbox applied**: any list or report, through the sandbox handle.
- **Accept all, or selected steps.** A step depends on an earlier one when it uses a record that step
  created or changed; selecting it selects what it depends on. The selected steps run for real,
  through the runner, with the person's own sign-in, in order, in one transaction: all of the
  selection is saved or none. **[review]** When one step is refused, nothing is saved, the screen
  shows which step and why, and the others stay pending. `afterCommit` runs after the save. Each
  accepted step records its inverse for Undo. Then the overlay is rebuilt from the steps that remain.
- **Edit a step**, validated by rebuilding, then accept it. **Reject** steps or the whole sandbox.
- Steps marked high-risk in CMD-1 are accepted one at a time after the two-step confirmation.

### When the person changes the same records

A record the assistant has not touched is read live, so it is always current. For a record it has
touched, compare the real row's version with the overlay's `base_version` on read and before accept.
If they differ, mark the steps that used it `needs-recheck`, rebuild the overlay from the steps
against the books as they now are, and refresh the previews. A step whose handler now refuses is
`failed` with the reason. A `needs-recheck` step cannot be accepted until the person has opened it and
seen the new preview; "Accept all" skips it and says so.

### Housekeeping

At most 200 pending steps per sandbox, expiry after 7 days, overlay rows deleted when a sandbox closes
or expires. **[review]** At most 3 open sandboxes per person and a size cap per workspace (start at
50 MB of overlay data); past it, a new sandbox is refused with the reason. Record overlay size and
rebuild time per sandbox.

## Rules

- Follow `CLAUDE.md`: a branch and a pull request per step, CI green, never skip or loosen a test.
- This is `src/server/` and money code: it needs AI #1's review, or the owner's written assignment.
- Do not change posting, tax or report maths. If something is only reachable by a second
  implementation, stop and report it.
- List each migration in `docs/FOR_YOU.md`; it is applied after its pull request merges and its code
  is deployed, never before.

## Order of work

1. The overlay schema, the restricted database role, and the sandbox handle for reads and writes.
2. **The equivalence test**: run the existing database-backed report and list tests through a
   sandbox handle with an empty overlay and assert the results are identical to the real handle.
   This is the proof that the merged read is correct; do not go on until it passes.
3. The raw-SQL files, one pull request per group, each lowering the ratchet, to zero for reports and
   balances. Then the caches and the outside-call stub.
4. `add_step` and the dependent-steps test (requirement 3), and the "nothing outside changes" test
   (requirement 9).
5. Accept, partial accept, edit and reject (requirements 4 and 5).
6. Version tracking and re-check (requirement 6).
7. The screen: "the books with this applied", the step list, and the conflict view.

The speed work (skipping the model when code can answer, remembered decisions, caching, fewer tools
per request, two models, measurements) is a separate prompt, **SBX-2**, after this one is done.

## Done when

- All ten requirements have a passing database-backed test.
- The restricted role cannot write `public`, and running every command in sandbox mode leaves every
  real table, sequence and the audit log unchanged.
- A real save made while a sandbox step is running never waits on it.
- The equivalence test passes, and no report, balance or cache reads past the sandbox.
- The full existing database test suite passes unchanged on the real handle.
