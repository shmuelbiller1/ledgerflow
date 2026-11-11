# Making LedgerFlow easier than QuickBooks and Odoo

Written 10 Nov 2026 from a read of the code. Nothing here was clicked through in a browser, so each
finding says where in the code it comes from. Items marked **(bug)** look broken today, not just
improvable.

## Where the two big names are weak, and where LedgerFlow can win

- **QuickBooks** is easy to start but shallow: two tracking fields (Class and Location), little
  control over which entries must carry them, and no balance sheet per class. People outgrow it and
  move to spreadsheets.
- **Odoo** is deep but takes a consultant: many modules, many settings screens, accounting words
  everywhere.
- **The gap between them** is a product that starts as simple as QuickBooks and reveals depth only
  when asked. LedgerFlow already has the depth (any number of labels, required labels,
  self-balancing labels, balance sheet by label). What it lacks is the simple start and the reveal.

So the strategy is one sentence: **show five things on day one, fill everything in automatically, and
keep the other 150 things one search away.**

## Do these first (largest effect for the least work)

| # | What | Why it matters |
|---|---|---|
| 1 | Let the public open the site, and fix sign-up email (owner items 4, 5, 7 in `FOR_YOU.md`) | Nobody outside your Vercel account can reach it today |
| 2 | Fix the phone bottom bar (D-1) | It appears to show nothing |
| 3 | "New → Invoice" opens the invoice form (B-1) | The most used button does not do what it says |
| 4 | Short invoice and bill forms with "More options" (B-2) | 20 fields are shown at once |
| 5 | One word for labels everywhere (E-1) | Five names for one feature |
| 6 | Defaults from the customer, vendor and item (B-4) | Removes most typing |
| 7 | Business-type choice that sets accounts, labels and modules (A-2, F-1) | The on/off modules exist but nothing picks them for the business |
| 8 | A guest demo people can really use (A-1) | Guests can look but not save |
| 9 | Hebrew that covers the screens, not only the menu (G-1) | The Israel tax features have an English interface |
| 10 | Snap a receipt from the phone (C-3) | The habit that keeps people in a bookkeeping app |

---

## A. The first five minutes

**A-1. A guest demo that works.** Guest mode says "you cannot save a chart of accounts, customers,
invoices, bills, payments or bank imports" (`src/components/onboarding/FirstHourGuide.tsx`). A
person who cannot try creating an invoice has not tried the product.
*How:* load the existing sample year (`src/lib/sampleBusinessYear.ts`) into a browser-only copy for
guests, let every form save into it, and show one banner: "Sample company — sign up to keep your own."

**A-2. Ask one question first: "What kind of business?"** The wizard has four steps: business,
chart of accounts, opening balances, done (`src/components/onboarding/SetupWizard.tsx:25`). Opening
balances stop new users cold.
*How:* step 1 becomes business type (shop, services, property, construction, non-profit, freelancer).
The answer picks the chart template, a set of labels (E-7) and the visible menu (F-1). Move opening
balances out of the wizard to a "Bring in last year's numbers" card on the overview.

**A-3. A checklist that ticks itself.** The first-hour guide is eight links and says "they do not
save records or mark steps complete" (`FirstHourGuide.tsx`).
*How:* derive each tick from real data (a customer exists, an invoice is issued, a bank line is
imported) and show "3 of 8 done" on the overview until finished.

**A-4. "Coming from QuickBooks?" on the first screen.** Importers exist for QuickBooks Online, Xero
documents, FreshBooks and Zoho Books (`src/components/migration/QBOMigrationWizard.tsx`,
`src/lib/freshBooksImport.ts`, `src/lib/zohoBooksImport.ts`) but live under Settings.
*How:* offer them in wizard step 1, ending on the existing trial-balance proof
(`MigrationTrialBalanceProof.tsx`) so the person sees the totals match. I found no importer for Odoo
or for the Israeli packages (Hashavshevet, Rivhit, Priority); those are worth adding for your market.

## B. Everyday speed

