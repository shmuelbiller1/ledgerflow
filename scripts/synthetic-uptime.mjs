#!/usr/bin/env node
/**
 * D-23 (BN-05): Synthetic uptime check for the deployed Ledgerflow site.
 * Signs in as a test user and verifies the health + dashboard APIs respond 200.
 */

export async function runUptimeCheck(fetchImpl, config) {
  const baseUrl = (config?.baseUrl || '').replace(/\/+$/, '');
  if (!baseUrl) {
    throw new Error('UPTIME_BASE_URL is required');
  }
  const email = config?.email || '';
  const password = config?.password || '';
  const loginPath = config?.loginPath || '/api/auth/login';
  const healthPath = config?.healthPath || '/api/health';
  const dashboardPath = config?.dashboardPath || '/api/workspaces';

  const healthRes = await fetchImpl(`${baseUrl}${healthPath}`, { method: 'GET' });
  if (!healthRes.ok) {
    throw new Error(`Health check failed: ${healthRes.status} ${healthRes.statusText}`);
  }

  let cookieHeader = '';
  if (email && password) {
    const loginRes = await fetchImpl(`${baseUrl}${loginPath}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!loginRes.ok) {
      throw new Error(`Synthetic sign-in failed: ${loginRes.status} ${loginRes.statusText}`);
    }
    cookieHeader = loginRes.headers?.get?.('set-cookie') || '';
  }

  const dashRes = await fetchImpl(`${baseUrl}${dashboardPath}`, {
    method: 'GET',
    headers: cookieHeader ? { cookie: cookieHeader } : {},
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
  })
    .then(result => {
      console.log('Synthetic uptime check passed:', JSON.stringify(result));
    })
    .catch(err => {
      console.error('Synthetic uptime check failed:', err.message);
      process.exit(1);
    });
}
