import type { TestResponseBody } from './helpers/mockTypes';
import { MockTransactionalDb } from './helpers/mockTransactionalDb';
import { recordingResponse } from './helpers/recordingResponse';
import type { AuditLog } from '../types';
import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import type express from 'express';
import type { Firestore } from '../server/db/firestore';
import { handleReconcile } from '../server/routes/transactionRoutes';


describe('Reconcile Endpoint Test Suite (Part 2d)', () => {
  test('Viewer role receives 403', async () => {
    const db = new MockTransactionalDb();
    db.data.set('workspaces/ws-1', {
      id: 'ws-1',
      members: ['user-viewer'],
      roles: { 'user-viewer': 'viewer' }
    });

    const answer = recordingResponse();

    const req = {
      user: { uid: 'user-viewer' },
      body: {
        workspaceId: 'ws-1',
        operations: [{ id: 'line-1', type: 'updateBankLine', data: { status: 'matched' } }]
      }
    } as unknown as express.Request;

    const res = answer.res;

    await handleReconcile(req, res, db as unknown as Firestore);
    assert.equal(answer.statusCode, 403);
    assert.ok((answer.body as unknown as TestResponseBody)?.error?.includes('Forbidden'));
  });

  test('Bank line dated on or before lockDate returns 400 and writes nothing', async () => {
    const db = new MockTransactionalDb();
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

    const answer = recordingResponse();

    const req = {
      user: { uid: 'user-owner' },
      body: {
        workspaceId: 'ws-1',
        operations: [{ id: 'line-locked', type: 'updateBankLine', data: { status: 'matched' } }]
      }
    } as unknown as express.Request;

    const res = answer.res;

    await handleReconcile(req, res, db as unknown as Firestore);
    assert.equal(answer.statusCode, 400);
    assert.ok((answer.body as unknown as TestResponseBody)?.error?.includes('Period Locked'));

    const line = db.getDocData('bankLines', 'line-locked');
    assert.equal(line.status, 'pending', 'Bank line status must remain unchanged after aborted reconciliation');
  });

  test('AF-001: a bank line in another currency is not matched as home-currency money', async () => {
    const db = new MockTransactionalDb();
    db.data.set('workspaces/ws-1', { id: 'ws-1', currency: 'USD', roles: { 'user-owner': 'owner' } });
    db.data.set('bankLines/line-eur', { id: 'line-eur', workspaceId: 'ws-1', date: '2026-10-20', status: 'pending', amountCents: -1050, currency: 'EUR' });
    db.data.set('bankLines/line-usd', { id: 'line-usd', workspaceId: 'ws-1', date: '2026-10-20', status: 'pending', amountCents: -1050, currency: 'USD' });
    const run = async (id: string) => {
      const answer = recordingResponse();
      const req = { user: { uid: 'user-owner' }, body: { workspaceId: 'ws-1', operations: [{ id, type: 'updateBankLine', data: { status: 'matched' } }] } } as unknown as express.Request;
      await handleReconcile(req, answer.res, db as unknown as Firestore);
      return { statusCode: answer.statusCode, body: answer.body };
    };
    const refused = await run('line-eur');
    assert.equal(refused.statusCode, 400);
    assert.match(String(refused.body?.error), /in EUR, not USD/);
    assert.equal(db.getDocData('bankLines', 'line-eur').status, 'pending', 'nothing written');
    assert.equal((await run('line-usd')).statusCode, 200, 'a line in the books\' currency still matches');
    assert.equal(db.getDocData('bankLines', 'line-usd').status, 'matched');
  });

  test('#891: a bank line is cleared only by a cash movement in its own account and direction', async () => {
    const db = new MockTransactionalDb();
    db.data.set('workspaces/ws-1', { id: 'ws-1', currency: 'USD', roles: { 'user-owner': 'owner' } });
    db.data.set('chartAccounts/bank', { id: 'bank', workspaceId: 'ws-1', name: 'Checking', type: 'asset', subtype: 'bank' });
    db.data.set('chartAccounts/bank2', { id: 'bank2', workspaceId: 'ws-1', name: 'Savings', type: 'asset', subtype: 'bank' });
    db.data.set('chartAccounts/ap', { id: 'ap', workspaceId: 'ws-1', name: 'Accounts Payable', type: 'liability' });
    db.data.set('chartAccounts/exp', { id: 'exp', workspaceId: 'ws-1', name: 'Hosting', type: 'expense' });
    db.data.set('bankLines/w', { id: 'w', workspaceId: 'ws-1', accountId: 'bank', date: '2026-10-28', status: 'pending', amountCents: -141_600 });
    const entry = (id: string, lines: Array<{ accountId: string; amountCents: number }>) =>
      db.data.set(`transactions/${id}`, { id, workspaceId: 'ws-1', uid: 'user-owner', date: '2026-10-17', description: id, currency: 'USD', type: 'actual', status: 'completed', lines });
    // the bill accrual: expense and A/P only, no bank leg
    entry('accrual', [{ accountId: 'exp', amountCents: 141_600 }, { accountId: 'ap', amountCents: -141_600 }]);
    // a payment from another bank account
    entry('other-bank', [{ accountId: 'ap', amountCents: 141_600 }, { accountId: 'bank2', amountCents: -141_600 }]);
    // a deposit into this account (wrong direction for a withdrawal)
    entry('deposit', [{ accountId: 'bank', amountCents: 141_600 }, { accountId: 'ap', amountCents: -141_600 }]);
    // the real payment from this account
    entry('payment', [{ accountId: 'ap', amountCents: 141_600 }, { accountId: 'bank', amountCents: -141_600 }]);
    const match = async (txId: string) => {
      const answer = recordingResponse();
      const req = { user: { uid: 'user-owner' }, body: { workspaceId: 'ws-1', operations: [
        { id: 'w', type: 'updateBankLine', data: { status: 'matched', matchedTransactionId: txId } },
        { id: txId, type: 'updateTransaction', data: { status: 'reconciled' } },
      ] } } as unknown as express.Request;
      await handleReconcile(req, answer.res, db as unknown as Firestore);
      return { statusCode: answer.statusCode, error: String(answer.body?.error || '') };
    };
    for (const [txId, why] of [['accrual', /moved no money/], ['other-bank', /moved no money/], ['deposit', /cannot clear a withdrawal/]] as const) {
      const r = await match(txId);
      assert.equal(r.statusCode, 400, txId);
      assert.match(r.error, why);
      assert.equal(db.getDocData('bankLines', 'w').status, 'pending', `${txId}: nothing written`);
      assert.equal(db.getDocData('transactions', txId).status, 'completed', `${txId}: entry untouched`);
    }
    // Gitar on #972: the id first (still pending), then the status alone, is checked as the result
    const send = async (data: Record<string, unknown>) => {
      const answer = recordingResponse();
      const req = { user: { uid: 'user-owner' }, body: { workspaceId: 'ws-1', operations: [{ id: 'w', type: 'updateBankLine', data }] } } as unknown as express.Request;
      await handleReconcile(req, answer.res, db as unknown as Firestore);
      return answer.statusCode;
    };
    assert.equal(await send({ status: 'pending', matchedTransactionId: 'accrual' }), 200, 'a pending line may hold a draft target');
    assert.equal(await send({ status: 'matched' }), 400, 'matching it then checks the stored target');
    assert.equal(db.getDocData('bankLines', 'w').status, 'pending');
    assert.equal(await send({ status: 'pending', matchedTransactionId: null }), 200);
    // Codex on #972: a rewrite with a bank leg followed by a status-only update would save the old lines
    const twice = recordingResponse();
    await handleReconcile({ user: { uid: 'user-owner' }, body: { workspaceId: 'ws-1', operations: [
      { id: 'accrual', type: 'updateTransaction', data: { lines: [{ accountId: 'exp', amountCents: 141_600 }, { accountId: 'bank', amountCents: -141_600 }] } },
      { id: 'accrual', type: 'updateTransaction', data: { status: 'reconciled' } },
      { id: 'w', type: 'updateBankLine', data: { status: 'matched', matchedTransactionId: 'accrual' } },
    ] } } as unknown as express.Request, twice.res, db as unknown as Firestore);
    assert.equal(twice.statusCode, 400);
    assert.match(String(twice.body?.error), /more than once/);
    assert.equal(db.getDocData('bankLines', 'w').status, 'pending');
    // Codex on #972: the screen's create-from-bank-line flow (expense debited, bank credited) still saves
    const created = recordingResponse();
    await handleReconcile({ user: { uid: 'user-owner' }, body: { workspaceId: 'ws-1', operations: [
      { id: 'new-1', type: 'createTransaction', data: { id: 'new-1', uid: 'user-owner', workspaceId: 'ws-1', date: '2026-10-28', description: 'AWS', totalAmountCents: 141_600, currency: 'USD', status: 'reconciled', type: 'actual',
        lines: [{ accountId: 'exp', amountCents: 141_600 }, { accountId: 'bank', amountCents: -141_600 }] } },
      { id: 'w', type: 'updateBankLine', data: { status: 'matched', matchedTransactionId: 'new-1' } },
    ] } } as unknown as express.Request, created.res, db as unknown as Firestore);
    assert.equal(created.statusCode, 200, String(created.body?.error || ''));
    assert.equal(db.getDocData('bankLines', 'w').status, 'matched');
    await send({ status: 'pending', matchedTransactionId: null });
    // Codex on #972: two updates to one line in a batch (target, then status) are refused
    const dup = recordingResponse();
    await handleReconcile({ user: { uid: 'user-owner' }, body: { workspaceId: 'ws-1', operations: [
      { id: 'w', type: 'updateBankLine', data: { status: 'pending', matchedTransactionId: 'accrual' } },
      { id: 'w', type: 'updateBankLine', data: { status: 'matched' } },
    ] } } as unknown as express.Request, dup.res, db as unknown as Firestore);
    assert.equal(dup.statusCode, 400);
    assert.equal(db.getDocData('bankLines', 'w').status, 'pending');
    // Codex on #972: an FX entry whose raw bank legs net to zero still moved 1,000 home cents out
    db.data.set('bankLines/fx', { id: 'fx', workspaceId: 'ws-1', accountId: 'bank', date: '2026-10-28', status: 'pending', amountCents: -1_000 });
    entry('fx-entry', [
      { accountId: 'bank', amountCents: 10_000, baseAmountCents: 11_000 } as never,
      { accountId: 'bank', amountCents: -10_000, baseAmountCents: -12_000 } as never,
      { accountId: 'exp', amountCents: 0, baseAmountCents: 1_000 } as never,
    ]);
    const fx = recordingResponse();
    await handleReconcile({ user: { uid: 'user-owner' }, body: { workspaceId: 'ws-1', operations: [
      { id: 'fx', type: 'updateBankLine', data: { status: 'matched', matchedTransactionId: 'fx-entry' } },
    ] } } as unknown as express.Request, fx.res, db as unknown as Firestore);
    assert.equal(fx.statusCode, 200, String(fx.body?.error || ''));
    // Codex on #972: a line with no account (a file import) clears against a transfer between two banks
    db.data.set('bankLines/u', { id: 'u', workspaceId: 'ws-1', date: '2026-10-28', status: 'pending', amountCents: -50_000 });
    entry('transfer', [{ accountId: 'bank', amountCents: -50_000 }, { accountId: 'bank2', amountCents: 50_000 }]);
    const unscoped = recordingResponse();
    await handleReconcile({ user: { uid: 'user-owner' }, body: { workspaceId: 'ws-1', operations: [
      { id: 'u', type: 'updateBankLine', data: { status: 'matched', matchedTransactionId: 'transfer' } },
    ] } } as unknown as express.Request, unscoped.res, db as unknown as Firestore);
    assert.equal(unscoped.statusCode, 200, String(unscoped.body?.error || ''));
    assert.equal((await match('payment')).statusCode, 200, 'the payment from this account clears it');
    assert.equal(db.getDocData('bankLines', 'w').status, 'matched');
  });

  test('AF-001: undoing a match applies what the bank changed since (CodeRabbit on #439)', async () => {
    const db = new MockTransactionalDb();
    db.data.set('workspaces/ws-1', { id: 'ws-1', currency: 'USD', roles: { 'user-owner': 'owner' } });
    db.data.set('bankLines/line-mod', { id: 'line-mod', workspaceId: 'ws-1', source: 'plaid', date: '2026-10-20', description: 'Old', status: 'matched', matchedTransactionId: 'tx-a', amountCents: -500, currency: 'USD', bankChange: 'modified', bankCorrection: { date: '2026-10-21', description: 'New', amountCents: -650, currency: 'USD' } });
    db.data.set('bankLines/line-gone', { id: 'line-gone', workspaceId: 'ws-1', source: 'plaid', date: '2026-10-20', description: 'Gone', status: 'matched', matchedTransactionId: 'tx-b', amountCents: -100, bankChange: 'removed' });
    db.data.set('chartAccounts/acc-1', { id: 'acc-1', workspaceId: 'ws-1', name: 'Cash', type: 'asset' });
    db.data.set('chartAccounts/acc-2', { id: 'acc-2', workspaceId: 'ws-1', name: 'Revenue', type: 'revenue' });
    db.data.set('transactions/tx-b', { id: 'tx-b', workspaceId: 'ws-1', uid: 'user-owner', date: '2026-10-20', description: 'Gone', totalAmountCents: 100, currency: 'USD', type: 'actual', status: 'reconciled', lines: [{ accountId: 'acc-1', amountCents: -100 }, { accountId: 'acc-2', amountCents: 100 }] });
    const req = { user: { uid: 'user-owner' }, body: { workspaceId: 'ws-1', operations: [
      { id: 'line-mod', type: 'updateBankLine', data: { status: 'pending', matchedTransactionId: null } },
      { id: 'line-gone', type: 'updateBankLine', data: { status: 'pending', matchedTransactionId: null } },
      { id: 'tx-b', type: 'updateTransaction', data: { status: 'completed' } },
    ] } } as unknown as express.Request;
    const answer = recordingResponse();
    const res = answer.res;
    await handleReconcile(req, res, db as unknown as Firestore);
    assert.equal(answer.statusCode, 200);
    const mod = db.getDocData('bankLines', 'line-mod');
    assert.deepEqual([mod.status, mod.date, mod.description, mod.amountCents, mod.bankChange, mod.bankCorrection], ['pending', '2026-10-21', 'New', -650, null, null]);
    assert.equal(db.getDocData('bankLines', 'line-gone'), undefined, 'a line the bank withdrew does not come back to To review');
  });

  test('AF-001: a withdrawn line is not deleted while its entry stays reconciled (CodeRabbit on #455)', async () => {
    const db = new MockTransactionalDb();
    db.data.set('workspaces/ws-1', { id: 'ws-1', currency: 'USD', roles: { 'user-owner': 'owner' } });
    db.data.set('bankLines/line-gone', { id: 'line-gone', workspaceId: 'ws-1', source: 'plaid', date: '2026-10-20', status: 'matched', matchedTransactionId: 'tx-b', amountCents: -100, bankChange: 'removed' });
    // the entry exists and is valid, so a refusal can only come from the release rule
    db.data.set('chartAccounts/acc-1', { id: 'acc-1', workspaceId: 'ws-1', name: 'Cash', type: 'asset' });
    db.data.set('chartAccounts/acc-2', { id: 'acc-2', workspaceId: 'ws-1', name: 'Revenue', type: 'revenue' });
    db.data.set('transactions/tx-b', { id: 'tx-b', workspaceId: 'ws-1', uid: 'user-owner', date: '2026-10-20', description: 'Gone', totalAmountCents: 100, currency: 'USD', type: 'actual', status: 'reconciled', lines: [{ accountId: 'acc-1', amountCents: -100 }, { accountId: 'acc-2', amountCents: 100 }] });
    const req = { user: { uid: 'user-owner' }, body: { workspaceId: 'ws-1', operations: [{ id: 'line-gone', type: 'updateBankLine', data: { status: 'pending', matchedTransactionId: null } }] } } as unknown as express.Request;
    const answer = recordingResponse();
    const res = answer.res;
    await handleReconcile(req, res, db as unknown as Firestore);
    assert.equal(answer.statusCode, 400);
    assert.ok(db.getDocData('bankLines', 'line-gone'), 'the line stays');
    // an update that leaves the entry reconciled does not count as releasing it
    const noop = { user: { uid: 'user-owner' }, body: { workspaceId: 'ws-1', operations: [
      { id: 'line-gone', type: 'updateBankLine', data: { status: 'pending', matchedTransactionId: null } },
      { id: 'tx-b', type: 'updateTransaction', data: {} },
    ] } } as unknown as express.Request;
    answer.statusCode = 200;
    await handleReconcile(noop, res, db as unknown as Firestore);
    assert.equal(answer.statusCode, 400);
    assert.ok(db.getDocData('bankLines', 'line-gone'), 'the line still stays');
    assert.equal(db.getDocData('transactions', 'tx-b').status, 'reconciled', 'the entry is unchanged');
    // a release followed by an update that puts the entry back to reconciled is refused too
    const undone = { user: { uid: 'user-owner' }, body: { workspaceId: 'ws-1', operations: [
      { id: 'line-gone', type: 'updateBankLine', data: { status: 'pending', matchedTransactionId: null } },
      { id: 'tx-b', type: 'updateTransaction', data: { status: 'completed' } },
      { id: 'tx-b', type: 'updateTransaction', data: {} },
    ] } } as unknown as express.Request;
    answer.statusCode = 200;
    await handleReconcile(undone, res, db as unknown as Firestore);
    assert.equal(answer.statusCode, 400);
    assert.ok(db.getDocData('bankLines', 'line-gone'));
    assert.equal(db.getDocData('transactions', 'tx-b').status, 'reconciled');
    // and the same request with a real release goes through: the refusal above came from the rule
    const real = { user: { uid: 'user-owner' }, body: { workspaceId: 'ws-1', operations: [
      { id: 'line-gone', type: 'updateBankLine', data: { status: 'pending', matchedTransactionId: null } },
      { id: 'tx-b', type: 'updateTransaction', data: { status: 'completed' } },
    ] } } as unknown as express.Request;
    answer.statusCode = 200;
    await handleReconcile(real, res, db as unknown as Firestore);
    assert.equal(answer.statusCode, 200);
    assert.equal(db.getDocData('bankLines', 'line-gone'), undefined);
  });

  test('AF-001: undo refuses a bank correction dated in a closed period (Codex on #455)', async () => {
    const db = new MockTransactionalDb();
    db.data.set('workspaces/ws-1', { id: 'ws-1', currency: 'USD', lockDate: '2026-09-30', roles: { 'user-owner': 'owner' } });
    db.data.set('bankLines/line-mod', { id: 'line-mod', workspaceId: 'ws-1', source: 'plaid', date: '2026-10-02', description: 'Old', status: 'matched', matchedTransactionId: 'tx-a', amountCents: -500, bankChange: 'modified', bankCorrection: { date: '2026-09-29', description: 'New', amountCents: -500, currency: 'USD' } });
    const req = { user: { uid: 'user-owner' }, body: { workspaceId: 'ws-1', operations: [{ id: 'line-mod', type: 'updateBankLine', data: { status: 'pending', matchedTransactionId: null } }] } } as unknown as express.Request;
    const answer = recordingResponse();
    const res = answer.res;
    await handleReconcile(req, res, db as unknown as Firestore);
    assert.equal(answer.statusCode, 400);
    assert.equal(db.getDocData('bankLines', 'line-mod').status, 'matched', 'nothing written');
  });

  test('Undo sets bank line back to pending and transaction back to completed with audit log', async () => {
    const db = new MockTransactionalDb();
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

    const answer = recordingResponse();

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

    const res = answer.res;

    await handleReconcile(req, res, db as unknown as Firestore);
    assert.equal(answer.statusCode, 200);
    assert.equal((answer.body as unknown as TestResponseBody)?.status, 'ok');

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
