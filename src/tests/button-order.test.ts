import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyButtonOrder, buttonOrderStorageKey, isDefaultOrder, moveButton, nearestDropTarget, parseButtonOrders,
  serializeButtonOrders, stepButton, withButtonOrder, MAX_ORDER_IDS,
} from '../lib/buttonOrder';

const DEFAULTS = ['dashboard', 'inbox', 'sales', 'purchases', 'banking', 'reports', 'settings'];

test('a saved order only sorts: every button comes back once, unknown ids are ignored, nothing is added', () => {
  assert.deepEqual(applyButtonOrder(DEFAULTS, null), DEFAULTS);
  assert.deepEqual(applyButtonOrder(DEFAULTS, []), DEFAULTS);
  const saved = ['banking', 'removed-tool', 'dashboard', 'banking', 'inbox', 'sales', 'purchases', 'reports', 'settings'];
  const shown = applyButtonOrder(DEFAULTS, saved);
  assert.deepEqual(shown, ['banking', 'dashboard', 'inbox', 'sales', 'purchases', 'reports', 'settings']);
  assert.deepEqual([...shown].sort(), [...DEFAULTS].sort());
  // a saved order made only of buttons that no longer exist is no order at all
  assert.deepEqual(applyButtonOrder(DEFAULTS, ['gone', 'also-gone']), DEFAULTS);
  // a screen that is hidden from this person stays hidden whatever was saved
  assert.deepEqual(applyButtonOrder(['dashboard', 'sales'], ['payroll', 'sales', 'dashboard']), ['sales', 'dashboard']);
});

test('a tool added after the person arranged the list appears beside its default neighbour, not at the end', () => {
  const saved = ['settings', 'banking', 'dashboard'];
  assert.deepEqual(applyButtonOrder(['dashboard', 'inbox', 'banking', 'reports', 'settings'], saved),
    ['settings', 'banking', 'reports', 'dashboard', 'inbox']);
  // a new first tool goes first
  assert.deepEqual(applyButtonOrder(['new', 'a', 'b'], ['b', 'a']), ['new', 'b', 'a']);
});

test('moving a button before or after another; a move that changes nothing returns the same list', () => {
  assert.deepEqual(moveButton(DEFAULTS, 'banking', 'sales', 'before'), ['dashboard', 'inbox', 'banking', 'sales', 'purchases', 'reports', 'settings']);
  assert.deepEqual(moveButton(DEFAULTS, 'dashboard', 'settings', 'after'), ['inbox', 'sales', 'purchases', 'banking', 'reports', 'settings', 'dashboard']);
  assert.deepEqual(moveButton(DEFAULTS, 'settings', 'dashboard', 'before'), ['settings', 'dashboard', 'inbox', 'sales', 'purchases', 'banking', 'reports']);
  assert.equal(moveButton(DEFAULTS, 'sales', 'sales', 'before'), DEFAULTS);
  assert.equal(moveButton(DEFAULTS, 'sales', 'inbox', 'after'), DEFAULTS, 'already just after To review');
  assert.equal(moveButton(DEFAULTS, 'sales', 'purchases', 'before'), DEFAULTS, 'already just before Purchases');
  assert.equal(moveButton(DEFAULTS, 'unknown', 'sales', 'before'), DEFAULTS);
  assert.equal(moveButton(DEFAULTS, 'sales', 'unknown', 'before'), DEFAULTS);
});

test('a keyboard step moves among the buttons on screen and leaves hidden ones in place', () => {
  assert.deepEqual(stepButton(DEFAULTS, DEFAULTS, 'settings', -1), ['dashboard', 'inbox', 'sales', 'purchases', 'banking', 'settings', 'reports']);
  assert.equal(stepButton(DEFAULTS, DEFAULTS, 'dashboard', -1), DEFAULTS);
  assert.equal(stepButton(DEFAULTS, DEFAULTS, 'settings', 1), DEFAULTS);
  // a search shows only Sales and Reports: stepping Reports earlier puts it just before Sales
  assert.deepEqual(stepButton(DEFAULTS, ['sales', 'reports'], 'reports', -1), ['dashboard', 'inbox', 'reports', 'sales', 'purchases', 'banking', 'settings']);
  assert.equal(stepButton(DEFAULTS, ['sales', 'reports'], 'banking', 1), DEFAULTS, 'a button that is not on screen cannot be stepped');
});

