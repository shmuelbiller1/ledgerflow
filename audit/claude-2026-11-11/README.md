# Whole-project audit — 11 Nov 2026

**Pin:** `6f77f3e` (`main`, 10 Nov 2026). One session, one reviewer. Everything under "Ran" was
executed here; everything under "Read" is from source. What was not covered is listed at the end and
is larger than what was.

## Summary

The engineering is in better shape than the product's own status files suggest: the type check is
clean, 5,399 of 5,400 unit tests pass including the database-backed ones, the build passes, every
migration applies to a fresh database, and one workspace cannot read or write another's data.

There is one serious integrity gap, found and reproduced here: **a signed-in person with a writer
role can change ledger tables directly from the browser, skipping every check the server makes**
(C-1). It is not a leak between businesses and a viewer cannot do it, but it means a posted entry
can be rewritten or made unbalanced with no audit entry. It should be closed before any real books.

## Ran

| Check | Result |
|---|---|
| `npm ci` (locked dependencies) | installed |
| `tsc --noEmit` | **0 errors** |
| `eslint . --max-warnings 42` | 0 errors, **42 warnings: exactly at the cap** (M-3) |
| `npm audit` | 17 known issues: 15 moderate, 2 low, **0 high or critical** |
| All 53 migrations on a fresh PostgreSQL 16 | applied cleanly |
| `npm run test:rules` (`supabase/tests/rls.test.sql`) | **passed** |
| `npm test` with the database connected | 5,400 tests: **5,399 pass, 1 fail** (M-2, a speed budget) |
| `npm run build` | **passed** (server bundle 7.1 MB, browser assets 9.8 MB) |
| Direct-write probes (`probes/*.sql`) | see C-1 |

Node here is 22.23; the project asks for 24. Browser tests were not run.

## Critical

### C-1. The browser can write ledger tables directly

**What happens.** With all 53 migrations applied, a session carrying the `authenticated` role and a
bookkeeper membership (what the browser has after sign-in) was able to:

| # | Direct write | Result |
|---|---|---|
| 1 | Insert a **posted, unbalanced** entry (1,000,000.00 to the bank, no other side) | allowed |
| 2 | Rewrite the amount on an existing posted entry (row checked afterwards: 100 became 999999) | allowed |
| 3 | Post a line to an account id that does not exist | allowed |
| 4 | Insert a payment record with no ledger entry behind it | allowed |
| 5 | Insert an invoice already marked paid | allowed |
| 7 | Change a posted entry to draft, then delete it | allowed |
| 14 | Insert a reconciliation marked complete | allowed |

And was correctly refused when it tried to: delete a posted entry in one step, write as a viewer,
write into another workspace, write a bank line, write an audit row in someone else's name, change
an account's stored balance, or change or delete audit rows.

**Why.** `supabase/migrations/20260924190000_init.sql` (lines 376 to 392) gives every writer
`insert`, `update` and `delete` on `transactions`, `journalEntries`, `invoices`, `payments` and
`bills`, and their `lf_rules` rows (line 334) carry no field list. The guard trigger checks only the
period lock and "drafts only" on delete. Balance, account existence, status changes, idempotency and
the audit entry are all enforced in the server (`src/server/routes/transactions/helpers.ts:31`,
`TransactionValidator`), which a direct database call never reaches. The existing guard
`ledger-door-baseline.json` counts only *server* code that writes the ledger directly.

**Who can do it.** An owner, accountant or bookkeeper of that workspace, using their own sign-in
token against the database address in `supabase-config.json`. Not an outsider, not a viewer, not a
member of another workspace.

**Why it matters.** Month-end close, the trial balance and the audit trail all assume entries only
arrive through the server. A bookkeeper, or a bug in any screen, can break that assumption silently.

**The app itself uses this path** in four places, which must move to the server first:
- `src/components/ledger/InboxView.tsx:84` approves a pending entry (new lines and status) directly;
- `src/components/ledger/Ledger.tsx:146` marks entries reconciled directly;
- `src/components/ledger/TransactionGrid.tsx:50` deletes directly;
- `src/components/migration/QBOMigrationWizard.tsx:532` (see C-2).

**Fix.**
1. Move those four writers to existing server routes.
2. A migration that drops `writer_insert`, `writer_update` and `writer_delete` on `transactions`,
   `journalEntries` and `payments`, as `20261013020000_pay_runs_server_only.sql` did for pay runs.
3. For `invoices` and `bills`, keep browser writes only for drafts, or give them a field list that
   excludes status, totals and paid amounts.
4. As a second line of defence, a constraint trigger on `transactions` that refuses a posted entry
   whose lines do not sum to zero, whoever writes it.
5. Add the cases in `probes/direct-ledger-writes.sql` to `supabase/tests/rls.test.sql` as
   "expected to be refused", so the gap cannot reopen.

### C-2. The QuickBooks import falls back to direct writes when the server refuses

