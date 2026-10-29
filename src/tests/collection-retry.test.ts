/**
 * #96: a live collection that failed on connection trouble must come back without a person
 * pressing "Try again" — bounded, with growing delays, and never for a permission refusal.
 */
import test, { beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTO_RETRY_LIMIT,
  RETRY_BASE_DELAY_MS,
  RETRY_MAX_DELAY_MS,
  canRetryNow,
  classifyFailure,
  planRetry,
  retryDelayMs,
} from '../lib/collectionRetry';
import { useDataNeedsStore } from '../stores/useDataNeedsStore';

const reset = () => useDataNeedsStore.setState({ asked: [], loaded: {}, loadedWorkspaceId: null, failed: {}, trouble: {} });

describe('Live collection retry policy (#96)', () => {
  test('connection trouble is transient; a permission refusal is not retried', () => {
    assert.equal(classifyFailure(new TypeError('Failed to fetch')), 'transient');
    assert.equal(classifyFailure('Network request failed: 504 Gateway Timeout'), 'transient');
    assert.equal(classifyFailure({ message: 'fetch failed', code: 'ECONNRESET' }), 'transient');
    assert.equal(classifyFailure({ message: 'connection timeout' }), 'transient');
    assert.equal(classifyFailure(new Error('WebSocket disconnected')), 'transient');
    assert.equal(classifyFailure({ status: 503, message: 'Service Unavailable' }), 'transient');

    assert.equal(classifyFailure({ code: '42501', message: 'permission denied for table transactions' }), 'auth');
    assert.equal(classifyFailure({ status: 401, message: 'Unauthorized' }), 'auth');
    assert.equal(classifyFailure({ status: 403, message: 'HTTP 403' }), 'auth');
    assert.equal(classifyFailure('row-level security policy for table invoices'), 'auth');
    assert.equal(classifyFailure('JWT expired'), 'auth');
    assert.equal(classifyFailure('permission denied for table bills (HTTP 503)'), 'auth', 'a refusal wins over a connection word');
    // src/lib/db/firestore.ts hands the app these codes, not Postgres' number: a refusal stays a
    // refusal even when the message says nothing recognisable.
    assert.equal(classifyFailure({ code: 'permission-denied', message: 'Request refused' }), 'auth');
    assert.equal(classifyFailure({ code: 'unauthenticated', message: 'Sign in again (request 12)' }), 'auth');
    assert.equal(classifyFailure({ code: 'PERMISSION_DENIED', message: 'Request refused' }), 'auth');
  });

  test('an unknown failure is worth a bounded number of attempts, not an endless one', () => {
    assert.equal(classifyFailure({ message: 'the server said something unexpected' }), 'transient');
    assert.equal(classifyFailure(undefined), 'transient');
  });

  test('the delays grow and stop at two minutes', () => {
    assert.equal(retryDelayMs(1), RETRY_BASE_DELAY_MS);
    assert.equal(retryDelayMs(2), RETRY_BASE_DELAY_MS * 2);
    assert.equal(retryDelayMs(3), RETRY_BASE_DELAY_MS * 4);
    assert.equal(retryDelayMs(4), RETRY_BASE_DELAY_MS * 8);
    assert.equal(retryDelayMs(9), RETRY_MAX_DELAY_MS);
    assert.equal(retryDelayMs(0), RETRY_BASE_DELAY_MS, 'a nonsense attempt still gets the first delay');
    assert.ok(retryDelayMs(4) < retryDelayMs(5), 'still growing before the cap');
  });

  test('the plan counts attempts and gives up after the limit; a refusal has no schedule', () => {
    const now = 1_000_000;
    assert.deepEqual(planRetry('Failed to fetch', 0, now), { kind: 'transient', attempts: 1, nextRetryAt: now + retryDelayMs(1) });
    assert.deepEqual(planRetry('Failed to fetch', 3, now), { kind: 'transient', attempts: 4, nextRetryAt: null });
    assert.deepEqual(planRetry({ status: 403, message: 'Forbidden' }, 0, now), { kind: 'auth', attempts: 1, nextRetryAt: null });
    assert.equal(planRetry('Failed to fetch', 0, now).attempts, 1);
    assert.equal(AUTO_RETRY_LIMIT, 4);
  });

  test('canRetryNow honours the due time, the limit, the refusal and a connectivity return', () => {
    const transient = { kind: 'transient' as const, attempts: 1, nextRetryAt: 10_000 };
    assert.equal(canRetryNow(transient, 9_999), false, 'not before it is due');
    assert.equal(canRetryNow(transient, 10_000), true);
    assert.equal(canRetryNow(transient, 1, true), true, 'coming back online tries at once');
    assert.equal(canRetryNow({ kind: 'auth', attempts: 1, nextRetryAt: 1 }, 10_000, true), false);
    assert.equal(canRetryNow({ kind: 'transient', attempts: AUTO_RETRY_LIMIT, nextRetryAt: 1 }, 10_000, true), false);
    assert.equal(canRetryNow({ kind: 'transient', attempts: 1, nextRetryAt: null }, 10_000, true), false);
    assert.equal(canRetryNow(undefined, 10_000, true), false);
  });
});