**B-1. "New" opens the form. (bug)** New → Invoice, Customer or Bill only switches tab; the comment
says "Ideally we would trigger a specific 'create' modal here" (`src/components/layout/QuickCreateMenu.tsx:24`).
*How:* reuse the record links that already open dialogs (`src/lib/recordLinks.ts`) with a `new`
target, and add keys in `src/config/shortcuts.ts` (for example `n` then `i` for invoice, `b` for bill).
Today's keys only move between screens (`src/App.tsx:313`).

**B-2. Short forms.** The invoice form shows about 20 fields at once, including Invoice Type,
Progress Percentage, Retainage, Deposit, Milestone and Exchange Rate, with no folded section
(`src/components/sales/InvoiceModal.tsx:316-600`); the bill form is similar (`BillModal.tsx`).
*How:* show Customer, Date, Due, Lines, Tax. Put the rest under "More options", opened automatically
when any of those fields has a value, and remember the choice per person.

**B-3. Never lose typed work.** I found no autosave of half-filled forms.
*How:* keep each open form in browser storage keyed by form and workspace; on reopening offer
"Continue your unsaved invoice?".

**B-4. Defaults from who and what.** I found no default labels, account or tax on customers,
vendors or items.
*How:* add optional defaults to those records and apply them when the party or item is picked
(`src/components/common/DocumentLineEditor.tsx`, `LineLabels.tsx`). Also learn silently: suggest
the account and labels used on the last three bills from the same vendor.

**B-5. Undo instead of "Are you sure?".** Only two actions offer Undo in their confirmation message.
*How:* for anything reversible (categorise, label, archive, mark paid) act at once and show
"Done · Undo" for ten seconds. Keep confirmations for void and delete only.

**B-6. Typed entry that cannot post to the wrong place.** Typing "paid $40 gas" in the command
palette posts straight to the first expense account found (`src/components/layout/CommandPalette.tsx:72`),
and the preview always shows US dollars (`src/lib/algorithms/nl-parser.ts`).
*How:* choose the account with the same rules engine the bank feed uses (`src/lib/MatchingEngine.ts`),
show a one-line preview with account and labels to confirm, use the workspace currency, and accept
`#label` and `@vendor`.

## C. Bank and receipts (where the hours go)

**C-1. Say why, not a made-up percentage.** When an entry has no confidence stored, the review
list assigns 92 or 75 (`src/components/ledger/InboxView.tsx:22-30`).
*How:* show the reason instead ("rule: Shell → Fuel", "same as last 4 times", "guess"). Offer
"Accept all with a rule or history" as the one main button.

**C-2. Review with the keyboard.** *How:* up/down to move, Enter to accept, `c` to change account,
`l` to set a label, `r` to make a rule. Fifty lines should take two minutes.

**C-3. Make a rule at the moment of deciding.** "Create rule" exists on a transaction row
(`src/components/ledger/TransactionGrid.tsx:58`).
*How:* offer the same tick box, "Always do this for Shell", in the bank import
(`BankFeedImport.tsx`) and the review list, and let the rule carry labels as well as the account.

**C-4. Snap a receipt.** Receipt reading exists (`src/lib/receiptIngestion.ts`) but is reached only
from the document vault and import actions; no screen opens the phone camera.
*How:* a camera button on the phone bar (D-1) that creates a draft expense with the photo attached
and matches it to a bank line later. Second step: a private email address per workspace that turns
forwarded bills into drafts (I found no inbound email handling on the server).

**C-5. Reconciliation that starts finished.** The wizard is two steps
(`src/components/ledger/ReconciliationWizard.tsx`).
*How:* open on "214 of 220 lines already matched — 6 need you" and show only the six.

## D. Phone

**D-1. The bottom bar appears empty. (bug)** It looks up groups named `pulse`, `finance`,
`operations` and `planning` (`src/components/layout/BottomNav.tsx:26`), but the menu groups are
`dashboard`, `money_in`, `money_out`, `transactions`, `reconcile`, `reports`
(`src/config/registry.tsx:185`); no screen belongs to the old names, so every button is skipped.
No test covers it.
*How:* five fixed buttons: Home, To review, a centre "+", Reports, More. Add a browser test at 390px.

**D-2. Three phone jobs done well.** Send an invoice, snap a receipt, see who owes money. Make
those three reachable in two taps and leave the rest for the desktop.

## E. Labels (multi-dimensional accounting): your real advantage

