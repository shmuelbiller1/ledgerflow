# LedgerFlow tracker (kept by Claude)

> AI #1's own open items (helper AIs: use [`CURRENT_WORK.md`](../CURRENT_WORK.md)). Finished items moved to [`docs/archive/TRACKER_DONE.md`](archive/TRACKER_DONE.md) on 20 Oct. Old instructions further down that say "work on main" are AI #1's rule only — every other AI uses its own branch and a PR.


This is the working plan: what is done, what is next, and the full 864-item list. Claude
updates it as work lands. Things that need the owner are in [FOR_YOU.md](FOR_YOU.md).

**Automatic restart:** a Routine ("LedgerFlow: keep working (wakes this session)") wakes this
Claude session every 5 hours, so work continues by itself after a 5-hour or weekly usage limit
resets, and any approval still waiting is cancelled so the session can't stay stuck. (A version
that started separate new sessions did nothing: they had no code or connectors.) To stop it:
tell Claude, or delete it under Routines on claude.ai.

**Second AI:** if another AI works on the repository too, the lanes and the "who edits which
files" board are in [COORDINATION.md](COORDINATION.md).


**Setting up a fresh machine (for Claude):** Node 24 and PostgreSQL 16. Create a local test
database, apply `supabase/migrations/*` with `LF_TEST_DATABASE_URL=... npx tsx scripts/db-test.ts setup`,
then the checks: `npx tsc --noEmit -p tsconfig.json`, `LF_TEST_DATABASE_URL=... npm test`,
`npx tsx scripts/db-test.ts rls`, `npm run build`, browser tests with Playwright, `npm run ratchet:update`.

---

# NOW — working straight on `main` (2026-09-24, late)

**How we work now (your rule, in CLAUDE.md):** Claude commits and pushes directly to `main`.
No feature branches, no pull requests. GitHub CI runs weekly and by hand only (5 Oct: Actions
minutes); Claude and Codex run all checks locally before pushing. **Vercel deploys by
itself from GitHub about a minute after each push** (connected 2026-09-25) — Claude no longer
deploys by hand; database migrations are still applied to Supabase by Claude.

**Order you asked for:** all 864 items. First the LAUNCH list (112), then QUALITY (105),
then the 488 LATER items. Claude works through them in that order and ticks them off below.

