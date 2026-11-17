# Todo-list truth audit — 17 November 2026

> **What this is.** Every checkbox in the repository's planning documents was read, and each one was
> checked against the code, tests, migrations and the repository's own scanners at
> `f69e2b4` (branch `arena/04ac1bbc-ledgerflow`). The result is a list of places where a box does not
> match the code. Nothing here changes product behaviour: no source file, test, migration or baseline
> was modified. The only code executables run are the repository's own read-only scanners.
>
> **How to read a row.** `Done but unticked` = the work is in the code at this commit and the box is
> empty. `Ticked but not proven` = the box is ticked and the named artifact is missing, or the claim
> contradicts a measurement. `Stale number` = the document quotes a figure the repository's own
> scanner contradicts.

## 1. Scope and method

### 1.1 Every checkbox in the live documents

Nine documents in the repository carry checkbox lists. Two of them (`docs/archive/TRACKER_DONE.md`,
916 boxes; `docs/archive/COORDINATION_ARCHIVE.md`, 491 boxes) are frozen history and were not audited
for staleness. The seven live documents total **890** boxes, of which **69** are ticked.

| Document | Checked | Unticked | Partial `[~]` | What it tracks |
|---|---|---|---|---|
| `docs/TRACKER.md` | 7 | 137 | 33 | AI #1's own 864-item list, by section |
| `docs/COORDINATION.md` | 34 | 259 | 41 | Every other AI's queue (A-, C-, D-, E-, F-, G-, H-, J-, N-, R-, EU-…) |
| `docs/prompts/CMD-1-checklist.md` | 14 | 24 | 0 | The command-registry migration (CMD-1) |
| `docs/SCREEN_REBUILD_CHECKLIST.md` | 14 | 6 | 0 | The raw-table / screen sweep |
| `docs/TODO_2.md` | 0 | 48 | 0 | "List 2" — P2-1…P2-65, end-to-end journeys and consistency |
| `docs/BUG_PATTERNS.md` | 0 | 265 | 0 | A per-pattern checklist (not task state — see §6.1) |
| `docs/STATE_LOCAL_RATE_IMPORTS.md` | 0 | 8 | 0 | Per-state rate-import checkboxes |
| **Total (live documents)** | **69** | **747** | **74** | |

Counting is by **line** because that is what the documents use. Counting by **task id** gives
484 distinct ids: **37** with a ticked box, **378** open only, **69** partial only, and **5** that
appear both ticked and unticked (§4.4).

### 1.2 How a claim was verified

A claim counts as verified when the named artifact exists **and** at least one of these holds:

1. **The repository's own scanner** agrees with the number (`scripts/commands-baseline.ts`,
   `scripts/quality-metrics.ts`, `scripts/codemod-row-table.ts`, `src/tests/commands-baseline.test.ts`).
2. **The named test exists and passes** in a suite run here.
3. **The named source file exists** and is reachable from a registered screen.
4. **A migration** in `supabase/migrations/` carries the behaviour, and `supabase/tests/rls.test.sql`
   asserts it.

A claim was **not** accepted on the strength of a comment that cites its own task id. Several
`// AUD-xx` comments exist beside code that only partly does what the task says (§4.2 and §3.1).

### 1.3 What was executed here (all read-only)

| Check | Command | Result |
|---|---|---|
| Type check | `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit -p tsconfig.json` | **0 errors** |
| ESLint | `npx eslint . --max-warnings 2` | **0 errors, 2 warnings** — the repo's stated bar |
| Full unit suite | `npm test` file list (1109 files) | **5,458 tests, 5,448 pass, 2 fail, 8 skipped** |
| Command ratchet | `npx tsx scripts/commands-baseline.ts` | 159 route writes / **86** browser writes |
| Quality ratchet | `computeQualityMetrics()` vs `quality-baseline.json` | 15 equal, **1 better** (`directDbWrites` 76 vs 93), 0 worse |
| Table codemod | `npx tsx scripts/codemod-row-table.ts` | 0 convertible, **149 refused** |
| Targeted suites | commands-baseline, row-table ×3, record-next-step, help-pages-coverage, item-bundles, INT-6, INT-7 | **43/43 and 13/13 pass** |

The two failing tests in the full suite are both performance budgets:
`R-5: all 151 report views open under 1000 ms` (`reporting/TopPartiesReportView.tsx` 1,449.78 ms,
`ledger/InboxView.tsx` 1,099.88 ms) and `A-229` (the same budget family). A-229 is already recorded
in `CURRENT_WORK.md` as a known sandbox failure; **R-5 is not** (§4.2). Neither is a
correctness defect, and neither is a claim that the reports are wrong.

