# For you: things only you can do or decide

Claude keeps working while these wait. It never stops to wait for an answer: where a decision
is needed, it takes the default written below and moves on. When you have time, answer as many
as you like in one message, e.g. **"1 done, 4 yes, 11 hide, 10 keep Hebrew"**. Answered items are
removed from this list.

Last updated: 2026-10-07.

## A. Settings only you can change (a few minutes each)

0. **Done (owner, 13 Oct).** **Most important: let database changes go through without you (1 minute).** Open
   https://claude.ai/customize/connectors → **Supabase** → tool permissions → set
   `apply_migration`, `execute_sql` and `list_migrations` to **Always allow**.
   *Why:* these tools ask you to approve every single time, and while an approval is waiting
   the whole session stops. That is what paused work from 26 to 28 September. Until you do
   this, Claude calls them as rarely as possible, and the 5-hour check-in cancels any
   approval that is still waiting so work carries on.
   *Both waiting changes (`tax_returns`, `updated_at_indexes`) were applied on 2 Oct while you were here.*
1. **Done (owner, 13 Oct).** **Sign-in addresses (Supabase).** supabase.com → project *ledgerflow* → Authentication → URL
   Configuration. Site URL: `https://ledgerflow-one-pearl.vercel.app`. Redirect URLs: add
   `https://ledgerflow-one-pearl.vercel.app/**` and `http://localhost:3000/**`.
   Without it, sign-up confirmation and password-reset emails link to the wrong place.
2. **Replace the four secrets Claude generated** (Vercel → project ledgerflow → Settings →
   Environment Variables): `SESSION_SECRET`, `INVITE_SECRET`, `CRON_SECRET`, `SYSTEM_SALT`.
   Put in long random values of your own. **Do `SYSTEM_SALT` before any bank is connected
   with Plaid**: it encrypts the stored bank tokens, and changing it later disconnects banks.
3. **Try sign-up on the live site** and tell Claude what happened (email arrived? could you log
   in and create a workspace?).
4. **Deployment protection (Vercel).** Right now only people logged in to your Vercel account
   can open the site. Before customers: Vercel → Settings → Deployment Protection → turn off for
   Production (or add your own domain). *Default meanwhile: leave it on.*
5. **Email sender (Supabase).** The built-in sender only sends a few emails per hour. Before real
   users: Authentication → Emails → SMTP Settings (e.g. Resend, Postmark, SendGrid).
6. **Database certificate.** Supabase → Database → SSL: download the certificate and paste it in
   Vercel as `DATABASE_CA_CERT`, so the server checks it is really talking to your database.
7. **Email sending (needed for invoices and reminders by email).** Pick a provider (Resend is the
   simplest), then in Vercel → Environment Variables add `RESEND_API_KEY` and `EMAIL_FROM`
   (e.g. `invoices@yourdomain.com`, a domain you verified with the provider). For bounce reports,
   also add `EMAIL_WEBHOOK_SECRET` (any long random text) and in the provider's webhook settings
   use `https://ledgerflow-one-pearl.vercel.app/api/v1/email-events` with an
   `X-Email-Webhook-Secret` header holding the configured secret, **if the provider supports
   custom headers**. Existing provider configurations using `?token=<secret>` continue to work,
   but URLs may be stored by external proxies: migrate them where possible and rotate the secret.
   *Until then, "Email invoice" says email is not set up yet.*
8. **Stripe (customers pay invoices online by card) — 2 steps left.** Claude connected your Stripe
   *sandbox* ("terranex sandbox", test mode: no real money): the webhook that tells LedgerFlow an
   invoice was paid exists and its secret is saved in Vercel (`STRIPE_WEBHOOK_SECRET`).
   Stripe never shows secret keys to Claude, so you copy two keys: Stripe dashboard (sandbox) →
   Developers → API keys. In Vercel → Environment Variables set `STRIPE_SECRET_KEY` = the
   **Secret key** (`sk_test_…`) and `VITE_STRIPE_PUBLIC_KEY` = the **Publishable key** (`pk_test_…`).
   Payments reach LedgerFlow only once item 4 (deployment protection) is off. Later, for real
   money, the same with the live keys. Other optional keys (currency rates, tax): tell Claude
   which ones you want. Plaid (bank feeds): Claude has no Plaid connection; the `PLAID_*` values
   in Vercel must come from your Plaid dashboard (use the sandbox first).
