import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error -- untyped ESM script
import { runUptimeCheck } from '../../scripts/synthetic-uptime.mjs';

type Call = { url: string; init?: { method?: string; headers?: Record<string, string>; body?: string } };
const ok = (body: unknown = {}) => ({ ok: true, status: 200, statusText: 'OK', json: async () => body });

test('D-23: signs in through Supabase and calls /api/v1/workspaces with the Bearer token', async () => {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init?: Call['init']) => {
    calls.push({ url, init });
    return url.includes('/auth/v1/token') ? ok({ access_token: 'tok-123' }) : ok();
  };
  const result = await runUptimeCheck(fetchImpl, {
    baseUrl: 'https://ledgerflow.example.com/', email: 'uptime@example.com', password: 'secret',
    supabaseUrl: 'https://abc.supabase.co/', supabaseAnonKey: 'anon-key',
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls.map(c => c.url), [
    'https://ledgerflow.example.com/api/health',
    'https://abc.supabase.co/auth/v1/token?grant_type=password',
    'https://ledgerflow.example.com/api/v1/workspaces',
  ]);
  assert.equal(calls[1].init?.headers?.apikey, 'anon-key');
  assert.equal(calls[2].init?.headers?.authorization, 'Bearer tok-123');
});

test('D-23: without credentials only the health check runs', async () => {
  const calls: string[] = [];
  const result = await runUptimeCheck(async (url: string) => { calls.push(url); return ok(); }, { baseUrl: 'https://ledgerflow.example.com' });
  assert.equal(result.dashboardStatus, null);
  assert.deepEqual(calls, ['https://ledgerflow.example.com/api/health']);
});

test('D-23: a failing health check or a sign-in without a token fails the run', async () => {
  await assert.rejects(runUptimeCheck(async () => ({ ok: false, status: 503, statusText: 'Service Unavailable' }), { baseUrl: 'https://x.example' }), /Health check failed: 503/);
  await assert.rejects(runUptimeCheck(async () => ok({}), { baseUrl: 'https://x.example', email: 'a@b.c', password: 'p', supabaseUrl: 'https://s.example', supabaseAnonKey: 'k' }), /no access token/);
});
