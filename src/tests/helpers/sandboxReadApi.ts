import type { AddressInfo } from 'node:net';
import type { Firestore } from '../../server/db/firestore';
import { seedSandbox } from './sandbox';

/** Mounts the actual read routers with a server-chosen handle and test-only identity middleware. */
export async function startBooksReadApi(live: Firestore, books = live) {
  const express = (await import('express')).default;
  const { createReportRouter } = await import('../../server/routes/reportRoutes');
  const { createBalanceRouter } = await import('../../server/routes/balanceRoutes');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, { user: { uid: String(req.header('x-test-uid') || ''), developerWorkspaceId: req.header('x-test-key-workspace') } });
    next();
  });
  app.use('/api/v1/reports', createReportRouter(live, books));
  app.use('/api/v1/balances', createBalanceRouter(live, books));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    stop: () => new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve())),
  };
}

export async function startSandboxReadApi(live: Firestore, workspaceId: string, personId: string) {
  const id = await seedSandbox(live, workspaceId, personId);
  const remove = () => live.pool.query('delete from sandbox.sandboxes where id = $1', [id]);
  try {
    const api = await startBooksReadApi(live, live.forSandbox(id));
    return {
      base: api.base,
      async stop() {
        try { await api.stop(); } finally { await remove(); }
      },
    };
  } catch (err) {
    await remove();
    throw err;
  }
}

export async function withSandboxReadApi<T>(live: Firestore, workspaceId: string, personId: string, run: (base: string) => Promise<T>): Promise<T> {
  const api = await startSandboxReadApi(live, workspaceId, personId);
  try {
    return await run(api.base);
  } finally {
    await api.stop();
  }
}
