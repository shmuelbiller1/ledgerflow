/**
 * AUD-12: the Content-Security-Policy follows the configured Supabase project instead of one
 * hard-coded host. Two project URLs each get their own https + wss origin in connect-src and never
 * the other's — in the Express (helmet) header and in the generated static vercel.json header —
 * and the vercel.json in the repo matches the project the build uses by default.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { SUPABASE_PROJECT as supabaseConfig } from '../config/supabaseProject';
import { applySecurityMiddleware } from '../server/http/securityMiddleware';
import {
  clientSupabaseUrl, configuredSupabaseConnectSources, staticCspHeaderValue, supabaseConnectSources,
  vercelCspValue, withVercelCsp,
} from '../server/http/contentSecurityPolicy';

const PROJECT_A = 'https://aaaaprojectref.supabase.co';
const PROJECT_B = 'https://bbbbprojectref.supabase.co/';
const A = ['https://aaaaprojectref.supabase.co', 'wss://aaaaprojectref.supabase.co'];
const B = ['https://bbbbprojectref.supabase.co', 'wss://bbbbprojectref.supabase.co'];
const OTHER_CONNECT = ["'self'", 'https://*.plaid.com', 'https://*.googleapis.com'];

const connectSrcOf = (policy: string) => {
  const directive = policy.split(';').map(d => d.trim()).find(d => d.startsWith('connect-src '));
  assert.ok(directive, `no connect-src in: ${policy}`);
  return directive.split(/\s+/).slice(1);
};

function assertOnlyProject(policy: string, own: string[], other: string[]) {
  const sources = connectSrcOf(policy);
  for (const s of own) assert.ok(sources.includes(s), `${s} missing from connect-src ${sources.join(' ')}`);
  for (const s of other) assert.ok(!sources.includes(s), `${s} must not be in connect-src ${sources.join(' ')}`);
  for (const s of OTHER_CONNECT) assert.ok(sources.includes(s), `${s} kept`);
  assert.ok(!sources.some(s => /^(https?|wss?):\/\/\*\.supabase\.co$/.test(s) || s === '*' || s === 'https:'), 'no wildcard project');
}

/** The CSP header Express sends in production with the given Supabase env. */
async function expressCsp(env: Record<string, string | undefined>): Promise<string> {
  const keys = ['NODE_ENV', 'SUPABASE_URL', 'VITE_SUPABASE_URL'];
  const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  try {
    for (const k of keys) delete process.env[k];
    Object.assign(process.env, { NODE_ENV: 'production' }, env);
    const app = express();
    applySecurityMiddleware(app, () => true);
    app.get('/x', (_req, res) => { res.send('ok'); });
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    try {
      const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/x`);
      return res.headers.get('content-security-policy') || '';
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

describe('CSP connect-src follows the configured Supabase project (AUD-12)', () => {
  test('project origins: https for data, wss for realtime, trailing slash/path ignored', () => {
    assert.deepEqual(supabaseConnectSources(PROJECT_A), A);
    assert.deepEqual(supabaseConnectSources(PROJECT_B), B);
    assert.deepEqual(supabaseConnectSources('http://127.0.0.1:54321/'), ['http://127.0.0.1:54321', 'ws://127.0.0.1:54321']);
    assert.throws(() => supabaseConnectSources('not a url'));
  });

  test('Express (helmet) header: project A gets A and not B; project B gets B and not A', async () => {
    assertOnlyProject(await expressCsp({ SUPABASE_URL: PROJECT_A, VITE_SUPABASE_URL: PROJECT_A }), A, B);
    assertOnlyProject(await expressCsp({ SUPABASE_URL: PROJECT_B, VITE_SUPABASE_URL: PROJECT_B }), B, A);
    // Only the server variable set: the server project is still the one allowed.
    assertOnlyProject(await expressCsp({ SUPABASE_URL: PROJECT_B }), B, A);
  });

  test('when the browser and server name different projects, both (and only those) are allowed', () => {
    const sources = configuredSupabaseConnectSources({ VITE_SUPABASE_URL: PROJECT_A, SUPABASE_URL: PROJECT_B });
    assert.deepEqual(sources, [...A, ...B]);
    assert.deepEqual(configuredSupabaseConnectSources({ VITE_SUPABASE_URL: PROJECT_A, SUPABASE_URL: PROJECT_A }), A);
  });

  test('static (vercel.json) header generated for A or B carries only that project', () => {
    assertOnlyProject(staticCspHeaderValue(clientSupabaseUrl({ VITE_SUPABASE_URL: PROJECT_A })), A, B);
    assertOnlyProject(staticCspHeaderValue(clientSupabaseUrl({ VITE_SUPABASE_URL: PROJECT_B })), B, A);
  });

  test('the committed vercel.json matches the policy generated for the default project, and regenerating changes only connect-src', () => {
    const vercel = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'vercel.json'), 'utf8')) as unknown;
    const committed = vercelCspValue(vercel);
    assert.equal(committed, staticCspHeaderValue(clientSupabaseUrl({})), 'run `npm run csp:vercel` after changing the project');
    assert.equal(clientSupabaseUrl({}), supabaseConfig.url);

    const forB = vercelCspValue(withVercelCsp(vercel, PROJECT_B))!;
    assertOnlyProject(forB, B, supabaseConnectSources(supabaseConfig.url));
    const withoutConnect = (p: string) => p.split('; ').filter(d => !d.startsWith('connect-src ')).join('; ');
    assert.equal(withoutConnect(forB), withoutConnect(committed!), 'every other directive is kept');
    const original = JSON.parse(JSON.stringify(vercel)) as { headers: unknown };
    const regenerated = withVercelCsp(vercel, PROJECT_B) as { headers: unknown; rewrites: unknown };
    assert.deepEqual({ ...regenerated, headers: null }, { ...original, headers: null }, 'nothing outside the headers changes');
  });
});
