import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChartAccount, Transaction } from '../types';
import type { Firestore } from '../server/db/firestore';
import { getLineDimension } from '../lib/dimensionUtils';
import { labelOpeningOf } from '../server/reports/reportOpening';
import {
  balancesAsOf, labelKinds, resetPeriodBalancesReadyForTests, snapshotFromEntries, sumEntries,
  type PeriodBalances,
} from '../server/services/balanceService';
import { makeChartAccount, makeTransaction } from './fixtures';

const specialKeys = ['__proto__', 'prototype', 'constructor'] as const;
const own = (obj: object, key: string) => Object.hasOwn(obj, key);
const asJson = <T>(data: T): T => JSON.parse(JSON.stringify(data)) as T;
const fields = (entries: Array<[string, string]>) => Object.fromEntries(entries) as Record<string, string>;
const accounts: ChartAccount[] = ['cash', ...specialKeys].map(id => makeChartAccount({ id, name: id, type: 'asset' }));

function entry(id: string, date: string, accountId: string, cents: number, dimensions: Record<string, string>): Transaction {
  return makeTransaction({
    id, workspaceId: 'ws-1', date, type: 'journal', totalAmountCents: Math.abs(cents),
    lines: [
      { accountId, amountCents: cents, dimensions },
      { accountId: 'cash', amountCents: -cents, dimensions },
    ],
  });
}

type Row = Record<string, unknown>;
type Filter = { field: string; op: string; value: unknown };
type Doc = { id: string; data: () => Row };
interface QueryLike {
  where(field: string, op: string, value: unknown): QueryLike;
  get(): Promise<{ docs: Doc[] }>;
}

function fakeDb(transactions: Transaction[], snapshots: PeriodBalances[]): Firestore {
  const rows: Record<string, Row[]> = {
    transactions: transactions as unknown as Row[],
    chartAccounts: accounts as unknown as Row[],
    periodBalances: snapshots as unknown as Row[],
  };
  const select = (name: string, filters: Filter[] = []): QueryLike => ({
    where: (field, op, value) => select(name, [...filters, { field, op, value }]),
    get: async () => ({
      docs: (rows[name] || []).filter(row => filters.every(({ field, op, value }) => {
        const actual = row[field];
        if (op === '==') return actual === value;
        if (op === '<') return String(actual) < String(value);
        if (op === '>=') return String(actual) >= String(value);
        throw new Error('Unexpected query filter: ' + op);
      })).map(row => ({ id: String(row.id || ''), data: () => row })),
    }),
  });
  return {
    tablesExist: async () => true,
    collection: (name: string) => ({ where: (field: string, op: string, value: unknown) =>
      select(name, [{ field, op, value }]) }),
  } as unknown as Firestore;
}

test('account IDs and label values resembling object internals keep all cents and line counts', () => {
  const before = Object.getOwnPropertyNames(Object.prototype).sort();
  const transactions = specialKeys.map((key, index) =>
    entry('tx-' + index, '2025-05-01', key, (index + 1) * 100, fields([['project', key]])));
  const sums = sumEntries(transactions, ['project']);
  assert.equal(Object.getPrototypeOf(sums.accounts), null);
  for (const [index, key] of specialKeys.entries()) {
    const amount = (index + 1) * 100;
    assert.ok(own(sums.accounts, key), 'account ID is retained: ' + key);
    assert.equal(sums.accounts[key], amount);
    assert.equal(sums.debits[key], amount);
    assert.equal(sums.lines[key], 1);
    assert.ok(own(sums.byLabel.project, key), 'label is retained: ' + key);
    assert.equal(sums.byLabel.project[key][key], amount);
    assert.equal(sums.byLabel.project[key].cash, -amount);
    assert.equal(sums.labelLines.project[key], 2);
  }
  assert.equal(sums.accounts.cash, -600);
  assert.equal(sums.credits.cash, 600);
  assert.equal(sums.lines.cash, 3);
  assert.equal(Object.values(sums.accounts).reduce((total, cents) => total + cents, 0), 0);
  assert.equal(asJson(sums).byLabel.project['__proto__']['__proto__'], 100);
  assert.deepEqual(Object.getOwnPropertyNames(Object.prototype).sort(), before, 'no prototype mutation');
});

