/**
 * Shared setup for the audit acceptance tests: each one runs the real routers against a synthetic
 * isolated Postgres workspace with a test-injected identity, and they all need the same workspace,
 * chart accounts, and express app wiring. Extracted here so the audit tests share one setup instead
 * of repeating it (SonarCloud duplication).
 */
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import express from 'express';
import type { Server } from 'node:http';
import assert from 'node:assert/strict';
import type { Firestore } from '../../server/db/firestore';

export const auditDbUrl = process.env.LF_TEST_DATABASE_URL;
export const auditDbValid = !!auditDbUrl
  && new URL(auditDbUrl).hostname === '127.0.0.1'
  && new URL(auditDbUrl).port === '55439'
  && new URL(auditDbUrl).pathname === '/lf_test';

export type ChartAcc = { key: string; name: string; type: string; category: string; role?: string };

export interface AuditApp {
  db: Firestore;
  ws: string;
  id: (s: string) => string;
  server: Server;
  base: string;
  call: (path: string, body?: unknown) => Promise<Record<string, unknown>>;
  close: () => Promise<void>;
}

/**
 * Start a synthetic audit workspace with the given chart accounts and wire the given routers onto
 * an express app. Returns the db, workspace id, id helper, base URL, a `call` helper (POST that
 * asserts 200), and a `close` function.
 */
export async function startAuditApp(
  prefix: string,
  accounts: ChartAcc[],
  routes: Array<[string, unknown]>,
): Promise<AuditApp> {
  if (!auditDbUrl) throw new Error('Set LF_TEST_DATABASE_URL to a local audit database');
  process.env.DATABASE_URL = auditDbUrl;
  const { getDb } = await import('../../server/db/firestore');
  const db = getDb();
  const ws = `ws_audit_${prefix}_${crypto.randomBytes(5).toString('hex')}`;
  const id = (s: string) => `${ws}_${s}`;

  await db.collection('workspaces').doc(ws).set({
    uid: 'audit-owner', members: ['audit-owner'], name: `Synthetic ${prefix}`, currency: 'USD', timezone: 'UTC',
  });
  for (const acc of accounts) {
    await db.collection('chartAccounts').doc(id(acc.key)).set({
      workspaceId: ws, name: acc.name, type: acc.type, category: acc.category,
      ...(acc.role ? { role: acc.role } : {}),
    });
  }

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());
  app.use((req, _res, next) => { (req as never as { user: { uid: string } }).user = { uid: 'audit-owner' }; next(); });
  for (const [path, router] of routes) {
    app.use(path as never, router as never);
  }
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(r => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  async function call(path: string, body?: unknown) {
    const res = await fetch(`${base}${path}`, body
      ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      : {});
    const data = await res.json();
    assert.equal(res.status, 200, JSON.stringify(data));
    return data as Record<string, unknown>;
  }

  return {
    db, ws, id, server, base, call,
    close: () => new Promise<void>(r => { server.close(() => r()); }),
  };
}

/** The standard three accounts most audit tests need. */
export const standardAccounts: ChartAcc[] = [
  { key: 'ar', name: 'Accounts Receivable', type: 'asset', category: 'Receivables' },
  { key: 'sales', name: 'Sales', type: 'revenue', category: 'Revenue' },
  { key: 'cash', name: 'Cash', type: 'asset', category: 'Cash', role: 'cash' },
];

/** The standard three routers most audit tests need. */
export async function standardRoutes(): Promise<Array<[string, unknown]>> {
  const { documentPostRouter } = await import('../../server/routes/documentPostRoutes');
  const { paymentRouter } = await import('../../server/routes/paymentRoutes');
  const { reportRouter } = await import('../../server/routes/reportRoutes');
  return [
    ['/api/v1/documents', documentPostRouter],
    ['/api/v1/payments', paymentRouter],
    ['/api/v1/reports', reportRouter],
  ];
}

/** Delete all rows for a workspace from the standard audit tables. */
export async function cleanupAuditWorkspace(db: Firestore, ws: string): Promise<void> {
  for (const table of ['reconciliations', 'bankLines', 'transactions', 'assets', 'chartAccounts', 'auditLogs', 'idempotencyKeys', 'workspaces']) {
    await db.pool.query(`delete from public."${table}" where workspace_id=$1 or id=$1`, [ws]);
  }
}
