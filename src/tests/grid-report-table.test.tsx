/**
 * The two things the shared list needed before report screens could leave their own tables behind
 * (prompt 2, part 1: "grow the shared grid into the only list component").
 *
 * 1. A row header. 91 of the screens that still draw a table name each row with `<th scope="row">`
 *    ("All entries on this account", "This customer's aging"), and `table-a11y-guard` requires every
 *    `<th>` to say what it heads. Without this the grid could only take lists whose first cell is a
 *    plain `<td>`, so those screens had nowhere to go.
 * 2. A totals row. A report's last line is the sum; when the table is drawn by the grid the total has
 *    to be drawn by it too, or the column chooser hides a column in the body and leaves the total
 *    pointing at the wrong one.
 */
import './helpers/dom';
import test, { afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ColumnDef } from '@tanstack/react-table';
import { TanStackDataGrid } from '../components/ui/TanStackDataGrid';
import ListColumnChooser from '../components/ui/ListColumnChooser';
import { listColumnKey } from '../lib/listColumns';

type Row = { id: string; name: string; amountCents: number };
const data: Row[] = [
  { id: 'r1', name: 'Acme', amountCents: 15000 },
  { id: 'r2', name: 'Beta', amountCents: 2500 },
];
const columns: ColumnDef<Row, unknown>[] = [
  { id: 'name', accessorFn: row => row.name, header: 'Customer', cell: info => String(info.getValue()) },
  { id: 'amount', accessorFn: row => row.amountCents, header: 'Amount', cell: info => `$${(Number(info.getValue()) / 100).toFixed(2)}` },
];

describe('the shared list can carry a report table', () => {
  afterEach(() => cleanup());

  test('rowHeaderColumn draws the naming cell as <th scope="row">, and the rest stay cells', () => {
    render(<TanStackDataGrid caption="Aging" data={data} columns={columns} rowHeaderColumn="name" />);
    const rowHeaders = screen.getAllByRole('rowheader');
    assert.equal(rowHeaders.length, 2, 'one row header per row');
    assert.deepEqual(rowHeaders.map(cell => cell.textContent), ['Acme', 'Beta']);
    for (const header of rowHeaders) assert.equal(header.getAttribute('scope'), 'row');
    // the amount column is still an ordinary cell
    const firstRow = screen.getAllByRole('row')[1];
    assert.equal(firstRow.querySelectorAll('td').length, 1);
  });

  test('without rowHeaderColumn every cell stays a plain cell, as the document lists need', () => {
    render(<TanStackDataGrid caption="Invoices" data={data} columns={columns} />);
    assert.equal(screen.queryAllByRole('rowheader').length, 0);
    const firstRow = screen.getAllByRole('row')[1];
    assert.equal(firstRow.querySelectorAll('td').length, 2);
  });

  test('a totals row puts its value under the column it totals, with no colspans', () => {
    render(
      <TanStackDataGrid
        caption="Aging"
        data={data}
        columns={columns}
        rowHeaderColumn="name"
        totals={{ label: 'Total', value: '$175.00', columnsBefore: 1 }}
      />,
    );
    const foot = document.querySelector('tfoot');
    assert.ok(foot, 'the totals row is drawn');
    const cells = Array.from(foot.querySelectorAll('th, td'));
    // one cell per drawn column, and never a colspan: the column chooser hides by position and skips
    // any row holding a colspan, so a spanned footer would keep a hidden column's width
    assert.equal(cells.length, columns.length);
    for (const cell of cells) assert.equal(cell.hasAttribute('colspan'), false);
    // columnsBefore: 1 puts the value in the second column, under Amount
    assert.equal(cells[0].textContent, 'Total');
    assert.equal(cells[1].textContent, '$175.00');
  });

  test('the totals row counts the tick column the grid prepends when selectable', () => {
    render(
      <TanStackDataGrid
        caption="Aging"
        data={data}
        columns={columns}
        selectable
        totals={{ label: 'Total', value: '$175.00', columnsBefore: 1 }}
      />,
    );
    const cells = Array.from(document.querySelector('tfoot')!.querySelectorAll('th, td'));
    // tick, Name, Amount: three cells, and the total sits under Amount, not under Name
    assert.equal(cells.length, 3);
    assert.equal(cells[2].textContent, '$175.00');
  });

  test('a totals row cannot widen the table past its columns', () => {
    render(
      <TanStackDataGrid
        caption="Aging"
        data={data}
        columns={columns}
        totals={{ label: 'Total', value: '$175.00', columnsBefore: 99 }}
      />,
    );
    const cells = Array.from(document.querySelector('tfoot')!.querySelectorAll('th, td'));
    assert.equal(cells.length, columns.length, `the totals row is ${columns.length} columns wide`);
    assert.equal(cells[cells.length - 1].textContent, '$175.00', 'and the value is clamped to the last column');
  });

  test('no totals row when the list is empty, because an empty list hides the table', () => {
    render(
      <TanStackDataGrid
        caption="Aging"
        data={[]}
        columns={columns}
        totals={{ label: 'Total', value: '$0.00' }}
      />,
    );
    assert.equal(document.querySelector('tfoot'), null);
    assert.equal(document.querySelector('table'), null, 'the empty state replaces the table');
  });

  test('the row headers and the totals survive a re-render, which is what sorting and searching do', () => {
    render(
      <TanStackDataGrid
        caption="Aging"
        data={data}
        columns={columns}
        rowHeaderColumn="name"
        totals={{ label: 'Total', value: '$175.00', columnsBefore: 1 }}
      />,
    );
    // the header row also holds a rowheader role in some browsers' mappings; the body ones name the records
    const bodyHeaders = Array.from(document.querySelectorAll('tbody th[scope="row"]')).map(cell => cell.textContent);
    assert.deepEqual(bodyHeaders, ['Acme', 'Beta']);
    assert.equal(document.querySelector('tfoot td')?.textContent, '$175.00');
  });
});

