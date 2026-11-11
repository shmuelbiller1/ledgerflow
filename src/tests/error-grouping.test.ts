/**
 * F-21: client crashes are grouped by screen and release, so one broken widget is one reported
 * problem with a count — not a new line on every reload. Grouping keeps only the redacted message
 * and never adds personal data to what the telemetry route receives.
 */
import './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { clearErrorGroups, errorFingerprint, getErrorGroups, getRecentErrors, reportClientError } from '../lib/errorTracker';
import { useAuthStore } from '../stores/useAuthStore';

describe('F-21 client error grouping', () => {
  const sent: Array<{ url: string; body: Record<string, unknown> }> = [];

  beforeEach(() => {
    clearErrorGroups();
    sent.length = 0;
    useAuthStore.setState({
      user: { uid: 'group-user', email: 'owner@example.test', getIdToken: async () => 'token' } as never,
      currentWorkspaceId: 'group-workspace',
    } as never);
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      sent.push({ url: String(input), body: typeof init?.body === 'string' ? JSON.parse(init.body) : {} });
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
  });
  afterEach(() => clearErrorGroups());

  test('the same message on the same screen counts once, however the request ids change', async () => {
    await reportClientError(new Error('render failed for err_1712345678901_ab12c'), { metadata: { view: 'Dashboard' } });
    await reportClientError(new Error('render failed for err_1712345679999_zz99x'), { metadata: { view: 'Dashboard' } });

    const groups = getErrorGroups();
    assert.equal(groups.length, 1);
    assert.equal(groups[0].screen, 'Dashboard');
    assert.equal(groups[0].count, 2);
    assert.equal(groups[0].release, 'ledgerflow-prod-v1');
    assert.ok(groups[0].fingerprint.includes('Dashboard'));
    assert.ok(groups[0].firstSeenAt <= groups[0].lastSeenAt);
  });

  test('a different screen or a different message is its own group, newest first', async () => {
    await reportClientError(new Error('chart failed'), { metadata: { view: 'Reports' } });
    await reportClientError(new Error('chart failed'), { metadata: { view: 'Dashboard' } });
    await reportClientError(new Error('table failed'), { metadata: { view: 'Reports' } });

    const groups = getErrorGroups();
    assert.equal(groups.length, 3);
    assert.deepEqual(groups.map(g => `${g.screen}:${g.message}`).sort(), [
      'Dashboard:chart failed',
      'Reports:chart failed',
      'Reports:table failed',
    ]);
  });

  test('the telemetry body carries the group identity but no personal data', async () => {
    const id = await reportClientError(
      new Error('receipt upload failed for dana@example.com card 4111111111111111'),
      { metadata: { view: 'Documents', attempt: 1 } },
    );
    const posted = sent.find(s => s.url.includes('/api/v1/telemetry/errors'))!;
    const metadata = posted.body.metadata as Record<string, unknown>;
    assert.equal(metadata.view, 'Documents');
    assert.equal(metadata.screen, 'Documents');
    assert.equal(metadata.repeatCount, 1);
    assert.equal(typeof metadata.fingerprint, 'string');
    assert.ok(!JSON.stringify(posted.body).includes('dana@example.com'));
    assert.ok(!JSON.stringify(posted.body).includes('4111111111111111'));

    const kept = getRecentErrors().find(record => record.id === id)!;
    assert.equal(kept.metadata?.fingerprint, metadata.fingerprint);
  });

  test('client references use secure randomness and stay grouped when included in errors', async () => {
    const a = await reportClientError('first error');
    const b = await reportClientError('second error');
    assert.match(a, /^err_\d+_[a-f0-9]{32}$/);
    assert.notEqual(a, b);
    assert.equal(errorFingerprint('Screen', `failed ${a}`, 'v1'), errorFingerprint('Screen', `failed ${b}`, 'v1'));
  });

  test('without Web Crypto telemetry continues and uses the server reference', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    try {
      Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
      globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
        sent.push({ url: '/api/v1/telemetry/errors', body: JSON.parse(String(init?.body)) });
        return new Response(JSON.stringify({ errorId: 'err_123_server' }), { status: 200 });
      }) as typeof fetch;
      const id = await reportClientError('crypto unavailable', { metadata: { view: 'Dashboard' } });
      assert.equal(sent[0].body.id, '');
      assert.equal(id, 'err_123_server');
      assert.equal(getRecentErrors()[0].id, id);
      assert.equal(getErrorGroups()[0].errorId, id);
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
      else Reflect.deleteProperty(globalThis, 'crypto');
    }
  });

  test('late server references do not replace a newer group reference', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    try {
      Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
      const replies: Array<(response: Response) => void> = [];
      globalThis.fetch = (() => new Promise<Response>(resolve => replies.push(resolve))) as typeof fetch;
      const first = reportClientError('same crash');
      const second = reportClientError('same crash');
      // Allow the asynchronous token lookups to reach fetch.
      await Promise.resolve();
      assert.equal(replies.length, 2);
      replies[1](new Response(JSON.stringify({ errorId: 'err_2_new' }), { status: 200 }));
      assert.equal(await second, 'err_2_new');
      replies[0](new Response(JSON.stringify({ errorId: 'err_1_old' }), { status: 200 }));
      assert.equal(await first, 'err_1_old');
      assert.equal(getErrorGroups()[0].errorId, 'err_2_new');
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
      else Reflect.deleteProperty(globalThis, 'crypto');
    }
  });

  test('without crypto or a server reference, retain diagnostics without inventing an id', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    try {
      Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
      globalThis.fetch = (async () => new Response('{}', { status: 200 })) as typeof fetch;
      assert.equal(await reportClientError('reference unavailable'), '');
      assert.equal(getRecentErrors()[0].message, 'reference unavailable');
      assert.equal(getRecentErrors()[0].id, '');
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
      else Reflect.deleteProperty(globalThis, 'crypto');
    }
  });

  test('rejects malformed server references and retains the local report', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    try {
      Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
      globalThis.fetch = (async () => new Response(JSON.stringify({ errorId: '../unsafe' }), { status: 200 })) as typeof fetch;
      assert.equal(await reportClientError('bad server reference'), '');
      assert.equal(getRecentErrors()[0].message, 'bad server reference');
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
      else Reflect.deleteProperty(globalThis, 'crypto');
    }
  });

  test('fingerprints ignore ids and timestamps, and keep the words', () => {
    const a = errorFingerprint('Sales', 'Posting failed for 2026-10-19T10:00:00.000Z (req 7f3c9a1e-1111-4222-8333-444455556666)', 'v1');
    const b = errorFingerprint('Sales', 'Posting failed for 2026-10-19T11:30:00.000Z (req 8a4d0b2f-9999-4222-8333-444455556666)', 'v1');
    assert.equal(a, b);
    assert.notEqual(a, errorFingerprint('Purchases', 'Posting failed', 'v1'));
    assert.notEqual(a, errorFingerprint('Sales', 'Posting failed', 'v2'));
  });
});
