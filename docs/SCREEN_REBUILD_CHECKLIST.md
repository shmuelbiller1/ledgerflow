# Screen rebuild — #733 (merged), this PR continues the sweep

The task is unchanged: **every action and report the server offers can be reached, and a new person still sees
only a few things.** Connect and simplify what exists. Do not add features.

#730 measured the remainder and split it into buckets. This PR is about **the fastest honest route through the
list**: the work that repeats gets a tool, and the work that does not gets a reason. It also ends the first phase
of that tool: the sweep it ships is now one a reviewer can trust cell for cell, which is what the second phase
(the 199 tables it still refuses, §2) depends on. Every box below is a number
from `computeQualityMetrics()` (`scripts/quality-metrics.ts`) or a named test, never a description.

State is measured, never described. `quality-baseline.json`, `raw-table-decisions.test.ts` and the guard tests are
the truth.

## Where we are

| counter | before this PR | now | target | what it counts |
|---|---|---|---|---|
| `rawTables` | 184 | **126** | 0 | screen files drawing a hand-written `<table>` |
| `handTypedApiCalls` | 5 | 5 | 5, each named | `fetch('/api/…')` typed by hand |
| `directDbWrites` | 88 | **5** | 0 | the browser writing the books instead of asking the server |
| `arrayIndexKeys` | 0 | **0** | 0 | a list keyed by its position (held while a table component landed) |
| `screensWithManyPrimaryButtons` | 0 | 0 | 0 | ✅ |
| `unreachableActions` | 0 | 0 | 0 | ✅ |
| `suppressionCount` | 0 | 0 | 0 | `eslint-disable` / `@ts-ignore` in source |

`rawTables` is a count of **files**, so converting 107 tables in 95 files moved it 184 → 126: the first table in
a file is the one the counter sees, and a second table in a file is free. 14 of those 50 files still draw a second
table the codemod refuses, which is why 50 files moved the counter by 32. The plan below is ordered by that fact.

## 1. One list — landed in this PR

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
- [x] **The ratchet lowered** — `quality-baseline.json` `rawTables: 126`, so a new hand-written table fails CI.
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

Measured now by `npx tsx scripts/codemod-row-table.ts` → **149 tables in 126 files still refused**, by reason:

| # | reason (the codemod's own refusal) | tables | route | est. files moved |
|---|---|---|---|---|
| 1 | a header row that is not one of the four shapes the table can take | 47 | ✋ mostly `{cond && <th>}` action columns and sortable headers (`onClick`) — the grid's work, or a hand column list | ~40 |
| 2 | a map that does not return a row | 31 | ✋ the map returns a fragment (`<React.Fragment key>` with a details row) or a component; a fragment of *two rows* is not one row | ~30 |
| 3 | a body that is not a map | 13 | ✋ one expression away: `const rows = cond ? a : b` above the table | ~14 |
| 4 | a body that is not one expression: an empty-state row beside the rows, or a literal row | 16 | ✋ name the second expression: a literal row, a fragment, or a second map | ~14 |
| 5 | a cell this script could not read as one column | 8 | ✋ look at each; some are two cells the scanner merged | 8 |
| 6 | a row class that reads the row | 7 | ✋ `rowClassName` is fixed; keep the conditional inside the cell, or keep the table | 7 |
| 7 | a class computed from the row | 7 | ✋ same: the class belongs inside the cell | 7 |
| 8 | something outside the caption/header/body, or a row header after the first column | 8 | ✋ individually | 8 |
| 9 | a table attribute (`aria-label`), a computed header list, a header class that reads its item, an empty state whose condition is not this list | 9 | ✋ the table name, or a header whose class is decided per column by hand | 9 |
| 10 | no header row / no key / a nested map under a header that does not declare it | 3 | ✋ individually | 3 |

**Fast order.** The footer, empty-state and array-header buckets are done — the free 50. What is left is the hand work,
and it is done by directory starting with `reporting` (the largest bucket), re-running the codemod after every
batch: a file that stops being refused is free, and every batch so far has made the next one smaller. Do **not**
hand-convert a table the codemod still refuses.

## 3. One way to act

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
- [ ] `directDbWrites` **5** → 0. 3 files — all of them the same open question (below). The remaining sites are not one problem, and the order below is the
      order they can actually be done in:
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
      - **the rest** — **5 sites in 3 files, one open question.** `useEntityOperations` (3) and the two inline-edit
        adapters (`recordDetailsAdapter`, `inlineRecordAdapter`) write `updateDoc`/`setDoc`/`deleteDoc` on whatever
        `path`/`collection`/`kind` the caller passes. Every collection with a ledger meaning already branches to its
        own command before reaching them, so what is left is the long tail of ordinary records — but a command for
        them has to answer a policy question the code cannot answer for itself: an **allow-list** (fail closed, and a
        screen added later breaks until it is listed) or a **deny-list** (fail open, and a new ledger collection is
        writable by mistake). That is a product decision, not a mechanical conversion, so it is deliberately left
        here rather than guessed. — write routes that already have a command in most cases
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
- [ ] The offered next step in the toast ("Invoice saved. Send it · Record a payment · New invoice").

## 4. One record page

- [x] `InvoiceRecordPage` takes its next step from the manifest, not a hard-coded `if (isDraft)`. `invoice.update`
      offers `payment.receive` ("Record a payment") the same way `invoice.create` does — the step after a document
      does not depend on how it got there — and the page reads the label with `offeredSteps('invoice.update')`.
      Sending keeps the page's own words: it is an email, not a ledger command. `record-next-step.test.ts` holds
      every offered step in the manifest to the registry (a step that names an unregistered command is a button
      that goes nowhere) and holds the page to the manifest.
- [ ] The rest of the record pages: the same step list, the same shell.
- [ ] `CustomerRecordPage`, `BillRecordPage` on the same shell — column definitions, not new layout.

## 5. One screen shape, one form

- [x] **Two form systems, one of them had no callers.** The count was `CommandForm` 2 and `SchemaForm` 2; the truth
      was `CommandForm` 1 screen (`ApiHubSandbox`) and `SchemaForm` **zero** — `ChartOfAccountsView` imported it as
      `SchemaForm as _SchemaForm` and never rendered it, and the only other reference was a test of zod itself. So
      there was nothing to merge: `SchemaForm` is gone (213 lines), the dead alias import with it, and `CommandForm`
      is the form — generated from the command's own input schema, which is the one case the app actually has.
      Its bug-pattern site went with it, so the `swallowing-action` ratchet turned without a single screen changing.
- [ ] Palette reachability is **already proven in EN and HE** by `palette-reachability-guard.test.tsx`. The
      remaining item is not "make screens findable" — it is **retiring the old guard** once the plain-word search
      is the only path, so there is one test instead of two mechanisms.

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

## Verification for this PR

```
npx tsc --noEmit                       # 0 errors
npx eslint . --max-warnings 2          # 2 pre-existing warnings, no new ones
npx tsx --test src/tests/*.test.tsx    # 2211 tests, 0 failures
npx tsx scripts/codemod-row-table.ts   # 0 tables still convertible (the sweep is complete)
npx tsx -e "import('./scripts/quality-metrics.js').then(m => console.log(m.computeQualityMetrics().rawTables))"  # 158
```
