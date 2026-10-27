/**
 * #104: the transaction list is one keyboard region. Clicking a row puts focus in the grid (not on
 * the page body), arrows move the highlight and ask the list to scroll it into view, Enter/typing
 * edits, Escape clears, and Tab is never swallowed — the old code preventDefault()ed Tab and
 * listened on window, so the keyboard could not leave the grid.
 */
import './helpers/dom';
import test, { afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TransactionGridKeyboardRegion } from '../components/ledger/TransactionGridKeyboardRegion';
import type { GridFocus } from '../lib/ledgerGridNav';

const rows = Array.from({ length: 200 }, (_, index) => ({ id: `tx-${index}` }));
const fields = ['date', 'description', 'amountCents'];

function mount(overrides: Partial<React.ComponentProps<typeof TransactionGridKeyboardRegion>> = {}) {
  const changes: Array<GridFocus | null> = [];
  const edits: GridFocus[] = [];
  const props = {
    rows,
    fields,
    focus: { id: 'tx-3', field: 'description', index: 3 } as GridFocus | null,
    announcement: 'Row 4 of 200: May 01, 2026, Coffee',
    onFocusChange: (next: GridFocus | null) => changes.push(next),
    onEdit: (target: GridFocus) => edits.push(target),
    ...overrides,
  };
  const view = render(
    <TransactionGridKeyboardRegion {...props}>
      <div data-testid="row-3">Coffee</div>
      <button type="button">Void</button>
    </TransactionGridKeyboardRegion>,
  );
  return { changes, edits, props, view };
}

describe('Ledger keyboard region (#104)', () => {
  afterEach(() => cleanup());

  test('it is a labelled, focusable group with a polite live region', () => {
    mount();
    const region = screen.getByRole('region', { name: 'Transaction list' });
    assert.equal(region.getAttribute('tabindex'), '0');
    const live = screen.getByRole('status');
    assert.equal(live.getAttribute('aria-live'), 'polite');
    assert.match(live.textContent || '', /Row 4 of 200/);
  });

  test('clicking a row moves focus into the grid; clicking a button inside it does not steal it', () => {
    mount();
    const region = screen.getByRole('region', { name: 'Transaction list' });
    fireEvent.click(screen.getByText('Coffee'));
    assert.equal(document.activeElement, region, 'the arrow keys now belong to the grid');
    const button = screen.getByRole('button', { name: 'Void' });
    button.focus();
    fireEvent.click(button);
    assert.equal(document.activeElement, button, 'a control keeps its own focus');
  });

  test('arrows move the highlight and are handled; the target row is one row further', () => {
    const { changes } = mount();
    const region = screen.getByRole('region', { name: 'Transaction list' });
    assert.equal(fireEvent.keyDown(region, { key: 'ArrowDown' }), false, 'the page does not scroll as well');
    assert.deepEqual(changes, [{ id: 'tx-4', field: 'description', index: 4 }]);
    fireEvent.keyDown(region, { key: 'ArrowUp' });
    assert.deepEqual(changes.at(-1), { id: 'tx-2', field: 'description', index: 2 });
    fireEvent.keyDown(region, { key: 'ArrowRight' });
    assert.deepEqual(changes.at(-1), { id: 'tx-3', field: 'amountCents', index: 3 });
  });

  test('Tab and Shift+Tab are left to the browser so the keyboard can leave the grid', () => {
    const { changes } = mount();
    const region = screen.getByRole('region', { name: 'Transaction list' });
    assert.equal(fireEvent.keyDown(region, { key: 'Tab' }), true, 'Tab is not swallowed');
    assert.equal(fireEvent.keyDown(region, { key: 'Tab', shiftKey: true }), true);
    assert.deepEqual(changes, [], 'Tab does not move the highlight');
  });

  test('Escape clears the highlight, Enter and typing open the editor', () => {
    const { changes, edits } = mount();
    const region = screen.getByRole('region', { name: 'Transaction list' });
    fireEvent.keyDown(region, { key: 'Enter' });
    assert.deepEqual(edits, [{ id: 'tx-3', field: 'description', index: 3 }]);
    fireEvent.keyDown(region, { key: 'a' });
    assert.equal(edits.length, 2, 'typing over a cell edits it');
    fireEvent.keyDown(region, { key: 'a', ctrlKey: true });
    assert.equal(edits.length, 2, 'a shortcut is not typing');
    fireEvent.keyDown(region, { key: 'Escape' });
    assert.deepEqual(changes, [null]);
  });

  test('an empty list cannot throw or move, however many keys arrive', () => {
    const { changes } = mount({ rows: [], focus: null, announcement: '' });
    const region = screen.getByRole('region', { name: 'Transaction list' });
    for (const key of ['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End', 'Enter', 'Escape']) {
      fireEvent.keyDown(region, { key });
    }
    assert.deepEqual(changes, []);
  });

  test('with no highlight yet the first arrow key starts one, so the grid is reachable by keyboard', () => {
    const { changes } = mount({ focus: null });
    const region = screen.getByRole('region', { name: 'Transaction list' });
    assert.equal(fireEvent.keyDown(region, { key: 'ArrowDown' }), false, 'the page does not scroll as well');
    assert.deepEqual(changes, [{ id: 'tx-0', field: 'date', index: 0 }]);
    fireEvent.keyDown(region, { key: 'End' });
    assert.deepEqual(changes.at(-1), { id: 'tx-199', field: 'date', index: 199 }, 'End starts at the last row');
    fireEvent.keyDown(region, { key: 'Enter' });
    assert.equal(changes.length, 2, 'Enter alone still has no cell to edit');
  });

  test('closing an inline editor gives focus back to the grid, not to the page body', async () => {
    // The real grid opens its editor inside this region and unmounts it on Enter/Escape.
    const Editor = () => {
      const [editing, setEditing] = React.useState(true);
      return (
        <TransactionGridKeyboardRegion
          rows={rows}
          fields={fields}
          focus={{ id: 'tx-3', field: 'description', index: 3 }}
          inactive={editing}
          announcement=""
          onFocusChange={() => {}}
          onEdit={() => {}}
        >
          {editing && <input aria-label="Transaction description" />}
          <button type="button" onClick={() => setEditing(false)}>Save</button>
        </TransactionGridKeyboardRegion>
      );
    };
    await act(async () => { render(<Editor />); });
    const input = screen.getByLabelText('Transaction description');
    input.focus();
    assert.equal(document.activeElement, input, 'the editor holds focus while it is open');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
    const region = screen.getByRole('region', { name: 'Transaction list' });
    assert.equal(document.activeElement, region, 'the arrow keys keep working after Escape or save');
  });

  test('an open editor keeps the keys: arrows inside it are native', () => {
    const { changes } = mount({ inactive: true });
    const region = screen.getByRole('region', { name: 'Transaction list' });
    assert.equal(fireEvent.keyDown(region, { key: 'ArrowDown' }), true, 'not prevented while editing');
    assert.deepEqual(changes, []);
  });

  test('keys from a control inside the grid are not taken over', () => {
    const { changes } = mount();
    const button = screen.getByRole('button', { name: 'Void' });
    assert.equal(fireEvent.keyDown(button, { key: 'ArrowDown' }), true);
    assert.deepEqual(changes, []);
  });
});
