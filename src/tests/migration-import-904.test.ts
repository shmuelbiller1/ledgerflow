/**
 * #904 (W11): a QuickBooks import is checked whole before anything is written, and the same file in the
 * same workspace keeps the same key (so chunk Idempotency-Keys and entry ids replay on a retry).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { contentKey, migrationPreflight, migrationRowIds, type MigrationRow } from '../lib/migrationImport';

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

test('each row keeps its id when another row is corrected; identical rows get different ids (Gitar on #974)', async () => {
  const ids = await migrationRowIds('ws-1', rows);
  assert.equal(new Set(ids).size, rows.length);
  assert.match(ids[0], /^tx-qbo-[0-9a-f]{24}-0$/);
  const corrected = [...rows.slice(0, 50), row('2026-01-03', 'Late deposit', 500)];
  const after = await migrationRowIds('ws-1', corrected);
  assert.deepEqual(after.slice(0, 50), ids.slice(0, 50), 'the 50 saved rows keep their ids');
  assert.notEqual(after[50], ids[50]);
  const twins = await migrationRowIds('ws-1', [row('2026-01-02', 'Same'), row('2026-01-02', 'Same')]);
  assert.notEqual(twins[0], twins[1]);
  assert.notEqual((await migrationRowIds('ws-2', rows))[0], ids[0], 'another workspace, other ids');
});

test('a chunk key follows what the chunk sends', async () => {
  const chunk = [{ id: 'a', lines: [{ accountId: 'x', amountCents: 1 }] }];
  assert.equal(await contentKey(['ws', chunk]), await contentKey(['ws', JSON.parse(JSON.stringify(chunk))]));
  assert.notEqual(await contentKey(['ws', chunk]), await contentKey(['ws', [{ id: 'a', lines: [{ accountId: 'y', amountCents: 1 }] }]]), 'another mapping, another key');
});
