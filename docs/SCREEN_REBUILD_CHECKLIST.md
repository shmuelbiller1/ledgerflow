# Screen rebuild — PR #731 checklist

The task is unchanged: **every action and report the server offers can be reached, and a new person still sees
only a few things.** Connect and simplify what exists. Do not add features.

#730 measured the remainder and split it into buckets. This PR is about **the fastest honest route through the
list**: the work that repeats gets a tool, and the work that does not gets a reason. Every box below is a number
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

`rawTables` is a count of **files**, so converting 45 tables in 42 files moved it 184 → 158: the first table in a
file is the one the counter sees, and a second table in a file is free. The plan below is ordered by that fact.

## 1. One list — landed in this PR

- [x] **A declarative table for the table that is part of a sentence.** `src/components/ui/RowTable.tsx`
      (37 lines of component, guards in `src/lib/rowTable.ts`). It renders the markup the screens already
      rendered — same table class, head class, row-header class, cell classes — and adds the four things a
      hand-written table mostly lacked: a caption, a row header, `align: 'right'`, and CSV built from the same
      columns. Pinned by `src/tests/row-table.test.tsx` (7 tests: accessible name, row header, right-aligned CSV
      decimal, row order, repeated column, footer, empty state).
- [x] **A codemod that can write, not just survey.** `scripts/codemod-row-table.ts` — `--write` converts,
      `--files` names every table it refuses and why. 10 rules pinned by `src/tests/row-table-codemod.test.ts`,
      including the two ways it could destroy a screen: a dropped `<tfoot>` totals row, and an interpolated class
      `${th}` turned into the text `${th}`. Both refusals exist because both happened and a test caught it.
- [x] **45 tables in 42 files converted**, `rawTables` 184 → 158, −139 net lines, `arrayIndexKeys` still 0,
      `npx tsc --noEmit` clean, `eslint . --max-warnings 2` still at the 2 pre-existing warnings,
      **2211/2211 UI tests green**.
- [x] **The ratchet lowered** — `quality-baseline.json` `rawTables: 158`, so a new hand-written table fails CI.

## 2. One list — what is left, in the order that moves the counter

Measured now by `npx tsx scripts/codemod-row-table.ts` → **199 tables in 158 files still refused**, by reason:

| # | reason (the codemod's own refusal) | tables | route | est. files moved |
|---|---|---|---|---|
| 1 | a totals row in a `<tfoot>` | 17 | ✋ `RowTable` has `footer`; move the totals row across by hand | 17 |
| 2 | a body that is not one expression (an empty-state row beside the rows) | 26 | ✋ pass `empty`, then the body is one map | ~24 |
| 3 | a header row that is not one of the four shapes | 46 | ✋ sort these first: most are `{cond && <th>}` + a hand body | ~40 |
| 4 | a row that does not line up with its header | 37 | ✋ usually a nested list, or a cell that spans — name which | ~37 |
| 5 | a map that does not return a row | 28 | ✋ the map returns a fragment or a component (`<AssetInlineDetails>`); a fragment of rows is `rows` flat-mapped | ~28 |
| 6 | a callback that is destructured, or has a body | 10 | ✋ `({id, name}) => …` or a `{ const x = …; return <tr> }` body | 10 |
| 7 | a cell this script could not read as one column | 8 | ✋ look at each; some are two cells the scanner merged | 8 |
| 8 | a row class that reads the row | 7 | ✋ `rowClassName` is fixed; keep the conditional inside the cell, or keep the table | 7 |
| 9 | a class computed from the row | 5 | ✋ same: the class belongs inside the cell | 5 |
| 10 | no header row / no caption / one-row key / >1 map / nested-cell edge cases | 15 | ✋ individually | 15 |

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