test('dimension kinds with inherited names use only stored own dimensions', () => {
  const noDimension = entry('none', '2025-01-01', 'cash', 0, {});
  for (const key of specialKeys) {
    assert.equal(getLineDimension(noDimension.lines![0], noDimension, key), 'Unassigned');
  }
  const fromTransaction = makeTransaction({
    dimensions: fields([['constructor', 'from-workspace-record']]),
    lines: [{ accountId: 'cash', amountCents: 0, dimensions: {} }],
  });
  assert.equal(getLineDimension(fromTransaction.lines![0], fromTransaction, 'constructor'), 'from-workspace-record');
  assert.equal(getLineDimension(fromTransaction.lines![0], fromTransaction, '__proto__'), 'Unassigned');
});

test('year-end snapshot and live replay equal a full recompute, including new label kinds', async () => {
  const old = entry('old', '2025-06-01', '__proto__', 125, fields([
    ['project', 'constructor'], ['constructor', '__proto__'],
  ]));
  const recent = entry('recent', '2026-02-01', 'prototype', 275, fields([
    ['project', '__proto__'], ['prototype', 'constructor'], ['__proto__', 'prototype'],
  ]));
  const saved = snapshotFromEntries('ws-1', '2025-12-31', accounts, [old], 'tester');
  assert.ok(own(saved.byLabel, 'constructor'));
  assert.ok(own(saved.byLabel.constructor, '__proto__'));
  assert.equal(saved.byLabel.constructor['__proto__']['__proto__'], 125);
  assert.equal(saved.labelLines.constructor['__proto__'], 2);
  assert.ok(labelKinds([recent]).has('__proto__'));
  const dbSnapshot = fakeDb([old, recent], [asJson(saved)]);
  const dbRecompute = fakeDb([old, recent], []);
  resetPeriodBalancesReadyForTests();
  try {
    const fromSnapshot = await balancesAsOf(dbSnapshot, 'ws-1', '2026-03-31', { byLabel: true });
    const fromHistory = await balancesAsOf(dbRecompute, 'ws-1', '2026-03-31', { byLabel: true });
    assert.equal(fromSnapshot.snapshot?.asOf, '2025-12-31');
    assert.equal(fromHistory.snapshot, null);
    for (const property of ['accounts', 'debits', 'credits', 'lines', 'byLabel', 'labelLines'] as const) {
      assert.deepEqual(asJson(fromSnapshot[property]), asJson(fromHistory[property]), 'snapshot parity: ' + property);
    }
    assert.equal(fromSnapshot.accounts['__proto__'], 125);
    assert.equal(fromSnapshot.accounts.prototype, 275);
    assert.equal(fromSnapshot.accounts.cash, -400);
    assert.equal(fromSnapshot.byLabel?.project?.constructor?.['__proto__'], 125);
    assert.equal(fromSnapshot.byLabel?.project?.['__proto__']?.prototype, 275);
    assert.equal(fromSnapshot.byLabel?.['__proto__']?.Unassigned?.['__proto__'], 125);
    assert.equal(fromSnapshot.byLabel?.['__proto__']?.prototype?.prototype, 275);
    assert.equal(fromSnapshot.labelLines?.['__proto__']?.Unassigned, 2);
    assert.equal(fromSnapshot.labelLines?.['__proto__']?.prototype, 2);

    const specialOpening = labelOpeningOf(fromSnapshot, '__proto__', 'prototype');
    assert.equal(specialOpening.value.prototype, 275);
    assert.equal(specialOpening.notLabelled['__proto__'], 125);
    const missingKind = labelOpeningOf(fromSnapshot, 'toString', 'constructor');
    assert.deepEqual(asJson(missingKind.notLabelled), asJson(fromSnapshot.accounts));
    assert.deepEqual(missingKind.value, {}, 'inherited property is not an actual label');
    const missingValue = labelOpeningOf(fromSnapshot, 'project', 'toString');
    assert.deepEqual(missingValue.value, {}, 'inherited value is not an actual label');
  } finally {
    resetPeriodBalancesReadyForTests();
  }
});
