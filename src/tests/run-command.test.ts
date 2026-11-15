/**
 * Prompt 2, part 3 — "one way to act": `runCommand` is where a screen's request to its own server goes.
 *
 * The point of the ratchet on hand-typed `fetch('/api/…')` is not style. Every screen that types its
 * own address also types its own token header, its own `res.ok` check and its own reading of
 * `data.message`, and they disagree: some show the server's words, some show "That did not work", some
 * crash on a body that is not JSON. These tests pin the one behaviour they all get when they move.
 */
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runCommand, commandErrorMessage, ServerCommandError } from '../lib/runCommand';

const realFetch = globalThis.fetch;
const calls: Array<{ url: string; init: RequestInit }> = [];

function answer(status: number, body: unknown) {
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

beforeEach(() => { calls.length = 0; });
afterEach(() => { globalThis.fetch = realFetch; });

describe('runCommand is the one place a screen calls its server', () => {
  test('it sends the token, the method and the JSON body the screen asked for', async () => {
    answer(200, { ok: true });
    const result = await runCommand({
      path: '/api/v1/workspaces/w1/assets/a1/in-service',
      method: 'POST',
      body: { date: '2026-01-01' },
      token: 'test-token',
    });
    assert.deepEqual(result, { ok: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/api/v1/workspaces/w1/assets/a1/in-service');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.body, JSON.stringify({ date: '2026-01-01' }));
    const headers = calls[0].init.headers as Record<string, string>;
    assert.equal(headers.Authorization, 'Bearer test-token');
    assert.equal(headers['Content-Type'], 'application/json');
  });

  test('a GET sends no body and no content type', async () => {
    answer(200, { rows: [] });
    await runCommand({ path: '/api/v1/thing', token: 't' });
    assert.equal(calls[0].init.method, 'GET');
    assert.equal(calls[0].init.body, undefined);
    assert.equal((calls[0].init.headers as Record<string, string>)['Content-Type'], undefined);
  });

  test('a refusal carries the status and the server’s own words', async () => {
    answer(422, { message: 'The date is in a closed month' });
    await assert.rejects(
      () => runCommand({ path: '/api/v1/thing', method: 'POST', body: {}, token: 't' }),
      (error: unknown) => {
        assert.ok(error instanceof ServerCommandError);
        assert.equal(error.status, 422);
        assert.equal(error.message, 'The date is in a closed month');
        return true;
      },
    );
  });

  test('a route that answers { error } keeps its explanation, not a status code', async () => {
    // every inventory route answers this way — a delivery refused for stock says exactly why, and that
    // sentence is the only thing that tells the person what to change
    answer(409, { error: 'Only 3 left on that order' });
    await assert.rejects(
      () => runCommand({ path: '/api/v1/inventory/deliveries/x', method: 'POST', body: {}, token: 't' }),
      (error: unknown) => error instanceof ServerCommandError && error.message === 'Only 3 left on that order',
    );
  });

  test('`message` wins when a body carries both, and an empty one falls through to `error`', async () => {
    answer(400, { message: 'Check the fields', error: 'zod: path' });
    await assert.rejects(() => runCommand({ path: '/api/v1/x', token: 't' }), /Check the fields/);
    answer(400, { message: '   ', error: 'The date is in a closed month' });
    await assert.rejects(() => runCommand({ path: '/api/v1/x', token: 't' }), /closed month/);
  });

  test('a refusal with no message still says something usable', async () => {
    answer(500, {});
    await assert.rejects(
      () => runCommand({ path: '/api/v1/thing', token: 't' }),
      (error: unknown) => error instanceof ServerCommandError && error.message === 'The server answered 500',
    );
  });

  test('a body that is not JSON does not crash the screen', async () => {
    globalThis.fetch = (async () => ({
      ok: false, status: 502, json: async () => { throw new SyntaxError('Unexpected token <'); },
    })) as unknown as typeof fetch;
    await assert.rejects(
      () => runCommand({ path: '/api/v1/thing', token: 't' }),
      (error: unknown) => error instanceof ServerCommandError && error.status === 502,
    );
  });

  test('`parse` shapes the answer, so a screen gets what it expects or an error', async () => {
    answer(200, { ids: ['a', 'b'] });
    const ids = await runCommand({ path: '/api/v1/thing', token: 't', parse: raw => (raw as { ids: string[] }).ids });
    assert.deepEqual(ids, ['a', 'b']);
  });

  test('the message a person reads separates a dead session from a refused action', () => {
    assert.match(commandErrorMessage(new ServerCommandError(401, 'nope')), /session has ended/i);
    assert.match(commandErrorMessage(new ServerCommandError(403, 'nope')), /role cannot do that/i);
    assert.equal(commandErrorMessage(new ServerCommandError(422, 'Closed month')), 'Closed month');
    assert.equal(commandErrorMessage('boom'), 'boom');
    assert.equal(commandErrorMessage(undefined), 'That did not work');
  });

  test('extra headers are sent, so an idempotency key survives the move off hand-typed calls', async () => {
    let sent: Record<string, string> = {};
    globalThis.fetch = (async (_path: string, init: RequestInit) => {
      sent = init.headers as Record<string, string>;
      return { ok: true, status: 200, json: async () => ({}) };
    }) as unknown as typeof fetch;
    await runCommand({
      path: '/api/v1/transactions',
      method: 'POST',
      body: { transaction: {} },
      token: 't',
      headers: { 'Idempotency-Key': 'abc' },
    });
    assert.equal(sent['Idempotency-Key'], 'abc');
    // and adding one does not drop the token or the content type
    assert.equal(sent.Authorization, 'Bearer t');
    assert.equal(sent['Content-Type'], 'application/json');
  });

  test('rawBody sends already-serialized text as-is, which a backup restore needs', async () => {
    let sent: string | undefined;
    globalThis.fetch = (async (_path: string, init: RequestInit) => {
      sent = init.body as string;
      return { ok: true, status: 200, json: async () => ({ message: 'restored' }) };
    }) as unknown as typeof fetch;
    const text = '{"schemaVersion":1,"transactions":[]}';
    await runCommand({ path: '/api/v1/workspaces/w/restore', method: 'POST', rawBody: text, token: 't' });
    // exactly the file's bytes: not JSON.stringify'd into a quoted string
    assert.equal(sent, text);
  });
});