describe('the review findings on the shared list stay fixed', () => {
  afterEach(() => cleanup());

  /** The chooser reads its saved choice from this store key, so a screen has to exist in it. */
  const chooserRender = (props: { locked?: number[] }) =>
    render(<ListColumnChooser scope="on-review" label="On review" columns={['Date', 'Entry', 'In', 'Out', 'Cleared']} lockedColumns={props.locked} />);

  test('a locked row-header column cannot be hidden, and an older saved choice is not honoured', () => {
    // the reader hid the Entry column (index 1) before the lock existed, saved under the chooser's
    // real key — an unrelated key would leave the chooser empty and this test would pass regardless
    localStorage.setItem(listColumnKey('guest', 'none', 'On review'), JSON.stringify([1]));
    chooserRender({ locked: [1] });
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    assert.equal(boxes[1].disabled, true, 'the column that names each row is locked');
    assert.equal(boxes[1].checked, true, 'and it is shown, even though a saved choice hid it');
    assert.equal(boxes[2].disabled, false, 'the other columns stay the reader’s choice');
    localStorage.clear();
  });

  test('the row header index the grid hands the chooser includes the tick column', () => {
    render(
      <TanStackDataGrid
        caption="Aging"
        data={data}
        columns={columns}
        rowHeaderColumn="name"
        selectable
        columnScope="on-review"
        columnLabel="On review"
        columnNames={['', 'Customer', 'Amount']}
      />,
    );
    const boxes = screen.getAllByRole('checkbox');
    // index 0 is the tick column's own box; index 1 is the Customer column, which names the row
    const chooserBoxes = Array.from(boxes).filter(box => box.closest('details'));
    assert.equal((chooserBoxes[1] as HTMLInputElement).disabled, true, 'Customer is the row header, so it is locked');
    localStorage.clear();
  });

  test('the total is drawn in the phone layout too, not only in the table', () => {
    // a narrow viewport is what switches the shared list to cards
    const original = window.matchMedia;
    window.matchMedia = (query: string) => ({
      matches: query.includes('max-width'), media: query, onchange: null,
      addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    }) as MediaQueryList;
    render(
      <TanStackDataGrid
        caption="Aging"
        data={data}
        columns={columns}
        totals={{ label: 'Total', value: '$175.00', columnsBefore: 1 }}
      />,
    );
    const total = document.querySelector('[data-grid-total]');
    assert.equal(total?.textContent, '$175.00', 'the summary survives on a phone');
    assert.equal(document.querySelector('table'), null, 'and the table is the card layout');
    window.matchMedia = original;
  });

  test('printing keeps the reader’s sort, so the printed rows are in the order on screen', () => {
    const rows = [
      { id: 'a', name: 'Zeta', amountCents: 1 },
      { id: 'b', name: 'Alpha', amountCents: 2 },
      { id: 'c', name: 'Mike', amountCents: 3 },
    ];
    render(<TanStackDataGrid caption="Aging" data={rows} columns={columns} pageSize={1} />);
    fireEvent.click(screen.getByRole('button', { name: /Sort by Name|Customer/i }));
    const printed = () => {
      window.dispatchEvent(new (window as unknown as { Event: typeof Event }).Event('beforeprint'));
      const names = Array.from(document.querySelectorAll('tbody th[scope="row"], tbody td:first-child')).map(cell => cell.textContent);
      window.dispatchEvent(new (window as unknown as { Event: typeof Event }).Event('afterprint'));
      return names;
    };
    assert.deepEqual(printed(), ['Alpha', 'Mike', 'Zeta'], 'printed in the sort order, not the data order');
  });

  test('printing draws every row, not the page, so a printed total reconciles', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `r${i}`, name: `Row ${i}`, amountCents: 100 }));
    render(<TanStackDataGrid caption="Aging" data={many} columns={columns} pageSize={10} totals={{ label: 'Total', value: '$30.00', columnsBefore: 1 }} />);
    assert.equal(document.querySelectorAll('tbody tr').length, 10, 'the screen shows one page');
    const printEvent = () => new (window as unknown as { Event: typeof Event }).Event('beforeprint');
    window.dispatchEvent(printEvent());
    assert.equal(document.querySelectorAll('tbody tr').length, 30, 'the printed page carries all of them');
    window.dispatchEvent(new (window as unknown as { Event: typeof Event }).Event('afterprint'));
    assert.equal(document.querySelectorAll('tbody tr').length, 10, 'and the reader is back on their page');
  });
});

