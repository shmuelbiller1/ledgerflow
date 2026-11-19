/**
 * Column chooser on report tables (N-10): the first column and at least one other always stay; the
 * choice is remembered per report; the CSS hides exactly those columns; on screen, "Columns" lists
 * the headings, hiding one keeps it hidden next time the report opens.
 */
import './helpers/dom';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { hiddenColumnsCss, readHidden, saveHidden, toggleColumn } from '../lib/columnChoice';
import ReportSchedule from '../components/reporting/ReportSchedule';
import ReportTableScroll from '../components/reporting/ReportTableScroll';
import BankHolidaysReportView from '../components/reporting/BankHolidaysReportView';

afterEach(() => { cleanup(); localStorage.clear(); });

test('what can be hidden, remembered per report, and the CSS for it', () => {
  assert.deepEqual(toggleColumn([], 0, 4), [], 'the first column stays');
  assert.deepEqual(toggleColumn([], 2, 4), [2]);
  assert.deepEqual(toggleColumn([2], 2, 4), []);
  assert.deepEqual(toggleColumn([1, 2], 3, 4), [1, 2], 'one other column stays');
  saveHidden('Sales', [2]);
  assert.deepEqual([readHidden('Sales'), readHidden('Other')], [[2], []]);
  const normal = ['Code', 'Name', 'Amount'], compare = ['Period', ...normal];
  assert.deepEqual(readHidden('Sales', normal), [2], 'existing preferences survive the new key');
  assert.deepEqual(readHidden('Sales', compare), [], 'do not interpret Amount as Name');
  saveHidden('Sales', [3], compare);
  assert.deepEqual(readHidden('Sales', normal), [2]);
  assert.equal(hiddenColumnsCss('s1', [2]), '[data-columns="s1"] tr:not([data-span-row]) > :nth-child(3) { display: none; }');
});

const Report = () => (
  <ReportTableScroll>
    <table><caption>Sales by item</caption>
      <thead><tr><th>Item</th><th>Units</th><th>Amount</th></tr></thead>
      <tbody><tr><td>Chair</td><td>2</td><td>$100.00</td></tr></tbody>
    </table>
  </ReportTableScroll>
);

