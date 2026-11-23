import test from 'node:test';
import assert from 'node:assert/strict';
import type { Firestore } from '../server/db/firestore';
import { listRecords, redactLiveReport } from '../server/services/sandboxTools';

test('live report redaction removes known sensitive keys recursively, not arbitrary text', () => {
  const result = redactLiveReport({ rows: [{ name: 'Vendor', bankDetails: { accountNumber: 'secret' }, contactTaxId: 'tax', BANK_ROUTING: 'routing', nested: { salaryCents: 123, safe: 'ok' } }], description: 'User-authored text is not classified' });
  assert.deepEqual(result, { rows: [{ name: 'Vendor', nested: { safe: 'ok' } }], description: 'User-authored text is not classified' });
});

test('live pagination never encodes a nested value as a cursor', async () => {
  const query = {
    where: () => query,
    orderBy: () => query,
    limit: () => query,
    get: async () => ({ docs: [
      { id: 'a', data: () => ({ workspaceId: 'w', name: { bankAccount: 'private' } }) },
      { id: 'b', data: () => ({ workspaceId: 'w', name: 'B' }) },
    ] }),
  };
  const db = { collection: () => query } as unknown as Firestore;
  await assert.rejects(listRecords(db, 'w', { collection: 'vendors', orderBy: { field: 'name' }, limit: 1 }, 'live-assistant'), /non-scalar/);
  await assert.rejects(listRecords(db, 'w', { collection: 'employees' }, 'live-assistant'), /Employee records are not available/);
  await assert.rejects(listRecords(db, 'w', { collection: 'vendors', fields: ['bankDetails'] }, 'live-assistant'), /field is not available/);
});
