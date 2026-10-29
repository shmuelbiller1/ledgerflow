import type { TestDocument, TestDocumentReference, TestResponseBody } from './helpers/mockTypes';
import type { AuditLog } from '../types';
import type { TestReconcileTransaction } from './helpers/mockTypes';
import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import type express from 'express';
import type { Firestore } from '../server/db/firestore';
import { handleReconcile } from '../server/routes/transactionRoutes';

class MockDb {
  public data: Map<string, TestDocument> = new Map();

  collection(collName: string) {
    return {
      doc: (docId?: string) => {
        const id = docId || `id_${Math.random().toString(36).substring(2, 9)}`;
        const key = `${collName}/${id}`;
        return {
          id,
          key,
          get: async () => {
            const val = this.data.get(key);
            return {
              exists: val !== undefined,
              id,
              data: () => val ? JSON.parse(JSON.stringify(val)) : undefined
            };
          }
        };
      }
    };
  }

  async runTransaction<T>(updateFunction: (tx: TestReconcileTransaction) => Promise<T>): Promise<T> {
    const snapshotMap = new Map<string, TestDocument>();
    for (const [k, v] of this.data.entries()) {
      snapshotMap.set(k, JSON.parse(JSON.stringify(v)));
    }

    const tx = {
      get: async (docRef: TestDocumentReference) => {
        const val = snapshotMap.get(docRef.key);
        return {
          exists: val !== undefined,
          id: docRef.id,
          data: () => val ? JSON.parse(JSON.stringify(val)) : undefined
        };
      },
      update: (docRef: TestDocumentReference, updates: TestDocument) => {
        const current = snapshotMap.get(docRef.key) || {};
        const updated = { ...current, ...updates };
        snapshotMap.set(docRef.key, updated);
      },
      create: (docRef: TestDocumentReference, newData: TestDocument) => {
        snapshotMap.set(docRef.key, newData);
      },
      set: (docRef: TestDocumentReference, newData: TestDocument) => {
        snapshotMap.set(docRef.key, newData);
      },
      getAll: async (...docRefs: TestDocumentReference[]) => {
        return docRefs.map(ref => {
          const val = snapshotMap.get(ref.key);
          return {
            exists: val !== undefined,
            id: ref.id,
            data: () => val ? JSON.parse(JSON.stringify(val)) : undefined
          };
        });
      }
    };

    const res = await updateFunction(tx);
    for (const [k, v] of snapshotMap.entries()) {
      this.data.set(k, v);
    }
    return res;
  }

  getDocData(collName: string, docId: string) {
    const val = this.data.get(`${collName}/${docId}`);
    return val ? JSON.parse(JSON.stringify(val)) : undefined;
  }

  getCollectionDocs(collName: string) {
    const docs: TestDocument[] = [];
    const prefix = `${collName}/`;
    for (const [k, v] of this.data.entries()) {
      if (k.startsWith(prefix)) {
        docs.push(JSON.parse(JSON.stringify(v)));
      }
    }
    return docs;
  }
}