**E-1. One word.** The feature is called "Labels" on invoice lines, "Show Dimensions" in the journal
(`DocumentLineEditor.tsx:169`), "Dimensions & Label Node Registry", "Register New Label Node" and
"Add New Dimension Axis" in settings (`DimensionsSettings.tsx`), "World / Entity" as a default
(`src/lib/dimensionUtils.ts:5`), "Dimensional Type" in projects, and there is a separate "Tags"
feature. `docs/UI_GUIDE.md` already bans "worlds".
*How:* "Labels" for the feature, "label" and "value" for the parts, "Company" instead of
"World / Entity". Fold Tags into labels or name the difference in one sentence on both screens.

**E-2. Label many at once.** The selection bar offers only "Bulk Categorize"
(`src/components/transactions/SelectionBar.tsx`).
*How:* add "Set label" beside it, and an editable label column in the grid.

**E-3. Real parents and children.** A value has no parent; nesting is a "/" typed into the text
(`src/model/ledger.ts:33`).
*How:* add `parentId` to the value, a tree in settings, and roll-up totals in the label reports
(Region → Property → Unit).

**E-4. A label filter on every report.** Profit and loss has one; add it to the report shell so
ageing, cash flow, general ledger and tax reports get it for free.

**E-5. Budgets by label.** The budget screen budgets by account only
(`src/components/planning/BudgetManager.tsx`), though the data model allows a project target.
*How:* add an optional label and value to a budget, and "budget vs actual" as a column in Profit by
Label.

**E-6. A page per value.** *How:* clicking "Maui house" or "Project Aspen" anywhere opens one page:
profit this year, open invoices and bills, last entries, budget left. This is what makes labels feel
like the product instead of a setting.

**E-7. Presets by business type.** *How:* property → Property and Unit; construction → Project and
Cost code; non-profit → Fund and Program (with Fund self-balancing, which
`src/lib/labelRoles.ts` already supports); agency → Client and Project. Chosen in A-2.

**E-8. Promote the pivot.** "Compare anything by anything" is buried in the Insights screen under
the title "Cross-tabulation & Dimension Aggregator" (`src/components/ledger/PivotSheetView.tsx`).
*How:* list it under Reports as "Compare" with saved layouts.

**E-9. Labels in and out.** The CSV record import has no label columns (`src/lib/recordImport.ts`)
and the transactions API filters only by date and account
(`src/server/routes/transactions/crudRoutes.ts:54`).
*How:* map any column whose header matches a label name, and add `label.<name>=<value>` filters.

## F. Menu and words

**F-1. A menu that fits the business.** *(Corrected 10 Nov: the first version of this item missed
the modules system.)* The registry lists 73 screens, but twelve modules (payroll, fixed assets, loans,
stock, projects, budgets…) can be turned off, and a new workspace starts with most of them off
(`src/lib/modules.ts`). Two gaps remain. Nothing in the setup wizard picks modules for the kind of
business, and a module that is off also leaves the page search (`src/config/pageIndex.ts:40`), so a
person who types "payroll" finds nothing and concludes the product has no payroll. The `isProMode` state (`src/stores/useUIStore.ts`) is now used exclusively for the ledger grid's "More detail per row" density toggle (`src/components/ledger/TransactionGridToolbar.tsx`), while screen visibility is governed by workspace modules (`src/lib/modules.ts`).
*How:* a module preset per business type, chosen in A-2; keep modules that are off in the search as
"Payroll — turn on".

**F-2. Plain names.** Still in the menu: "BQL Query Builder", "Forensic Anomaly Detection",
"Forensic Audit", "Intelligence", "AI Co-pilot"; the app title is "ERP & Financial Engine"
(`src/locales/i18n.ts`).
*How:* "Advanced search", "Unusual entries", "Audit checks", "Insights", "Ask your books",
"Simple bookkeeping".

**F-3. Reports people can find.** About 167 report and tool views are registered, with a search box
(`src/components/reporting/ReportPicker.tsx`).
*How:* open on eight starred reports chosen by business type, let people star their own, and title
reports as questions where it helps ("Who owes me?", "What do I owe?"). Report scheduling exists on
the server (`src/server/services/scheduledReportService.ts`): put "Email me this every Monday" on
every report.

