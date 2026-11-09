/**
 * F-35 — nothing personal or secret reaches a log.
 *
 * Two layers are checked:
 *  1. the pure rule (`redactForLogs`): passwords/secrets, bearer tokens, API keys,
 *     e-mail addresses and payment-card numbers are replaced; ordinary text and
 *     amounts are left exactly as they were;
 *  2. the real crash-report path (`reportClientError`): the body sent to
 *     /api/v1/telemetry/errors and the record kept in memory both carry the
 *     redacted text, and a card number never appears in either.
 *
 * Read-only: no server code, no logger field and no telemetry schema changed.
 */
import './helpers/dom';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { isCardNumber, isRedacted, redactForLogs } from '../lib/logRedaction';
import { getRecentErrors, reportClientError } from '../lib/errorTracker';
import { useAuthStore } from '../stores/useAuthStore';

const liveCard = '4111 1111 1111 1111'; // Luhn-valid test number
const liveCardCompact = '4111111111111111';

describe('F-35 log redaction rule', () => {
  test('passwords, secrets, bearer tokens and API keys are replaced', () => {
    const text = 'login failed password=hunter2 token: abc123 api_key=sk_live_9 Authorization: Bearer eyJhbGciOi.payload.sig';
    const out = redactForLogs(text);
    for (const secret of ['hunter2', 'abc123', 'sk_live_9', 'eyJhbGciOi.payload.sig']) {
      assert.ok(!out.includes(secret), `${secret} leaked: ${out}`);
    }
    assert.ok(out.includes('[REDACTED]'));
  });

  test('e-mail addresses are replaced, including Hebrew-adjacent text', () => {
    const out = redactForLogs('שלח אל dana.cohen+books@example.co.il and backup@acme.test failed');
    assert.ok(!out.includes('dana.cohen+books@example.co.il'));
    assert.ok(!out.includes('backup@acme.test'));
    assert.ok(out.includes('[EMAIL]'));
    assert.ok(out.startsWith('שלח אל '), 'surrounding text is kept exactly');
  });

  test('a Luhn-valid card number is masked whole, with spaces or dashes', () => {
    for (const card of [liveCard, liveCardCompact, '4111-1111-1111-1111']) {
      const out = redactForLogs(`card ${card} declined`);
      assert.ok(!out.includes(card), `${card} leaked`);
      assert.ok(out.includes('[CARD]'), out);
    }
    // a partial number and a non-card digit run are still personal data / ordinary text
    assert.equal(redactForLogs('ending 1111'), 'ending 1111');
    assert.equal(redactForLogs('order 1234567890123'), 'order 1234567890123', '13 digits that fail Luhn are left alone');
    assert.ok(isCardNumber('4111111111111111'));
    assert.ok(!isCardNumber('1234567890123'));
  });

  test('ordinary log text and amounts are untouched', () => {
    for (const line of ['invoice INV-1001 posted 100000 cents', 'period 2026-09 is closed', '', 'Σ 1,234.56 ₪']) {
      assert.equal(redactForLogs(line), line);
      assert.ok(isRedacted(line));
    }
    assert.ok(!isRedacted(`mail me at someone@example.com`));
  });
});

describe('F-35 the crash report carries no personal data', () => {
  test('the telemetry body and the in-memory record are redacted', async () => {
    const sent: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/api/v1/telemetry/errors')) {
        sent.push(String(init?.body || ''));
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return realFetch(input as never, init);
    }) as typeof fetch;
    useAuthStore.setState({
      user: { uid: 'log-user', email: 'owner@example.test', getIdToken: async () => 'fake-token' } as never,
      currentWorkspaceId: 'log-workspace',
    } as never);

    try {
      const id = await reportClientError(
        new Error(`checkout failed for dana@example.com card ${liveCardCompact} password=hunter2`),
        { severity: 'error', metadata: { retry: 1 } },
      );
      assert.ok(id.startsWith('err_'), 'a reference is still returned to the user');
      assert.equal(sent.length, 1, 'one telemetry request');
      const body = sent[0];
      for (const secret of ['dana@example.com', liveCardCompact, 'hunter2', 'Bearer fake-token']) {
        if (secret.startsWith('Bearer')) continue; // the auth header is a header, not the body
        assert.ok(!body.includes(secret), `${secret} leaked in the telemetry body`);
      }
      const kept = getRecentErrors().find(record => record.id === id);
      assert.ok(kept, 'the error is kept for the diagnostics attachment');
      assert.ok(!kept.message.includes('dana@example.com'));
      assert.ok(!kept.message.includes(liveCardCompact));
      assert.ok(kept.message.includes('[EMAIL]') && kept.message.includes('[CARD]'));
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