> **Environment note.** This sandbox ran Node 22.22.3 (the repository specifies Node 24), had no
> PostgreSQL (`LF_TEST_DATABASE_URL` unset, so the DB-backed and RLS suites skip) and no Playwright
> browser. Every statement below is therefore about **unit-level, scanner-level and source-level**
> evidence. It does not certify a browser journey or a live database.

---

## 2. Ticked boxes that hold up

These are verified done and correctly marked. They are listed so the negative findings below are
read in proportion: the ticked set is not generally wrong.

| Id | Claim | Evidence found |
|---|---|---|
| A-273 | Invoice print reads a real PDF fixture | `e2e/print-styles.spec.ts`; `DEMO-US-001` / `16,500.00` bytes read from the blob |
| A-274 | Aging keyboard focus regression | `e2e/keyboard-reports.spec.ts` |
| A-275 | Passkey "not enabled" wording | `src/tests/passkeys.test.tsx` (11 cases) |
| A-276 | Phone pass, 10 screens at 390 px | `e2e/phone-a272-screens.spec.ts` |
| A-277 | Print root for trial balance / journal | `data-print-root` present; `e2e/print-styles.spec.ts` |
| EU-D1 | Phone bottom bar | PR #626; `BottomNav` + registry groups agree |
| EU-B1 / EU-B2 / EU-B4 | New menu, short forms, party/item defaults | PRs #626, #632 |
| EU-E1 / EU-A2 / EU-F1 | Labels wording, business-first wizard, business-aware menu | PRs #632, #638 |
| EU-C4 / EU-D2 / EU-I3 / EU-E3 | Phone receipt, three phone jobs, `/make-invoice`, parent labels | PRs #698, #699; `e2e/eu-d2-phone-jobs.spec.ts` |
| BF-03 / BF-04 | Item bundles, landed cost | `src/lib/itemBundles.ts`, `landedCostService.ts`, `LandedCostPostPanel.tsx` |
| INT-6 / INT-7 | Checkout idempotency, overpayment credit | `int6-checkout-idempotency.test.ts`, `int7-online-overpayment.test.ts` — both pass |
| ISS-130 / CON-2 | Stock revaluation, US nexus watch | revaluation tests; `UsNexusWatchReportView.tsx` |
| C-86 | Report scheduling sends on a chosen day | `scheduled-reports.test.ts`, migration `20261112000000_report_schedule_send_day.sql` |
| R-2 / R-4 | Report comparisons, report notes | `reportVariance`, `reportNotes.ts`, `ReportNote.tsx`, `r4-report-notes.test.tsx` |
| AUD-04 / AUD-11 / AUD-12 / AUD-20 | Atomic send claim, safe-fetch, CSP, TLS | `scheduledReportService.ts` (`claimDelivery`, lease), `contentSecurityPolicy.ts`, `poolConfig.ts` (`DATABASE_CA_CERT`) + `db-tls-config.test.ts` |
| AUD-05 / AUD-10 / AUD-13 / AUD-14 / AUD-15 | Jobs, figure provenance, identity guard, demo label, canonical rows | `serverAction.ts` + `aud13-identity-checks.test.ts`; `reportTotalExplanations.ts`; `aud14-receipt-capture.test.ts`; `bulkRoutes.ts:48` |
| BK-10 / H-9 / BM-04 | Workspace archive, help links, per-currency rounding | `workspaceArchive.ts`; `help-pages-coverage.test.ts` (153 help entries, all pages exist); `currencyMinorUnits.ts` |
| CMD-1 checkpoint rows | Batch 0 #719, period #731, numbering #732, account batch, inventory batch | `supabase/migrations/20261115000000_document_commands_server_only.sql`; RLS suite asserts `bookkeeper cannot insert an invoice directly` |
| SCREEN_REBUILD §1, §2, §4, §5 | RowTable, codemod, record page step, SchemaForm removal | `row-table.test.tsx` 7/7, `row-table-codemod.test.ts` 14 rules, `record-next-step.test.ts`, `SchemaForm.tsx` absent (`one-form.test.ts` asserts it)|

---

## 3. Done in the code but the box is empty

This is the largest error class. Each row was checked in the source at `f69e2b4`.

### 3.1 `docs/TODO_2.md` — 48 boxes, none ticked

`TODO_2.md` has **zero** checked boxes despite being the document the lead uses to feed the AIs'
queues. Several of its rows are demonstrably finished.

