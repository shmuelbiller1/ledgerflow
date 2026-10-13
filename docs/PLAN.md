# LedgerFlow: the plan (updated 13 Oct 2026)

Written for the owner. It says where the list stands, the fastest way to finish it, what Claude
(AI #1) does next, what the other AIs do, and how tax becomes solid: the US and Israel first, then
states, cities and other countries.

## 1. Where the list stands

`docs/TRACKER.md` has **977 items** (13 Oct; the daily count is in `docs/LINE_COUNT.md`):

| | Items | Share |
|---|---|---|
| Done | 803 | 82% |
| Open | 174 | 18% |

The open count stays flat because new items keep arriving (AU-1..AU-6 from the owner's two audit
reports, SL for the Spreadsheet Lab) as old ones close.

About 60 of the 176 open items are **dropped on purpose** (things like SSO, Avalara, single-industry
add-ons, and WooCommerce or Zapier links). Of the rest, roughly:

- **about 40** are real product work: tax depth, stock (bundles, landed cost), project work in
  progress, and rounding;
- **about 75** are engineering and operations: logging, uptime, load tests, decision records and
  security evidence.

**What is solid today:** bookkeeping, invoices and bills, payments, bank reconciliation, period
locks, approvals, reports (P&L, balance sheet, cash basis, aging), multi-currency with
revaluation, groups of books, time tracking, hourly and salaried payroll, and documents in English
and Hebrew. It has 2,785 unit tests and about 250 browser tests (including 40 screenshot checks), and GitHub runs them on every push.

**The weakest area is tax.** The tax *engine* is good: tax codes, tax groups, compound tax,
reverse charge, zero-rated and exempt, return boxes, filed copies and exemption certificates. But
the tax *content* is thin:

- **US sales tax** is one average rate (8%), with no per-state or per-city rates.
- **US payroll tax** is an estimate: the federal tables plus 11 states, marked "not for filing".
- **Israel VAT** defaults to **17% — wrong**. It has been **18% since 1 January 2025**. This is
  fixed first (below).
- **Israel** has no VAT report file (PCN874), no allocation numbers for tax invoices, no
  withholding at source, and no Israeli payroll.

## 2. The fastest way to finish (the shortcuts)

1. **Tax rules are data, not code.** Each rate, threshold and bracket lives in a table:
   - each row has a start date and an end date (so last year's invoices keep last year's rate);
   - each row names its official source (a link to the IRS, the state, or the Israel Tax Authority).

   Adding a state or a year means adding rows, never writing new logic. The AIs can fill tables
   safely; Claude reviews them.
2. **One place model for every level.** The country, state, county, city and special district are
   one list. An invoice's tax is the sum of the places its address falls in. The same model serves
   Israel (one country rate plus special areas such as Eilat) and the US (state plus local).
3. **Reports read what is already posted.** Every return or form (Israel's VAT report, the 941,
   the 1099, Form 856) is a *read-only* view of existing entries. That means no new posting risk,
   and each one is checked against hand-worked examples from the official instructions.
4. **Golden tests from the official examples.** Every table ships with the worked examples printed
   in the authority's own guide (IRS Pub 15-T, the Israeli withholding tables), so a wrong row
   fails a test.
5. **Don't build what is dropped:**
   - paid tax services (Avalara, TaxJar);
   - e-invoicing networks outside Israel;
   - single-industry versions.

   Where a tax authority needs an official connection (Israel's allocation numbers, IRS e-filing),
   build the file or request first. The live connection waits until you register (see section 5).

## 3. Tax plan, step by step

The money core (rates by date, the places model, postings and payroll arithmetic) is Claude's. The
tables, report layouts, screens and docs go to the other AIs.

### Step 1 — Israel (first, ~1 week)

| # | What | Who |
|---|---|---|
| IL-1 | VAT 18% from 1 Jan 2025 (17% before), as dated rows; existing invoices keep their rate | Claude |
| IL-2 | Israeli document types and numbering: tax invoice, receipt, tax invoice-receipt, credit invoice; "original/copy" marking; numbers never reused | Claude |
| IL-3 | VAT report (monthly or every two months): sales, inputs, fixed-asset inputs, amount to pay | Claude (figures) + AI #2 (screen and print) |
| IL-4 | PCN874 detailed VAT file, in the Tax Authority's layout | AI #5 (file writer from Claude's figures) |
| IL-5 | Withholding at source (ניכוי במקור) on vendor payments: the vendor's certificate rate and expiry date (built like T-05), and the annual Form 856 | Claude (posting) + AI #3 (Form 856 report) |
| IL-6 | Allocation numbers (מספר הקצאה) for tax invoices above the threshold: the request is ready; the live connection waits for your Tax Authority registration | Claude |
| IL-7 | Israeli payroll: tax brackets, credit points, Bituach Leumi, health tax, pension and severance; Form 102 (monthly), Form 106 (yearly), Form 126 | Claude (engine) + AI #4 (tables with sources) + AI #2 (forms) |

### Step 2 — United States, federal and state (~2 weeks)

| # | What | Who |
|---|---|---|
| US-1 | Sales tax by state: 50 states plus DC, base rates as dated rows with sources; whether shipping is taxed; origin or destination rules | AI #3 (table) + Claude (lookup by the ship-to address) |
| US-2 | Nexus watch: sales and order counts per state against each state's economic-nexus threshold, with a warning before you cross one | AI #2 (report) |
| US-3 | Sales tax return per state: taxable, exempt (using T-05 certificates) and tax due, by period | Claude (figures) + AI #2 (screen) |
| US-4 | 1099-NEC/MISC complete: the vendor's W-9 details (tax ID, kept masked), the $600 threshold (rising to $2,000 for 2026 payments), Form 1096, and an IRIS e-file CSV | AI #5 (forms) + Claude (vendor tax ID storage) |
| US-5 | Federal payroll exact: Pub 15-T 2026 tables, Social Security, Medicare (including the additional 0.9%) and FUTA; Forms 941 and 940; W-2 and W-3 data | Claude (engine) + AI #4 (tables) + AI #2 (forms) |
| US-6 | State payroll: all states with income tax, plus unemployment rates and wage bases; the 9 states with no income tax are easy | AI #4 (tables) + Claude (engine) |

### Step 3 — Cities and local (~1 week)

| # | What | Who |
|---|---|---|
| L-1 | Local sales tax: county, city and special district rates, imported from each state's free rate file (by ZIP+4 or address) and refreshed monthly | Claude (import) + AI #5 (state-by-state importers) |
| L-2 | Local payroll taxes: NYC, Philadelphia, Ohio and Pennsylvania cities, and other local income taxes | AI #4 (tables) + Claude |
| L-3 | Local returns where a city files separately (for example Colorado home-rule cities) | AI #2 |

### Step 4 — Other countries (after the US and Israel)

Canada (GST/HST/PST), the UK (VAT returns without MTD, which is dropped), and EU VAT with OSS. Each
is the same pattern: rows with sources, a return built from postings, and golden tests.

**The "not for filing" note stays** on payroll and returns until each country's figures match the
official examples and you have had an accountant check one real period. That is item 42 in
`docs/FOR_YOU.md`.

## 4. Who does what

### Claude (AI #1), in order (13 Oct)

Done since 11 Oct: IL-1, IL-2, IL-3, IL-5, allocation-number thresholds and fields, US-1 lookup
(rule packs feed the line tax), US-3 state sales-tax return, entity filings, the rule graph (§10),
the AI gateway with the brain route on it, plain report wording.

Next, in order:
1. **AU-6 One door to the ledger** — about 30 server files write transactions directly; route them
   through the posting module and add a lint rule. The most important integrity item.
2. **AU-3** stress tests on posting (always balanced, never twice), then **AU-2** one label filter.
3. **AU-5** money arithmetic audit (132 `parseFloat`/`toFixed` uses to check).
4. IL-7 Israeli payroll engine (on AI #4's tables), US-5 federal payroll.
5. AU-1 Plaid `/transactions/sync`, AU-4 migration proof against the source totals.
6. IL-6 live allocation-number request (waits on the Tax Authority registration, FOR_YOU 42).
7. Leftovers: Y-35/BM-04 rounding, W-08 drop-ship, V-08 work in progress.
8. Every few hours: merge the other AIs' work, look at changed screenshots before accepting them,
   keep every queue weeks long, apply any database change.

### Other AIs

They work in their own areas and never change how money is posted. Each queue is in
`docs/COORDINATION.md`, at least 5 days long, and holds the tax tasks above.

| AI | Area | Open tasks (13 Oct) | Next |
|---|---|---:|---|
| #2 Codex | reports, screens, exports | 68 | screens for AI #3's features, consistent Excel/PDF exports, saved views, Hebrew review |
| #3 Arena | tax content, inventory, purchasing | 93 | rate packs for all US states and ~15 countries, payroll tables, lots/serials, golden tax fixtures |
| #4 Codex | quality, charts, phone | 66 | D-44 report picker, dark-mode contrast, charts, screenshot tests, speed budgets |
| #5 | imports, files | 29 | PCN874 writer, 1099 forms, state rate importers |
| #6 | security | 21 | S-1..S-21 |
| #7 | stability | 21 | F-1..F-21 |
| #8 (spare) | next free AI | 8 | G-1..G-8 |

The queues are long enough that **if Claude runs out of usage, the others keep going for weeks** (AI #3 clears ~15–35 tasks a day, so it gets the longest queue).
Their tax tasks only add tables, files and screens: Claude merges them, and nothing they write
posts money.

## 5. What only you can do

The full list is in `docs/FOR_YOU.md`. The tax items:

- **Israel Tax Authority registration** for allocation numbers (IL-6). It is free. Until then
  LedgerFlow prepares the request but cannot fetch the number.
- **An accountant's check** of one real month of Israeli VAT and US payroll before the "not for
  filing" note comes off.
- **Roll the old Stripe test key** (item 41).

## 6. Tax follows the entity, not only the workspace (owner, 11 Oct evening)

A set of books can hold several organisations as labels (the World / Entity label, or any label). Each
one can sit somewhere different: an LLC in Texas, a company in Israel, a branch in New York City, a
project in Eilat. So tax is decided by **who is selling, from where, to whom**, not by the workspace
alone.

**The model (Claude builds it first, before the US/Israel tables plug in):**

1. **Tax profile.** A tax profile belongs to a set of books *or to a label value* (an entity, a location, a
   branch). It holds the country, state, county, city, registration numbers (VAT number, sales tax
   permits per state, EIN, Israeli company / dealer number), the filing frequency, and the accounting basis.
2. **Inheritance.** A label value without its own profile uses its parent's (label hierarchy), then the
   books' own. "The info comes from there": choose an entity on a line and its place, numbers and rules
   fill in.
3. **Resolution per line.** An invoice line's tax = the seller profile (the line's entity label, else the
   books) + the buyer's address (ship-to) + the item's tax code + exemption certificates (T-05). The same
   function serves Israel (one national rate, Eilat zero) and the US (state + county + city + district).
4. **Returns per registration.** Each tax return (Israeli VAT report, each US state's sales tax return,
   941 per EIN) is built from the lines whose seller profile carries that registration, across labels in
   one set of books and across books in a group (DA-01).
5. **Learning and checking (algorithms).** From the history LedgerFlow suggests the tax code per vendor,
   item, entity and place; it learns from each correction (what the person changed it to is the next
   suggestion); it flags a line whose tax differs from what the same entity, item and place usually get;
   it warns when an entity's sales into a state approach nexus. Suggestions are never applied silently:
   the person sees and accepts them, and the existing cross-label inference
   (`src/lib/algorithms/cross-dimension-inference.ts`) is the base.

Order for Claude: tax profile model and inheritance → line resolution → Israel (IL-1..7) on top →
US (US-1..6) → local (L-1..3) → learning and checks. The other AIs build screens, tables and files on
the published shapes (`src/lib/tax/profile.ts`, coming first).

## 7. Speed: the other AIs finish fast

The first "five days" of queue lasted about two hours (AI #5 shipped nine PRs). From now on each queue
holds **20 or more tasks**, and Claude refills it at every check. AI #5 is for now a chat standing in
until another AI's usage resets: its tasks are small, self-contained and come with fixtures.

## 8. Done so far (Claude, updated 13 Oct)

| Step | What | Where |
|---|---|---|
| §6 model | Tax profiles on the books and on label values, inherited from parents; saved through the server (owners, accountants), audited | `src/lib/tax/profile.ts`, `PUT .../tax-profiles` |
| §6 lines | A sale line's tax from the selling entity, the buyer's place, the date and certificates; Israel built in; US tables plug in | `src/lib/tax/resolveLineTax.ts` |
| §6 screens | Customers have a tax place (country, state, city); invoices show the expected tax with "Use it" | PartyModal, TaxPlaceSuggestion |
| §6 learning | Tax code suggestions from history, learning from corrections; unusual-code flags | `src/lib/tax/taxSuggestions.ts` |
| IL-1 | VAT 17% to 2024, 18% from 1 Jan 2025, Eilat zero, as dated rows | `src/lib/tax/ilVatRates.ts` |
| IL-2 | Original once, then "true copy" on Israeli tax documents | `copyMarkService.ts` |
| IL-3 | VAT report figures per registration (taxable, zero, exempt, output, fixed-asset and other inputs, to pay) | `src/lib/tax/ilVatReturn.ts` |
| IL-5 | Withholding at source: vendor certificate, amount on the bill payment, posted as owed | `withholding.ts`, payment posting |

| US-1 | Line tax falls back to the rule packs (state and local rates) when no table is set | `src/lib/tax/ruleRateTable.ts` |
| US-3 | State sales-tax return per registration: gross, exempt, taxable, collected, by jurisdiction | `src/lib/tax/usSalesTaxReturn.ts` |
| §10 | Rule graph: facts composed across all labels, evidence, dated rules, blocked when unverified | `src/lib/rules/` |
| Filings | Which returns each entity owes for a year (US 1120/1120-S/1065/990, Israel 1214, VAT report) | `src/lib/tax/entityFilings.ts` |
| AI | Every model call measured and priced through the AI gateway; canned answers removed | `aiGateway.ts`, `brainRoutes.ts` |
| Reports | Plain words (Income, Expenses, Net profit, Assets, Liabilities) instead of jargon | ProfitAndLossView, BalanceSheetView |
| CI | Screenshot tests; a hand-run workflow refreshes them, and Claude looks at them before accepting | `visual-baselines.yml` |
| Count | Daily lines of code, to-do and AI queue counts | `docs/LINE_COUNT.md` |

Next: see §4.

## 9. The strategic review (owner, 11 Oct night) — what changes

An outside review of the repository agreed with the direction (deterministic accounting core; AI suggests,
people approve, posting services commit) and found real defects. Status:

| Finding | Status |
|---|---|
| AI price for Gemini 2.5 Flash 4×/8× too low | **Fixed**: dated price table `src/lib/ai/modelPricing.ts`; unknown models are not priced by guess |
| Canned AI answers and confidence (85, 90) when the model fails | **Fixed**: an explicit `degraded` answer with no confidence, server and browser |
| "Auto-fill Accuracy 98.4%" hard-coded | **Fixed**: removed; no quality number without a measurement |
| Fixed execution times in AI traces | **Fixed**: measured |
| One AI gateway for every model call (policy, data allowed per task, trace, budget) | **Done 12 Oct** for `/api/v1/ai/process`: fields per task, a trace per call (model, tokens, time, cost from the table) in `billingLedgerTraces` (`src/server/services/aiGateway.ts`); the brain route keeps its own trace for now |
| Route-policy coverage: every server route that touches a workspace proves a guard (the server role bypasses RLS) | AI #4 D-30 |
| AI evaluation harness (time-split, Hebrew/English slices, calibration) before any accuracy claim | AI #4 D-31 |
| Tax capability labels in the product: calculation / reviewed / filing-ready | AI #2 C-55 |
| `security_spec.md` still describes Firestore rules | AI #5 E-24 |
| Card numbers pasted into chat, notes or uploads | AI #5 E-25 (detect and mask) |
| Long imports and AI batches as background jobs, not one 60-second request | AI #1, after the gateway |
| Licence, backups/restore drill, branch protection | owner (docs/FOR_YOU.md 44) |

Order of authority when documents disagree: tests and schema > CAPABILITIES.md > PLAN.md > ROADMAP.md > AGENTS.md > README.

## 10. The rule graph: tax and law on the same dimensions (owner, 11 Oct night) — adopted

The owner's direction, adopted before any more country-by-country work: tax laws, legal structures and
organisational classifications use the same multi-dimensional labels as everything else. Books →
dimensions → a rule graph → accounting, tax, legal and reporting results. Four layers, kept apart:

1. **Facts** (`src/lib/rules/facts.ts`): what is true, kept on the books or on any label value: legal form,
   tax treatment, exempt status (three independent attributes: an LLC can be taxed as an S corporation; a
   nonprofit corporation is not tax-exempt until recognised), country, state, county, city, district,
   activity, accounting method, registrations. Each fact has dates and evidence.
2. **Composition** (`composeFacts`): the facts of a line, document or entity are gathered from **every**
   dimension (each with its parents), then the books. This replaces the old first-match
   `resolveSellerProfile`, which stopped at the first dimension with a profile (the owner found it).
   Set attributes (activities, registrations) accumulate; a single attribute stated differently by two
   dimensions is a **conflict**, reported and never silently chosen.
3. **Rules** (`src/lib/rules/rules.ts`): when a rule applies (conditions on facts), its scope (line,
   document, entity for a period), dates, authority and source, its status (calculation / reviewed /
   filing-ready), and how it combines: accumulate (state + city rate), override (a reduced rate replaces
   the standard), exclude (osek patur: no VAT).
4. **Evidence** (the outcome): which rules applied and why, which were displaced and by what, which are
   **blocked** because a fact is only declared, and which are **undecided** because facts conflict.

**The safeguard:** a label only declares. A fact is verified only with evidence someone checked (a
registration, an authority's letter, a document). Rules that depend on a legal status require verified
facts, so choosing a label never by itself creates a legal status or proves compliance.

**How the existing work fits:** saved tax profiles become facts (`fromTaxProfiles.ts`); the Israeli and
US tables become rule packs (rules whose effects are the dated rates); `resolveLineTax` moves onto
`evaluateRules` next. Tests: `src/tests/rule-graph.test.ts` (the owner's companies A, C and D, and a
conflict).

**Order (AI #1):** line tax on the rule graph → Israel and US as rule packs (data, with sources) →
entity-period rules (returns and filings per entity per year) → the Facts screen (AI #2) → learning
suggests facts and rules, never sets them.

## 11. Spreadsheet Lab with GridCraft (owner's report, 12 Oct) — adopted as an optional epic, later

Checked against the repos (storytold/gridcraft 0.6.1, storytold/craft-libs 0.1.0): pure Rust, ~121k lines, MIT OR
Apache-2.0, alpha, browser build is a WebAssembly canvas app (`apps/gridcraft-web`), not a React component. The
ArtCraft brand is excluded from the licence (NOTICE, docs/brand/LICENSE-brand.txt). craft-libs (atomic files,
printing, macOS quit, egui UI) is desktop plumbing that LedgerFlow does not need.

- **Rule that never changes:** the spreadsheet never writes to the books. Data goes in one way: a report snapshot
  made on the server. Any change goes back through our own screens (InlineEdit, Explain-number).
- **Shape:** a separate build artifact served from its own origin, in a sandboxed iframe, with a typed postMessage
  bridge that carries no login tokens. "Explain in LedgerFlow" on a cell opens our drill-down.
- **Order:** SL-1 licence notice and no-brand check; SL-2 server report snapshot (read only, with provenance ids);
  SL-3 the iframe and bridge behind a feature flag; SL-4 Explain-in-LedgerFlow; SL-5 export to .xlsx.
- **Not before:** the tax and payroll work in §6 and §10. Native Pivot Sheet and pins stay the main way to analyse.

## 12. The owner's two audit reports (13 Oct) — what was taken

Both reports said themselves they could not read the code, so each idea was checked against it.
Already true: one posting module for documents, period locks on the server, corrections as
reversals, dated rules with evidence, import preview, duplicate-request guards. Real gaps, now in
TRACKER: AU-1 Plaid sync with a cursor, AU-2 one label filter, AU-3 posting stress tests, AU-4
migration proof by totals, AU-5 money arithmetic audit, AU-6 one door to the ledger. Not taken:
their timelines, new table designs and folder reorganisation (they would rebuild what works).

## 13. Is the plan good? The strategy check (13 Oct)

**What is right:** money, tax and posting stay with one AI (Claude) and one posting path; tax is
built as dated rules with evidence, not code branches; everything is tested against the real
database; CI and screenshot checks guard every push; the other AIs work in their own lanes.

**What was wrong, and the fix:**

1. **Built but not reachable.** 25 of 43 shared libraries are used by no screen, including Claude's
   own Israeli VAT report, US sales-tax return and entity filings. Code a user cannot reach is not a
   feature. Fix: a task is done only when it is on a screen; Codex's queue now starts with C-102..C-126,
   one per library, before any new feature.
2. **Width over depth.** The queues add features faster than they get finished end to end. From now
   on Claude's order is: integrity first (AU-6, AU-3, AU-2, AU-5), then wiring (the 25 libraries,
   reports reachable, return screens), then new content.
3. **Speed was measured as tasks closed, not as things a user can do.** The daily count now shows
   lines and queues; Claude adds "screens reachable" to it when the wiring is done.

**The way it gets done (the strategy):**

- One owner per risk: Claude owns money, posting, tax calculation and the database; nothing else
  posts money. AU-6 makes that a lint rule, not a promise.
- Every feature goes library → screen → help → e2e → screenshot, in one task.
- Claude merges every few hours, looks at changed screenshots before accepting them, keeps CI
  green, and refills queues so no AI waits.
- Owner decisions go in FOR_YOU with the default used, so work never stops.

**Why AI #3 is so much faster.** Three reasons, none of them that it is smarter:
(1) its tasks are mostly tables and pure functions with tests — no screens, no screenshots, no
server; (2) it puts 5–15 tasks in one PR, while Codex makes one PR per task and runs a screenshot
capture-and-approve cycle on each; (3) each session starts fresh on the latest main with a long,
precise list. The cost is the first problem above: much of its output waits for someone else to put
it on a screen. The new rule makes it finish its own screens, so it will slow down — on purpose.