describe('the second review pass', () => {
  afterEach(() => cleanup());

  test('a sortable column heading is a labelled button that survives printing', () => {
    render(<TanStackDataGrid caption="Aging" data={data} columns={columns} />);
    // every sortable heading is a button, and `@media print { button { display: none } }` would take
    // the labels with it — so the heading button carries the marker the print rule re-enables
    const sortButton = screen.getByRole('button', { name: /Customer/ });
    assert.ok(sortButton.hasAttribute('data-grid-sort-header'), 'the heading is marked for print');
    const css = fs.readFileSync(path.join(process.cwd(), 'src/index.css'), 'utf8');
    assert.match(css, /\[data-grid-sort-header\]\s*\{\s*display:\s*inline-flex\s*!important/, 'and print shows it again');
    assert.match(css, /\[data-grid-sort-header\]\s*svg\s*\{\s*display:\s*none\s*!important/, 'while the chevron stays hidden');
  });

  test('a status the cell prints is the status the search finds', () => {
    // the clearance column puts the printed words and the sort key in one value, so both work:
    // searching "Outstanding" must not need the reader to know it sorts as "2Outstanding"
    const source = fs.readFileSync(path.join(process.cwd(), 'src/components/reporting/BankClearanceReportView.tsx'), 'utf8');
    // search reads what the cell prints; the sort reads the key. The key must not lead the accessor,
    // or the grid's filter would see it and the printed order would decide the sort again.
    assert.match(source, /accessorFn: clearedText/, 'the searchable value is what the cell prints');
    assert.match(source, /sortingFn: \(a, b\) => clearedSortKey\(a\.original\)/, 'the sort compares the key');
    assert.ok(
      !/accessorFn: row => `\$\{clearedSortKey/.test(source),
      'the sort key must not lead the searchable value',
    );
  });
});