describe('Live collection retry state (#96)', () => {
  beforeEach(reset);

  test('a failure is shown, planned, and cleared when the collection finally loads', () => {
    const store = useDataNeedsStore.getState();
    const before = Date.now();
    store.markFailed('invoices', 'Failed to fetch', new TypeError('Failed to fetch'));
    const after = Date.now();
    let state = useDataNeedsStore.getState();
    assert.equal(state.failed.invoices, 'Failed to fetch');
    const plan = state.trouble.invoices!;
    assert.equal(plan.kind, 'transient');
    assert.equal(plan.attempts, 1);
    assert.ok(plan.nextRetryAt! >= before + RETRY_BASE_DELAY_MS && plan.nextRetryAt! <= after + RETRY_BASE_DELAY_MS);

    useDataNeedsStore.getState().markLoaded('invoices');
    state = useDataNeedsStore.getState();
    assert.equal(state.failed.invoices, undefined);
    assert.equal(state.trouble.invoices, undefined, 'a loaded collection forgets its attempts');
    assert.equal(state.loaded.invoices, true);
  });

  test('the scheduled retry clears the failure so the subscription starts again, keeping the count', () => {
    const store = useDataNeedsStore.getState();
    store.markFailed('bills', 'Network request failed');
    const plan = useDataNeedsStore.getState().trouble.bills!;
    useDataNeedsStore.getState().retryTransientFailures(plan.nextRetryAt! - 1);
    assert.equal(useDataNeedsStore.getState().failed.bills, 'Network request failed', 'not before it is due');
    useDataNeedsStore.getState().retryTransientFailures(plan.nextRetryAt!);
    assert.equal(useDataNeedsStore.getState().failed.bills, undefined, 'due: the failure clears and useLedgerData resubscribes');
    assert.equal(useDataNeedsStore.getState().trouble.bills?.attempts, 1, 'the count stays, so the next delay is longer');

    // it fails again: the second attempt is planned further out
    useDataNeedsStore.getState().markFailed('bills', 'Network request failed');
    assert.equal(useDataNeedsStore.getState().trouble.bills?.attempts, 2);
  });

  test('returning online or to the tab retries at once, and a refusal is left to the person', () => {
    const store = useDataNeedsStore.getState();
    store.markFailed('bankLines', 'Failed to fetch');
    store.markFailed('customers', 'permission denied for table customers', { code: '42501', message: 'permission denied for table customers' });

    useDataNeedsStore.getState().retryTransientFailures(Date.now(), true);
    const state = useDataNeedsStore.getState();
    assert.equal(state.failed.bankLines, undefined, 'connection trouble retried on reconnect');
    assert.equal(state.failed.customers, 'permission denied for table customers', 'a refusal keeps "Try again"');
  });

  test('a connection that keeps failing runs out of automatic attempts', () => {
    for (let attempt = 1; attempt <= AUTO_RETRY_LIMIT; attempt++) {
      useDataNeedsStore.getState().markFailed('invoices', 'Failed to fetch');
      useDataNeedsStore.getState().retryTransientFailures(Date.now(), true);
    }
    const state = useDataNeedsStore.getState();
    assert.equal(state.trouble.invoices?.attempts, AUTO_RETRY_LIMIT);
    assert.equal(state.failed.invoices, 'Failed to fetch', 'the last failure waits for "Try again"');
    useDataNeedsStore.getState().retryTransientFailures(Date.now(), true);
    assert.equal(useDataNeedsStore.getState().failed.invoices, 'Failed to fetch', 'no retry storm');
  });

  test('pressing "Try again" starts the count over', () => {
    const store = useDataNeedsStore.getState();
    for (let i = 0; i < AUTO_RETRY_LIMIT; i++) store.markFailed('invoices', 'Failed to fetch');
    assert.equal(useDataNeedsStore.getState().trouble.invoices?.attempts, AUTO_RETRY_LIMIT);
    useDataNeedsStore.getState().retry('invoices');
    assert.equal(useDataNeedsStore.getState().failed.invoices, undefined);
    assert.equal(useDataNeedsStore.getState().trouble.invoices, undefined);
    useDataNeedsStore.getState().markFailed('invoices', 'Failed to fetch');
    assert.equal(useDataNeedsStore.getState().trouble.invoices?.attempts, 1);
  });

  test('A-257: every retry path marks the collection loading again until the fresh snapshot arrives', () => {
    // "Try again" (a collection that had loaded earlier, then its read failed mid-session)
    useDataNeedsStore.getState().markLoaded('invoices');
    useDataNeedsStore.getState().markFailed('invoices', 'Failed to fetch', new TypeError('Failed to fetch'));
    useDataNeedsStore.getState().retry('invoices');
    let state = useDataNeedsStore.getState();
    assert.equal(state.failed.invoices, undefined, 'the failure is cleared');
    assert.equal(state.loaded.invoices, false, 'loading again — the screen must not quietly show the stale list');
    useDataNeedsStore.getState().markLoaded('invoices');
    assert.equal(useDataNeedsStore.getState().loaded.invoices, true, 'ready once the new read arrives');

    // the scheduled automatic retry
    useDataNeedsStore.getState().markLoaded('bills');
    useDataNeedsStore.getState().markFailed('bills', 'Failed to fetch', new TypeError('Failed to fetch'));
    const plan = useDataNeedsStore.getState().trouble.bills!;
    useDataNeedsStore.getState().retryTransientFailures(plan.nextRetryAt!);
    state = useDataNeedsStore.getState();
    assert.equal(state.failed.bills, undefined);
    assert.equal(state.loaded.bills, false, 'the automatic retry also reads as loading');
    useDataNeedsStore.getState().markLoaded('bills');
    assert.equal(useDataNeedsStore.getState().loaded.bills, true);

    // back online / back at the tab
    useDataNeedsStore.getState().markLoaded('bankLines');
    useDataNeedsStore.getState().markFailed('bankLines', 'Failed to fetch', new TypeError('Failed to fetch'));
    useDataNeedsStore.getState().retryAfterReconnect();
    state = useDataNeedsStore.getState();
    assert.equal(state.failed.bankLines, undefined);
    assert.equal(state.loaded.bankLines, false, 'the reconnect retry also reads as loading');

    // a refusal is still left alone — it is not loading, it waits for the person
    useDataNeedsStore.getState().markLoaded('customers');
    useDataNeedsStore.getState().markFailed('customers', 'permission denied for table customers', { code: '42501', message: 'permission denied' });
    useDataNeedsStore.getState().retryAfterReconnect();
    state = useDataNeedsStore.getState();
    assert.equal(state.failed.customers, 'permission denied for table customers', 'a refusal keeps "Try again"');
    assert.equal(state.loaded.customers, true, 'its data was present and stays marked ready');
  });

  test('A-257: "Try again" on a collection that never failed is a no-op — its live data stays marked loaded', () => {
    useDataNeedsStore.getState().markLoaded('payments');
    const before = useDataNeedsStore.getState();
    useDataNeedsStore.getState().retry('payments');
    const after = useDataNeedsStore.getState();
    assert.equal(after, before, 'nothing failed: nothing is cleared and nothing reloads');
    assert.equal(after.loaded.payments, true, 'a healthy live collection is not sent back to loading');
  });

  test('coming back online starts a fresh bounded cycle, but a refusal is not retried', () => {
    for (let i = 0; i < AUTO_RETRY_LIMIT; i++) useDataNeedsStore.getState().markFailed('invoices', 'Failed to fetch');
    useDataNeedsStore.getState().markFailed('bills', 'permission denied for table bills', { code: '42501' });
    useDataNeedsStore.getState().retryAfterReconnect();
    let state = useDataNeedsStore.getState();
    assert.equal(state.failed.invoices, undefined, 'the network came back: try again without pressing anything');
    assert.equal(state.trouble.invoices, undefined, 'with a fresh count of attempts');
    assert.equal(state.failed.bills, 'permission denied for table bills');

    useDataNeedsStore.getState().markFailed('invoices', 'Failed to fetch');
    state = useDataNeedsStore.getState();
    assert.equal(state.trouble.invoices?.attempts, 1);
    assert.ok(state.trouble.invoices?.nextRetryAt, 'a new schedule');
  });

  test('switching workspace forgets every failure and attempt', () => {
    const store = useDataNeedsStore.getState();
    store.markFailed('invoices', 'Failed to fetch');
    store.markFailed('bills', 'permission denied for table bills', { code: '42501' });
    useDataNeedsStore.getState().resetLoaded('other-workspace');
    const state = useDataNeedsStore.getState();
    assert.deepEqual(state.failed, {});
    assert.deepEqual(state.trouble, {});
    assert.equal(state.loadedWorkspaceId, 'other-workspace');
  });
});
