/**
 * L-80: "today in the workspace" (getLocalDateISO) and "the calendar day a Date stands for"
 * (calendarDateISO) are different questions. A Date built from a day on the device —
 * new Date(2026, 2, 1) — read in a workspace time zone behind the device's lands on the day
 * before. Date arithmetic on YYYY-MM-DD strings uses no time zone at all.
 */
import test, { after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { addToDateISO, calendarDateISO, getLocalDateISO, monthBoundsISO } from '../lib/utils';
import { civilYear } from '../lib/calendarDate';
import { useAuthStore } from '../stores/useAuthStore';
import type { Workspace } from '../types';

describe('Calendar dates', () => {
  test('adding days, months and years', () => {
    assert.equal(addToDateISO('2026-03-01', { days: -1 }), '2026-02-28');
    assert.equal(addToDateISO('2024-03-01', { days: -1 }), '2024-02-29');
    assert.equal(addToDateISO('2026-12-31', { days: 1 }), '2027-01-01');
    assert.equal(addToDateISO('2026-01-31', { months: 1 }), '2026-02-28', 'capped at the month end');
    assert.equal(addToDateISO('2026-03-15', { months: -3 }), '2025-12-15');
    assert.equal(addToDateISO('2024-02-29', { years: -1 }), '2023-02-28');
    assert.equal(addToDateISO('2026-05-10', { years: 1, months: 2, days: 3 }), '2027-07-13');
  });

  test('month bounds', () => {
    assert.deepEqual(monthBoundsISO('2026-02-14'), { start: '2026-02-01', end: '2026-02-28' });
    assert.deepEqual(monthBoundsISO('2024-02-01'), { start: '2024-02-01', end: '2024-02-29' });
    assert.deepEqual(monthBoundsISO('2026-12-31'), { start: '2026-12-01', end: '2026-12-31' });
  });

  test('a day built on the device stays that day, whatever the workspace time zone', () => {
    const tz = process.env.TZ;
    after(() => {
      process.env.TZ = tz;
      useAuthStore.setState({ workspaces: [], currentWorkspaceId: null as never });
    });
    // device in Auckland, workspace in Los Angeles: device midnight is the previous day there
    process.env.TZ = 'Pacific/Auckland';
    useAuthStore.setState({ currentWorkspaceId: 'w1', workspaces: [{ id: 'w1', name: 'W', currency: 'USD', timezone: 'America/Los_Angeles' } as Workspace] });
    const firstOfMarch = new Date(2026, 2, 1);
    assert.equal(calendarDateISO(firstOfMarch), '2026-03-01');
    assert.equal(getLocalDateISO(firstOfMarch), '2026-02-28', 'the old way: a day early (why L-80 exists)');
    assert.deepEqual(monthBoundsISO(calendarDateISO(firstOfMarch)), { start: '2026-03-01', end: '2026-03-31' });
  });
});

test('a stored date counts in its own year on every device (AF-011: the tax year filter)', () => {
  // parseLocalDate('2026-01-01').getFullYear() is 2025 on a device west of the workspace; the text is not
  assert.equal(civilYear('2026-01-01'), 2026);
  assert.equal(civilYear('2025-12-31'), 2025);
  assert.equal(civilYear('2026-01-01T00:30:00+13:00'), 2026, 'a stored timestamp keeps its written year');
  assert.equal(civilYear(''), null);
  assert.equal(civilYear(undefined), null);
});
