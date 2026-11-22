/**
 * Moving through a list with the keyboard (prompt 2, part 1: "row keyboard movement").
 *
 * The rules are tested on their own first, then through the shared grid: the arrow keys highlight a
 * row, Home and End go to the ends, Tab is never swallowed (so the keyboard can leave the list), keys
 * typed into a control inside a row stay with that control, and a record that leaves the list takes
 * the highlight with it rather than leaving it pointing at whichever row now holds the old place.
 */
import './helpers/dom';
import test, { afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { isRowNavKey, nextRowId, rowAnnouncement } from '../lib/rowKeyboardNav';
import { TanStackDataGrid } from '../components/ui/TanStackDataGrid';
import { useUIStore } from '../stores/useUIStore';
import type { ColumnDef } from '@tanstack/react-table';

const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

describe('row keyboard rules', () => {
  test('only the four movement keys belong to the list; Tab and Escape never do', () => {
    for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End']) assert.equal(isRowNavKey(key), true, key);
    for (const key of ['Tab', 'Escape', 'Enter', 'a', 'PageDown']) assert.equal(isRowNavKey(key), false, key);
  });

  test('down and up walk the list and stop at the ends instead of wrapping past them', () => {
    assert.equal(nextRowId(rows, 'a', 'ArrowDown'), 'b');
    assert.equal(nextRowId(rows, 'b', 'ArrowUp'), 'a');
    assert.equal(nextRowId(rows, 'c', 'ArrowDown'), 'c', 'the last row is the end');
    assert.equal(nextRowId(rows, 'a', 'ArrowUp'), 'a', 'the first row is the top');
  });

  test('with nothing highlighted yet a key still lands somewhere, so the keyboard can enter the list', () => {
    assert.equal(nextRowId(rows, null, 'ArrowDown'), 'a');
    assert.equal(nextRowId(rows, null, 'ArrowUp'), 'c', 'reading upwards starts at the last row');
    assert.equal(nextRowId(rows, null, 'End'), 'c');
    assert.equal(nextRowId(rows, null, 'Home'), 'a');
  });

  test('a row that is no longer in the list moves the highlight to a row that is', () => {
    assert.equal(nextRowId(rows, 'gone', 'ArrowDown'), 'a', 'not a stale index');
    assert.equal(nextRowId(rows, 'gone', 'ArrowUp'), 'c');
  });

  test('an empty list has nothing to move to', () => {
    assert.equal(nextRowId([], null, 'ArrowDown'), null);
    assert.equal(nextRowId([], 'a', 'End'), null);
  });

  test('the live region names the row and its place in the list', () => {
    const say = (row: { id: string }) => `Invoice ${row.id}`;
    assert.equal(rowAnnouncement(rows, 'b', say, rows), 'Row 2 of 3: Invoice b');
    assert.equal(rowAnnouncement(rows, null, say, rows), '', 'nothing highlighted, nothing to say');
    assert.equal(rowAnnouncement(rows, 'gone', say, rows), '');
  });
});

describe('the shared grid is one keyboard region', () => {
  afterEach(() => cleanup());

  type Row = { id: string; name: string };
  const data: Row[] = [
    { id: 'r1', name: 'First' },
    { id: 'r2', name: 'Second' },
    { id: 'r3', name: 'Third' },
  ];
  const columns: ColumnDef<Row, unknown>[] = [
    { id: 'name', accessorFn: r => r.name, header: 'Name', cell: info => String(info.getValue()) },
    {
      id: 'actions',
      header: 'Actions',
      enableSorting: false,
      cell: () => <button type="button">Open</button>,
    },
  ];

  const mount = () =>
    render(
      <TanStackDataGrid
        caption="Invoice list"
        data={data}
        columns={columns}
        announceRow={row => `Invoice ${row.name}`}
        hidePaginationOnSinglePage
      />,
    );

  const region = () => screen.getByRole('region', { name: 'Invoice list' });
  const active = () => document.querySelector('[data-grid-active-row="true"]');

  test('a Hebrew record keeps the default English controls; only the reader’s language choice switches them', () => {
    const language = useUIStore.getState().language;
    assert.equal(language, 'en', 'a fresh device does not infer its UI language from its books');
    const record = { id: 'עובד-17', name: 'נועה / Noa' };
    const view = render(<TanStackDataGrid data={[record]} columns={columns} columnScope="employees" columnLabel="Employees" />);
    const unchangedRecord = () => {
      assert.equal(view.getByText(record.name).closest('tr')?.getAttribute('data-grid-row-keyboard'), record.id);
    };
    try {
      assert.equal(view.container.querySelector('summary')?.textContent, 'Columns');
      assert.ok(view.getByRole('combobox', { name: 'Rows per page' }));
      unchangedRecord();
      act(() => useUIStore.getState().setLanguage('he'));
      assert.equal(view.container.querySelector('summary')?.textContent, 'עמודות');
      assert.ok(view.getByRole('combobox', { name: 'שורות לעמוד' }));
      unchangedRecord();
    } finally {
      act(() => useUIStore.getState().setLanguage(language));
    }
  });

  test('the list is one tab stop and the rows are not tab stops of their own', () => {
    mount();
    assert.equal(region().getAttribute('tabindex'), '0');
    for (const row of document.querySelectorAll('tbody tr')) {
      assert.equal(row.hasAttribute('tabindex'), false, 'a row is not a tab stop');
      assert.equal(row.getAttribute('role'), null, 'a row does not pretend to be a button');
    }
    // clicking a row asks the list to take focus, so the arrow keys work without reaching for Tab
    fireEvent.click(screen.getByText('Second'));
    assert.equal(document.activeElement, region(), 'the row hands focus to the list');
    assert.equal(active()?.textContent?.includes('Second'), true);
  });

  test('the arrow keys highlight a row, Home and End jump to the ends, and the page does not scroll too', () => {
    mount();
    const node = region();
    assert.equal(fireEvent.keyDown(node, { key: 'ArrowDown' }), false, 'the key is used by the list');
    assert.equal(active()?.textContent?.includes('First'), true, 'the first arrow key starts on row one');
    fireEvent.keyDown(node, { key: 'ArrowDown' });
    assert.equal(active()?.textContent?.includes('Second'), true);
    fireEvent.keyDown(node, { key: 'End' });
    assert.equal(active()?.textContent?.includes('Third'), true);
    fireEvent.keyDown(node, { key: 'Home' });
    assert.equal(active()?.textContent?.includes('First'), true);
    fireEvent.keyDown(node, { key: 'ArrowUp' });
    assert.equal(active()?.textContent?.includes('First'), true, 'the top row is the end going up');
  });

  test('Tab and Shift+Tab are left to the browser so the keyboard can leave the list', () => {
    mount();
    assert.equal(fireEvent.keyDown(region(), { key: 'Tab' }), true, 'Tab is not swallowed');
    assert.equal(fireEvent.keyDown(region(), { key: 'Tab', shiftKey: true }), true);
    assert.equal(active(), null, 'Tab does not move the highlight');
  });

  test('keys typed into a control inside a row stay with that control', () => {
    mount();
    const button = screen.getAllByRole('button', { name: 'Open' })[0];
    assert.equal(fireEvent.keyDown(button, { key: 'ArrowDown' }), true);
    assert.equal(active(), null);
  });

  test('the live region says which row the keyboard is on', () => {
    mount();
    // the region is in the page before it has anything to say, or a screen reader never announces it
    const live = document.querySelector('[data-grid-live-region]') as HTMLElement;
    assert.ok(live, 'the live region is mounted with the rows');
    assert.equal(live.getAttribute('aria-live'), 'polite');
    assert.equal(live.textContent, '', 'and starts empty');
    fireEvent.keyDown(region(), { key: 'ArrowDown' });
    assert.equal(live.textContent, 'Row 1 of 3: Invoice First');
    fireEvent.keyDown(region(), { key: 'ArrowDown' });
    assert.equal(live.textContent, 'Row 2 of 3: Invoice Second');
  });

  test('a filter that removes the highlighted record clears the highlight instead of keeping a stale row', () => {
    const view = mount();
    fireEvent.keyDown(region(), { key: 'End' });
    assert.equal(active()?.textContent?.includes('Third'), true);
    const search = screen.getByLabelText('Search records...');
    act(() => { fireEvent.change(search, { target: { value: 'Nope' } }); });
    assert.match(document.body.textContent || '', /No records found/);
    assert.equal(active(), null, 'the row it pointed at is gone');
    view.unmount();
  });

  test('the keys keep working after the layout switches between cards and the table', () => {
    // The cards and the table are two different elements, so the keyboard listener has to live on
    // whichever one is drawn. A window that narrows past the breakpoint is the case that used to leave
    // the arrows dead: the listener stayed on the element React had already thrown away.
    const realMatchMedia = window.matchMedia;
    let compact = false;
    let notify: (() => void) | null = null;
    window.matchMedia = ((query: string) => ({
      get matches() { return compact && query.includes('max-width: 639px'); },
      media: query, onchange: null,
      addListener: () => {}, removeListener: () => {},
      addEventListener: (_: string, handler: () => void) => { notify = handler; },
      removeEventListener: () => {}, dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    try {
      const view = render(
        <TanStackDataGrid
          caption="Invoice list"
          data={data}
          columns={columns}
          mobileLayout="cards"
          hidePaginationOnSinglePage
        />,
      );
      assert.ok(document.querySelector('table'), 'a wide screen draws the table');
      fireEvent.keyDown(region(), { key: 'ArrowDown' });
      assert.equal(active()?.textContent?.includes('First'), true, 'the arrows work in the table');

      // the window narrows to a phone: React swaps the table for cards, a different element
      const tableRegion = region();
      compact = true;
      act(() => { notify?.(); });
      assert.equal(document.querySelector('table'), null, 'the cards replace the table');
      const phoneRegion = region();
      assert.notEqual(phoneRegion, tableRegion, 'it is a different element than the table was');
      assert.equal(fireEvent.keyDown(phoneRegion, { key: 'ArrowDown' }), false, 'the arrows still belong to the list');
      fireEvent.keyDown(phoneRegion, { key: 'End' });
      assert.equal(active()?.textContent?.includes('Third'), true, 'and they move the highlight in the new layout');

      // and back again, with the data changing at the same time (a refetch), which is what used to
      // re-run the effect on the old node
      compact = false;
      act(() => { notify?.(); });
      view.rerender(
        <TanStackDataGrid
          caption="Invoice list"
          data={[...data, { id: 'r4', name: 'Fourth' }]}
          columns={columns}
          mobileLayout="cards"
          hidePaginationOnSinglePage
        />,
      );
      assert.ok(document.querySelector('table'), 'the table is back');
      assert.equal(fireEvent.keyDown(region(), { key: 'Home' }), false, 'the arrows work again after the switch back');
      assert.equal(active()?.textContent?.includes('First'), true);
    } finally {
      window.matchMedia = realMatchMedia;
    }
  });

  test('an empty list has no highlight and no keys to move, however many arrive', () => {
    render(<TanStackDataGrid caption="Empty list" data={[]} columns={columns} />);
    assert.equal(screen.queryByRole('region', { name: 'Empty list' }), null, 'an empty list shows the empty state, not a table');
    assert.equal(document.querySelector('[data-grid-active-row]'), null);
  });
});
