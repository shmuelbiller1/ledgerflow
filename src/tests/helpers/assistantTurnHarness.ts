/**
 * Shared fixture for the assistant security suites (S-41…S-45): the real sandbox routes over the
 * real test database (LF_TEST_DATABASE_URL), with a scripted model client in place of the provider.
 * The turn handler, read tools, review service and rate limiters are the production code paths.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { quoteIdent } from '../../server/db/pg/sql';
import type { Firestore } from '../../server/db/firestore';
import type { ModelClient } from '../../server/services/assistantTurn';
// aliased: the helper's name starts with "use", which the react-hooks lint mistakes for a Hook
import { useLiveApiEnv as configureLiveApiEnv } from './liveApiServer';

/** Tables the fixtures write or the turns may touch; cleaned per workspace after each test. */
export const CLEAN_TABLES = [
  'auditLogs', 'billingLedgerTraces', 'chartAccounts', 'customers', 'vendors', 'invoices', 'bills', 'payments',
  'transactions', 'paymentAllocations', 'numberingSeries', 'documents', 'notifications', 'emailEvents',
  'idempotencyKeys', 'dimensionNodes',
] as const;

/** The book tables a turn must never write: compared before and after a turn. */
export const BOOK_TABLES = CLEAN_TABLES.filter(table => table !== 'billingLedgerTraces');

export interface CallResult { status: number; json: Record<string, unknown>; headers: Record<string, string> }

export interface ScriptedModel {
  requests: Array<Record<string, unknown>>;
  client: ModelClient;
}

/** A model client that answers `reply(callNumber, request)`; every request is kept for inspection. */
export function scriptedModel(reply: (number: number, request: Record<string, unknown>) => unknown): ScriptedModel {
  const requests: Array<Record<string, unknown>> = [];
  return {
    requests,
    client: { models: { generateContent: async request => {
      requests.push(request as Record<string, unknown>);
      return reply(requests.length, request as Record<string, unknown>);
    } } },
  };
}

/** Every piece of text a model request carries: prompt, question, facts and tool results. */
export function requestText(request: Record<string, unknown>): string {
  return JSON.stringify(request);
}

export interface FixtureOptions {
  /** Injected in place of the Gemini client; return null to model "no key configured". */
  modelClient?: () => ModelClient | null;
  /** The turn routes' limiter; omit to use the production `brainRateLimiter`. */
  turnRateLimit?: express.RequestHandler;
}

/** The cleanup registration the fixture needs; `TestContext` satisfies it. */
export interface AfterHost { after(fn: () => unknown): unknown }

/**
 * A cleanup host for suite-level `before` hooks (node's hook context has no `after`):
 * register with it as usual, then `await host.run()` in the suite's `after` hook.
 */
export function cleanupHost(): AfterHost & { run(): Promise<void> } {
  const cleanups: Array<() => unknown> = [];
  return {
    after(fn: () => unknown) { cleanups.push(fn); },
    async run() { for (const fn of cleanups.reverse()) await fn(); },
  };
}

