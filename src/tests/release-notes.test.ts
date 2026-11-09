/** F-36 — release notes from commit messages: what a person sees, once a week. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, groupByWeek, isUserFacing, parseSubject, releaseNotesDocument, releaseNotesMarkdown, weekStart,
} from '../lib/releaseNotes';

const commits = [
  { hash: 'aaa1111222', date: '2026-10-19', subject: 'feat(sales): add a deposit button to the order' },
  { hash: 'bbb2222333', date: '2026-10-19', subject: 'fix(purchases): a paid bill no longer shows as overdue' },
  { hash: 'ccc3333444', date: '2026-10-18', subject: 'chore: bump dependencies' },
  { hash: 'ddd4444555', date: '2026-10-18', subject: 'docs: explain the tax profile' },
  { hash: 'eee5555666', date: '2026-10-17', subject: 'test: cover the statement period' },
  { hash: 'fff6666777', date: '2026-10-16', subject: 'a11y: name the export button' },
  { hash: 'ggg7777888', date: '2026-10-12', subject: 'chore(ci): weekly run' },
  { hash: 'hhh8888999', date: '2026-10-12', subject: 'perf: [user-facing] reports open twice as fast' },
  { hash: 'iii9999000', date: '2026-10-11', subject: 'Tell the owner when a backup is overdue' },
  { hash: 'jjj0000111', date: 'not-a-date', subject: 'feat: should be ignored' },
];

describe('F-36 release notes', () => {
  test('a subject splits into type, area and words', () => {
    assert.deepEqual(parseSubject('feat(sales): add a deposit button'), { type: 'feat', area: 'sales', text: 'add a deposit button' });
    assert.deepEqual(parseSubject('fix!: change the total'), { type: 'fix', area: 'general', text: 'change the total' });
    assert.deepEqual(parseSubject('Tell the owner when a backup is overdue'), { type: '', area: 'general', text: 'Tell the owner when a backup is overdue' });
  });

  test('only what a person can see is included', () => {
    for (const subject of ['feat: x', 'fix(a): y', 'perf: z', 'a11y: w', 'perf: [user-facing] v', 'Plain sentence']) {
      assert.ok(isUserFacing(subject), subject);
    }
    for (const subject of ['chore: x', 'docs: y', 'test: z', 'refactor: w', 'ci: v', 'build: u', 'style: t', 'revert: s']) {
      assert.ok(!isUserFacing(subject), subject);
    }
  });

  test('weeks start on the named day, and dates are plain calendar days', () => {
    assert.equal(weekStart('2026-10-19', 1), '2026-10-19', 'Monday');
    assert.equal(weekStart('2026-10-18', 1), '2026-10-12', 'Sunday belongs to the week before');
    assert.equal(weekStart('2026-10-18', 0), '2026-10-18', 'a Sunday-start week');
    assert.equal(addDays('2026-02-28', 1), '2026-03-01');
    assert.equal(addDays('2024-02-28', 1), '2024-02-29', 'leap day');
    assert.equal(addDays('2026-01-01', -1), '2025-12-31', 'year boundary');
  });

  test('the period groups into weeks, newest first, hidden commits left out', () => {
    const weeks = groupByWeek(commits);
    assert.deepEqual(weeks.map(w => [w.start, w.end, w.entries.length]), [
      ['2026-10-19', '2026-10-25', 2],
      ['2026-10-12', '2026-10-18', 2],
      ['2026-10-05', '2026-10-11', 1],
    ]);
    assert.deepEqual(weeks[0].entries.map(e => e.area), ['purchases', 'sales'], 'sorted by area');
    assert.equal(weeks[1].entries.find(e => e.text.includes('reports open'))?.text, 'reports open twice as fast', 'the marker is not shown');
    assert.equal(weeks[0].entries[0].hash, 'bbb2222', 'short hash kept for tracing');
  });

  test('the markdown says what changed, and an empty week says so', () => {
    const [first] = groupByWeek(commits);
    const md = releaseNotesMarkdown(first);
    assert.match(md, /^# What changed — week of 2026-10-19/);
    assert.match(md, /2026-10-19 to 2026-10-25/);
    assert.match(md, /- \*\*purchases\*\* — a paid bill no longer shows as overdue \(bbb2222\)/);
    assert.match(md, /- \*\*sales\*\* — add a deposit button to the order \(aaa1111\)/);

    const empty = releaseNotesMarkdown({ start: '2026-10-26', end: '2026-11-01', entries: [] });
    assert.match(empty, /No user-facing changes this week\./);
  });

  test('a period with only hidden commits produces no invented news', () => {
    const doc = releaseNotesDocument([{ hash: 'zzz', date: '2026-10-19', subject: 'chore: tidy' }]);
    assert.equal(doc, '# What changed\n\nNo user-facing commits in this period.\n');
  });
});