describe('Reconcile Endpoint Test Suite (Part 2d)', () => {
  test('Viewer role receives 403', async () => {
    const db = new MockDb();
    db.data.set('workspaces/ws-1', {
      id: 'ws-1',
      members: ['user-viewer'],
      roles: { 'user-viewer': 'viewer' }
    });

    let statusCode = 200;
    let jsonBody: TestResponseBody | null = null;

    const req = {
      user: { uid: 'user-viewer' },
      body: {
        workspaceId: 'ws-1',
        operations: [{ id: 'line-1', type: 'updateBankLine', data: { status: 'matched' } }]
      }
    } as unknown as express.Request;

    const res: express.Response = {
      status: (code: number) => {
        statusCode = code;
        return res;
      },
      json: (data: TestResponseBody) => {
        jsonBody = data;
        return res;
      }
    } as unknown as express.Response;

    await handleReconcile(req, res, db as unknown as Firestore);
    assert.equal(statusCode, 403);
    assert.ok((jsonBody as unknown as TestResponseBody)?.error?.includes('Forbidden'));
  });

  test('Bank line dated on or before lockDate returns 400 and writes nothing', async () => {
    const db = new MockDb();
    db.data.set('workspaces/ws-1', {
      id: 'ws-1',
      lockDate: '2026-08-31',
      roles: { 'user-owner': 'owner' }
    });
    db.data.set('bankLines/line-locked', {
      id: 'line-locked',
      workspaceId: 'ws-1',
      date: '2026-08-15',
      status: 'pending'
    });

    let statusCode = 200;
    let jsonBody: TestResponseBody | null = null;

    const req = {
      user: { uid: 'user-owner' },
      body: {
        workspaceId: 'ws-1',
        operations: [{ id: 'line-locked', type: 'updateBankLine', data: { status: 'matched' } }]
      }
    } as unknown as express.Request;

    const res: express.Response = {
      status: (code: number) => {
        statusCode = code;
        return res;
      },
      json: (data: TestResponseBody) => {
        jsonBody = data;
        return res;
      }
    } as unknown as express.Response;

    await handleReconcile(req, res, db as unknown as Firestore);
    assert.equal(statusCode, 400);
    assert.ok((jsonBody as unknown as TestResponseBody)?.error?.includes('Period Locked'));

    const line = db.getDocData('bankLines', 'line-locked');
    assert.equal(line.status, 'pending', 'Bank line status must remain unchanged after aborted reconciliation');
  });

  test('AF-001: a bank line in another currency is not matched as home-currency money', async () => {
    const db = new MockDb();
    db.data.set('workspaces/ws-1', { id: 'ws-1', currency: 'USD', roles: { 'user-owner': 'owner' } });
    db.data.set('bankLines/line-eur', { id: 'line-eur', workspaceId: 'ws-1', date: '2026-10-20', status: 'pending', amountCents: -1050, currency: 'EUR' });
    db.data.set('bankLines/line-usd', { id: 'line-usd', workspaceId: 'ws-1', date: '2026-10-20', status: 'pending', amountCents: -1050, currency: 'USD' });
    const run = async (id: string) => {
      let statusCode = 200;
      let jsonBody: TestResponseBody | null = null;
      const req = { user: { uid: 'user-owner' }, body: { workspaceId: 'ws-1', operations: [{ id, type: 'updateBankLine', data: { status: 'matched' } }] } } as unknown as express.Request;
      const res: express.Response = {
        status: (code: number) => { statusCode = code; return res; },
        json: (data: TestResponseBody) => { jsonBody = data; return res; },
      } as unknown as express.Response;
      await handleReconcile(req, res, db as unknown as Firestore);
      return { statusCode, jsonBody: jsonBody as TestResponseBody | null };
    };
    const refused = await run('line-eur');
    assert.equal(refused.statusCode, 400);
    assert.match(String(refused.jsonBody?.error), /in EUR, not USD/);
    assert.equal(db.getDocData('bankLines', 'line-eur').status, 'pending', 'nothing written');
    assert.equal((await run('line-usd')).statusCode, 200, 'a line in the books\' currency still matches');
    assert.equal(db.getDocData('bankLines', 'line-usd').status, 'matched');
  });

  test('Undo sets bank line back to pending and transaction back to completed with audit log', async () => {
    const db = new MockDb();
    db.data.set('workspaces/ws-1', {
      id: 'ws-1',
      roles: { 'user-owner': 'owner' }
    });
    db.data.set('chartAccounts/acc-1', { id: 'acc-1', workspaceId: 'ws-1', name: 'Cash', type: 'asset' });
    db.data.set('chartAccounts/acc-2', { id: 'acc-2', workspaceId: 'ws-1', name: 'Revenue', type: 'revenue' });

    db.data.set('bankLines/line-matched', {
      id: 'line-matched',
      workspaceId: 'ws-1',
      date: '2026-09-15',
      status: 'matched',
      matchedTransactionId: 'tx-matched'
    });

    db.data.set('transactions/tx-matched', {
      id: 'tx-matched',
      workspaceId: 'ws-1',
      uid: 'user-owner',
      date: '2026-09-15',
      description: 'Matched sale',
      totalAmountCents: 10000,
      currency: 'USD',
      type: 'actual',
      status: 'reconciled',
      lines: [
        { accountId: 'acc-1', amountCents: 10000 },
        { accountId: 'acc-2', amountCents: -10000 }
      ]
    });

    let statusCode = 200;
    let jsonBody: TestResponseBody | null = null;

    const req = {
      user: { uid: 'user-owner', email: 'owner@example.com' },
      body: {
        workspaceId: 'ws-1',
        operations: [
          { id: 'line-matched', type: 'updateBankLine', data: { status: 'pending', matchedTransactionId: null } },
          { id: 'tx-matched', type: 'updateTransaction', data: { status: 'completed' } }
        ]
      }
    } as unknown as express.Request;

    const res: express.Response = {
      status: (code: number) => {
        statusCode = code;
        return res;
      },
      json: (data: TestResponseBody) => {
        jsonBody = data;
        return res;
      }
    } as unknown as express.Response;

    await handleReconcile(req, res, db as unknown as Firestore);
    assert.equal(statusCode, 200);
    assert.equal((jsonBody as unknown as TestResponseBody)?.status, 'ok');

    const line = db.getDocData('bankLines', 'line-matched');
    assert.equal(line.status, 'pending');
    assert.equal(line.matchedTransactionId, null);

    const tx = db.getDocData('transactions', 'tx-matched');
    assert.equal(tx.status, 'completed');

    const auditLogs = db.getCollectionDocs('auditLogs') as unknown as AuditLog[];
    assert.equal(auditLogs.length, 1);
    assert.equal(auditLogs[0].action, 'reconcile');
    assert.ok(auditLogs[0].details?.description?.includes('executed reconciliation batch'));
    assert.ok(!isNaN(new Date(auditLogs[0].timestamp).getTime()));
  });
});
