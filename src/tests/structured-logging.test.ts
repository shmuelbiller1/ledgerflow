import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { logLine, logger, scrubFields, logContext } from '../server/utils/logger';
import { requestContext } from '../server/http/requestContext';

/** D-21 / BN-01: one JSON logger with request id, workspace and route; no personal data. */
describe('structured JSON logging (D-21)', () => {
  it('replaces personal fields, at any depth, and keeps the rest', () => {
    const out = scrubFields({
      email: 'a@b.c', password: 'x', Authorization: 'Bearer t', phone: '1', iban: 'GB00', apiKey: 'k',
      userEmail: 'a@b.c', clientSecret: 's', accessToken: 't', bankAccountNumber: '1', big: 12n,
      jobName: 'reminders', count: 3, nested: { user: { email: 'a@b.c', id: 'u1' } },
    });
    assert.equal(out.email, '[redacted]');
    assert.equal(out.password, '[redacted]');
    assert.equal(out.Authorization, '[redacted]');
    assert.equal(out.phone, '[redacted]');
    assert.equal(out.iban, '[redacted]');
    assert.equal(out.apiKey, '[redacted]');
    for (const key of ['userEmail', 'clientSecret', 'accessToken', 'bankAccountNumber']) assert.equal(out[key], '[redacted]', key);
    assert.equal(out.big, '12', 'a bigint is written as text, not a crash');
    assert.equal(out.jobName, 'reminders');
    assert.equal(out.count, 3);
    assert.deepEqual(out.nested, { user: { email: '[redacted]', id: 'u1' } });
  });

  it('a value cannot forge a second log line, and a field cannot hide the request id', () => {
    const line = logLine('info', 'hi\nfake', { note: 'a\nb', requestId: 'forged' }, { requestId: 'real-request-1' });
    assert.equal(line.msg, 'hi fake');
    assert.equal(line.note, 'a b');
    assert.equal(line.requestId, 'real-request-1');
    assert.equal(line.level, 'info');
  });

  it('a context with no workspace keeps the workspace a job logs itself (cron requests)', () => {
    const line = logLine('error', 'reminder failed', { workspaceId: 'ws_job' }, { requestId: 'cron-12345', workspaceId: undefined });
    assert.equal(line.workspaceId, 'ws_job');
    assert.equal(line.requestId, 'cron-12345');
  });

  it('a line written while a request is handled carries its context', () => {
    const line = logContext.run({ requestId: 'ctx-12345', route: '/api/v1/workspaces/:workspaceId' }, () => logLine('warn', 'inside'));
    assert.equal(line.requestId, 'ctx-12345');
    assert.equal(line.route, '/api/v1/workspaces/:workspaceId');
    assert.equal(logLine('warn', 'outside').requestId, undefined);
  });

  describe('the request middleware', () => {
    const lines: Record<string, unknown>[] = [];
    const realWrite = process.stdout.write.bind(process.stdout);
    let server: ReturnType<express.Express['listen']>;
    let base = '';

    const start = async () => {
      (process.stdout as unknown as { write: (chunk: string) => boolean }).write = (chunk: string) => {
        try { lines.push(JSON.parse(chunk)); return true; } catch { return realWrite(chunk); }
      };
      const app = express();
      app.use(requestContext());
      app.get('/api/v1/workspaces/:workspaceId/things/:id', (req, res) => {
        logger.info('handler ran', { email: 'secret@example.com' });
        res.json({ ok: true });
      });
      app.get('/api/v1/workspaces/:workspaceId/slow', (_req, res) => { res.write('partial'); });
      const nested = express.Router();
      nested.get('/', (_req, res) => { logger.info('nested ran'); res.json({ ok: true }); });
      app.use('/api/v1/workspaces/:workspaceId/customers/:customerId/portal-link', nested);
      app.post('/api/v1/transactions', express.json(), (_req, res) => { logger.info('posted'); res.json({ ok: true }); });
      app.get('/not-api', (_req, res) => { res.send('ok'); });
      await new Promise<void>(resolve => { server = app.listen(0, '127.0.0.1', () => resolve()); });
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    };
    after(() => {
      (process.stdout as unknown as { write: typeof realWrite }).write = realWrite;
      server?.close();
    });

    it('gives each request an id, logs its route, workspace and status, never the query or personal data', async () => {
      await start();
      const res = await fetch(`${base}/api/v1/workspaces/ws_log1/things/t9?token=abc&email=x@y.z`);
      assert.equal(res.status, 200);
      const id = res.headers.get('x-request-id');
      assert.match(id || '', /^[0-9a-f-]{36}$/);
      await new Promise(r => setTimeout(r, 20));
      const handler = lines.find(l => l.msg === 'handler ran');
      const access = lines.find(l => l.msg === 'request');
      assert.ok(handler && access, JSON.stringify(lines));
      assert.equal(handler.requestId, id);
      assert.equal(handler.email, '[redacted]');
      assert.equal(handler.route, '/api/v1/workspaces/:workspaceId/things/:id', 'a handler line has the route pattern');
      assert.equal(handler.workspaceId, 'ws_log1', 'a handler line has the workspace');
      assert.equal(access.requestId, id);
      assert.equal(access.route, '/api/v1/workspaces/:workspaceId/things/:id');
      assert.equal(access.workspaceId, 'ws_log1');
      assert.equal(access.status, 200);
      assert.equal(access.method, 'GET');
      assert.equal(typeof access.ms, 'number');
      assert.doesNotMatch(JSON.stringify(lines), /abc|x@y\.z|secret@example\.com/);
    });

    it('keeps a caller\'s plain request id, replaces an unsafe one, and does not log non-API requests', async () => {
      lines.length = 0;
      const kept = await fetch(`${base}/api/v1/workspaces/ws_log1/things/t1`, { headers: { 'x-request-id': 'trace-abc-123' } });
      assert.equal(kept.headers.get('x-request-id'), 'trace-abc-123');
      const replaced = await fetch(`${base}/api/v1/workspaces/ws_log1/things/t1`, { headers: { 'x-request-id': 'bad id <script>' } });
      assert.notEqual(replaced.headers.get('x-request-id'), 'bad id <script>');
      await fetch(`${base}/not-api`);
      await new Promise(r => setTimeout(r, 20));
      assert.equal(lines.filter(l => l.msg === 'request').length, 2);
    });

    it('a path no route matches is logged as a fixed label, never the raw path', async () => {
      lines.length = 0;
      const res = await fetch(`${base}/api/unknown/alice@example.com`);
      assert.equal(res.status, 404);
      await new Promise(r => setTimeout(r, 20));
      const access = lines.find(l => l.msg === 'request');
      assert.equal(access?.route, '(unmatched)');
      assert.doesNotMatch(JSON.stringify(lines), /alice@example\.com/);
    });

    it('still logs a request whose client went away before the response was complete', async () => {
      lines.length = 0;
      const controller = new AbortController();
      const res = await fetch(`${base}/api/v1/workspaces/ws_log1/slow`, { signal: controller.signal });
      const reader = res.body!.getReader();
      await reader.read();
      controller.abort();
      await new Promise(r => setTimeout(r, 100));
      const access = lines.filter(l => l.msg === 'request');
      assert.equal(access.length, 1, JSON.stringify(lines));
      assert.equal(access[0].aborted, true);
      assert.equal(access[0].route, '/api/v1/workspaces/:workspaceId/slow');
    });

    it('a nested router logs the mount pattern, not the IDs in it', async () => {
      lines.length = 0;
      await fetch(`${base}/api/v1/workspaces/ws_demo/customers/customer123/portal-link`);
      await new Promise(r => setTimeout(r, 20));
      const access = lines.find(l => l.msg === 'request');
      assert.equal(access?.route, '/api/v1/workspaces/:param/customers/:param/portal-link/');
      assert.doesNotMatch(String(access?.route), /customer123|ws_demo/);
    });

    it('a write that names its workspace in the body is logged with that workspace (not the body)', async () => {
      lines.length = 0;
      await fetch(`${base}/api/v1/transactions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: 'ws_body1', memo: 'private memo' }) });
      await new Promise(r => setTimeout(r, 20));
      assert.equal(lines.find(l => l.msg === 'posted')?.workspaceId, 'ws_body1');
      assert.equal(lines.find(l => l.msg === 'request')?.workspaceId, 'ws_body1');
      assert.doesNotMatch(JSON.stringify(lines), /private memo/);
    });
  });
});
