import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';

const hasDb = Boolean(process.env.LF_TEST_DATABASE_URL);
const WRITE = new Set(['post', 'put', 'patch', 'delete']);

/** Addresses that take no bearer token by design (a provider signature, a secret, or nothing: a browser report). */
const PUBLIC_NO_TOKEN = [
  /^\/api\/webhook\//, /^\/api\/csp-report/, /^\/api\/v1\/telemetry\//, /^\/api\/v1\/email-events/, /^\/api\/v1\/invites\//,
  /^\/api\/v1\/invoices\/public\//, /^\/api\/cron\//, /^\/api\/v1\/auth\//, /^\/api\/v1\/registration-status/, /^\/api\/v1\/logs/,
];
/** Of those, the ones that answer 2xx to anyone (they record a browser's report and nothing else). */
const PUBLIC_ALWAYS_2XX = [/^\/api\/csp-report$/];

interface RouteLayer { route?: { path: string | string[]; methods: Record<string, boolean> }; handle?: { stack?: RouteLayer[] }; matchers?: Array<(path: string) => unknown>; name?: string }

/** Mount prefixes named in server.ts and the register*Routes files (the layer itself keeps only a matcher). */
function knownPrefixes(): string[] {
  const sources = [fs.readFileSync('server.ts', 'utf8'), ...fs.readdirSync('src/server/routes').filter(f => f.endsWith('.ts')).map(f => fs.readFileSync(`src/server/routes/${f}`, 'utf8'))];
  const found = new Set<string>();
  for (const src of sources) for (const m of src.matchAll(/\.use\(\s*["'`](\/api[^"'`]*)["'`]/g)) found.add(m[1].replace(/\/$/, ''));
  found.add('/api/cron');
  return [...found].sort((a, b) => b.length - a.length);
}

function collectRoutes(stack: RouteLayer[], prefix: string, prefixes: string[], out: Array<{ method: string; path: string }>) {
  for (const layer of stack) {
    if (layer.route) {
      for (const path of Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path]) {
        for (const method of Object.keys(layer.route.methods)) if (WRITE.has(method)) out.push({ method, path: prefix + path });
      }
    } else if (layer.handle?.stack) {
      // The shortest known prefix the layer's own matcher accepts is its mount (a matcher accepts any longer path too).
      const mount = prefixes.filter(p => p.startsWith(prefix) && layer.matchers?.some(matcher => matcher(p.slice(prefix.length) || '/')))
        .sort((a, b) => a.length - b.length)[0] ?? prefix;
      collectRoutes(layer.handle.stack, mount, prefixes, out);
    }
  }
}

/** A concrete address for an Express path: params and wildcards become harmless values. */
function concrete(path: string): string {
  return path.replace(/\/\*[a-zA-Z_]*/g, '/x').replace(/:[A-Za-z_]+(\([^)]*\))?\??/g, m => (m.includes('workspace') || m.includes('Workspace') ? 'ws-assistant-test' : 'x'))
    .replace(/\{[^}]*\}/g, 'x').replace(/[()?+*]/g, '');
}

/**
 * CMD-1 part 3 / SBX-1 "What the assistant can call": the assistant token is accepted by the
 * sandbox drafting and read routes and by nothing that commits to the real books. This calls every
 * write route of the real app with a valid assistant token and asserts each one is refused.
 */
describe('an assistant token is refused by every write route except sandbox drafting', { skip: !hasDb && 'needs LF_TEST_DATABASE_URL' }, () => {
  let server: Server | undefined;
  let base = '';
  let routes: Array<{ method: string; path: string }> = [];
  let token = '';
  let createApp: () => Promise<import('express').Express>;
  const prevEnv: Record<string, string | undefined> = {};

  /** Each app has its own per-IP limiter (100 a minute); the sweep rotates apps so a 429 never stands in for a refusal. */
  async function freshServer() {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    const app = await createApp();
    server = await new Promise<Server>(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  before(async () => {
    for (const key of ['DATABASE_URL', 'SUPABASE_JWT_SECRET', 'SUPABASE_URL', 'SESSION_SECRET', 'SYSTEM_SALT', 'INVITE_SECRET', 'RATE_LIMIT_HIGH', 'CRON_SECRET']) prevEnv[key] = process.env[key];
    process.env.DATABASE_URL = process.env.LF_TEST_DATABASE_URL;
    process.env.SUPABASE_JWT_SECRET ||= 'test-assistant-jwt-secret-at-least-32-chars-long!!';
    process.env.SUPABASE_URL ||= 'https://assistant-routes.supabase.test';
    process.env.SESSION_SECRET ||= 'test-assistant-session-secret-000000000000001';
    process.env.SYSTEM_SALT ||= 'test-assistant-system-salt-0000000000000001';
    process.env.INVITE_SECRET ||= 'test-assistant-invite-secret-00000000000001';
    process.env.CRON_SECRET ||= 'test-assistant-cron-secret-000000000000000001';
    process.env.RATE_LIMIT_HIGH = '1';
    ({ createApp } = await import('../../server'));
    const { issueAssistantToken } = await import('../server/auth/assistantToken');
    const app = await createApp();
    token = issueAssistantToken({ sandboxId: randomUUID(), personId: 'assistant-test-person', workspaceId: 'ws-assistant-test', role: 'owner', aal: 'aal2' }).token;
    const prefixes = knownPrefixes();
    collectRoutes((app as unknown as { router: { stack: RouteLayer[] } }).router.stack, '', prefixes, routes);
    routes = routes.filter((r, i, all) => all.findIndex(o => o.method === r.method && o.path === r.path) === i);
    await freshServer();
  });

  after(async () => {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    for (const [key, value] of Object.entries(prevEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  });

  test('the route inventory is real: it includes the command router, the legacy writes and the sandbox routes', () => {
    assert.ok(routes.length > 150, `write routes found: ${routes.length}`);
    const paths = routes.map(r => `${r.method} ${r.path}`);
    assert.ok(paths.includes('post /api/v1/commands/:name'), paths.filter(p => p.includes('commands')).join(', '));
    assert.ok(paths.some(p => p.startsWith('post /api/v1/transactions')));
    assert.ok(paths.includes('post /api/v1/workspaces/:workspaceId/sandboxes/:sandboxId/accept'));
    assert.ok(paths.includes('post /api/v1/sandboxes/:sandboxId/steps'));
    assert.ok(paths.includes('post /api/v1/sandboxes/:sandboxId/tools/:tool'));
  });

  test('every write route answers 401 or 403 to the assistant token, except the sandbox drafting and tool routes, which answer for their own sandbox', { timeout: 120_000 }, async () => {
    const allowed = /^\/api\/v1\/sandboxes\/:sandboxId(?:\/steps(?:\/order|\/:stepId)?|\/tools\/:tool|\/reports|\/balances)?$/;
    const accepted: string[] = [];
    const leaked: string[] = [];
    let sent = 0;
    const send = async (method: string, path: string, withToken: boolean, retried = false): Promise<number> => {
      if (++sent % 40 === 0) await freshServer();
      const res = await fetch(`${base}${path}`, {
        method: method.toUpperCase(),
        headers: { ...(withToken ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json', 'X-LedgerFlow-Request': '1' },
        body: JSON.stringify({ input: {}, workspaceId: 'ws-assistant-test', revision: 'r', command: 'customer.create' }),
      });
      await res.arrayBuffer();
      // The sign-in and brain addresses share strict, store-backed limiters (shared across apps and with any
      // suite running beside this one) that answer before any identity is read: a 429 there says nothing
      // about the token, so the counters are cleared and the address asked once more.
      if (res.status === 429 && (path.startsWith('/api/v1/auth/') || path.startsWith('/api/v1/brain/')) && !retried) {
        const { getDb } = await import('../server/db/firestore');
        await getDb().pool.query(`delete from ${getDb().tableSource('rateLimitEntries')}`);
        return send(method, path, withToken, true);
      }
      if (res.status === 429 && !path.startsWith('/api/v1/auth/')) assert.fail(`${method} ${path} was rate limited; the sweep must rotate apps sooner`);
      return res.status;
    };
    for (const route of routes) {
      const path = concrete(route.path);
      if (PUBLIC_NO_TOKEN.some(pattern => pattern.test(route.path))) {
        // Public addresses that read no bearer token at all: the token changes nothing about their answer.
        const [withToken, without] = [await send(route.method, path, true), await send(route.method, path, false)];
        if (withToken !== without || withToken < 400 && !PUBLIC_ALWAYS_2XX.some(pattern => pattern.test(route.path))) leaked.push(`${route.method} ${route.path} → ${withToken} (without token ${without})`);
        continue;
      }
      const status = await send(route.method, path, true);
      const res = { status };
      if (allowed.test(route.path)) {
        // These take the token; the sandbox in it does not exist, so they refuse for that reason, never 401 for the token.
        if (res.status === 401 || res.status >= 500) leaked.push(`${route.method} ${route.path} → ${res.status}`);
        accepted.push(`${route.method} ${route.path}`);
        continue;
      }
      if (res.status !== 401 && res.status !== 403) leaked.push(`${route.method} ${route.path} → ${res.status}`);
    }
    assert.deepEqual(leaked, []);
    assert.ok(accepted.length >= 3, `the sandbox drafting routes were exercised: ${accepted.join(', ')}`);
  });
});
