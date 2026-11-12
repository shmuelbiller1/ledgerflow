/** EU-H2: three plain facts with where to look — backup, months closed, problems — and a calm card when all is well. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { booksSafety } from '../lib/booksSafety';

const fresh = { lastBackupAt: '2026-11-08T10:00:00Z', daysSinceLastBackup: 3, isDue: false, status: 'fresh' as const };

test('EU-H2: all well — backup 3 days ago, closed through October 2026, no problems', () => {
  const rows = booksSafety({ backup: fresh, lockDate: '2026-10-31', findings: [] });
  assert.deepEqual(rows.map(r => [r.id, r.ok, r.text]), [
    ['backup', true, 'Last backup 3 days ago'],
    ['closed', true, 'Closed through October 2026'],
    ['problems', true, 'No problems found'],
  ]);
  assert.deepEqual(rows.map(r => r.page), [{ tab: 'settings', sub: 'export' }, { tab: 'month-end-close' }, { tab: 'data-health' }]);
});

test('EU-H2: what needs doing is said plainly', () => {
  const rows = booksSafety({
    backup: { lastBackupAt: null, daysSinceLastBackup: null, isDue: true, status: 'never' },
    lockDate: null, findings: [{ severity: 'high' }, { severity: 'low' }, { severity: 'medium' }],
  });
  assert.deepEqual(rows.map(r => [r.ok, r.text]), [[false, 'No backup downloaded yet'], [false, 'No month closed yet'], [false, '3 problems found (1 serious)']]);
  const overdue = booksSafety({ backup: { lastBackupAt: 'x', daysSinceLastBackup: 41, isDue: true, status: 'overdue' }, lockDate: '2026-09-30', findings: [{ severity: 'low' }] });
  assert.deepEqual(overdue.map(r => [r.ok, r.text]), [[false, 'Last backup 41 days ago — time for a new one'], [true, 'Closed through September 2026'], [true, '1 problem found']]);
});