export interface AssistantFixture {
  live: Firestore;
  server: Server;
  base: string;
  tag: string;
  workspaceId: string;
  owner: string;
  teammate: string;
  bankId: string;
  arId: string;
  salesId: string;
  customerId: string;
  invoiceId: string;
  sandboxId: string;
  assistantToken: string;
  /** One request on the person's sandbox routes (x-test-uid signs the person in). */
  person(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<CallResult>;
  /** One request on the assistant's routes (the sandbox's assistant token). */
  assistantCall(method: string, path: string, body?: unknown): Promise<CallResult>;
  /** The sandbox's assistant turn (`POST /:sandboxId/assistant/turn`) as `uid` (default: the owner). */
  turn(question: string, uid?: string): Promise<CallResult>;
  /** The read-only live-books turn (`POST /assistant/turn`) as `uid` (default: the owner). */
  liveTurn(question: string, uid?: string): Promise<CallResult>;
  count(table: string): Promise<number>;
  /** Row counts and content versions per table; unchanged means nothing was written. */
  fingerprint(tables?: readonly string[]): Promise<Array<Record<string, unknown>>>;
}

const JSON_HEADERS = { 'content-type': 'application/json' };

/**
 * Workspace, books, an open sandbox and its assistant token over the real routes.
 * `t.after` removes every row the fixture created.
 */
export async function startAssistantFixture(t: AfterHost, options: FixtureOptions = {}): Promise<AssistantFixture> {
  const url = process.env.LF_TEST_DATABASE_URL;
  assert.ok(url, 'startAssistantFixture needs LF_TEST_DATABASE_URL');
  // The shared rate limiters bind getDb() when their module loads; point the app env at the test
  // database before importing the routes (the same setup the live-api suites use).
  configureLiveApiEnv('assistant-security');
  process.env.SESSION_SECRET ||= 'test-session-secret-for-assistant-tokens-0001';
  const { Firestore: PgFirestore } = await import('../../server/db/firestore');
  const { createSandboxAssistantRouter, createSandboxPersonRouter } = await import('../../server/routes/sandboxRoutes');
  const live = new PgFirestore({ connectionString: url, max: 4 });
  t.after(async () => {
    await live.terminate();
  });

  const tag = crypto.randomBytes(4).toString('hex');
  const workspaceId = `s-ai-${tag}`;
  const id = (name: string) => `${workspaceId}-${name}`;
  const owner = id('owner');
  const teammate = id('teammate');
  const bankId = id('bank');
  const arId = id('ar');
  const salesId = id('sales');
  const customerId = id('cust');
  const invoiceId = id('inv');
  const now = new Date().toISOString();

  t.after(async () => {
    await live.pool.query('delete from sandbox.sandboxes where workspace_id = $1', [workspaceId]);
    for (const table of CLEAN_TABLES) await live.pool.query(`delete from public.${quoteIdent(table)} where workspace_id = $1`, [workspaceId]);
    await live.doc(`workspaces/${workspaceId}`).delete();
  });

  await live.doc(`workspaces/${workspaceId}`).create({
    uid: owner, name: 'Assistant security fixture', members: [owner, teammate],
    roles: { [teammate]: 'bookkeeper' }, currency: 'USD', timezone: 'UTC', fiscalYearStartMonth: 1,
    plan: 'pro', bypassBilling: true, createdAt: now,
  });
  for (const [key, name, type, category] of [
    ['bank', 'Bank', 'asset', 'Cash'], ['ar', 'Receivables', 'asset', 'Receivables'], ['sales', 'Sales', 'revenue', 'Revenue'],
  ] as const) {
    await live.doc(`chartAccounts/${id(key)}`).create({ id: id(key), workspaceId, name, type, category, createdAt: now });
  }
  await live.doc(`numberingSeries/${workspaceId}_payment`).create({ workspaceId, type: 'payment', prefix: 'PAY-', nextNumber: 8, padding: 4 });
  await live.doc(`customers/${customerId}`).create({ id: customerId, workspaceId, name: 'Acme Design', email: 'billing@acme.test', balanceCents: 0, createdAt: now });
  await live.doc(`invoices/${invoiceId}`).create({
    id: invoiceId, workspaceId, uid: owner, customerId, customerName: 'Acme Design',
    number: `INV-${tag}`, invoiceNumber: `INV-${tag}`, date: '2026-10-01', dueDate: '2026-12-01',
    status: 'sent', currency: 'USD', exchangeRate: 1, amountCents: 12_500, totalAmountCents: 12_500, balanceDueCents: 12_500,
    lines: [{ description: 'Design work', quantity: 1, unitPriceCents: 12_500, amountCents: 12_500 }], createdAt: now,
  });

  const app = express();
  app.use(express.json());
  // The person's sign-in, as the real apiAuthenticate would set it (a test-only header).
  app.use('/api/v1/workspaces/:workspaceId/sandboxes', (req, _res, next) => {
    const uid = req.header('x-test-uid');
    if (uid) Object.assign(req, {
      user: {
        uid, email: `${uid}@example.test`, aal: req.header('x-test-aal') || 'aal2',
        ...(req.header('x-test-apikey') ? { usedApiKeyId: 'key' } : {}),
        ...(req.header('x-test-assistant') ? { assistantSandboxId: req.header('x-test-assistant') } : {}),
      },
    });
    next();
  }, createSandboxPersonRouter(live, {
    ...(options.modelClient ? { modelClient: options.modelClient } : {}),
    ...(options.turnRateLimit ? { turnRateLimit: options.turnRateLimit } : {}),
  }));
  app.use('/api/v1/sandboxes', createSandboxAssistantRouter(live));
  app.use((_req, res) => res.status(404).json({ status: 'error', code: 'NOT_FOUND' }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<CallResult> {
    const sent: Record<string, string> = { ...headers };
    if (body !== undefined) sent['content-type'] = 'application/json';
    const res = await fetch(`${base}${path}`, { method, headers: sent, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json: Record<string, unknown>;
    try { json = JSON.parse(text) as Record<string, unknown>; } catch { json = { raw: text }; }
    return { status: res.status, json, headers: Object.fromEntries(res.headers) };
  }

  const opened = await call('POST', `/api/v1/workspaces/${workspaceId}/sandboxes`, undefined, { 'x-test-uid': owner });
  assert.equal(opened.status, 201, JSON.stringify(opened.json));
  const sandbox = opened.json.sandbox as { id: string; revision: string };
  const assistantToken = (opened.json.assistant as { token: string }).token;
  const sandboxId = sandbox.id;

  const person = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    call(method, `/api/v1/workspaces/${workspaceId}/sandboxes${path}`, body, { 'x-test-uid': owner, ...headers });
  const assistantCall = (method: string, path: string, body?: unknown) =>
    call(method, `/api/v1/sandboxes/${sandboxId}${path}`, body, { authorization: `Bearer ${assistantToken}` });
  const turn = (question: string, uid = owner) =>
    call('POST', `/api/v1/workspaces/${workspaceId}/sandboxes/${sandboxId}/assistant/turn`, { question }, { 'x-test-uid': uid, ...JSON_HEADERS });
  const liveTurn = (question: string, uid = owner) =>
    call('POST', `/api/v1/workspaces/${workspaceId}/sandboxes/assistant/turn`, { question }, { 'x-test-uid': uid, ...JSON_HEADERS });
  const count = async (table: string) =>
    (await live.pool.query(`select count(*)::int as n from public.${quoteIdent(table)} where workspace_id = $1`, [workspaceId])).rows[0].n as number;
  const fingerprint = async (tables: readonly string[] = BOOK_TABLES) => Promise.all(tables.map(async table =>
    (await live.pool.query(`select count(*)::int as n, sandbox.content_version(jsonb_agg(data order by id)) as version
      from public.${quoteIdent(table)} where workspace_id = $1`, [workspaceId])).rows[0]));

  return {
    live, server, base, tag, workspaceId, owner, teammate, bankId, arId, salesId, customerId, invoiceId,
    sandboxId, assistantToken, person, assistantCall, turn, liveTurn, count, fingerprint,
  };
}