| Row | Requirement | What exists at `f69e2b4` |
|---|---|---|
| P2-1 | First hour, no dead ends, an e2e that walks it | `e2e/first-week-checklist.spec.ts`; W1 row of `RELEASE_GATE.md` is Connected/Verified/Browser **Yes** (G-24 in #282) |
| P2-2 | Month-end close journey in one place | `src/components/ledger/MonthEndCloseView.tsx`, `closeChecklist.ts`, `close-checklist-statuses.test.ts`; W9 is Yes/Yes/Yes |
| P2-3 | Israeli month as one path | `docs/verification/ai3-a152-israeli-month.md`; W7 Verified **Yes** (W7-GOLD) |
| P2-4 | US quarter as one path | `w8-gold.test.tsx`; W8 Verified **Yes** |
| P2-8 | Report picker (D-44) and one report frame | `ReportPicker.tsx` exists and is registered; D-44 is `[x]` in `COORDINATION_ARCHIVE.md:1879` ("already delivered in `ReportPicker.tsx`") |
| P2-15 | Error and empty states on every screen | `EmptyState.tsx`, `empty-states-next-ten.test.tsx`, A-272 batch |
| P2-21 | One table component for lists | `RowTable.tsx` + `rawTables` 184 → 126 |
| P2-25 | Dark mode: every input readable (D-45) | D-45 archived as **merged** (`[x]` in `COORDINATION_ARCHIVE.md:533`; #163), evidence `ai4-d45-report-controls.md` |
| P2-26 | Skeletons instead of spinners | `ReportSkeleton.tsx`, `LoadingState.tsx` |
| P2-29 | Keyboard: every screen without a mouse | `useDialog.ts` (focus trap/topmost-dialog answering, #146), `rowKeyboardNav.ts`, `e2e/keyboard-reports.spec.ts` (A-270/A-274) |
| P2-30 | Settings: 30 tabs into five sections with search | `Settings.tsx:11` — **exactly five** groups, with search |
| P2-32 | One printed-document template system | `data-print-root` + `e2e/print-styles.spec.ts` (A-271/A-277) |
| P2-34 | At most one banner on a phone (D-46) | D-46 archived as **merged in PR #164** (`COORDINATION_ARCHIVE.md:534`) |
| P2-35 | Every screen has "?" help | `screenHelp.ts` — **153** entries; `help-pages-coverage.test.ts` passes; H-9 ticked for exactly this |
| P2-51 | Icon-only buttons have a name and tooltip | `icon-button-labels.test.ts` + `icon-button-a11y-guard.test.ts`, both present |
| P2-61 | Favicon and app icon for installed (PWA) use | `vite.config.ts` `VitePWA` manifest with 192/512 icons and shortcuts; `index.html` links the manifest |

**One `TODO_2` row is already past its own prerequisite and should be re-scoped.** P2-35 says every
screen has three lines of help, and H-9 is ticked on that basis — but `TODO_2.md` still shows P2-35
open. Either the H-9 tick or the P2-35 box is wrong; both cannot be right.

### 3.2 `docs/COORDINATION.md` — the AI #9 "next batch"

The batch that `CURRENT_WORK.md` describes as AI #9's **P0 for launch** is implemented:

| Row | Requirement | What exists at `f69e2b4` |
|---|---|---|
| **L94-STEP2 (P0)** | `POST /api/v1/documents/:type/:id/post` saves the document and the **server** builds the entries in one transaction; `useEntityOperations` calls it instead of sending lines; a tampered client cannot change amounts | `src/server/routes/documentPostRoutes.ts` (zod `.strict()` body — a body carrying entries is refused), `src/server/services/documentPostService.ts`, mounted at `documentRoutes.ts:22`; the browser side is `src/services/ledgerPost/postingKit.ts:46` — `SERVER_POSTED` sends invoices/bills/credit notes/vendor credits to that route |
| **L94-STEP2B** | After STEP2, credit notes, vendor credits and deletes go the same way, then `/transactions/bulk` accepts only journals and bank lines | `bulkRoutes.ts:24,42` — `documentPostedByServer()` **refuses** a document and its entries with a 400 naming the correct route; the same refusal is in `crudRoutes.ts:151` |
| **W8-GOLD (P1)** | US quarter with worked figures; moves W8 "Verified" | `src/tests/w8-gold.test.tsx`; `RELEASE_GATE.md` W8 already reads **Verified: Yes** |
| **L-123 design (P2)** | A design note only | Design is merged; `RELEASE_GATE.md` records "L-123 server balances merged in #334, #345, #351" |

`L94-STEP2` being P0 and unticked is the single most consequential row in this report: the code is
in place and refused through two routes, but the plan still tells the next AI to build it.

### 3.3 `docs/COORDINATION.md` — AI #12's onboarding lane

AI #12's queue is entirely unticked, yet six of its ten rows have shipped code and tests:

| Row | Requirement | What exists |
|---|---|---|
| N-1 | First-week checklist on Overview, each item ticks itself, can be hidden | `src/lib/firstWeekChecklist.ts`, `dashboard/FirstWeekChecklist.tsx`, mounted at `Dashboard.tsx:148`, `first-week-checklist.test.tsx` |
| N-4 | Accounting glossary tab with plain-word entries | `support/GlossaryView.tsx` |
| N-5 | Five-step sample-workspace tour, skippable, restartable | `onboarding/tour/ProductTour.tsx` |
| N-6 | Empty screens say what to do first | `EmptyState.tsx` + the "empty states, next ten" batch |
| N-7 | Help button says what the screen is for in plain words | `screenHelp.ts` (153) + `plain-language-d97.test.tsx` |
| N-9 | Feedback button reaches a person, failure says so | `support/FeedbackWidget.tsx`, `feedback-widget.test.tsx`, `feedbackTicket.ts` |

`N-1` is also the row that `EU-A3` joins — `COORDINATION.md:900` says "if N-1 is still open when you
get here, build it and tick both". N-1 is built (`firstWeekChecklist.ts` + a mounted component +
a test) and **neither box is ticked**. Because the instruction is conditional on N-1 being open, the
next AI to reach EU-A3 will read it as open and build it again. This is the clearest case in the
repository of a stale box creating work rather than recording it.

### 3.4 `docs/COORDINATION.md` — AI #3's A-263…A-267

Five boxes have been `[~]` since early November. All five have named evidence documents that state
the work was implemented:

| Row | State | Evidence document says |
|---|---|---|
| A-263 | `[~]` | `ai3-a263-a265-2026-11-02.md`: implemented, local Chromium 9/9 |
| A-264 | `[~]` | `ai3-a264-2026-11-02.md`: implemented, 5/5 journeys |
| A-265 | `[~]` | same as A-263; `ReducedMotionProvider.tsx` + `reduced-motion-provider.test.tsx` exist |
| A-266 | `[~]` | `ai3-a266-2026-11-02.md`: implemented, 11/11, max shift 0.0615 |
| A-267 | `[~]` | `ai3-a267-2026-11-02.md`: **"A-267 remains partial"** — the journal footer contract was left to the lead |

A-263…A-266 read as "pending CI/lead review" from 2 November. Two weeks and many merges later, no
document says the review happened. Either they were merged (then tick them, with the PR number) or
they were not (then `CURRENT_WORK.md`'s instruction to "finish A-263…A-267 first" is live work that
nobody is doing — the AI #3 section now hands out A-278…A-282 instead).

A-267 is the one `[~]` that is **correctly** kept open: its own evidence says it is partial.

### 3.5 `docs/COORDINATION.md` — other lanes

| Row | Requirement | What exists |
|---|---|---|
| D-91 | Icon-only buttons: aria-label + tooltip everywhere, a test that fails on a new unlabeled one | `icon-button-labels.test.ts` and `icon-button-a11y-guard.test.ts`. The row exists twice — `[ ]` and `[~]` — with the `[~]` text saying "the guard test is in". |
| D-99 = F-50 | Browser journey for W14 roles | `RELEASE_GATE.md` W14 Browser **Yes** (D-99 roles in #324). The row is `[~]`, and the archive at `:3391` says D-99 "remains partial for real four-account sign-in/post/payroll/approval journeys" — so the `[~]` is defensible and the gate's "Yes" is the optimistic claim |
| D-98 | W10 backup/restore browser journey | `RELEASE_GATE.md` W10 Browser **Yes** (merged #324) |
| G-24 | First-hour journey, no dead ends | `e2e/journeys-w1.spec.ts` + `docs/verification/ai8-g24-first-hour-journey.md`; W1 Browser **Yes** (#282) — this is also P2-1 |

### 3.6 Summary of §3

| Document | Boxes that should be ticked | Consequence if left |
|---|---|---|
| `TODO_2.md` | 17 of 48 (§3.1) | The lead keeps re-feeding finished work into queues |
| `COORDINATION.md` AI #9 | 3 of 9 (L94-STEP2, L94-STEP2B, W8-GOLD) | P0 work is rebuilt, or the plan looks 2 weeks behind |
| `COORDINATION.md` AI #12 | 6 of 10 | A second first-week checklist is built |
| `COORDINATION.md` AI #3 | 4–5 of 5 | AI #3 is dispatched past unfinished work |
| `COORDINATION.md` others | 4 (D-91, D-98, D-99/F-50, G-24) | Workflow rows look unproven while `RELEASE_GATE.md` says Yes |
| **Total** | **~33** | — |

---

## 4. Boxes that are ticked but not proven, or contradict themselves

### 4.1 One task in three states at once

**G-24 (AI #8, first-hour journey).** `TRACKER.md`'s "Done this session" table claims G-1…G-16 and
G-20…G-24 as shipped. `COORDINATION.md:709` and `:845` still list G-24 as `[ ]`, and `:845` says it
was "moved here from AI #8". `RELEASE_GATE.md` W1 records G-24 as Browser **Yes** (#282), and
`e2e/journeys-w1.spec.ts` + `ai8-g24-first-hour-journey.md` exist.

The code and the gate agree that it is done; the two COORDINATION rows are the outliers. The same
pattern repeats across AI #8's whole batch (G-1…G-16, G-20…G-24): the `TRACKER.md` summary claims
them, and individual G- rows are still `[ ]` in `COORDINATION.md`.

### 4.2 R-5's claim is contradicted by the repository's own test

`COORDINATION.md:826` records R-5 as **done**: *"all 126 report views under 1 s on the 5,000-entry
year"*. Two things are wrong with that sentence.

1. **The count is stale.** `r5-every-report-speed.test.tsx` names itself `R-5: all 151 report
   views…` today. The registry has moved from 126 to **151** report views, and the test collects
   them from `src/components/{reporting,ledger,finance}`.
2. **The claim does not reproduce here.** The test fails at this commit with
   `TopPartiesReportView.tsx 1,449.78 ms` and `InboxView.tsx 1,099.88 ms` against a 1,000 ms
   budget. On a shared CI runner the test multiplies the budget by 3, so CI can be green while the
   product bar is not met. The honest statement is "passes in CI with the 3× allowance; 2 of 151
   views are above 1 s in this sandbox".

This is not a claim that the reports are inaccurate. It is a claim that "under 1 s" is not what the
repository measures at this commit, and the plan should say which budget it means.

### 4.3 The CMD-1 checklist's browser-write count is stale, and it disagrees with itself

`docs/prompts/CMD-1-checklist.md` states three different numbers for the same quantity:

| Line | Text | Scanner at `f69e2b4` |
|---|---|---|
| 9 | "the ratchet is 182 server route-write sites / **106** direct browser-write sites … spans 54 files" | 159 / **86** / 48 files |
| 10 | "the browser ratchet remains **106** sites across 54 files" | 86 / 48 |
| 36 | "the remaining **106** direct browser-write call sites across 54 files" | 86 / 48 |
| — | `SCREEN_REBUILD_CHECKLIST.md` §3 | "**direct count fell 106 → 96**" |
| — | `SCREEN_REBUILD_CHECKLIST.md` table | `directDbWrites` **86** |

`prompts/CMD-1-checklist.md:29` is correct ("the remaining **159**"), so the file is half-updated.
The scanner — `scripts/commands-baseline.ts`, which `src/tests/commands-baseline.test.ts` enforces —
is the authority, and it says **86 across 48 files**. The "54 files" figure is wrong too.
The `182 → 159` server-route drop is consistent with the account and inventory batches.

**The two counters measure different scopes, and no document says so.** This is worth fixing in the
scanner, not only the prose:

| Metric | Scope | Value |
|---|---|---|
| `commands-baseline.json` `directBrowserWrites` | all of `src/` except `src/server/**` and `src/tests/**` — the CMD-1 migration metric | **86** (48 files) |
| `quality-baseline.json` `directDbWrites` | `src/components`, `src/hooks`, `src/stores` only — the screen-rebuild metric | **76** |

The 10-site difference is exactly the `src/lib/` and `src/services/` files in
`commands-baseline.json` (`dimensionNodesMigration.ts` 3, `projectUndo.ts` 2, and one each in
`feedbackTicket`, `inlineRecordAdapter`, `recordDetailsAdapter`, `reportPreferencesDb`,
`attachmentActions`). Both numbers are correct for their own definition. A reader comparing "86" in
`SCREEN_REBUILD_CHECKLIST.md` with "76" in a ratchet table is looking at two different measurements
with the same name.

### 4.4 Ids that are simultaneously done and not done

| Id | Where ticked | Where unticked | Truth |
|---|---|---|---|
| C-86 | `TRACKER.md:1706` | `COORDINATION.md:241` `[~]` | Code and migration exist; the COORDINATION row is the stale copy |
| B-2 | `COORDINATION.md:869` (EU-B2) | `COORDINATION.md:837` (AI #11's B-2) | **Different tasks sharing an id** — EU-B2 is short forms, AI #11's B-2 is a receipt inbox |
| B-4 | `COORDINATION.md:871` (EU-B4) | `COORDINATION.md:839` (AI #11's B-4) | Different tasks sharing an id — EU-B4 is party defaults, AI #11's B-4 is duplicate bank lines |
| F-1 | `COORDINATION.md:873` (EU-F1) | `COORDINATION.md:644` (AI #7's F-1) | Different tasks sharing an id |
| CMD-1 | checklist line 12 | checklist line 67 | Different rows of the same list, not a contradiction |

**Finding:** the EU- items were numbered by dropping the `EU-` prefix, so `EU-B2`, `EU-B4` and
`EU-F1` collide with pre-existing `B-2`, `B-4`, `F-1`. Any search for "B-2" now returns two
unrelated tasks. The `EU-` ids should be kept distinct in the documents.

### 4.5 Checked boxes on documents that are themselves stale

`docs/SCORECARD.md` says **"Last updated: 2026-10-19"** and quotes "639 files, 731 suites" and
"2,949 pass". At this commit: **1,109 test files** and **5,458 tests (5,448 pass)**.
`npm run scorecard:update` **regenerates the date line and nothing else** — the numbers are written
into the generator's template, so re-running it updates "Last updated" to today while leaving
"639 files / 2,949 pass" untouched. That is the worst failure mode for this document: it will look
fresh forever while being wrong by a factor of 2.5. I confirmed this by running it (§1.3): the diff
was the date line alone. Either compute the counts in `scripts/scorecard.ts`, or delete the rows.

`CURRENT_WORK.md` header says **"Updated 28 Oct 2026"** and its "Not done yet" table still lists
"Stage B: W11 QuickBooks/CSV", "W13 stock", and "ERPNext depth: Repost engine (EG-1 #348 design),
Payment ledger (EG-2), Period closing voucher (EG-3), Stock snapshots (EG-7)" as open — while
`TRACKER.md` marks **BF-04 / EG-6 landed cost** done and lists EG-1…EG-3 elsewhere. Its own PR table
lists branches from October as "new".

### 4.6 `TODO_2` and `TRACKER` disagree about the same screens

`TODO_2.md` P2-30 asks for "Settings: 30 tabs grouped into five sections with search". Settings has
**41 tabs in five groups** (`Settings.tsx:11`). The item is arguably done and definitely
mis-stated. If it is done, §3.1 applies; if the tab count is the point, the number is wrong.

### 4.7 Where an "unchecked" item is genuinely not done — so the boxes are not just pessimistic

To show the unchecked set is not uniformly wrong, these were tested and are honestly open. This is
the control group for §3.

| Id | Requirement | Measured state at `f69e2b4` |
|---|---|---|
| A-267 | Form errors read aloud on five forms | Its own evidence says **partial**: the journal footer calls `save` outside the `<form>`, so a broad `reportValidity()` would reject blank descriptions the existing FX posting tests accept. Left for the lead. Correctly `[~]`. |
| CMD-1 §2 | Browser writes migrated table by table to commands | **86** direct browser writes remain across **48** files (scanner). The plan says so. Correctly open. |
| CMD-1 §3 | Assistant token, proposals, undo, `assistant/tools.json`, `SYSTEM_PROMPT.md` | `assistant/` **does not exist** at this commit. Correctly open. |
| CMD-1 §5 | Server route-write count zero, or every site listed with a reason | **159** write routes remain (scanner). Correctly open. |
| EU-A1 | Guest demo that every form can save into | `audit/AI14_FINAL_ACCURATE_STATUS_2026-11-11.md` says explicitly "Do not tick EU-A1"; the queue item in `COORDINATION.md:874` repeats that. Correctly open. |
| EU-G1 | Hebrew across the screens | `:875` records Sales/Purchases/Bank done (PRs #663, #700, #701), dialogs and the less-used reports open. Correctly open with a real partial note. |
| DIM-2 / P2-36 | Where an item came from and went, on the stock moves | `src/components/inventory/StockHistoryDialog.tsx` exists, but the full vendor→project/customer cost trail as one view does not. Correctly open. |
| W11 / AU-4 | Import totals match the source | `ImportAcceptanceView.tsx` and `importAcceptance.ts` exist (the screen is real), and `RELEASE_GATE.md` still lists W11 as Connected: **Partly**, Verified: **No**. The gate and the todo agree. |

All eight of these are correctly open. That is the counterweight to §3: the todo lists are
stale in a **specific** way — finished work is not ticked — rather than uniformly unreliable.

---

## 5. Numbers in the top-level documents that the repository contradicts

These are the figures a reader is most likely to quote. Each was re-measured at `f69e2b4`.

| Claim | Where | Measured | Verdict |
|---|---|---|---|
| "864 items", "705 open items", "the 179 that remain individual" | `TRACKER.md` | 177 checkbox lines in TRACKER, 916 archived done | **Three different totals for the same list.** The archive was emptied twice (20 Oct, 10 Nov) without a live denormalised count being rebuilt, so "864 / 705 / 179" are all historical |
| "Done 160 · Partly 11 · Total 864" | `TRACKER.md:230` table | 7 `[x]`, 33 `[~]`, 137 `[ ]` in the live file | The table counts archived items; the live file is 177 lines. Neither reconciles |
| "639 files, 731 suites / 2,949 pass" | `SCORECARD.md` | 1,109 files, 5,458 tests, 5,448 pass | **Stale by ~2.5×** |
| "106 direct browser-write sites across 54 files" | `CMD-1-checklist.md` ×3 | 86 across 48 | **Stale**; the scanner is authoritative |
| "182 server route-write sites" (at base) | `CMD-1-checklist.md:9` | 159 now (correct on line 29) | Stale in one place, correct in another |
| "all 126 report views under 1 s" | `COORDINATION.md:826` | 151 views; 2 over 1,000 ms here | Count stale **and** claim does not reproduce |
| "the direct count fell 106 → 96" | `SCREEN_REBUILD_CHECKLIST.md` §3 | 86 in the scanner it names (`commands-baseline`), 76 on its own `directDbWrites` row | Stale either way — see the scope table in §4.3 |
| "unreachableActions 0, screensWithManyPrimaryButtons 19, handTypedApiCalls 170, rawTables 196, directDbWrites 93" | `COORDINATION.md:761` (AI #9 second slice, 15 Nov) | 0 / 0 / **5** / **126** / **76** | **Four of five stale**, and the passage is dated 15 Nov — *after* the numbers changed. `rawTables` 196 vs 126, `handTypedApiCalls` 170 vs 5 |
| "`rawTables` 184 → 158" then "rawTables: 126" | `SCREEN_REBUILD_CHECKLIST.md` (lines 19/27 vs 81/108) | 126 | §1's own bullet says it converted 45 tables to 158, then §2 says two more passes took it to 152, and the table at the top says 126. The bullets are step-by-step and the table is current; a reader who stops at line 81 gets a stale number |
| **`UI_REBUILD_RATCHETS.md` "Today" column** | `docs/UI_REBUILD_RATCHETS.md:14-18` | — | **The ratchet document is the most wrong of all**: `rawTables` **184** (measured 126), `handTypedApiCalls` **84** (measured 5), `directDbWrites` **93** (measured 76). It also contradicts itself — its `screensWithManyPrimaryButtons` row says **0** while §"The sites that remain" directly beneath it lists 11 files at 3–4 filled buttons each |
| "Repost engine (EG-1 #348 design), Payment ledger (EG-2), Period closing voucher (EG-3), Stock snapshots (EG-7)" open | `CURRENT_WORK.md` | EG-6/BF-04 ticked in TRACKER | Needs reconciling |

---

## 6. Documents that should not be read as task state

### 6.1 `docs/BUG_PATTERNS.md` — 265 unchecked boxes

Every line here is `[ ] pattern-name — status text`. The boxes are the *format*, not a claim that
265 defects are open. A reader scanning for unchecked boxes will conclude the product has 265 open
bugs. Recommend converting to a table with an explicit state column, or dropping the checkboxes.

### 6.2 `docs/TODO_2.md` as a whole

48 unchecked boxes with no dates, no owners and no PR references, while `COORDINATION.md` and
`TRACKER.md` both carry the same work as items that are numbered, owned and closed. `TODO_2`
should either cite the owning id for each row or be folded into `COORDINATION.md`.

### 6.3 `docs/STATUS.md` and the archive

`docs/STATUS.md` is a 7-line redirect and is correct. `docs/archive/TRACKER_DONE.md` (916) and
`docs/archive/COORDINATION_ARCHIVE.md` (491) are frozen history and were not audited.

---

## 7. `RELEASE_GATE.md` — the one document that mostly holds

`RELEASE_GATE.md` is the canonical readiness index and is the most accurate of the planning
documents. Every "Yes" in it that could be checked against code has a named test or evidence file
that exists:

- W1 (G-24 #282, D-97 #295), W2/W3/W4 (F-41…F-43), W6 (F-44), W9 (F-45), W10 (D-98 #324),
  W12 (F-47, W12-GOLD), W13 (W13-GOLD), W14 (D-99 #324) — referenced tests and evidence files all exist.
- W7/W8 "Verified: Yes" are supported by `w7-gold.test.tsx` and `w8-gold.test.tsx`.

Two caveats, both already stated inside the file and therefore not errors:

1. **Stage A is declared READY** in the 23 Oct paragraph. It names G-01 and G-02 as required
   first-tester gates. G-02 ("one first-hour journey … no dead ends") is discharged by
   `docs/verification/ai8-g24-first-hour-journey.md` and its evidence does list "places a new user
   can get stuck". G-01 (setup saved, **returning user sees the same books after refresh, slow
   network, expired session, two books and account switching**) has **no matching evidence file**
   in `docs/verification/`. `FIRST_TESTERS_GATE.md:76` makes G-01…G-08 a precondition for the
   synthetic invited preview. So the "READY" sentence is one gate stronger than its own evidence.
   It is worth reading the 23 Oct paragraph as "the nine workflows are connected, verified and
   browser-tested", which is supported, rather than "invite testers", which needs G-01.
2. Several rows say "CI pending" or "awaiting review" for browser journeys. Those are honest, but
   they mean the Browser column is a plan of record, not a record of a green run at `f69e2b4`.

`RELEASE_GATE.md` should therefore stay the canonical index — and the other three documents
(`CURRENT_WORK.md`, `TODO_2.md`, `CMD-1-checklist.md`) should stop restating its numbers.

---

## 8. Recommended corrections, in priority order

Nothing below was applied by this audit; these are the edits the owner or the lead should make.

**P1 — the plan is telling AIs to build what exists**

1. Tick `L94-STEP2`, `L94-STEP2B`, `W8-GOLD` in `COORDINATION.md` with the PR/commit that merged
   them, or state explicitly why the code present at `documentPostRoutes.ts` does not close them.
2. Tick `N-1`, `N-4`, `N-5`, `N-6`, `N-7`, `N-9` in `COORDINATION.md` — with the file and test that
   proves each — before the EU-A3 instruction causes a duplicate checklist.
3. Resolve A-263…A-266: merge them and cite the PR, or return them to AI #3 and say the review is
   outstanding. A-267 stays `[~]` (its evidence says partial).

**P2 — numbers that mislead**

4. `docs/prompts/CMD-1-checklist.md`: replace 106 → **86** and 54 → **48** in three places; keep
   line 29's 159.
5. `docs/COORDINATION.md:826`: replace "all 126 report views under 1 s" with the measured
   **151 views**, and say which budget (1 s product, 3× CI).
6. `docs/COORDINATION.md:761`: replace the five counters with the current measurements
   (0 / 0 / 5 / 126 / 76).
7. `docs/SCORECARD.md`: the generator writes the date but not the figures. Either compute the test
   counts in `scripts/scorecard.ts` or delete the two "Unit tests" rows — a generator that refreshes
   the date but not the numbers makes a stale table look live.
8. `docs/TRACKER.md:230` and the "864 / 705 / 179" phrases: replace with one live count, or label
   them "historical totals as of <date>".
9. **`docs/UI_REBUILD_RATCHETS.md`** — the "Today" column is the stale-doc with the worst ratio:
   three of five counters are wrong (`rawTables` 184 → 126, `handTypedApiCalls` 84 → 5,
   `directDbWrites` 93 → 76), and the file contradicts itself on `screensWithManyPrimaryButtons`.
   Because this file is the page a rebuild ticket is checked against, quote `quality-baseline.json`
   or the `quality-ratchet.test.ts` output instead of typing numbers.

**P3 — structure**

10. `TODO_2.md`: tick the 16 verified rows in §3.1; add the owning id (`A-…`, `D-…`, `N-…`) to
   every remaining row so a reader can find its state in one hop.
11. Give the EU- items their own id namespace so `EU-B2`, `EU-B4`, `EU-F1` stop colliding with
    `B-2`, `B-4`, `F-1`.
12. `BUG_PATTERNS.md`: remove the checkbox syntax; it reads as 265 open defects.
13. `CURRENT_WORK.md`: its header date (28 Oct) and its "Not done yet" table predate three weeks of
    merges. It should either be regenerated or point at `RELEASE_GATE.md` without restating it.

**P4 — the audit gap this report cannot close**

14. Browser journeys (`e2e/`, 121 specs) and DB-backed suites (RLS, coverage) were **not run** here:
    no Playwright browser, no PostgreSQL. Every "Browser: Yes" in `RELEASE_GATE.md` is unverified in
    this report. A green CI run at `f69e2b4` should be cited next to this file before anyone treats
    the gate as certified.

---

## Appendix A — reproducible commands

```sh
# ratchets
npx tsx scripts/commands-baseline.ts                  # 159 route / 86 browser / 48 files
npx tsx -e "import('./scripts/quality-metrics.js').then(m=>console.log(m.computeQualityMetrics()))"

# the table sweep
npx tsx scripts/codemod-row-table.ts                  # 0 convertible, 149 refused

# the checks in §1.3
NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit -p tsconfig.json
npx eslint . --max-warnings 2
NODE_ENV=test SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic npx tsx --test --test-force-exit \
  src/tests/*.test.ts src/tests/*.test.tsx src/lib/*.test.ts src/server/utils/*.test.ts

# the R-5 reproduction
npx tsx --test src/tests/r5-every-report-speed.test.tsx
```

## Appendix B — what was *not* verified

- **Browser (Playwright) suites** — 121 specs, including every `e2e/print-*`, `phone-*`,
  `keyboard-*` and `visual-regression` spec. No browser in this sandbox.
- **Database suites** — `supabase/tests/rls.test.sql`, `npm run test:rules`, coverage gates. No
  PostgreSQL; `LF_TEST_DATABASE_URL` unset, so these skipped rather than passed.
- **Live deploy, Vercel, Supabase** — untouched and not probed.
- **Superseded archive documents** — read for cross-references only.
- **Individual audit reports under `audit/**`** — used as evidence pointers, not re-audited; several
  carry their own open findings (e.g. `audit/agent11` AF11-10…AF11-16 are declared **open,
  cross-lane** and remain open at this commit). Those findings are not restated as todo-list errors
  because they are not todos.
