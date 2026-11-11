import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { checkProductionConfig } from '../../scripts/check-prod-env';
import { WORKING_CAPITAL_AGING_ALGO } from '../lib/algorithms/working-capital-aging';
import { buildAlgorithmContext } from '../lib/algorithms/types';

test('F-04: checkProductionConfig passes valid production secrets and flags weak/placeholder configuration', () => {
  const passing = checkProductionConfig({
    NODE_ENV: 'production',
    SESSION_SECRET: '9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c',
    SYSTEM_SALT: '1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d',
    INVITE_SECRET: '7c6d5e4f3a2b1908f7e6d5c4b3a291807c6d5e4f',
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/lf_test',
  });
  assert.equal(passing.filter(r => r.status === 'fail').length, 0);

  const failing = checkProductionConfig({
    NODE_ENV: 'development',
    SESSION_SECRET: 'placeholder-secret-change-me-1234567890',
    SYSTEM_SALT: 'short',
    DATABASE_URL: 'https://not-postgres.example.com',
  });
  assert.ok(failing.filter(r => r.status === 'fail').length >= 4);

  const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['check:prod-env'], 'tsx scripts/check-prod-env.ts');
  const ci = fs.readFileSync(path.resolve(process.cwd(), '.github/workflows/ci.yml'), 'utf8');
  assert.ok(ci.includes('npm run check:prod-env'), 'CI validate job must run check:prod-env');
});

test('F-05: authRateLimiter is mounted on sensitive auth mutation routes', () => {
  const authRoutes = fs.readFileSync(path.resolve(process.cwd(), 'src/server/routes/authRoutes.ts'), 'utf8');
  assert.match(authRoutes, /app\.post\(["']\/api\/v1\/auth\/revoke-sessions["'],\s*authRateLimiter,\s*apiAuthenticate/);
  assert.match(authRoutes, /app\.delete\(["']\/api\/v1\/auth\/delete-account["'],\s*authRateLimiter,\s*apiAuthenticate/);
});

test('M-7: Working Capital & Invoice Aging algorithm surfaces contractual late-fee benchmark from paymentTerms.calculateLateFee', () => {
  const ctx = buildAlgorithmContext(
    [],
    [],
    '2025-03-15',
    { start: '2025-01-01', end: '2025-03-15' },
    'USD',
    {
      invoices: [{
        id: 'inv-late-1',
        workspaceId: 'ws-1',
        uid: 'u-1',
        customerId: 'c-1',
        customerName: 'Overdue Client',
        number: 'INV-LATE-1',
        date: '2025-01-01',
        dueDate: '2025-01-31',
        status: 'sent',
        amountCents: 100000,
        currency: 'USD',
      }],
      bills: [],
    }
  );
  const result = WORKING_CAPITAL_AGING_ALGO.compute(ctx, { lateThresholdDays: 30 });
  assert.ok(
    result.insights.some(line => line.includes('Contractual late-fee benchmark')),
    `Expected late-fee insight in: ${JSON.stringify(result.insights)}`
  );
});
