/**
 * #904 (W11): a QuickBooks import is checked whole before anything is written, and the same file in the
 * same workspace keeps the same key (so chunk Idempotency-Keys and entry ids replay on a retry).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { migrationPreflight, migrationRunKey, type MigrationRow } from '../lib/migrationImport';

const row = (date: string, memo: string, cents = 100): MigrationRow => ({ date, memo, account: 'Checking', split: 'Revenue', debitCents: cents, creditCents: 0, netCents: cents });
const rows = [...Array.from({ length: 50 }, (_, i) => row('2026-01-02', `Deposit ${i + 1}`)), row('2025-12-29', 'Late deposit', 500)];
const ws = { uid: 'owner-1', lockDate: '2025-12-31' };

test('a row in a closed period stops the whole file before anything is written', () => {
  const problems = migrationPreflight(rows, ws as never, 'owner-1');
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^Row 51:/);
  assert.deepEqual(migrationPreflight(rows.slice(0, 50), ws as never, 'owner-1'), [], 'the open rows alone pass');
});

test('a row without a real date is refused', () => {
  const problems = migrationPreflight([row('2026-02-30', 'x'), row('01/02/2026', 'y')], null, 'u');
  assert.equal(problems.length, 2);
  assert.match(problems[0], /not a date/);
});

test('the same file in the same workspace keeps its key; another file or workspace gets another', async () => {
  const a = await migrationRunKey('ws-1', rows);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(await migrationRunKey('ws-1', rows.map(r => ({ ...r }))), a, 'an unchanged retry replays');
  assert.notEqual(await migrationRunKey('ws-2', rows), a);
  const corrected = rows.slice(0, 50);
  assert.notEqual(await migrationRunKey('ws-1', corrected), a, 'a corrected file imports as new');
});