## G. Language

**G-1. Hebrew covers the menu only.** The dictionary has about eleven entries
(`src/locales/i18n.ts`), roughly six of 542 screen files switch language, and the main layout is
fixed left-to-right (`src/App.tsx:567`). The product has deep Israel features (advance tax, form
102, withholding) behind an English interface.
*How:* the same codemod approach that linked 142 form labels: extract visible strings screen by
screen into the dictionary, starting with Sales, Purchases, Bank and the top eight reports; set the
page direction from the language; add a test that fails when a translated screen gains an
untranslated string.

## H. Trust and scale

**H-1. Reports need every entry in the browser.** Lists are capped at 10,000 and balances are
computed client-side (open tracker item L-123). Fine for a small shop, not for "a lot of people".
*How:* finish server-side balances per closed year (`docs/design/L-123-server-balances.md`) before
any marketing push.

**H-2. Show the safety.** Backup, restore, audit trail, period locks and data-health checks all
exist. *How:* one "Your books are safe" card on the overview: last backup, months closed, problems
found (0), with links.

## I. How it spreads

**I-1. Accountants bring clients.** "All my books" exists (`src/components/dashboard/PracticeView.tsx`).
*How:* a free accountant seat, a one-click "Invite my accountant", and a client list that shows what
needs attention in each set of books. One accountant can bring twenty businesses.

**I-2. Every invoice is an advert.** The customer portal and card payment exist. *How:* a small
"Sent with LedgerFlow" line on the portal page, off for paid plans.

**I-3. A free tool at the door.** *How:* a public invoice maker that needs no account and offers
"Save this and track who paid" at the end; it feeds the guest demo in A-1.

---

# Part 2: shortcuts (one change, many screens)

Added 10 Nov 2026. Part 1 lists what to improve screen by screen. This part lists the places where
the code already has one shared piece, so a single change there improves the whole product. These
are the cheapest route to "twice as good".

## The ten shortcuts

**S-1. One list component instead of 200 tables.** About 200 screen files draw their own `<table>`.
The shared grid (`src/components/ui/TanStackDataGrid.tsx`) is used by one screen and the shared
`Money` component by one. So sorting, search, export, phone layout and keyboard movement have to be
built 200 times, and are not.
*How:* grow the shared grid into one list with sort, search, column chooser, export, row keyboard
movement, tick boxes for bulk actions, saved views and cards on a phone. Move screens over with a
codemod, the ten most used first, and make `npm run scaffold:report` generate it so every new screen
gets it. This is the largest single quality jump available.

**S-2. One "new" link.** Record links already open any record: `#sales/invoice/<id>`
(`src/lib/recordLinks.ts`).
*How:* accept `new` as the id. That one change fixes the New menu (B-1), gives the command palette
"New invoice", gives every empty screen a working button, lets the first-hour guide open real forms,
and lets an email or a help article link straight into a form.

**S-3. Undo in the one place everything is saved.** Simple records are added, changed and deleted
through three functions that also show the confirmation message (`src/hooks/useEntityOperations.ts:153`).
*How:* keep the previous copy there and put "Undo" on the message. Start with customers, vendors,
items and labels; posted documents keep their own void and reverse.

**S-4. Empty screens that teach.** Every registered screen already has a plain description in
English and Hebrew, enforced by a test (`src/config/screenHelp.ts`), and 23 screens use the shared
`EmptyState`.
*How:* let `EmptyState` read the screen's description, its "new" link (S-2) and a "Show me an
example" button from the registry. Every screen then explains itself, and the product tour is not
needed.

**S-5. Problems with a "Fix" button.** Data Health runs its checks from one list, and each already
says what to do in words (`src/lib/dataChecks.ts`).
*How:* give a check an optional `fix` function and show "Fix these 12". Run the same list when a
form is saved, as a warning before the mistake is made instead of a finding afterwards.

**S-6. Ask the books from anywhere.** A question in words, answered by the server from the full
history with the entries listed, already works (`src/components/reporting/AskBooksView.tsx`,
`src/server/reports/explain.ts`), but only as one report tab.
*How:* answer in the command palette ("rent last year" shows the figure in place) and on the
overview. Make every figure clickable for "what is in this number" by putting that on the shared
`Money` component once S-1 spreads it.

