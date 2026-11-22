import test from 'node:test';
import assert from 'node:assert/strict';
import { bankLineAgeGroup, oldestBankLinesFirst } from '../lib/bankLineAge';

test('B-3: exact calendar boundaries, future and invalid statement dates', () => {
  const cases = [
    ['2026-11-20', 'under7'], ['2026-11-14', 'under7'],
    ['2026-11-13', '7to30'], ['2026-10-21', '7to30'],
    ['2026-10-20', 'over30'], ['2026-11-21', 'future'],
    ['', 'unknown'], ['2026-02-30', 'unknown'],
  ];
  for (const [date, expected] of cases) assert.equal(bankLineAgeGroup(date, '2026-11-20'), expected, date);
  assert.equal(bankLineAgeGroup('2024-02-29', '2024-03-07'), '7to30');
  assert.equal(bankLineAgeGroup('2026-03-07', '2026-03-14'), '7to30', 'DST is not a fractional day');
  assert.equal(bankLineAgeGroup('2026-11-20', 'invalid'), 'unknown');
});

test('B-3: oldest first, stable equal dates, unknown last, cache untouched', () => {
  const lines = [
    { id: 'bad', date: 'bad' }, { id: 'recent', date: '2026-11-20' },
    { id: 'old1', date: '2026-10-01' }, { id: 'old2', date: '2026-10-01' },
    { id: 'future', date: '2026-12-01' },
  ];
  const original = structuredClone(lines);
  assert.deepEqual(oldestBankLinesFirst(lines).map(l => l.id), ['old1', 'old2', 'recent', 'future', 'bad']);
  assert.deepEqual(lines, original);
  assert.deepEqual(oldestBankLinesFirst([]), []);
});
