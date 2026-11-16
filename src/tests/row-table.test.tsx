/**
 * `RowTable` — the declarative table that replaces a hand-written `<thead>`/`<tbody>` block.
 *
 * The reason this is worth a test of its own: the sweep that moves 139 screens onto it is only safe if the
 * output is *exactly* the table the screen had. So these pin the three things that differ between a hand-written
 * table and a good one, and the one thing that must not differ:
 *
 *  - an accessible name (a `<caption>`), because a table without one is announced as just "table";
 *  - a row header on the first column, so a cell is read with the record it belongs to;
 *  - right alignment and a plain-decimal CSV for money, independent of the display format;
 *  - and the same cell text, row order and `scope` attributes a reader already sees.
 */
import './helpers/dom';
import test, { afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { RowTable } from '../components/ui/RowTable';
import { rowTableCsv, type RowTableColumn } from '../lib/rowTable';

interface Schedule { year: string; amount: string; amountCents: number }

const columns: RowTableColumn<Schedule>[] = [
  { header: 'Year', cell: row => row.year },
  { header: 'Depreciation', align: 'right', cell: row => row.amount, csv: row => (row.amountCents / 100).toFixed(2) },
];

const rows: Schedule[] = [
  { year: '2026', amount: '$1,200.00', amountCents: 120000 },
  { year: '2027', amount: '$900.00', amountCents: 90000 },
];

afterEach(cleanup);

describe('RowTable', () => {
  test('the table has an accessible name and one header cell per column', () => {
    render(<RowTable caption="Depreciation by year" rows={rows} columns={columns} rowKey={row => row.year} />);
    const table = screen.getByRole('table', { name: 'Depreciation by year' });
    const headers = table.querySelectorAll('thead th[scope="col"]');
    assert.deepEqual([...headers].map(cell => cell.textContent), ['Year', 'Depreciation']);
  });

  test('the first column names the row, the rest are data cells', () => {
    render(<RowTable caption="Depreciation by year" rows={rows} columns={columns} rowKey={row => row.year} />);
    const body = screen.getAllByRole('row').slice(1);
    assert.equal(body.length, 2);
    // a row header is what makes a screen reader read "2026, $1,200.00" rather than an unattributed figure
    assert.equal(body[0].querySelector('th[scope="row"]')?.textContent, '2026');
    assert.deepEqual([...body[0].querySelectorAll('td')].map(cell => cell.textContent), ['$1,200.00']);
  });

  test('a money column is right-aligned, and its CSV value is a plain decimal', () => {
    render(<RowTable caption="Depreciation by year" rows={rows} columns={columns} rowKey={row => row.year} />);
    const moneyCell = screen.getAllByRole('row')[1].querySelectorAll('td')[0];
    assert.match(moneyCell.className, /text-right/);
    const csv = rowTableCsv(columns, rows);
    assert.deepEqual(csv.headers, ['Year', 'Depreciation']);
    // the file must not carry a currency symbol: another system reads this
    assert.deepEqual(csv.rows, [['2026', '1200.00'], ['2027', '900.00']]);
  });

  test('row order and cell text are the caller\'s, not sorted by the table', () => {
    const shuffled = [...rows].reverse();
    render(<RowTable caption="Depreciation by year" rows={shuffled} columns={columns} rowKey={row => row.year} />);
    const body = screen.getAllByRole('row').slice(1);
    assert.deepEqual(body.map(row => row.querySelector('th')?.textContent), ['2027', '2026']);
  });

  test('a repeated column renders one header and one cell per item, and the CSV names each one', () => {
    const months = ['2026-01', '2026-02'];
    const rows: { cohort: string; values: Record<string, number> }[] = [{ cohort: 'Retail', values: { '2026-01': 3, '2026-02': 5 } }];
    render(
      <RowTable
        caption="Cohorts by month"
        rows={rows}
        rowKey={row => row.cohort}
        columns={[
          { header: 'Cohort', cell: row => row.cohort },
          { over: months, head: (month: string) => month, cell: (row, month) => row.values[month], align: 'right', csvHeader: (month: string) => `Customers ${month}` },
        ]}
      />,
    );
    assert.deepEqual([...screen.getAllByRole('columnheader')].map(cell => cell.textContent), ['Cohort', '2026-01', '2026-02']);
    assert.deepEqual([...screen.getAllByRole('row')[1].querySelectorAll('td')].map(cell => cell.textContent), ['3', '5']);
    const csv = rowTableCsv([{ over: months, head: (month: string) => month, cell: (row: (typeof rows)[0], month) => row.values[month], csvHeader: (month: string) => `Customers ${month}` }], rows);
    assert.deepEqual(csv.headers, ['Customers 2026-01', 'Customers 2026-02']);
    assert.deepEqual(csv.rows, [['3', '5']]);
  });

  test('a column that declares no alignment gets no alignment class, so a cell keeps the one it inherited', () => {
    render(
      <RowTable
        caption="Quiet cells"
        rows={[{ label: 'Total', amount: '1' }]}
        rowKey={row => row.label}
        columns={[
          { header: 'Label', cell: row => row.label },
          { header: 'Amount', cell: row => row.amount },
        ]}
      />,
    );
    // a bare `<th>` in a table someone centred stays centred, and a `<td>` follows the start edge in a
    // right-to-left screen: forcing `text-left` on every cell moves text the screen never moved
    const header = document.querySelectorAll('th[scope="col"]')[1];
    const cell = document.querySelectorAll('td')[0];
    assert.doesNotMatch(header.className, /text-(left|right)/);
    assert.doesNotMatch(cell.className, /text-(left|right)/);
  });

  test('a footer renders as the table\'s totals row, so a sum is not a column', () => {
    render(
      <RowTable
        caption="Depreciation by year"
        rows={rows}
        rowKey={row => row.year}
        columns={columns}
        footer={<tr><th scope="row">Total</th><td className="text-right">$2,100.00</td></tr>}
      />,
    );
    const footer = document.querySelector('tfoot');
    assert.ok(footer, 'the totals row is a footer, not a body row');
    assert.equal(footer.textContent, 'Total$2,100.00');
  });

  test('an empty table shows the caller\'s sentence instead of an empty grid', () => {
    render(<RowTable caption="Depreciation by year" rows={[]} columns={columns} empty={<p>No schedule</p>} />);
    assert.equal(screen.queryByRole('table'), null);
    assert.ok(screen.getByText('No schedule'));
  });
});
