# Screen rebuild — PR #733 checklist

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
| `rawTables` | 184 | **158** | 0 | screen files drawing a hand-written `<table>` |
| `handTypedApiCalls` | 5 | 5 | 5, each named | `fetch('/api/…')` typed by hand |
| `directDbWrites` | 93 | 93 | 0 | the browser writing the books instead of asking the server |
| `arrayIndexKeys` | 0 | **0** | 0 | a list keyed by its position (held while a table component landed) |
| `screensWithManyPrimaryButtons` | 0 | 0 | 0 | ✅ |
| `unreachableActions` | 0 | 0 | 0 | ✅ |
| `suppressionCount` | 0 | 0 | 0 | `eslint-disable` / `@ts-ignore` in source |

`rawTables` is a count of **files**, so converting 45 tables in 41 files moved it 184 → 158: the first table in a
file is the one the counter sees, and a second table in a file is free. 14 of those 41 files still draw a second
table the codemod refuses, which is why 41 files moved the counter by 26. The plan below is ordered by that fact.

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
- [x] **The ratchet lowered** — `quality-baseline.json` `rawTables: 158`, so a new hand-written table fails CI.
- [x] **Two lists told the truth again.** `StockClosingPanel` and `JournalSheetReportView` left
      `raw-table-decisions.test.ts` (they no longer draw a table, so their reasons were false) and
      `PickPackShipPanel` left the H-8 date backlog (its dates now go through the resolver).

## 2. One list — what is left, in the order that moves the counter

Measured now by `npx tsx scripts/codemod-row-table.ts` → **199 tables in 158 files still refused**, by reason:

| # | reason (the codemod's own refusal) | tables | route | est. files moved |
|---|---|---|---|---|
| 1 | a totals row in a `<tfoot>` | 17 | ✋ `RowTable` has `footer`; move the totals row across by hand | 17 |
| 2 | a body that is not one expression (an empty-state row beside the rows) | 26 | ✋ pass `empty`, then the body is one map | ~24 |
| 3 | a header row that is not one of the four shapes the table can take | 47 | ✋ sort these first: most are `{cond && <th>}` + a hand body | ~40 |
| 4 | a row that does not line up with its header | 38 | ✋ usually a nested list, or a cell that spans — name which | ~37 |
| 5 | a map that does not return a row | 27 | ✋ the map returns a fragment or a component (`<AssetInlineDetails>`); a fragment of rows is `rows` flat-mapped | ~28 |
| 6 | a callback that is destructured, or has a body | 10 | ✋ `({id, name}) => …` or a `{ const x = …; return <tr> }` body | 10 |
| 7 | a cell this script could not read as one column | 8 | ✋ look at each; some are two cells the scanner merged | 8 |
| 8 | a row class that reads the row | 7 | ✋ `rowClassName` is fixed; keep the conditional inside the cell, or keep the table | 7 |
| 9 | a class computed from the row | 5 | ✋ same: the class belongs inside the cell | 5 |
| 10 | a table attribute a rewrite would drop (`aria-label`) | 3 | ✋ `PeriodClosingPanel`'s three totals tables: give `RowTable` the name, or keep the table | 1 |
| 11 | more than one map in the body / a row header after the first column | 6 | ✋ the second map is a second table, or a `rows` list built outside | 6 |
| 12 | no header row / no caption / one-row key / nested-cell edge cases | 6 | ✋ individually | 6 |

**Fast order.** 1 and 2 first: `footer` and `empty` already exist, so each is a mechanical edit of a table the
codemod has already normalised in every other way, and 43 tables move for it. 3, 4, 5 are the bulk (111) and are
the honest hand work — do them by directory, starting with `reporting` (106 of the 244 tables live there), and
re-run the codemod after every batch: a file that stops being refused is free.

Do **not** hand-convert a table the codemod still refuses. Re-run it first — every batch so far has made the
next one smaller, and the two bugs it caught (the `<tfoot>`, the class interpolation) are exactly the class of
mistake that hand-converting 139 tables at speed produces.

## 3. One way to act

- [ ] `directDbWrites` **93** → 0. PR #731's writer (`workspaceActions.ts`) is the third of 54 files; the browser
      sites are listed in `commands-baseline.json` (`useAutoRules.ts` 6, `useEntityOperations.ts` 6 at the top).
      Route: one commit per **hook**, not per call — a hook that writes has one shape.
- [ ] Undo on the result: `deleteWithUndo` into `useCommand` where the command's inverse exists.
- [ ] The offered next step in the toast ("Invoice saved. Send it · Record a payment · New invoice").

## 4. One record page

- [ ] `InvoiceRecordPage` takes its next step from the manifest (`useCommand('invoice.update').next`), not a
      hard-coded `if (isDraft)`.
- [ ] `CustomerRecordPage`, `BillRecordPage` on the same shell — column definitions, not new layout.

## 5. One screen shape, one form

- [ ] **Two form systems, two callers each.** `CommandForm` (2) and `SchemaForm` (2) — a schema-driven form and a
      command-driven one. Pick one per case, or merge them: this is 4 call sites, not a project.
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
