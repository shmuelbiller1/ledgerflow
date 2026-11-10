# FOR_YOU — done and superseded items (moved 10 Nov 2026 by AI #13; nothing deleted)

Answered, done-marked and superseded items moved out of docs/FOR_YOU.md word for word, in file order.
Open questions and unanswered asks stay in the live file with their original item numbers.


<!-- done item -->
0. **Done (owner, 13 Oct).** **Most important: let database changes go through without you (1 minute).** Open
   https://claude.ai/customize/connectors → **Supabase** → tool permissions → set
   `apply_migration`, `execute_sql` and `list_migrations` to **Always allow**.
   *Why:* these tools ask you to approve every single time, and while an approval is waiting
   the whole session stops. That is what paused work from 26 to 28 September. Until you do
   this, Claude calls them as rarely as possible, and the 5-hour check-in cancels any
   approval that is still waiting so work carries on.
   *Both waiting changes (`tax_returns`, `updated_at_indexes`) were applied on 2 Oct while you were here.*

<!-- done item -->
1. **Done (owner, 13 Oct).** **Sign-in addresses (Supabase).** supabase.com → project *ledgerflow* → Authentication → URL
   Configuration. Site URL: `https://ledgerflow-one-pearl.vercel.app`. Redirect URLs: add
   `https://ledgerflow-one-pearl.vercel.app/**` and `http://localhost:3000/**`.
   Without it, sign-up confirmation and password-reset emails link to the wrong place.

<!-- done item -->
9. **Done (owner, 13 Oct).** **Old settings to delete** in Vercel (unused since the move to Supabase): `FIREBASE_PROJECT_ID`,
   `SQL_*`, `JWT_SECRET`.

<!-- done item -->
19. ~~**One database change to apply**~~ **Done: applied 5 Oct.** (from Y-27, 5 Oct): `supabase/migrations/
    20261007000000_contact_delivery_method.sql`. It lets a customer record keep the new
    `deliveryMethod` field (how they want documents: Email / Print / Post / Nothing automatic).
    Until it is applied, saving that choice on a *customer* is refused by the database guard and
    everything else works as before; vendors need nothing. Claude cannot reach Supabase from the
    Arena sandbox, so it is checked in but not applied. Paste the file in Supabase → SQL editor,
    or say so and the next Claude session runs it through the connector.

<!-- done item -->
20. ~~**A second database change to apply**~~ **Done: applied 5 Oct.** (from BE-04, 5 Oct): `supabase/migrations/
    20261007010000_invoice_approval.sql`. It lets a workspace keep the new `invoiceApproval` rule —
    the amount an invoice must exceed before an owner or an accountant has to approve it before it is
    emailed. Until it is applied, saving that rule in Settings → Emails & Reminders is refused by the
    database guard and every invoice goes out as it always did; nothing else is affected, and no
    invoice field needs a migration (the approval itself is stored with the invoice). Same as item 19:
    paste it in Supabase → SQL editor, or say so and the next session runs it through the connector.

<!-- done item -->
26. **Done (owner, 13 Oct).** **Password rules in Supabase too (2 minutes, 7 Oct).** The app now asks for at least 10
    characters (not a common password, not your email name) when someone signs up or picks a new
    password after a reset link. Make Supabase say the same, so nobody can get around it: Supabase →
    Authentication → Providers → Email → *Minimum password length* **10**, and, if your plan has it,
    turn on *Prevent use of leaked passwords*. *Default meanwhile: the app's own check.*

<!-- done item -->
22. ~~**One database change to paste (5 Oct, L-191).**~~ **Done: checked 13 Oct, all applied on the live database.** `supabase/migrations/20261008000000_invoice_approval_guard.sql`
    timed out twice through the connector (creating a trigger on the invoices table waits for it to be
    free). Paste the whole file into Supabase → SQL editor → Run; running it twice is safe. Until then,
    the server already refuses approvals from bookkeepers on every normal save; only a direct database
    write around the app is not yet blocked. The two other changes from today (delivery method,
    approval rule) are applied.

