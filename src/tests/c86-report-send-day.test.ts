/**
 * C-86: a scheduled report is sent on the day chosen. By hand: 2026-11-10 is a Tuesday, 2026-11-14 a Saturday.
 * Weekly on Wednesday (3): not on Tuesday 11-10, from Wednesday 11-11 on; monthly on the 15th: not on 11-14, on 11-15.
 * The period sent is still the last finished one, so a missed run sends it the next day and its key keeps it to once.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { isSendDue, lastFinishedPeriod, scheduleProblem, sendDayLabel } from '../lib/scheduledReports';

const base = { id: 's', report: 'profit-and-loss' as const, recipients: ['a@example.com'] };

test('C-86: unset is the first day, as schedules saved before the choice are sent', () => {
  for (const day of ['2026-11-09', '2026-11-10', '2026-11-15']) {
    assert.equal(isSendDue({ frequency: 'weekly' }, day), true, day);
    assert.equal(isSendDue({ frequency: 'monthly' }, day), true, day);
  }
});

test('C-86: weekly on Wednesday waits for Wednesday, then sends the week before', () => {
  const s = { frequency: 'weekly' as const, sendDay: 3 };
  assert.equal(isSendDue(s, '2026-11-09'), false, 'Monday');
  assert.equal(isSendDue(s, '2026-11-10'), false, 'Tuesday');
  assert.equal(isSendDue(s, '2026-11-11'), true, 'Wednesday');
  assert.equal(isSendDue(s, '2026-11-14'), true, 'Saturday: a missed Wednesday still sends');
  assert.equal(lastFinishedPeriod('weekly', '2026-11-11').key, 'W:2026-11-02', 'the week of 2–8 November');
  assert.equal(sendDayLabel(s), 'every Wednesday');
});

test('C-86: monthly on the 15th waits for the 15th, then sends the month before', () => {
  const s = { frequency: 'monthly' as const, sendDay: 15 };
  assert.equal(isSendDue(s, '2026-11-14'), false);
  assert.equal(isSendDue(s, '2026-11-15'), true);
  assert.equal(isSendDue(s, '2026-11-30'), true);
  assert.equal(lastFinishedPeriod('monthly', '2026-11-15').key, 'M:2026-10');
  assert.deepEqual([1, 2, 3, 11, 12, 13, 21, 22, 23, 28].map(d => sendDayLabel({ frequency: 'monthly', sendDay: d }).split(' ')[2]),
    ['1st', '2nd', '3rd', '11th', '12th', '13th', '21st', '22nd', '23rd', '28th']);
});

test('C-86: a day outside the week or 1–28 is refused', () => {
  assert.equal(scheduleProblem({ ...base, frequency: 'weekly', sendDay: 7 }), null);
  assert.equal(scheduleProblem({ ...base, frequency: 'weekly', sendDay: 8 }), 'Choose a day of the week');
  assert.equal(scheduleProblem({ ...base, frequency: 'monthly', sendDay: 28 }), null);
  assert.equal(scheduleProblem({ ...base, frequency: 'monthly', sendDay: 31 }), 'Choose a day from 1 to 28');
  assert.equal(scheduleProblem({ ...base, frequency: 'monthly', sendDay: 1.5 }), 'Choose a day from 1 to 28');
});
