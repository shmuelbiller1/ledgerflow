/** Errors say what to do (BO-07). */
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { describeError } from '../lib/errorRemedies';
import { errorReference, OperationType } from '../lib/utils';
import type { OperationType as FirestoreOperationType } from '../lib/firebaseUtils';

describe('Error remedies', () => {
  test('common causes get a plain title and what to do', () => {
    assert.match(describeError(new Error('This period is locked')).remedy, /Month-End Close/);
    assert.match(describeError(new Error('new row violates row-level security policy (invoices)')).title, /permission/);
    assert.match(describeError(new Error('Forbidden: requires owner, accountant, or bookkeeper role')).remedy, /Settings → Team/);
    assert.match(describeError(new Error('Field "totalCents" is not allowed on invoices')).remedy, /report it/);
    assert.match(describeError(new TypeError('Failed to fetch')).title, /reach the server/);
    assert.match(describeError(new Error('Sign in required')).title, /session ended/);
    assert.match(describeError(new Error('duplicate key value violates unique constraint')).title, /already exists/);
    assert.match(describeError(new Error('Transaction is unbalanced')).title, /balance/);
    assert.match(describeError({ message: 'Amount must be greater than zero' }).remedy, /Amount must be greater than zero/);
  });

  test('anything else names what failed and how to report it', () => {
    const d = describeError(new Error('weird'), 'create');
    assert.equal(d.title, 'Something went wrong while saving');
    assert.match(d.remedy, /Help → Support/);
  });
});

describe('error references (F-22)', () => {
  test('a server request id is kept; an error that never reached the server has none', () => {
    assert.equal(errorReference(Object.assign(new Error('boom'), { requestId: 'req-abc' })), 'req-abc');
    assert.equal(errorReference(new Error('boom')), null);
    assert.equal(errorReference(undefined), null);
    assert.equal(errorReference({ requestId: '   ' }), null, 'a blank id is not quoted');
  });

  test('the toast quotes the reference beside the remedy when a failure carried one', async (t) => {
    const { toast } = await import('sonner');
    const { handleFirestoreError } = await import('../lib/firebaseUtils');
    const shown = t.mock.method(toast, 'error', () => '');
    const create = OperationType.CREATE as unknown as FirestoreOperationType;
    // the handler re-throws after reporting (a boundary's job); the toast is what matters here
    t.mock.method(console, 'error', () => {});
    try {
      handleFirestoreError(Object.assign(new Error('weird'), { requestId: 'req-abc' }), create, '/invoices/1');
    } catch { /* reported, then rethrown */ }
    assert.equal(shown.mock.callCount(), 1, 'one toast');
    const description = shown.mock.calls[0].arguments[1] as { description?: string };
    assert.match(String(description.description), /Help → Support/, 'still says what to do');
    assert.match(String(description.description), /Reference req-abc/, 'and can be quoted');

    shown.mock.resetCalls();
    try {
      handleFirestoreError(new Error('weird'), create, '/invoices/1');
    } catch { /* reported, then rethrown */ }
    const withoutId = shown.mock.calls[0].arguments[1] as { description?: string };
    assert.doesNotMatch(String(withoutId.description), /Reference/, 'no invented reference');
  });
});
