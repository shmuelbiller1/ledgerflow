# CMD-1 — prompt: every write through one server command list

Written 13 Nov 2026. This file is a prompt for one AI agent. Hand it over with: *"Do the task in
`docs/design/CMD-1-command-registry-prompt.md`."* It touches `src/server/`, which `AGENTS.md` gives to
AI #1, so the owner must assign it to AI #1 or say in writing that another agent may do it.

---

## Your task

Make every change to stored data go through **one list of named commands on the server**, run by one
runner. Today there are about 212 hand-written write routes in 66 files under `src/server/routes/`,
and about 170 places where the browser writes straight to the database. When you finish, both numbers
are zero or are listed with a reason.

Do not change what any action does. This is a change of structure, not of accounting.

## Why

- The checks a write needs (who may do it, valid input, open period, plan limit, one transaction,
  safe retry, audit entry) are applied unevenly: about half the routes validate input with a schema,
  about a fifth write an audit entry, and only 3 use the shared runner in
  `src/server/utils/commandExecutor.ts`.
- An in-app assistant is planned. It must be able to do anything a person can, with every change
  held for the person to accept. That needs each action to have a name, a schema and a preview.
- The screens need one way to call the server.

## Read first

`CLAUDE.md`, `AGENTS.md`, `CURRENT_WORK.md`, the "NOW" rules in `docs/COORDINATION.md`,
`audit/claude-2026-11-11/README.md`, and these helpers, which you reuse and do not rewrite:
`src/server/utils/commandExecutor.ts`, `src/server/utils/idempotency.ts`,
`src/server/services/auditLogService.ts` (`writeServerAuditLog`),
`src/server/services/ledgerDoor.ts` (`ledgerCreate`, `ledgerWrite`),
`src/server/middleware/periodLock.ts`, `planCapacity.ts`, `requireLedgerWriter.ts`.

## What to build

### 1. A command definition

One file per area under `src/server/commands/`. Each command declares:

- `name`: dotted and stable, for example `invoice.create`, `customer.update`, `period.close`;
- `input`: a zod schema; the only source of truth for the shape;
- `roles`: who may run it (`owner`, `accountant`, `bookkeeper`, `viewer`);
- `dated`: which input field is the date, when the period lock applies;
- `capacity`: which plan limit it counts against, if any;
- `handler(ctx, tx, input)`: the work, inside the transaction it is given. Move the existing route's
  body here unchanged;
- `preview(ctx, input)`: reads only. Returns a title, the lines a person needs to judge it, and for
  ledger commands the accounts and amounts that would be posted;
- `audit(input, result)`: the summary stored in the audit entry;
- `proposable`: `false` for the commands listed under "Never proposable".

### 2. One runner

Extend `executeCommand` into the only place that, in this order: resolves the caller, checks
workspace membership and role, validates the input, checks the period lock and plan limit, opens one
transaction, applies retry protection with the existing operation-key helper, calls the handler,
writes the audit entry, and returns one response shape. A command cannot skip a step; a test proves
it by registering a dummy command and asserting each refusal.

### 3. Two ways in, one list

- **Direct**: `POST /api/v1/commands/:name` with a person's sign-in token or an API key whose scopes
  allow that command. It runs at once.
- **Assistant**: the same address called with an assistant token never runs the handler. The runner
  validates, calls `preview`, and stores a proposal: command name, input, preview, who it is for,
  when it expires. New routes: list proposals, read one, **accept** (runs the stored command as the
  person, with their own token), **edit then accept** (the person sends a changed input; it is
  validated again), **reject**. Accepting one item of a multi-step proposal is allowed; a later step
  that refers to an earlier one uses a placeholder id that is filled in when the earlier step runs.
- An assistant token is issued for one person and one workspace, carries that person's role and no
  more, expires within the hour, and is refused by every route that is not a read or a command.

### 4. Old routes become wrappers

Keep every existing address working: its handler becomes one call to the command. No screen or API
user breaks, and the routes can be removed later.

### 5. Browser writes

For each table the browser writes directly (customers, vendors, items, estimates, purchase orders,
rules, chart of accounts, workspace settings and the rest): add the commands, switch
`src/hooks/useEntityOperations.ts` and the direct `updateDoc`/`setDoc` calls to them, then add a
migration that removes the browser's write policy for that table, with "expected to be refused"
cases in `supabase/tests/rls.test.sql`. **Reads stay as they are**; only writes move. List each
migration in `docs/FOR_YOU.md`: it is applied to the live database after its pull request is merged,
never before.

### 6. Generated outputs

From the list, generate `src/server/openapi.ts` (every command, with its schema), the typed client in
`sdk/ledgerflowClient.ts`, and a browser-safe export of the command names, schemas and role lists.
The generator is part of batch 0 and runs for every command added after it; a test fails when any
output is out of date. The screens work (`UI-2-screens-on-commands-prompt.md`) builds on these files.

### 7. A ratchet, so the work can only go forward

Add `commands-baseline.json` and a guard test in the style of `ledger-door-baseline.json` and
`src/tests/bug-patterns.test.ts`. It counts (a) write routes whose handler is not a command call and
(b) direct browser writes, per file. The counts may go down, never up. Lower the baseline in each
pull request.

## Never proposable

Deleting a workspace or an account, restore from backup, roles, invites and membership, API keys,
billing and plan, sign-in and two-step settings, anything under `/admin` or `/system`. The assistant
may read their state; it may not propose them.

## Order of work

1. **Batch 0** (one pull request): the definition type, the runner, the direct address, the ratchet
   at today's counts, the generator from part 6 with its first outputs, and five commands: `invoice.create`, `bill.create`, `journal.create`,
   `customer.create`, `payment.receive`. Before moving each route, add a test that records its
   current request and response for a normal case, a refused case and a retried case; the same test
   must pass afterwards.
2. **Batches 1 to N**: one area per pull request (sales, purchases, bank and reconcile, period close,
   stock, payroll import, settings, tasks). Largest files first: `workspaceRoutes.ts`,
   `taskRoutes.ts`, `periodRoutes.ts`, `accountRoutes.ts`, `inventoryRoutes.ts`.
3. **Proposals**: the assistant way in, after at least 25 commands exist.
4. **Browser writes**, table by table, each with its migration.
5. Delete the wrappers nobody calls, and confirm the generated outputs cover every command.

Small pull requests are the fast way here. One pull request that moves everything will not pass
review or CI and will conflict with every other agent's work.

## Rules

- Follow `CLAUDE.md`: a branch and a pull request for each batch, CI green, review comments
  answered. Never skip, disable or loosen a test to get green.
- Do not change posting, tax or report maths. If a route's behaviour looks wrong, record it in the
  pull request and keep it as it is.
- Run before each push: `npx tsc --noEmit -p tsconfig.json`, `npm run lint`, the unit tests for
  the files you touched with `LF_TEST_DATABASE_URL` set, and `npm run test:rules`.
- Put any decision only the owner can make in `docs/FOR_YOU.md` with the default you used, and keep
  going.

## Done when

- The ratchet reads zero for both counts, or each remaining site is listed with a reason.
- Every command has a schema, a role list, a preview and an audit summary, and the runner test passes.
- The direct-write probes in `audit/claude-2026-11-11/probes/` and the new cases in
  `rls.test.sql` show every browser write to a moved table refused.
- The OpenAPI file and the typed client are generated and current.
- `docs/RELEASE_GATE.md` workflows that were "Yes" are still "Yes".