test('on screen: Columns lists the headings; a hidden one stays hidden next time', async () => {
  const view = render(<Report />);
  await waitFor(() => assert.ok(screen.getByRole('button', { name: 'Columns' })));
  fireEvent.click(screen.getByRole('button', { name: 'Columns' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Units' }));
  assert.ok(screen.getByRole('button', { name: 'Columns (1 hidden)' }));
  assert.match(view.container.querySelector('style')!.textContent || '', /:nth-child\(2\) \{ display: none; \}/);
  view.unmount();
  render(<Report />);
  await waitFor(() => assert.ok(screen.getByRole('button', { name: 'Columns (1 hidden)' })));
});

test('moving a column moves real headers and cells, keeps the label first and survives reopening', async () => {
  let view = render(<Report />);
  await waitFor(() => assert.ok(view.getByRole('button', { name: 'Columns' })));
  fireEvent.click(view.getByRole('button', { name: 'Columns' }));
  await waitFor(() => assert.ok(view.getByRole('button', { name: 'Move Amount earlier' })));
  fireEvent.click(view.getByRole('button', { name: 'Move Amount earlier' }));
  assert.deepEqual(Array.from(view.container.querySelectorAll('thead th')).map(cell => cell.textContent), ['Item', 'Amount', 'Units']);
  assert.deepEqual(Array.from(view.container.querySelectorAll('tbody td')).map(cell => cell.textContent), ['Chair', '$100.00', '2']);
  fireEvent.click(view.getByRole('checkbox', { name: 'Units' }));
  assert.match(view.container.querySelector('style')!.textContent || '', /nth-child\(3\)/);
  view.unmount();
  view = render(<Report />);
  await waitFor(() => assert.deepEqual(Array.from(view.container.querySelectorAll('thead th')).map(cell => cell.textContent), ['Item', 'Amount', 'Units']));
});

test('fragment groups keep every header and value without duplicate React keys when reordered', async () => {
  const errors: unknown[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => { errors.push(args[0]); };
  try {
    const view = render(<ReportTableScroll><table><caption>Grouped cells</caption>
      <thead><tr><><th>Record</th><th>Count</th></><><th>Amount</th><th>Notes</th></></tr></thead>
      <tbody><tr><><td>אחד One</td><td>2</td></><><td>$30.00</td><td>Note</td></></tr></tbody>
    </table></ReportTableScroll>);
    await waitFor(() => assert.ok(view.getByRole('button', { name: 'Columns' })));
    fireEvent.click(view.getByRole('button', { name: 'Columns' }));
    fireEvent.click(view.getByRole('button', { name: 'Move Amount earlier' }));
    assert.deepEqual(Array.from(view.container.querySelectorAll('thead th')).map(cell => cell.textContent), ['Record', 'Amount', 'Count', 'Notes']);
    assert.deepEqual(Array.from(view.container.querySelectorAll('tbody td')).map(cell => cell.textContent), ['אחד One', '$30.00', '2', 'Note']);
    assert.equal(errors.length, 0, 'reconciliation must retain distinct fragment-cell identities');
  } finally { console.error = originalError; }
});

// The native-table fixtures above cannot catch a report whose rows are owned by a child component.
test('a migrated bank-holidays report moves the actual bilingual cells without remounting them', async () => {
  const view = render(<BankHolidaysReportView />);
  fireEvent.click(await view.findByRole('button', { name: 'Columns' }));
  const holiday = view.getByText('א׳ פסח', { selector: 'bdi' }).parentElement!;
  const row = holiday.closest('tr')!;
  const [date, day, name, banks, note] = Array.from(row.cells);
  assert.equal(name, holiday);
  assert.equal(date.scope, 'row');
  fireEvent.click(view.getByRole('button', { name: 'Move Holiday earlier' }));
  assert.deepEqual(view.getAllByRole('columnheader').map(cell => cell.textContent), ['Date', 'Holiday', 'Day', 'Banks', 'Note']);
  [date, name, day, banks, note].forEach((cell, index) => assert.equal(row.cells[index], cell));
  fireEvent.click(view.getByRole('checkbox', { name: 'Day' }));
  assert.equal(getComputedStyle(day).display, 'none');
  assert.notEqual(getComputedStyle(name).display, 'none');
});

// A hidden Amount must not hide the third DOM child of the total: two source columns share its label.
test('a spanned total follows source columns and a non-first row identity cannot be hidden', async () => {
  const view = render(<ReportSchedule columnControls caption="Value by place" rows={[{ item: 'Valve', qty: 3 }]}
    columns={[{ header: 'Location', cell: () => 'East' }, { header: 'Item', rowHeader: true, cell: r => r.item },
      { header: 'Qty', cell: r => r.qty }, { header: 'Value', cell: () => '$22.50' }]}
    footer={<tr><th scope="row" colSpan={3}>Total</th><td>$22.50</td></tr>} />);
  fireEvent.click(await view.findByRole('button', { name: 'Columns' }));
  assert.ok((view.getByRole('checkbox', { name: 'Item' }) as HTMLInputElement).disabled);
  const foot = view.container.querySelector('tfoot tr') as HTMLTableRowElement;
  fireEvent.click(view.getByRole('checkbox', { name: 'Qty' }));
  assert.equal(foot.cells[0].colSpan, 2);
  assert.notEqual(getComputedStyle(foot.cells[1]).display, 'none');
  fireEvent.click(view.getByRole('checkbox', { name: 'Value' }));
  assert.ok(foot.cells[1].hidden);
  assert.equal(foot.cells[0].colSpan, 2);
  assert.ok(view.getByRole('rowheader', { name: 'Valve' }));
});
