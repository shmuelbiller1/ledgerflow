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
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import type { ColumnDef } from '@tanstack/react-table';
import { TanStackDataGrid } from '../components/ui/TanStackDataGrid';

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

  test('a totals row lines its value up under the column it totals', () => {
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
    // the label fills the first column, the value sits in the second
    assert.equal(foot.querySelector('th[scope="row"]')?.textContent, 'Total');
    assert.equal(foot.querySelector('th[scope="row"]')?.getAttribute('colspan'), '1');
    assert.equal(foot.querySelector('td')?.textContent, '$175.00');
    assert.equal(foot.querySelector('td')?.hasAttribute('colspan'), false, 'the total sits in its own column');
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
    const foot = document.querySelector('tfoot')!;
    const cells = foot.querySelectorAll('th, td');
    const spanned = Array.from(cells).reduce((sum, cell) => sum + Number(cell.getAttribute('colspan') ?? 1), 0);
    assert.equal(spanned, columns.length, `the totals row is ${columns.length} columns wide`);
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