**S-7. One brain for guessing.** The bank feed's matching engine (`src/lib/MatchingEngine.ts`)
knows rules, history and label aliases. Typed entry, bills and receipts do not use it.
*How:* call it from the bill form, the command palette (B-6) and receipts (C-4). Whenever a person
changes a guess, offer "Always do this" (C-3). The product then gets better with every correction.

**S-8. Paste from a spreadsheet.** No screen handles pasting. People live in Excel.
*How:* one paste handler in the shared line editor (`src/components/common/DocumentLineEditor.tsx`,
used by invoices, bills and journal entries) that turns copied rows into lines, and the same in
Import: paste a column of customers and they are created.

**S-9. A Monday email.** Scheduled report emails and the daily job already exist
(`src/server/services/scheduledReportService.ts`).
*How:* one more scheduled item, on by default: cash in the bank, who owes you, what you owe, how
many items need review, each a link into the app. People keep their books without remembering to
open the product.

**S-10. Hebrew through the shared pieces first.** The menu, help text and glossary are already
bilingual.
*How:* translate at the shared components before the screens: `Labelled` (35 files), `EmptyState`,
`AsyncButton`, the error remedies (`src/lib/errorRemedies.ts`) and the confirmation messages. A few
files cover a large share of what a person reads. Pre-fill the rest by machine using the glossary
(`src/config/systemGlossary.ts`) and have a Hebrew-speaking bookkeeper review it.

## New ideas

**N-1. Start from the bank, not from setup.** *What:* the first screen says "Drop three months of
bank statements here". The product reads them, proposes accounts and rules, and shows a first
profit and loss within minutes. Setup questions come afterwards, only when needed.
*Why:* QuickBooks and Odoo both start with forms. Starting with the person's own numbers is the
moment they decide to stay. *How:* the statement importer with saved bank layouts, the matching
engine and the chart templates all exist; this is a new first screen that chains them.

**N-2. One "Today" list.** *What:* a single queue of everything waiting: bank lines to review,
overdue invoices, bills due, data problems, tasks. Each row has one main action and a key.
*How:* merge the sources behind `InboxView.tsx`, `NeedsAttentionCard.tsx`, Data Health and tasks
into one list (on S-1). "Inbox zero" is a habit people already understand.

**N-3. Plain words or accountant words.** *What:* one switch: "money in / money out" or
"debit / credit"; "what you own" or "assets". *How:* the glossary already pairs terms; apply it
where labels are drawn. Owners get plain words, their accountant gets the usual ones, on the same
books.

**N-4. Send by WhatsApp.** *What:* a "Share" button beside "Send invoice" that opens WhatsApp with
the customer's public invoice link. *Why:* in Israel and many other places invoices travel by
WhatsApp, not email. *How:* the public invoice page exists (`src/server/routes/publicInvoiceRoutes.ts`);
this is a link, about a day of work. I found no WhatsApp support in the code.

**N-5. A live link for the bank or an investor.** *What:* share one report as a read-only link
that stays current, with an expiry date. *How:* the same token approach as the customer portal.

