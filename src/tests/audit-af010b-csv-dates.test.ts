/**
 * Independent audit Pass A — AF-010 continuation: CSV escaping, period locks, calendar validation.
 * Expected values worked by hand. Observed defects are locked and named.
 * Evidence: audit/function-audit/AF-010-money-microfunctions.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCsvCell, formatDecimal } from '../lib/utils';
import { toCsv } from '../lib/csvExport';
import { isLockedDate, monthEnd, dayBefore, postingLock, monthCloseState } from '../lib/periodLock';
import { bankStatementDate } from '../lib/bankStatementDate';

test('AF-010 CSV: quotes, doubling and formula neutralisation', () => {
  assert.equal(sanitizeCsvCell('=1+1'), '"\'=1+1"', 'leading = is neutralised');
  assert.equal(sanitizeCsvCell('@SUM(A1)'), '"\'@SUM(A1)"');
  assert.equal(sanitizeCsvCell('he said "hi"'), '"he said ""hi"""', 'quotes doubled inside a quoted cell');
  assert.equal(sanitizeCsvCell('line1\nline2'), '"line1\nline2"', 'line break kept inside the cell');
  assert.equal(sanitizeCsvCell('-1,000.00'), '"-1,000.00"', 'a safe negative number is not prefixed');
  // AF-010-F5 (P3): a whitespace-prefixed formula is not neutralised. FIXED 20 Nov 2026 (Agent #6):
  // the guard now decides on the first character a spreadsheet reads, so this is neutralised too.
  // Evidence: src/tests/security-csv-formula-injection.test.ts, docs/verification/ai6-2026-11-20.md
  assert.equal(sanitizeCsvCell(' =1+1'), '"\' =1+1"', 'leading-space formula is neutralised (AF-010-F5 fixed)');
  // AF-010-F6 (P3): non-finite money is rendered as text garbage rather than refused
  assert.equal(formatDecimal(Infinity), 'Infinity.NaN', 'OBSERVED GAP: Infinity cents are not refused');
  assert.equal(formatDecimal(NaN), '0.00');
  assert.equal(formatDecimal(-0), '0.00');
  const csv = toCsv(['name', 'amt'], [['a,b', 1234], ['=1+1', -5]]);
  assert.equal(csv, '"name","amt"\r\n"a,b",1234\r\n"\'=1+1",-5');
});

test('AF-010 period lock: boundaries, exceptions and role semantics all close in the safe direction', () => {
  assert.equal(isLockedDate(null, '2026-01-31'), true, 'a missing date is treated as locked');
  assert.equal(isLockedDate('2026-01-31', '2026-01-31'), true, 'the lock date itself is closed');
  assert.equal(isLockedDate('2026-02-01', '2026-01-31'), false);
  assert.equal(isLockedDate('2026-01-15', '2026-01-31', { fromDate: '2026-02-01', toDate: '2026-01-01' }), true, 'inverted exception unlocks nothing');
  assert.equal(isLockedDate('2026-01-15', '2026-01-31', { fromDate: '2026-01-10', toDate: '2026-01-20' }), false);
  const ws = { uid: 'o', roles: { b: 'bookkeeper' }, softLockDate: '2026-01-31' };
  assert.equal(postingLock('2026-01-15', ws, 'b')?.kind, 'soft');
  assert.equal(postingLock('2026-01-15', ws, 'o'), null, 'owner may post into a soft-closed period');
  assert.equal(monthEnd('2024-02'), '2024-02-29', 'leap February');
  assert.equal(monthEnd('2026-02'), '2026-02-28');
  assert.equal(dayBefore('2026-01-01'), '2025-12-31');
  assert.equal(dayBefore('2026-03-01'), '2026-02-28');
  assert.equal(monthCloseState('2026-01', { lockDate: '2026-02-28', lockException: { fromDate: '2026-01-10', toDate: '2026-01-20' } }), 'partly-open');
});

test('AF-010 bankStatementDate: real calendar dates only, no clock or timezone dependency', () => {
  assert.equal(bankStatementDate(2024, 2, 29), '2024-02-29');
  assert.equal(bankStatementDate(2026, 2, 29), null);
  assert.equal(bankStatementDate(2026, 4, 31), null);
  assert.equal(bankStatementDate(1899, 1, 1), null);
  assert.equal(bankStatementDate(2026.5, 1, 1), null);
  assert.equal(bankStatementDate(2026, 13, 1), null);
});
