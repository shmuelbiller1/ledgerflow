# H-7 (AI #10) — nine screens printed the whole application shell around their document

Date: 11 Nov 2026. Branch: `arena/71202919-ledgerflow`, based on `ec3ff49` (main after PR #626).
Lane: daily screens (display only — no money, posting, tax maths, statement figures or `src/server/`).

## The defect

`src/index.css` narrows the paper for printing in exactly one way:

```css
body:has([data-print-root]) * { visibility: hidden; }
body:has([data-print-root]) [data-print-root] * { visibility: visible; }
```

With **no** `[data-print-root]` on the page, nothing is hidden, so `window.print()` puts the entire
application shell on the paper — sidebar, header, pinned-page bar, banners, on-screen filters —
around and partly over the document the reader asked for. A screen whose Print button calls
`window.print()` without marking a root prints that. Nine surfaces did:

| screen | file | call |
| --- | --- | --- |
| General Ledger | `src/components/ledger/GeneralLedgerView.tsx` | Print Ledger button |
| Account Statement | `src/components/reporting/StatementView.tsx` | Print Statement button |
| Israel VAT Report | `src/components/reporting/IsraelVatReportView.tsx` | Print button |
| Delivery Notes | `src/components/reporting/DeliveryNotesReportView.tsx` | Print button |
| Period-closing document | `src/components/ledger/PeriodClosingPanel.tsx` | Print button |
| Access review | `src/components/platform/settings/AccessReviewPanel.tsx` | Print button |
| Invoice form | `src/components/sales/InvoiceModal.tsx` | Print invoice (header) |
| Warehouse packing slip | `src/components/reporting/PickPackShipPanel.tsx` | Print slip |
| Report pack | `src/components/reporting/reportPack/ReportPackDialog.tsx` | Print button |

Why nothing caught it: the Print button on each screen already carries `print:hidden` /
`data-print-hide`, so a check that looks at the *screen* or at the button sees nothing wrong, and a
check that only counts buttons in print media passes on an otherwise blank page. The defect is only
visible in what the paper contains. AI #3's A-271/A-277 covered the Reports root, the trial balance,
the journal sheet and the PDF preview; these nine surfaces were the remainder, which is what the
H-7 entry in COORDINATION asks for.

Second half of the defect (found while fixing it): a sheet inside a dialog — the statement, the
invoice form, the report pack — kept the dialog's `overflow-hidden` / `max-height` box. Even with a
root, the paper was clipped after one screen height.

## The fix

1. `src/lib/printRoot.ts` (new): `printElement(element)`, `printElementById(id, doc?)`,
   `hasPrintRoot(doc?)`, and `PRINT_ROOT_ATTRIBUTE`. It marks the sheet, calls `window.print()`,
   and unmarks it in `finally` — a print dialog that throws cannot leave a stale root that would
   narrow every later print to a dead element.
2. Each of the nine surfaces marks its own sheet `data-print-root` and calls
   `printElementById(<its id>)`: `general-ledger-sheet`, `statement-sheet`, `israel-vat-return`,
   `delivery-note-sheet`, `period-closing-sheet`, `access-review-sheet`, `invoice-form-sheet`,
   `warehouse-packing-slip`, `report-pack-sheet`. Controls, toolbars, pickers and the Print button
   carry `data-print-hide`, so the paper is the document and nothing else.
3. `src/index.css`: one new print rule — every element that *contains* a print root releases its
   scroll box (`overflow`, `max-height`, `height`), its transform/filter/backdrop, its background
   and its shadow. This is what un-clips a sheet inside a dialog. `background: transparent`
   (rather than `none`) keeps a gradient utility from leaving a background-image behind.
4. General Ledger gained a print-only title and period line (`hidden print:block`), so the paper
   says which book and which days it covers; it previously had no heading on the page at all.
5. Warehouse packing slip: the panel's own `@media print` block used to be the only mechanism
   (a `body.warehouse-packing-print` class). The slip is now a print root, the block is kept for
   its white paper box and as a fallback for an engine without `:has()`, and its `position:absolute`
   became `static` so the root rule is what positions the paper.

No figure, filter, date range, CSV export or stored value changed. The GL's printed period line
still prints the ISO dates the filter holds (H-8 below is the locale work, deliberately separate).

## Tests

- `src/tests/print-root-guard.test.ts` (new, 4 checks): every `.tsx` under `src` that calls
  `window.print()` must declare a print root; every `printElementById('x')` must name an id that is
  a `data-print-root` element in the same file; the nine surfaces above each carry their root; the
  stylesheet still releases the ancestor boxes. This is the guard that would have failed for all
  nine files before the change — it was written first and failed on exactly those.
- `src/tests/print-root.test.ts` (new, 6 checks): marks during the print and unmarks after; a sheet
  that already declares itself a root keeps its mark; no sheet → no print dialog; by-id prints only
  that sheet; a throwing `window.print()` leaves the page unmarked; `hasPrintRoot()` sees a
  pre-existing root.
- `e2e/print-styles.spec.ts`: two new browser cases (general ledger, account statement) assert one
  visible root, zero navigation/controls/buttons in print media, a sheet as wide as the page, and
  the container's `overflow` released. **CI-only**: the Chromium download is blocked in the audit
  sandbox, so these are written and reviewed but not executed here — stated plainly rather than
  claimed green.

## Checks run (11 Nov, this branch)

| check | result |
| --- | --- |
| `npx tsc --noEmit -p tsconfig.json` / `npm run lint:types` | pass, 0 errors |
| `npm run lint:eslint` (whole repo) | 0 errors, **42** warnings (cap 42, unchanged) |
| focused suites: print-root, print-root-guard, print-layout, print-light-guard, table-a11y, icon-button-a11y, report-empty-state-coverage, israel-vat-report-view | 79/79 pass |
| component suites touching the nine files (access-review, statement scope, delivery notes, period closing, invoice modal, GL, report pack, credit limit, layers guard) | 53/53 pass |
| `npm run build` | pass (dist, `build/server.cjs`, `build/api.cjs`) |
| `npm test` (whole suite) | **4664 tests: 4659 pass, 5 skipped, 0 fail**, exit 0. The 5 skips are the DB-gated tests (no `LF_TEST_DATABASE_URL` in this sandbox) — `test:rules` was **not** run, and no SQL changed. |
| `npm run test:e2e` | not runnable here (no browser); the two new cases are CI-only |

## Residual risk

- A root that contains the *wrong* document would satisfy the guard; the guard proves a root exists
  and is named correctly, the browser case proves the page is the sheet. Neither proves the sheet
  lists every line — that remains the figures' own tests.
- `:has()` is required by the shared print rules (already true before this change). The packing
  slip keeps its body-class fallback; the other eight do not have one.
- Printing is verified as CSS/DOM behaviour, not as a physical page: the paper-size and page-count
  checks remain AI #3's A-271/A-277 browser work.
- Not covered here (other lanes or other screens): G-21 dark-mode printing, the printed P&L /
  balance sheet / cash-flow / aging reports (A-271), and the bilingual PDF templates
  (Settings → Branding, FOR_YOU item 37).
