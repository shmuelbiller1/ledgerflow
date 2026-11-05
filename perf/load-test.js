/**
 * F-30 — a load test a person can run: 50 users posting and reading reports at once.
 *
 *   k6 run perf/load-test.js -e BASE_URL=http://localhost:3000 -e TOKEN=... -e WORKSPACE_ID=...
 *
 * What it checks (and what it deliberately does not):
 *  - each virtual user posts one small balanced journal entry through the real ledger door
 *    (POST /api/v1/transactions/bulk) and reads the P&L and the trial balance;
 *  - thresholds: 95 % of requests under 2 s, fewer than 1 % failures, and no 5xx at all;
 *  - it never posts to a real customer's books: point BASE_URL at a disposable workspace, and
 *    every entry is a named load-test entry with an amount of 1 cent.
 * Results belong in docs/PERF_LOAD.md, dated, with the machine and the numbers.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://localhost:3000';
const TOKEN = __ENV.TOKEN;
const WORKSPACE = __ENV.WORKSPACE_ID;

const serverErrors = new Rate('server_errors');

export const options = {
  scenarios: {
    fifty_users: {
      executor: 'constant-vus',
      vus: 50,
      duration: __ENV.DURATION || '2m',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<2000'],
    http_req_failed: ['rate<0.01'],
    server_errors: ['rate==0'],
  },
};

const headers = () => ({
  'Content-Type': 'application/json',
  ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
});

export default function () {
  if (!WORKSPACE) {
    throw new Error('Set WORKSPACE_ID to a disposable workspace; this test writes entries.');
  }
  const stamp = `${__VU}-${__ITER}-${Date.now()}`;
  const entry = {
    workspaceId: WORKSPACE,
    transactions: [{
      id: `loadtest-${stamp}`,
      date: __ENV.DATE || new Date().toISOString().slice(0, 10),
      description: `Load test ${stamp}`,
      status: 'completed',
      type: 'journal',
      currency: __ENV.CURRENCY || 'USD',
      totalAmountCents: 1,
      lines: [
        { accountId: __ENV.DEBIT_ACCOUNT, amountCents: 1 },
        { accountId: __ENV.CREDIT_ACCOUNT, amountCents: -1 },
      ],
    }],
  };

  const posted = http.post(`${BASE}/api/v1/transactions/bulk`, JSON.stringify(entry), { headers: headers(), tags: { name: 'posting' } });
  serverErrors.add(posted.status >= 500);
  check(posted, { 'entry posted': r => r.status === 200 || r.status === 201 });

  const pl = http.get(`${BASE}/api/v1/reports/profit-and-loss?workspaceId=${WORKSPACE}`, { headers: headers(), tags: { name: 'pl' } });
  serverErrors.add(pl.status >= 500);
  check(pl, { 'P&L answered': r => r.status === 200 });

  const tb = http.get(`${BASE}/api/v1/reports/trial-balance?workspaceId=${WORKSPACE}`, { headers: headers(), tags: { name: 'trial-balance' } });
  serverErrors.add(tb.status >= 500);
  check(tb, { 'trial balance answered': r => r.status === 200 });

  sleep(1);
}