**N-6. Recipes by trade.** *What:* a gallery of ready set-ups ("Landlord with 5 flats", "Building
contractor", "Online shop", "Charity with funds"): accounts, labels, modules, rules and three
starred reports in one click. *How:* a recipe is a small data file combining pieces that exist
(chart templates, label presets from E-7, modules, journal templates). Accountants can publish
their own, which gives them a reason to bring clients.

**N-7. Connect to everything through one listing.** API keys and outgoing webhooks exist
(`src/server/routes/apiKeysRoutes.ts`, `webhookRoutes.ts`). *How:* publish a Zapier and a Make
connector on top of them. That gives hundreds of integrations without building any.

## Order

S-2, S-3 and N-4 are days. S-4, S-5, S-8 and S-9 are about a week each. S-1 is the big one: weeks,
but it is what makes everything after it cheaper. N-1 is the idea most likely to make people choose
this product over the others.

---

# Part 3: found in the code, not in any todo list

Added 10 Nov 2026. Each item was checked against `TRACKER.md`, `TODO_2.md`, `ROADMAP.md`, `PLAN.md`,
`COORDINATION.md`, `FOR_YOU.md`, parts 1 and 2 above and the TODO comments in the code (there are
only two). None of them appears there. The check was by keyword, so an item worded very differently
could have been missed.

## Already written, never connected

**P-1. Sums in amount fields.** `src/lib/amountExpression.ts` works out `1200/12` or `100*1.17` and
has tests, but only the import checker uses it. *How:* call it from the amount fields, so a person
can type the sum instead of reaching for a calculator.

**P-2. Late fees.** `src/lib/paymentTerms.ts:30` calculates a late fee; no screen or job calls it.
*How:* "Add late fee" on an overdue invoice, and an option to add it with the reminder emails.

## Typing and forms

**P-3. Browser pop-ups in eight places.** Plain `alert`, `confirm` and `prompt` boxes, which ignore
the theme and cannot be styled or translated: `Sales.tsx:233` and `TimeView.tsx:197` (ask for a
note), `SavedViewsManagerModal.tsx:650` and `ApiHubKeys.tsx:153` (confirm), `SupportView.tsx:188`,
`:249`, `:289` and `TransferModal.tsx:72` (errors). *How:* the app's own dialog and an error under
the field.

**P-4. One amount field.** Money is typed into `type="number"` inputs in 137 places. Those change
value when the mouse wheel passes over them, show no thousands separator and refuse a comma as the
decimal mark. *How:* one shared amount input (text with a number keypad on phones) that also does
P-1, swapped in by codemod.

**P-5. Date keys.** No date field has shortcut keys. *How:* in one shared date input: `t` today,
`+` and `-` a day, `m` and `h` first and last day of the month, `y` and `r` of the year. Bookkeepers
coming from QuickBooks expect these.

**P-6. Enter saves every dialog.** There are about 86 dialog files and 52 `<form>` elements, so many
dialogs cannot be saved from the keyboard. *How:* Ctrl+Enter (and Enter outside a text area) in the
shared `useDialog` hook.

**P-7. Recently used first.** Account, customer and vendor pickers list everything in the same
order. *How:* show the five most recently used at the top.

**P-8. Batch entry.** *How:* a spreadsheet-like screen for entering twenty bills or expenses in
rows, with the previous row's date and vendor carried down. The fastest way to catch up a month.

**P-9. Total of the selected rows.** *How:* tick rows in any list and see count and sum at the
bottom, as a spreadsheet does.

## Reading

**P-10. Very small text.** Text of 10px or smaller is used 1,286 times in 154 screen files. The
heaviest font weight appears 679 times in 93 files and wide-spaced capitals in 77, both of which
`UI_GUIDE.md` rules out. *How:* a codemod with a floor of 12px, normal weight for ordinary rows, and
a lint rule so they do not return.

**P-11. A dollar sign whatever the currency.** `FinancialCalculatorView.tsx` (lines 116 to 391),
`RulesSettingsView.tsx:285` and `ApiHubBilling.tsx:97` print `$` directly. (L-145 fixed six others.)

**P-12. Hints that never show on a phone.** 268 hints use the browser's `title`, which touch
screens do not show. *How:* one shared tooltip that opens on tap.

**P-13. Screens with light colours only.** Ten payroll files under `src/components/hr/` and seven
report views (`ExpenseByCategoryReportView.tsx`, `TagBreakdownReportView.tsx`,
`IncomeBySourceReportView.tsx` and others) use white and pale grey backgrounds with no dark-mode
or theme-variable styling in the file.

**P-14. Two leftover jargon lines.** The command palette says "Amount Search Matrix active"
(`CommandPalette.tsx:522`) and the tax reserve card says "You can safely deploy up to…"
(`TaxReserveWidget.tsx:145`). *How:* "Searching by amount" and "Safe to spend:".

## Settings that follow the person

**P-15. Preferences live in one browser.** Pinned pages, saved views, date format, theme, text
size, speed dials and the start page are kept in browser storage (`src/stores/useUIStore.ts`,
`useSavedViewsStore.ts`), so they are missing on the phone or a new computer. Report preferences
already sync through the profile (`src/lib/reportPreferences.ts`). *How:* move the rest onto the
same mechanism.

## New, and in neither the code nor the lists

**P-16. How to pay, on the invoice.** Bank transfer details and a Bit or PayBox link on the invoice
and its public page. Card payment exists; in Israel most invoices are paid by transfer.

**P-17. Approve from the email.** Approvals and notification emails exist. *How:* "Approve" and
"Send back" buttons in the email, each a one-time signed link.

**P-18. Customers fix their own details.** *How:* on the customer portal, let the customer correct
their address, tax number and contact; the change waits for the owner's approval.

**P-19. Signing in again without losing work.** *How:* when the session ends mid-form, keep the
form, ask for the password in place and continue.

**P-20. Address lookup.** *How:* suggest the address while it is typed on customers and vendors.

**P-21. Swipe on a phone.** *How:* swipe a row in To review to accept, the other way to change the
account.

**P-22. A money calendar.** *How:* a month view of what is due in and out each day, from open
invoices, bills and recurring items.

**P-23. Speak an expense.** *How:* a microphone button on the phone that feeds the existing typed
entry parser (`src/lib/algorithms/nl-parser.ts`).

**P-24. A live Google Sheet.** *How:* "Open in Google Sheets" on a report, refreshed from the API,
for people who will always finish in a spreadsheet.

---

# Part 4: a screen that always tells you what to do next

Added 10 Nov 2026. Parts 1 to 3 came from reading code. This part comes from looking at the screens
themselves: the screenshot baselines in `e2e/__screenshots__/` (guest demo data, desktop 1280 and
phone 390). The goal is one sentence: **on any screen, within five seconds, a person knows what the
screen is, whether anything needs them, and which one button to press.**

## What the screens show today

**Overview** (`dashboard-1280-light`, `dashboard-390-light`)
- The page is 3,000 pixels tall on a desktop and 6,552 on a phone, about eight phone screens.
- Thirteen widgets, each with its own "Refresh", its own "Demo data — no live refresh" line, and
  Bar / Line / Area chart buttons.
- The same $3,000 of cash appears six times: top tile, Cash widget, Net worth, Bank and cash
  accounts, Account summary, and the sidebar.
- Three buttons create something: "+ New" in the header, "+ Add Entry" on the page, and the guide.
- Caveats are printed in the open: "Current unpaid amounts; later documents excluded. Past payments
  are not reconstructed." and "This checklist does not verify their accuracy."
- Nothing on the page says what to do next.

**Around every screen**
- Four strips sit above the page title: a banner, the header, a tab row, and a breadcrumb row with
  Help. `UI_GUIDE.md` asks for a header of 120px at most.
- The search box suggests `world:realestate property:homes/* amount:>1000` (`Header.tsx:116`).
- The header shows "Main Ledger · VIEWER"; the footer shows "LEDGERFLOW ONLINE · 5 Accounts ·
  2 Transactions · Base Currency: USD · Double-Entry Balanced" (`StatusBar.tsx`).
- The sidebar ends with "Balances by account type": Asset, Liability, Income, Expense (`Sidebar.tsx:110`).

**Sales** (`sales-1280-light`, `sales-390-light`)
- The menu says "Money In", the tab and title say "Sales".
- With no invoices there are still three total tiles, a column chooser and a table header, and two
  buttons for the same thing with different words: "Add Invoice" and "CREATE INVOICE".
- $0.00 overdue is printed in red and $0.00 due in orange.
- On the phone the empty message is cut off at the right edge ("No invo…", "CREAT…").

**Transactions** (`transactions-1280-light`)
- The menu says "Transactions", the title says "Journal Entries", the buttons say "New Entry" and
  "Add Entry".
- Five saved views are offered before any work exists ("Liquid Cash & Bank Funds", "High-Value
  Revenue (> $1,000)"…), and Project, Class and Location columns are shown empty.

**Profit and loss** (`pnl-1280-light`)
- About twenty-two controls come before a report of five rows.
- The period can be set four ways (Month / Quarter / Year with year and month lists, a month
  stepper, two date fields, and "Custom range"). Export appears four times (Export, Export to Excel,
  Export columns CSV, Workspace exports). Comparison appears twice.
- A green banner explains that the report was "worked out in this browser" because "the server
  report could not be loaded".

**Reconcile** (`reconcile-1280-light`)
- The title is "Smart Matching & Bank Reconciliation".
- The filled main button is "Auto-match all" while there is nothing to match. The step that would
  help, importing a statement, is a small outline button.

**Settings** (`settings-1280-light`)
- It opens on the price plans. About thirty links follow, and Help, Support and Pricing are tabs
  inside Settings.

## Twelve rules, and how to apply each

**U-1. A "Next" line on every screen.** One sentence and one button under the title, worked out
from the books. Examples: "No customers yet. Add your first customer." / "2 invoices are still
drafts. Send them." / "14 bank lines need review." / "You are up to date. Next: September's bank
statement."
*How:* the list already exists for the Overview (`src/lib/needsAttention.ts`, shown by
`NeedsAttentionCard.tsx`). Give each row a screen it belongs to, and render the first matching row
in the page frame (`src/core/layout/RootLayout.tsx`) so every screen gets it without changes.

**U-2. One filled button per screen, and it follows the state.** Reconcile with no bank lines:
"Import statement". With lines: "Match automatically". Everything else is an outline button or sits
under "More". Remove "+ Add Entry" from the Overview; "+ New" in the header is enough.

**U-3. An empty screen shows the way, not the tool.** With no records, hide totals, filters, saved
views, the column chooser and the table header. Show one sentence, one button, and "See an example".
*How:* one `isEmpty` branch in the shared list (S-1) and in `EmptyState` (S-4).

**U-4. Say each number once.** The Overview becomes: four numbers (cash, owed to you, you owe,
profit), the "Next" list, one chart. The other widgets move behind "More detail" and are off by
default; one Refresh and one demo note for the page. Remove the sidebar balances
(`Sidebar.tsx:110`); they repeat the Overview in accountant's words.

**U-5. One word per thing.**

| Today | Use everywhere |
|---|---|
| Money In / Sales | Sales |
| Money Out / Purchases | Purchases |
| Transactions / Journal Entries / Entry | Transactions (and "journal entry" only for the manual kind) |
| Dashboard / Overview | Overview |
| Add Invoice / Create Invoice / New | New invoice |
| Smart Matching & Bank Reconciliation | Match the bank |

*How:* one vocabulary file and a test that fails on the banned variants, as the registry already
does for help text.

**U-6. One way to do each thing.** Reports get one period control (a single button, "September
2026", opening month, quarter, year and custom) and one "Export" menu (Excel, CSV, PDF, link).
Paper size and "Generate" move into Print. That takes the profit and loss from about twenty-two
controls to five.

**U-7. Caveats on request, system state only when wrong.** Replace printed caveats with a small
"How is this worked out?" link. Show "viewer", "offline", "not balanced" or "server report failed"
only when it is a problem and only with what to do about it. Remove the footer bar.

**U-8. After every save, offer the next step.** Saving an invoice ends on "Invoice 1042 saved.
Send it · Record a payment · New invoice" in place of a closed dialog.
*How:* a `next` option on the confirmation message in `useEntityOperations.ts`, so it is written
once per record type.

**U-9. Every document shows its path.** At the top of an invoice: Draft → Sent → Paid, with the
current step marked and the button for the next one beside it. Bills: Entered → Approved → Paid.
A person never has to know where "receive payment" lives.

**U-10. Colour means "look here".** Red only when an overdue amount is above zero; a zero is grey.
Gold for the one filled button and nothing else.

**U-11. A thinner frame.** Header and tab row only; the banner becomes a dot on the header, Help
moves into the header, the breadcrumb row goes. That returns about 100px to every screen.

**U-12. Search that speaks like a person.** Placeholder: "Search, or type what you want to do".
The query language stays available but is not the first thing a new person reads.

## Keeping it that way

The repository already protects behaviour with guard tests. Add four for the interface, so the
rules hold while many hands work on it:
1. each registered screen renders exactly one filled button;
2. the page title starts within 130px of the top at 1280 wide;
3. no red or orange text on a zero amount;
4. no banned word from the U-5 table in any screen.

## Order

U-12, U-10 and the Overview half of U-4 are a day or two each and change the first impression.
U-1 and U-8 are the two that create the feeling of always knowing what to do; build them next.
U-3 and U-6 follow once the shared list (S-1) exists.
