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
  assert.equal(hiddenColumnsCss('s1', [2]), '[data-columns="s1"] tr > :nth-child(3) { display: none; }');
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
