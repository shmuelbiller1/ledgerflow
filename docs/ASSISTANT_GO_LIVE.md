# Turning the assistant on: what to check, in what order

For the owner. Nothing here changes anything by itself.

## 1. Which database changes are already in the live database?

Open Supabase, then the SQL editor, paste this, and run it. It only reads. `true` means that change is already
in the live database; `false` means it is still waiting.

```sql
-- Read-only. Paste into Supabase -> SQL editor. Changes nothing.
-- applied = true means that migration's change is present in this database.
select migration, applied from (
  values
    (1, '20261117210000 assistant_sandbox_overlay',
        to_regclass('sandbox.sandboxes') is not null
        and exists (select 1 from pg_roles where rolname = 'lf_sandbox')),
    (2, '20261118130000 sandbox_live_read_boundary',
        to_regprocedure('sandbox.has_live_book_read(text)') is not null),
    (3, '20261119090000 sandbox_step_undone',
        coalesce((select pg_get_constraintdef(c.oid) like '%undone%'
                    from pg_constraint c
                   where c.conrelid = to_regclass('sandbox."sandboxSteps"')
                     and c.conname = 'sandboxSteps_state_check'), false)),
    (4, '20261120090000 sandbox_stock_move_order',
        exists (select 1 from pg_trigger
                 where tgname = 'lf_stock_move_provisional_seq'
                   and tgrelid = to_regclass('sandbox."stockMoves"'))),
    (5, '20261120100000 cmd1_browser_write_policies  (apply last, after the live site is checked)',
        to_regclass('public."chartAccounts"') is not null
        and not exists (select 1 from pg_policies
                         where schemaname = 'public' and tablename = 'chartAccounts'
                           and policyname = 'admin_insert')),
    (6, '20261122180000 sbx2_remembered_decisions',
        to_regclass('assistant."rememberedDecisions"') is not null)
) as t(n, migration, applied)
order by n;
```

Apply what is `false`, **in the order shown**, one at a time, and only after its code is merged and deployed
(CLAUDE.md rule). Row 5 closes the browser's write door: apply it last, after you have opened the live site and
checked that saving an invoice, a customer and a journal still works. If anything breaks after row 5, tell the
release lead; do not re-open the door by hand.

Other migrations in `supabase/migrations/` dated after `20261122180000` are not covered by this check; compare the
file names against Supabase, Database, Migrations.

## 2. Before anyone uses the sandbox

- The app's database login must be able to switch to the restricted sandbox role. Check this as described in
  `docs/FOR_YOU.md`, section "17 Nov, SBX-1 overlay migration". The schemas `sandbox` and `sandbox_read` must not
  be in Supabase's exposed schemas.
- A `SESSION_SECRET` setting must exist in Vercel (same section).
- Hardening issue #825 is closed (PR #855), so no extra database step is waiting for it.

## 3. Which AI models the site uses

The live site still uses the Gemini defaults. Switching to GPT-6 Luna (simple turns) and GPT-6.1 Terra (strong
turns) is a settings change with its own checklist: `docs/prompts/SBX-2-switch-to-luna.md`. It needs your Arena key
(add it yourself in Vercel, never in chat) and the routed test run first (step 3 of that file). Removing the model
variables puts the site back on Gemini at once.

Last graded result (25 Nov, 21 questions): Luna 17 correct at 3.7 cents, Terra 20 correct at 29.4 cents.
"Record a payment of 500 for INV-1001" is graded wrong when the assistant does not ask which account received the
money in the way the test expects; try it by hand on a test workspace before relying on it.