9. **Done (owner, 13 Oct).** **Old settings to delete** in Vercel (unused since the move to Supabase): `FIREBASE_PROJECT_ID`,
   `SQL_*`, `JWT_SECRET`.

17. **Privacy papers (before real customers, 15 minutes + a lawyer).** Put your company name,
   address and privacy email into `docs/privacy/ROPA.md` and `docs/privacy/DPA_TEMPLATE.md`
   (Claude wrote everything else from the code), then have someone who knows the law where you
   operate read them.

19. ~~**One database change to apply**~~ **Done: applied 5 Oct.** (from Y-27, 5 Oct): `supabase/migrations/
    20261007000000_contact_delivery_method.sql`. It lets a customer record keep the new
    `deliveryMethod` field (how they want documents: Email / Print / Post / Nothing automatic).
    Until it is applied, saving that choice on a *customer* is refused by the database guard and
    everything else works as before; vendors need nothing. Claude cannot reach Supabase from the
    Arena sandbox, so it is checked in but not applied. Paste the file in Supabase → SQL editor,
    or say so and the next Claude session runs it through the connector.

20. ~~**A second database change to apply**~~ **Done: applied 5 Oct.** (from BE-04, 5 Oct): `supabase/migrations/
    20261007010000_invoice_approval.sql`. It lets a workspace keep the new `invoiceApproval` rule —
    the amount an invoice must exceed before an owner or an accountant has to approve it before it is
    emailed. Until it is applied, saving that rule in Settings → Emails & Reminders is refused by the
    database guard and every invoice goes out as it always did; nothing else is affected, and no
    invoice field needs a migration (the approval itself is stored with the invoice). Same as item 19:
    paste it in Supabase → SQL editor, or say so and the next session runs it through the connector.

26. **Done (owner, 13 Oct).** **Password rules in Supabase too (2 minutes, 7 Oct).** The app now asks for at least 10
    characters (not a common password, not your email name) when someone signs up or picks a new
    password after a reset link. Make Supabase say the same, so nobody can get around it: Supabase →
    Authentication → Providers → Email → *Minimum password length* **10**, and, if your plan has it,
    turn on *Prevent use of leaked passwords*. *Default meanwhile: the app's own check.*

## B. Decisions (Claude uses the default until you say otherwise)

10. **Hebrew data — decided by owner (2 Oct).** Keep menus and options in English. The system and algorithms must handle Hebrew and mixed Hebrew/English names, labels, item descriptions and other record text throughout search/matching, imports/exports and documents. This is data-language support, not a request to translate the interface. Codex is auditing it after C-6…C-11; existing financial rules must stay intact.
11. **Demo and fake features.** Some screens and endpoints return made-up data (the "API Hub" demo
    endpoints for e-commerce/marketing/HR, the Admin "command center" with simulated logs).
    Delete them, or keep them behind a "developer" switch? *Default: hide them behind a
    developer switch when Claude gets to the clean-up step.* **Done (2 Oct):** the fake API endpoints are deleted (they answered "success" to API-key users without doing anything); the Admin Panel with simulated logs shows only with Settings → Developer → Developer switch on.
12. **Which country's tax rules first?** (VAT/GST return boxes, reverse charge, US sales tax…)
    *Default: generic rules that work anywhere (tax groups, compound tax, zero-rated vs exempt,
    reverse charge, configurable return boxes).*
13. **Deposits on invoices.** Is a deposit a payment in advance (tax on the full invoice; the
    deposit only lowers the amount still due) or a discount? *Default: payment in advance
    (normal practice).* **Built that way (2 Oct).** Record the deposit money to a "Customer
    Deposits" liability account when it arrives; the invoice then moves it against what the
    customer owes. An invoice with a deposit needs that account (it says so if missing).
14. **Dependency updates** (the open Dependabot pull requests on GitHub). *Default: Claude
    applies the safe updates directly on `main` during the trust & compliance step and closes
    the PRs they replace; the big ones (Plaid 47) wait until a feature needs them.*

