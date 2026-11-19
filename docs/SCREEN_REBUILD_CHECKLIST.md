# UI-2 screen rebuild — live checklist

**Goal:** every action and report the server offers is reachable, without giving a new person a long menu.
Use [`prompts/UI-2-screens.md`](prompts/UI-2-screens.md) for the requirements. Its 17 November percentage is
historical, not an acceptance test. Earlier migration batches and their evidence are recorded below.

## Where we are — 18 November 2026

| Counter (`computeQualityMetrics()`) | Start of this batch | Now | Target |
|---|---:|---:|---|
| `rawTables` | 124 | **122** | Zero or an individual reason to keep each site |
| `handTypedApiCalls` | 5 | **5** | Zero or individually justified (§3) |
| `directDbWrites` | 0 | **0** | 0 |
| `screensWithManyPrimaryButtons` | 0 | **0** | 0 |

**122 is files, not tables**: 120 paths on the migration queue, `PivotSheetView` (dynamic pivot) and
`RowTable` (the embedded-table renderer itself). The full-list grid is excluded by the existing metric.
`raw-table-decisions.test.ts` now compares the metric's actual paths against the queue and named exceptions;
a new raw screen cannot slip in when a different screen migrates in the same PR. A queued file is **not** an exemption.

| Area | Already there — don't rebuild | Still open |
|---|---|---|
| Lists | Sales invoices/customers, Purchases bills/vendors and Inventory items use `TanStackDataGrid`; `scaffold:report` emits the grid. Embedded report lines use `RowTable`. | Finish migrating or justifying each remaining site. An embedded table is not a full list with search, saved views and phone cards. |
| Records and actions | Invoice, bill and party record shells; shared schema `CommandForm`; role/refusal/next-step handling in `useCommand`. | Other record kinds; generic inverse/Undo in the hook (the project-delete action has its own Undo). A schema form in API Hub isn't reachability from the palette. |
| Navigation | Seven daily areas, All tools, business-type defaults (`modulesForBusiness`), report/settings index and off-module “turn on” results. `business-menu.spec.ts` passed at 390 and 1280. | `CommandPalette` searches `SYSTEM_COMMANDS` and indexed pages, **not** every role-permitted entry in the 210-command generated manifest. Connect that manifest to a real form/page, and test finding and activating allowed commands in English/Hebrew and withholding forbidden ones. `palette-role-filter` is a helper test; `palette-reachability-guard` proves destinations, not that command contract. |
| Proposals | The private sandbox, persisted steps, live-read restrictions and atomic acceptance exist (#787, #853, #855). | Verify CMD-1 part 3's edit/revalidation, partial acceptance, rejection, expiry and inverse contracts before the “Waiting for you” UI. Customer estimates are not assistant proposals. |
| First hour | `first-hour-journey.spec.ts` at **390 and 1280**: Tab/Enter through the signed-in workspace shell to create a customer, issue and **email** an invoice, record its payment and open Reports. It checks the PDF reached the test mailbox once, the recipient’s send log, the paid invoice and **$900** net income from the server. The phone menu now closes over the chosen page and returns keyboard focus there. | The external mail provider and hosted sign-in are test boundaries, not certified by the journey. H-3 remains a separate keyboard test with stubbed writes. |

## 1. One list — earlier batches

- [x] **A declarative table for the table that is part of a sentence.** `src/components/ui/RowTable.tsx`, with the
      column shapes and the CSV built from the same columns in `src/lib/rowTable.ts`. It renders the markup the
      screens already rendered — same table class, head class, row-header class, cell classes — and adds the four
      things a hand-written table mostly lacked: a caption, a row header, `align: 'right'`, and CSV built from the
      same columns. Pinned by `src/tests/row-table.test.tsx` (7 tests: accessible name, row header, right-aligned
      CSV decimal, row order, repeated column, footer, empty state).
- [x] **One column spec, not a union of two.** A column declared once and a column that repeats over a list were
      two interfaces in a union, and TypeScript cannot contextually type a function-typed property of a union of
      object types: every inline `columns={[{ header: 'Year', cell: row => row.year }]}` wrote `row` as an implicit
      `any` — 238 `tsc` errors across the 41 swept files. `over` is now a property of the one spec, so `row` comes
      from `rows` and a repeated column names its heading with `head`. `RowTable<T, C>` carries the item type, and
      both are inferred at the call site.
- [x] **A codemod that can write, not just survey.** `scripts/codemod-row-table.ts` — `--write` converts,
      `--files` names every table it refuses and why. 14 rules pinned by `src/tests/row-table-codemod.test.ts`,
      including the two ways it could destroy a screen: a dropped `<tfoot>` totals row, and an interpolated class
      `${th}` turned into the text `${th}`, and a `over` re-scoped out of the row it was read in.
- [x] **The five review findings on the first draft are fixed, each with the test that would have caught it.**
      The codemod's first draft passed every structural refusal and still changed screens, because a table that
      converts is not the same as a table that looks the same:
      1. a header cell's class was merged into the body cell's `className` — so `Posted`'s `pl-3` left the header
         and the body cell gained `py-2 font-semibold`. Now each side keeps its own (`headClassName`), and a header
         with no class of its own says `headClassName: ""` so the default weight is not invented for it;
      2. every caption became `sr-only`, hiding the visible caption line five screens show above their table. Now
         `captionClassName` carries the class the `<caption>` had, `""` when it had none;
      3. a header that mixes text and an expression — `Balance ({currency})`, `Last rate (1 = … {home})`,
         `In {base}` — was written as the literal text of the expression. Now it stays JSX;
      4. a `<thead className="sticky top-0 …">` lost its class, because only the `<tr>` was read. Now both move
         onto the one element the component classes;
      5. a `<table key={side}>` inside a `map` lost its `key`, which React warned about in the browser smoke test.
         Now the key is kept, and a table carrying any other attribute (`aria-label`, `id`) — a name this
         component has no prop for — is refused rather than silently losing the name a screen reader announces.
      Two more of the same kind were found while re-running the sweep: a bare `<thead>`/`<tbody>` must not inherit
      the component's default `text-[var(--muted)]` / `divide-y`, and the replacement must not double the indent
      the source keeps.
      6. a nested map emitted `over: row.months` — the `columns` array is outside every row callback, so `row` is
         not in scope there. `over` is the header's own list, and a body that maps a *different* list than its
         header is refused (the two lists lining up is the contract the column depends on);
      8. a cell's own attributes were dropped: `dir="rtl"` on the Hebrew column of
         `AccessibilityAndLanguagePanel`, the `aria-label` that explains a bare currency code in
         `CurrenciesSettings`. A column now carries them (`cellProps`), as a function of the row when the value
         reads the row — a column is declared outside it — and a *header* cell that carries one is refused, since
         no converted table needs one yet;
      9. `readMapped` accepted `(m, i) => …` and dropped the index; the signature must now be one identifier with
         an optional type annotation, the same rule `attemptConvert` already applied to the row callback;
      7. every cell got `text-left` or `text-right`, so a bare `<th>` that browsers centre moved left, and a
         one-sided `text-right` turned a left header right. A column now carries an alignment class only when it
         declares `align`, and the codemod declares it only when the header *and* the body said right — otherwise
         each side keeps the class it had.
- [x] **45 tables in 41 files converted**, `rawTables` 184 → 158, 41 screen files −60 lines net (the explicit
      class props cost lines and buy exactness), `npx tsc --noEmit` clean, `eslint . --max-warnings 2` still at the
      two pre-existing warnings, **5315/5315 unit tests green**.
- [x] **The earlier ratchet lowered** — `rawTables: 126`, so a new hand-written table fails CI.
- [x] **Two lists told the truth again.** `StockClosingPanel` and `JournalSheetReportView` left
      `raw-table-decisions.test.ts` (they no longer draw a table, so their reasons were false) and
      `PickPackShipPanel` left the H-8 date backlog (its dates now go through the resolver).

## 2. One list — what is left, in the order that moves the counter

- [x] **The empty row and the rows as one ternary.** `{list.length === 0 ? <tr>empty</tr> : list.map(…)}` is one
      expression, not a map, so the empty-state reader (which only knew `cond && <tr>`) never saw it. Both halves
      are read now, in either order, and the wrapper parentheses are the same branches without their wrapper.
      Its siblings then report the reason that is actually theirs — the map returns a fragment of two rows,
      which is not one row — instead of "not a map".
- [x] **The shape most report tables are written in, which the codemod could never convert.** A header that
      maps a literal list of names (`{['Date', 'Day'].map(head => <th>{head}</th>)}`) declares its columns by
      *mapping*, so the count check compared the row against an empty header list and refused every one of them —
      41 tables. Read the names and compare the row against those, and reuse them for the emitted headers: 37
      tables in 30 files. Two things it may not do, and says so instead: a header whose *class* reads the header
      item (`\`${head === 'Amount' ? …}\``) — that name lives inside the header's map, which a column list is
      outside of — and a row that mixes written-out cells with a nested map, because the array branch has no
      entry to put those cells in.
- [x] **The two shapes the component already had a prop for, taught to the codemod.** A `<tfoot>` totals row is
      `footer` (and `footerClassName` when the `<tfoot>` carried `sticky bottom-0` or a rule), and the row a report
      prints when its list is empty is `emptyRow` — rendered *inside* the body, so the table, its head and its
      columns are still there and the sentence still sits under the columns it is about. `empty` (which replaces
      the table) is unchanged. 12 tables in 9 files, `rawTables` 158 → 152.
- [x] A conditional row that is not about the list being empty (`{canAdd && <tr>…}`) is still refused: it is not
      an empty state, and moving it would delete it.

### Comparison reports batch (18 November)

- [x] Restored the shared report chooser on `RowTable`. Native rows and fragments already had source column
      indices; rows behind a React component did not. `RowTable` now applies the same order at the point it renders
      the cells. The user can move and hide a column, reopen the report and export the **displayed** values in that
      order, including Hebrew text. Column visibility is remembered per header layout: inserting a comparison
      period cannot silently hide the invoice name instead of an amount. Existing hidden-column preferences are
      adopted on the first visit. The separate plain-numeric financial export is unchanged.
- [x] Codemod: one optional column may be guarded by the **same table-level identifier** in the header and body.
      An unconditional row heading may follow a code or an optional period. Different guards, a row-dependent
      guard, conditional or multiple row headings, or a row with attributes we would lose do not convert.
- [x] Converted **three tables in two files**: account balances as of a date, payment period by invoice date
      (`EverydayReportViews`), and gross profit by customer (`CustomerGrossProfitView`). Comparison on/off,
      amounts, names, keyboard moves, visible CSV and saved layout are checked on rendered tables, not inferred
      from the presence of a button. The chooser and export templates use the reports dictionary.
- [x] On this branch: 390/1280, light/dark, English/Hebrew and scoped axe on all three reports
      (`visual-regression.spec.ts`, filter `visual comparison reports`). `column-chooser.test.tsx` also exercises
      a previously migrated report (bank holidays) and checks that moving a bilingual cell keeps its DOM identity.
      The [visual refresh](https://github.com/shmuelbiller1/ledgerflow/actions/runs/44416325020) captured and
      rechecked 12 Linux Chromium references. Reviewed: the focused export, right-to-left headings and visible figures.

### Comparison reports — second batch

- [x] **Sales trends by customer/item and purchase trends by vendor** now use `RowTable`. Overlapping windows
      keep separate rows for the same month/name; the optional window label is translated. Hiding/reordering a
      column for one grouping or comparison mode does not hide a different column in another. A window with
      no matches keeps its headings and group selector, without layout/export tools; genuinely empty books get
      a single next action. Valid previous rows and incomplete-history notes are not mistaken for empty books.
- [x] **Supplier quote comparison** uses the shared report table. The per-currency rankings, last billed cost
      and original minor-unit CSV still come from `compareVendorQuotes` and its export helper. A viewer can
      compare/export but gets neither the edit form nor an Actions column. A bookkeeper can open the existing
      form or remove the intended quote after reordering; an unconfirmed save retains the draft. The draft and
      late replies stay with the user/workspace that opened it. A filtered-out item is not an empty catalogue.
- [x] **Evidence:** `visual-regression.spec.ts`, filters `visual document trends` and `visual vendor quote comparison`:
      keyboard-only at 390/1280, light/dark, English/Hebrew, scoped axe (including the open quote editor),
      CSV contents, layout persistence, and a live role change. The original deep-link tests still assert the
      2024 period and both Sales group headings. [Before views](verification/images/ui2-trends-quotes/);
      the [final official refresh](https://github.com/shmuelbiller1/ledgerflow/actions/runs/44433041496) captured and
      rechecked all 12 `trends-sales-*`, `trends-purchases-*` and `quotes-*` references. Reviewed both viewport
      sets. Language, theme and the UI font are in place before native selectors mount; no tolerance was raised.

**Next batch:** On the `bce500c` base the dry run offered 15 tables in 14 files. Two eligible table blocks
were migrated; the re-survey offers **13 tables in 12 files**, still **131 refused blocks** (including the
shared renderers). `rawTables` counts files: 124 → **122**. No new exemption, no hand-converted refusal.
Start with **`PurchaseItemTrendsView`** when the Hebrew-report PRs (#872/#877) are settled: its unit/currency
breakdown and full-history load are **not** the vendor totals migrated here. Check per-currency figures, full
history vs cached/guest, workspace changes and the item-trends CSV. If still reserved, `ProjectProfitabilityView`
is an eligible unreserved single-table file; preserve its chart filters and posted figures. Recheck PRs and
rerun `npx tsx scripts/codemod-row-table.ts --files` first. The most common refusals remain maps that don't
return one row (34), unsupported headings (31), and bodies that aren't a map (15).

## 3. One way to act

The counter looks for an authenticated `fetch` in components, services and hooks, not just a literal URL in a
screen. At this revision the five measured sites are:

| Site | Why it remains / next action |
|---|---|
| `PayRunHistory.downloadPayslip` | PDF download, not a JSON command result. |
| `BrandingSettings.previewBranding` | The unsaved draft is rendered to a PDF preview; no branding save. |
| `OrderDeliveryDialog.openNote` | Opens a delivery-note PDF for printing; not the command to record a delivery. |
| `documentDownloads.downloadDocumentsZip` | Binary archive containing several documents. |
| `Banking.handleSyncNow` | Live Plaid sync with per-connection busy, failed and reconnect results. **Still work**: preserve these replies when moving it behind the shared client. |

> **Coordinate before touching a command.** `src/server/` belongs to AI #1 (AGENTS.md), and every item below is
> "a screen stops writing and asks a command" — which means a command that does not exist yet. The server half of
> each item is a handoff, not a patch: the input schema, the handler, the audit entry, the offered next steps. The
> two that landed so far (`autorule.learn`, and the `next` step on `invoice.update`/`bill.update`) touch only the
> manifest description and the handler surface a reviewer can read in one screen, and are called out in their PRs
> for AI #1 to review; anything that moves money, posting or tax is out of scope here entirely.

- [x] **The sample company's writes have one home.** Two kinds of write exist in the browser and only two: a
      **command** for a workspace on the server, and the **local store** for the sample company, which has no
      workspace there. Both used to be the same six names (`setDoc`, `updateDoc`, …), so the demo's write and a
      screen writing to Postgres read identically — and `src/lib/db/` was *ignored* by the counter, so the demo's
      writes were not even measured. `src/lib/db/localStore.ts` is now the only place they live: `localAdd`,
      `localSet`, `localUpdate`, `localDelete`, `localUpdateMany`, each of which asserts a guest session first, so
      a screen that forgot its guest branch fails loudly instead of writing to a workspace that never asked.
      `useAutoRules` (6), `ruleActions` (3) and `InboxView` (1) call it; `commands-baseline.json` counts
      `localStoreWrites` (6) beside `directBrowserWrites`, and the direct count fell **106 → 96**.
- [x] `directDbWrites` **93 → 0**. The browser no longer writes a record: every site below names a command, and the
      order is the order they were done in:
      - **bootstrap** — **done, 2 sites.** `useLedgerData` wrote the person's profile and their first workspace
        from an `onSnapshot` that fires whenever the collection is empty: a `setDoc` inside a listener, no audit
        line, and two tabs opened at once both see the empty collection and both write. `user.provision` and
        `workspace.create` are `scope: 'person'` commands (the shape `groups.*` already uses, so neither needs a
        workspace to name); the hook sends both with an idempotency key derived from the uid, so the second tab is
        answered by the first one's record instead of opening a second empty book. Profiles are never rewritten.
      - **derived maintenance** — **done, 10 sites.** `autorule.learn` keeps the learned pattern's count and
        merge (`postingHelpers`, `useEntityOperations`); `customer.balance` / `vendor.balance` sum the open
        documents for a contact instead of trusting the ones the open tab has seen (`useEntityOperations`); and
        `workspace.dimensionnode` / `workspace.dimensionaxes` own the label rows and the axis list
        (`dimensionNodeActions`). The adapter that the dimension screens call now talks to the commands and keeps
        its guest path on the local store, so the module's own logic and its tests are untouched.
      - **undo** — **done, 2 sites.** `project.delete` writes the row it removes to `deletedProjects` (one row per
        workspace and project id) and answers with the id; `project.restore` takes **only the id** and reads that
        row. Nothing of the deleted project lives in the tab any more, which is what the browser's ten-second
        closure could not promise: a reload or a second tab can still put the project back, an id that has been
        taken again is refused (`CONFLICT`, "not overwritten") instead of overwritten, and the kept row is cleared
        once the project returns. The toast keeps its ten-second window because that is about *this* toast — the
        window decides whether to offer the step, not whether it is allowed.
      - **the settings row** — **done, 19 sites.** Sixteen screens under `Settings` (appearance, defaults, money
        display, payment terms, custom fields, scheduled reports, email, AI, blueprint, the set-up wizard and the
        Monday/report-note panels) each patched the `workspaces` document by hand, with `updatedAt` typed by the
        browser. They send `workspace.settings` now: one allowlisted schema, owner or accountant only, the report
        notes merged per key so a note another report saved meanwhile is not erased, an emptied note removed rather
        than stored as `""`, and one audit line per save (`WORKSPACE_SETTINGS_CHANGED`). `saveWorkspaceSettings` /
        `saveWorkspaceAxes` keep the demo's half: the sample company has no workspace on the server, so its screens
        write their own copy (`localUpdate`) instead of asking — the branch those `updateDoc` calls used to get for
        free, and the one the sample company's own tests insist on. The currency is accepted only
        while the books are empty, which is the set-up wizard's step and nothing else: with a document in the
        workspace the command refuses (`CONFLICT`) instead of re-reading every stored amount in a new unit. The
        label axes that three of those screens also wrote went to `workspace.dimensionaxes`, and the wizard's
        business step splits its payload in two for the same reason. The tests that asserted the old `lf_update`
        body assert the command's `input` instead, which is the same promise stated where the guard now lives.
      - **budgets** — **done, 3 sites.** `BudgetManager` added, changed and removed a plan with `addDoc`,
        `updateDoc` and `deleteDoc`, dating the row from the tab; `budget.save` and `budget.delete` write it
        instead, refuse an objective that belongs to another workspace, refuse an amount that is not whole cents
        (a plan is compared with posted amounts), and put the "viewers cannot change budgets" rule on the server
        rather than on a hidden button. The label the plan is kept against (EU-E5) is set, changed or taken away
        through the command, and the rest of the row's metadata is kept.
      - **the roster, the shelf, the quote, the chart** — **done, 29 sites.** Four screens wrote their own
        collection by hand: the payroll screens (`PayrollView`, `DeductionsCell`, `TimeOffCell`, `HourlyPayCell`,
        `DirectDepositDialog`), the inventory screen (`Inventory`, five sites), the sales screens (`EstimatesView`,
        `MilestoneSchedule`, `OrderInvoiceDialog`) and the ledger's own (`ChartOfAccountsView`, `WorkpapersPanel`).
        Eight commands now own those rows — `employee.create` / `employee.update`, `inventoryitem.save` /
        `inventoryitem.field` / `inventoryitem.delete`, `estimate.save` / `estimate.status`, `chartaccount.update`
        — and each screen writes through one helper in `src/lib/recordWrites.ts` that *is* the whole guest/command
        branch: the sample company writes its own copy on the local store, a signed-in tab sends the command.
        - A new employee is one `employee.create` carrying the id the tab generated, so a retry after a refusal
          reuses it and the server answers the repeat instead of hiring twice; `workspaceId` comes from the
          session, so a draft cannot be posted into another book. `employee.update` names only the fields the
          person changed — a raise cell never rewrites the bank account it did not see.
        - `inventoryitem.save` strips the server-owned counters out of whatever the form sends (`quantityAtHand`
          is derived from the movements, not typed), and the screen's opening stock is a second call to the
          movement command with the id the save answered with — so the item and its opening count are two facts
          with two audit lines, not one row the tab guessed at.
        - `estimate.save` writes the quote and its milestone schedule (the schedule is part of the terms), and
          `estimate.status` moves it: accepted stamps `orderedAt`/`orderedBy` from the session rather than taking
          them from the tab, and `converted` is one way — a quote that became an invoice cannot go back to being
          a quote. `chartaccount.update` takes **one** `archived` flag and derives `isArchived`/`isActive`, because
          the two halves have to agree and the screens used to send them separately.
        - Tests: `employee-commands.test.ts`, `inventory-item-commands.test.ts`, `estimate-chart-account-commands`
          `.test.ts` (22 cases: the fields each command accepts, the refusals — a viewer, another workspace, a
          system account's code, an accepted quote's lines, a repeat creation — and the audit line each writes).
          The screens' own suites (`payroll-deductions`, `pto-accrual`, `direct-deposit`, `employee-creation`,
          `estimates-view`, `sales-orders`, `milestones`, `chart-of-accounts-inline`, `workpapers-ui`, inventory ×4)
          now assert the command's `input` where they asserted `lf_update`'s `p_set`: same promise, stated where
          the guard lives.
      - **the person's own settings, and the second workspace** — **done, 4 sites.** Three files wrote the caller's
        profile row and one built a workspace row by hand: `useNotificationFeed.saveNotificationPrefs` and
        `reportPreferencesDb.save` (both `updateDoc(users/{uid})`), `useSystemActions.handleCreateWorkspace` (a
        `setDoc` of a row it had just built, with both timestamps typed in the tab) and `BlueprintSettings`'
        currency switch (a bare `updateDoc` on `workspaces`, which is exactly the write `workspace.settings`
        refuses once a document exists).
        - `user.preferences` is `scope: 'person'`: the row is always `ctx.actor`'s, so there is no workspace to name
          and no role to check. Notices merge per key (a save that mentions one toggle cannot clear the rest);
          a report's layout is written into the map this transaction read, so saving one book's layout leaves the
          other books' alone, and the layout's `uid`/`workspaceId`/`updatedAt` come from the session — a payload
          cannot claim a report belongs to someone else. A person whose profile row was never written gets the same
          skeleton `user.provision` writes instead of a `NOT_FOUND` for a row they never asked for.
        - `handleCreateWorkspace` sends `workspace.create` (the command `useLedgerData`'s bootstrap already uses)
          instead of minting the row and both timestamps itself.
        - The currency switch asks `workspace.settings`, and says why when the command refuses: before a document
          exists it is a setting, afterwards it is a migration of every stored amount.
        - Pinned by `user-preferences-command.test.ts` (6 cases: the merge, the untouched other book, the owner
          fields coming from the session, the empty save refused, the audit line).
      - **the legacy label tree, and an archived account** — **done, 4 sites.** `dimensionNodesMigration` moved a
        legacy `workspace.dimensionNodes` tree into the collection with a `writeBatch` + `updateDoc(deleteField())`
        from the browser, in the background, with no answer: a tab that went away halfway left half the tree in the
        collection and half on the row, and the next load migrated the same values again. `workspace
        .dimensionnodesmigrate` writes the values and clears the legacy field **in one transaction**, refuses a
        label with no axis (the row id is derived from it, so it would land where no screen reads), and takes at
        most 450 rows — the screen's own chunk. `handleDeleteAccount`'s deactivate branch is one
        `chartaccount.update` with `archived: true`; the two `addDoc(auditLogs)` calls that sat beside them are
        gone, because the command writes the line.
        - Pinned by `dimension-nodes-migration-command.test.ts` (6 cases).
      - **a new account in the chart** — **done, 2 sites.** `Ledger`'s add-account form wrote the row with `addDoc`
        — its own `createdAt`, whatever `type` the select held, and no check that the code was free, so the same code
        could be added twice and every report that groups by code read two accounts as one. `chartaccount.create`
        owns the row now: the code is unique inside the workspace (`CONFLICT` naming the account that already has
        it), the group rule is the same one the picker uses, and `balanceCents`/`openingBalanceCents` are written as
        zero by the command — an opening figure is the transaction this flow records next, not a number typed on the
        account. The offset account the flow creates when the chart has none goes through the same command.
        - Pinned by three more cases in `estimate-chart-account-commands.test.ts` (a free code is written with the
          workspace from the request; a taken code is refused and nothing is added; a balance or a sixth type is not
          input; a bookkeeper is refused).
      - **files: the Vault, a snapped receipt, an attachment** — **done, 5 sites.** Three screens `addDoc`'d the
        `documents` collection and one `updateDoc`'d it, each sending `uid`, `workspaceId` and `createdAt` from the
        tab. That collection is the one place a tab could file something into a book it could not otherwise write,
        and date a receipt before the bill it justifies. `document.save` writes the owner and the workspace from the
        session and stamps the time; it takes `id` for the link half, which is why linking a receipt to the draft
        bill it became does not re-send the file. `documents-ui`' suite asserts the command's `input` now (and that
        `uid` never appears in it).
      - **the label values, in bulk** — **done, 2 sites.** `DimensionsSettings` wrote the tree twice with a
        `writeBatch` — on save, and when it backfilled values from the free-text paths on old transactions. A batch
        is atomic inside one tab and nothing else: no role, no audit line, `updatedAt` from the browser, and
        `workspaceId` on every row whatever the tab held. `workspace.dimensionnodes` writes up to 450 values in one
        transaction with the workspace from the session, and deliberately does *not* touch the legacy field — that is
        `workspace.dimensionnodesmigrate`'s job, and a save must not look like a migration.
      - **a loan payment and a capitalised cost** — **done, 2 sites.** `LoansView` appended a paid instalment to the
        loan, and `ConstructionActions` replaced an asset's `costAdditions` list together with its
        `purchasePriceCents`. Both are lists the screens read back, both were read-modify-written in the browser
        (two tabs keeping only the last one's list), and neither was checked against a workspace.
        - `loan.payment` records one instalment against the loan the server reads; a repeat answers `CONFLICT`
          ("instalment 2 is already recorded") instead of appending a second line, and the entry that posted it is
          kept as the payment's `transactionId`.
        - `asset.costaddition` appends the one cost and derives the basis from the list it read in the same
          transaction, so a total can never describe a list it no longer has. A cost of zero is refused.
        - Pinned by `loan-asset-commands.test.ts` (7 cases), and `construction-in-progress`' Add-cost suite now
          asserts the command's `input` — the tab sends neither the old list nor the new total.
      - **three batches that were the tab's own** — **done, 3 sites.** `markNotificationsRead` built a `writeBatch`
        over the ids on screen (device clock, no check that the row was the caller's); `CategoryManagerDialog`
        renamed a category with a batch built from the items the open page had loaded (an item the list had not
        scrolled to kept the old name, so the "renamed" category came back on reload); and the AI settings screen
        deleted the learned patterns it happened to have paged in.
        - `notification.read` is `scope: 'person'`: it marks the caller's own rows, skips ids that are not theirs
          instead of failing the whole click, and answers with how many were actually marked.
        - `inventory.categoryrename` reads the workspace's cards inside the transaction and renames the ones that
          carry the name (trimmed, case-insensitive — the same comparison the screen used); an empty name removes
          the category rather than storing a space.
        - `autorule.reset` clears every pattern of the workspace in one transaction and answers with how many went,
          so "memory purged" is a fact rather than a page.
        - Pinned by `notification-category-rule-commands.test.ts` (5 cases).
      - **support, 6 sites.** `SupportView` opened a ticket with `setDoc`, then asked the API for the message and
        wrote it from the browser when that answer did not arrive; the feedback widget wrote ticket and message in a
        tab-side batch. Now `support.ticket` writes both rows in one transaction with the owner and the workspace
        from the session, `support.message` appends a reply and moves the unread flags and stage together, and
        `support.status` triages. A reply reads the same whichever path wrote it, because the fields are the route's.
        - Pinned by `support-commands.test.ts` (7 cases); `support-ticket-ids` and `feedback-widget` rewritten to
          assert the command.
      - **an audit note, an empty account and a template, 4 sites.** `transactionActions` recorded "entry updated"
        and "entry reversed" with `addDoc` into `auditLogs` — the one collection where a browser write is actively
        wrong, because the trail is a hash chain and a client row has no position in it. `auditlog.append` takes only
        *what* happened; the actor, the clock, `seq` and the hashes come from the session and the trail.
        `workspaceActions` deleted a chart account and then wrote its own audit line: `chartaccount.delete` now refuses
        an account that a transaction, entry, budget, line or rule names (archive it instead) and writes the line in the
        same transaction. "Save as template" captured whatever the tab had loaded; `workspace.savetemplate` reads the
        active chart on the server, so an archived account is not resurrected in the new workspace.
        - Pinned by `audit-account-template-commands.test.ts` (7 cases).
      - **presence, 3 sites.** `useCollaborators` wrote `presence/{uid}` with `setDoc` every thirty seconds and
        `deleteDoc`-ed it on unmount — the row named its own owner and its own clock, and the workspace was whatever
        the tab had loaded. `presence.beat` writes the caller's own row (session `uid`, email, workspace, server
        clock) and `presence.leave` can only remove that row. Neither writes an audit line: a heartbeat is not a
        record.
      - **the record's own fields — done, 2 sites, and the open question is answered: an allow-list.** The two
        inline-edit adapters (`recordDetailsAdapter`, `inlineRecordAdapter`) wrote `updateDoc` on whatever `kind` the
        caller passed. They send `record.fields` now, and the table the server reads is `EDITABLE_RECORD_FIELDS` in
        `src/lib/editableRecords.ts` — the merge of the two screens' own lists (`RECORD_DETAIL_FIELDS`,
        `INLINE_RECORD_FIELDS`) plus one derived entry, `dimensionNodes.aliases`, which is not a field a person
        types: the label editor produces it so the previous name is kept. A collection or a field that is not named
        there cannot be written through that door at all, which is the fail-closed half of the question below: a
        screen added tomorrow breaks until someone lists it, and a field with a ledger meaning (an amount on a
        document, a posting date, a balance, a quantity, a status a command owns) never appears. The command also
        re-checks the role, stamps `updatedAt` from the server clock, writes the audit line, and — when the screen
        says what it read — refuses with `CONFLICT` **in the same transaction**, so the compare and the write cannot
        be separated by another tab. `metadata.client` is a nested patch that keeps its siblings, and the field
        allowlist is asserted equal to the screens' lists by `record-fields-command.test.ts` (9 cases), so the two
        sides cannot drift.
      - **the last three — done, `useEntityOperations`' generic create/update/delete.** Every collection with a ledger
        meaning branches to its own command before these fallbacks, so what was left is the long tail of ordinary
        records. They send `record.save` and `record.delete` now, over an allow-list in `src/lib/plainRecords.ts`:
        `purchaseOrders`, `recurring`, `taxRates`, `projects`, `inventory`, `assets`, `estimates`, `loans`. A create
        gets its id, `uid`, `workspaceId` and both timestamps from the session — a request body cannot hand a row to
        another workspace or another person — a save is a patch over the row read in the same transaction, an id that
        is already taken is a `CONFLICT` rather than a replace, a collection that is not on the list is refused by
        name, and both commands write the audit line. The one collection the hook still creates outside the list is a
        chart account, which goes through `chartaccount.create` — the command that keeps a code unique in the chart.
        Pinned by `plain-record-commands.test.ts` (10 cases), and the counter in `quality-baseline.json` is **0**. — write routes that already have a command in most cases
        (`SupportView` 5, `useEntityOperations` 3, `useCollaborators` 3, `Ledger` 2, `Vault` 2 …): one commit per
        hook, not per call, because a hook that writes has one shape. Three are deliberately *not* converted yet:
        `useCollaborators`' presence rows (ephemeral, one row per open tab, nothing to audit), `shared.ts`'
        `recordAudit` (the browser still writes the audit line for screen-level acts such as an export) and
        `SupportView`'s offline fallbacks, which stand beside the support routes and need a support command pair
        first.
- [x] **Undo on the result.** `deleteProjectWithUndo` offers the command's own step back (`project.restore` with the
      id `project.delete` answered with), and the deleted row is kept by the server rather than by the tab. Still
      open: wiring `entry.inverse` through `useCommand` so a screen that deletes through the hook gets the same
      toast without hand-writing it — the manifest already carries the name and the input.
- [x] **The offered next step in the toast** ("Invoice 1042 saved. Send it · Record a payment · New invoice").
      `invoiceSavedSteps()` (`src/lib/nextSteps.ts`) decides the list from the saved document, and the payment
      button wears the manifest's words for `payment.receive` — a step the manifest stops offering leaves the
      toast with it. Sending is the screen's own word (it is an email, not a ledger command), `Send it` only on a
      draft, and `New invoice` only once the document exists; a settled invoice gets the sentence and no dead
      button. `NextStepToast.tsx` draws it with `toast.custom` because sonner's `action` holds one button: real
      `<button>`s, dismiss-before-run. Pinned by `record-next-step.test.ts` (labels held to `offeredSteps`).
      Two saves are not offered at all, because the offer would be false: a sale receipt pays the invoice in the
      same save and `recordReceiptPayment` is the voice that says so (an offer drawn first would name `Record a
      payment` for a payment already being taken), and a reply that lands after the person opened another
      workspace says where it went (PREV-5) instead of offering buttons into books they left. Pinned by
      `next-step-toast.test.tsx` (the buttons, the press, the closed offer, the receipt, the moved workspace).

## 4. One record page

- [x] `InvoiceRecordPage` takes its next step from the manifest, not a hard-coded `if (isDraft)`. `invoice.update`
      offers `payment.receive` ("Record a payment") the same way `invoice.create` does — the step after a document
      does not depend on how it got there — and the page reads the label with `offeredSteps('invoice.update')`.
      Sending keeps the page's own words: it is an email, not a ledger command. `record-next-step.test.ts` holds
      every offered step in the manifest to the registry (a step that names an unregistered command is a button
      that goes nowhere) and holds the page to the manifest.
- [x] `CustomerRecordPage` and `VendorRecordPage` reuse `PartyDetailView`'s `RecordPage` shell and
      `PARTY_SIDES` column/wording config; a relationship has balance/overdue/lifetime/payment metrics, not a
      document's terminal Paid step. The next invoice or bill comes from the customer/vendor command manifest,
      checks the target command's role, and opens the existing party-prefilled form. The unused old detail
      modules are gone, and `party-detail-views.test.tsx` and `bill-record-page.test.tsx` pin the workflow.
- [x] `BillRecordPage` uses the same `RecordPage` shell as invoices (Entered → Approved → Paid), with the
      manifest's `bill.update → payment.receive` label **only when payable**, the existing edit/claim approval
      actions while awaiting approval, and no pay action for a draft, closed, settled or unauthorized bill.
      It shows payments, vendor, lines, files, notes and history; Purchases opens it from a row or a bill link,
      shares its existing dialogs, and restores focus on Back. Pinned by `bill-record-page.test.tsx`.
- [ ] Other record kinds beyond invoices, bills and parties: move each to the same shell when its workflow is
      known; do not invent a Paid step for a non-document.

## 5. One screen shape, one form

- [x] **Two form systems, one of them had no callers.** The count was `CommandForm` 2 and `SchemaForm` 2; the truth
      was `CommandForm` 1 screen (`ApiHubSandbox`) and `SchemaForm` **zero** — `ChartOfAccountsView` imported it as
      `SchemaForm as _SchemaForm` and never rendered it, and the only other reference was a test of zod itself. So
      there was nothing to merge: `SchemaForm` is gone (213 lines), the dead alias import with it, and `CommandForm`
      is the form — generated from the command's own input schema, which is the one case the app actually has.
      Its bug-pattern site went with it, so the `swallowing-action` ratchet turned without a single screen changing.
- [x] **One real palette-reachability guard.** Retired the `unreachableActions` quality metric and its
      baseline/test: it only searched for four identifier strings in `pageIndex.ts`, not for a page a person could
      reach. `palette-reachability-guard.test.tsx` now asserts each registry entry is found at its own destination,
      plain-word English **and Hebrew** report/setting queries, a disabled module in both languages, and actually
      choosing an English/Hebrew report from the rendered palette. `pageIndex.ts` carries the Hebrew search words
      in the same index the UI uses. The separate import-graph orphan check still guards source reachability.

## 6. What the sweep learned — cheaper to read than to rediscover

1. **`rawTables` counts files, not tables.** A 4-table screen is one number. Convert by file first, then by
   table inside the file.
2. **A `<tfoot>` is data.** The first sweep dropped a totals row from `DepreciationLedgerReportView` and
   `depreciation-ledger.test.tsx` caught it. `RowTable` has `footer` now, and the codemod refuses a `<tfoot>`.
3. **A class is code.** An interpolated `className` in backticks became a plain string with the
   `${th}` still written inside it: the same literal text in every cell, evaluated once, and it type-checks.
   It renders wrong, which is the worst kind. The codemod now keeps an interpolated class as an expression, and refuses a
   class that reads the row, because a column-level class is evaluated once, outside the row's scope.
4. **A scanner is not a parser.** Every conversion is parsed with TypeScript before it is written
   (`parses()` in the codemod). That is what turned "60 conversions, 6 red tests" into "45 conversions,
   0 red tests".
5. **`react-refresh` counts exports, not intent.** `RowTable.tsx` exported the component *and* `rowTableCsv`,
   which is a lint warning and a lost fast refresh. The columns and the CSV live in `src/lib/rowTable.ts`.
6. **The ratchet's zero is real.** `arrayIndexKeys` is 0 and a `<th key={index}>` inside the shared table
   failed it. The fix was not to raise the baseline — it was to key a header by its own name.

## Historical verification for the first sweep (not the current counts)

```
npx tsc --noEmit                       # 0 errors
npx eslint . --max-warnings 2          # 2 pre-existing warnings, no new ones
npx tsx --test src/tests/*.test.tsx    # 2211 tests, 0 failures
npx tsx scripts/codemod-row-table.ts   # 0 tables still convertible (the sweep is complete)
npx tsx -e "import('./scripts/quality-metrics.js').then(m => console.log(m.computeQualityMetrics().rawTables))"  # 158
```
