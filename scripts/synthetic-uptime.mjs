#!/usr/bin/env node
/**
 * D-23 (BN-05): Synthetic uptime check for the deployed Ledgerflow site.
 * Checks GET /api/health; with test credentials it also signs in through Supabase Auth (password grant)
 * and calls GET /api/v1/workspaces with the access token as a Bearer header, the way the app itself does.
 */

export async function runUptimeCheck(fetchImpl, config) {
  const baseUrl = (config?.baseUrl || '').replace(/\/+$/, '');
  if (!baseUrl) {
    throw new Error('UPTIME_BASE_URL is required');
  }
  const email = config?.email || '';
  const password = config?.password || '';
  const supabaseUrl = (config?.supabaseUrl || '').replace(/\/+$/, '');
  const supabaseAnonKey = config?.supabaseAnonKey || '';
  const healthPath = config?.healthPath || '/api/health';
  const dashboardPath = config?.dashboardPath || '/api/v1/workspaces';

  const healthRes = await fetchImpl(`${baseUrl}${healthPath}`, { method: 'GET' });
  if (!healthRes.ok) {
    throw new Error(`Health check failed: ${healthRes.status} ${healthRes.statusText}`);
  }
  // Without credentials there is no signed-in API to call: the health check is the whole check.
  if (!email || !password) {
    return { ok: true, baseUrl, healthStatus: healthRes.status, dashboardStatus: null };
  }
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('UPTIME_SUPABASE_URL and UPTIME_SUPABASE_ANON_KEY are required to sign in');
  }

  const loginRes = await fetchImpl(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: supabaseAnonKey },
    body: JSON.stringify({ email, password }),
  });
  if (!loginRes.ok) {
    throw new Error(`Synthetic sign-in failed: ${loginRes.status} ${loginRes.statusText}`);
  }
  const session = await loginRes.json();
  const accessToken = session?.access_token;
  if (!accessToken) {
    throw new Error('Synthetic sign-in returned no access token');
  }

  const dashRes = await fetchImpl(`${baseUrl}${dashboardPath}`, {
    method: 'GET',
    headers: { authorization: `Bearer ${accessToken}`, 'x-ledgerflow-request': '1' },
  });
  if (!dashRes.ok) {
    throw new Error(`Dashboard check failed: ${dashRes.status} ${dashRes.statusText}`);
  }

  return { ok: true, baseUrl, healthStatus: healthRes.status, dashboardStatus: dashRes.status };
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (isMain) {
  const baseUrl = process.env.UPTIME_BASE_URL || '';
  if (!baseUrl) {
    console.log('UPTIME_BASE_URL not set; skipping synthetic uptime check.');
    process.exit(0);
  }
  runUptimeCheck(fetch, {
    baseUrl,
    email: process.env.UPTIME_TEST_EMAIL || '',
    password: process.env.UPTIME_TEST_PASSWORD || '',
    supabaseUrl: process.env.UPTIME_SUPABASE_URL || '',
    supabaseAnonKey: process.env.UPTIME_SUPABASE_ANON_KEY || '',
  })
    .then(result => {
      console.log('Synthetic uptime check passed:', JSON.stringify(result));
    })
    .catch(err => {
      console.error('Synthetic uptime check failed:', err.message);
      process.exit(1);
    });
}
