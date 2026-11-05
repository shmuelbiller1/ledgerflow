import type { TestDocument, TestDocumentReference, TestTransaction, TestResponseBody } from './helpers/mockTypes';
import type { TransactionLine } from '../types';
import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import type express from 'express';
import type { Firestore } from '../server/db/firestore';
import { createPaymentAtomic } from '../server/services/paymentService';
import { handleCreatePayment } from '../server/routes/paymentRoutes';

class MockTransactionalDb {
  public data: Map<string, TestDocument> = new Map();

  collection(collName: string) {
    return {
      doc: (docId?: string) => {
        const id = docId || `id_${Math.random().toString(36).substring(2, 9)}`;
        const key = `${collName}/${id}`;
        return {
          id,
          key,
          db: this
        };
      }
    };
  }

  async runTransaction<T>(updateFunction: (tx: TestTransaction) => Promise<T>): Promise<T> {
    // Snapshot current state
    const snapshotMap = new Map<string, TestDocument>();
    for (const [k, v] of this.data.entries()) {
      snapshotMap.set(k, JSON.parse(JSON.stringify(v)));
    }

    const tx = {
      get: async (docRef: TestDocumentReference) => {
        const val = snapshotMap.get(docRef.key);
        return {
          exists: val !== undefined,
          data: () => val ? JSON.parse(JSON.stringify(val)) : undefined
        };
      },
      update: (docRef: TestDocumentReference, updates: TestDocument) => {
        const current = snapshotMap.get(docRef.key) || {};
        const updated = { ...current, ...updates };
        snapshotMap.set(docRef.key, updated);
      },
      set: (docRef: TestDocumentReference, newData: TestDocument) => {
        snapshotMap.set(docRef.key, newData);
      }
    };

    const res = await updateFunction(tx);
    // If transaction succeeded, commit state to DB
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

describe('Payment Creation & Ledger Posting Atomicity Test Suite (Task 4)', () => {
  test('If payment is attempted in closed period (locked date), transaction aborts: invoice amountPaidCents remains 0 and no payment record is created', async () => {
    const db = new MockTransactionalDb();

    // Setup Workspace with lockDate = '2026-08-31'
    db.data.set('workspaces/ws-1', {
      id: 'ws-1',
      uid: 'user-1',
      lockDate: '2026-08-31'
    });

    // Setup Accounts
    db.data.set('chartAccounts/acc-cash', { id: 'acc-cash', name: 'Cash', workspaceId: 'ws-1' });
    db.data.set('chartAccounts/acc-ar', { id: 'acc-ar', name: 'AR', workspaceId: 'ws-1' });

    // Setup Invoice with total 10000 cents, 0 paid
    db.data.set('invoices/inv-100', {
      id: 'inv-100',
      workspaceId: 'ws-1',
      amountCents: 10000,
      amountPaidCents: 0,
      status: 'pending'
    });

    // Attempt payment on 2026-08-15 (inside closed period!)
    await assert.rejects(async () => {
      await createPaymentAtomic(db, {
        workspaceId: 'ws-1',
        uid: 'user-1',
        paymentDate: '2026-08-15',
        amountCents: 10000,
        cashAccountId: 'acc-cash',
        offsetAccountId: 'acc-ar',
        allocations: [{ documentId: 'inv-100', documentType: 'invoice', amountCents: 10000 }]
      });
    }, /locked/i);

    // Assert: Invoice amountPaidCents MUST be unchanged (0)
    const inv = db.getDocData('invoices', 'inv-100');
    assert.equal(inv.amountPaidCents, 0, 'Invoice amountPaidCents must remain 0 after aborted payment');
    assert.equal(inv.status, 'pending', 'Invoice status must remain unchanged after aborted payment');

    // Assert: payments collection MUST contain 0 records
    const payments = db.getCollectionDocs('payments');
    assert.equal(payments.length, 0, 'Payments collection must contain no records after aborted payment');

    // Assert: transactions collection MUST contain 0 records
    const transactions = db.getCollectionDocs('transactions');
    assert.equal(transactions.length, 0, 'Transactions collection must contain no records after aborted payment');
  });

  test('If ledger posting fails due to invalid cash account ID, transaction aborts: invoice amountPaidCents remains 0 and no payment record is created', async () => {
    const db = new MockTransactionalDb();

    // Setup Workspace
    db.data.set('workspaces/ws-1', { id: 'ws-1', uid: 'user-1' });

    // Setup Invoice with total 5000 cents, 0 paid
    db.data.set('invoices/inv-200', {
      id: 'inv-200',
      workspaceId: 'ws-1',
      amountCents: 5000,
      amountPaidCents: 0,
      status: 'pending'
    });

    // Attempt payment with non-existent cash account ID 'non-existent-cash'
    await assert.rejects(async () => {
      await createPaymentAtomic(db, {
        workspaceId: 'ws-1',
        uid: 'user-1',
        paymentDate: '2026-09-15',
        amountCents: 5000,
        cashAccountId: 'non-existent-cash',
        allocations: [{ documentId: 'inv-200', documentType: 'invoice', amountCents: 5000 }]
      });
    }, /invalid cash account/i);

    // Assert: Invoice amountPaidCents MUST be unchanged (0)
    const inv = db.getDocData('invoices', 'inv-200');
    assert.equal(inv.amountPaidCents, 0, 'Invoice amountPaidCents must remain 0 after aborted payment');

    // Assert: payments collection MUST contain 0 records
    const payments = db.getCollectionDocs('payments');
    assert.equal(payments.length, 0, 'Payments collection must contain no records after aborted payment');
  });

  test('Valid payment atomically updates invoice amountPaidCents, creates payment document, and posts balanced general ledger transaction', async () => {
    const db = new MockTransactionalDb();

    db.data.set('workspaces/ws-1', { id: 'ws-1', uid: 'user-1' });
    db.data.set('chartAccounts/acc-cash', { id: 'acc-cash', name: 'Cash', workspaceId: 'ws-1' });
    db.data.set('chartAccounts/acc-ar', { id: 'acc-ar', name: 'AR', workspaceId: 'ws-1' });

    db.data.set('invoices/inv-300', {
      id: 'inv-300',
      workspaceId: 'ws-1',
      amountCents: 10000,
      amountPaidCents: 0,
      status: 'pending'
    });

    const result = await createPaymentAtomic(db, {
      workspaceId: 'ws-1',
      uid: 'user-1',
      paymentDate: '2026-09-15',
      amountCents: 10000,
      cashAccountId: 'acc-cash',
      offsetAccountId: 'acc-ar',
      allocations: [{ documentId: 'inv-300', documentType: 'invoice', amountCents: 10000 }]
    });

    // Assert: Invoice updated atomically
    const inv = db.getDocData('invoices', 'inv-300');
    assert.equal(inv.amountPaidCents, 10000);
    assert.equal(inv.status, 'paid');

    // Assert: Payment created
    const payment = db.getDocData('payments', result.paymentId);
    assert.ok(payment);
    assert.equal(payment.amountCents, 10000);

    // Assert: Ledger transaction created with balanced debit/credit
    const txDoc = db.getDocData('transactions', result.transactionId);
    assert.ok(txDoc);
    assert.equal(txDoc.totalAmountCents, 10000);
    assert.equal(txDoc.lines.length, 2);

    const debitLine = txDoc.lines.find((l: TransactionLine) => l.accountId === 'acc-cash');
    const creditLine = txDoc.lines.find((l: TransactionLine) => l.accountId === 'acc-ar');

    assert.equal(debitLine.amountCents, 10000, 'Cash account must be debited 10,000 cents');
    assert.equal(creditLine.amountCents, -10000, 'A/R account must be credited -10,000 cents');
  });

  test('Cross-workspace isolation: rejects payment if target invoice belongs to another workspace', async () => {
    const db = new MockTransactionalDb();

    db.data.set('workspaces/ws-victim', { id: 'ws-victim' });
    db.data.set('workspaces/ws-attacker', { id: 'ws-attacker', uid: 'attacker-1' });
    db.data.set('chartAccounts/acc-cash', { id: 'acc-cash', workspaceId: 'ws-attacker' });
    db.data.set('chartAccounts/acc-ar', { id: 'acc-ar', workspaceId: 'ws-attacker' });

    db.data.set('invoices/inv-victim-1', {
      id: 'inv-victim-1',
      workspaceId: 'ws-victim',
      amountCents: 10000,
      amountPaidCents: 0,
      status: 'pending'
    });

    await assert.rejects(async () => {
      await createPaymentAtomic(db, {
        workspaceId: 'ws-attacker',
        uid: 'attacker-1',
        paymentDate: '2026-09-15',
        amountCents: 10000,
        cashAccountId: 'acc-cash',
        offsetAccountId: 'acc-ar',
        allocations: [{ documentId: 'inv-victim-1', documentType: 'invoice', amountCents: 10000 }]
      });
    }, /not found/i);

    const inv = db.getDocData('invoices', 'inv-victim-1');
    assert.equal(inv.amountPaidCents, 0, 'Victim invoice must remain untouched');
  });

  test('Overpayment prevention: rejects allocation exceeding remaining document balance', async () => {
    const db = new MockTransactionalDb();

    db.data.set('workspaces/ws-1', { id: 'ws-1', uid: 'user-1' });
    db.data.set('chartAccounts/acc-cash', { id: 'acc-cash', workspaceId: 'ws-1' });
    db.data.set('chartAccounts/acc-ar', { id: 'acc-ar', workspaceId: 'ws-1' });

    db.data.set('invoices/inv-partial', {
      id: 'inv-partial',
      workspaceId: 'ws-1',
      amountCents: 10000,
      amountPaidCents: 6000,
      status: 'partially_paid'
    });

    await assert.rejects(async () => {
      await createPaymentAtomic(db, {
        workspaceId: 'ws-1',
        uid: 'user-1',
        paymentDate: '2026-09-15',
        amountCents: 5000,
        cashAccountId: 'acc-cash',
        offsetAccountId: 'acc-ar',
        allocations: [{ documentId: 'inv-partial', documentType: 'invoice', amountCents: 5000 }]
      });
    }, /overpayment not allowed/i);
  });

  test('Deposit (AF-03): paying what the deposit left marks the invoice paid; paying more is refused', async () => {
    const db = new MockTransactionalDb();
    db.data.set('workspaces/ws-1', { id: 'ws-1', uid: 'user-1' });
    db.data.set('chartAccounts/acc-cash', { id: 'acc-cash', workspaceId: 'ws-1' });
    db.data.set('chartAccounts/acc-ar', { id: 'acc-ar', workspaceId: 'ws-1' });
    db.data.set('invoices/inv-dep', { id: 'inv-dep', workspaceId: 'ws-1', amountCents: 12000, depositCents: 3000, amountPaidCents: 0, status: 'pending' });
    const pay = (amountCents: number) => createPaymentAtomic(db, {
      workspaceId: 'ws-1', uid: 'user-1', paymentDate: '2026-09-15', amountCents,
      cashAccountId: 'acc-cash', offsetAccountId: 'acc-ar',
      allocations: [{ documentId: 'inv-dep', documentType: 'invoice', amountCents }],
    });

    await assert.rejects(() => pay(12000), /overpayment not allowed/i);
    await pay(9000);
    const inv = db.getDocData('invoices', 'inv-dep');
    assert.equal(inv.amountPaidCents, 9000);
    assert.equal(inv.status, 'paid');
  });

  test('Rejects payment if cash account belongs to another workspace', async () => {
    const db = new MockTransactionalDb();
    db.data.set('workspaces/ws-1', { id: 'ws-1', uid: 'user-1' });
    db.data.set('chartAccounts/acc-cash-other', { id: 'acc-cash-other', workspaceId: 'ws-other' });
    db.data.set('chartAccounts/acc-ar', { id: 'acc-ar', workspaceId: 'ws-1' });
    db.data.set('invoices/inv-1', { id: 'inv-1', workspaceId: 'ws-1', amountCents: 10000, amountPaidCents: 0, status: 'pending' });

    await assert.rejects(async () => {
      await createPaymentAtomic(db, {
        workspaceId: 'ws-1',
        uid: 'user-1',
        paymentDate: '2026-09-15',
        amountCents: 10000,
        cashAccountId: 'acc-cash-other',
        offsetAccountId: 'acc-ar',
        allocations: [{ documentId: 'inv-1', documentType: 'invoice', amountCents: 10000 }]
      });
    }, /invalid cash account/i);
  });

  test('Rejects payment if invoice has no workspaceId', async () => {
    const db = new MockTransactionalDb();
    db.data.set('workspaces/ws-1', { id: 'ws-1', uid: 'user-1' });
    db.data.set('chartAccounts/acc-cash', { id: 'acc-cash', workspaceId: 'ws-1' });
    db.data.set('chartAccounts/acc-ar', { id: 'acc-ar', workspaceId: 'ws-1' });
    db.data.set('invoices/inv-no-ws', { id: 'inv-no-ws', amountCents: 10000, amountPaidCents: 0, status: 'pending' });

    await assert.rejects(async () => {
      await createPaymentAtomic(db, {
        workspaceId: 'ws-1',
        uid: 'user-1',
        paymentDate: '2026-09-15',
        amountCents: 10000,
        cashAccountId: 'acc-cash',
        offsetAccountId: 'acc-ar',
        allocations: [{ documentId: 'inv-no-ws', documentType: 'invoice', amountCents: 10000 }]
      });
    }, /not found/i);
  });

  test('Rejects payment against a void or draft document', async () => {
    const db = new MockTransactionalDb();
    db.data.set('workspaces/ws-1', { id: 'ws-1', uid: 'user-1' });
    db.data.set('chartAccounts/acc-cash', { id: 'acc-cash', workspaceId: 'ws-1' });
    db.data.set('chartAccounts/acc-ar', { id: 'acc-ar', workspaceId: 'ws-1' });
    db.data.set('invoices/inv-void', { id: 'inv-void', workspaceId: 'ws-1', amountCents: 10000, amountPaidCents: 0, status: 'void' });

    await assert.rejects(async () => {
      await createPaymentAtomic(db, {
        workspaceId: 'ws-1',
        uid: 'user-1',
        paymentDate: '2026-09-15',
        amountCents: 10000,
        cashAccountId: 'acc-cash',
        offsetAccountId: 'acc-ar',
        allocations: [{ documentId: 'inv-void', documentType: 'invoice', amountCents: 10000 }]
      });
    }, /void/i);
  });

  test('Rejects payment with duplicate invoice allocations', async () => {
    const db = new MockTransactionalDb();
    db.data.set('workspaces/ws-1', { id: 'ws-1', uid: 'user-1' });
    db.data.set('chartAccounts/acc-cash', { id: 'acc-cash', workspaceId: 'ws-1' });
    db.data.set('chartAccounts/acc-ar', { id: 'acc-ar', workspaceId: 'ws-1' });
    db.data.set('invoices/inv-1', { id: 'inv-1', workspaceId: 'ws-1', amountCents: 10000, amountPaidCents: 0, status: 'pending' });

    await assert.rejects(async () => {
      await createPaymentAtomic(db, {
        workspaceId: 'ws-1',
        uid: 'user-1',
        paymentDate: '2026-09-15',
        amountCents: 10000,
        cashAccountId: 'acc-cash',
        offsetAccountId: 'acc-ar',
        allocations: [
          { documentId: 'inv-1', documentType: 'invoice', amountCents: 5000 },
          { documentId: 'inv-1', documentType: 'invoice', amountCents: 5000 }
        ]
      });
    }, /only once/i);
  });

  test('Rejects payment when allocations exceed payment amount', async () => {
    const db = new MockTransactionalDb();
    db.data.set('workspaces/ws-1', { id: 'ws-1', uid: 'user-1' });
    db.data.set('chartAccounts/acc-cash', { id: 'acc-cash', workspaceId: 'ws-1' });
    db.data.set('chartAccounts/acc-ar', { id: 'acc-ar', workspaceId: 'ws-1' });
    db.data.set('invoices/inv-1', { id: 'inv-1', workspaceId: 'ws-1', amountCents: 10000, amountPaidCents: 0, status: 'pending' });
    db.data.set('invoices/inv-2', { id: 'inv-2', workspaceId: 'ws-1', amountCents: 10000, amountPaidCents: 0, status: 'pending' });

    await assert.rejects(async () => {
      await createPaymentAtomic(db, {
        workspaceId: 'ws-1',
        uid: 'user-1',
        paymentDate: '2026-09-15',
        amountCents: 10000,
        cashAccountId: 'acc-cash',
        offsetAccountId: 'acc-ar',
        allocations: [
          { documentId: 'inv-1', documentType: 'invoice', amountCents: 6000 },
          { documentId: 'inv-2', documentType: 'invoice', amountCents: 5000 }
        ]
      });
    }, /exceeds payment amount/i);
  });

  test('Viewer role receives 403 and cannot create payments', async () => {
    const db = {
      collection: (coll: string) => ({
        doc: (id: string) => ({
          get: async () => {
            if (coll === 'workspaces' && id === 'ws-viewer-test') {
              return {
                exists: true,
                data: () => ({
                  id: 'ws-viewer-test',
                  members: ['user-viewer'],
                  roles: { 'user-viewer': 'viewer' }
                })
              };
            }
            return { exists: false, data: () => undefined };
          }
        })
      })
    } as unknown as Firestore;

    let statusCode = 200;
    let jsonBody: TestResponseBody | null = null;
    const req = {
      user: { uid: 'user-viewer' },
      body: {
        workspaceId: 'ws-viewer-test',
        amountCents: 5000,
        paymentDate: '2026-09-15',
        cashAccountId: 'acc-cash',
        allocations: []
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

    await handleCreatePayment(req, res, db);
    assert.equal(statusCode, 403);
    assert.ok((jsonBody as unknown as TestResponseBody)?.message?.includes('Forbidden'));
  });

  test('Unauthenticated request (no user) receives 401', async () => {
    let statusCode = 200;
    let jsonBody: TestResponseBody | null = null;
    const req = {
      body: {
        workspaceId: 'ws-test',
        amountCents: 5000,
        cashAccountId: 'acc-cash'
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

    await handleCreatePayment(req, res);
    assert.equal(statusCode, 401);
    assert.equal((jsonBody as unknown as TestResponseBody)?.message, 'Sign in required');
  });
});


