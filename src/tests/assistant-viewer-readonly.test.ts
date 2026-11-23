import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Firestore } from '../server/db/firestore';
import { createSandboxPersonRouter } from '../server/routes/sandboxRoutes';

test('live-book assistant enforces membership, second factor and read-only tools server-side', async t => {
  const workspace: Record<string, unknown> = { uid: 'owner', members: ['owner', 'viewer'], roles: { viewer: 'viewer' }, currency: 'USD', bypassBilling: true };
  const writes: string[] = [];
  const reads: Array<{ collection: string; workspace: unknown }> = [];
  const queries: string[] = [];
  const query = async (sql: string) => { queries.push(sql); return { rows: [] }; };
  const db = {
    tableSource: (table: string) => `"${table}"`,
    pool: { query, connect: async () => ({ query, release: () => {} }) },
    collection: (collection: string) => ({
      doc: (id: string) => ({
        get: async () => ({ exists: id === 'w', data: () => collection === 'workspaces' && id === 'w' ? workspace : undefined }),
        set: async () => { writes.push(collection); },
      }),
      where: (_field: string, _op: string, value: unknown) => ({
        limit: () => ({ get: async () => {
          reads.push({ collection, workspace: value });
          return { docs: collection === 'customers' && value === 'w' ? [{ id: 'a', data: () => ({ workspaceId: 'w', name: 'Acme', secret: 'hidden' }) }] : [] };
        } }),
      }),
    }),
  } as unknown as Firestore;
  const calls: Array<Record<string, unknown>> = [];
  const responses = [
    { functionCalls: [{ name: 'propose_invoice_create', args: {} }, { name: 'find_command', args: { words: 'create invoice' } }, { name: 'search_records', args: { text: 'Acme', collections: ['customers'] } }, { name: 'run_report', args: { report: 'group-summary', params: { groupId: 'other' } } }, { name: 'list_records', args: { collection: 'numberingSeries' } }] },
    { text: 'Acme is a customer.' },
  ];
  const app = express(); app.use(express.json());
  app.use('/api/v1/workspaces/:workspaceId/sandboxes', (req, _res, next) => {
    const uid = req.header('x-test-uid');
    if (uid) Object.assign(req, { user: { uid, aal: req.header('x-test-aal') || 'aal2', ...(req.header('x-test-apikey') ? { usedApiKeyId: 'key' } : {}), ...(req.header('x-test-assistant') ? { assistantSandboxId: 'sandbox' } : {}) } });
    next();
  }, createSandboxPersonRouter(db, { turnRateLimit: (_req, _res, next) => next(), modelClient: () => ({ models: { generateContent: async request => { calls.push(request); return responses.shift(); } } }) }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/workspaces`;
  const send = async (ws: string, uid: string, headers: Record<string, string> = {}, question = 'Explain Acme and create an invoice') => {
    const response = await fetch(`${base}/${ws}/sandboxes/assistant/turn`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-test-uid': uid, ...headers }, body: JSON.stringify({ question }) });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  };
  assert.equal((await send('w', 'stranger')).status, 403);
  assert.equal((await send('other', 'viewer')).status, 403);
  assert.equal((await send('w', 'viewer', { 'x-test-apikey': '1' })).status, 403);
  assert.equal((await send('w', 'viewer', { 'x-test-assistant': '1' })).status, 403);
  workspace.requireTwoStep = true;
  assert.equal((await send('w', 'viewer', { 'x-test-aal': 'aal1' })).status, 403);
  const code = await send('w', 'viewer', {}, 'Find customer Acme');
  assert.equal(code.status, 200, JSON.stringify(code.body));
  assert.match(String(code.body.answer), /Acme/);
  assert.equal(calls.length, 0, 'exact code route works without a model');
  reads.length = 0; writes.length = 0;
  const result = await send('w', 'viewer');
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.answer, 'Acme is a customer.');
  const config = calls[0].config as { systemInstruction: string; tools: Array<{ functionDeclarations: Array<{ name: string }> }> };
  const offered = config.tools[0].functionDeclarations.map(tool => tool.name);
  assert.deepEqual(new Set(offered), new Set(['list_records', 'get_record', 'search_records', 'calculate', 'run_report', 'explain_number', 'ask_books']));
  assert.match(config.systemInstruction, /read-only on the live books/);
  const followup = JSON.stringify(calls[1].contents);
  assert.match(followup, /This tool was not offered/);
  assert.match(followup, /read-only assistant; this tool is not available/);
  assert.match(followup, /Acme/);
  assert.doesNotMatch(followup, /hidden/);
  assert.deepEqual(reads, [{ collection: 'customers', workspace: 'w' }]);
  assert.deepEqual(writes, ['billingLedgerTraces']);
  assert.ok(queries.some(sql => sql.includes('billingLedgerTraces')));
  // Losing membership is checked on every turn, not just when the UI mounts.
  workspace.members = ['owner'];
  assert.equal((await send('w', 'viewer')).status, 403);
});
