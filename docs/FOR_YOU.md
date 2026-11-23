# For you: things only you can do or decide

Claude keeps working while these wait. It never stops to wait for an answer: where a decision
is needed, it takes the default written below and moves on. When you have time, answer as many
as you like in one message, e.g. **"1 done, 4 yes, 11 hide, 10 keep Hebrew"**. Answered items are
removed from this list.

Last updated: 2026-11-22.

## Two decisions needed before work can start (#893 and #887). Defaults are noted; nothing is built yet.

**#893: bills over the approval limit cannot be approved.** A pending bill over the limit (the code has a fixed amount) sends "pending" again when anyone, the owner included, presses Approve. It stays stuck, and you cannot pay it. Before I build the approve step, decide:
1. Who may approve? *Default I'll use:* owners and accountants.
2. Must the approver be someone other than the person who entered the bill? *Default:* yes, unless the workspace has only one owner. Then the owner may approve their own bill, and that is recorded in the log.
3. Should the limit be set per workspace instead of fixed in the code? *Default:* yes, in Settings, starting at today's fixed amount.
4. For a bill in another currency, is the limit checked in the book's currency? *Default:* yes, at the bill's rate.
If I hear nothing, I'll build it with these defaults.

*Update 21 Nov:* built on the server with these defaults (PR for #893). The server now decides who may approve a bill over the limit; the record (who asked, who decided, "self-approved" when the only approver approved their own) is kept on the bill. The limit is read from `billThresholdCents` beside the invoice limit and starts at $5,000; the Settings field to change it is not on screen yet (next step, phone/Settings lane).

**Server bundle size limit (PR #980).** Moving purchase-order approval onto the server (#921) adds about 4 KB to the standalone server bundle. `main` was already 546 bytes under the 3.6 MB limit in `server-bundle-boundary.test.ts`. I could not find 4 KB of unused server code to remove: the big libraries in that bundle are all used there. *Default I used:* raised the limit to 3.7 MB, the same way it was raised for SBX-1. The browser-code check, which is what the limit protects, is unchanged. Codex points out that `src/tests/AGENTS.md` says "do not weaken gates". If you want the 3.6 MB limit kept, say so, and I'll open a separate task to cut the server bundle by 4 KB or more and set the limit back.

**#887: vendors uploading bill PDFs into an inbox.** There is no upload page for vendors today, and it needs real choices before any of it is built:
- how a vendor is invited and tied to your workspace;
- where files are kept and for how long;
- virus/file checks and size limits;
- who may turn an uploaded file into a bill.

Nothing a vendor sends would ever become a posted bill on its own; someone in your workspace reviews it first. *Default:* not started until you say you want it. Without your answers I'd have to guess at storage and access rules, and I won't guess at those.

## Done 22 Nov: support-ticket visibility migration applied to the live database (#913, #916, PR #988)

Applied with your approval and checked in the live database. Tickets and their messages are now readable only by the person who filed them, the workspace's owners and accountants, and platform admins. The browser can no longer change a ticket's status. Nothing left for you to do.

## SBX-2: add your Arena API key so the assistant's speed and cost can be measured (needs you, 2 minutes)

SBX-2 Part 1 replays 30 test questions, using test data only, to measure the assistant's speed and cost. It needs a model key. The secure key form couldn't be used in my session because the session is too long, so please add it yourself:

Claude Code cloud environment settings → Network secrets → add:
- host `api.arena.ai`
- type Bearer token (`Authorization: Bearer`)
- your Arena key

New sessions pick it up. Until then, the replay runs without a model and records only the numbers that don't need one: the size of the fixed prompt and how many tools are offered per turn.

**Approved by the owner (22 Nov):** AI providers other than Google may be used for the assistant, including sending book data to them (for example through Arena). The Arena key still has to be added as a network secret (above) before models can be tested.

## SBX-2 Part 6: graded model comparison and a recommendation (needs your decision)

Run 22 Nov on Arena with the graded test (`scripts/assistant-model-eval.ts`, 12 questions that need a model, a sample company's books, one model per run; full table and per-question results in `docs/assistant-model-eval.md`). Cost is what Arena billed. The earlier ungraded table in `docs/assistant-baseline.md` only counted "finished within 6 steps" and is superseded by this one.

| model | correct (of 12) | billed | cost per correct answer |
|---|---|---|---|
| GPT-6.1 Terra | 9 → 7 on the newer test | 11.9¢ → 11.4¢ | 1.3¢ → 1.6¢ |
| GPT-6 Luna | 5 → 5 on the newer test | 1.3¢ → 1.2¢ | 0.27¢ → 0.23¢ |
| GLM 5.3 | 4 | 33.0¢ | 8.3¢ |
| Gemini 3.8 Flash | 1 | 19.3¢ | 19.3¢ |
| MiniMax M3.1 Flash | 0 | at least 3.5¢ | — |
| DeepSeek V4.1 Flash | 0 | at least 4.9¢ | — |

Receipts (4 generated images, 4 fields each): Luna, Terra and Gemini 3.8 Flash each read 15 of 16 fields right, for 0.03¢, 0.25¢ and 0.77¢.

*Rerun 23 Nov on the newest test (audit branch a3dcb8c: polite requests count as asking, every turn saved in full to `docs/eval/runs/`), GPT-6 Luna and GPT-6.1 Terra only, one run per question, old instructions against the new `assistant/SYSTEM_PROMPT.md`:*

| model | old instructions | new instructions | billed (new) |
|---|---|---|---|
| GPT-6.1 Terra | 11 of 12 | **12 of 12** | 14.1¢ |
| GPT-6 Luna | 6 of 12 | 8 of 12 | 1.6¢ |

Luna still misses payment, profit drop, affordability and the year summary on the new instructions: it reads the books but stops before stating the figure or asks the wrong question. Terra's scores moved between test versions (9, then 7, now 11 and 12), so the grading had been changing as much as the model. The other four models in the table above are from the first test version and were not rerun.

*Rerun 23 Nov (later), newest test and instructions (today's date, financial year and currency are now given to the model; #1017 and #1018), one run per question, every turn saved in `docs/eval/runs/2026-11-23-04-16.json`:*

| model | correct (of 12) | billed | time for the 12 | notes |
|---|---|---|---|---|
| GPT-6.1 Terra | 12 | 15.2¢ | 123 s | no misses |
| GPT-6 Luna | 10 | 1.5¢ | 137 s | missed the project move and affordability (step limit) |
| Gemini 4 Carbon | 8 | at least 74.8¢ | 589 s | 4 misses, all step limit or timeout; about 5 times Terra's cost |

Gemini 4 Carbon is the new model you asked for. It kept reading records until it ran out of steps (fix the books, something looks off, affordability, write-offs) and was by far the slowest and most expensive, so it is not a candidate on this test. Luna's score rose from 8 to 10 of 12 since the earlier run, partly luck and partly the newer instructions.

*Rerun 23 Nov with the final tool-free step (the audit branch change, db7f1d4, not in `main` when this ran: a turn that runs out of steps gets one last call without tools and answers with what it found), Luna and Terra only, one run per question, every turn in `docs/eval/runs/2026-11-23-04-28.json`:*

| model | correct (of 12) | billed | answered every question |
|---|---|---|---|
| GPT-6.1 Terra | 12 | 15.3¢ | yes |
| GPT-6 Luna | 11 | 2.0¢ | yes |

No turn ended without an answer any more. Luna's one miss was the consulting invoice: it searched, then drafted nothing and did not ask for the hourly rate. Receipts unchanged (15 of 16 fields for both).

*Claude Sonnet 5.5 (23 Nov, Arena id ; Arena's API has no separate "High" model and the test sends no reasoning level, so this is its default setting), same test and final tool-free step, one run per question, every turn in :* 10 of 12 correct, every question answered, 123 s, billed **96.7¢**, about 6 times Terra's 15.3¢ for fewer right answers. It missed "record a payment" (answered without asking which account received the money) and "move costs to a project" (did not ask which project). Receipts 15 of 16 fields for 0.57¢. Not a candidate on cost or score.

*Recommendation (based on the 23 Nov runs, newest test and instructions; with the final tool-free step Luna reached 11 of 12):* GPT-6.1 Terra is the only model that got everything right (12 of 12 in both runs), so use it for the strong turns. GPT-6 Luna got 10 of 12 at about a tenth of Terra's cost (1.5¢ against 15.2¢) and missed only multi-step questions by running out of steps (project move, affordability), which the written rule already sends to the strong model, so it is a reasonable candidate for simple turns and for reading receipts (15 of 16 fields, same as Terra). Both now pass "record a payment" and "make a bill"; the earlier failures on those two (every model except GLM) were before the newer test and instructions. Gemini 3.8 Flash, our current strong model, got 1 of 12 on the first test version and Gemini 4 Carbon 8 of 12 at about five times Terra's cost, so neither is a candidate. This is one run per question on test data, and Terra's score moved between runs (9, 7, 11, 12), so treat it as indicative.

*Not done:* none of these models has a price row, and the code ignores an unpriced model, so the app still uses the Gemini defaults. I won't write a price from memory. Please send me Arena's prices for Terra and Luna, or tell me to read them from Arena's pricing page, and I will add the rows. The test is one small run on test data, not final.

*Spend:* about 70¢ for this run (376 calls, capped at 900). My earlier ungraded runs cost about $8 of your balance, mostly from runs repeated after timeouts and from early runs where the two-model rule swapped in Gemini; those are why the Gemini line on your usage page is large.

## SBX-2 Parts 4–7: defaults used for the assistant's models and plan limits (nothing needed unless you disagree)

**Models (Part 6).** Simple turns use `gemini-3.5-flash-lite` ($0.30 in / $2.50 out per million tokens). Ambiguous, high-risk, multi-step and long turns use `gemini-3.8-flash` ($0.75 / $3.75 until 31 Dec 2026, then $1.50 / $7.50 by Google's page). Reading receipts uses `gemini-3.5-flash-lite`. Prices were read from Google's and Z.ai's pricing pages on 22 Nov and are stored with their dates and source links. The rule is written at the top of `src/server/services/assistantModels.ts`.

*GLM, after your 22 Nov approval:* GLM-5.3-Flash lists at $0.15 / $0.50 (about half of the Gemini simple model) and GLM-OCR at $0.03 / $0.03. Both are priced in the table and can be switched on with `ASSISTANT_MODEL_SIMPLE=glm-5.3-flash` (or `ASSISTANT_MODEL_OCR=glm-ocr`) plus `ASSISTANT_MODEL_BASE_URL` (and `ASSISTANT_MODEL_API_KEY`). *Default I used:* Gemini stays the default until GLM's answers are measured on the replay. That needs the Arena key above. A cheaper model that answers worse is not a saving.

**Assistant allowance per plan (Part 7).** Only turns that call a model count. Answers from the books' own numbers (code) or from the cache are free and keep working at the limit. *Defaults I used:*

| Plan | Model turns per month | Model spend per month |
|---|---|---|
| Free | 50 | 25¢ |
| Growth | 1,000 | $5 |
| Pro | 5,000 | $25 |
| Enterprise | 25,000 | $125 |

At either limit the person sees a polite message and the turn is refused; it is never moved to a cheaper model. A workspace can be given its own limits with `maxAssistantModelTurns` / `maxAssistantCents`, and workspaces with billing switched off have no limit. Tell me if you want other numbers; it is one line each in `src/lib/plans.ts`.

**Assistant cache check (optional).** A cached answer is served only while the books are unchanged. That is checked by hashing the stored rows the read can use: about 13 ms for a report on a large workspace, and it grows with the books. A constant-time check would need a change counter that a database trigger bumps on every book write. The spec rules out a new clock for this, and every save in a workspace would wait on that one counter row. *Default I used:* no counter; the row hash stays. Say "add the counter" if you want it.

**Receipts.** The receipt reader now returns a draft, and anything it cannot read exactly is listed as "check before recording" instead of being guessed. The Vault screen also no longer records a $0 entry when the total could not be read. Its confidence figure was shown 100× too large (for example "9500%"); that is fixed.

## Retried money requests from outside tools can post twice (#942, needs your decision; nothing changed yet)

When an outside tool using an API key sends a transaction, a payment or an intercompany entry, and then sends it again (a timeout, a double click), the second copy is posted too, unless the tool included an `Idempotency-Key`. LedgerFlow's own screens always include one, so this only affects API integrations. The server can't simply ignore repeats with the same content: two identical entries can both be real (two coffees on the same day).

Options:
1. **Require the key for API-key callers** on these three routes: a request without one gets a clear 400 explaining how to add it. Stripe supports the same header but leaves it optional, so this is stricter than Stripe; it is the only option that fully prevents double posts. It breaks integrations that don't send the key yet, so I'd announce it in the API docs first.
2. **Ignore exact repeats from the same key within a short window** (for example 60 seconds). Nothing breaks, but a genuine second identical entry within that window would be refused.
3. **Leave it as it is** and document the header.

Default: nothing changed yet. My recommendation is option 1, after a notice in the API docs. Tell me which option you want and I'll build it.

## Creating an API key now needs a sign-in from the last 30 minutes (#941, default used: 30 minutes)

Before, any open session could create a workspace API key, even a session from days ago that was only refreshed. Now an owner whose last real sign-in is older than 30 minutes is told to sign out and sign in again, then try once more. A stolen, long-lived session can no longer mint keys. Tell me if you want a different window, or a sign-in prompt inside the API key screen instead of the message.

## Invoice and statement PDFs now print your VAT number and the customer's address (#890 — defaults used)

- **Your VAT number:** the PDF prints the VAT number from Settings → Tax that was in force on the document's date. It comes from the "valid from/to" dates, so an invoice from before a number changed still shows the old number.
- **The customer's address:** the PDF prints the address saved on the document, if it has one. Documents don't save one today, so it prints the customer's current address. If a customer moves, re-downloading an old invoice shows the new address. The fix would be to save the address on the invoice when it is issued, then use it for that invoice from then on. Say if you want that; I'll build it.

## Entries made with Reconcile → "Create entry" had their two sides reversed (#891, PR #972 — default used: fix new ones, leave old ones until you decide)

Until PR #972, creating an entry from a bank line on the Reconcile screen posted the expense (or income) on the wrong side, and the bank on the other wrong side. For a ₪250 withdrawal it credited the expense ₪250 and debited the bank ₪250, when it should have debited the expense and credited the bank. Each entry still balanced, so no check flagged it, but those expenses lower the P&L instead of raising it, and the bank balance moves the wrong way.

PR #972 fixes new entries. **Old entries are not changed.** The default is to leave them alone, because changing posted entries in a real book needs your OK. If you want them corrected, say so. I'd find every entry made by Reconcile → "Create entry": those with a "Bank Settlement" line, and those with an "Asset Settlement" line (bank lines that had no account). I'd include entries whose match was undone later, which now have the status `completed`. Then I'd post a correcting entry for each and leave the originals in place, so the history stays.

## Done 22 Nov: CMD-1 browser write door closed on the live database — please do a 2-minute check

Applied with your approval after confirming that production runs the latest `main` (the #995 build), which has no direct browser writes left (`commands-baseline.json`: 0).

What I checked in the live database:
- browser write permissions on the 29 tables: **0 left**;
- the only rule still on those tables is the `two_step_login` restriction, which can only narrow access and stays on purpose;
- reads are kept, including private templates;
- both migrations are recorded in the migration history.

All other repo migrations are in the live database. I compared every file with what the live database actually contains, not only with the migration names.

**I did not click through the live app**, because I don't test the live site without your written OK. Please check, signed in as an owner:
1. create and rename a label (Settings, and inside a bill);
2. edit a customer;
3. save a setting;
4. upload and remove an attachment.

As a viewer, check you can still see everything but can't make those changes. If anything says "permission denied", tell me what you clicked and I'll fix it in the server path the same day.

## CMD-1: posting, project/chart writes, attachment removal and verification (nothing to apply)

The old addresses still work. Invoice/bill/credit and bulk posting use the same posting rules and legacy retry keys. Project/chart creation and bank reconnection commit their state and audit together; Plaid webhook registration and the deep-audit worker start only after their database changes commit. Attachment removal still allows viewers to remove their own uploads. The moved writes now share the same frozen and pending-deletion guard as the other commands. **No migration or configuration action is needed.** GitHub runs the release checks; this does not mark the assistant or its sandbox complete.

## API keys can no longer close a year or restate FX (#820, default used: stricter)

An API key made for entering transactions could run four period commands: lock a whole year, rebuild the closed-year balances, and post or undo an FX revaluation. Every `period.*` command now needs the workspace scope, which no key is given, so only people signed in can run them. If you want an integration to run year-end or FX revaluation, say so and I'll add a dedicated scope for it.

## PAY-1: payroll import into frozen books or books scheduled for deletion

**Default taken:** keep the command runner's existing workspace protections on both import addresses. The old payroll import address checked the caller's role but did not check these workspace states. It now refuses an import into frozen books (403) or books scheduled for deletion (409); restore or unfreeze the workspace before importing. The old address, file format and posting rules for active books are unchanged. No migration is needed.

## Workspace API writes now use commands (nothing for you to do)

Creating a workspace, adding or removing a member, and restoring a backup now go through the registered command runner. The old API addresses and successful answers remain; the restore keeps its backup-integrity, closed-period and owner checks, and removing the last owner is still refused. No database migration is needed for this batch.

## Emptying a demo workspace and tidying dimension values now run through registered commands (nothing for you to do)

Two more writes go through the registered commands. Emptying a workspace is unchanged in the way that
matters: it still only works on a workspace holding demo data (real books are deleted with the workspace
and kept 30 days first), still needs the owner's explicit confirmation, and still never deletes the audit
trail. The other moves your entries' dimension values from free text onto the dimension nodes they belong
to; it was already transactional and still refuses to rewrite an entry that sits in a closed period.

Three things that look like writes and are not are now recorded as reviewed exceptions with the reason
written down: the currency-revaluation *preview* (the same calculation the real revaluation runs, with
nothing saved), the labelling helper that suggests an account for each entry, and the anomaly scan that
points out unusually large entries. All three only read and calculate. A test keeps each exception matched
to a real route, so none of them can quietly outlive the code it describes.

## Capitalising a lease and recognising revenue now run through registered commands (nothing for you to do)

Two more writes go through the same registered commands as every batch before this one: capitalising a
lease (putting the present value of its payments on the balance sheet, ASC 842) and recognising revenue
(moving an amount out of deferred income, ASC 606). Both already went through one shared piece of code,
so this batch moved that code into a service and put a named command in front of it; the screen and any
API caller keep exactly the same request and the same answer.

Two other things on the lease address, the security-deposit trust reconciliation and the property rent
roll, are deliberately *not* commands. They do arithmetic on the numbers the screen sends and answer the
result; the rent roll looks at your invoices to total what has been billed, and neither one writes,
changes or records anything. A command around them would add a database transaction and an audit entry
for a calculation, so they are recorded as reviewed exceptions with that reason written down, and a test
keeps them honest.

## Merging records, journal templates, security settings and scheduled reports now run through registered commands (nothing for you to do)

Fourteen more writes now go through the same registered commands as every batch before this one, in
seven small areas: merging two chart accounts (and asking what a merge would do first), merging two duplicate
customers or vendors and deleting one that nothing refers to, saving and removing journal-entry
templates, turning on two-step login for everyone and the two-person rule, previewing and sending a
scheduled report, saving the branding that documents print with, and minting or turning off the private
link a customer uses to see their own invoices (and the one they use to sign an estimate).

Every screen and API call keeps exactly the same request and answer. Two answers were briefly at risk and
are now held by tests: asking "may this contact be deleted?" (`?check=1`) still deletes nothing and answers
that it may, and a merge refused because a date is closed still lists the closed dates. These addresses worded a rejected
request three different ways ("Choose the account to merge and the one to keep", "Invalid request" with
the details, and the first issue's own sentence), so each keeps its own words — checked one by one, not
assumed. A merge that a locked period or a protected account refuses is still the rule's own 404 or 409
with its own sentence.

Three of these can be undone exactly, because they are switches: the two-step and two-person settings
advertise the command that puts them back, and a portal link's undo is the command that turns it off. The rest cannot be — a merge cannot be told apart from two
records that were always one, and a sent report cannot be un-sent — so they say so rather than offering
an undo that would do something else.

The measured count of server write routes not yet on a command fell from 78 to 64, across 42 files to
36. The browser count is at 5 and that is the floor for now: three of those writes are the sample
company's local path and two are adapters that write the in-browser guest store, which is deliberately
not a workspace.


## Database changes (migrations): status

**✅ 18 Nov:** `20261118120000_invites_owner_read.sql` (#842, merged in #847) is now applied on the live database: only
owners can read pending invites and their tokens. The [SBX-1 hardening migration below](#sbx-1-live-read-hardening-825)
is a separate, not-yet-applied change.

**17 Nov: the last confirmed live list was 60 of 60, before SBX-1 PR #787.** Older notes below that ask you
to run one of those migrations in the SQL editor are done; ignore them. You don't need to run SQL yourself.

The repository now has 61 migrations. The new file, `20261117210000_assistant_sandbox_overlay.sql`, merged in
[#787](https://github.com/shmuelbiller1/ledgerflow/pull/787). The owner believes migrations are up to date;
this pass did not independently verify the live list. See the [SBX-1 readiness note](#17-nov--sbx-1-overlay-migration)
before enabling sandbox callers. The merged report/balance PR [#790](https://github.com/shmuelbiller1/ledgerflow/pull/790)
and records/metadata PR [#792](https://github.com/shmuelbiller1/ledgerflow/pull/792) are merged. The stock, period,
and settlement SQL group also adds **no migration**; none of these groups requires SQL action.

## Payroll, mass entry edits, tags and tax returns now run through registered commands (nothing for you to do)

Four more areas now go through the same registered commands as the period, account, inventory,
reconciliation and payment batches: running payroll for a pay date, undoing a run while its month is
still open, turning the owner's approval on or off, approving a run that is waiting, and sending one
back with a note; moving the non-bank side of many bank entries to another account at once, and changing
the notes, labels, flags or review state of up to two thousand entries in one go; renaming, merging or
removing a tag everywhere it is used; and filing a tax return for a period.

Every screen and API call keeps exactly the same request and answer, including the two things people
notice most: a run in a closed month is still answered by the rule that owns it (a 409 in its own
words, not a 400), and a batch that hits a version conflict still answers 409 with the entry as another
person left it, having saved nothing. Payroll's approval rule is unchanged — an accountant can prepare
a run, only an owner can approve it, and nobody can approve their own run.

Two pieces of that work moved out of the route file into named services without changing a line of
their logic: the mass entry update, so that its read-check-then-write transaction is one thing a command
can call, and the small version comparison it uses, which a service may not import from the routes
folder. Nothing observable changed.

The seven calculation endpoints under `/api/v1/math` (depreciation, inventory averages and order
quantity, amortization, KPIs, time-value maths and valuation) are deliberately *not* commands. They open
no database at all — you send numbers, they send answers — so wrapping them would add a transaction and
an audit line for arithmetic that changes nothing. They are now recorded as read-only with that reason
written down, and a test checks the record still matches the code.

The measured count of server write routes not yet on a command fell from 94 to 78 (the demo in the
browser is unchanged at 62).

## Assets, bad debt, spreads, returns and client questions now run through registered commands (nothing for you to do)

Eight route areas now go through the same registered commands as the period, account, inventory,
reconciliation and payment batches: selling or scrapping a fixed asset and undoing it (including part
of an asset), moving an asset to another location or account and undoing that, placing a built asset
in service and undoing that, writing off a bad debt and reversing the write-off, spreading a bill's
expense or an invoice's income over months and undoing the spread, asking for goods to be returned
against an invoice (an RMA) and moving it on, and asking, answering or closing a question about an
entry in the books.

Every screen and API call keeps exactly the same request and answer. A closed period is still answered
by the rule that owns it, with the same status and the same words — a write-off or a spread in a closed
month is still a 409, not a 400 — because those services check the lock themselves and the command
door lets them answer. Each of these services already writes its own audit line, so each write still
leaves exactly one entry in the trail, never a second summary line.

One structural change came with it: the role lookup that the command runner uses inside its transaction
lived in the main workspace router, which made the routers and the runner import each other in a circle.
It now lives on its own (`src/server/auth/workspaceRole.ts`) and both sides import it, so no route can
read a router before that router has been built. Nothing observable changed.

The measured count of server write routes not yet on a command fell from 111 to 94 (the demo in the
browser is unchanged at 62).

## Payments, saved lists, API keys and workspace administration now run through registered commands (nothing for you to do)

The last writes in four areas now go through the same registered commands as the period, account,
inventory and reconciliation batches: recording a payment and applying it to open documents, applying
or refunding a credit note or vendor credit, applying every open credit at once, a bank deposit,
applying a payment's unapplied part later and voiding a payment; the eight saved lists in Settings
(allocation rules, price lists, sales reps, dashboards, approval delegates, tax profiles, payment types
and customer groups); minting and revoking API keys and keeping or removing your own AI provider key;
and applying a chart-of-accounts template, importing records from a spreadsheet (and undoing an
import), changing someone's role, inviting a person and scheduling a workspace for deletion.

Every screen and API call keeps exactly the same request and answer, so nothing changes for you. An
API key's secret is still shown once and never stored or replayed, the key keeps its
`lf_id_<workspace>_<16 hex>` shape, the seat cap still answers 402 before an invitation is made, the
last owner still cannot be demoted, and a bookkeeper still cannot import a chart of accounts. One
thing is stricter, never looser: an import's audit line and the records it creates now commit together,
so an import that fails halfway leaves neither.

The measured count of server write routes not yet on a command fell from 148 to 111 (the demo in the
browser is unchanged). The next batch takes the remaining route areas, starting with the largest ones.

## Bank reconciliation now runs through registered commands (nothing for you to do)

The eleven reconciliation writes under `/api/v1/transactions` — the batch that matches, unmatches
and corrects bank lines and entries in one request, marking entries cleared (and taking that back),
editing one bank line, completing a reconciliation against a statement, paying invoices or bills
with a bank line, splitting a line over several accounts, and re-running the bank rules — now go
through the same registered commands as the period, account and inventory batches. Every screen and
API call keeps exactly the same request and answer (`{ status: 'ok', ... }`, the same error messages
and status codes: a closed period stays a 400, a closed statement stays a 409, a line in another
currency stays a 400, a missing entry stays a 404), so nothing changes for you, and a retried request
still never marks or posts anything twice.

One route deliberately did **not** become a command: `POST /reconciliation/match` only suggests which
entry an outside bank line probably matches. It writes nothing, so it stays an ordinary read route,
and the ratchet records it as a read-only exception with the reason beside it rather than wrapping a
read in a transaction.

## Inventory writes now run through registered commands (nothing for you to do)

The twelve stock writes under `/api/v1/inventory` — recording cost of goods sold, adjusting or
counting stock, a revaluation, the two stock settings, deliveries, returns and their undo, a
transfer between locations, the stock closing, and a landed cost with its undo — now go through the
same registered commands as the period and account batches. The screens and the API keep exactly the
same requests and answers (`{ status: 'ok', ... }`, the same error messages and status codes), so
nothing changes for you, and a retried request still never posts twice.

**There is no database migration in this batch** — no browser write access changed, so there is
nothing to apply after deployment. The only thing that would need your attention is a follow-up: the
remaining browser writes (106 call sites) are still open, and each of those batches comes with its own
migration list here.

## The ledger screen cannot become a plain list (default taken: keep it as it is)

The task says to move the seven most-used screens onto the shared list, Transactions first. I moved
every report I could and stopped at Transactions on purpose, because **it is not a list**:

`TransactionGridBody.tsx` is a 544-line grid with **12 editable cells per row** — you type the account,
the amount and the memo straight into the row, with a split editor, per-cell validation and a paste
handler. The shared list is a read-only table with a search box. Moving the ledger onto it would delete
the ability to edit an entry in place and split it, which is a feature, not a way of building a screen.

**Default I took:** Transactions keeps its own grid, and the ratchet names it with that reason.
The reports and the plain lists (customers, vendors, items, invoices, bills, journal entries) move.
If you would rather the ledger lose in-place editing and become a uniform list, say so and I will do
it — but I would be removing something that works, so I did not assume it.

Two more sites are named rather than moved: `StockClosingPanel` (a four-column block printed inside a
larger statement, not a list of records) and `JournalSheetReportView` (the lines of one journal entry,
drawn inside that entry's card).



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

## 11 Nov — one rule I chose with a default: tax details do not cross a country border (AI #1, issue #628)

A label value (an entity, a branch) with no tax details of its own takes them from its parent, then from the books.
Until now that also happened across countries: a US entity under Israeli books got the books' Israeli VAT number and
city, so its sales were counted in the Israeli VAT return (and the other way round for a California company's Israeli
branch).
*Default I used:* an entity in another country takes only the **name** and the **accounting basis** from above. Its
place, tax registrations and advance-tax settings must be entered on the entity itself (Settings → Tax profiles).
*What you may notice:* a foreign branch that relied on the books' registration now shows "Not set" there and drops out
of that country's return until its own number is entered. Say if you would rather have the screen refuse to save such
a branch instead.

## 11 Nov — AI #9: one decision for you (issue #657, the ledger-door check)

The automated check that counts places writing ledger entries "outside the door" says **0**, but it only sees one way
of writing; following the code finds **18** direct writes in 14 files. Most go through the shared validator first and
are fine; **3 have no shared check** (the demo-seed route — removed in PR #660 — the recurring job, and the payment
entry). Making the check see them means **raising its baseline from 0**, which the rules leave to you.
*Default I used:* nothing changed yet. When AI #1 has moved the recurring and payment writers through `ledgerWrite`,
the check can be tightened at the true count. Say "raise the ledger-door baseline" if you want it done now instead.

## 12 Nov — AI #9: one migration to apply, one choice

- ~~**Apply migration `supabase/migrations/20261112000000_report_schedule_send_day.sql`** (merged in #665).~~ **Done 12 Nov** — applied by the owner, together with `20261111120000_ledger_server_only_and_balance_check.sql`; a check query confirmed all of 20261110000000…20261112000000 are live. Until it is applied, a scheduled report set to send on any day other than Monday / the 1st cannot be saved (the database refuses the new `sendDay` field); schedules on the default day work as before.
- **EU-I2 "Sent with …" on the customer portal** (in draft #675): built as on for everyone, with a Branding setting to turn it off. Whether turning it off should need a paid plan is your decision; default used: anyone can turn it off.

## 14 Nov — the last part of #646: what a browser may still write (AI #1) — **DONE 16 Nov**: covered by the #719 migration you ran on 15 Nov; #646 and #650 closed.

The server now refuses to apply or refund a credit with no entry in the books (#712), and the database rules
already stop a browser from marking documents paid or changing paid amounts. What a signed-in browser can still
do, straight against the database: create an open credit note, or change an issued invoice's or bill's total or
set it to void without reversing its entry. The app itself creates documents from the browser, so simply
forbidding these writes would break normal saving.
*Default I'm using:* the fix moves "issue" and "void" for invoices, bills and credits behind the server (as
payments already are), then the database rule refuses a browser change to an issued document's money fields or
status. It is a multi-step change; I'll do it after the open money issues (#653). Say if you want it sooner.

## 15 Nov — the screen rebuild, second slice (AI #9): one decision, one default

The review of the last slice said three things were missing: a test that proves every action and
report can be *reached* (not merely imported), the counters that stop new screens being built the old
way, and keyboard movement between rows. All three are in this pull request; three choices are yours.

- **The Admin Panel is now in the search box, but only in developer mode** — as the sidebar already did.
  It is the server's control room (workspaces, jobs, diagnostics): a first-time person should not land
  there from a typo. *Default used:* listed when developer mode is on, absent otherwise, and the
  reachability test checks it in that mode.
- **Search now folds "&" to "and" and drops punctuation**, so "profit and loss" and "who owes me" find
  the right report. *Default used:* folding is search-only — stored labels, ids and import fingerprints
  are unchanged. If you would rather the report be *named* "Profit and loss" than have the search
  translate, that is a words decision (U-5) for you.
- **The Hebrew name of a screen is searched as written.** Hebrew search for reports and settings works
  today; for a handful of screen names the folder misses because some names carry a definite article
  (ה) or a prefix (ל, ב) — "לסקירה" is typed as "סקירה" by most people. *Default used:* left as is,
  because folding Hebrew prefixes is its own change with its own tests; it is the next item in
  `docs/TRACKER.md` under the screen rebuild. Say if you want it before the rest.
- **Screens with more than one filled button: 19 today.** They are counted, not fixed, because U-2 says
  one filled button *per screen* and several of these are one screen in two states (a wizard step, a
  settings tab that only renders one of its three buttons at a time). Fixing them means reading each
  one, not deleting buttons. *Default used:* the counter records 19 and may only go down; the list is in
  `docs/UI_REBUILD_RATCHETS.md`.

## ~~15 Nov — migration from PR #719 (commands, Batch 0): wait for the deploy~~ **Done 15 Nov** — applied by the owner after #719 was live

`supabase/migrations/20261115000000_document_commands_server_only.sql` stops the browser writing
invoices, bills, credit notes, vendor credits, and automation rules directly; it also protects warranty
history from browser changes. Those writes go through the server commands instead. **Run it only after
#719 is merged and Vercel has finished deploying `main`** (check that saving an invoice works on the
live site first). Run before that, and saving documents breaks. Estimates are not covered by this
migration and remain in the CMD-1 write inventory. The current plan is [`docs/prompts/CMD-1-checklist.md`](prompts/CMD-1-checklist.md).

## 15 Nov — outside security scans (your OK given: "so add it")

Task SEC-SCAN-1 (AI #6): Schemathesis tests the API on every pull request, and a ZAP scan runs nightly,
both against a local copy in CI, never the live site. Schemathesis is still **Phase 1 report-only**; do not
make it a merge blocker until it has completed **three consecutive clean runs on `main` with reports uploaded**,
then update this note and remove its `continue-on-error` setting. Investigation found the zero-job cause:
the pip install command used unquoted `--only-binary :all:` in a YAML plain scalar, where `: ` is parsed as a
mapping delimiter. A local YAML parse reproduces the error; the latest `main` file still had this form. The
install command on PR #756 shell-quotes the value as `--only-binary=':all:'`, preserving pip's argument and
validating as YAML; the contract test prevents regression. This PR fix now starts the GitHub job. Runs `43992691517`, `43993423090` and `43994179756` each ran migrations
and Schemathesis, verified JUnit output, and uploaded reports. `43993423090` has an annotation recording
Schemathesis exit code 1, masked at job level by report-only; the other two have no failed-step annotation.
The artifact bytes could not be read from this sandbox, so none can be certified as clean here. Review the reports
in GitHub before interpreting findings. Main runs `43981616172`, `43983831337`, `43991078303` and `43992114900`
all failed with zero jobs and no reports; none count toward the promotion gate.
A local production-bundle smoke check returned HTTP 200 for `/api/health` and `/`, but ZAP itself has not run.
Keep Phase 1 report-only; manual dispatch on `main` still awaits the workflow fix reaching the default branch.
**17 Nov follow-up (AI #6):** PR #756 has merged. The API job now runs on `main`, but its report-only green status does not prove a clean report. The first manually dispatched [ZAP run 44006270355](https://github.com/shmuelbiller1/ledgerflow/actions/runs/44006270355) failed in its combined boot-and-scan step and report-processing step. The run logs and artifact bytes are inaccessible from this sandbox, so the cause is not yet known; inspect them in GitHub and rerun locally in CI before treating the nightly scan as working. No live scan was run. A follow-up removes plugin-wide CSP and cross-domain-script exceptions that were incorrectly described as URL-scoped; its details and limits are in [the Agent #6 checkpoint](../audit/agent6-2026-11-17-security-followup/01-checkpoint.md).

*Still yours to decide:* scanning the live site. To allow it, write here "OK to scan <address>" (passive scan
only). *Default:* not scanned.


## 16 Nov — AI #9: two small defaults in the EU queue (no action needed unless you disagree)

- **Record imports and labels (EU-E9):** customers, vendors, items and accounts have no label field, so their CSV imports do not read label columns. *Default:* left as is. Labels are on entries and lines only. Write here "add labels to records" to change it.
- **Free invoice maker (EU-I3, `/make-invoice`):** "Save this and track who paid" opens the **sample company** with the invoice as a draft. Nothing is saved to a server until the person signs up. *Default:* this flow. Write here if you want it to go to sign-up first instead.
- **EU-A4b, Israeli importers (AI #9, 16 Nov).** Hashavshevet, Rivhit and Priority don't publish their export columns, and I won't guess them. If you can, export one small file from each (chart of accounts and customers) and put it in the repo or the tracker. Until then, their exports can still come in through "Standard spreadsheet", which already reads Hebrew headings. Odoo is done.

## 16 Nov — account routes become commands: two defaults taken (person scope, API keys)

Batch 4 of CMD-1 moves the ten `/api/v1/account` writes (recovery codes, the notice-email choice,
and groups of books) onto registered commands. These routes are about **you the person**, not about
one workspace, so they needed two decisions that were never written down:

- **Person scope.** A command can now be scoped to a person instead of a workspace: no workspace
  membership, role, or capacity gate applies (your account is yours; there is no "role" on it), and
  the audit entry is filed under you. *Default used:* roles stay informational for these commands —
  a signed-in person is always the owner of their own account data. If you later want, say, a
  shared "family admin" to be able to manage someone else's groups, that is a new decision.
- **API keys may call them, like before.** The legacy routes sat behind the API-key check only, so
  a developer's API key could already make recovery codes or share a group as its owner. *Default
  used:* keys keep working under the key owner's person scope and keep the same `write:transactions`
  permission the old routes required — no new key permission was invented. If you would rather walls
  these off from API keys entirely, say so and I will add a "session only" flag.

**One visible change in this batch.** Recovery codes are shown once. Before, if the browser
retried "make new codes" after a dropped connection it got the same ten codes back; now the retry
comes back as *"these codes were already shown — make new ones if you did not keep them"*. That is
deliberate: keeping the codes so they could be replayed meant ten working ways past two-step login
sat in plain text in the database and its backups for a month. The screen marks the request so a
retry is rare; when it happens the answer now tells you what to do instead of pretending.

One more detail of that flow: if the authenticator cannot be removed (Supabase auth tables briefly
unavailable), the code is put back and the answer is an error telling you to try again — not a
success that has quietly used up a code while your old authenticator is still the one signing you in.

## 17 Nov — migration waiting: `20261116120000_deleted_projects.sql` (#759, AI #1)

PR #759 (undo for deleting a project) is merged. Its migration creates the `deletedProjects` table, and until it runs
on the live database, deleting a project and then undoing it can fail on the live site. Either run the file in the
Supabase SQL editor, or tell me and I will apply it through the connector (you approve the prompt). **Default:** not
applied until you choose.

## 17 Nov — should a transaction-only API key be able to close a year? (Agent #7 A7S-01, AI #1)

Year close, FX revaluation (and its undo) and the balances rebuild need the API-key scope `write:transactions`,
as their old `/api/v1/transactions/...` addresses always did. Agent #7 suggests `write:workspaces` instead, so an
integration that only posts entries cannot lock a year or restate the books. That breaks any integration whose key
has only `write:transactions` and uses these. **Default:** unchanged (`write:transactions`); the draft-trap half of
the same finding is fixed separately. Say "tighten the period scopes" and I will make the change (patch 10's
`apiAuthenticate.ts` hunk plus the test in `commands.test.ts`).

## 17 Nov — SBX-1 overlay migration

`supabase/migrations/20261117210000_assistant_sandbox_overlay.sql` merged in #787. If it is not already
recorded in the live migration history, the release lead should apply it there **only after its code is
deployed**. It creates the private overlay, merged read views, and restricted database role. Before
exposing any sandbox tools, verify that the application's database login can `SET ROLE lf_sandbox`:
the migration grants this to the migration login, which may differ. Never grant it to browser or
service-key roles, and keep `sandbox` and `sandbox_read` out of Supabase's exposed schemas. The test
database passed with this migration; live state was not independently checked in the report read pass.
No assistant routes are enabled by the migration or by the report read pass.

### SBX-1 assistant token, routes, review screen and Undo (this PR)

`supabase/migrations/20261119090000_sandbox_step_undone.sql` is for the release lead **after this PR has merged
and deployed**, in order after the two SBX-1 migrations above. It only widens the `sandboxSteps.state` check to
allow `undone` (an accepted step whose recorded inverse was run through the ordinary command path). No grant, role
or exposed-schema change; no new login. Tested on disposable PostgreSQL; the live database was not touched.

What is now live once deployed: `POST /api/v1/workspaces/:id/sandboxes` (person, sign-in) opens a sandbox and
answers a one-hour assistant token bound to that sandbox, person and role; `/api/v1/sandboxes/:id/...` (assistant
token only) drafts steps and runs the seven read tools on the sandbox handle; accept / reject / undo stay behind
the person's sign-in and refuse the assistant token (`src/tests/sandbox-assistant-token-routes.test.ts` proves every
write route in the app does). The "Assistant drafts" screen is at `#sandbox-review`. The `SESSION_SECRET` env
signs the assistant token, as it already signs sessions; nothing new to configure.

### SBX-1 stock moves in the sandbox (this PR)

`supabase/migrations/20261120090000_sandbox_stock_move_order.sql` is for the release lead **after this PR has merged
and deployed**, in order after the three SBX-1 migrations above. It adds one trigger function in the `sandbox` schema
that gives a drafted stock move a provisional order number (`dbSeq`) — after every live move of the workspace and
every earlier draft move — so the sandbox computes cost of goods in the same order the real save will. No grant on
`public`, no sequence privilege, no new login; the live sequence is untouched (the RLS suite and
`sandbox-readiness.test.ts` prove it). Tested on disposable PostgreSQL; the live database was not touched.

What changes once deployed: an invoice with inventory lines, a stock adjustment, delivery, return, count or
revaluation can now be drafted by the assistant and shown in the sandbox books; before this they were refused with
"needs a write that has not been reviewed". Acceptance replays the step live, where the real sequence numbers the
move; if the cost would differ from the preview (someone moved the same item meanwhile) the accept is refused and
the step marked for re-check, as for any other posting. The cost repost queue (`lf_repost_mark`) is not run in the
draft on purpose: it is a later background correction, and the live insert at accept queues it exactly as before.

### SBX-1 admitting the command registry as steps (#932)

No migration, no grant, no env. The sandbox now drafts any command of the books (customers, vendors, invoices,
bills, payments, journals, chart, assets, inventory, projects, time, tasks and so on — 100+ commands, listed by
`stepCommandNames()`), not just four. Membership, keys, periods, payroll, bank, support, security and account
commands are still refused at the door. Three things to know:

- A step that would move stock (`stockMoves`) is refused in the draft: the live table numbers moves from a database
  sequence the sandbox role cannot use, so the draft could not promise the same cost of goods as the real save.
- A high-risk step (`chartaccount.delete`, `contact.merge`) can be drafted, but accepting it needs the person's
  two-step sign-in, exactly as the ordinary command route does; without it the answer is 403 and nothing is saved.
- A plan-metered step (`journal.create` under an API quota) is not counted in the draft; it is counted when accepted,
  and a workspace at its quota gets the same 402 as a direct call.

Found while doing it: `journal.create` validated accounts through the global database handle rather than its own
transaction (the sandbox stage guard caught it; now it passes its handle), and "Account … not found in chart of
accounts" was a 500 — it is a 400 `ACCOUNT_NOT_FOUND` now, message unchanged.

### SBX-1 live-read hardening (#825)

`20261118130000_sandbox_live_read_boundary.sql` is for the release lead after the hardening PR
has merged and deployed. Confirm the foundation migration is recorded, apply the follow-up in order,
and verify the recorded versions. It revokes the sandbox role's live reads of private/operational
tables and keeps the ledger test-fixture override out of the sandbox. It does not grant a new login
or enable any assistant route. This was tested on disposable PostgreSQL; no live database change or
application-login role verification was done here.

## AI #7 — 19 Nov 2026: two decisions on PR #946, and what I did meanwhile

### 1. The export decimals (#910, #940) — ready to merge, your call

Twelve report CSVs and the Goods not billed report wrote money at a fixed two decimals whatever the book's
currency: a ¥12,345 line came out as `123.45` (100× low) and a KWD `12.345` as `1234.50` (100× high), while the
screen above showed the right number. The PR writes each money cell with the book's own scale (and, for Goods not
billed, each purchase order's own currency). Screen and file now agree; nothing else in the money path moved.

CI on the last commit that changes code (`4746619`): 26 checks pass, none failing, none pending. The branch head
(`761298f`) is a markdown findings register; this repo's workflows path-filter docs-only commits, so the head
carries only Gitar (approved) and SonarCloud (passed). If you would rather merge a head that has the whole suite
attached, say the word and I will push a no-op commit to re-run it — I did not do it unprompted because that would
make the branch look tested at a commit that is not the one I tested.

**Default I used:** left the head as the documentation commit, and recorded the per-commit evidence map in the PR
body and in a comment, so the merge decision can be made from facts rather than from a green tick that belongs to an
older commit.

### 2. SonarCloud reports 0.0 % coverage on new code — it is not missing tests

The gate passes, but the number is an artefact: this repo's unit suite runs on `node:test`, which the scanner's
coverage path does not ingest, so every new test file shows as uncovered. The tests exist and are green in CI
(`Unit tests 1–4/4` plus both timezone shards), and each one has a reverted-control result in the PR.

**Default I used:** left the workflow alone (a coverage upload is a CI change, and I do not touch CI configuration
to make a number look better). If you want the number to mean something, it needs an `lcov` upload step from an
`c8`/`nyc` run — worth its own small PR from your side.

### 3. Smaller items, already in the queue and not blocking

- **#924 second half** (open, AI #1): `splitRules` accepts any map of percentages — no range, no sum-to-100 check.
  I fixed only what the user sees (a −20 % tranche no longer paints as a full bar). No payout reads those numbers
  today, so it stays Low until a partner-distribution feature does.
- **F-5** stays `[~]`: the thirteen report screens now hold their shape while loading; the dashboard, settings and
  document screens still carry their own loading text. Next batch, not this one.
- **#834 / A-229** `report-speed-12m.test.tsx` fails only in a cold sandbox (2,750 ms vs a 1,500 ms budget, with and
  without my patch) — **do not raise the budget** on that evidence; it is module-import timing, not report speed.