15. **Restoring a backup after closing months.** A backup can't replace closed periods: once any month is closed, restore is refused (reopen first). *Default: refuse.* Say if you prefer "restore only the months after the lock date".

16. **Audit trail after a workspace is deleted.** The workspace's data is deleted after 30 days, but its audit trail is kept (it is the legal record of who did what). *Default: keep it.* If you want it deleted after a number of years, say how many.

17. **The "LATER" pile (about 480 of the open items).** They came from comparing LedgerFlow with
   12 big products (payroll extras, industry add-ons, extra reports, integrations…). Doing all of
   them one by one takes weeks. *Default: Claude finishes the QUALITY items, then builds the LATER
   items most small businesses use daily (data checks, everyday reports, invoice extras) and leaves
   the niche ones until a customer asks.* Say "do them all" or name the ones you want first.
18. **Go faster: run Codex alongside Claude (updated 5 Oct).** Codex's last branch (C-9 file splits,
   C-10 tests, Hebrew data) is merged into main. Three new tasks are waiting for it in
   docs/COORDINATION.md (C-12 file splits, C-13 report columns, C-14 everyday screen comforts), chosen
   so they don't touch the files Claude is working in. Start it in the Codex app with the usual prompt
   ("Read AGENTS.md and docs/COORDINATION.md. Do the next task…"). Both now run the slow browser tests
   only every ~5 changes (your suggestion). GitHub CI no longer runs on every push (see below).

21. **The arena AI's work (5 Oct evening): merged.** Y-27 (how each contact wants documents) and
    BE-04 (big invoices wait for approval) are on main, with the two fixes Claude made after
    reviewing it (L-191). BE-05 is left blocked with its reason; R-07 is its next item.

~~**⚠ Start here — 7 database changes waiting (8 Oct).**~~ **Done: all applied 11 Oct** (Claude, through the Supabase connector, after your run: the helper move had already gone in; the other six were applied then). The live database is behind the code: the
Supabase connector now times out even on a change that only adds a new table, so something in the
database is most likely stuck (an index build waiting since item 25). Until these are in, stock
history, groups of books, "require two-step login" in the database rules and the pay-run guard are
not really live (everything else works). In Supabase → SQL editor, one at a time, Run:
1. The stuck-query check (stop any row running for minutes with `select pg_cancel_backend(<pid>);`):
   `select pid, now() - query_start as running, left(query, 60) from pg_stat_activity where state <> 'idle' and query ilike '%create index%';`
2. `supabase/migrations/20261008000000_invoice_approval_guard.sql` (item 22)
3. `supabase/migrations/20261013010000_list_order_indexes.sql` (item 25)
4. `supabase/migrations/20261013020000_pay_runs_server_only.sql` (item 25)
5. `supabase/migrations/20261013030000_private_helpers.sql` (item 25)
6. `supabase/migrations/20261013040000_require_two_step.sql` (item 25)
7. `supabase/migrations/20261013060000_stock_moves.sql` (item 30)
8. `supabase/migrations/20261013070000_workspace_groups.sql` (item 30)
Each is safe to run twice. Tell Claude when done, or Claude sees it at the next session and crosses these out.

22. ~~**One database change to paste (5 Oct, L-191).**~~ **Done: checked 13 Oct, all applied on the live database.** `supabase/migrations/20261008000000_invoice_approval_guard.sql`
    timed out twice through the connector (creating a trigger on the invoices table waits for it to be
    free). Paste the whole file into Supabase → SQL editor → Run; running it twice is safe. Until then,
    the server already refuses approvals from bookkeepers on every normal save; only a direct database
    write around the app is not yet blocked. The two other changes from today (delivery method,
    approval rule) are applied.

23. **Closing a year (decided by default, 6 Oct).** Closing a year used to post an entry moving all
    revenue and expenses to Retained Earnings; that made the closed year's Profit & Loss show zero
    profit. LedgerFlow's balance sheet already shows past profit in retained earnings automatically
    (as Xero and QuickBooks do), so closing a year now locks it and records its profit, without that
    entry; any old closing entries are ignored. *Default: this way.* If your accountant wants a
    classic closing entry posted anyway, say so.