<!-- done item -->
24. ~~**One database change for Loans**~~ **Done: applied 6 Oct.** (A-2 from the arena AI) `supabase/migrations/20261009000000_loans.sql`
    adds the table loans are kept in (members read; owners, accountants and bookkeepers write).
    Claude applies it through the Supabase connector right after the code is pushed; this line is
    crossed out once it is applied. If the connector asks you to approve, approving it is all that is
    needed. Until it is applied, saving a loan says nothing was saved, and deleting a whole workspace
    would stop at the missing table.

<!-- done item -->
25. ~~**Four database changes to paste (7 Oct) — please look soon.**~~ **Done: checked 13 Oct, all applied on the live database.** The code is on main; the
    Supabase connector timed out on all of them (the first one rebuilds the list indexes, and a
    rebuild waits until each table is free, the same as item 22). First, in Supabase → SQL editor,
    check nothing is stuck (a waiting index build can hold up saving on that table):
    `select pid, now() - query_start as running, left(query, 60) from pg_stat_activity where state <> 'idle' and query ilike '%create index%';`
    If a row has been running for minutes, stop it with `select pg_cancel_backend(<pid>);`.
    Then paste each file, in this order, and Run (each is safe to run twice):
    1. `supabase/migrations/20261013010000_list_order_indexes.sql` (faster long lists, L-87)
    2. `supabase/migrations/20261013020000_pay_runs_server_only.sql` (pay runs written only by the server, U-10)
    3. `supabase/migrations/20261013030000_private_helpers.sql` (three helper functions out of the public API, L-86)
    4. `supabase/migrations/20261013040000_require_two_step.sql` (owners can require two-step login, Y-30)
    *Until then:* everything works as before; payroll approval is enforced by the server but a
    direct database write around the app is not yet blocked, and "require two-step login" is
    enforced by the server but not yet by the database rules. Claude tries the connector again at
    the next session; this item is crossed out once they are in.

<!-- done item -->
28. ~~**One database change to paste (7 Oct, A-6 from the arena AI).**~~ **Done: applied by Claude on 7 Oct.**
    `supabase/migrations/20261013050000_chart_account_workpapers.sql` — it allows the `workpapers`
    field on chart accounts: the note and the review mark a month's close keeps per account and
    month (BD-04, the Workpapers panel on Month-End Close). Safe to run twice. *Until it is
    applied:* saving a note or a review mark is refused by the database guard and the panel says
    so; everything else on the page works.

<!-- done item -->
30. ~~**Two more database changes to paste (7 Oct) — after the four in item 25.**~~ **Done: checked 13 Oct, all applied on the live database.**
    `supabase/migrations/20261013060000_stock_moves.sql` adds the stock history: every change to an
    item's stock with its reason (sold, returned, bought, counted, moved between locations). The
    Supabase connector timed out on it. Paste it in Supabase → SQL editor and Run (safe to run
    twice). *Until then:* selling, returns, counts and imports work exactly as before; the server
    just keeps no history yet (Inventory → History shows none), and moving stock between
    locations says it needs this update. Nothing breaks either way.
    Then `supabase/migrations/20261013070000_workspace_groups.sql` (groups of books, DA-01: Settings →
    Groups of books). *Until then:* that page shows no groups and saving one says groups are not available
    yet; nothing else is affected.

<!-- done item -->
41. **Done (owner, 13 Oct).** **Repository made public (11 Oct): roll one old Stripe test key — needs you, 2 minutes.** An early
   commit (5 Jul, removed on 22 Jul) had a Stripe *test-mode* secret key starting `sk_test_51Th0cy…`.
   It cannot move real money, but anyone can now read it. In Stripe → Developers → API keys (test mode)
   → "Roll key", then put the new one in Vercel's `STRIPE_SECRET_KEY` if you use test mode there. No
   other secrets were found in the history (no database passwords, service keys or live keys). CI now
   runs on GitHub on every push to main, every helper-AI branch and every pull request.

<!-- stale: absence window 14–17 Oct has passed -->
## 49. While Claude is away (14–17 Oct)
To keep the other AIs going, give each one this message: **"Read AGENTS.md and docs/COORDINATION.md, then keep working on your queue."** Give Codex this one: **"You are acting lead: follow docs/LEAD_RUNBOOK.md."** You don't need to merge anything yourself. When Claude is back, say "continue" and it picks up from docs/TRACKER.md.

