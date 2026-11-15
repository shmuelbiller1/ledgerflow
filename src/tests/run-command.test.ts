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
      // runCommand reads the text first so an empty answer is distinguishable from a cut connection;
      // `json` stays for the refusal path, which reads a best-effort body from the response
      text: async () => (body === undefined ? '' : JSON.stringify(body)),
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

  test('a 200 with an empty body is an answer of null, not a cut connection', async () => {
    // Routes answer a write with 200 and no content. The hand-typed calls this replaced read those
    // with `res.json().catch(() => ({}))`; treating "no body" as a failure broke every caller of such
    // a route while looking like a network fault. A body that stops mid-JSON is still a failure.
    answer(200, undefined);
    assert.equal(await runCommand({ path: '/api/v1/x', method: 'POST', body: {}, token: 't' }), null);
  });

  test('a body cut off mid-JSON still fails, so an export cannot silently become empty', async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
      text: async () => '{"rows": [1, 2',
    }) as unknown as Response) as unknown as typeof fetch;
    await assert.rejects(
      runCommand({ path: '/api/v1/x', token: 't' }),
      (err: unknown) => err instanceof ServerCommandError && /cut off/.test(err.message),
    );
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
    // but a 403 that carries an instruction the person can act on keeps the server's words
    assert.match(
      commandErrorMessage(new ServerCommandError(403, 'Access Denied: Please verify your email protocol.')),
      /verify your email/i,
    );
    assert.match(
      commandErrorMessage(new ServerCommandError(403, 'Set up two-step login to continue')),
      /two-step login/i,
    );
    assert.equal(commandErrorMessage(new ServerCommandError(422, 'Closed month')), 'Closed month');
    assert.equal(commandErrorMessage('boom'), 'boom');
    assert.equal(commandErrorMessage(undefined), 'That did not work');
  });

  test('extra headers are sent, so an idempotency key survives the move off hand-typed calls', async () => {
    let sent: Record<string, string> = {};
    globalThis.fetch = (async (_path: string, init: RequestInit) => {
      sent = init.headers as Record<string, string>;
      return { ok: true, status: 200, text: async () => '', json: async () => ({}) };
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
      return { ok: true, status: 200, text: async () => '{"message":"restored"}', json: async () => ({ message: 'restored' }) };
    }) as unknown as typeof fetch;
    const text = '{"schemaVersion":1,"transactions":[]}';
    await runCommand({ path: '/api/v1/workspaces/w/restore', method: 'POST', rawBody: text, token: 't' });
    // exactly the file's bytes: not JSON.stringify'd into a quoted string
    assert.equal(sent, text);
  });

  test('a file upload sets no Content-Type of its own, so the multipart boundary survives', async () => {
    let init: RequestInit = {};
    globalThis.fetch = (async (_path: string, i: RequestInit) => {
      init = i;
      return { ok: true, status: 200, text: async () => '{"rows":[]}', json: async () => ({ rows: [] }) };
    }) as unknown as typeof fetch;
    const form = new FormData();
    form.append('workspaceId', 'w');
    await runCommand({ path: '/api/upload-bank-csv', method: 'POST', form, token: 't' });
    const headers = init.headers as Record<string, string>;
    // the browser must add `multipart/form-data; boundary=...` itself
    assert.equal(headers['Content-Type'], undefined);
    assert.ok(init.body instanceof FormData);
    assert.equal(headers.Authorization, 'Bearer t');
  });

  test('a null token means no session, so no credentials are attached', async () => {
    let sent: Record<string, string> = {};
    globalThis.fetch = (async (_path: string, init: RequestInit) => {
      sent = init.headers as Record<string, string>;
      return { ok: true, status: 200, text: async () => '', json: async () => ({}) };
    }) as unknown as typeof fetch;
    await runCommand({ path: '/api/v1/invoices/public/abc', token: null });
    // the whole point: a public page asking as a visitor must not send the visitor's own session
    assert.equal(sent.Authorization, undefined);
  });

  test('a 200 whose body was cut off fails instead of reporting an empty success', async () => {
    globalThis.fetch = (async () => ({
      ok: true, status: 200, text: async () => '{"rows": [1, 2', json: async () => { throw new SyntaxError('Unexpected end of JSON input'); },
    })) as unknown as typeof fetch;
    // `{}` here would let a backup export write an empty archive and call it verified
    await assert.rejects(
      () => runCommand({ path: '/api/v1/workspaces/w/export', token: 't' }),
      (error: unknown) => error instanceof ServerCommandError && /cut off/i.test(error.message),
    );
  });

  test('a raw body still says it is JSON, which is what the restore route reads', async () => {
    let sent: Record<string, string> = {};
    globalThis.fetch = (async (_path: string, init: RequestInit) => {
      sent = init.headers as Record<string, string>;
      return { ok: true, status: 200, text: async () => '', json: async () => ({}) };
    }) as unknown as typeof fetch;
    await runCommand({ path: '/api/v1/workspaces/w/restore', method: 'POST', rawBody: '{}', token: 't' });
    // without this the request goes out as text/plain and the route cannot read it as the backup
    assert.equal(sent['Content-Type'], 'application/json');
  });
});