24. ~~**One database change for Loans**~~ **Done: applied 6 Oct.** (A-2 from the arena AI) `supabase/migrations/20261009000000_loans.sql`
    adds the table loans are kept in (members read; owners, accountants and bookkeepers write).
    Claude applies it through the Supabase connector right after the code is pushed; this line is
    crossed out once it is applied. If the connector asks you to approve, approving it is all that is
    needed. Until it is applied, saving a loan says nothing was saved, and deleting a whole workspace
    would stop at the missing table.

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

27. **Your roadmap is in (7 Oct): `docs/ROADMAP.md`.** It holds the other AI's plan, rewritten in
    plain words and checked against the tracker. Nothing was duplicated: 16 existing items were
    expanded, and 10 new ones were added (tracker section DA). All 292 open items now sit in one of
    four buckets. Your question, "can the legal stuff be a label too?", is answered on that page:
    yes, while the companies share people, a currency, a fiscal year and one close; separate books
    once one of them files its own taxes, has someone who may see it but not the others, or closes
    on its own. Decisions with the default Claude uses until you say otherwise:
    - **What counts as "first release" (V1)?**
      - *Default:* the main path (books → bank → money in/out → reconcile → reports → close →
        backup → "where does this number come from"), and anything that can make money, stock or
        reports wrong. That is 12 items, listed at the bottom of ROADMAP.md (two of them are your GitHub and database settings, L-67 and L-83).
      - Everything else is "Later". You alone move an item into V1.
    - **A company as a label vs its own books:**
      - *Default:* both. Start with a label. Move it into its own books when it needs to be separate
        (DA-10, research: you would pick the date the move happens).
    - **Orders of stock items:** a found gap. Invoicing a sales order never lowered stock and never
      booked the cost of the goods.
      - *Default fix (BF-08 step 1, Claude, now):* an order's item lines are invoiced by quantity.
        A percent or amount part of such an order is a deposit or progress bill that moves no stock.
    - **Simple until needed:**
      - *Default:* one app that grows. Projects, stock, payroll, assets, more currencies and groups
        stay hidden until a workspace uses them or you turn them on (BB-07).
      - No separate "simple" and "advanced" versions.

28. ~~**One database change to paste (7 Oct, A-6 from the arena AI).**~~ **Done: applied by Claude on 7 Oct.**
    `supabase/migrations/20261013050000_chart_account_workpapers.sql` — it allows the `workpapers`
    field on chart accounts: the note and the review mark a month's close keeps per account and
    month (BD-04, the Workpapers panel on Month-End Close). Safe to run twice. *Until it is
    applied:* saving a note or a review mark is refused by the database guard and the panel says
    so; everything else on the page works.

29. **Restoring a backup made before a month was closed (7 Oct, decided by default).** The new
    end-to-end test of the main path found that once any month was closed, no backup could be
    restored at all, because reopening a month never fully clears the lock.
    - **Fixed:** a backup made when the books were closed at least as far as now restores normally
      (its closed months are the same closed books).
    - **Still refused:** a backup from before a close, with a message saying why.
    - *Default:* that stays refused, so closed books are never replaced by an older state. If you
      want an owner-only "reopen everything" that allows it, say so and Claude adds it, audited.

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

31. **Opening balances: which way round (8 Oct, decided by default).** An account's opening balance
    was read two ways: as you type it on the new-account form (a loan of 10,000 = 10,000) by the
    screens, and debit-positive (a loan = −10,000) by some server reports, the close package and
    the tax-software export, so a loan could show on the wrong side there.
    - *Default:* as you type it, everywhere. The form now says so ("what a loan owes, what a bank holds").
    - If you ever entered a loan or capital opening balance as a negative number to make a report
      look right, change it to positive once (Chart of accounts → the account).