`QBOMigrationWizard.tsx:520-534`: if the bulk request to the server does not succeed, the wizard
logs "Bulk API write deferred to client fallback" and inserts each entry straight from the browser.
An entry the server rejected (unbalanced, closed period for that role, over the plan limit) can
therefore still be written, and the person is told the import worked. This is the "false success"
pattern your release gate lists as never acceptable, and it sits on the import workflow (W11) that
is not yet verified. *Fix:* remove the fallback; show what the server refused.

### C-3. Audit trail coverage (carried from Agent #6, F-09)

Not re-run here. Agent #6 found 23 of 33 money-writing server handlers write no audit entry. C-1
adds to it: a direct write leaves no audit entry at all.

## Major

**M-1. Reports are worked out in the browser** (tracker L-123, open). Lists are capped at 10,000 and
the profit and loss screenshot shows "the server report could not be loaded".

**M-2. One speed test fails off CI.** `src/tests/report-speed-12m.test.tsx` (A-229): loading ten
screen modules took 2,332 ms against a 1,500 ms budget, alone and in the full run. It passes on CI.
A fixed millisecond budget measures the machine as much as the code. *Fix:* compare against a
calibration run on the same machine, or move it out of the blocking set.

**M-3. Lint is exactly at its cap.** 42 warnings against `--max-warnings 42`. With several AIs
committing, the next warning anywhere turns CI red for everyone. *Fix:* clear a few, then lower the cap.

**M-4. Membership checks are copied by hand.** Seventeen inline copies of
`ws.uid !== user.uid && !ws.members?.includes(user.uid)` in eight server files, beside 123 uses of
the shared helpers. The inline form checks membership, not role. *Fix:* one helper, and a guard test
that fails on the inline pattern.

**M-5. The database holds documents, not accounts.** Every table is `id` plus one JSON column.
There are no foreign keys, no typed money columns and no database-level rule that an entry balances
or that a line's account exists. All of that lives in application code, which is why C-1 is possible.
Changing the model is a large job; item 4 under C-1 is the cheap part worth doing now.

**M-6. More status documents than anyone can read.** `docs/` and `audit/` hold 604 files and about
117,000 lines, against about 225,000 lines of application code. There are eight files named
"FINAL_ACCURATE_LIST", `docs/STATUS.md` is marked out of date, and one list reached `main` with
merge-conflict markers in it. A person or an AI starting work cannot tell which file is true.
*Fix:* one current status file (`RELEASE_GATE.md` is the best candidate); move the rest to `archive/`.

**M-7. Code that is written and connected to nothing.** Seven algorithms in `src/lib/algorithms/`
(subset-sum matching, rule induction, label auto-fill, recurrence, duplicates, find-my-error,
business fingerprinting), `src/lib/amountExpression.ts`, the late-fee function in
`src/lib/paymentTerms.ts`, and the "Pro mode" switch. Each is tested, so it costs maintenance
without giving the user anything. Details in `docs/EASE_OF_USE.md` parts 2 and 3.

**M-8. A 50 MB request body is accepted on every route** (`server.ts:84`; the comment says narrower
limits are tracked). *Fix:* 1 MB by default, the large limit only on import and restore.

**M-9. Twenty-five silently swallowed errors** (`.catch(() => {})`) in non-test source. Each one is
a place where a failure shows the user nothing.

**Carried, not re-run:** Agent #6's F-01 and F-08 (US sales tax return), F-02 (two unguarded system
routes), F-03 (47 of 68 tables without a field list; C-1 is the worst case of it), F-10 (three
handwritten idempotency records).

## What is sound

- **Isolation between businesses holds.** Every cross-workspace and viewer write in the probes was refused.
- **The server's own posting path is careful:** exact decimal arithmetic on whole cents, a balance
  check, restricted partial updates, version checks against concurrent edits, idempotency keys.
- **Type discipline:** no `@ts-ignore`, no `eslint-disable`, 37 uses of `any` in the whole application.
- **Tests:** about 112,000 lines of test code; the database-backed suites pass against a real PostgreSQL.
- **No secrets in the repository.** The key in `supabase-config.json` is the public one by design.
- **Security headers** (content security policy, HSTS, frame and content-type options) are set, and API keys are stored hashed.
- The made-up endpoints noted earlier as L-91 are gone.

## Not covered

This is one session. It did **not** cover: the browser test suite; the deployed site and its
settings; Plaid, Stripe and email in real use; whether the tax engines give correct figures;
payroll; stock valuation; most of the roughly 250 server route handlers one by one; backup and
restore under load. The interface findings in `docs/EASE_OF_USE.md` came from code and stored
screenshots, not from using the app.

## Reproduce C-1

```bash
LF_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/lf_test npx tsx scripts/db-test.ts setup
```

```bash
psql "$LF_TEST_DATABASE_URL" -At -f audit/claude-2026-11-11/probes/direct-ledger-writes.sql
```

```bash
psql "$LF_TEST_DATABASE_URL" -At -f audit/claude-2026-11-11/probes/direct-ledger-writes-row-check.sql
```

Both probes run inside a transaction that is rolled back. Note for the first probe: an `update` or
`delete` that row-level security hides affects no rows and reports no error, so rows 12 and 13 print
"ALLOWED" although nothing changed; the second probe checks the stored values and shows the account
balance and the audit row were not touched.
