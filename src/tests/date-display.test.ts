/** Dates on screen follow the user's choice in Preferences (I-12); inputs and files stay YYYY-MM-DD. */
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { DATE_DISPLAY_FORMATS, formatDate, setDateDisplayFormat } from '../lib/utils';
import { civilDateParts, civilDayOfMonth, civilMonthDay, civilMonthYear } from '../lib/calendarDate';
import { useAuthStore } from '../stores/useAuthStore';
import type { Workspace } from '../types';

describe('Date display', () => {
  test('each choice', () => {
    assert.equal(formatDate('2026-03-07', 'MMM DD, YYYY'), 'Mar 07, 2026');
    assert.equal(formatDate('2026-03-07', 'YYYY-MM-DD'), '2026-03-07');
    assert.equal(formatDate('2026-03-07', 'MM/DD/YYYY'), '03/07/2026');
    assert.equal(formatDate('2026-03-07', 'DD/MM/YYYY'), '07/03/2026');
    assert.equal(DATE_DISPLAY_FORMATS.length, 4);
  });

  test('the saved choice applies everywhere; nothing or nonsense shows nothing or the text', () => {
    setDateDisplayFormat('DD/MM/YYYY');
    assert.equal(formatDate('2026-12-31'), '31/12/2026');
    setDateDisplayFormat('nonsense');
    assert.equal(formatDate('2026-12-31'), 'Dec 31, 2026');
    assert.equal(formatDate(undefined), '');
    assert.equal(formatDate('not a date'), 'not a date');
  });

  test('short civil displays read the stored day on every device (#342 list badges)', () => {
    // The forensic badges and the reconciliation ledger rows used to format a workspace-midnight
    // instant in the device zone, so New Year's Day read as last year across zones.
    assert.equal(civilMonthDay('2026-01-01'), 'Jan 01');
    assert.equal(civilMonthYear('2026-01-01'), 'Jan 2026');
    assert.equal(civilDayOfMonth('2026-01-01'), '01');
    assert.equal(civilMonthDay('2026-12-31'), 'Dec 31');
    assert.equal(civilMonthYear('2025-02-28'), 'Feb 2025');
    assert.equal(civilMonthDay('2026-02-30'), '', 'an impossible day shows nothing instead of throwing');
    assert.equal(civilMonthDay('not a date'), '');
    assert.equal(civilMonthDay(undefined), '');
  });

  test('a calendar date is the same day in every time zone (no UTC shift)', () => {
    setDateDisplayFormat('YYYY-MM-DD');
    assert.equal(formatDate('2026-01-01'), '2026-01-01');
  });

  test('a stored date is shown as written when the device zone and the workspace zone differ (D-65, #342)', () => {
    const oldTZ = process.env.TZ;
    const auth = useAuthStore.getState();
    setDateDisplayFormat('MMM DD, YYYY');
    try {
      // The issue's repro: device in UTC, workspace in Pacific/Auckland (UTC+12/+13).
      process.env.TZ = 'UTC';
      useAuthStore.setState({
        currentWorkspaceId: 'date-display',
        workspaces: [{ id: 'date-display', timezone: 'Pacific/Auckland' } as Workspace],
      });
      assert.equal(formatDate('2026-01-01', 'YYYY-MM-DD'), '2026-01-01', 'New Year\'s Day stays in 2026');
      assert.equal(formatDate('2026-01-01'), 'Jan 01, 2026');
      // DST changes, leap days and both year boundaries, on the east side of UTC.
      for (const day of ['2026-01-01', '2026-03-08', '2026-03-29', '2026-04-05', '2026-09-27', '2026-10-25', '2026-11-01', '2024-02-29', '2026-12-31', '2027-01-01']) {
        assert.equal(formatDate(day, 'YYYY-MM-DD'), day);
        assert.equal(formatDate(day, 'DD/MM/YYYY'), `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`);
      }

      // The far west too: a workspace behind the device must not show tomorrow's date either.
      process.env.TZ = 'Pacific/Kiritimati';
      useAuthStore.setState({
        currentWorkspaceId: 'date-display',
        workspaces: [{ id: 'date-display', timezone: 'Pacific/Honolulu' } as Workspace],
      });
      assert.equal(formatDate('2026-01-01', 'YYYY-MM-DD'), '2026-01-01');
      assert.equal(formatDate('2026-12-31'), 'Dec 31, 2026');

      // No workspace zone at all (guest): the device zone must not move the stored day either.
      useAuthStore.setState({ currentWorkspaceId: 'date-display', workspaces: [] });
      process.env.TZ = 'America/Los_Angeles';
      assert.equal(formatDate('2026-01-01', 'MM/DD/YYYY'), '01/01/2026');
    } finally {
      if (oldTZ === undefined) delete process.env.TZ;
      else process.env.TZ = oldTZ;
      useAuthStore.setState(auth, true);
    }
  });

  test('the stored day is read from the text, and an impossible day is not a calendar date', () => {
    assert.deepEqual(civilDateParts('2026-03-07'), { year: 2026, month: 3, day: 7 });
    assert.deepEqual(civilDateParts('2024-02-29'), { year: 2024, month: 2, day: 29 });
    assert.deepEqual(civilDateParts(' 2026-1-2 '), { year: 2026, month: 1, day: 2 });
    assert.equal(civilDateParts('2026-02-30'), null);
    assert.equal(civilDateParts('2026-13-01'), null);
    assert.equal(civilDateParts('2026-01-01T00:00:00Z'), null, 'a moment is not a stored calendar date');
    assert.equal(civilDateParts('not a date'), null);
  });
});