32. **A group with a parent company (8 Oct, decided by default).** Settings → Groups of books can now
    name the parent and the share it owns of each other company; the group summary then shows the
    other owners' part of profit and equity.
    - *Default:* only companies owned **above 50%** (ones the parent controls) can be in such a group;
      one owned 50% or less is refused with a reason, because adding it line by line would be wrong
      and the "equity method" for it is not built. Say if you need that.
    - The parent's investment is taken out of the total once you choose, for each company, the
      parent's account that holds it (Settings → Groups of books). What the parent paid above the
      company's book value (goodwill) is not shown separately: the total is lower by that amount.

33. **Stock, Projects and Budgets are now modules (10 Oct, decided by default).** Until now these three
    screens were in no menu at all (only Ctrl+K and links). They are now in the menu when their module
    is on (Settings → Modules).
    - *Default:* a **new** workspace starts with them off (simple until needed); every existing workspace
      keeps them on. Turning one off hides it and deletes nothing.
    - The first-run tour (Help → "Take the tour") shows only the basics for the same reason.

34. **Goodwill and companies owned 50% or less (10 Oct, decided by default).** Settings → Groups of
    books now asks, next to the parent's investment account for a company, the day it was bought.
    - *Goodwill:* what the parent paid above its share of the company's equity at the end of that day
      stays in the group total and is said. No yearly write-down (impairment) yet.
    - *20% to 50% (an associate):* shown next to the others but not added; the group takes in the
      parent's share of its profit after the day bought, and of its equity since then (the equity
      method). *Default:* it needs its own investment account and the day bought; below 20% is
      refused (an ordinary investment, leave it out of the group). Balances and sales with an
      associate are not taken out of the total.

35. **Profit & Loss on cash basis (10 Oct, decided by default).** Profit & Loss → Basis → Cash.
    - *Default (as in the usual accounting software):* invoices and bills count when paid, in
      proportion to what was paid, on the payment's date; everything else (bank entries, journals,
      depreciation) counts as posted. Credit notes and write-offs on receivables are left out, and
      the screen says how many. Payments not yet applied to an invoice or bill don't count.
    - The balance sheet has the same switch: no receivables or payables on cash basis, and a payment
      not yet applied to an invoice or bill shows on its own line ("Paid, not yet applied").

36. **The two-person rule (10 Oct, decided by default).** Settings → Security → Two-person rule (owners).
   When on, nobody approves what they prepared: an invoice over the approval limit waits for someone
   other than whoever issued it (an owner's own too), and every pay run waits, an owner's too. So that
   an owner's pay run can be approved, an accountant may approve pay runs while the rule is on (never
   their own). It turns on only with a second owner or accountant. Purchase orders are not covered yet
   (they are saved by the browser; the rule would need a database change). Say if accountants should not
   approve pay runs, or if purchase orders should be included.

37. **Documents in Hebrew (10 Oct, decided by default).** Settings → Branding → "Language of the printed
   words" (English or Hebrew), and each customer can have their own (customer details → "Language of
   their documents"). Titles, labels, totals and page numbers change; names, lines, terms and amounts
   print as typed. An invoice is titled "חשבונית" and a sale receipt "חשבונית קבלה". If your
   invoices must say "חשבונית מס" (or "חשבונית מס קבלה") for the tax authority, say so and the titles
   will change.

38. **Signing estimates online (10 Oct, decided by default).** The customer types their full name and
   ticks "I accept"; the app keeps the name, the time, their internet address and browser. This is an
   ordinary electronic acceptance, not a certified digital signature (no ID check). Say if you need a
   drawn signature or a certified signing service.

39. **Direct deposit file (10 Oct, decided by default).** Payroll → a posted pay run → "Direct deposit
   file" makes a US ACH (NACHA) file to upload to your bank. Employees' bank account numbers are now
   kept on the employee record, readable by everyone in the workspace who can see payroll (as salaries
   already are), and shown masked. Your own bank's routing number and company ID stay in your browser.
   Say if account numbers should be hidden from bookkeepers, or if you need a non-US format (Masav in Israel).

40. **Hourly pay from approved time (11 Oct, decided by default).** An hourly employee is paid, in each
   pay run, for their approved time up to the pay date that no earlier run paid, at one hourly rate.
   There is no overtime rate (e.g. time and a half over 40 hours a week) yet. Say if you need overtime.