<!-- fulfilled: PR #154 merged -->
## AI #2 — CI speed batch ready for GitHub review (17 Oct)

The branch `codex/ci-faster-browser-feedback` is pushed (implementation `74a8ae51`). It splits all 299 browser tests into two isolated shards, keeps every existing accounting/security/time-zone gate and the original required browser check, and provides combined reports and readable failure locations. Local types/lint, four diagnostic contracts, two actual browser smoke shards and report merging pass; five already-landed screen tasks were reconciled after 17 component cases and ten guest screenshot checks. Evidence: `docs/verification/ci-speed-and-queue-review-2026-10-17.md`.

**Outside action:** [open the pull request](https://github.com/shmuelbiller1/ledgerflow/pull/new/codex/ci-faster-browser-feedback). The GitHub API returns `Forbidden` to this environment for PR creation. Native Git push succeeded and its exact remote SHA was verified, but no Actions run is visible for the branch yet. Full GitHub verification and merge remain outstanding; do not treat the local smoke subset as a full-suite pass.

<!-- superseded by the 21 Oct entry (owner ran it) -->
## 20 Oct — migration to apply after ISS-130 is merged (AI #9)

- **`supabase/migrations/20261020120000_inventory_cost_server_only.sql`**: refuses a browser change to an item's unit cost while it has stock on hand (the cost of stock changes only through Inventory → Revalue, which posts the difference). Tested with `npm run test:rules` on the local test database. AI #1 applies it to Supabase after reviewing the ISS-130 PR; until it is applied, the screen already locks the cost, but a direct browser write is not yet refused by the database.

<!-- done section -->
## 20 Oct night — ~~migration to confirm on Supabase (ISS-130, PR #259)~~ **Done: replaced by the 21 Oct change, which the owner ran.**

`supabase/migrations/20261020120000_inventory_cost_server_only.sql` (browser may not change the cost of stock on hand; only the server's revaluation can) — **the Supabase connector timed out twice, so it may or may not be applied.** It is safe to run again (it replaces the function and re-creates the trigger). To apply: Supabase dashboard → SQL editor → paste the file → Run. Until it is applied the app still works; the new Revalue screen posts correctly either way, the database just doesn't yet *refuse* a direct browser cost change.

<!-- done section -->
## 21 Oct — ~~one database change to paste~~ **Done: run by the owner on 21 Oct ("Success. No rows returned").** (replaces the 20 Oct ISS-130 one)
The Supabase connector timed out a third time. Paste **`supabase/migrations/20261021010000_inventory_cost_editable_at_zero.sql`** into Supabase → SQL editor → Run (1 minute). It is safe to run more than once, and it replaces the 20 Oct ISS-130 change, so you do not need to run that one separately. What it does: an item's cost can't be changed from the browser while it has stock on hand (only Inventory → Revalue changes it); items at or below zero stay editable. *Default until then:* the screen already locks the cost; only a direct browser write is not yet refused by the database.

<!-- done section -->
## 22 Oct — ~~one database change to paste~~ **Done: run by the owner on 22 Oct.** (ISS-143, return authorizations)
The Supabase connector timed out. Paste **`supabase/migrations/20261022000000_rma_server_only.sql`** into Supabase → SQL editor → Run (1 minute; safe to run more than once). It stops a browser from writing return-authorization (RMA) approvals directly; they now go only through the server, which checks the role and the quantities. *Default until then:* the screen already uses the server; only a direct browser write is not yet refused.

<!-- done section -->
## 23 Oct — ~~one database change to paste (L-123 step 1, AI #9)~~ **Done: applied by Claude on 24 Oct through the Supabase connector — nothing to paste.**
Paste **`supabase/migrations/20261023000000_period_balances.sql`** into Supabase → SQL editor → Run.
- It adds the table that keeps each closed year's balances (`periodBalances`), which the browser can read but never write.
- It adds a trigger that marks a saved year stale when an entry in that year changes.

*Until then:* closing a year works as before, but no year balances are saved, and the server logs once which file to apply.

<!-- done section -->
## 23 Oct — ~~one more database change to paste, after #359 merges (EG-1 step 1, AI #9)~~ **Done: applied by Claude on 24 Oct through the Supabase connector — nothing to paste.**
Paste **`supabase/migrations/20261023010000_repost_queue.sql`** into Supabase → SQL editor → Run.
- It adds the list of items whose stock cost needs a repair after a backdated entry (`repostQueue`, readable by members, written only by the server).
- It adds a trigger that puts an item on that list when one of its stock moves is dated before later ones.

*Until then:* the repair screen has nothing to repair; the books are unchanged.

<!-- done section -->
## 23 Oct — ~~one more database change to paste, after EG-3 merges (AI #9)~~ **Done: applied by Claude on 24 Oct through the Supabase connector — nothing to paste.**
Paste **`supabase/migrations/20261024000000_period_closings.sql`** into Supabase → SQL editor → Run.
- It adds the year-end closing record (`periodClosings`): one fixed record per closed year with the profit, the transfer to retained earnings and the balance-sheet totals. It is readable by members and written only by the server.

*Until then:* closing a year works as before, without the closing record.

<!-- done section -->
## 23 Oct — ~~one more database change to paste, after #363 merges (EG-7, AI #9)~~ **Done: applied by Claude on 24 Oct through the Supabase connector — nothing to paste.**
Paste **`supabase/migrations/20261025000000_stock_closings.sql`** into Supabase → SQL editor → Run.
- It adds the stock closing record (`stockClosings`): each item's quantity and value at a locked period end. It is readable by members and written only by the server.

*Until then:* the stock checks still run, but no stock closing can be saved.

<!-- done section -->
## 23 Oct — ~~one more database change to paste, after #364 merges (EG-2 step 1, AI #9)~~ **Done: applied by Claude on 24 Oct through the Supabase connector — nothing to paste.**
Paste **`supabase/migrations/20261025010000_payment_allocations.sql`** into Supabase → SQL editor → Run.
- It adds the payment ledger (`paymentAllocations`), which records which invoice or bill each payment paid, at what rate and on what date.
- It also adds `allocationOperations`, which keeps retried payments from being recorded twice.
- Both are readable by members and written only by the server.

*Until then:* payments work as before, no ledger rows are written, and the server logs which file to apply.

*New rule in #364 (default I used):* a payment dated before the invoice or bill it pays is refused. Say if you want it allowed.

<!-- done section -->
## 24 Oct — ~~report preferences (D-47, #370)~~ **Done: applied by Claude on 24 Oct through the Supabase connector — nothing to paste.**
`supabase/migrations/20261023200000_report_preferences.sql`: lets each person's recent and pinned reports sync between their devices.

<!-- fulfilled: merged as PR #524 -->
## AI #7 (stability) — 19 Oct: branch ready, one outside action

**Done and pushed** on `arena/3125e92e-ledgerflow`: F-41…F-45 browser journeys for RELEASE_GATE
W2/W3/W4/W6/W9 (with hand-worked figures), F-38 perf budgets, F-39 scorecard, F-40 layer guard,
and the stability batch F-14, F-16, F-30, F-32…F-37. The new fuzz run found a real defect: an
MT940 statement line `:61:991332…` was imported as the impossible date **2099-13-32**; it is now
refused in plain words, with a regression test. Evidence:
[`docs/verification/ai7-journeys-w2-w9.md`](verification/ai7-journeys-w2-w9.md) and
[`docs/verification/ai7-stability-batch-2026-10-19.md`](verification/ai7-stability-batch-2026-10-19.md).

**What needs you (or the lead):**
1. **Open the pull request to the author's repository.** This environment can create PRs only on
   the fork: [Chaim-Richard/ledgerflow#1](https://github.com/Chaim-Richard/ledgerflow/pull/1).
   Pushing to `shmuelbiller1/ledgerflow` and creating a cross-repo PR both answer **403** for this
   token. The branch is pushed; a maintainer can open the PR from the fork with
   `head=Chaim-Richard:arena/3125e92e-ledgerflow, base=main`.
2. **One server-side handoff for AI #1:** `src/server/utils/logger.ts` writes whatever fields its
   callers pass. The browser crash reporter is now redacted (`src/lib/logRedaction.ts`); the server
   logger is your file and was not edited.
3. **Optional:** set the `HEALTH_URL` repository variable so the new nightly uptime check runs
   (it skips cleanly and says so when unset).
