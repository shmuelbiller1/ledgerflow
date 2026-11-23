/**
 * Audit BR-02 and BR-05 (P1), server side:
 *
 * BR-02 — the completion endpoint must verify the accounting itself: the selected entries must be
 * cash movements in the account dated on or before the statement date, and the statement balance
 * must be the beginning balance plus exactly the money those entries moved. The audit's scenario:
 * a $100 May receipt plus an unrelated June expense/A/P journal with no bank leg, submitted against
 * a May 31 statement with a $0 ending balance. The server must refuse it.
 *
 * BR-05 — one entry clears one bank line. The audit's scenario: two distinct $100 deposit lines
 * matched to the same $100 entry in one batch. The server must refuse the second line.
 */
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { startAuditApp, cleanupAuditWorkspace, auditDbValid, type ChartAcc } from './helpers/auditTestApp';

const accounts: ChartAcc[] = [
  { key: 'bank', name: 'Cash', type: 'asset', category: 'Cash', role: 'cash' },
  { key: 'sales', name: 'Sales', type: 'revenue', category: 'Revenue' },
  { key: 'expense', name: 'Expense', type: 'expense', category: 'Expense' },
  { key: 'payable', name: 'Payables', type: 'liability', category: 'Payables' },
];

async function transactionRoutes(): Promise<Array<[string, unknown]>> {
  const { transactionRouter } = await import('../server/routes/transactionRoutes');
  return [['/api/v1/transactions', transactionRouter]];
}

describe('audit BR-02/BR-05: the server verifies a reconciliation itself', { skip: !auditDbValid && 'dedicated local audit database required' }, () => {
  test('BR-02: completion refuses an unrelated future entry with no bank leg and a wrong statement balance', async () => {
    const app = await startAuditApp('br02_refuse', accounts, await transactionRoutes());
    try {
      await app.db.collection('transactions').doc(app.id('receipt')).set({
        id: app.id('receipt'), workspaceId: app.ws, uid: 'audit-owner', date: '2026-05-01',
        description: 'receipt', status: 'completed', type: 'actual', currency: 'USD', totalAmountCents: 10000,
        lines: [{ accountId: app.id('bank'), amountCents: 10000 }, { accountId: app.id('sales'), amountCents: -10000 }],
      });
      await app.db.collection('transactions').doc(app.id('future')).set({
        id: app.id('future'), workspaceId: app.ws, uid: 'audit-owner', date: '2026-06-01',
        description: 'future', status: 'completed', type: 'actual', currency: 'USD', totalAmountCents: 2000,
        lines: [{ accountId: app.id('expense'), amountCents: 2000 }, { accountId: app.id('payable'), amountCents: -2000 }],
      });
      const res = await fetch(`${app.base}/api/v1/transactions/reconciliation/complete`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: app.ws, accountId: app.id('bank'), statementDate: '2026-05-31', statementBalanceCents: 0, reconciledTransactionIds: [app.id('receipt'), app.id('future')] }),
      });
      const body = await res.json();
      assert.equal(res.status, 400, `the server must refuse: ${JSON.stringify(body)}`);
      const recCount = (await app.db.collection('reconciliations').where('workspaceId', '==', app.ws).get()).size;
      assert.equal(recCount, 0, 'no reconciliation was recorded');
      const receipt = (await app.db.collection('transactions').doc(app.id('receipt')).get()).data()!;
      assert.notEqual(receipt.status, 'reconciled', 'the receipt was not cleared');
    } finally {
      await app.close();
      await cleanupAuditWorkspace(app.db, app.ws);
    }
  });

  test('BR-02: completion accepts a statement that agrees with the beginning balance and the selected cash legs', async () => {
    const app = await startAuditApp('br02_ok', [
      { key: 'bank', name: 'Cash', type: 'asset', category: 'Cash', role: 'cash' },
      { key: 'sales', name: 'Sales', type: 'revenue', category: 'Revenue' },
    ], await transactionRoutes());
    try {
      await app.db.collection('transactions').doc(app.id('receipt')).set({
        id: app.id('receipt'), workspaceId: app.ws, uid: 'audit-owner', date: '2026-05-01',
        description: 'receipt', status: 'completed', type: 'actual', currency: 'USD', totalAmountCents: 10000,
        lines: [{ accountId: app.id('bank'), amountCents: 10000 }, { accountId: app.id('sales'), amountCents: -10000 }],
      });
      const res = await fetch(`${app.base}/api/v1/transactions/reconciliation/complete`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: app.ws, accountId: app.id('bank'), statementDate: '2026-05-31', statementBalanceCents: 10000, reconciledTransactionIds: [app.id('receipt')] }),
      });
      const body = await res.json();
      assert.equal(res.status, 200, `a agreeing statement is accepted: ${JSON.stringify(body)}`);
      const receipt = (await app.db.collection('transactions').doc(app.id('receipt')).get()).data()!;
      assert.equal(receipt.status, 'reconciled');
      assert.equal(receipt.isCleared, true);
    } finally {
      await app.close();
      await cleanupAuditWorkspace(app.db, app.ws);
    }
  });

  test('BR-05: a second bank line cannot match the same entry in one batch', async () => {
    const app = await startAuditApp('br05', [
      { key: 'bank', name: 'Cash', type: 'asset', category: 'Cash', role: 'cash' },
      { key: 'sales', name: 'Sales', type: 'revenue', category: 'Revenue' },
    ], await transactionRoutes());
    try {
      for (const n of ['one', 'two']) {
        await app.db.collection('bankLines').doc(app.id(n)).set({
          workspaceId: app.ws, accountId: app.id('bank'), date: '2026-05-01',
          description: `deposit ${n}`, status: 'pending', amountCents: 10000, currency: 'USD',
        });
      }
      await app.db.collection('transactions').doc(app.id('entry')).set({
        id: app.id('entry'), workspaceId: app.ws, uid: 'audit-owner', date: '2026-05-01',
        description: 'deposit', status: 'completed', type: 'actual', currency: 'USD', exchangeRate: 1,
        totalAmountCents: 10000,
        lines: [{ accountId: app.id('bank'), amountCents: 10000 }, { accountId: app.id('sales'), amountCents: -10000 }],
      });
      const operations = [
        ...['one', 'two'].map(n => ({ type: 'updateBankLine', id: app.id(n), data: { status: 'matched', matchedTransactionId: app.id('entry') } })),
        { type: 'updateTransaction', id: app.id('entry'), data: { status: 'reconciled' } },
      ];
      const res = await fetch(`${app.base}/api/v1/transactions/reconcile`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: app.ws, operations }),
      });
      const body = await res.json();
      assert.equal(res.status, 400, `the double match is refused: ${JSON.stringify(body)}`);
      const lines = await Promise.all(['one', 'two'].map(async n => (await app.db.collection('bankLines').doc(app.id(n)).get()).data()!));
      const matched = lines.filter(l => l.status === 'matched');
      assert.ok(matched.length <= 1, `at most one line is matched: ${JSON.stringify(lines.map(l => l.status))}`);
    } finally {
      await app.close();
      await cleanupAuditWorkspace(app.db, app.ws);
    }
  });
});