41. **Done (owner, 13 Oct).** **Repository made public (11 Oct): roll one old Stripe test key — needs you, 2 minutes.** An early
   commit (5 Jul, removed on 22 Jul) had a Stripe *test-mode* secret key starting `sk_test_51Th0cy…`.
   It cannot move real money, but anyone can now read it. In Stripe → Developers → API keys (test mode)
   → "Roll key", then put the new one in Vercel's `STRIPE_SECRET_KEY` if you use test mode there. No
   other secrets were found in the history (no database passwords, service keys or live keys). CI now
   runs on GitHub on every push to main, every helper-AI branch and every pull request.

42. **Tax: what only you can do (11 Oct; plan in docs/PLAN.md).** (a) Register with the Israel Tax Authority
   for allocation numbers (free) when you want LedgerFlow to fetch them; until then it prepares the request. (b) Before
   the "not for filing" note comes off payroll and returns, have an accountant check one real month of Israeli VAT and
   one US pay run. Default meanwhile: the note stays.

43. **Israel allocation numbers (11 Oct, decided by default).** A tax invoice to a business buyer (their VAT / dealer
   number on the customer) above the threshold before VAT asks for an allocation number, typed on the invoice and
   printed on the PDF. Thresholds used: ₪25,000 from 5 May 2024, ₪20,000 in 2025, ₪10,000 from 1 Jan 2026, ₪5,000 from
   1 Jun 2026 (src/lib/tax/ilAllocation.ts). Please have your accountant confirm these dates; a wrong row is a one-line
   change. Fetching the number automatically needs your Tax Authority registration (item 42).

44. **From the strategic review (11 Oct): three things only you can decide or do.** (a) A licence: the repository is
   public with no LICENSE file, which means "all rights reserved" (nobody may reuse it), not open source. **Updated 11 Oct:** added `LICENSE.md` (PolyForm Strict 1.0.0), allowing only the limited noncommercial uses it describes, with no permission to distribute or make derivative works. Commercial use requires separate permission. The project is source-available, not open source. Before accepting outside contributions, set up a separate contribution process. (b) Backups:
   check that Supabase point-in-time recovery is on for the live project, and let me run one restore drill to a copy.
   (c) Branch protection on GitHub (Settings → Branches → main: require CI to pass) — it also covers L-67.

45. **For your accountant (11 Oct): one Israeli VAT row to confirm.** AI #3's table (src/lib/tax/ilVat.ts) treats
   supplies in Judea and Samaria as zero-rated from 1968. Default kept: the row stays, marked "calculation only", so no
   filing relies on it. Please confirm or correct it; it is one row.

46. **GridCraft "Spreadsheet Lab" (12 Oct, decided by default: not started yet, research only).** GridCraft and craft-libs
   are MIT OR Apache-2.0; we would use MIT and ship their NOTICE in a THIRD_PARTY_NOTICES file. The ArtCraft name and
   logos are trademarks and are not covered: we never show them. GridCraft says it is **alpha**. Default: it stays an
   optional, separate add-on that only reads report data and never writes to the books. Say if you want it sooner, or not at all.

47. **Prices (13 Oct, decided by default).** There were four price lists: the pricing page ($0/49/149/499), Settings
   ($0/29/99/299), the admin screen ($49/$299) and the Stripe checkout, which actually charged **$5, $10 and $50**.
   Now there is one table, `src/lib/plans.ts`, read by all of them. Default used: **Free $0, Growth $29, Pro $99,
   Enterprise $299 a month** (yearly 20% off), with the limits the server already enforced (100 / 1,000 / 10,000 /
   1,000,000 entries; 1 / 5 / 25 / 1,000 people). Feature lists now say only what the app does (no "dedicated Firestore",
   no "SSO", no "24/7"). Tell Claude your real prices and they change in one place.

## C. Good to know (no action needed)

