/** #104: where the ledger highlight goes, and what happens to it when the visible rows change. */
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { gridFieldEditable, gridFieldLabel, gridFields, isGridNavKey, moveGridFocus, reconcileGridFocus, startGridFocus, type GridFocus } from '../lib/ledgerGridNav';

const rows = Array.from({ length: 12 }, (_, index) => ({ id: `tx-${index}` }));
const fields = ['date', 'description', 'category', 'amountCents', 'status'];
const at = (index: number, field = 'description'): GridFocus => ({ id: `tx-${index}`, field, index });

describe('Ledger grid navigation (#104)', () => {
  test('the fields follow the drawn columns, with the amount column stored as amountCents', () => {
    assert.deepEqual(gridFields('date,description,amount,status'), ['date', 'description', 'amountCents', 'status']);
    assert.deepEqual(gridFields(' date , ,amount '), ['date', 'amountCents']);
    assert.deepEqual(gridFields(''), []);
    for (const key of ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End']) assert.equal(isGridNavKey(key), true);
    for (const key of ['Tab', 'Enter', 'Escape', 'a', 'PageDown']) assert.equal(isGridNavKey(key), false);
  });

  test('a list with no highlight yet starts on its first cell (or on the last row with End)', () => {
    assert.deepEqual(startGridFocus(rows, fields), at(0, 'date'), 'the first column of the first row');
    assert.deepEqual(startGridFocus(rows, fields, 'end'), at(11, 'date'), 'End lands on the last row');
    assert.equal(startGridFocus([], fields), null, 'an empty list has no cell to start on');
    assert.equal(startGridFocus(rows, []), null, 'a list with every navigable column hidden has no cell');
  });

  test('the announced column is named the way the grid names it, never by its stored id', () => {
    assert.equal(gridFieldLabel('amountCents'), 'Amount');
    assert.equal(gridFieldLabel('date'), 'Date');
    assert.equal(gridFieldLabel('description'), 'Description');
    assert.equal(gridFieldLabel('category'), 'Category');
    assert.equal(gridFieldLabel('project'), 'Project');
    assert.equal(gridFieldLabel('status'), 'Status');
    assert.equal(gridFieldLabel('notes'), 'notes', 'an unknown field is announced as it is');
  });

  test('arrows move one row and stop at the ends instead of running past the list', () => {
    assert.deepEqual(moveGridFocus(at(3), 'ArrowDown', fields, rows), at(4));
    assert.deepEqual(moveGridFocus(at(0), 'ArrowUp', fields, rows), at(0), 'the first row is the top');
    assert.deepEqual(moveGridFocus(at(11), 'ArrowDown', fields, rows), at(11), 'the last row is the end');
    assert.deepEqual(moveGridFocus(at(11), 'ArrowUp', fields, rows), at(10));
  });

  test('Home and End jump to the first and last row without changing the column', () => {
    assert.deepEqual(moveGridFocus(at(5, 'amountCents'), 'Home', fields, rows), at(0, 'amountCents'));
    assert.deepEqual(moveGridFocus(at(5, 'amountCents'), 'End', fields, rows), at(11, 'amountCents'));
  });

  test('left and right walk the columns and then the neighbouring row', () => {
    assert.deepEqual(moveGridFocus(at(3, 'date'), 'ArrowRight', fields, rows), at(3, 'description'));
    assert.deepEqual(moveGridFocus(at(3, 'status'), 'ArrowRight', fields, rows), at(4, 'date'), 'the end of a row goes to the next row');
    assert.deepEqual(moveGridFocus(at(3, 'description'), 'ArrowLeft', fields, rows), at(3, 'date'));
    assert.deepEqual(moveGridFocus(at(3, 'date'), 'ArrowLeft', fields, rows), at(2, 'status'), 'the start of a row goes back a row');
    assert.deepEqual(moveGridFocus(at(0, 'date'), 'ArrowLeft', fields, rows), at(0, 'date'), 'nothing before the first cell');
    assert.deepEqual(moveGridFocus(at(11, 'status'), 'ArrowRight', fields, rows), at(11, 'status'), 'nothing after the last cell');
  });

  test('an unknown field starts the row walk from the first column', () => {
    assert.deepEqual(moveGridFocus({ id: 'tx-2', field: 'notes', index: 2 }, 'ArrowRight', fields, rows), at(2, 'description'));
  });

  test('a stale index follows the record; a missing record clears the highlight; no rows never throws', () => {
    assert.deepEqual(moveGridFocus({ id: 'tx-7', field: 'date', index: 1 }, 'ArrowDown', fields, rows), {
      id: 'tx-8', field: 'date', index: 8,
    }, 'the index is taken from the record, not from the stale number');
    assert.equal(moveGridFocus({ id: 'gone', field: 'date', index: 2 }, 'ArrowDown', fields, rows), null);
    assert.equal(moveGridFocus(at(0), 'ArrowDown', fields, []), null, 'an empty list has nowhere to go');
    assert.deepEqual(moveGridFocus(at(1), 'ArrowRight', [], rows), at(1), 'a list with no navigable column keeps its field');
  });

  test('after a sort the highlight follows its record; after a filter removes it, the highlight is dropped', () => {
    const sorted = [rows[4], rows[0], rows[7]];
    assert.deepEqual(reconcileGridFocus(at(0), sorted), { id: 'tx-0', field: 'description', index: 1 });
    assert.deepEqual(reconcileGridFocus({ id: 'tx-7', field: 'date', index: 2 }, sorted), { id: 'tx-7', field: 'date', index: 2 });
    assert.equal(reconcileGridFocus(at(0), [rows[1], rows[2]]), null, 'the filtered-out record is not swapped for another');
    assert.equal(reconcileGridFocus(at(0), []), null, 'an empty list has no highlight');
    assert.equal(reconcileGridFocus(null, rows), null);
    const stillThere = at(3);
    assert.equal(reconcileGridFocus(stillThere, rows), stillThere, 'an unchanged highlight keeps its identity (no render loop)');
  });

  test('Enter edits only cells the row draws an editor for', () => {
    const desktop = { mobile: false, tablet: false };
    for (const field of ['description', 'amountCents', 'category', 'project']) assert.equal(gridFieldEditable(field, desktop), true, field);
    for (const field of ['date', 'status', 'balance']) assert.equal(gridFieldEditable(field, desktop), false, field);
    assert.equal(gridFieldEditable('category', { mobile: true, tablet: false }), false);
    assert.equal(gridFieldEditable('project', { mobile: false, tablet: true }), false);
  });
});
