# For you: things only you can do or decide

Claude keeps working while these wait. It never stops to wait for an answer: where a decision
is needed, it takes the default written below and moves on. When you have time, answer as many
as you like in one message, e.g. **"1 done, 4 yes, 11 hide, 10 keep Hebrew"**. Answered items are
removed from this list.

Last updated: 2026-10-07.

*Done and superseded items were moved to [docs/archive/FOR_YOU_DONE.md](archive/FOR_YOU_DONE.md) on 10 Nov 2026 (AI #13 cleanup). Item numbers below keep their original values.*

**AI #2, 19 Oct — automatic PR creation:** the running environment's proxy rejects HTTPS CONNECT to `api.github.com` before GitHub authentication; native Git push works. I saved a network draft adding only `api.github.com` (existing package-manager preset retained). Review/save it in environment settings, then publish the environment. This has not changed the current runtime, and GitHub API authorization remains untested behind that block. Do not send credentials in chat. Earlier C-126 and C-116/C-119/C-123 branches are now confirmed merged into main `dae712e5`. The new [C-72/C-73/C-75 review branch](https://github.com/shmuelbiller1/ledgerflow/pull/new/codex/c72-c73-c75-report-follow-ups) can be opened manually while API access is blocked.

## A. Settings only you can change (a few minutes each)

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

17. **Privacy papers (before real customers, 15 minutes + a lawyer).** Put your company name,
   address and privacy email into `docs/privacy/ROPA.md` and `docs/privacy/DPA_TEMPLATE.md`
   (Claude wrote everything else from the code), then have someone who knows the law where you
   operate read them.


49. **Turn on passkeys in Supabase (2 minutes, 7 Nov).** The app now has "Sign in with a passkey" on the
    sign-in screen and a Passkeys section in Settings → Security (CC-12). Supabase has to allow them:
    Supabase → project *ledgerflow* → Authentication → the passkeys / WebAuthn setting (under Sign In / Providers; the exact menu name may differ) → enable,
    with the site's domain as the relying party (the live address, e.g. `ledgerflow.vercel.app`) and the
    live address as an allowed origin. *Until then: the buttons show, and using one says the passkey was not
    added / sign-in failed; password and Google sign-in work as before.* Someone with an authenticator app
    still gives its code after a passkey.

50. **Shared office connection and the app-wide request limit (7 Nov, decided by default).** Every visitor's IP
    address gets 1,000 requests per 15 minutes across the whole app (`src/server/middleware/rateLimiters.ts`).
    People who share one public IP (an office, a school, a family) share that bucket, and a few people with
    dashboards open can reach it; they then see "Maximum rate limit reached". The fix is to count per signed-in
    user (verify the sign-in token first, fall back to the IP for visitors), which changes how abuse is
    limited. *Default: unchanged until you say so, or until a tester reports the message.* Say "count per user"
    and Claude will build it.
51. **What is left in the tracker needs you or an outside service (7 Nov).** The open items that remain mostly
    need a decision, an account or a key: pricing (P-06 usage metering, P-10 referrals), identity providers
    (P-01 SSO, P-02 SCIM), banks and shops (Y-04..Y-07 bank feeds, Z-23..Z-27), country filings (T-09..T-15),
    email domains (K-35 inbox address, L-84 custom sender, Y-29 SPF/DKIM), push notifications (S-20, needs
    keys), and the GitHub branch rule (L-67). The larger engineering items Claude works through next:
    P-03 IP allowlist (database-side check needed), C-19/L-123 archiving closed years, M-21 standard costing,
    W-07 assembly. *Default: Claude takes the engineering items in that order.*
52. **IP allowlist (P-03) is on hold until one fact is checked (7 Nov).** The browser reads the books straight
    from Supabase, so an allowlist must be checked inside the database (one place covers every table: the
    `lf_ws_role` function), not only on the server. Supabase's docs say to read the client address from the
    first entry of `X-Forwarded-For`, and they do not say whether Supabase's own gateway removes a value the
    visitor typed into that header. If it does not, anyone could claim to be on the office address. The safe
    header would be `cf-connecting-ip` (set by Cloudflare), if Supabase passes it to the database. Checking it
    needs one query on the live project, which Claude does not run (the Supabase tool is only for migrations).
    To unblock: say "check the IP header" and Claude adds a small owner-only diagnostic function (a migration)
    that reports which address headers arrive through the app (the SQL editor bypasses the gateway, so it
    cannot show them). *Default: P-03 waits.*
53. **Little engineering is left that does not need you (8 Nov).** C-19/L-123 (archiving closed years) is
    AI #9's work in progress (steps 1–6 merged; C-19 is in its queue), so Claude leaves it there. What remains
    in Claude's own lane is M-21 standard costing and W-07 assembly, which the roadmap marks as later or
    add-on items. Most of the value now sits behind items 49–52 above and the decisions in section B.
    *Default: Claude builds M-21 next. The 5-hourly restart keeps running; if you prefer to save usage until
    you answer, pause the "LedgerFlow: keep working" scheduled task.*
54. **Standard costing: post at standard or only compare? (8 Nov, decided by default).** Items can now carry a
    standard cost, and the Inventory list shows each item's actual average cost against it (+/− %). The books
    still value stock at the moving average, exactly as before. Full standard costing would carry stock at the
    standard and send every difference to a "purchase price variance" account when goods arrive — a change to
    how purchases and sales are booked, so only with your say-so. *Default: compare only.* Say "post at
    standard" if you run a manufacturing or wholesale business that budgets by standard cost.
55. **Kits: built when sold, or built ahead into stock? (8 Nov, decided by default).** Today a kit (an item made
    of parts) keeps no stock of its own: selling one uses its parts, and Work orders / Kit Assembly plan builds.
    Some businesses build kits ahead and keep them on the shelf as finished goods (parts out, kit in, at the
    parts' cost). That is a new stock posting, so only with your say-so. *Default: built when sold.* Say
    "build kits into stock" if you need it.

**⚠ 2 database changes waiting (10 Nov, from #608 monthly reports).** In Supabase → SQL editor, run one at a time:
1. `supabase/migrations/20261110000000_report_pack_schedule.sql` (lets a schedule send the "report pack")
2. `supabase/migrations/20261110010000_report_notes.sql` (saves report notes)
Until they are in, a report-pack schedule and a report note cannot be saved. Everything else works.

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


23. **Closing a year (decided by default, 6 Oct).** Closing a year used to post an entry moving all
    revenue and expenses to Retained Earnings; that made the closed year's Profit & Loss show zero
    profit. LedgerFlow's balance sheet already shows past profit in retained earnings automatically
    (as Xero and QuickBooks do), so closing a year now locks it and records its profit, without that
    entry; any old closing entries are ignored. *Default: this way.* If your accountant wants a
    classic closing entry posted anyway, say so.


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


29. **Restoring a backup made before a month was closed (7 Oct, decided by default).** The new
    end-to-end test of the main path found that once any month was closed, no backup could be
    restored at all, because reopening a month never fully clears the lock.
    - **Fixed:** a backup made when the books were closed at least as far as now restores normally
      (its closed months are the same closed books).
    - **Still refused:** a backup from before a close, with a message saying why.
    - *Default:* that stays refused, so closed books are never replaced by an older state. If you
      want an owner-only "reopen everything" that allows it, say so and Claude adds it, audited.


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

48. **Reminder letters for unpaid invoices (13 Oct, decided by default).** AI #3's dunning letters go out 7, 21 and 45 days
   after the due date, each firmer than the last. Say if you want other days.

- **PR #583 (GitHub's automatic security fix, 9 Nov)** — not merged. It turns on the strict browser security policy in local development too; 6 checks fail on it. Default: leave it closed-out of the merge queue; the production policy already exists. Close it if you agree.

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


**Waiting on a database change (AI #3, 14 Oct):** the Custom fields feature (A-37) is checked in with
migration `supabase/migrations/20261014020000_workspace_custom_fields.sql` (it allows the workspace's
`customFields` field and checks its shape). It needs Claude to review and apply it like the other
migrations; until then Settings → Custom fields cannot save the definitions. Nothing else waits on it.

**Waiting on a database change (AI #3, 15 Oct):** the Blanket Purchase Orders feature (A-62) is
checked in with migration `supabase/migrations/20261015000000_purchase_order_blanket.sql` (it allows
the `blanket` field on purchase orders and checks its shape). It needs Claude to review and apply it
like the other migrations; until then Reports → Blanket Purchase Orders can show and export existing
agreements but cannot save a new mark (the database refuses the field and the screen says so).
Nothing else waits on it. The report's draw-down figure is metadata only — no money is posted or
changed by this feature at all.


**16 Oct, AI #3 — safe handoffs found during the warehouse launch-readiness audit:**
- **A-72 customer statements by entity / issue #141:** the current statement PDF service has no entity/period filter (including the dates already selected on the existing screen). AI #1 must define authoritative treatment of line labels, allocations spanning entities and unapplied payments, then apply the same scope to JSON, PDF and any email. No misleading browser-only filter was added.
- **A-66 is reopened as Partial — RMA approval is operational metadata, not a financial authorization:** this screen checks owner/accountant and a different requester, but the existing generic metadata RPC does not enforce those event rules or compare a revision. History can be edited/overwritten by another authorized metadata writer. The screen and capability table now state this limit. A server-validated transition/CAS contract belongs to AI #1; no financial return/credit is posted here.
- **A-8 asset tags:** the unique-index migration is already checked in and its database test passes locally. Applying the migration is not proof the index exists: it deliberately skips creation when legacy duplicate tags exist. Before launch, resolve duplicates and confirm `assets_workspace_tag_uq` exists in the deployed database. No production database was accessed in this audit.
- **Release status:** main `a1b011f` still has a failing Playwright job (CI run 38841187066); build, database/coverage and both timezone jobs pass there. Issue #136 tracks known visual-baseline failures. This batch is not a whole-system launch sign-off and does not refresh screenshot baselines.

**16 Oct, AI #3 — four read-only launch tools are ready on the Reports tab (branch `arena/8f84f1e9-ledgerflow`):**
document number gaps per series (missing and repeated numbers), a 13-week cash forecast from open invoices, bills and
recurring rules, a vendor 1099 readiness list (masked tax IDs, missing address or 1099 marking) and a duplicate-bill
review (same vendor, same amount, three-day window). All four are read-only, state their own limits on screen, and change
no money, posting, migration or budget. The whole queue — 100 done, 10 partial, 108 open, with exactly what each partial
task still needs — is in [`docs/verification/agent3-final-2026-10-16.md`](verification/agent3-final-2026-10-16.md).

**Still yours to decide before launch:** the three checked-in migrations (`20261014010000_unique_asset_tags.sql`,
`20261014020000_workspace_custom_fields.sql`, `20261015000000_purchase_order_blanket.sql`) must be applied/reviewed in the
deployed database, the asset-tag unique index must be confirmed after resolving legacy duplicates, and main's Playwright
E2E job is still red (issue #136) — the build, lint/type/test and both timezone jobs pass. AI #3 does not claim a
whole-system launch sign-off.

**16 Oct, AI #3 — browser evidence and one flake (saved so it is not lost):** the whole Playwright suite was run
locally for the first time in this environment (see `docs/verification/agent3-final-2026-10-16.md` §2b). All 60 report
screens mount cleanly in a real browser; two full runs of the suite on this branch gave 258 then 259 passing with
**zero functional failures**, plus 40 screenshot diffs that are not trustworthy from this sandbox (different font
rendering) and were not treated as regressions. One load-related flake was found in a screen AI #3 does not own —
the nested "Edit record details" drawer not closing on Escape under full-suite load — and is filed as issue #146
with the exact evidence. Nothing was baselined or hidden to make anything pass.


## 20 Oct — Copilot "Potential fix for code scanning alert" PRs (for the owner)

24 automatic fixes were opened (#205–#228); three more had been merged straight into main earlier (alerts 9, 29, 33 — reviewed afterwards, all fine). Reviewed one by one:
- **Merged (12):** #205, #206, #208, #210, #211, #212, #221, #223, #224, #225, #226, #228.
- **Replaced by one correct fix (9):** #213–#220, #222 (upload path). #213 would have refused every bank CSV upload.
- **Closed — would break the app:** #209 (every API key refused), #227 (payslips stop downloading). #207 was a duplicate.

**Please do on the code-scanning page** (needs your admin rights; this session cannot read or dismiss alerts):
dismiss as *false positive*: alert 24 (payslip GET), 25 (API-key SHA-256 — keys are random secrets), and as *won't fix / used in development*: alert 32 (Helmet CSP is on in production).

**Default from now on:** Copilot autofix PRs are reviewed by AI #1 like any other PR before merging — please don't press "Commit" on them directly in GitHub; touching server code they can break uploads, API keys or payslips, as three of these would have.

## 20 Oct — bookkeeping-first plan (decisions taken with the defaults AI #1 recommended)

1. **Payroll in the first releases = recording an outside provider's results (CSV import, PAY-1).** Running payroll ourselves (withholding engines, direct deposit, filings, W-2) waits for stage C. Existing payroll code stays. *Change if you want payroll processing earlier.*
2. **Tax in stages A and B = user- or accountant-chosen rates, clearly marked.** The US/IL engines stay as suggestions; filing-ready automation is stage C. Real Israeli tax invoices still need allocation numbers. *Change if a pilot customer needs automated filing.*
3. **First-hour journey test (W1) moved from AI #8 (inactive) to AI #7.**
4. **Open question for you:** who are the stage-A testers, and when do you want to invite them? Stage A needs W1, W2–W5, W10, W14 and gates G-01/G-02 (see RELEASE_GATE "Today").


## 20 Oct — PAY-1 payroll import: provider column sets (AI #9)

**Open question for you:** the payroll import accepts one column set per provider (Gusto payroll journal, ADP payroll register, Paychex payroll journal; listed in `src/lib/payrollProviderImport.ts`). I wrote them from the common column names; they are **not checked against a real export** from each provider. **Default I used:** any other column stops the import and names it, so a different export is refused rather than read wrongly. If you or a pilot customer can share a sample export (names changed), I'll match its columns exactly.


## 21 Oct — stock costing method (DIM-2 phase 5, AI #9)

**Open question for you:** the books cost stock by **moving average** (each purchase changes the average; a sale costs at the average). The stock history now keeps where each unit came from and went (Reports → Stock Sources and Uses), but it does not tie a sale to the exact purchase lot. Phase 5 of GitHub #132 would add optional **FIFO or lot-specific costing**. That changes the cost of goods sold and the stock value, so it needs your decision (and your accountant's) first. **Default I used: stay on moving average; phase 5 is not started.** Say if a customer needs FIFO or lot costing.


## 22 Oct — defaults AI #9 used (answer any to change it)

1. **Israeli VAT, a bill with both equipment and other lines (ISS-160, #303).** Its whole input VAT is reported as *other* input VAT, and the month journey names the bill and asks you to split it into two bills. *Default used: report it whole as other.* Say if mixed bills should instead be split line by line on the equipment row.
2. **US "reduced-rate item" (W8-GOLD, #304).** None of the five supported states has a reduced-rate row in the taxability table. The worked quarter therefore uses Texas groceries at 0%. *Default used: no invented reduced rates.* Say if a state you sell in needs one, and with its source.
3. **Pay runs, one person's time linked to two hourly employees (U-12).** The pay run is refused (409) and names both employees, so the same hour is never paid twice. *Default used: refuse.* Say if one of them should be paid instead.
4. **Label roles (DIM-3).** A label that is "fully attributed" or "self-balancing" is checked and listed in Data Health; nothing is refused. *Default used: list only.* Say if an entry that breaks a self-balancing label should be refused.
5. **Withholding rate after the vendor's certificate expires (ISS-156).** The rate is cleared and must be typed, as on a fresh payment; a rate typed by the person stays. *Default used: cleared.*
6. **Scheduled reports (AUD-04, PR coming).** A failed address is tried again after 1, 4 and 24 hours, then given up; giving up is logged. *Default used: 4 attempts.*

7. **Israeli VAT, the Eilat area's subsections and the PCN874 header month for two-monthly filers (CON-4b).** I could not open www.gov.il or www.nevo.co.il from here, so neither was checked against the law's text. *Default used:* a sale in Eilat by an Eilat dealer is exempt (s.5 as the app already applies it), and a two-monthly PCN874 file names the first month of the pair. Say if either is wrong; to let me check, allow those two sites under the cloud environment's network access.
8. **Database certificate (AUD-20).** Paste the Supabase certificate into Vercel as `DATABASE_CA_CERT` (Settings → Environment Variables; one line with `\n` works). Until then the connection is encrypted but the server's certificate is not checked, and the logs say so once.
9. **If you change the Supabase project (AUD-12).** Set `VITE_SUPABASE_URL` and `SUPABASE_URL`, then run `npm run csp:vercel` and commit `vercel.json`. The build stops on purpose until you do, so the browser is never blocked from the new project.
10. **Yen and dinars on the other forms (BM-04).** The invoice, bill and payment forms now read amounts in the document's own decimals. Credit notes, vendor credits, journals, expense claims and imports still read two decimals. *Default used: left for a follow-up.* That is right for every two-decimal currency, but a yen or dinar amount typed on those forms must be checked.
11. **Bank import into a locked month (PREV-6).** Rows dated before the lock date are left out, but the success message still counts them. *Default used: left as is (reported).* Say if the import should be refused whole instead.

## 22 Oct — the outside ERPNext comparison: what is true, and what AI #9 recommends

You shared a comparison of LedgerFlow with ERPNext. AI #9 checked its claims against the code on main (22 Oct).

**True, and worth doing** (in this order):
1. **Credit limit is only a report (EG-5).** An invoice over the customer's limit saves without a warning. *Recommend: next, small.* The server refuses it unless an owner gives a reason.
2. **No repair path after a backdated fix (EG-1).** If an old entry is corrected, nothing recomputes what depends on it (stock values, payment allocations). *Recommend: design now, build with L-123* (the closed-year balances already in progress), because both need the same "what changed since" machinery.
3. **Payment allocations have no ledger of their own (EG-2).** Which payment paid which invoice lives inside the payment records; there is no report to check it against the books. *Recommend: after EG-1.*
4. **Closing a year is a lock and a checklist, not a document (EG-3).** *Recommend: a posted closing record per year, after L-123.*
5. **Landed cost is a preview only (EG-6, already listed as BF-04)** and **no stock snapshot at period end (EG-7).** *Recommend: before promising stock (W13) to a real client.*
6. **Smaller:**
   - the tax breakdown kept on each posted line (EG-12): a check first, it may already be true;
   - bank rules applied on the server (EG-9);
   - a budget check when posting (EG-4);
   - importing open invoices at migration (EG-14).

**Out of date in the comparison** (already fixed today):
- return approvals (RMA) are decided by the server (#302);
- scheduled reports cannot be sent twice (#311).

**Your decision, still open:** FIFO / lot costing (EG-8, the DIM-2 phase 5 question above). Until you answer, stock stays at moving average.

**Agreed not to build:** manufacturing, CRM, POS, quality, helpdesk, a generic workflow engine, a report builder or a print-format designer. They add a lot of work without making the books more reliable.

The full list is in COORDINATION (22 Oct, AI #9 → AI #1) for AI #1 to queue.


## 24 Oct — optional setting (1 minute): let the ESLint ratchet open its own PR
The "ESLint warning ceiling" workflow lowers the warning cap by itself when warnings go down, by opening a small PR. It
fails with "GitHub Actions is not permitted to create or approve pull requests". To let it: GitHub → the repository →
Settings → Actions → General → Workflow permissions → tick **Allow GitHub Actions to create and approve pull requests**
→ Save. *Default I used:* left as it is; AI #1 lowers the cap by hand (106 → 105 today). Nothing else depends on it.

## 25 Oct — three choices I made with a default (AI #9). Say if you want any changed
- **Bank import (EG-9, #377):** bank lines nobody categorised are no longer posted automatically on import. They wait as pending lines with the rules' suggested account, contact and labels. A person accepts them in Reconciliation → Create entry, where the suggestion is pre-filled. Lines a person categorised during the import review still post as before. *Default:* nothing is posted without a person. The alternative is to post lines that have a suggestion automatically again.
- **Open invoices and bills import (EG-14, #378):** a row naming a contact that isn't on the books is refused. A contact name shared by two contacts is refused too. *Default:* refuse, as the Xero import does. The alternative is to create the contact, as the older paste dialog does. The paste dialog now uses the preview/confirm import (AI #9, branch ai9/EG-14-dialog), so it refuses unknown contacts too and no longer adds them. Two more things changed with it. The server has no preview token, so "Add" sends again the exact file that was checked, and the server checks it a second time. And while any line has a problem nothing is added; before, the dialog left those lines out and added the rest. *Default:* keep it like this. Say if you want a token or the old "leave out the bad lines" behaviour back.
- ~~**Two bugs in code from another PR**~~ (three) **Fixed by AI #1 on 25 Oct, with worked-figure tests** (`israeli-annual-summary-yearend.test.ts`, `corporate-card-charge-amount.test.ts`). Found by Codex while reviewing EG-10:
  - The annual party summary reads withholding tax from `withholdingTaxCents`, but payments store it in `withheldCents`, so the tax withheld on real vendor payments shows as 0.
  - The same summary's year-end open balances use today's payments, not the payments made by 31 December.
  - The corporate card import treats a single "Charge Amount" column as debits, so refunds come in as expenses.
- **Payment void on the server (EG-2 step 4, #394, AI #9).** Three choices made with a default; say if you want otherwise:
  - When a payment is voided, each invoice or bill gets back exactly what that payment put on it. The paid amount is not recalculated from the allocation rows, because before the cutover those rows don't include cash entered together with the document. *Default:* subtract that payment's share.
  - A bill with nothing left paid goes back to `approved`; the status it had before payment isn't stored. *Default:* `approved`. The alternative is `unpaid`.
  - No screen can void a payment today. The only browser-side void code is never called, and it is being retired so it can't leave documents marked paid. *Question:* do you want a "Void payment" button, and on which screen (customer or vendor page, or a payments list)? It would ask for a date and a reason and call the new route. *Default:* no new button until you say.
- **Server month totals for capped lists (L-123 step 3e, #400, AI #9).** When the browser holds only part of the history, tax, the fiscal-period audit, the cash-flow trend and budget-left now take their monthly totals from the server. Two choices were made with a default:
  - The cash-flow *trend* corrects only the month that is partly loaded. It does not ask the server for older months the chart doesn't show. *Default:* keep it like this.
  - Budget-left leaves out the document being edited only when that document is loaded. If it isn't loaded, the server's total stays as it is. *Default:* keep it like this.

## 27 Oct — for first testers: the test banner and where their reports go (AI #1)
- **Test banner:** every screen of the live site now says "Test environment. Use made-up books only". When you allow
  real books, add `VITE_TEST_ENVIRONMENT` = `off` in Vercel (Settings → Environment Variables) and redeploy.
- **Reports from testers:** "Report a problem" (in the banner) and "Send feedback" save a support ticket. The tester sees
  a reference such as `3F2A9C1E`. **You see every tester's reports on Settings → Support, but only if your account is a
  platform admin.** If it isn't yet, tell me the email you sign in with and I'll make it one (it is one database step). *Default I used:*
  reports stay in the app; no email is sent. Say if you want an email for each new report, and to which address.

## 31 Oct — one choice I made with a default: "Edit details" next to the bank account picker (AI #1, #457)

The CSV import in Bank Feed Import now asks which bank account the statement belongs to. Codex points out that the
repo's rule (src/components/AGENTS.md) wants an **Edit details** button beside every related-record picker. The
details drawer today edits customers, vendors, projects and items only, so offering it for accounts means adding
accounts to the drawer: its allowed fields, a save path through the account service, and tests. That is a small
feature of its own. *Default I used:* no Edit details button on this picker for now; to correct an account you edit
it on the Chart of Accounts screen. Say if you want accounts added to the details drawer, and I'll queue it.

**Related, same PR:** CodeRabbit found that no button opens the legacy Bank Feed Import dialog at all (Ledger has a
`bank_import` modal that nothing sets). The live statement import is Banking → Import statement. *Default I used:* keep
the fixed dialog in the code, unreachable, and add no new entry point. Say if you'd rather I delete it.

## 31 Oct — one setting for automatic bank feeds (AI #1, AU-1)

Plaid can now tell LedgerFlow when a connected bank has new transactions, so bank lines arrive without anyone
pressing Sync. To turn it on, add **`PLAID_WEBHOOK_URL`** = `https://<your production domain>/api/webhook/plaid`
in Vercel (Settings → Environment Variables) and redeploy. Every notice is checked against Plaid's signature
before anything happens. *Default I used:* the setting is optional. Without it, nothing changes and Sync works
as today. Banks connected before you set it keep working with Sync. They get automatic updates once they are
reconnected (or I can add a one-time "register webhook" step for existing connections if you want it).

## 2 Nov — API keys can no longer change workspace settings (PR #490)
CodeRabbit found that an API key with only `read:workspaces` could change workspace settings (payment types, alerts, modules, roles…), because every `/workspaces` request mapped to that read scope. Writes there now need `write:workspaces`, which no key can be issued, so keys can read workspace settings but not change them. **Default used:** keep it locked. If an integration of yours needs to change workspace settings with a key, say so and I'll add `write:workspaces` as an issuable scope.

## 10 Nov — AI #9: L-123 step 4 merged; C-19 (archive closed years) paused, your call
**Done (#602):** a workspace with more than 20,000 entries and a closed year now loads only the open years in the
browser; balances and reports for the closed years come from the server's year-end snapshot. Smaller workspaces load
everything, as before.

**C-19, the last item in AI #9's queue, is not started.** It would move closed years' entries into a separate
`transactionsArchive` table. With step 4 merged, the browser no longer needs the closed years, so C-19 now only helps the
database itself (smaller main table). It is large: 44 server files read the entries table directly (reports,
reversals, exports, reconciliation, the repost engine), and every one of them would have to read both tables, plus a
migration you apply.
*Default I used:* **paused** until a real workspace gets big enough for the database to be slow (none is yet). Say
"do C-19" and I start it as one PR.