- **GitHub Actions minutes (5 Oct, your message):** each automatic GitHub test run cost about 28 of
  your 2,000 monthly minutes, and every push started one. Now GitHub runs the tests only **once a
  week (Mondays)** and when you press **Actions → CI → Run workflow**. Claude and Codex run the same
  checks on their own machines before every push (that costs you nothing), including the slower
  ones every ~5 changes. Vercel still deploys every push (that doesn't use Actions minutes).
  Optional: GitHub → Settings → Billing → Budgets → set the Actions budget to **$0**, so GitHub
  stops instead of charging if the minutes ever run out.

- **Keyboard shortcuts changed (2 Oct)** so they no longer take the browser's own keys: Quick entry
  ⌘⇧E (was ⌘Q, which quits the browser on a Mac), Focus mode ⌘⇧F (⌘F is find again), Reports ⌘4
  (⌘P prints again). Press **?** to see them all.

- **New (3 Oct): Settings → Branding & PDFs.** Add your logo, colour, address, a footer (bank
  details) and the terms printed on invoices, estimates and receipts; "Preview PDF" shows a sample.
  Invoice PDFs now print every line (they stopped at 15), run over several pages with page numbers,
  show Hebrew names correctly, and carry a QR code to the payment page once the invoice is sent.
- **New reports (3 Oct):** Contact Balance Summary, Inventory Valuation, Transactions by Reference,
  and "Tax by rate" on the Sales Tax screen. Data Health also flags money left in suspense or
  clearing accounts and bank lines unmatched for over 30 days.
- **New (5 Oct): stock changes go through the books.** On Inventory, each item has **Adjust stock**
  (damaged/lost/found, stock received with its cost, opening stock) and the header has **Stock
  count** (type what is on the shelf; differences go to a shrinkage/variance account in one entry).
  The quantity in the item form is now read-only: typing a number there used to change the stock
  with no entry, so the balance sheet and the stock list drifted apart. New items' opening stock is
  posted against Opening Balance Equity. Category chips filter the list, and teammates now see all
  items (each person saw only their own).
- **New (5 Oct): merge duplicate customers or vendors.** On the contact's page → "Merge a
  duplicate": everything of the duplicate (invoices or bills, payments, credits, estimates,
  schedules) moves to this contact and the duplicate is deleted; amounts don't change. Owners and
  accountants only. Default used: documents in closed months move too (it's the same customer).
  Also new: Inventory → "Manage categories" renames or merges a category on all items.
- **New (5 Oct), your zero-friction requests:** (1) **Pin any page**: the pin in the top bar (or
  Alt+P); pinned pages stay as buttons on every page, Alt+1 … Alt+9 jumps to them. (2) **Edit in
  place**: click a value and type (Enter saves, Esc cancels) on the customer and vendor lists, a
  contact's address/currency/tags, and Inventory; more screens follow one by one, and it's now the
  rule for every screen. (3) **Suggestions while typing** from your own data. (4) Settings →
  Document Numbering: change invoice/bill/estimate numbers safely.
- **New (5 Oct): how each customer wants their documents.** On a customer's or vendor's page (and
  in their form) there is "Documents go out by": Email (the default, as before), Print, Post, or
  Nothing automatic. Only what the app does by itself listens to it — the daily payment reminder, the
  monthly statement batch, and emailing an invoice when you save it as Sent. Someone who gets paper
  instead gets the reminder in the bell for your team. Pressing **Email** on an invoice always sends;
  the send log then says it went against their choice.
- **New (5 Oct): big invoices wait for you.** Settings → Emails & Reminders → "Approval before an
  invoice goes out": switch it on and name an amount, and no invoice above it is emailed until an
  owner or an accountant approves it. The invoice itself is booked as usual — the accounts and the
  reports stay complete — only the customer receiving it waits, and its payment reminders wait with
  it. In the invoice list a held invoice says "Waiting for approval", and an owner or accountant sees
  **Approve** and **Send back** (with a note the bookkeeper then reads). Approving or sending also
  releases its reminders. Turning this on changes nothing about invoices that already went out.
  Default: off, until you name an amount.
- **New (5 Oct): thank-you emails.** Settings → Emails & Reminders → "Email a thank-you when a
  customer pays" (off until you turn it on). Default used: off, so no customer gets a surprise email.
- Vercel deploys by itself about a minute after each push to `main`.
- Database changes are applied to Supabase by Claude and tested on a local copy first.
- Progress and the full list: [TRACKER.md](TRACKER.md).