### Done this session (all on `main`, tested: type check, 411 unit tests incl. database,
### 33/33 browser tests, build)
| Item | What |
|---|---|
| AI #8 (G-1..G-16, G-20..G-24, F-46, F-47) | Bilingual EN/HE help docs & 20 searchable how-to guides, guided first-month hub + Day 1/3/7 templates, IL/US 1-year balanced guest sample books + sandbox reset guard, weekly changelog, modules & keyboard shortcut reference sheets, WCAG 2.1 AA statement + EN/HE translation coverage tool, `/status` + `/c/<token>` portal + grouped notifications + owner feedback triage, dark-mode print light-paper override, Group Summary CSV export, and browser E2E specs for `W1`, `W10`, and `W12` (`docs/verification/ai8-verification-2026-10-20.md`) |
| K-02 | Items on invoice lines: pick by name/SKU, price + cost filled, free text unlinks (tested) |
| J-07 | Sales by Item: issued invoices only, base currency, real cost of goods sold or "(est.)", "No item" row, dark mode (tested) |
| J-12 | Journal Sheet: posted entries only, base currency, unbalanced list, dark mode (tested) |
| W-03 | Cost of goods sold on invoices fixed (no FX mistake, missing accounts don't block the invoice → "Cost not recorded · Retry"); **stock now goes down on sale and back on void/edit/delete**, same database transaction; an entry can't be reversed twice (7 database tests) |
| L-81 | SECURITY restore can't touch other workspaces (earlier today) |
| L-82 | Removed AI Studio fallbacks: errors were reported as success; in-memory billing copy |
| L-90 | SECURITY viewers could post/edit/reverse/close periods via the server; any member could add/remove members, create API keys, start billing; labeling read other workspaces' accounts — all fixed + tests |
| L-93 | Express 5 (merged on main by Dependabot) made main's type check fail and would crash at startup — fixed |
| Banking 1 | Y-09 Y-10 CA-01: pay invoices/bills from a bank line, split a bank line. Fixed: **statement import always failed** (browser can't write bank lines); **Receive payment failed** without account mappings; payment records lacked the fields reports read |
| Credits | K-09 K-10 BA-09..13: apply credits to open invoices/bills, refunds, Apply/Refund buttons. Fixed: creating credit notes failed; **payments were counted twice** when a paid invoice/bill was edited; partial updates (Retry) were rejected |
| Report shell | N-01 N-02 N-06 N-09 N-11 I-18: one fiscal-aware period for all reports, compare previous period / last year, shareable link, Print/PDF; `npm run scaffold:report -- Name` (the scaffold script was broken and works again) |
| Banking 2 | L-92 + Y-08: bank connections belong to the workspace, expired bank logins can be reconnected · K-20: Undeposited Funds + "Make deposit" · Y-03: saved CSV column layouts per bank |
| Bulk import | K-01 (= M-18 BK-01 BK-05 BK-06 CA-11): Settings → Import Data — customers, vendors, items, accounts from CSV/Excel; columns matched by name; every row checked, all or nothing; duplicates skipped; items' opening stock posted; undo keeps records already in use (12 tests) |
| Period close 1 | R-01 R-02 R-03 R-08 R-10 BA-15: one lock rule (hard close, soft close for bookkeepers, partial unlock) in database + server + screens; close / reopen (reason; owner for hard) / unlock only through the server, audited; checklist with sign-offs; drafts block the close. Fixed: the close screen never loaded invoices/bills/bank lines; a lock on the 28th closed the month; "clear lock date" only changed the screen; bookkeepers could close months (11 tests) |
| Notifications | S-01 S-03 S-04 S-06 S-14 S-19 + bounces: real notifications from the server (one per person, stored in the database, live bell): invoice emailed, invoice overdue (daily), customer payment received, email bounced / marked spam, bank connection expired, person invited / joined. Each person marks their own read and chooses which types they get (bell → gear). Only their own are visible (database rules tested). **The old bell showed made-up alerts kept only in the open page** |
| Trust 2: privacy and errors | L-10: Settings → Security → "Download my data" (profile, workspaces and roles, notifications, sign-ins, own audit entries; tested). L-14: crashes inside a screen are now reported too (the view boundary caught them silently); browser errors were already stored with a daily digest. BJ-04 BJ-06 BJ-08 BJ-09: `docs/privacy/` — personal data inventory, retention, sub-processors, DPA template (for a lawyer to review). AD-02: guard test that effects starting timers clean them up |
| Trust 1: deleting and restoring | L-07 L-09 L-124 L-130: a backup now holds the whole books (credit notes, vendor credits, bank lines, journal entries, purchase orders, employees, pay runs, numbering… were missing) and restoring it brings the trial balance and documents back exactly (database test); a backup can't rewrite closed periods. Deleting a workspace removes its data from every table (bank connections with their tokens, API keys, members, notifications… were left behind), with a guard so a new table can't be forgotten; the audit trail stays. Deleting an account hands shared workspaces to another owner or stops and says who to make owner first, schedules workspaces only you use for deletion (30 days), and removes personal data (tested). "Undo deletion" could never run: the backup import used the same address; it has its own now, with a "Keep this workspace" banner, and a guard test finds any two routes on the same address (it also found reports mounted twice). The Security screen's instant "purge" (wiped the books at once, no recovery) is now the 30-day "Delete workspace"; instant clearing is for demo data only |
| Accessibility 2 | E-23 E-27: an invoice can be opened, filled in and saved with the keyboard only (browser test); 45 clickable rows/headers/menus answer Enter and Space or are marked as plain containers. Text contrast checked by axe on 6 screens in light and dark (new browser test with a baseline that may only go down): failures went from 5–44 per screen to 0–4. Causes fixed (**L-129**): `dark:` styles followed the computer's setting instead of the app's theme; the accent colour was the same in both themes (brass text about 2:1 in light); muted grey text just under the minimum in both themes |
| Dates and errors | I-12: dates on screen follow Preferences → Date Display Format (it changed nothing before: **L-128**), with "Oct 02, 2026" as a choice and the default; inputs and files stay YYYY-MM-DD (tested in 3 time zones). BO-07: failed saves and loads say what happened and what to do (closed period → reopen in Month-End Close, no permission → ask an owner, session ended, offline, duplicate, unbalanced, invalid…) instead of "SYSTEM ERROR: CREATE" and a database message (tested) |
| Accessibility 1 | E-02 E-03 E-07 (most) E-04 E-22 E-29: 142 form labels are now linked to their fields (`Labelled`, unique id per field, same look; done by a codemod), icon-only buttons and switches have names, empty action-column headers say "Actions", backdrops are no longer fake focusable buttons; every keyboard-focused control shows a ring; "Skip to content" is the first Tab stop (it was skipped: the sub-navigation's scrollIntoView moved the browser's Tab starting point); browser test. Lint warnings 2,612 → 2,420 |
| Loading and confirmations | I-01 I-02 I-05 I-07 I-08 (AA-02): one data status line above every screen says what is loading, what failed to load (with "Try again") and which lists are cut at their limit (the old banner said "2,000 of N"); Sales, Purchases, Payments, Credit notes, Estimates, Recurring and Data Health show "Loading…" instead of "nothing here" (Data Health said "Everything checks out" before checking); guard test. Void and delete name the record and ask first (voiding an invoice happened on one click); Delete only on draft bills (the database refuses the rest). Invoice and bill dialogs ask before discarding unsaved changes. Removed the "seed demo data" button that wrote 20 fake records into a real workspace (**L-127**) |
| Money dialogs | H-01 H-02 H-03 H-04: component tests (jsdom + Testing Library, `src/tests/*.test.tsx`) for the invoice, bill, payment and bad debt dialogs check what each saves or sends: lines, tax on top or included, totals, numbers kept on edit, approval limit, allocations, refusals. Fixed **L-125** (invoice dialog: a customer typed but not on the list was saved as a made-up customer id; editing wiped the memo, terms and email text; currency defaulted to USD in any workspace) and **L-126** (payments: "apply" paid the newest invoices first, and drafts were offered though the server refuses them) |
| Speed at scale | C-14 C-16 (C-15, AA-06 partly): screens ask for the data they read (`useLedgerCollections`); the ledger and chart of accounts load when a workspace opens, everything else the first time a screen needs it, then stays live; a guard test fails if a screen reads data without asking. Live lists now fetch **only the rows that changed** (by `updated_at`), not the whole list after every edit (tested on a fake database). Fixed **L-121**: balances and reports used only the last 12 months of entries, and invoices/bills loaded only on a few tabs (Reports, Data Health and the dashboard saw none or an old copy); editing a document whose list wasn't loaded now reads it from the database instead of posting a partial one. Removed 6 listeners nobody read and **L-122** (a writer that failed on every balance change) |
| Data health | Z-07 Z-08 Z-09 Z-10 Z-14 Z-15 Z-32: Data Health now runs 11 checks from one list (`src/lib/dataChecks.ts`): entries that don't balance (with exchange rates), lines on missing accounts, duplicate invoice numbers, the same vendor bill entered twice, future-dated entries, empty invoices or lines without an account, overpaid invoices, foreign documents at rate 1, negative stock, recurring schedules with problems, invoices long overdue; each says what to do and opens the record. **Links to any record** (`#sales/invoice/<id>`) open the screen and highlight it (transactions open directly). Invoices and bills can now be **edited from the lists**. Fixed **L-120** |
| Tax 2 | T-03 T-06 T-07: the Tax return screen shows 9 boxes in the home currency (tax on sales, reverse-charge tax due, total due, reclaimable, net to pay, sales and purchases excluding tax, zero-rated and exempt sales), sales and purchases by treatment, and "File this return" (owners/accountants) keeps an unchangeable copy on the server; later changes in that period show box by box. Reverse-charge bills post the tax as due and reclaimable. Fixed **L-118** (credit notes never reduced the tax owed) |
| Tax 1 | T-01 T-02 T-04: tax codes with parts (GST + PST), a part on top of the others (compound), and how the amount is reported (taxed, zero-rated, exempt, reverse charge, out of scope), edited under Taxes. Invoices and bills pick a tax code, prices with or without tax, and show subtotal, discount, each tax part and the total in the document's currency; the PDF too. Fixed **L-113** (tax added on top was never billed), **L-114** (server dropped discount / tax-inclusive / bill currency), **L-115** (every line posted to one account), L-116, L-117 |
| Recurring + POs | BE-03: recurring schedules can be paused, resumed and deleted; a recurring invoice now becomes a **draft invoice** to check and send (team notified); a recurring entry is posted only with real, balanced accounts, otherwise the schedule shows why. BE-11: purchase orders are saved, goods received are recorded on them, "Create bill" opens the bill filled from the order (received quantities), and the 3-way match compares all three. Fixed **L-111** (recurring invoices wrote blank-account entries with no workspace) and **L-112** (orders were never saved) |
| Online payments | K-11: the emailed invoice link lets the customer pay by card; Stripe's confirmation becomes a real payment (payment record, invoice paid, one ledger entry in the home currency into a "Stripe Clearing" account, team notified); replays ignored; overpayment stays as a credit. Fixed **L-109** (the old handler guessed accounts and kept no payment record) and **L-110** (payments on foreign-currency invoices were booked unconverted) |
| Reminders | BE-01 K-26: payment reminders emailed every morning on the days set in Settings → Emails & Reminders (workspace's own date, next step only, once a day); "Reminders on / No reminders" switch per customer. Fixed: **L-107 the "+" on a customer row saved an empty invoice** instead of opening the form; **L-108 every customer showed a made-up "Preferred Partner" label** |
| Email 1 | S-01 BL-01 BL-03 BL-05 BL-08 K-08: invoices and reminders emailed by the server (writers; drafts refused; invoice currency; PDF), templates per workspace with preview (Settings → Emails & Reminders), plain-text part, send log per invoice, bounce/complaint reports skip that address. **L-106: emailing an invoice never worked** (no login token sent); the three copies of the email-provider code are now one |
| Period close 4 | CA-03: repost check in Month-End Close (missing, doubled, left-over, wrong-amount entries) with Repost. **L-105 fixed: foreign-currency invoices, bills, credits and payments were converted twice in the ledger** (EUR 100 at 1.10 booked as 121.00) |
| Period close 3 | K-19: bad debt write-off keeps the sale (the old one voided the invoice **and** booked the loss: counted twice), base currency, reversal when the customer pays |
| Period close 2 | R-06: month-end depreciation run (one entry, catch-up, runs once). Fixed: **the Fixed Asset Register saved nothing** (assets and "posted" depreciation lived only in the open page) |
| Database rules | L-100 **time zone and fiscal year couldn't be saved** · L-101 **adding a customer failed** · L-102 **applying a chart-of-accounts template failed** (now done by the server) · guard test: every field the app saves must be allowed by the database (applied to Supabase) |

### New findings (added to the tracker)
- L-91 Fake "success" endpoints: POST/GET /api/v1/ecommerce, marketing, helpdesk, hr,
  manufacturing, universal-ops echo made-up data (used by the API Hub demo). Decide: delete
  or label as demo (shortcut 9).
- L-92 Plaid bank connections are stored per user, not per workspace; /sync returns all of
  a user's banks. Fix with the banking prompt.
- L-94 Invoice postings are built in the browser and the server checks them (balanced,
  accounts in the workspace, period open, role) but doesn't recompute them from the invoice.
  Later: build invoice/bill postings on the server (document engine, shortcut 2).

### Next (in order)
1. ~~Report shell~~ done (N-08 cash vs accrual, N-03 period columns, N-10 column chooser: later).
2. ~~Credits, refunds, quick payment~~ done → banking (all done; CA-05 finance books later) → period close → notifications/email → tax
   depth → data-health checks → speed at scale → forms → trust & compliance → clean-up.
3. Then QUALITY, then the 488 LATER items.

## Vercel status (2026-09-24, Claude has Vercel access)

- Project `ledgerflow` (prj_C93KYrrMjnqgmYzHKC3gcnYZkekg) builds and deploys this branch:
  **https://ledgerflow-one-pearl.vercel.app** (Vercel login required for now: deployment protection).
- Set by Claude: `NODEJS_HELPERS=0`, `SESSION_SECRET`, `INVITE_SECRET`, `CRON_SECRET`, `SYSTEM_SALT`
  (random; generated in this session; replace SYSTEM_SALT before real data if wanted).
- Stripe / currency / tax keys are optional now (features say "not set up yet").
- The Claude Vercel connection can't link GitHub, read build logs or open the site (team scope);
  deploys are triggered by Claude directly from the branch.

## Your steps (about 5 minutes)
1. **Connect the database:** Vercel → project ledgerflow → **Storage** → Connect Database → pick the
   Supabase **ledgerflow** database → Connect (Production + Preview). This adds POSTGRES_URL,
   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_JWT_SECRET. Then tell Claude → redeploy.
   Without it the API part of the site stops at startup ("database URL missing").
2. **Connect GitHub** (so pushes deploy by themselves): Settings → Git → Connect → shmuelbiller1/ledgerflow.
3. **Supabase sign-in URLs:** supabase.com → ledgerflow → Authentication → URL Configuration →
   Site URL `https://ledgerflow-one-pearl.vercel.app`; Redirect URLs add
   `https://ledgerflow-one-pearl.vercel.app/**` and `http://localhost:3000/**`.
4. Optional: re-authorize the Claude Vercel connection for the whole account ("shmuelbiller-1426's
   projects" scope) so Claude can read build/runtime logs and link GitHub itself.
5. Before real users: custom SMTP sender in Supabase (built-in one sends only a few emails/hour).
6. Leftover settings from the old example file (FIREBASE_PROJECT_ID, SQL_*, JWT_SECRET) are unused
   and can be deleted.

## Next after the deploy works
1. Smoke test on the live address: sign up, confirm email, create a workspace, invoice, report.
2. PROMPT K3 and PROMPT R (below) — now done by me directly.
3. Launch list as before (THE FASTEST WAY).

## Found during the migration (added to the tracker)
- L-81 **SECURITY** workspace restore (`POST /api/v1/workspaces/:id/restore`) writes backup rows by
  their own ids with merge: a crafted backup could overwrite another workspace's document with
  the same id. Fix: refuse ids that exist in another workspace (or re-key them).
- L-82 Remove the AI Studio "IAM" fallbacks left in server.ts (`isIamConstraintError`, 7 places)
  and billingRoutes (now dead code on Postgres).
- L-83 Database TLS: set `DATABASE_CA_CERT` (Supabase dashboard → Database → SSL certificate) so
  the server verifies the database certificate (today: encrypted, not verified).
- L-84 Custom SMTP sender before launch (see E).
- L-85 Two-step login management: show "on/off", remove an authenticator, recovery codes.
- L-86 Move `lf_ws_role`, `lf_mfa_ok`, `lf_assert_table` to a private schema (Supabase advisor
  warns they're callable; they only reveal the caller's own role / status).
- L-87 Large lists sort by `data->field` (jsonb), so the date indexes help filtering but not
  sorting; fine at launch sizes; revisit with C-14/C-15 (load per screen and by date).

# THE FASTEST WAY: 705 open items → about 12 prompts to launch

Counted from the list below (2026-09-24). Most of the 864 items came from comparing
LedgerFlow with 12 big open-source products, so they describe **everything any accounting
product has ever had**, not what your first customers need.

| Bucket | Open items | How it gets done |
|---|---|---|
| **LAUNCH**: needed before the first paying customers | **112** | ~11 big prompts (below) |
| **QUALITY**: `any`, big files, array keys, accessibility labels, component tests | **105** | one "before launch" batch, mostly by **tools** (eslint --fix, codemods, the Field layer, the registry test), not one by one |
| **LATER**: build only when a customer asks | **488** | not now. Kept as a backlog. When a customer asks for something, it becomes 1 prompt (often just config, once the engines exist) |

Biggest "later" groups: 32 extra ERP tools (CA) · 31 extra features (K) · 31 banking/contacts
extras (Y) · 30 API/integrations (Z) · 29 extra reports (CB) · 20 entities (M) · 16 industry
verticals (BI) · 16 invoice-ninja features (CC) · 14 enterprise SSO etc. (P) · payroll (U 11),
projects (V 9), fixed assets (X 9), inventory depth (W 8).

## The 11 launch prompts + 1 clean-up (in order; each closes 4–22 items)

| # | Prompt | Items |
|---|---|---|
| 1 | **K2** (ready): date bug, items on invoices, automatic COGS, Sales by Item, Journal Sheet | L-79 · W-03 · K-02 · M-01 · J-07 · J-12 |
| 2 | **Report shell** (shortcut 4 core): one shell with date presets, compare to previous period/year, cash/accrual, as-of, PDF + permalink; move existing reports onto it; `scaffold report <Name>` generator | N-01 N-02 N-06 N-08 N-09 N-11 · J-06 J-09 J-11 J-13 |
| 3 | **Credits, refunds, quick payment** (easy now that customer/vendor screens are shared) | K-09 K-10 BA-09 BA-10 BA-11 BA-12 BA-13 |
| 4 | **Banking**: payment reconciliation, split a bank line, match one line to many invoices, saved CSV column maps, bulk import, undeposited funds, feed re-auth | CA-01 CA-05 Y-03 Y-08 Y-09 Y-10 K-01 K-20 |
| 5 | **Period close**: checklist + sign-off, soft/hard close, lock by role, partial unlock, depreciation run, unposted drafts, repost ledger, bad debt | R-01 R-02 R-03 R-06 R-08 R-10 BA-15 CA-03 K-19 |
| 6 | **Notifications + email** (small event bus): invoice sent/overdue, payment received, bank feed down, invites, opt-out, bounces, send log, templates, reminders/dunning, payment links, recurring pause, PO → bill | S-01 S-03 S-04 S-06 S-14 S-19 · BL-01 BL-03 BL-05 BL-08 · K-08 K-11 K-26 · BE-01 BE-03 BE-11 |
| 7 | **Tax depth** (your market decides which): compound tax, tax groups, reverse charge, zero-rated vs exempt, return boxes, filed-return snapshot | T-01 T-02 T-03 T-04 T-06 T-07 |
| 8 | **Data-health checks** (shortcut 11): duplicate invoice/bill numbers, future-dated, empty invoices; deep links to any record | Z-07 Z-08 Z-10 Z-14 Z-32 |
| 9 | **Speed at scale**: load data per screen and by date, not everything at login | C-14 C-15 C-16 AA-06 |
| 10 | **Forms and screens users touch** (shortcut 7 Field layer + loading/error/empty states + money-modal tests) | I-01 I-02 I-03 I-07 I-08 I-12 · BO-03 BO-07 · E-02 E-03 E-04 E-07 E-22 E-23 E-27 E-29 · H-01…H-04 |
| 11 | **Trust & compliance**: backup restore test, retention, account deletion, GDPR export, error reporting, status page, i18n decision, onboarding, deposit rule, tax recompute `--apply`, dependency fixes | L-06…L-10 L-14 L-17 L-18 L-19 L-80 · BJ-04 BJ-06 BJ-08 BJ-09 · B-01 B-05 B-06 · AD-02 AE-04 AF-03 |
| 12 | **Before-launch clean-up** (tools do most): ESLint gate back on, `any` removal, protect `main` | QUALITY bucket + L-67 |

## Three more ways to go faster

1. **Chain prompts, and check with me less often.** GitHub shows a ✔ or ✖ next to each commit.
   If it's ✔, paste the next prompt straight away. Come back to me when it's ✖, or every 2–3
   prompts. I'll keep the next 2 prompts ready at the top of this file.
2. **Generators instead of AI-written boilerplate.** `scripts/scaffold.js` already creates
   plugins and algorithms. Prompt 2 adds `scaffold report <Name>` (view + pure function +
   test + registry entry), and later `scaffold entity <Name>` (the 7 places). Boilerplate
   then costs zero AI usage and never forgets a place.
3. **Optional: one AI instead of two plus a relay.** Right now it's you → Gemini in AI Studio
   (no git, can't run the rules or browser tests) → GitHub → me checking → next prompt. I can
   also make the changes directly in this repository, run all 7 checks including rules and
   E2E, and push. That removes the copy-paste and the "old copy" problems. The trade-off is
   that it uses your Claude usage instead of Gemini. Your choice. Staying as-is works fine too.

---

## The 15 shortcuts — status

| # | Shortcut | Status |
|---|---|---|
| 0a | CI running | ◐ build mode; only the new time-zone step is red, a real bug — PROMPT K2 Part 0 (tested) |
| 0b | Ratchet | ✔ all 10 numbers measured for real (incl. server.ts, untested views: 77) |
| 0c | AI endpoint | ✔ real AI, login first, workspace required, credits + refunds, no invented data, chat + blueprint |
| 1 | Customer/vendor mirrors | ◐ aging report shared; lists and detail pages separate (fine for now) |
| 2 | Document engine | ☐ |
| 3 | Entity framework | ◐ `defineEntity` exists, used by the registry; generates nothing yet |
| 4 | Report engine + shell | ◐ `PartyReportLayout` + report math in `computeReports.ts` with tests; next: one shared shell (compare, export, permalink) |
| 5 | Event bus | ☐ |
| 6 | `useCollection` data hook | ◐ 1 screen (Audit Log) |
| 7 | Field / SchemaForm | ◐ 1 screen (Chart of Accounts) |
| 8 | Registry smoke + accessibility | ✔ every view mounts and passes its accessibility limit |
| 9 | Delete / defer decisions | ⏸ **waiting for you** (~71 items) |
| 10 | Mechanical cleanup via ratchet | ◐ (22 Oct, `quality-baseline.json`) `any` 1,287 → **50** · UTC dates 40 → **35** · array keys 64 → **0** · console.log 8 → **0** · files > 800 lines 15 → **0** · views without a registry smoke test 77 → **44** (the one still open) |
| 11 | Data-health checks registry | ☐ |
| 12 | Import adapter registry | ☐ |
| 13 | Money display | ✔ one rule (`formatCurrency` takes cents), guard test bans `/100` |
| 14 | Algorithm registry | ◐ **52 algorithms already registered** (I said 5 earlier — that was wrong) |
| 15 | AI-built tools | ✔ first slice done: rules builder safe, server rejects unknown categories, tested |

## The full list — 864 items

| Part of the list | Done | Partly | Total |
|---|---|---|---|
| Fixes & safety (A, B, C, AA–AI, L) | **144** | 4 | 172 |
| Code quality (D–I) | 6 | 4 | 143 |
| New features (J onward) | 10 | 3 | 549 |
| **All** | **160** | **11** | **864** |

```
PROMPT K3 — Finish K2: fix 2 one-line errors, automatic cost of goods sold, make the 2 new
reports correct and tested.
You are the one editing the code (AI Studio, no git). Do the parts in order.

BUILD MODE: only real safety checks block (type check, tests, build). ESLint warnings
don't. Don't add new `any` (the quality counter test fails on it).
CHECKS — light: while working, only the test file you changed
(npx tsx --test src/tests/<file>.test.ts). ONE full check at the very END, and it must pass:
  npm run lint:types && npm run build && npm test 2>&1 | grep -E "^# (tests|pass|fail)|not ok"
Fix a failure, then re-run only that check. Never `sleep`. Skip test:rules / test:e2e.
RULES: edit files as they are now · npm only · delete bun.lock if it's the only failure ·
never change existing tests' numbers · never raise quality-baseline.json · AGENTS.md: every
report filters with isPostable() and sums with lineAmount(); money via documentMath;
accounts via resolveAccountRole; show money with formatCurrency(cents), never /100.

===== PART 0 — CI is red (2 tiny fixes) =====
0a. src/components/reporting/SalesByItemReportView.tsx:3 — add `cn` to the import from
    '../../lib/utils' (it's used on line 136; without it the report crashes).
0b. src/components/reporting/JournalSheetReportView.tsx — `(tx: any)` (~line 83) and
    `(line: any, lIdx: number)` (~line 122): remove the `: any` (TypeScript infers the type).

===== PART A — finish items on invoice lines =====
A1. src/components/sales/InvoiceModal.tsx datalist option text (~line 415) shows a stray "$"
    and divides by 100. Make it:
      {i.sku ? `[${i.sku}] ` : ''}{i.name} · {formatCurrency(i.unitPriceCents)} · stock {i.quantityAtHand}
A2. Move the "picked an item → fill the line" logic into a pure function
    applyInventoryItem(line, item) in a new src/lib/invoiceLines.ts (sets itemId, rateCents,
    unitCostCents, amountCents = Math.round(quantity × unitPriceCents)) and call it from the
    modal. When the inventory list is empty, show "No items yet — add one in Inventory"
    under the field.
A3. Test src/tests/invoice-lines.test.ts: applyInventoryItem fills the line; a free-text
    line (no item) is unchanged; quantity 3 × 1250 → 3750.

===== PART B — automatic cost of goods sold (W-03) — unchanged from K2 =====
B1. src/server/routes/inventoryRoutes.ts POST /cogs (line 14): accept optional
    sourceInvoiceId and sourceLineId (zod) and store them on the ledger transaction as
    metadata.cogsForInvoiceId / metadata.cogsForLineId.
B2. New src/services/cogsService.ts → postInvoiceCogs(invoice, accounts, workspaceId):
    skip draft/void; for each line with itemId call POST /api/v1/inventory/cogs with header
    Idempotency-Key `${invoice.id}_${line.id}` and body { workspaceId, itemId, quantitySold:
    line.quantity, inventoryAccountId, cogsAccountId, date: invoice.date,
    sourceInvoiceId: invoice.id, sourceLineId: line.id }. Accounts: resolveAccountRole(a)
    === 'inventory' / 'cogs'. If either is missing, skip and show the toast "Add an Inventory
    and a Cost of Goods Sold account to record the cost of items sold". A non-whole
    quantity or a refused call ("Insufficient inventory stock") → don't block the invoice;
    set metadata.cogsPending = true on it. Call it in src/hooks/useEntityOperations.ts right
    after LedgerPostService.postInvoiceLedger(...) succeeds (lines ~114 and ~214).
B3. Invoices with metadata.cogsPending show a "Cost not recorded" badge in the invoice list
    with a "Retry" button (calls postInvoiceCogs again; clears the flag on success).
B4. Void: new POST /api/v1/inventory/cogs/reverse { workspaceId, invoiceId } in
    inventoryRoutes.ts (zod; owner/accountant/bookkeeper via getWorkspaceUserRole like
    paymentRoutes.ts). In ONE Firestore transaction: find the workspace's transactions with
    metadata.cogsForInvoiceId == invoiceId that aren't reversed yet, write a reversal for
    each (lines negated, metadata.reversesTxId) and add the quantity back to the item.
    A second call does nothing. Add the query's index to firestore.indexes.json. Call it
    from useEntityOperations when an invoice changes to 'void'.
B5. Tests (mock db like src/tests/payment-atomicity.test.ts): sell 3 at cost 400 → COGS
    +1200, inventory −1200, stock −3 · same key again → nothing new · reverse → reversed,
    stock +3, second reverse does nothing · no COGS account → skipped with the message ·
    not enough stock → cogsPending.

===== PART C — make the 2 reports correct + tested =====
C1. New src/server/reports/itemReports.ts:
    computeSalesByItem(invoices, items, transactions, start?, end?):
    - skip draft/void invoices; filter by invoice date
    - sales = toBaseCents(line.amountCents, inv.exchangeRate) (from partyReports.ts)
    - quantity as given (0 stays 0)
    - cost = the real COGS postings for that invoice line (transactions with
      metadata.cogsForInvoiceId / cogsForLineId, isPostable + lineAmount); if there are
      none yet, estimate quantity × unitCostCents and set costIsEstimate: true
    - lines without itemId → one "No item" row
    - returns rows (item, sku, qty, salesCents, costCents, marginCents, marginPct,
      costIsEstimate) + totals
C2. Same file: computeJournalSheet(transactions, accounts, start?, end?): keep only
    isPostable(tx) transactions (today drafts are counted); amounts via lineAmount(line, tx);
    returns one entry per transaction (date, description, lines with account name, debit,
    credit), totals, and the list of unbalanced ones.
C3. Both views call these functions (no math left in the screens). Sales by Item shows
    "(est.)" next to estimated costs. Use the theme colors other reports use (var(--surface),
    var(--line), var(--ink), …) instead of bg-white / text-neutral-*, so dark mode works.
C4. Test src/tests/item-reports.test.ts with every number checked by hand: 2 items + a
    "No item" line, one EUR invoice at 1.1, a draft and a void invoice (ignored), one line
    with real COGS postings and one estimated; a balanced journal, an unbalanced one, and a
    draft transaction that must not appear.

===== REPORT =====
The final check (type check, test count, build), then per part "done" or what's left.
```

### Ready after K3 — PROMPT R (report shell: launch prompt #2)

```
PROMPT R — One report shell: real dates, compare, permalink, print; plus a report generator.
You are the one editing the code (AI Studio, no git). Do the parts in order.
BUILD MODE: only real safety checks block (type check, tests, build). ESLint warnings
don't. Don't add new `any` (the quality counter test fails on it).
CHECKS — light: while working, only the test file you changed
(npx tsx --test src/tests/<file>.test.ts). ONE full check at the very END, and it must pass:
  npm run lint:types && npm run build && npm test 2>&1 | grep -E "^# (tests|pass|fail)|not ok"
Fix a failure, then re-run only that check. Never `sleep`. Skip test:rules / test:e2e.
RULES: edit files as they are now · npm only · delete bun.lock if it's the only failure ·
never change existing tests' numbers · never raise quality-baseline.json · AGENTS.md: every
report filters with isPostable() and sums with lineAmount(); show money with
formatCurrency(cents), never /100.


R1. Dates for every report: src/components/reporting/Reports.tsx already has a period picker
    (year / quarter / month, "timeframe"). Turn it into { startDate, endDate } in one pure
    function getReportPeriod(timeframe, year, quarter, month, fiscalYearStartMonth) in
    src/lib/fiscalCalendar.ts (fiscal-aware, reuse getFiscalYearBounds). Pass startDate,
    endDate and asOfDate (= endDate) in `standardProps` (Reports.tsx ~line 303) to every
    report. Reports that already accept startDate/endDate (SalesByItem, JournalSheet,
    Customer/Vendor summaries, Transactions by Customer/Vendor, Tax liability) use them.
R2. Compare to: none / previous period / same period last year (N-01, N-02). New pure
    function getComparePeriod(startDate, endDate, timeframe, mode) in fiscalCalendar.ts,
    calendar-aware: month → previous month, quarter → previous quarter, year → previous
    fiscal year, "last year" → same dates one year earlier. Don't use getPrevPeriod for this:
    it counts days, so the month before March comes out as Jan 29–Feb 28. Pass
    compareStartDate / compareEndDate in standardProps. P&L and Balance Sheet: when compare
    is on, add "Previous" and "Change" columns (amount and %), computed with the same
    functions they already use (computeProfitAndLoss / computeBalanceSheet in
    src/server/reports/computeReports.ts).
R3. Permalink (N-11, I-17): keep report tab, year, timeframe, quarter/month and compare in
    the URL query (e.g. ?report=pnl&y=2026&t=quarter&q=2&cmp=prev). Opening that link
    restores them.
R4. Print / PDF (N-06, I-18): a "Print / Save as PDF" button → window.print(), plus print CSS
    that hides the sidebar, navigation and buttons and prints the report title + period.
R5. Generator: extend scripts/scaffold.js with `report <Name>` that creates
    src/server/reports/<name>.ts (pure function stub), src/components/reporting/<Name>View.tsx
    (PartyReportLayout skeleton that calls it), src/tests/<name>-report.test.ts (a small
    passing test of the stub), and prints the 2 lines to add to REPORT_COMPONENTS and
    REPORT_TABS_REGISTRY. Add "scaffold:report": "node scripts/scaffold.js report" to package.json.
R6. Tests: getReportPeriod and getComparePeriod (month, quarter, year, last year, a fiscal
    year starting in April, February in a leap year); URL → state → URL round trip; P&L
    "Previous" numbers on a fixture spanning two years.
REPORT: the final check, then per part "done" or what's left.
```

**How to use it:** paste only the K3 box. When GitHub shows ✔ for it, you can paste PROMPT R
straight away without checking with me first. Come to me when it's ✖, or after R.

**Build mode** (decided 2026-09-24): type check, tests, build, rules and E2E block. ESLint
doesn't until launch.

**BEFORE LAUNCH (not now):** remove `continue-on-error` from the ESLint step and fix the
warnings: shared typed mock in `src/tests/helpers/mockFirestore.ts` for
`payment-atomicity` / `reconcile-endpoint` tests; `any` in `auditFormat.ts`, `server.ts`
writeAuditLog, `handleReconcile`. Then protect `main` (L-67).

**Not for your AI — for you (GitHub website):** the open dependency PRs — merge #25 (25 small
updates) once its CI is green; close #2 (`@types/node` 26 doesn't match Node 24); leave #3
(express) and #4 (plaid) for later. And protect `main` (L-67).

---

# EXACT TASK CARDS — what to do, file by file

Every card says **why**, **where** (file:line, checked against `origin/main` @ `2ae1baf`),
the **exact change**, and **done when** (a command and what it must print). Paste the
wrapper once, then 1–5 cards under it. Smaller prompts = fewer mistakes.

```
WRAPPER — paste at the top of every prompt
- FIRST: git pull origin main. Edit the files as they are now; never paste whole files
  from memory or an earlier conversation.
- npm only (never bun). Follow AGENTS.md: money through isPostable() / lineAmount() /
  documentMath; accounts via resolveAccountRole(); top-level collections + workspaceId.
- Never change a test's inputs or expected numbers. Never raise quality-baseline.json,
  --max-warnings or e2e/a11y-baseline.json.
- Do ONLY the cards below. `git diff --stat` must list only the files the cards name.
- Before pushing, run and paste the result of each:
  npm ci · npm run lint:types · npm run lint:eslint · npm test · npm run build ·
  npm run test:rules · npm run test:e2e
```

## Batch 1 — makes CI fully green ✔ DONE (7160b13 + 9f9c419)

**CARD 1.1 — Test helpers must set `createdAt`** (3 type errors)
- Where: `src/tests/fixtures.ts` — `makePayment` (line 56), `makeCreditNote` (74), `makeVendorCredit` (88).
- Change: in each of the three, add this line directly **above** `...overrides`:
  ```ts
      createdAt: '2026-01-01T00:00:00.000Z',
  ```
- Done when: `npm run lint:types` → no errors.

**CARD 1.2 — Remove the 34 `as any` casts from tests** (ESLint over the limit)
- Where: `src/tests/report-contract.test.ts` lines 22, 55, 195, 211, 227, 243, 253, 281, 294,
  306, 315, 319, 324 · `src/tests/reports-math.test.ts` lines 16, 21, 29, 34, 38, 63, 78, 82,
  86, 103, 106, 109, 122, 125, 128, 142, 146, 149, 160, 163 · `src/tests/document-math-tax.test.ts` line 158.
- Change: wrap every object in the matching helper from `src/tests/fixtures.ts`
  (`makeCustomer`, `makeVendor`, `makeInvoice`, `makeBill`, `makePayment`, `makeCreditNote`,
  `makeVendorCredit`, `makeChartAccount`, `makeTransaction`), give the array a real type, drop the cast:
  ```ts
  // before
  const mockCustomers = [
    { id: 'cust-1', name: 'Acme Corp', email: 'acme@example.com', phone: '555-0101' },
  ] as any[];
  // after
  const mockCustomers: Customer[] = [
    makeCustomer({ id: 'cust-1', name: 'Acme Corp', email: 'acme@example.com', phone: '555-0101' }),
  ];
  ```
  At the top of each test file add the imports it needs, e.g.
  `import { makeCustomer, makeInvoice, makePayment } from './fixtures';` and
  `import type { Customer, Invoice, Payment } from '../types';`.
  `document-math-tax.test.ts:158`: the literal has `totalCents`, a field Invoice dropped on
  purpose and nothing reads. Pass `makeInvoice({ id: invoice.id, date: invoice.date,
  amountCents: invoice.amountCents, salesTaxCents: invoice.salesTaxCents, status: invoice.status })`.
  Same values, same expected numbers.
- Done when: `grep -c "as any" <each file>` → 0 · `npm test` → all pass.

**CARD 1.3 — Saved-view chip: no button inside a button** (Overview accessibility)
- Where: `src/components/ui/SavedViewsBar.tsx` lines 84–138.
- Change (3 edits):
  1. On the outer `<div key={view.id}` delete `role="button"`, `tabIndex={0}`, `onClick={...}`
     and the whole `onKeyDown={...}` block. Keep its `className`.
  2. Right after that div's opening `>`, open a real button around the icon + text:
     ```tsx
     <button
       type="button"
       aria-pressed={isActive}
       onClick={() => setActiveView(isActive ? null : view.id)}
       className="flex items-center gap-2 text-left"
     >
     ```
  3. Close it with `</button>` just before the existing star `<button type="button"` — so the
     star button becomes a sibling, not a child.
- Done when: `npm run test:e2e` → "Navigate and mount view: Overview" passes.

**CARD 1.4 — Lower the warning limit**
- Where: `package.json` line 16 (`"lint:eslint": "eslint . --max-warnings 2816"`).
- Change: after 1.2 and 1.3, run `npx eslint . 2>&1 | tail -1`, put that number in place
  of 2816 (it must be ≤ 2808), then run `npm run ratchet:update`.
- Done when: `npm run lint:eslint` passes; both GitHub CI jobs green.

## Batch 6 — ✔ DONE in cdd1f46 (leftovers moved into Prompt L Part 2)

**CARD 6.1 — Remove the unused endpoint** (fixes both CI failures)
- Where: `src/server/routes/transactionRoutes.ts` — delete the whole
  `transactionRouter.post('/bank-lines/:id/unmatch', …)` block added in `5119ad2`, and its
  `import { requireWorkspaceRole } from './workspaceRoutes';` line if 6.2 doesn't use it.
- Done when: `npm run lint:eslint` passes (≤ 2803) and `npm test` → 324/324.

**CARD 6.2 — Harden the real reconcile endpoint** (`transactionRoutes.ts:657`, `POST /reconcile`)
- a. Role: add `requireWorkspaceRole(['owner', 'accountant', 'bookkeeper'])` as middleware
  (import from `./workspaceRoutes`) — viewers get 403.
- b. Locked period: after loading each bank line and transaction the operations touch, if
  its `date` is on or before the workspace `lockDate`, return
  `400 { error: 'This period is locked' }` and write nothing.
- c. Audit: in the same batch, write one `auditLogs` entry per call with the standard fields
  `{ workspaceId, uid, action: 'reconcile' (or 'reconcile_undo' when a line goes back to
  pending), details, severity: 'info', timestamp }` — the fields `AuditLogViewer` reads.
- d. Types: use the existing authenticated-request type instead of `(req as any)`, and
  `catch (e)` with `e instanceof Error ? e.message : String(e)` — no new `any`.
- e. Tests (new `src/tests/reconcile-endpoint.test.ts` or the existing route tests):
  viewer → 403 · line dated inside a locked period → 400 · undo sets the bank line to
  `pending` + `matchedTransactionId: null` **and** the transaction back to `completed` ·
  one audit entry written.
- Done when: all 7 checks pass.

**CARD 6.3 — One local-date helper**
- `src/lib/utils.ts`: keep `getLocalDateISO` (line 142 — follows the workspace timezone).
  Replace every `getLocalDateIso` import/call with `getLocalDateISO` in: `sales/Sales.tsx`,
  `platform/settings/BackupExportSettings.tsx`, `platform/ToolSandbox.tsx`,
  `hr/PayrollView.tsx`, `banking/TransferModal.tsx`, `lib/paymentTerms.ts`,
  `lib/depreciationEngine.ts`, `lib/estimateConverter.ts`, `lib/creditNoteEngine.ts`.
  Then delete `getLocalDateIso` (line 397).
- Watch out: `src/lib/*` files are also used on the server, where there is no signed-in
  workspace — `getLocalDateISO` falls back to UTC there; pass the workspace timezone in
  from the caller when it's known (`formatTzDate(d, workspace.timezone)`).
- Done when: `grep -rn "getLocalDateIso" src` → nothing; all tests pass.

## Batch 2 — dates (now Prompt L Part 3, with updated line numbers)

`toISOString().slice(0,10)` is the UTC date: in the evening in the Americas it is already
"tomorrow". Browser code: use `getLocalDateISO()` from `src/lib/utils.ts` (it reads the
workspace timezone). Server code: load the workspace and use
`formatTzDate(new Date(), workspace.timezone)` from the same file.

**CARD 2.1 — Default dates on money documents (these change what gets posted)**
- ✔ done in 5119ad2: `Sales.tsx:105`, `TransferModal.tsx:46`, `PayrollView.tsx:48` (switch them to `getLocalDateISO` in CARD 6.3)
- `src/server/routes/paymentRoutes.ts:17` — payment date default (server)
- `src/server/routes/documentRoutes.ts:71` — document date (server)
- `src/server/services/pdfService.ts:13` — date printed on PDFs when missing (server)
- `src/server/reports/partyReports.ts:29` and `:109` — default report end date
- Done when: `grep -rnE "toISOString\(\)\.(slice\(0, ?10\)|split\('T'\)\[0\]|substring\(0, ?10\))"`
  no longer lists these files; add one test with `TZ=America/Los_Angeles` at 20:00 local that
  expects today's local date.

**CARD 2.2 — Parsing and helpers**
- `src/components/ledger/StatementImporter.tsx:199` and `src/lib/camt053Parser.ts:24` —
  imported bank dates must keep the date printed on the statement (parse `YYYY-MM-DD` as
  text; never go through `new Date(...).toISOString()`).
- `src/hooks/useLedgerData.ts:278`, `src/lib/trialManager.ts:11`,
  `src/lib/algorithms/expense-velocity.ts:92`, `src/lib/excelExport.ts:71` → `getLocalDateISO(d)`.
- Leave `src/lib/utils.ts:417` (it's the fallback inside `formatTzDate`).

**CARD 2.3 — Export file names (cosmetic, 9 files)**
`ForensicAuditor.tsx:105`, `QueryView.tsx:144`, `AuditTrailView.tsx:117`,
`MonthEndCloseView.tsx:253`, `PivotSheet.tsx:386`, `CustomerBalanceSummaryView.tsx:61`,
`VendorBalanceSummaryView.tsx:61`, `TransactionsByCustomerView.tsx:86`,
`TransactionsByVendorView.tsx:86` → `getLocalDateISO()` in the file name.
- Done when (after 2.1–2.3): `npm run ratchet:update` lowers `utcDateCount`.

## Batch 3 — small safety items (3.1–3.3 now Prompt L Part 4; 3.4 is for you on GitHub)

**CARD 3.1 — Server logging (L-12, L-13)**
- Create `src/server/utils/logger.ts` exporting `logger.info / warn / error(message, fields)`
  that prints one JSON line (`{ level, time, msg, ...fields }`).
- Replace the 8 `console.log` in `server.ts` (lines 880, 932, 936, 4526, 4543, 4558, 4568,
  4575) with `logger.info(...)`, keeping the same text as `msg` and ids as fields.
- Done when: `grep -c "console.log(" server.ts` → 0; ratchet `consoleLog` goes to 0.

**CARD 3.2 — Timers without cleanup (AD-01, AD-02)**
Check each `setTimeout` inside a `useEffect`; if the effect doesn't `return () => clearTimeout(t)`,
switch to the existing `useTimeout` hook (already used 24 times):
`platform/ConnectionBanner.tsx:19`, `platform/ApiHub.tsx:310`,
`platform/SystemCommandCenter.tsx:368`, `ledger/MagicEntry.tsx:33`,
`system/HealthCheckModal.tsx:34` and `:37`, `forensics/LedgerAutoAuditor.tsx:14`.
(The `await new Promise(r => setTimeout(r, …))` delays and `PdfPreviewModal.tsx:58` are fine.)
- Done when: no `setTimeout` in a `useEffect` without cleanup; add an ESLint
  `no-restricted-syntax` rule or a guard test that flags it (AD-02).

**CARD 3.3 — Time-zone test run in CI (L-05)**
- Where: `.github/workflows/ci.yml`, after the "Run Accounting & Security Test Suites" step.
- Add:
  ```yaml
      - name: Unit tests in two other time zones
        run: |
          TZ=Pacific/Auckland npm test
          TZ=America/Los_Angeles npm test
  ```
- Done when: both runs pass on GitHub.

**CARD 3.4 — Dependency updates (L-06)** — 4 open dependabot PRs
- #25 "bump the all group … 25 updates" — merge after CI is green on it.
- #2 `@types/node` 22 → 26 — close: types should match the Node you run (24).
- #3 `express` major and #4 `plaid` 42 → 47 — breaking; leave until a feature needs them.

## Batch 4 — tax edge cases (AE-04, AF-03, AF-04)

**CARD 4.1 — Tie-out fixture (AF-04)**: in `src/tests/document-math-tax.test.ts` add one
invoice with discount + retainage + tax-exclusive + EUR at 1.1; assert that
`calculateDocumentTax` (posting side) equals the Sales Tax report
(`computeTaxLiability`) and that the posted lines balance.

**CARD 4.2 — Decide `depositCents` (AF-03)** — your decision: is a deposit subtracted
before tax (it reduces the taxable amount) or after (it's a payment)? Normal practice: a
deposit is a **payment in advance**, so tax is on the full amount and the deposit reduces
the amount due only. Put that rule in `src/lib/documentMath.ts` with a comment and a test.

**CARD 4.3 — Recompute old tax (AE-04)**: `scripts/recompute-document-tax.ts`, run by hand:
lists every posted invoice/bill whose stored tax ≠ `calculateDocumentTax(doc)`, prints them,
changes nothing unless run with `--apply` (which posts an adjusting entry through
`LedgerPostService`, never edits the old entry). Dry-run by default.

## Batch 5 — bigger items (one card per prompt)

| Card | What | Where to start | Done when |
|---|---|---|---|
| 5.1 C-14 / C-15 / AA-06 | Stop loading everything at login; load by screen and by date | move listeners from `src/hooks/useLedgerData.ts` into screens via `src/hooks/useCollection.ts`, one screen per commit; invoices/bills/payments/bankLines/auditLogs get a `dateWindow` (default: current fiscal year) | login loads only workspaces + accounts + settings; truncation banner still works |
| 5.2 C-16 | Reference data read once, not live | chartAccounts, taxRates, currencies via one-shot `getDocs` in `useCollection({ live:false })` | fewer listeners in `useLedgerData.ts` |
| 5.3 C-17 | Firestore read counter in dev | wrap `onSnapshot` / `getDocs` in `useCollection` and count `docs.length`; show it in the dev status bar | number visible in dev, hidden in production |
| 5.4 C-20 | Load test | script that seeds 200k transactions into the emulator; record time-to-dashboard and reads | numbers written to `docs/perf.md` |
| 5.5 L-07 | Backup can really be restored | test: export a seeded workspace (`/api/v1/workspaces/:id/export`), restore into a new one (`/:id/restore`), compare trial balances | test in CI passes |
| 5.6 L-18 | Hebrew | `useUIStore.language` exists and registry labels have `he` — decide: finish (wrap remaining text) or remove the toggle | one clear state, no half-translated screens |

Prompt K (below, in NOW) is already written this way for the next features.

---

# FILE MAP — which files each kind of change touches

Paste the matching recipe into any prompt. It tells the AI exactly where to work, which
existing helpers to reuse, and which guard test will catch a mistake. All paths checked
against `origin/main` @ `4c712ee`.

## The files everything depends on

| File | Lines | What it's for | Rule |
|---|---|---|---|
| `src/types.ts` | 1,121 | every data type | single source of truth; new fields optional |
| `src/schemas.ts` | 504 | zod schemas, checked on the server | every new field goes here too |
| `src/constants/collections.ts` | 42 | `WORKSPACE_SCOPED_COLLECTIONS` | a new collection must be listed |
| `firestore.rules` | 526 | security rules | one `match` block per collection |
| `firestore.indexes.json` | 146 | query indexes | one index per where + orderBy shape |
| `src/config/registry.tsx` | 390 | every screen, report, setting | nothing shows until registered |
| `src/lib/txFilters.ts` | 391 | `isPostable()`, `lineAmount()`, `isOpenInvoice/Bill` | all money sums |
| `src/lib/documentMath.ts` | 88 | tax, net, `calculateAmountDue` | the only document money math |
| `src/lib/accountUtils.ts` | 62 | `resolveAccountRole()` (incl. `fx_rounding`) | never a literal account id |
| `src/lib/utils.ts` | 420 | `formatCurrency(cents)` — takes **cents** | never divide by 100 first |
| `src/components/ui/Money.tsx` | 58 | `<Money cents>` | preferred money display |
| `src/lib/fiscalCalendar.ts` | 143 | `getFiscalYearBounds` | default date ranges |
| `src/services/LedgerPostService.ts` | 1,060 | the one posting path → `/api/v1/transactions/bulk` | all postings |
| `src/kernel/ledger/LedgerEngine.ts` | 280 | FX conversion + balancing | |
| `src/hooks/useEntityOperations.ts` | 274 | `addEntity` / `updateEntity` (documents post through LedgerPostService) | use for CRUD |
| `src/hooks/useCollection.ts` | 147 | per-screen data loading | new screens load their own data |
| `src/hooks/useLedgerData.ts` | 598 | listeners loaded at login | don't add more; use `useCollection` |
| `src/hooks/useCurrentRole.ts` | — | role for hiding UI | pair with server/rules checks |
| `src/server/db/firestore.ts` | — | `validateWorkspaceMember` | every server route |
| `server.ts` | ~4,720 | server entry; routers mounted ~lines 4490–4521 | no new routes here (lint rule) |

## Recipes

**Add a report**
1. `src/components/reporting/<Name>View.tsx` on `PartyReportLayout.tsx` (later: the report shell).
2. Money: ledger lines → `isPostable` + `lineAmount`; documents → `calculateAmountDue`; show with `formatCurrency(cents)` / `<Money>`.
3. Register in `src/config/registry.tsx`: `REPORT_COMPONENTS` (lazy import) + `REPORT_TABS_REGISTRY` (id, en + he label, componentName, icon).
4. Test with a fixture in `src/tests/<name>-report.test.ts`. Screen mounting and accessibility are covered automatically by `e2e/view-registry-coverage.spec.ts`.
Guards: `postable-adoption-guard`, `money-format-guard`, `report-contract`, `reachability-guard`.

**Add a screen**
1. `src/components/<area>/<Name>.tsx`; loading/empty/error with `src/components/ui/EmptyState.tsx` (crashes are caught by `ViewErrorBoundary` automatically).
2. Register `VIEW_COMPONENTS` + `APP_TABS` (settings: `SETTINGS_COMPONENTS` + `SETTINGS_TABS_REGISTRY`).
3. Hide actions by role with `useCurrentRole` / `src/components/ui/RequireRole.tsx` — and enforce the same on the server/rules.
4. Add the view to `e2e/a11y-baseline.json`.

**Add a new kind of record (collection) — the 7 places**
Missing one of these caused the customers lockout and the missing-index bug.
1. `src/types.ts` — interface.
2. `src/schemas.ts` — zod schema, `.strict()`.
3. `src/constants/collections.ts` — add to `WORKSPACE_SCOPED_COLLECTIONS`.
4. `firestore.rules` — read: member · create/update: `canWrite` + `isValidId` + `affectedKeys([...schema keys])` · delete: draft only.
5. `firestore.indexes.json` — every query shape.
6. Loading: `useCollection` inside the screen (only if truly global: `useLedgerData.ts` — the rules-coverage guard checks both lists match).
7. `src/tests/rules/firestore.rules.test.ts` — add it to the collection table (owner can, viewer can't, other workspace can't).
Always top-level with `workspaceId`, never a subcollection.
Guards: `rules-coverage-guard`, `index-guard`, `schema-drift`, `validation-guard`.

**Add a field to an existing record**
`src/types.ts` (optional) → `src/schemas.ts` → that collection's `affectedKeys([...])` in `firestore.rules` → the form (`InvoiceModal.tsx`, `BillModal.tsx`, …) → `schema-drift` test.

**Add a server endpoint**
1. `src/server/routes/<area>Routes.ts` (`express.Router()`), body validated with zod (the `validation-guard` fails otherwise).
2. Login + `validateWorkspaceMember` + role check.
3. Mount in `server.ts` next to the others (~4490–4521).
4. Browser `fetch('/api/v1/…')` — the `route-contract` test fails if there's no matching route.
5. Money changes go through the ledger (transactions bulk), never by writing balances.

**Add an AI task**
1. `src/server/routes/aiRoutes.ts` — add to `AiTaskEnum` and `TASK_WEIGHTS`.
2. `src/server/services/aiBackendService.ts` — a `case` using `responseMimeType: 'application/json'` + `responseSchema`; on failure **throw**, never a made-up answer.
3. `src/services/aiService.ts` — the browser call. The task-list test fails if the lists differ.
4. Send field names and the user's words — never transaction descriptions or vendor names as instructions.

**Add a calculation (AGENTS.md pattern)**
`src/lib/algorithms/<name>.ts` implementing `AlgorithmDefinition` (`src/lib/algorithms/types.ts`) → register in `FINANCIAL_ALGORITHMS` (`src/lib/algorithms/index.ts`, 52 already) → `src/components/platform/ToolSandbox.tsx` builds the screen. No UI work.

**Post money**
Lines: debits positive, credits negative, sum 0 → `LedgerPostService` → `/api/v1/transactions/bulk`. Accounts via `resolveAccountRole`. Period lock is checked by `verifyLockDate` and the rules. FX via `LedgerEngine`.

**Show money**
`formatCurrency(cents)` or `<Money cents={…}/>`. Never `/100` in the UI (`(cents/100).toFixed(2)` only inside CSV text).

## Files per shortcut

| # | Shortcut | Build on (existing files) | Create | Register / guard |
|---|---|---|---|---|
| 1 | Customer/vendor mirrors | `sales/Sales.tsx`, `purchases/Purchases.tsx`, `sales/CustomerDetailView.tsx`, `purchases/VendorDetailView.tsx`, `sales/CustomerModal.tsx`, `purchases/VendorModal.tsx`, `reporting/PartyAgingReportView.tsx` (already shared), `src/config/partySides.ts`, `src/lib/creditNoteEngine.ts` | `common/PartyListView.tsx`, props `side` | `party-actions.test.ts` must stay green |
| 2 | Document engine | `src/lib/documentMath.ts`, `src/server/routes/documentRoutes.ts` (108, if/else chain), `src/server/services/pdfService.ts`, `sales/InvoiceModal.tsx` (629), `purchases/BillModal.tsx` (442), `sales/EstimatesView.tsx`, `purchases/PurchaseOrdersView.tsx`, `finance/CreditNotesView.tsx`, `ui/PdfPreviewModal.tsx`, `LedgerPostService.ts` | `src/config/documents.ts` (`defineDocument`), `common/DocumentEditor.tsx` | documentRoutes becomes a lookup by type |
| 3 | Entity framework | `src/lib/entityFramework.ts` (61, used by registry), `schemas.ts`, `collections.ts`, `common/SchemaForm.tsx`, `ui/TanStackDataGrid.tsx` | `scripts/gen-firestore.ts` — writes rules + index blocks between marker comments | test: regenerating gives no diff |
| 4 | Report engine | `reporting/PartyReportLayout.tsx` (166), the 4 new reports, `src/server/reports/computeReports.ts`, `src/lib/reportGenerators.ts` (370), `src/lib/excelExport.ts`, `ledger/PivotSheet.tsx`, `src/lib/TransactionQueryEngine.ts` (638); **18 screens each hand-build a CSV export** (search `text/csv`) | `src/lib/reports/defineReport.ts`, one `ReportShell` (dates, compare, export, print, permalink), one shared CSV helper | `REPORT_TABS_REGISTRY` |
| 5 | Event bus | `LedgerPostService.ts`, `useEntityOperations.ts`; audit-log writes in `server.ts`, `src/server/routes/transactionRoutes.ts`, `src/hooks/useLedgerData.ts`, `src/hooks/useTransactionActions.ts`; `src/stores/useNotificationStore.ts` (130); `src/server/services/emailService.ts` | `src/server/events/bus.ts` + subscribers (audit, notifications, webhooks, email) | one audit subscriber replaces the hand-written writes |
| 6 | Data hook | `src/hooks/useCollection.ts` (used by `admin/AuditLogViewer.tsx`), `src/hooks/useLedgerData.ts` (598) | — | one screen per commit; keep truncation flags |
| 7 | Forms | `common/Field.tsx`, `common/SchemaForm.tsx` (used by `ledger/ChartOfAccountsView.tsx`) | — | move one modal per commit; a11y baseline goes down |
| 8 | Registry tests | `e2e/view-registry-coverage.spec.ts`, `e2e/a11y-baseline.json` | a `help` field on registry entries | lower the baseline as screens are fixed |
| 10 | Ratchet | `scripts/quality-metrics.ts`, `quality-baseline.json`, `src/tests/quality-ratchet.test.ts` | — | `npm run ratchet:update` after every cleanup |
| 11 | Data-health checks | `src/modules/integrity/TruthEngine.ts`, `system/DataHealthView.tsx` (316), `ledger/MonthEndCloseView.tsx` | `src/lib/checks/defineCheck.ts` + one file per check | DataHealthView lists the registry |
| 12 | Importers | `src/lib/mt940Parser.ts`, `src/lib/camt053Parser.ts`, `ledger/StatementImporter.tsx` (667), `src/lib/ofx-exporter.ts` | `src/lib/importers/defineImporter.ts` | one wizard for every format |
| 13 | Money display | `src/lib/utils.ts` `formatCurrency`, `ui/Money.tsx`, `money-format-guard.test.ts` | — | banned: `formatCurrency(x / 100)` |
| 14 | Algorithms | `src/lib/algorithms/*` (52 registered), `platform/ToolSandbox.tsx` | one file per algorithm | `FINANCIAL_ALGORITHMS` |
| 15 | AI-built tools | `aiRoutes.ts`, `aiBackendService.ts`, `src/lib/rulesEngine.ts` (`dryRunRules`), `platform/settings/RulesSettings.tsx`, `AutoRuleSchema` in `schemas.ts` | per new kind: schema + server check + dry run | task-list test |

(Component paths above are under `src/components/`.)

---

# LEDGERFLOW — THE SHORT WAY

**723 open items → 14 build-once shortcuts + 179 individual items.**
Every number below was produced by a script run against `origin/main` @ `936add6`.

```
 418  absorbed by 13 build-once shortcuts   (each item becomes ~20–80 lines of config)
  71  removed — delete unused code, or decide not to build
  55  duplicates — the same work listed twice across sweeps
 179  remain individual — and most get cheaper once the shortcuts exist
```

## The idea in one paragraph

`AGENTS.md` already describes the right pattern for **algorithms**: write the math once,
register it in `FINANCIAL_ALGORITHMS`, and `ToolSandbox` generates the UI automatically.
That is why algorithms are cheap to add here. Nothing else in the codebase works that way.
Every entity, document, report, check, importer and notification is hand-built across 5–8
files, which is why each one costs a week and why the same bugs keep coming back
(customers lockout, missing index, orphaned modules). **Apply the pattern AGENTS.md
already uses for algorithms to everything else.** Then new capability costs config, not
code — and the bug classes disappear because nobody hand-writes the wiring any more.

## What the code shows (measured)

**Re-measured 22 Oct** (strategy audit `audit/STRATEGY_AND_SPEED_AUDIT_2026-10-22.md` §5, then AI #1): several numbers below had
gone stale; the corrected ones say how they were measured. Method for the pairs: non-blank trimmed lines after swapping
Purchases/Vendor/Bill/AP/payable for Sales/Customer/Invoice/AR/receivable; *ordered* = Python
`difflib.SequenceMatcher(autojunk=False).ratio()`, *distinct* = shared distinct lines / all distinct lines. **Rule from now
on: a refactor justified by a similarity or size number includes the command that produced it.**

| Finding | Number |
|---|---|
| `Sales.tsx` vs `Purchases.tsx` | ~~61% identical~~ → **21% ordered / 14% distinct** (774 vs 533 lines): not a strong case any more |
| `ARAgingReportView` vs `APAgingReportView` | ~~70% identical~~ → **already collapsed**: both are 5-line wrappers of one aging view |
| `CustomerDetailView` vs `VendorDetailView` | **84% ordered / 63% distinct** (190 vs 188 lines) — the strongest remaining mirror |
| `InvoiceModal` + `BillModal` + `JournalEntryModal` + `TransactionEditModal` | **2,530 lines** (799 + 727 + 763 + 241), four separate line-item editors; InvoiceModal vs BillModal **38% ordered** |
| 6 financial statement views | **3,438 lines**; every report builds its own table and export |
| `documentRoutes.ts` | an `if (type === 'invoice') … else if …` chain, not a lookup |
| Audit-log writes | **13 hand-written** across 8 files; no event bus exists |
| `useLedgerData.ts` | **24 listeners** in one hook, loaded on login for every view |
| `src/components/platform/` | ~~10,945~~ → **16,293 lines** — now *bigger* than the accounting core (`ledger/`, 14,562); `reporting/` is 18,109 |
| `SystemCommandCenter.tsx` | ~~1,783~~ → **380 lines**, still names `simulatedQueries` / `simulatedLogs` (4 places) |
| `eslint-plugin-react` | ~~not installed~~ → **installed** (`package.json`); array-index keys are at 0 |
| Built, not on a screen (22 Oct) | `PartyDetailView.tsx`, `config/partySides.ts` (the start of shortcut 1), `lib/entityFramework.ts`, `lib/taxRateDefaults.ts` are reachable **only through unused imports** in `Sales.tsx` and `registry.tsx` (the last 5 unused-import warnings). Wire them into a screen or delete them; then remove the imports |

The sales/purchases mirroring matters most: **every feature on one side has to be built
twice.** Credit notes and vendor credits, customer and vendor balance summaries,
transactions by customer and by vendor, sales and purchases by item — they're all pairs.

---

# STEP 0 — PREREQUISITES (do these before any shortcut)

**0a. The CI fix from the last answer.** Every shortcut below is a refactor. A refactor
without CI running is how the customers-lockout class of bug ships. Finish the four
lockfile steps first.

**0b. THE RATCHET — this is how "over time everything gets better".**

One test, one baseline file. Each commit may keep or improve every quality number, never
worsen it. You don't schedule a big cleanup; the numbers only go down, a little at a time,
whenever the AI touches a file.

```
Build a quality ratchet.

1. scripts/quality-metrics.ts — computes and prints a JSON object:
     anyCount            occurrences of `: any` / `as any` / `<any>` in src + server.ts
     utcDateCount        toISOString().slice(0,10) / .split('T')[0] outside tests
     arrayIndexKeys      key={i} | key={idx} | key={index} in src/components
     blankNoOpener       target="_blank" without rel noopener
     consoleLog          console.log in server code
     serverTsLines       wc -l server.ts
     filesOver800        source files over 800 lines
     orphanFiles         result of the reachability walk
     suppressionCount    eslint-disable / @ts-ignore / @ts-expect-error markers (renamed from eslintWarnings, 22 Oct)
     untestedViews       registered views not covered by the registry smoke test
2. quality-baseline.json — commit the current values.
3. src/tests/quality-ratchet.test.ts — runs the metrics and FAILS if any value is
   greater than its baseline. Print exactly which metric got worse and by how much.
4. npm script `ratchet:update` — rewrites the baseline only for metrics that went DOWN.
   It must never raise a baseline.
5. Install eslint-plugin-react and enable react/no-array-index-key and
   react/jsx-no-target-blank (the latter has an autofix — run `eslint --fix` once,
   that closes B-09 immediately). Enable eslint `max-lines` at 800 as a warning.
6. Add the ratchet test to CI.

From then on the AI's standing instruction is: "leave every file you touch with fewer
violations than you found it, then run ratchet:update". The 57 items in shortcut 10
below get done that way, gradually, instead of as a project.
```

**0c. RESTORE THE AI ENDPOINT — every AI feature is currently broken (found 2026-09-22).**

Commit `ca8b675` (2026-09-16, "feat: add document generation and MFA enrollment")
deleted the `POST /api/ai/process` handler from `server.ts` (191 lines: auth, workspace
check, PII scrubbing, credit charging) **and** the whole `src/services/aiBackendService.ts`
(533 lines, 9 tasks). Nothing replaced them. The browser still calls `/api/ai/process`
from `aiService.ts:20` and `Copilot.tsx:123`, so Copilot, receipt scan, statement import,
Magic Entry, the AI blueprint and the AI command center all get an error and fall back.
No test caught it because `e2e/smoke.spec.ts:80` **mocks** that URL.

A scan of all 86 API paths the browser calls against all server routes found this is the
only real missing endpoint.

```
PROMPT 0c — Restore the AI endpoint and stop this class of bug.

1. Restore src/services/aiBackendService.ts from commit ca8b675^ :
     git show ca8b675^:src/services/aiBackendService.ts > src/services/aiBackendService.ts
   Move it to src/server/services/ if that is where server-only code lives now.
2. Restore the POST /api/ai/process handler from ca8b675^:server.ts (around line 1031)
   — but as a router file src/server/routes/aiRoutes.ts mounted in server.ts, not back
   into server.ts. Keep every check it had: authenticate, authorizeWorkspace, credit
   balance check, SecurityService.scrubPII on chat input, credit charging via
   FieldValue.increment. Validate the body with zod (task must be one of the 9 known
   task names; unknown task → 400).
3. Add src/tests/route-contract.test.ts: collect every '/api/...' string used in src
   (outside src/server) and fail if any has no matching server route (mount prefix +
   router path, :params as wildcards, array paths expanded). Allow-list only strings
   that are display text, with a comment saying why.
4. In e2e/smoke.spec.ts keep the mock if you need it for speed, but add one test that
   calls /api/ai/process WITHOUT the mock and expects 401 (unauthenticated), not 404.
5. Run tsc, the full test suite, and the reachability guard.
```

---

# THE 14 SHORTCUTS

Each one lists what already exists to build on, what to build, and which backlog items
it closes. Item IDs refer to the tracker further down this file.

## 1 · Collapse the customer/vendor mirrors — closes 13, deletes ~900 lines

**Build on:** `Sales.tsx`, `Purchases.tsx`, `CustomerDetailView`, `VendorDetailView`,
AR/AP aging views, `creditNoteEngine.ts` (`applyCreditNoteToInvoice` /
`applyVendorCreditToBill` are already mirrored functions).

**Build:** a `PartySide` config — `{ side: 'customer' | 'vendor', party collection,
document collection, credit collection, control account role, labels }` — and one
component per screen that takes it: `PartyListView`, `PartyDetailView`, `AgingReportView`,
`PartyModal`. Delete the duplicated half of each pair.

**Closes:** BA-02 · BA-10 · BA-11 · BA-12 · BA-13 · K-09 · K-10 · E-11 · E-12 · H-05 ·
H-06 · H-09 · H-10. **And every future paired item costs half** — J-01/02, J-04/05,
J-07/08, CB-01/02, CB-10/11, CB-12/13.

**Risk:** low. Pure refactor, no data change. Do it first among the shortcuts.

## 2 · One document engine — closes 39

**Build on:** `documentMath.ts` (the math is already shared), `documentRoutes.ts`,
`pdfService.ts`, `InvoiceModal`/`BillModal`, the numbering-series allocator,
`LedgerPostService`.

**Build:** `defineDocument({ type, collection, side, lineShape, statuses, numberingPrefix,
posts: postingFn | null, convertsTo: [...] })` in a registry, one `DocumentEditor`, one
server router built from the registry (replacing the `if/else` chain with a lookup).
Every document type then gets, for free: PDF + preview · numbering dialog · attachments ·
email with templates · per-recipient links with view tracking · watermark · page numbers ·
recurring · approval · convert-to · void-not-delete · period lock.

**Closes:** M-02 sales orders · M-03 sale receipts · M-04 manual journals · M-05 email
templates · M-09 attachments · M-12 delivery notes · M-16 requisitions · K-03 · K-04 ·
K-05 · K-07 · K-08 · CC-01 · CC-03 proposals · CC-04 · CC-05 · CA-30 · BE-03 · BE-04 ·
BE-05 · BE-08 · BE-11 · BA-07 · BA-08 · BF-06 · BF-07 · Y-16 · Y-17 · BL-05 · BL-06 ·
BL-07 · S-02 · E-08 · E-09 · E-15 · E-16 · E-17 · H-01 · H-02.

A sales order becomes ~40 lines: `defineDocument({ type:'salesOrder', side:'customer',
posts: null, convertsTo:['invoice'] })`. Today it would be ~1,500 lines across 7 files.

## 3 · Entity framework (config → type, rules, indexes, subscription, UI) — closes 73

**This one also ends a bug class.** The customers lockout, the missing `creditNotes`
index and the orphaned `creditNoteEngine` all came from hand-wiring the same five things.

**Build on:** `src/schemas.ts` (33 zod objects already), `WORKSPACE_SCOPED_COLLECTIONS`,
`TanStackDataGrid`, `RadixModal`, the rules-coverage and index guards.

**Build:** `defineEntity({ name, collection, schema: zodObject, indexes, listColumns,
permissions })`. From that one definition:
- the TypeScript type (`z.infer`) — no hand-written interface, no `any`
- the list view and the form (via shortcut 7, accessible by default)
- the `useCollection` subscription (via shortcut 6)
- the `firestore.rules` block with `affectedKeys()` taken from the schema's keys
- the `firestore.indexes.json` entries
- a rules-test row (owner can, viewer cannot, other workspace cannot)

Rules and indexes can't be generated at runtime, so generate them with
`npm run gen:firestore`, commit the output between marker comments, and add a test that
fails if regenerating produces a diff. Follow `AGENTS.md`: top-level collections scoped by
`workspaceId`, never subcollections.

**Closes:** M-01 items · M-06 exchange rates · M-07 · M-08 · M-10 · M-11 · M-13 · M-14 ·
M-20 · K-02 · K-12 · K-14 · K-15 · K-21 · K-29 · K-33 · CC-06..CC-11 · CG-01..CG-04 ·
CG-06 · CD-06 · CD-07 · CF-01 · CF-02 · CF-04..CF-08 · CE-01 · CE-08 · V-02 · V-03 · V-05 ·
Y-21..Y-28 · Y-30 · Y-31 · Y-34 · Y-35 · BB-01..BB-09 · BA-05 · BA-06 · BF-01..BF-03 ·
BF-09 · CA-28 · CA-29 · E-18 · A-14 · A-15 · BM-06 — **73 items**.

## 4 · Report engine + one shell — closes 89 (the biggest)

**Build on:** `computeReports.ts`, `reportGenerators.ts`, `documentMath.ts`,
`PivotSheet.tsx` (754 lines, already a generic pivot), `TransactionQueryEngine.ts`,
`src/lib/exportUtils`, `pdfService`.

**Build:** the shell once — date presets (fiscal-aware), cash/accrual, compare previous
period / previous year, monthly columns, % of total, variance, column chooser, permalink,
drill-down, PDF, Excel, print. Then `defineReport({ id, source: 'ledger' | 'documents',
groupBy, measures, filters })`. Most missing reports are a group-by over data you already
have: "transactions by customer / vendor / reference", "customer / vendor balance
summary", "sales / purchases by item" are the same query with a different `groupBy`.
Dashboard widgets are the same reports rendered small.

Move the 6 existing statement views (3,438 lines) onto it — expect each to shrink to
~100 lines plus its `defineReport`.

**Closes:** F-22 · N-01..N-12 · J-01..J-14 · CB-01..CB-29 · O-04..O-08 · BC-01..BC-11 ·
BD-01 · BD-04..BD-06 · BD-08 · BD-10 · BJ-01 · BJ-02 · BK-07..BK-10 · I-17 · I-18 · D-01 ·
D-08 · F-13 — **89 items**.

## 5 · Event bus — closes 32

**Build on:** `LedgerPostService` (single posting path), the document engine (2), the
entity framework (3), the 13 hand-written audit writes, `useNotificationStore`,
`emailService`, the existing webhook code.

**Build:** every write emits one typed event (`invoice.sent`, `payment.received`,
`bank.feed.disconnected` …). Subscribers: audit log · notifications · webhooks (with
delivery log) · email triggers · activity feed. A notification type becomes one row:
`{ event, audience, channels, template }`. Replace the 13 hand-written audit writes with
one subscriber — that removes a whole category of "forgot to audit" bugs.

**Closes:** S-01..S-20 (all notifications) · K-25 · K-26 dunning · K-32 · K-37 webhook
delivery · BE-01 reminders · BE-02 · BE-06 · BG-01 · BG-04 · CC-16 · BL-01..BL-03.

## 6 · One per-view data hook — closes 13

**Build on:** `useLedgerData.ts`, the truncation flags you already built.

**Build:** `useCollection(name, { where, dateWindow, limit, live })` returning
`{ data, loading, error, truncated }`. Views ask for what they need when they mount,
instead of 24 listeners loading everything at login. Migrate one view at a time; keep
Zustand for derived state.

**Closes:** C-14 · C-15 · C-16 · C-17 · C-20 · AA-06 · I-01..I-05 · D-04 · D-05. Also
the biggest single cut to your Firestore bill.

## 7 · One accessible Field/Form layer — closes 16

**Build on:** Radix `Label` (installed), zod schemas.

**Build:** `<Field label error>` that always wires `htmlFor`, and `<SchemaForm schema>`
that renders fields from a zod object. Shortcuts 2 and 3 use it, so every form they
generate is accessible from the start. The ~400 accessibility warnings then go down as
screens move onto it, without a separate accessibility project.

**Closes:** E-02..E-07 · E-10 · E-13 · E-14 · E-19..E-21 · I-07 · I-08 · I-11 · I-12.

## 8 · Test and document at the registry, not per component — closes 39

**Build on:** `e2e/view-registry-coverage.spec.ts` (89 lines — it already loops over the
registry), `src/config/registry.tsx`.

**Build:** extend that one spec to, for every registered view × every role: mount it,
assert no console errors, run axe (add `@axe-core/playwright`), and check the
loading/empty states. Add a `help` field to each registry entry and generate the in-app
docs page and contextual help from it. **One test file covers 74 views**, instead of
writing 26 component tests. Keep deep unit tests for money code only.

**Closes:** H-03 · H-04 · H-07 · H-08 · H-11..H-30 · E-22..E-30 · BO-01 · BO-02 ·
BO-07 · L-20 · BP-04 · BP-05.

## 9 · Delete, demote, or decide not to build — removes 71 ⚠ needs your decision

Every screen you delete also removes its share of accessibility work, missing states,
tests, `any` and oversized-file items. Two candidates:

- `SystemCommandCenter.tsx` (1,783 lines) runs on simulated data.
- `ApiHub.tsx` (3,149 lines, the second-largest file) has 6 tabs; key management and docs
  are the parts a customer uses.

Consider putting these, plus `IntelligenceCenter`, `DiagnosticConsole`, `AICustomBlueprint`
and `AICommandCenter`, behind a `developer` feature flag. That takes them out of the
product surface without losing them.

**Decide not to build** (listed in the tracker as open; I recommend dropping them):
industry verticals BI-01..BI-16 · e-invoicing for markets you don't sell into T-09..T-15 ·
SSO/SCIM/IP allowlist P-01..P-03 until a customer asks in writing · warehouses M-15 ·
query language / formula engine / E2E encryption CD-03..CD-05 · commerce features
CA-21..CA-24, CG-09..CG-12 · investment tracking CE-02..CE-05 · extra bank aggregators
Y-05..Y-07 (keep one) · SMS BA-14 · integrations Z-23..Z-27 until asked · i18n L-18
(remove the toggle: 15 minutes, versus extracting 150 components).

## 10 · Mechanical cleanup via the ratchet — closes 57, gradually

61 array-index keys · 30 UTC dates · `any` in ~16 files · 14 oversized files ·
`server.ts` size · `console.log` · missing `noopener`. **Do not schedule these.** With the
ratchet (step 0b) in place, each commit that touches a file cleans it up and lowers the
baseline. Closes G-01..G-14 · A-16/17/20/21/23 · B-09 · F-01 · F-04..F-21 · D-03..D-25 ·
L-13 · AD-01 · AD-02 · AG-05.

## 11 · Data-health rule registry — closes 19

**Build on:** `TruthEngine`, `DataHealthView`, `computeBalanceSheet`'s orphan detection.

**Build:** `defineCheck({ id, severity, query, explain, fix })`. Each check is one entry.
The period-close checklist is simply "run these checks, record who signed off".

**Closes:** Z-07..Z-15 · CA-06 · CA-32 · CA-33 · CA-34 (bisect — binary-search the date
the books stopped balancing) · R-01 · R-02 · R-08 · R-09 · BJ-03 · L-07.

## 12 · Import/export adapter registry — closes 11

**Build on:** `mt940Parser.ts`, `camt053Parser.ts`, the OFX code, `exportUtils`.

**Build:** `defineImporter({ format, detect, parse, mapColumns })` plus one wizard that
handles any registered format, with saved column maps, dry-run preview, per-row errors
and rollback. Each new format is then one parser file.

**Closes:** M-18 · BK-02..BK-04 · BK-11 · BK-12 · Y-01 · Y-02 · Y-18 · K-36 · CA-11.

## 13 · One money/number display primitive — closes 7

**Build on:** `Money.tsx` (now wired) and `formatCurrency`.

**Build:** locale-aware symbol placement, separators, accounting-style negatives
`(1,234.56)`, per-currency rounding — all inside `Money` / `formatCurrency` and nowhere
else. Also make the 3-decimal-currency storage decision here.

**Closes:** BM-01..BM-05 · BH-02 · A-03.

## 14 · Use the algorithm registry that already exists — closes 10

**Build on:** `FINANCIAL_ALGORITHMS` + `ToolSandbox` (only 5 algorithms registered today).

These are pure calculations. Per `AGENTS.md`, add each as an algorithm and the UI is
generated automatically — no view to build.

**Closes:** Q-01..Q-06 (depreciation variants, lots, tiered pricing, allocation,
variance) · P-14 cohort analysis · CA-25 seasonal budgets · CA-26 allocation % ·
V-08 WIP.

## 15 · User-built tools with an AI builder — sits on top of 3, 4, 11 and 14

**The rule that makes it safe: users and the AI create CONFIGURATION, never CODE.**
A custom report, filter, rule, check or formula is a JSON object in a fixed vocabulary.
The engines you already have (or build in shortcuts 3/4/11/14) interpret it. Nothing is
ever `eval`'d. (Verified today: the codebase has zero `eval` / `new Function` — keep it
that way.)

**The flow, for every kind of custom tool:**
```
user describes it in words
  → AI returns JSON constrained by a schema   (server.ts:3218 already uses responseSchema)
  → server validates it with zod             (reject anything outside the vocabulary)
  → dry-run preview on real data             ("this rule would have changed 34 past transactions")
  → a person confirms
  → saved per workspace, versioned, can be switched off with one click
```

**Already half-built:** `AutoRule` (10 conditions, 15 actions) · saved views
(`useSavedViewsStore`, 443 lines) · `TransactionQueryEngine` (638) · `query-builder` view ·
`AICustomBlueprint` (describe your business → AI generates a chart of accounts — the same
pattern, working for one thing) · `FINANCIAL_ALGORITHMS` + `ToolSandbox`.

**What users could build, and which engine runs it:**

| User creates | Stored as | Runs on |
|---|---|---|
| Automation rules | `AutoRule` JSON | existing rule engine — **works today** |
| Saved filters / views | saved-view JSON | existing saved views + query engine — **works today** |
| Custom reports | `defineReport` JSON | shortcut 4 |
| Custom fields | schema fragment | shortcut 3 |
| Custom checks / alerts | `defineCheck` JSON | shortcut 11 |
| Calculated columns / formulas | expression string | restricted evaluator (below) |
| Dashboard widgets | report JSON rendered small | shortcut 4 |

**Safety rules — all of them, not some:**
1. **Config only.** No user- or AI-supplied JavaScript runs, ever.
2. **Server-side zod validation** of every saved tool. Client validation is not enough.
3. **Formulas** use a small purpose-built evaluator: numbers, `+ − × ÷ ( )`, comparisons,
   and a whitelist (`SUM AVG MIN MAX IF ROUND ABS`). No variables except named fields, no
   property access, no function calls outside the whitelist, integer-cent maths via
   `documentMath`. Add a test file of escape attempts (`constructor`, `__proto__`,
   `this`, huge exponents, deep nesting) that must all be rejected. Don't reach for a
   general-purpose expression library without checking its security history — several
   have had sandbox escapes.
4. **Money invariants are enforced by the engine, not the config.** Any custom report or
   formula that sums money goes through `isPostable` / `lineAmount` / `documentMath`
   automatically — a user's config cannot switch that off (AGENTS.md rule).
5. **Custom tools read and suggest. Writes go only through existing actions** (rule
   actions → `LedgerPostService`), so period locks, permissions and audit all apply.
6. **Who can create:** owner/accountant (`canAdmin`). Everyone else can use them.
   Top-level collection scoped by `workspaceId`, rules block with `affectedKeys()`.
7. **Prompt injection:** the builder prompt gets the schema, the field names and the
   user's request — **not** raw ledger text. Transaction descriptions and vendor names are
   attacker-controlled; if examples are needed, pass them as clearly delimited data.
8. **Limits:** max tools per workspace, evaluation time limit per rule/formula, AI calls
   charged against the existing compute-credit balance.
9. **Isolation:** each custom widget/report renders inside an error boundary, so a broken
   tool shows an error card instead of breaking the page.
10. **"For the whole system" means templates you review**, not user tools running in other
    workspaces. Start workspace-only. Later, you can publish reviewed templates others can
    copy into their own workspace.

**Order:** the first slice (AI → AutoRule) can ship right after step 0c, because the rule
engine exists **and so does the dry run**: `dryRunRules()` in `src/lib/rulesEngine.ts:235`
already filters with `isPostable` and is already used by `RulesSettings.tsx`. What's
missing is only the zod schema for `AutoRule` (none in `src/schemas.ts` today) and the
"describe it" box. Reports, fields, checks and formulas follow as their shortcuts land —
each one adds a new "kind" to the same builder.

```
PROMPT D — "Describe a rule" AI builder, first slice. Do step 0c first.

1. src/schemas.ts: add AutoRuleSchema (zod) matching the AutoRule interface in
   src/types.ts exactly — every condition field and every action as an enum of the
   existing values. .strict() so unknown keys are rejected. Add a test that a valid
   rule passes and that rules with unknown actions, unknown fields, or extra keys fail.
2. Server: add task 'build-auto-rule' to the restored /api/ai/process handler.
   Prompt = the AutoRule schema + the workspace's account names/ids and category
   names + the user's sentence. Do NOT send transaction descriptions or vendor names.
   Use responseMimeType 'application/json' + responseSchema (same as server.ts
   /api/v1/brain/analyze). Parse the reply with AutoRuleSchema on the SERVER; if it
   fails, return 422 with the zod errors, never a half-valid rule. Any account id the
   AI returns must exist in the workspace's chartAccounts — otherwise 422. Charge
   credits the same way the other tasks do.
3. RulesSettings.tsx: add a "Describe a rule" text box (only for canAdmin roles).
   Send → show the returned rule in the existing rule editor, pre-filled, NOT saved.
   Run dryRunRules([rule], transactions) on it and show "would change N of your last
   90 days of transactions" with the list. Buttons: Save (as inactive), Save and
   activate, Edit, Discard.
4. Saving goes through the existing addDoc path for autoRules (workspaceId field,
   existing rules). Add createdBy: 'ai' and the original sentence so it's auditable.
   Validate with AutoRuleSchema on the client before saving too.
5. Tests: schema tests (step 1); a server test that a malicious reply (extra keys,
   unknown action, an account id from another workspace) is rejected; a test that the
   prompt builder never includes transaction descriptions.
6. No eval, no new Function, no dynamic import of user text — the rule is data only.
```

---

# MERGED DUPLICATES (55)

The same work under more than one ID. Close them together:

bulk import = K-01 = M-18 = BK-01 = Y-03 = CA-12 (+ BK-05, BK-06) · bulk action bar = K-06 =
M-17 · portal = K-27 = M-19 · scheduled reports = K-28 = M-08 · merge contacts = Y-23 =
BA-01 · JE templates = BD-09 = CA-27 · undo = I-09 = BO-08 = CD-02 · onboarding =
L-19 = BO-03 = P-09 · structured logging = L-12 = BN-01 · status page = L-17 = BO-06 ·
invalid ledger entries = CA-35 = CB-20 · rate hierarchy = V-04 = CF-03 · timesheets =
V-01 = CF-01 · deferred revenue = K-16 = J-14 = CB-16 = CA-36 · accruals = K-17 = R-05 ·
RBAC = CG-07 = CG-08 · impersonation = P-04 = CE-07 · switcher = K-34 = BD-02 ·
payment runs = K-24 = CA-31 · clearance = CA-04 = CB-24 · branding = Y-11 = Y-12 = Y-13 =
Y-33 = BA-19 = CC-02 · advances = K-18 = BE-12 = CA-09 · inventory adjustment = K-13 =
BA-04 = W-04 = W-05 · tax rules = T-01 = T-02 = CA-16 = CA-17 = CA-20 · tasks = CC-14 =
BG-03 · rule groups = K-38 = CA-13.

---

# THE 179 THAT REMAIN INDIVIDUAL

Grouped. Most get noticeably cheaper after the shortcuts exist. Payroll and fixed assets
have their core calculations done and verified, so what's left is the part users touch.

- **Money workflows (high value):** CA-01 payment reconciliation · CA-02 unreconcile ·
  CA-03 repost ledger · BA-09 quick payment · BA-15 partial unlock · K-20 undeposited
  funds · K-19 bad debt · K-30 loans · K-31 petty cash · K-22 expense claims · K-23
  requisition approvals
- **Period close:** R-03 soft close · R-04 **year-end retained-earnings roll** · R-05..R-07
  · R-10 · R-11
- **Payroll lifecycle:** U-01..U-11 (payslip PDF first — becomes a `defineDocument` once
  shortcut 2 exists)
- **Fixed-asset lifecycle:** X-01..X-09
- **Inventory:** W-01..W-03 (**W-03 COGS on sale**), W-06..W-09
- **Tax depth:** T-03..T-08
- **Multi-entity:** Z-16..Z-22
- **Banking:** Y-04 · Y-08 feed re-auth · Y-09 · Y-10 · CA-05 · CA-07 · CA-08 · CA-10 ·
  CA-14 · CA-15 · CA-18 · CA-19
- **API:** Z-01..Z-06
- **Platform & ops:** L-05 · L-06 · L-08..L-11 · L-14 · L-15 · P-05..P-08 · P-11..P-13 ·
  BN-02 · BN-03 · BP-01..BP-03 · BP-06 · BP-08 · CG-05 · CG-07 · CG-13..CG-15 · CC-13 ·
  CC-15 · CD-01 · CE-06
- **Compliance:** BJ-04..BJ-09 (BJ-05 legal hold: build it together with the purge job)
- **Other UX/features:** I-06 · I-10 · I-13..I-16 · I-19 · I-20 · K-11 · K-35 · K-39 ·
  K-40 · M-21 · BA-03 · BA-16..BA-20 · BD-03 · BD-07 · BE-07 · BE-09 · BE-10 · BE-13 ·
  BF-04 · BF-05 · BF-08 · BG-02 · BG-05..BG-07 · BL-04 · BL-08 · BO-04 · BO-05 · Y-14 ·
  Y-15 · Y-19 · Y-20 · Y-29 · Y-32 · Z-28..Z-35
- **Loose ends:** B-01 · B-05 · B-06 · C-19 · AE-04 · AF-03 · AF-04 · V-06 · V-07 · V-09

---

# ORDER

Dependencies decide the order. The cheapest and safest come first, and each step makes
the next one cheaper.

```
0a  CI fix (lockfile)                        prerequisite for everything
0b  Ratchet + eslint-plugin-react            ~half a day; then shortcut 10 runs by itself
 E  Make CI green (prompt E, top of file)    NOW — includes 3 security-rule fixes
 F  Real + safe AI endpoint (prompt F)       replaces 0c and D; closes an open-login hole
 9  Decide deletions/deferrals               an hour of decisions; shrinks everything after
 1  Collapse customer/vendor mirrors         ~2–3 days, deletes ~900 lines, low risk
 8  Registry-level smoke + axe test          ~1 day; the safety net for the refactors below
 7  Field/Form layer                         ~2 days; needed by 2 and 3
 6  useCollection data hook                  ~3–4 days incremental; needed by 3 and 4
 3  Entity framework + generated rules       ~1 week; ends the wiring-bug class
 2  Document engine                          ~1 week, on top of 3 + 7
 4  Report engine + shell                    ~1–2 weeks, on top of 6
 5  Event bus                                ~3–4 days, on top of 2 + 3
11 12 13 14                                  small, independent, any time
    then the 179 individual items — with CA-01/02/03, BA-09, BA-15, R-04, W-03 first
```

The day estimates are rough. What doesn't depend on estimates: after step 5, adding a
document type, entity, report, notification, check or import format is a registry entry,
not a feature build.

---

# FIRST PROMPTS

```
PROMPT A — Ratchet (step 0b). Do this right after the CI fix.
[use the step 0b block above verbatim]
```

```
PROMPT B — Collapse the customer/vendor mirrors (shortcut 1).

(Re-measured 22 Oct: Sales.tsx/Purchases.tsx 21%, CustomerDetailView/VendorDetailView 84%;
the aging views and CustomerModal/VendorModal are already one component each. Start with the
detail views, then InvoiceModal/BillModal at 38%; not the list screens.)

1. Create src/config/partySides.ts exporting CUSTOMER_SIDE and VENDOR_SIDE:
   { side, partyCollection: 'customers'|'vendors', documentCollection: 'invoices'|'bills',
     creditCollection: 'creditNotes'|'vendorCredits', controlAccountRole (resolve via
     resolveAccountRole — never a literal account id), labels: {party, document, credit,
     ...} }.
2. Build PartyDetailView({ side }), AgingReportView({ side }), PartyModal({ side }) and
   PartyListView({ side }) from the more complete half of each pair. Keep every behaviour
   either side currently has; where they differ, make it a field on the side config.
3. Point the registry entries and the Sales/Purchases routes at the new components with
   the right side. Delete the old duplicated files.
4. Tests: run every existing test; add one test that renders each new component with
   both sides. Money must still go through isPostable / lineAmount / documentMath.
5. One commit per pair, tsc green between each, no behaviour change.
6. Report the line count before and after.
```

```
PROMPT C — Registry-level smoke + accessibility test (shortcut 8).

Extend e2e/view-registry-coverage.spec.ts. For every entry in src/config/registry.tsx
and every role (owner, accountant, bookkeeper, viewer):
  - navigate to the view with the seeded emulator workspace
  - assert it renders without console errors
  - run @axe-core/playwright and record violations per view
  - assert the view shows a loading state, then either data or an EmptyState
Write the axe violation count per view into the ratchet baseline so it can only go down.
Do not fail the build on existing violations — fail only on NEW ones.
```

---
---

# LEDGERFLOW — MASTER BACKLOG (tracked)

> **Roadmap filter (owner, 7 Oct):** every item is judged by [`docs/ROADMAP.md`](ROADMAP.md): start simple, and complexity appears only when needed. Every open item is in one bucket: V1, Later (P0/P1/P2), Add-on, or Research. Only the owner moves an item into V1. Section DA holds the new items.

Measured at `origin/main` @ `936add6` · tsc 0 real errors · 293 tests (291 pass) ·
108,507 lines · `server.ts` 4,693 lines · 1,251 `any`

**Legend**
- `[x]` verified done
- `[→]` closes when the 4 CI steps from the last answer land
- `[~]` partially done (remaining count shown)
- `[ ]` open

---

# SECTION A — CORRECTNESS & DATA SAFETY


# SECTION B — SECURITY & DEPENDENCIES


# SECTION C — PERFORMANCE & COST

- [~] C-15 Date windows not needed at launch sizes: documents load once asked (caps 10,000 with the banner) and changes are fetched incrementally; true date windows come with server-side balances (L-123)
- [ ] C-19 `transactionsArchive` tier for closed years

# SECTION D — TYPE SAFETY (420 `any` by the ratchet count, was 1,365; every named file done)


# SECTION E — ACCESSIBILITY


# SECTION F — CODE STRUCTURE


# SECTION G — REACT CORRECTNESS


# SECTION H — TEST COVERAGE (122 of 150 components untested)


# SECTION I — UX COMPLETENESS

- [~] I-22 **Owner request (5 Oct): edit in place everywhere.** Shared `InlineEdit` done (tested). Screens done: customer list (name, email, phone), vendor list (name, category, email, phone), contact page (address, currency, tags), Inventory (name, SKU, category, cost, price; typing a quantity records a stock count), chart of accounts (name, code, description, category; system codes fixed; duplicate codes refused), transactions (description by one click with the workspace's own descriptions suggested; date and amount of entries typed in by hand, both lines change together; category of a plain entry with accounts used most first; class and location on every line; entries from an invoice, bill, payment or bank line keep their amount and date, and document entries their accounts; locked periods read-only), invoice list (due date while open; date while draft), bill list (vendor's number, due date while unpaid, date while draft). **Add in place** (type a name + Enter): customers, vendors, inventory items; entries at the top of the transaction list (description, amount, Enter; the category is suggested from past entries with a similar description, money in/out follows it, bank account and date stay for the next one). **Archive / delete in place**: customer and vendor lists (archive hides it from lists and new invoices/bills, records keep it, "Show archived" brings it back; delete only when nothing refers to it, checked by the server, which names what uses it); recurring schedules: name, how often and next date in place (not before the last run); tax codes: name and rate in place; chart of accounts: Archive / Restore / Delete in each row's menu, archived accounts hidden behind "Show archived accounts", an account with entries is archived instead of deleted). Purchase orders: vendor, expected delivery and the lines (item, quantity, unit price; type a new line + Enter; remove a line) change in place while nothing was received or billed, the total follows; expected delivery can still move after a partial delivery; an order with nothing received or billed can be deleted from its row. Credit notes and vendor credits: number and reason in place (reasons used before are suggested; a number already used is refused), the date while none of the credit was used; viewers no longer see "New credit note". Next: documents (drafts), projects, settings lists, bank lines; then add/delete/rename from the same places. The contextual side drawer also edits shared customer/vendor/project/item metadata while keeping the current form mounted, with confirmed scoped saves and retained refusal drafts. Any field you can see (a vendor's address in the vendor list, an item's price, a customer's email) can be changed right there by typing, without opening another page; one shared component, applied to every list and detail page, and the rule for every new screen (AGENTS.md) C-15 also covers Projects (name/client/planning budget/status, list and pipeline), Employees (name/email/job role), Assets (name/location/category), Budgets (name/planning amount), draft Estimates (reference/date/expiry/notes) and Dimensions (node/axis labels, previous label aliases and unfinished local edits preserved). Each has component coverage and confirmed scoped saves with refusal/retry. New employee creation is now persisted, not only cached. Team role/invite/removal editing verified in C-23; durable API-key labels await the server rename contract.
- [~] I-23 **Owner request (5 Oct): help while typing.** Started: suggestions from the workspace's own data, most used first (vendor and item categories, currencies, transaction descriptions, categories); a new invoice takes the customer's usual payment terms; a new bill the vendor's usual account; "Same as last time" copies the lines of the customer's latest invoice (or the vendor's latest bill, amounts included) in one click, and a new purchase order the vendor's latest order (vendors you order from most are listed first); foreign currency rates fill in. The contextual drawer also offers scoped metadata suggestions including reusable multiline addresses. Fields suggest values from the workspace's own data as you type (names, addresses, categories, accounts), ranked by the matching algorithms already in the app

# SECTION J — MISSING REPORTS


# SECTION K — MISSING FEATURES

- [ ] K-35 Per-workspace inbox address
- [ ] K-40 OAuth provider

# SECTION L — OPERATIONS & TRUST

- [~] L-06 Dependencies: all in-range updates applied on main 2026-10-02 (the Dependabot group PR closes itself); majors wait for a feature that needs them (Vite 8, TypeScript 7, Recharts 3, Plaid 47, Stripe 23, React Window 2…); npm audit clean. **6 Oct:** bidi-js 1.1.0 applied (its PR #39 closes itself); the major-version PRs were closed with a note (#4 Plaid 47, #40 @vitejs/plugin-react 6 (needs Vite 7+ first), #41 Recharts 3 (every chart changes), #42 @types/node 26: should be **24**, the Node we run); Dependabot no longer opens major-version PRs (`.github/dependabot.yml`), so these are planned here: @types/node → 24, then Vite + plugin-react, Recharts 3, Plaid 47
- [~] L-38 Building blocks: `useCollection` used in AuditLogViewer, `SchemaForm` in Chart of Accounts; `defineEntity` not yet
- [ ] L-67 Protect `main`: require both CI jobs before merging (GitHub setting — you) — would have blocked 5119ad2
- [ ] L-83 Verify the database TLS certificate (`DATABASE_CA_CERT`) — **waits for you** (docs/FOR_YOU.md #6): the server already verifies the certificate as soon as `DATABASE_CA_CERT` is set in Vercel (`src/server/db/pgFirestore.ts`); without it the connection is encrypted but not verified
- [ ] L-84 Custom SMTP sender for sign-up / reset emails
- [x] L-94 Build invoice/bill postings on the server (with the document engine) — design 21 Oct: `docs/design/L-94-server-postings.md`; **step 0 done 21 Oct**: entry builders import only `postingCore.ts` (no Firebase client, stores, toasts), the browser registers its host in `postingKit.ts`, `context.capture` collects entries, guard test `l94-posting-core.test.ts`. **step 1 shadow done 21 Oct** (`postingShadowCheck.ts` logs any difference after each invoice/bill save). Next: read the logs of the first testers; then refuse a mismatch (409), then step 2 **Done (24 Oct, checked by AI #1):** L94-STEP2 (#308) and L94-STEP2B: the server builds the entries of invoices, bills, credit notes and vendor credits (`POST /api/v1/documents/:type/:id/post`); `/transactions/bulk` refuses those documents and any entry naming one (`documentPostedByServer`, tests `l94-step2-document-post`, `l94-step2b-documents`). The shadow check lives on in the tests only, so no live logs are needed before enforcing.
- [ ] L-123 Later: balances and reports need every entry in the browser. Move them to the server (opening balances per closed year) so the browser can load only open years (with C-19)

# SECTION AA–AI — DEFECTS FOUND BY EXECUTION

- [~] AA-06 Same as C-15: incremental live lists instead of date windows (L-123 for server-side balances)

---

# SECTION M — ENTITIES

- [ ] M-13 Commodities
- [ ] M-15 Warehouses (deferred)
- [ ] M-21 Standard costing

# SECTION N — REPORT FEATURE MATRIX

- [~] N-12 Full drill-down (V1 part done 8 Oct: P&L, balance sheet, trial balance, budget vs actual and aging; later: dashboard figures, project and label totals, reconciliation, consolidation) — **expanded 7 Oct (roadmap, `docs/ROADMAP.md`), V1 for the statements; AI #4's D-5 is the first slice)**: **explain this number**, one shared drill-down contract instead of one per screen. The chain:
  1. the number;
  2. the filter that made it (dates, cash or accrual, accounts, label, status);
  3. the account and label rows;
  4. the entries;
  5. the document (invoice, bill, payment);
  6. the bank match;
  7. the attached files;
  8. the change history.

  What the drill-down lists adds up to the number clicked, and a test checks that for each report.
  - **Step 1 done 8 Oct (Claude, taken over from AI #4's D-5 to unblock V1):** `GET /api/v1/reports/explain` (`src/server/reports/explain.ts`) lists the lines behind a figure from the full history with the reports' own rules (postable only, base currency, same period, opening balance for a balance "as of"), each with its document (invoice, bill or entry), the bank match and the number of files attached. Tests show it adds up to every account of the server's P&L, balance sheet and trial balance. The shared drill-down (`DrillDownModal`, `explain` prop) shows the filter, every line in the report's sign, the total, says when the total differs from the figure on screen, and opens each line's document. Wired on the P&L and balance sheet account rows. Tests: `explain-number.test.ts`, `explain-number-ui.test.tsx`.
  - **Step 2 done 8 Oct:** the trial balance (its drill-down had found nothing: it sent the account id where the account name was expected) and budget vs actual (each month's actual) explained the same way; tests check budget vs actual adds up for a cost and for income. When the server can't explain a figure (offline, a guest workspace), the list the screen loaded is shown and said to be partial.
  - **Step 3 done 8 Oct (aging):** a customer's or vendor's details list the documents behind the row with a total in the base currency equal to the row, each opening its invoice or bill, and say when only part of the invoices or bills is loaded (tests in `aging-views.test.tsx`).
  - **Found and fixed:** the server trial balance gave credit accounts with an opening balance the wrong sign in its net column. It reads full history from the server and never a capped browser list; when only part is loaded, it says so. First: the P&L, the balance sheet, the trial balance, aging, and budget vs actual. Later: dashboard figures, project and label totals, reconciliation, and consolidation. Uses typed record links (`src/lib/recordLinks.ts`) and the report shell

# SECTION O — VISUALISATION


# SECTION P — PLATFORM & ENTERPRISE

- [ ] P-01 SSO
- [ ] P-02 SCIM
- [ ] P-03 IP allowlist
- [ ] P-04 Support impersonation
- [ ] P-06 Usage metering
- [ ] P-10 Referrals
- [~] P-14 Cohort analysis — C-21 first-observed invoice activity preview complete; full revenue report remains AI #5 E-2.

# SECTION Q — CALCULATION ENGINES

- [~] Q-03 Serial / lot tracking — **14 Oct (AI #3, A-33)**: lookup screen done — Reports → Serial & Lot Lookup (where a serial has been, one item's lots with dates and units, the same serial twice for one item, CSV). Recording serial/lot numbers on receipt and invoice lines stays open: one input in the reserved document forms (the line fields already survive the document schemas). *Browser-suite note (14 Oct, AI #3): the Playwright E2E Smoke Suite fails at its "Run Playwright E2E Tests" step on `main` and on PR #129 alike — pre-existing, needs its own look.*

# SECTION R — PERIOD CLOSE WORKFLOW


  The service requires owner/accountant rights, keeps the ordinary closed-period guard, writes the
  revaluation and exact next-day reversal together, prevents a duplicate date, and audits both posting
  and undo. Undo now reads and validates the linked scheduled reversal, then posts its mirror today,
  marks the original reversed and voids the active scheduled row in the same transaction. Review found
  that the DB test had fetched `before0` before Undo and then asserted those stale objects had changed;
  the assertion now checks fresh `after0` rows. The UI also handles an Undo response that has no plan
  arrays without trying to render it as a plan. Tests: 21 pure rules/date cases, 8 panel cases; the
  DB-backed `src/tests/fx-revaluation-server.test.ts` includes the fresh Undo read and a typed
  historical month-end but self-skips here without `LF_TEST_DATABASE_URL`. Local merged-main checks:
  typecheck, **1147 tests passed**, ESLint 227 warnings / 0 errors (the existing cap), production
  build. (The DB suite was rerun on the merge: 1301 tests pass.) This is not gated on the
  `multi_currency_revaluation` Pro flag: that flag is otherwise unused, and which pages a plan gets is
  the owner's commercial call.

# SECTION S — NOTIFICATIONS

- [ ] S-13 export.ready — waits: every export today (document zips, CSVs, the close package, backups) is made while you wait and downloaded at once, so there is nothing to tell about later; the notice comes with the first export that runs in the background
- [ ] S-20 Push delivery

# SECTION T — TAX DEPTH

- [~] T-08 Late changes: changes after filing are shown box by box with the difference to report; carrying them into the next return automatically is later
- [ ] T-09 MTD / HMRC (UK only)
- [ ] T-10 EC Sales List (EU only)
- [ ] T-11 Intrastat (EU only)
- [ ] T-12 SAF-T (specific markets)
- [ ] T-13 Peppol / UBL (EU only)
- [ ] T-14 Factur-X (FR/DE only)
- [ ] T-15 Avalara / TaxJar (US only)

# SECTION U — PAYROLL LIFECYCLE

- [x] U-12 (done in 7d41a654: `u12-shared-time.test.ts`) Refuse paying the same time entry twice inside one pay run — **AI #2 review, 11 Oct (TOOL_REVIEW F13), AI #1 payroll ownership**: two active hourly employees can select the same `timeUid`; one approved 60-minute entry at 2500 cents/hour then produces two 2500-cent employee lines, gross 5000 cents. Later-run paid markers do not deduplicate this run. Agree the employee/person linking rule or authoritative allocation, and verify duplicate-entry refusal on the server and approval/release lifecycle. Pure selector/totals reproduction confirmed; no synthetic payroll posting performed.

# SECTION V — PROJECTS & TIME

- [ ] V-08 WIP / POC

# SECTION W — INVENTORY DEPTH

- [ ] W-07 Assembly / kitting
- [~] W-08 Backorder + drop-ship — **backorders done 10 Oct**: Reports → Backorders: sales orders' item lines still to deliver, oldest order first, against stock on hand (what each takes from stock and what it is short), and each short item in all with what is on order from vendors and what is still to buy; read-only (`src/lib/backorders.ts`, `BackordersReportView.tsx`; tests `backorders.test.tsx`). **Open:** drop-ship (a sales order line bought from a vendor and sent straight to the customer)

# SECTION X — FIXED ASSET LIFECYCLE


# SECTION Y — BANKING · DOCUMENTS · CONTACTS · SETTINGS

- [ ] Y-04 TrueLayer
- [ ] Y-05 GoCardless
- [ ] Y-06 Salt Edge
- [ ] Y-07 Yodlee
- [ ] Y-29 Sending domain with SPF/DKIM
- [ ] Y-32 Data region selection
- [ ] Y-35 Rounding policy setting

# SECTION Z — API · DATA QUALITY · MULTI-ENTITY · INTEGRATIONS

- [~] Z-12 Missing dimension check (V1 part done 7 Oct: the check, the rules per account, the form warnings and refusing on the server; the other conditions open) — **expanded 7 Oct (roadmap, `docs/ROADMAP.md`), V1 the check with a rule per account; Later the other conditions)**: required labels, e.g. "Property is required on Utilities" or "Project is required on Construction expenses".
  - **Conditions:** by account or account group first; later by document type, vendor or customer, item, or workspace, through the rule engine.
  - **What a rule does:** each rule picks one of warn before posting, refuse to post, or allow it but list it.
  - **What the user sees:** a missing label is a Data Health finding and a row in "Needs attention" (DA-02). The row opens the entry with the field ready, and it disappears only when the label is filled.
  - **Off by default:** a business without rules sees nothing new.
  - **Done 7 Oct:**
    - **The rule:** Settings → Dimensions → "Required labels" lets owners and accountants choose, for each label, the accounts whose entries need it and the day it applies from. Older entries are not flagged. It saves at once, on the label's own definition (`requiredOn`), so no database change was needed (`RequiredLabelRules.tsx`, `src/lib/requiredLabels.ts`).
    - **What counts as labelled:** a value on the line, in its tags, on the entry, or on every split.
    - **The list:** entries missing a label are a Data Health finding ("missing-label"), one per entry. It opens the entry, is gone once the label is filled, and is in the nightly check too.
    - **The warning:** the journal form names each missing label, account and line before saving, and shows the label columns when a line's account needs one.
    - Tests: `required-labels.test.tsx`.
    - **Refuse to post (7 Oct):** a rule can be set to "Refuse to save an entry without it" (`requiredOn.refuse`). The server then refuses an entry a person typed without the label when it is posted (`/transactions/bulk`), created (`POST /transactions`, `/batch-create`), changed (`PUT /transactions/:id`) or corrected (`/:id/reverse` with a replacement), naming the label and account. Never refused, only listed: entries LedgerFlow makes itself (cost of goods sold, spreads, revaluations, payments, depreciation…), reversals and voids, and entries made with bank lines imported in the same request (an import never stops). Which entries a person typed: `typedByPerson` in `src/lib/requiredLabels.ts`. Tests: `required-labels-refuse.test.tsx`.
    - **The warning in the bill and invoice forms:** each line's Labels (BF-09) names what is missing; with a refusing rule the warning says the entry is not saved without it.
  - **Still open (Later):**
    - **More conditions:** document type, vendor or customer, item.
    - A draft turned into a posted entry by a status change, and a bank line split, are listed but not refused yet.
    - **Needs attention:** a row there (DA-02).
- [~] Z-16 Parent/child entities — **parent and ownership done 8 Oct (Claude)**: Settings → Groups of books: a group can name its parent company and the share it owns of each other company (above 50%, at most 100%, two decimals; empty is 100%). Reports → Group Summary then adds each company in full and shows the other owners' part (non-controlling interest) of net income and of equity, per company and for the group. A group with a parent is refused while any of its companies is not open to you, never quietly short (`structureProblem`/`shareOf` in `src/lib/workspaceGroups.ts`, `workspaceGroupService.ts`, `groupReport.ts`; tests `workspace-groups.test.tsx`, `group-summary.test.tsx`). Shares of companies you can no longer open are kept unseen. **The parent's investment, 8 Oct (Claude):** for each company, the parent's asset account holding its investment can be chosen (read from the parent's own chart); its balance is taken out of the group's total assets and equity, so the capital the parent paid in is not counted twice; goodwill (paid above book value) is not shown separately, and the screen says so. A chosen account that is no longer an asset of the parent stops the report with a reason (tests `group-summary.test.tsx`, `workspace-groups.test.tsx`). **Goodwill, 10 Oct (Claude):** with the day the parent bought a company (Settings → Groups of books, next to its investment account), what it paid above its share of the company's book value that day (its equity at the end of the day, at the historical rate when translated) is goodwill: kept in the group's total assets and equity and said; paid below that share is said and left in equity. An account holding several companies has goodwill only when each one's day is given (`acquired` on the group, `groupReport.ts`; tests `group-summary.test.tsx`, `workspace-groups.test.tsx`). Shared groups: done (DA-01). **Equity method, 10 Oct (Claude):** a company owned 20% to 50% (an associate) is shown but not added; the parent's investment in it stays and grows by its share of the company's equity since the day bought, and its share of the profit after that day is added to net income, each on its own row; it needs its own investment account and the day bought; below 20% is refused (`isAssociate` in `src/lib/workspaceGroups.ts`, `groupReport.ts`; tests `group-summary.test.tsx`, `workspace-groups.test.tsx`; FOR_YOU 34). **Open:** goodwill impairment; taking out balances and sales with an associate. **Expanded 7 Oct (roadmap, `docs/ROADMAP.md`), Later P0, after DA-01)**: **one multi-entity design for Z-16…Z-22 and CB-26**, not separate enterprise screens.
  - **Model:** each legal company is its own workspace (its own books, currency, locks and roles). A group (DA-01) says which belong together, which is the parent, and the ownership share (this item).
  - **Build order:**
    1. Z-20: choose the group's books on a report; each figure drills back into its own workspace.
    2. Z-17: translation rates (closing rate for the balance sheet, average for the P&L, historical for equity).
    3. Z-18: the translation difference (CTA) account.
    4. Z-19: intercompany matching. An entry marked as with another member needs its match there; the ones that don't match are listed.
    5. Eliminations in the consolidated report (CB-26).
    6. Z-21 and Z-22, only when a real customer needs them.
  - **Rules:** consolidation reads each workspace under the user's own access and never copies entries into a new ledger. A user without access to one member gets the report refused, never quietly short
- [~] Z-17 Currency translation rates — part of the Z-16 design (roadmap 7 Oct, Later P0). **Done 7 Oct for the group summary (Claude):** "In one currency" on Reports → Group Summary; for each other currency the closing rate at the end date (assets, liabilities), the period's average (income, costs) and the historical rate (equity and earlier profit), typed or filled from the rate service (`/api/v1/currency/historical` and `/timeframe`; never invented, a missing rate is asked for). `translate` in `src/server/reports/groupReport.ts`, `src/lib/translationRates.ts`; tests `group-summary.test.tsx`. **Kept per period, 8 Oct (Claude):** rates that worked are kept on the group for that reporting currency and period (the newest 120), and fill in when the same period is opened again; they can still be changed (`keepRates`, `PUT /api/v1/account/groups/:id/rates`; tests `workspace-groups.test.tsx`, `group-summary.test.tsx`). Translation of one workspace on its own: done 10 Oct (N-07, via the group summary).
- [~] Z-18 CTA account — part of the Z-16 design (roadmap 7 Oct, Later P0). **Done 7 Oct as a line (Claude):** the translation difference of each member and of the group is shown on its own line ("of which translation difference") inside equity, so the translated group still balances. It is a presentation figure: nothing is posted in any member's books. **Open:** keeping it period by period when the group closes.
- [~] Z-19 Intercompany matching report — part of the Z-16 design (roadmap 7 Oct, Later P0). **Done 7 Oct on the group summary (Claude):** "Dealings between the companies": each intercompany entry in the period (posted with its other company and entry, `metadata.isIntercompany`) is checked against its match there; matched pairs are counted, the rest listed with why (the match is missing, was undone, has another amount, or the other company is outside the group or not one you can open), each opening the entry in its own books (`matchIntercompany` in `src/server/reports/groupReport.ts`; tests `group-summary.test.tsx`). **Open:** marking an ordinary entry as "with another company" (today only Intercompany posts such pairs); posting between companies in different currencies: **fixed 8 Oct** — the receiving company's amount ("Arrives as") is now required and used, never a guessed rate (found by DA-09: the same number landed on both sides); taking sales between the companies out of the total: **done 8 Oct** (CB-26).
- [~] Z-20 Entity selector on reports — part of the Z-16 design (roadmap 7 Oct, Later P0). **Step 1 done 7 Oct (Claude):** Reports → Group Summary: choose one of your groups of books (DA-01) and a period; each company's income, cost of goods sold, gross profit, expenses, net income, assets, liabilities and equity side by side, and the group's total when all use one currency (otherwise it says why: translation is Z-17). Each member is read under your own access, never copied; members you can no longer open are left out and counted; each figure opens that company's own report (`src/server/reports/groupReport.ts`, `GET /api/v1/reports/group-summary`, `GroupSummaryReportView.tsx`; tests `group-summary.test.tsx`). **Account by account, 8 Oct (Claude):** "Account by account" on Group Summary lists each account across the companies, matched by code (else by name; a code with different names says both), each company's figure and together, by section, translated at each section's rate with the profit not yet closed and the translation difference on lines of their own; the lines add up to the totals before what is taken out between the companies (`src/server/reports/groupAccounts.ts`, `?detail=accounts`; tests `group-accounts.test.ts`, `group-summary.test.tsx`). Eliminations: done (Z-19, CB-26). **The group's own chart mapping, 10 Oct (Claude):** the group's owner can combine a line with another of its section ("Combine with…", e.g. one company's "700 Turnover" into "4000 Sales"); the group keeps it and the server applies it to everyone who opens the summary, with the line's other names said and an Undo (`lineMerges` on the group, `PUT /api/v1/account/groups/:id/lines`, `lineMergesProblem`; tests `group-accounts.test.ts`, `group-summary.test.tsx`). **Open:** choosing a group on the other reports (P&L, balance sheet) themselves.
- [ ] Z-21 Minority interest — Research: last step of the Z-16 design, only with a real group customer (roadmap 7 Oct)
- [ ] Z-22 Equity-method investments — Research: last step of the Z-16 design, only with a real group customer (roadmap 7 Oct)
- [ ] Z-23 WooCommerce
- [ ] Z-24 Square
- [ ] Z-25 Drive / Dropbox
- [ ] Z-26 Zapier / Make
- [ ] Z-27 HubSpot / Salesforce

# SECTION BA — DISCRETE USER ACTIONS

- [ ] BA-14 Notify via SMS

# SECTION BB — SETTINGS PAGES

- [~] BB-07 Modules — **expanded 7 Oct (roadmap, Later P0)**: simple until needed. There is one app that grows, never a "simple" and an "advanced" version.
  - **Step 1 done 7 Oct (Claude):** Settings → Modules (src/lib/modules.ts, moduleService.ts, `PUT /api/v1/workspaces/:id/modules`, owners and accountants, audited). Nine modules whose screens are whole menu tabs: quotes and sales orders, purchase orders, payroll, fixed assets, loans, petty cash, intercompany, forecasting, query builder. Off = gone from the menu and the ⌘K search; nothing deleted. A new workspace starts with quotes on and the other eight off; a workspace made before keeps everything on (tested: modules.test.tsx).
  - **10 Oct (Claude):** Stock (Inventory), Projects and Budgets are modules too and now in the menu (Money out, Reports) when on: until then they were in no menu at all, only ⌘K and links. A new workspace starts with them off; one made before keeps them on; Settings → Modules counts their records.
  - **Left (step 2):** the modules spread inside other screens (projects, stock, more currencies, budgets, groups, the API tools), and a module turning itself on when first used.
  - **Found 8 Oct (for step 2):** Inventory, Projects and Budgets are not menu tabs; they are screens opened from inside others (`SCREEN_TABS_REGISTRY` "extra"), and their fields sit on invoices, bills and entries. So step 2 is per screen: hide the links and fields to them while the module is off, and turn the module on when its first record is made from a screen that is still visible (e.g. the first stock item from an invoice line). Inventory, Projects and Budgets are not in the menu at all today (only ⌘K, links and fields), so for them step 2 is the fields inside forms, and turning on at first use needs the first record to be saved through the server (it is written from the browser today). Settings → Modules should also say when a module that is off still holds records: **done 8 Oct (Claude)** — "Off, but it still holds 3 records: turn it on to see them" (`moduleRecords` in `moduleService.ts`, `GET /api/v1/workspaces/:id/modules/records` for any member; tests `modules.test.tsx`).
  - **What is a module:** projects, stock, payroll, fixed assets, more than one currency, budgets, companies and groups, and the API tools.
  - **When it appears:** each module is off until the workspace starts using it (the first project, the first stock item, a second currency, a second workspace in a group) or someone turns it on in Settings → Modules.
  - **When it is off:** its menu entries, reports and settings are hidden. No data is deleted, and turning it back on shows everything again.
  - **New workspaces:** start with the basics only.

# SECTION BC — DASHBOARD WIDGETS


# SECTION BD — ACCOUNTANT PERSONA


  Sorted by most work. A count opens that workspace on that exact screen. Each count comes from that workspace's own server reads, under the user's role there; no cross-workspace query gets around the database rules. Builds on K-34; shares its counts with DA-02; grouped by DA-01
- [ ] BD-06 Client report pack — **AI #2, 11 Oct: core pack implemented on `codex/c30-report-pack`; P&L/balance sheet/current dated receivables aging, optional trial balance/cash flow/payables aging, cover and numbered PDF. Existing server totals only; all sections must load. Arbitrary specialized shell reports remain individual prints, so partial.** = AI #2's C-30 (roadmap 7 Oct, Later P1; with R-11 and BD-04)

# SECTION BE — DOCUMENT WORKFLOW


# SECTION BF — ITEMS · PRICING · STOCK

- [ ] BF-03 Item bundles
- [ ] BF-04 Landed cost on receipt
- [ ] BF-05 Consignment stock
- [~] BF-08 Partial fulfilment (step 1 done 7 Oct; step 2 mostly done 7 Oct, see below) — **expanded 7 Oct (roadmap, `docs/ROADMAP.md`); step 1 V1, step 2 Later P0)**.
  - **Found 7 Oct:** the New Estimate form took one amount and no lines, it saved every quote as USD, and a quote or order line could not name an item (`Estimate.lines` has no `itemId`). Invoicing an order (`orderPartInvoice` in `src/lib/salesOrders.ts`, and `convertEstimateToInvoice`) makes invoice lines without one. So an order of stock items never lowers stock and never books cost of goods sold, even when it is invoiced in one go, because `planInvoiceCogs` (`src/services/invoiceCogs.ts`) needs `line.itemId`. The same sale typed straight onto an invoice does both.
  - **Step 1 (V1) — done 7 Oct:**
    - **The quote form:** a quote can have lines ("Add lines (items, quantities, prices)"). A line whose text is a stock item's name or SKU is linked to the item and takes its price (`EstimateLinesEditor.tsx`, `src/lib/estimateLines.ts`). One amount still works as before.
    - **Currency:** a quote is saved in the workspace's currency, not always USD. Older quotes keep the currency they were saved with.
    - Quote and order lines keep the item and the quantity, and converting a quote whole keeps the item (`estimateConverter.ts`).
    - An order with stock items is invoiced by quantity: how many of each line now, never more than is left (two decimals at most). The invoice line carries the item and the units, so stock and cost move once for each unit invoiced. The last part of a line takes its exact remainder, so the order is invoiced to the cent. Each invoice line remembers its order line (`metadata.orderLine`) (`orderLineProgress`, `resolvePart` in `src/lib/salesOrders.ts`; the quantity table in `OrderInvoiceDialog.tsx`).
    - A percent or amount part of an order that has item lines is a deposit or progress bill with no item: no stock moves, no cost is booked, and the screen says so. The item is never copied onto a line that was cut by amount.
    - Tests (`order-items.test.tsx`, cost from the real `planInvoiceCogs`):
      - two part invoices together book exactly the cost of the five units, never more;
      - voiding a part gives back its units to invoice again;
      - a percent or amount part, too many units, or too many decimals are refused;
      - a whole conversion books every unit;
      - the quote form saves its lines and its total, and the order dialog makes a draft invoice that carries the item.
      - Stock coming back when an invoice is voided, and a retry never moving stock twice, are the server's existing COGS tests.
  - **Step 2 (Later P0): delivery kept apart from invoicing.**
    - Six things are kept separately: ordered, delivered (a delivery note, M-12), invoiced, paid, stock moved, and cost booked.
    - A deposit never moves stock and never books cost.
    - An invoice moves stock only in a workspace set to "the invoice ships the goods". That is today's behaviour, and it stays the default for simple books.
    - Each delivery moves stock exactly once, also when it is retried. The cost follows the units that left, under the workspace's costing method.
    - A return gives back exactly what its delivery moved (BF-06).
    - Freight and delivery costs are separate expenses, never product cost.
    - **Done 7 Oct (Claude):**
      - **The choice:** an owner picks on Inventory "Stock leaves with: the invoice (default) / a delivery from the order" (`goodsLeaveWith` on the workspace, server only, audited; `PUT /api/v1/inventory/stock-policy`).
      - **Deliver:** on an order with stock items, "Deliver" says how many of each item leave now (never more than is left, two decimals), the date and the location (W-01). The server books one cost entry per order line ('delivery-cogs-auto', DR Cost of Goods Sold, CR Inventory at the item's cost) and lowers stock in the same database transaction, with ids made from the delivery id: a retried request changes nothing (`src/server/services/deliveryService.ts`, `src/lib/deliveries.ts`, `OrderDeliveryDialog.tsx`, `POST /api/v1/inventory/deliveries`).
      - **Undo:** a delivery is undone whole; its entries are reversed and the units come back (`POST /api/v1/inventory/deliveries/:id/undo`).
      - **Invoices:** in delivery mode a new invoice books no cost and moves no stock (the server refuses an invoice cost entry then). An invoice that shipped its goods before the switch keeps doing so when edited, so no unit comes back by mistake. A delivery entry can't be posted directly.
      - **Going back** to "the invoice" is refused while an order is part-way (delivered and invoiced differ), naming the order.
      - **The history** (W-02) names the delivery for each unit that left.
      - Tests: `deliveries.test.tsx` (the rules, the server against the database, the screens).
    - **Goods that came back (8 Oct):** on the order's Deliver dialog, "Came back" records units returned after a delivery: stock comes back in and the cost of goods is taken back at the cost the deliveries of that line booked ('delivery-return-auto', `returnDelivered` in `deliveryService.ts`, `POST /api/v1/inventory/deliveries/returns`), never more than was delivered and kept, safe to retry. Once goods came back, a delivery can no longer be undone whole (that would put them back twice). The money is a credit note, made apart. Tests in `deliveries.test.tsx`.
    - **Still open:** deliveries from an invoice that came from no order.

# SECTION BG — COLLABORATION


# SECTION BH–BP — CURRENCY · COMPLIANCE · OPS

- [ ] BH-02 Storage model decision for 3-decimal currencies
- [ ] BI-01 Fund accounting (vertical — recommend not building)
- [ ] BI-02 Grant tracking
- [ ] BI-03 SOA / SOFP
- [ ] BI-04 Form 990
- [ ] BI-05 Job costing
- [ ] BI-06 AIA G702/G703
- [ ] BI-07 Retainage release
- [ ] BI-08 Certified payroll
- [ ] BI-09 IOLTA trust accounts
- [ ] BI-10 Three-way trust reconciliation
- [ ] BI-11 Matter billing
- [ ] BI-12 Rent roll
- [ ] BI-13 Security deposits
- [ ] BI-14 CAM reconciliation
- [ ] BI-15 Restaurant Z-report
- [ ] BI-16 Marketplace settlement
- [ ] BJ-01 SOC 2 evidence export
- [x] BJ-02 Audit evidence pack (codex, 25 Oct, PR #381): Settings → Security → Audit evidence pack downloads one ZIP for a chosen period — audit trail, period locks, approvals, approval rules and the access review, each a CSV, plus a README of its limits. Browser-built; no server, schema or posting change. See `docs/verification/ai2-c35-c36-2026-10-25.md`.
- [x] BJ-03 Access review report (codex, 25 Oct, PR #381): Settings → Security → Access review lists every person with role, last recorded sign-in, two-step login and last role change, CSV and print, owners and accountants, read-only; limits (500-entry trail window, another person's authenticator not readable) said on screen. See `docs/verification/ai2-c35-c36-2026-10-25.md`.
- [ ] BJ-07 Breach notification
- [ ] BJ-10 ISO 27001 mapping
- [ ] BK-02 QBO API import
- [~] BK-03 Wave import — **10 Oct (Claude)**: Wave's customers, vendors, items and chart of accounts exports import with their columns and account types recognised (CE-09). **Open:** its transactions.
- [ ] BK-04 FreshBooks import
- [ ] BK-10 Full workspace archive
- [ ] BL-02 Spam complaints
- [ ] BL-04 Sender verification
- [ ] BL-06 Resend
- [ ] BL-07 Open / click tracking
- [ ] BM-04 Per-currency rounding
- [~] BM-05 RTL number alignment (AI #1 Appearance settings shipped; AI #2, 11 Oct: P&L, balance sheet, period columns and aging/document-detail/totals isolate existing locale-formatted money with bdi; he-IL minus/accounting DOM cases, mixed Hebrew identity and phone CSV/print verified. Shared Money isolation retained. Remaining primary sales/purchase document lists belong to AI #1; no amounts or financial CSV formats changed.)
- [ ] BM-06 `rateUsedId` per line
- [ ] BN-01 Structured JSON logging
- [ ] BN-02 Slow-query log
- [ ] BN-03 Usage dashboard
- [ ] BN-04 SLO tracking
- [ ] BN-05 Synthetic uptime
- [ ] BN-06 Alert routing
- [ ] BN-07 Runbooks
- [ ] BO-04 Video walkthroughs
- [ ] BP-01 Docker compose
- [ ] BP-02 Emulator setup docs
- [ ] BP-03 ADRs
- [ ] BP-04 Storybook
- [ ] BP-06 Load tests
- [ ] BP-07 Canary rollout

# SECTION CA–CG — FROM 12 OPEN-SOURCE PRODUCTS

- [ ] CA-05 Finance books
- [ ] CA-13 Bank transaction rules with conditions — the conditions exist (AutoRule) and the groups are K-38; closes with K-39 (roadmap 7 Oct, Later P1)
- [ ] CA-14 Bank guarantee
- [ ] CA-16 Item tax template
- [ ] CA-17 Tax rule engine
- [ ] CA-18 Withholding category
- [ ] CA-19 TDS summary
- [ ] CA-20 Tax category per party
- [ ] CA-21 Pricing rules
- [ ] CA-22 Coupons
- [ ] CA-23 Loyalty
- [ ] CA-24 Shipping rules
- [ ] CA-28 Mode of payment
- [ ] CA-29 Party link
- [ ] CA-30 Payment request
- [ ] CA-31 Payment order
- [ ] CB-15 Partner commission
- [~] CB-22 Discount mismatch
- [~] CB-26 Consolidated TB — **step 1 done 8 Oct (Claude), on the group summary:** what the companies owe each other (balances on intercompany accounts: role 'intercompany' or "Intercompany" in the name) is taken out of the group's total assets and liabilities, at the closing rate when translated; if the two sides differ, the difference is said and kept in equity so the total balances (`groupReport.ts`, tests `group-summary.test.tsx`). **Step 2 done 8 Oct (Claude):** sales between the companies (the income and costs of intercompany entries in force between members, in the period) are taken out of the group's income, cost of goods sold and expenses, at the average rate when translated; net income stays the companies' own, so a difference between the two sides is said and stays in it (tests `main-path-group.test.ts` through the app's own intercompany posting, `group-summary.test.tsx`). **Account by account:** on Group Summary since 8 Oct (Z-20), matched by code or name. **Mapping for charts whose codes and names both differ: done 10 Oct** (Z-20, combining lines).
- [ ] CB-28 POS register
- [ ] CC-01 Per-recipient invitation links + view tracking
- [ ] CC-02 Design templates
- [ ] CC-03 Proposals
- [ ] CC-04 Recurring quotes
- [ ] CC-06 Gateway tokens
- [ ] CC-07 Multiple gateways
- [ ] CC-08 Payment terms entity
- [ ] CC-09 Payment types entity
- [ ] CC-10 Expense categories
- [ ] CC-11 Client-group settings
- [ ] CC-12 Passkeys
- [ ] CC-13 User-defined scheduler
- [ ] CC-14 Tasks + statuses
- [ ] CC-15 E-invoicing log
- [ ] CC-16 System log
- [ ] CD-01 Scheduled transactions
- [ ] CD-02 Undo / redo
- [ ] CD-03 Query language
- [ ] CD-04 Formula engine
- [ ] CD-05 E2E encryption
- [ ] CE-01 Account subtypes
- [ ] CE-02 Holdings
- [ ] CE-03 Securities + prices
- [ ] CE-04 Trades with cost basis
- [ ] CE-05 Market data importer
- [ ] CE-06 Rejected-transfer detection
- [ ] CE-07 Impersonation session
- [ ] CE-08 Invite codes
- [~] CE-09 Competitor import — **10 Oct (Claude)**: the customer, vendor, item and chart of accounts imports now map Xero's and Wave's own exports by themselves (Xero's ContactName, EmailAddress, ItemCode, SalesUnitPrice…; Wave's and Xero's account types such as "Expected Payments from Customers", "Customer Prepayments", "Sales Taxes", "Business Owner Contribution", "Prepayment", "Depreciation"), as they already did QuickBooks' (`src/lib/recordImport.ts`; tests `record-import.test.ts`). **Open:** importing their invoices, bills and opening balances.
- [ ] CE-10 Mobile device registration
- [ ] CF-01 Timesheet entity
- [ ] CF-02 Activity under project
- [ ] CF-03 Rate hierarchy
- [ ] CF-04 Working time / capacity
- [ ] CF-05 Per-user bookmarks
- [x] CF-06 Export templates — **26 Oct (AI #2, C-38):** named C-29 column/order choices for indexed report tables and statement period groups, scoped per user/workspace/report on this browser. Apply then use the existing CSV action; changed schemas are refused, and blocked storage is explicit. The feature is on `main`; `export-templates.test.tsx` 4/4 and `column-chooser.test.tsx` re-verified at `116ee530`. Earlier fifteen targeted tests and phone CSV download remain historical evidence.
- [ ] CF-07 Comments on customer / project
- [~] CF-08 Meta fields on any entity — **14 Oct (AI #3)**: A-36 keeps notes as meta fields on eight record kinds and A-37 defines custom fields (text/number/date/choice) on customers, vendors and items with their values in each record's metadata; “any entity” beyond those kinds waits on the reserved document forms.
- [ ] CG-02 Unit of measure
- [ ] CG-03 Payment method entity
- [ ] CG-04 Exchange rate provider + log
- [ ] CG-05 File disk abstraction
- [ ] CG-06 Teams
- [ ] CG-07 Role permissions as data
- [ ] CG-08 Granular RBAC
- [ ] CG-09 Promotion engine
- [ ] CG-10 Region entity
- [ ] CG-11 Sales channel
- [ ] CG-12 Stock location
- [ ] CG-13 Workflow engine
- [ ] CG-14 Locking module
- [ ] CG-15 Translation module

# SECTION DA — CONNECTED WORKFLOWS (owner's roadmap, 7 Oct; `docs/ROADMAP.md`)

New items only for what was not in the tracker yet. The rest of the roadmap expanded existing
items: K-34, BD-01, N-12, Z-12, Z-16…Z-22, Q-05/K-39/CA-13, BF-08, W-01, W-02, BF-06, BD-04,
BD-06, P-08 and BB-07. Each item says its bucket. Only the owner moves an item into V1.

- [~] DA-01 Group of books (portfolio) — **Later P0** (step 1 done 7 Oct: your own groups, Settings → Groups of books; shared groups done 8 Oct; the switcher filter (AI #5's E-1) open): a layer above workspaces, for anyone with access to several sets of books (holding structures, related companies, an accountant's clients).
  - **What a group is:** it has a stable id and a name, and holds several workspaces.
  - **What membership changes:** nothing in the workspace's own ledger, roles or database rules.
  - **What a user sees:** only the members they could already open one by one.
  - **Getting around:** navigation inside a group is searchable and fast (K-34).
  - **Later:** it is the base for reports across workspaces (Z-16), which read each member under the user's own access and never copy entries into a new ledger.
  - **Design first:** a `workspaceGroups` table (owner, name, members), its database rules, and tests that a member the user cannot open stays invisible and unreadable.
  - **Done 7 Oct (Claude):**
    - **The table:** `workspaceGroups` (owner, name, members; migration `20261013070000_workspace_groups.sql`). The owner reads their own; only the server writes (RLS tests: another member and an outsider read nothing, browser writes refused).
    - **The server:** `GET/POST /api/v1/account/groups`, `PUT/DELETE /api/v1/account/groups/:id` (`workspaceGroupService.ts`). Only workspaces the person can open are added (another answers like a missing one). A member they can no longer open is left out when the group is read, and kept unseen when the group changes. Someone else's group answers like a missing one. The data export lists the groups; deleting the account deletes them; no workspace changes.
    - **The screen:** Settings → Groups of books: list, new, change (name and workspaces), remove.
    - Tests: `workspace-groups.test.tsx`.
  - **Shared groups, done 8 Oct (Claude):** the owner shares a group by the other person's sign-in email (Settings → Groups of books → Share; at most 50 people) and can stop sharing. They read it and its group summary, each company only if they can open it themselves (the rest counted, and a group with a parent refused for them, never short); they don't see whom else it is shared with, can't change it, and can leave it. Sharing gives no access to any workspace. Deleting an account takes the person off groups shared with them (`shareGroup`/`unshareGroup`, `POST /api/v1/account/groups/:id/share`, `DELETE …/share/:uid`; tests `workspace-groups.test.tsx`, `group-summary.test.tsx`).
  - **Still open:** the group filter in the switcher (AI #5's E-1). The parent and the ownership share: done 8 Oct (Z-16).

  Every row says why it is there, opens the exact record or step, and says who can resolve it. It disappears only when the cause is really gone; dismissing a row does not remove it. It is fed by what exists today:
  - To Review (`InboxView`) and the notifications;
  - Data Health and the bank connection state;
  - unreconciled lines and the close checklist;
  - client questions (BD-07), approvals (invoices, bills, pay runs, expense claims, requisitions) and missing documents.

  The per-workspace counts also feed BD-01.

    The answer is $X, and clicking it lists the entries and documents behind it (N-12).
  - **AI's part:** AI only reads the question. It never produces the figure.
  - **What the user sees:** the filters it understood, shown with the answer, and a way to change them.
  - **How it calculates:** with the same money and report code as the reports, on the full history from the server.
  - **Permissions:** it respects the user's role.
  - **Incomplete data:** it says plainly when the data is incomplete, instead of counting a capped browser list.
  - **No promises:** never sold as understanding any sentence. Builds on the existing query engine (`TransactionQueryEngine`, `nl-parser`).
- [ ] DA-04 Extension contract — **Later P2**: before any marketplace, a formal manifest (`ledgerflow.plugin.json`, building on the auto-discovered `src/plugins/*.tsx`, `FINANCIAL_ALGORITHMS`, the report and plugin scaffolds, API keys and the registry).
  - **What the manifest declares:** name, id, version, the LedgerFlow versions it works with, the author, menu entries, required API scopes, a settings schema, the collections it reads, permissions, database needs and licence.
  - **Reading:** an extension may read and suggest within the user's permissions.
  - **Changing money:** only through LedgerFlow's own checked actions, never a direct database write. That keeps the workspace boundary, roles, period locks, balanced entries, safe retries and the audit trail in force.
  - **What it enables:** custom work, industry packs and private deployments, without making the core heavier.

  Each entry has its evidence (code and tests, as in `docs/TOOL_REVIEW.md`). The README, Help, onboarding and pricing take their claims from it. A type, a route, an empty screen or an arithmetic-only test never makes something "Available". It replaces the stale `docs/STATUS.md` (TOOL_REVIEW F5).

  The pages take their claims from DA-05.

  **Two real bugs found and fixed:**
  - **Imported income accounts were missed:** an "Income" account imported from a spreadsheet is saved as type `revenue`, which invoice and credit posting, the invoice form's account list, revaluation and four screens did not recognise. Invoices then failed with "Missing Sales Revenue account", and a line on such an account went to the default sales account. Fixed with `isIncomeAccount` (`src/lib/accountUtils.ts`).
  - **Restore was impossible after any close:** restore was refused once any month had been closed, and reopening never clears the lock date. Now a backup made when the books were closed at least as far as now restores normally; one from before the close is still refused, saying why.
  - **Restored entries had no id in the reports:** the report routes read entries without their row id, so after a restore the general ledger's drill-down had empty ids. Fixed in seven readers.

  **Still open:** a signed-in browser run of the same path needs a local Supabase sign-in stack. The original browser plan for this item was: one browser test, signed in, goes through:
  1. create the books;
  2. import accounts;
  3. add a customer, a vendor and an item;
  4. import a bank statement;
  5. invoice and bill;
  6. pay partly;
  7. reconcile;
  8. read the reports;
  9. close the month, and check that a write into it is refused;
  10. back up, restore, and get the same figures;
  11. drill a report figure down to its document.

  It extends `e2e/accounting-lifecycle.spec.ts`. Mixed Hebrew and English data.
- [ ] DA-10 Move a label into its own books — **Research**: when a company that was an Entity label outgrows it (see ROADMAP, "Can a company just be a label?"), move that label's activity into a new workspace in the same group, without retyping. Opening balances move on a chosen date, and there is an audit trail in both. Needs an owner decision on the date and the history kept.

C-39 / CB-22 review note (AI #2, 11 Oct): `DiscountMismatchView` compares current list/catalogue unit prices through the existing price-list helper, with explicit provisional/complete reads, per-unit differences and CSV. Targeted tests and phone accessibility passed; full gates pending. Separate item discount rules, historical list versions and line-discount agreements need AI #1’s storage contract; no historical entitlement claim.

- [ ] SL Spreadsheet Lab (GridCraft, optional, later) — see PLAN §11. Read-only analysis in an isolated iframe; never writes to the books. SL-1..SL-5. Licence default in FOR_YOU 46.

### From the owner's second AI audit (13 Oct) — only the parts the code check showed are real gaps
- [~] AU-1 (17 Oct: server done — `/sync` uses `/transactions/sync` from a saved `syncCursor` per connection, all pages, cursor saved only after the last page, a mid-read change restarts from the same cursor; returns `transactions` (added) plus `modified` and `removed`; test `plaid-sync-cursor.test.ts`. 31 Oct: corrections and deletions are applied to stored lines on the server (AF-001, #439/#455), and the Plaid webhook is in (`/api/webhook/plaid`: a verified SYNC_UPDATES_AVAILABLE notice syncs that connection from its cursor; `plaid-webhook.test.ts`). Merged as #458 with a first sync on connect, webhook registration on reconnect and 503 for Plaid to retry. Left: you set `PLAID_WEBHOOK_URL` in Vercel, see docs/FOR_YOU.md; follow-up: a durable job queue so the webhook answers at once and a failed first sync is retried on its own, CodeRabbit on #458) Plaid: move from `transactionsGet` (plaidRoutes.ts) to `/transactions/sync` with a saved cursor per item, handling added / modified / removed, webhook replay safe.
- [x] AU-4 (done in 4e1aafcd: Reports → Import acceptance, `ImportAcceptanceView`) Migration acceptance by reconciliation: after a QuickBooks/CSV import, show trial balance, A/R, A/P, cash and tax payable against the source, not just a record count.
- [x] ACC-1 (31 Oct: System Command Center → Deep User Matrix → Give access; `POST /api/v1/admin/give-access`, `src/server/routes/giveAccessRoutes.ts`, test `acc1-give-access.test.ts`) Owner "Give access" screen (owner request, 13 Oct): as platform admin, type a person's email, pick Full / Pro / Growth / tester, and it sets bypassBilling or the plan on their workspaces (and can make them admin), with an audit line. Today this needs SQL or the System Command Center per workspace.
- [x] ACC-2 (31 Oct: the jargon was already gone; free access now says "Free access (given by LedgerFlow)", and plan names come from `src/lib/plans.ts` on the badge and the usage panel) Settings → Billing & Plan: remove jargon ("Precision Core v2.0", "institutional rule bridges", "Documentation Protocol … topological registries"); show "Free access (given by LedgerFlow)" when bypassBilling is on; plan names match everywhere (sandbox/growth vs Free/Growth/Pro).

### Prevent the whole family (owner, 13 Oct: "what can prevent all these types of bugs?") — before the single fixes
- [~] PREV-0 **Bug-pattern scanner** (13 Oct, done): `scripts/bug-patterns.ts` finds the seven patterns behind #96–#111 in every client file; `docs/BUG_PATTERNS.md` lists each place (a checklist); `src/tests/bug-patterns.test.ts` fails if any count rises and if the issue sites stop being found. Shared fixes in `src/lib/serverAction.ts` (ActionResult, runOnce, workspaceScope, allSettledWrites). First fixes: #105 transfer (success only when saved, one click), #109 bank file only for accepted payments and no double payment on retry.
- [~] PREV-1 (helpers in `src/lib/serverAction.ts`: runOnce, ActionResult, operationIdFor; used by transfer, payments, import; a single hook still to do) One `useServerAction` hook for every save button: disabled while pending, one idempotency key per click, success shown only after the server confirms, every error shown (never swallowed). Then convert the screens in ISS-A to it.
- [ ] PREV-5 Failure tests by default: a test harness that runs each save action with the server refusing, slow, or switched workspace mid-request, and asserts no success message, no partial write, no stale data. Every new save action gets these three cases.
- [ ] PREV-6 Parsers: fuzz + real-file corpus (F-37, E-56) so import bugs like #101 are found before users.

### Public issues (13 Oct) — money/data safety, AI #1 first (GitHub labels `money`, `priority`)

## Deep code audit findings (PR #144, 16 Oct; details and acceptance tests in docs/DEEP_CODE_AUDIT.md)

Each is fixed with the acceptance test its section names. Server, posting, restore, jobs and security items are AI #1's; AUD-13/14/15 may go to a helper queue.

- [ ] AUD-01 — Statement screen, server JSON and PDF do not have one scope contract
- [x] AUD-02 (18 Oct: every ledger entry in a backup is checked by the ledger door before anything is read or written — an unbalanced one restores nothing; test in `workspace-restore.test.ts`. 20 Oct: the closed-books check, the other-workspace ownership check and the reads of what is deleted now run inside the one serializable transaction that writes the backup, so nothing can change between checking and writing; 17 backup/restore tests incl. the main path pass. 20 Oct: invoices, bills, projects, credit notes and vendor credits in a backup must have the field types a save accepts (an amount as text refuses the backup; missing fields and older status labels are not judged, and unknown fields are kept); the backup export reads every table in one read-only serializable transaction, so it is one consistent moment of the books) — Restore commits atomically, but validation and ownership reads precede the commit transaction
- [ ] AUD-03 — RMA decisions/history remain editable metadata, not server approval authority
- [ ] AUD-04 — Scheduled-report pre-marking trades duplicate avoidance for lost delivery and is not a concurrent claim
- [ ] AUD-05 — Standalone background-job coverage differs from Vercel
- [ ] AUD-09 — Privileged server access means SQL client guards are not a universal safety net
- [ ] AUD-10 — Report fallback and cache completeness need one visible provenance contract
- [ ] AUD-11 — Safe-fetch DNS validation is not a pinned connection
- [ ] AUD-12 — Static Vercel CSP can disagree with the configurable Supabase project
- [ ] AUD-13 — Async auth-derived UI state has no identity generation check
- [ ] AUD-14 — A registered receipt algorithm is a hard-coded demonstration
- [ ] AUD-15 — Client post-success cache inserts request entries rather than a canonical server result
- [ ] AUD-19 — Altman analytical EBIT loses reversal signs
- [ ] AUD-20 — Remote database TLS does not authenticate the server unless a CA is supplied

## Issues and connections (18 Oct)

- [~] ISS-130 *(→ AI #9 from 20 Oct; PR open, ai9/ISS-130)* Inventory unit-cost edits change stock value without a ledger posting (issue #130): cost changes on stock in hand go through a balanced revaluation entry, or are refused.
- [x] ISS-131 *(AI #9, merged 20 Oct)* Inventory valuation as-of date mixes today's stock with past books (issue #131): historical quantities/costs from stock moves, or the comparison hidden for past dates.
- [ ] ISS-143 RMA approvals and quantities enforced on the server in one transaction (issue #143, with AUD-03).
- [x] CON-1 *(AI #9, merged 20 Oct)* US sales-tax table (capability 137) and item taxability (139) used by invoice lines for the supported states; label stays "not verified" for others.
- [x] CON-2 *(AI #9, merged 20 Oct)* US nexus watch (138) on a screen from posted invoices, for the supported states.
- [x] CON-3 *(AI #9, merged 20 Oct)* Israel special VAT areas (141, Eilat) applied to invoices with a test.
- [x] CON-4 *(AI #9, merged 20 Oct)* Israel VAT reporting frequency (161) drives the VAT report period and PCN874.
- [ ] CON-4b (from AI #9, #244) The Israeli VAT return record on the server carries its registration (dealer number), so "filed" can be attributed to one of several registrations; then let the screen clear it per registration. Also check the Eilat Law s.5 subsection numbers against the statute, and the PCN874 bi-monthly header month against the Tax Authority spec.
- [ ] CON-1 *(→ AI #9 from 20 Oct)* US sales-tax table (capability 137) and item taxability (139) used by invoice lines for the supported states; label stays "not verified" for others.
- [~] CON-2 *(→ AI #9 from 20 Oct; PR open, ai9/CON-2)* US nexus watch (138) on a screen from posted invoices, for the supported states.
- [ ] CON-3 *(→ AI #9 from 20 Oct)* Israel special VAT areas (141, Eilat) applied to invoices with a test.
- [ ] CON-4 *(→ AI #9 from 20 Oct)* Israel VAT reporting frequency (161) drives the VAT report period and PCN874.
- [x] DIM-1 (21 Oct: payments recorded on their own (Record payment, and applying a deposit later) carry the paid invoices'/bills' line labels in proportion; the part not applied stays unlabelled; worked figures in `dim1-payment-records.test.ts`. 18 Oct: invoices and bills — receivable/payable, tax, discount and retainage now carry the lines' labels in proportion, so each label balances; the lines' own revenue/expense lines keep exactly their labels; test `labels-every-side.test.ts`. 19 Oct: the payment posted with a paid invoice/bill now carries the document lines' labels in the same proportions — each label balances and a full payment clears each label's receivable/payable to 0 (300 random cases in `labels-every-side.test.ts`; 404 posting tests pass). Left: payments recorded separately (payment records applied to invoices/bills: bank, fees, FX difference)) Labels on every side of an entry (owner, 18 Oct): today only revenue/expense lines and the cost of goods carry the document line's labels. Carry them (in proportion) to receivable/payable, tax, discount, retainage, the payment entry (bank, fees, FX difference), and stock moves; so a P&L or balance sheet by label is complete. Test: an invoice with two labelled lines, paid with a fee → every line of every entry has the right labels and each label's books balance.
- [ ] DIM-2 *(→ AI #9 from 20 Oct)* Stock moves keep where an item came from (vendor/bill/receipt line) and where it went (customer, project, label) — with issue #132 / P2-36.

## Audit of 18 Oct (audit/VERIFIED_BUG_REPORT.md) — AI #1 fixes these, each with the test the report names

- [~] BUG-02 (18 Oct: P&L, balance sheet, trial balance and cash flow drop the server figures when a reload fails and ignore late answers (a request counter); existing report tests pass. Left: a screen test — rendering these views with a workspace set hangs the node test runner (also without the fix), see D-93) A failed report refetch leaves the previous period's server figures under the new date heading (P&L, balance sheet, trial balance, cash flow).
- [ ] DIM-3 Each label kind gets an accounting role: informational (no balancing), fully attributed (every line has a value), or self-balancing (each value balances) — so balancing is applied only where it is required (strategy §16).

## Integrity follow-up of 18 Oct (owner's request; independent AI examination at 507d3cc)

- [~] INT-6 *(AI #9, PR open, ai9/INT-6: the pay link keys on invoice + amount due, the subscription checkout on workspace + plan + price + current subscription; test `int6-checkout-idempotency.test.ts` with a mocked Stripe)* Stripe Checkout session creation (publicInvoiceRoutes, billingRoutes) sends an idempotency key per invoice + amount, so a double click cannot open two payable sessions.
- [~] INT-7 *(AI #9, PR #286: the rest above what is due is the customer's credit in Customer Deposits, flagged `refundReview`, with a notice; A/R never negative; test `int7-online-overpayment.test.ts`)* An online payment arriving for an invoice already paid in full is recorded as an overpayment (customer credit) and flagged for refund review — never silently applied twice. (From the owner's "exactly-once impossibility" exam, 18 Oct: we rely on Stripe Checkout + webhook event ids, which already avoids the impossible case.)



## AI #2 launch-readiness batch — 26 Oct 2026

Completed or re-verified from `main` `116ee530` on `arena/63bdffa0-ledgerflow`; evidence:
`docs/verification/ai2-launch-batch-2026-10-26.md`. Screens and presentation only: no money calculation,
posting, tax maths, `src/server/`, schema, dependency or quality-baseline change.

- [x] **C-38 / CF-06** named export templates: verified existing per-user/workspace/report storage, compatibility refusal and blocked-storage wording.
- [x] **C-54 / C-91** report empty states: one next-action fallback for empty report tables, explicit states where missing, and a 130-report coverage guard.
- [x] **C-65** keyboard shortcut help: verified global and registry-backed screen shortcut lists and their tests.
- [x] **C-67** column chooser on invoices, bills, payments, customers and vendors; locked selection/actions and print restoration.
- [x] **C-68** print-friendly reports: verified report-only print heading with period/entity and report-pack cover.
- [x] **C-85** named report views: report, period, comparison and custom dates by user/workspace on this device.
- [x] **C-87** Excel report exports: one header block with entity, period, basis, currency and generated-at above headings.
- [x] **C-89** report column chooser: verified `ReportTableScroll` coverage of the ten busiest reports and 82 report files.
- [x] **C-90** negative formatting: verified one `moneyText` helper and workspace minus/accounting setting.
- [x] **C-96** exact report links with filters and a stated clipboard-refusal path.
- [x] **C-97** bilingual, searchable accounting glossary with 36 terms, RTL isolation and help/registry wiring.
- [x] **C-98** first-bookkeeping checklist: verified existing first-hour guide with bank, import, invoice, bill, payment, reconcile and report steps.
- [x] **C-101** tax registrations per entity/label: verified existing Tax profiles editor and tests.
- [~] **C-71** empty states everywhere: main lists and registered reports are covered; auxiliary settings/admin lists remain unaudited.
- [~] **C-86** report scheduling: weekly/monthly schedules are stored and sent; an explicit day picker is still open.
- [~] **C-88** PDF consistency: Reports and report packs share their heading/cover; specialized server PDF routes remain separate.

Review round (26 Oct): saved-view comparison/period restore, private query-key allowlisting, blocked-storage drafts, structural report-row detection, incomplete-history empty wording, exact formula-safe Excel headers, the ToolSandbox algorithm period, glossary Hebrew/search and the duplicate CF-06 row were corrected with focused tests. CI workflow `40424080429` refreshed and checked all 40 visual references; 18 intentional PNG changes were reviewed. Details in `docs/verification/ai2-launch-batch-2026-10-26.md` §5.

## Money input fixes (AI #1, 28–29 Oct)
- [x] **AF-010** typed amounts: `readAmountCents` on ten screens (#432); quick entry always posts two lines (#431); a mistyped estimate price no longer freezes the price box (#437).
- [x] **AF-011** decimal comma: `12,50` read 1,250.00 and `1.234,56` read 1.23. Now `1.234,56`, `1 234,56` and `1234,56` read as the decimal everywhere, and `12,50` / `1,23` finish as a decimal only in comma-decimal books, so an en-US save still refuses a half-typed `1,234` (#438).
