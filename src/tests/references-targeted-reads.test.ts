import test from 'node:test';
import assert from 'node:assert/strict';
import { referencesOver } from '../server/services/balanceService';
import { computeTransactionsByReference } from '../server/reports/referenceReport';
import type { Firestore } from '../server/db/pgFirestore';
import type { Transaction } from '../types';
import { entries, from, to } from './helpers/l123RangeLedger';

test('reference documents are deduplicated, chunked, scoped and limited to referenced IDs', async () => {
  const transactions = Array.from({ length: 102 }, (_, i) => ({ ...entries('ws')[0], id: `tx${i}`, metadata: { invoiceId: `i${i}`, billId: `b${i}` } }));
  transactions.push({ ...transactions[0], id: 'duplicate' });
  const documents = ['invoices', 'bills'].flatMap(collection => Array.from({ length: 103 }, (_, i) => ({ collection, id: `${collection === 'invoices' ? 'i' : 'b'}${i}`, workspaceId: i === 101 ? 'other' : 'ws', number: i === 0 ? 123 : `N${i}` })));
  const reads: { collection: string; ids: string[] }[] = [];
  const db = { collection(collection: string) {
    const filters: [string, string, unknown][] = [];
    return { where(field: string, op: string, value: unknown) { filters.push([field, op, value]); return this; }, async get() {
      if (collection === 'chartAccounts') return { docs: [] };
      if (collection === 'transactions') return { docs: transactions.map(t => ({ id: t.id, data: () => t })) };
      assert.deepEqual(filters[0], ['workspaceId', '==', 'ws']);
      assert.equal(filters[1][0], '__name__');
      assert.equal(filters[1][1], 'in');
      const ids = filters[1][2] as string[];
      reads.push({ collection, ids });
      return { docs: documents.filter(d => d.collection === collection && d.workspaceId === 'ws' && ids.includes(d.id)).map(d => ({ id: d.id, data: () => d })) };
    } };
  } } as unknown as Firestore;
  const result = await referencesOver(db, 'ws', from, to);
  for (const collection of ['invoices', 'bills']) {
    const chunks = reads.filter(r => r.collection === collection);
    assert.deepEqual(chunks.map(r => r.ids.length), [100, 2]);
    assert.equal(new Set(chunks.flatMap(r => r.ids)).size, 102);
  }
  const numbered = (collection: string) => documents.filter(d => d.collection === collection && d.workspaceId === 'ws').map(d => ({ id: d.id, number: String(d.number) }));
  assert.deepEqual(result.references, computeTransactionsByReference(transactions as Transaction[], { invoices: numbered('invoices'), bills: numbered('bills') }, from, to));
  assert.equal(result.references.withoutReference, 1);
  assert.equal(result.entriesRead, 103);
  assert.ok(!reads.some(r => r.ids.some(id => id.endsWith('102'))));
});

test('empty reference lists skip both document collections', async () => {
  const db = { collection(collection: string) {
    assert.ok(['transactions', 'chartAccounts'].includes(collection));
    return { where() { return this; }, async get() { return { docs: [] }; } };
  } } as unknown as Firestore;
  assert.deepEqual(await referencesOver(db, 'ws', from, to), { references: { rows: [], referenceCount: 0, withoutReference: 0 }, entriesRead: 0 });
});