test('the default order is recognised, so nothing is stored for it', () => {
  assert.equal(isDefaultOrder(DEFAULTS, [...DEFAULTS]), true);
  assert.equal(isDefaultOrder(DEFAULTS, moveButton(DEFAULTS, 'banking', 'sales', 'before')), false);
  assert.equal(isDefaultOrder(DEFAULTS, DEFAULTS.slice(1)), false);
});

test('saved text round-trips, and a damaged or foreign value is dropped instead of breaking a menu', () => {
  const orders = withButtonOrder({}, 'sidebar.daily', ['banking', 'dashboard']);
  assert.deepEqual(parseButtonOrders(serializeButtonOrders(orders)), { 'sidebar.daily': ['banking', 'dashboard'] });
  for (const raw of [null, undefined, '', 'not json', '[]', '"text"', '7', '{}', '{"version":2,"lists":{"a":["b"]}}', '{"version":1,"lists":[]}', '{"version":1}']) {
    assert.deepEqual(parseButtonOrders(raw), {}, String(raw));
  }
  assert.deepEqual(
    parseButtonOrders(JSON.stringify({ version: 1, lists: { ok: ['a', 7, '', 'a', null, 'b', { id: 'c' }], bad: 'a,b', empty: [], '': ['a'] } })),
    { ok: ['a', 'b'] },
  );
  const huge = Array.from({ length: MAX_ORDER_IDS + 50 }, (_, index) => `tool-${index}`);
  assert.equal(parseButtonOrders(JSON.stringify({ version: 1, lists: { big: huge } })).big.length, MAX_ORDER_IDS);
  // forgetting a list removes its key; other lists are untouched
  const two = withButtonOrder(orders, 'sidebar.all', ['x', 'y']);
  assert.deepEqual(withButtonOrder(two, 'sidebar.daily', null), { 'sidebar.all': ['x', 'y'] });
  assert.deepEqual(withButtonOrder(two, 'sidebar.all', []), { 'sidebar.daily': ['banking', 'dashboard'] });
  assert.deepEqual(orders, { 'sidebar.daily': ['banking', 'dashboard'] }, 'the input is not changed');
});

test('each person has a separate storage key, whatever characters the user id holds', () => {
  assert.notEqual(buttonOrderStorageKey('a', 'w'), buttonOrderStorageKey('b', 'w'));
  assert.notEqual(buttonOrderStorageKey('a', 'w1'), buttonOrderStorageKey('a', 'w2'), 'each workspace keeps its own order');
  assert.notEqual(buttonOrderStorageKey('a","b', 'w'), buttonOrderStorageKey('a', 'b","w'));
  assert.ok(buttonOrderStorageKey('test-user', 'w').startsWith('ledgerflow:button-order:v1:'));
});

test('a drop lands on the nearest button, before or after by which half the pointer is on; far away is no drop', () => {
  const column = [
    { id: 'a', left: 0, top: 0, right: 200, bottom: 44 },
    { id: 'b', left: 0, top: 48, right: 200, bottom: 92 },
    { id: 'c', left: 0, top: 96, right: 200, bottom: 140 },
  ];
  assert.deepEqual(nearestDropTarget(100, 50, column, 'vertical'), { id: 'b', position: 'before' });
  assert.deepEqual(nearestDropTarget(100, 90, column, 'vertical'), { id: 'b', position: 'after' });
  assert.deepEqual(nearestDropTarget(100, 180, column, 'vertical'), { id: 'c', position: 'after' }, 'just below the list: after the last button');
  assert.deepEqual(nearestDropTarget(100, -20, column, 'vertical'), { id: 'a', position: 'before' });
  assert.equal(nearestDropTarget(600, 50, column, 'vertical'), null, 'dragged well away from the list: called off');
  assert.equal(nearestDropTarget(100, 50, [], 'vertical'), null);
  const row = [
    { id: 'a', left: 0, top: 0, right: 100, bottom: 44 },
    { id: 'b', left: 110, top: 0, right: 210, bottom: 44 },
  ];
  assert.deepEqual(nearestDropTarget(120, 20, row, 'horizontal'), { id: 'b', position: 'before' });
  assert.deepEqual(nearestDropTarget(200, 20, row, 'horizontal'), { id: 'b', position: 'after' });
});
