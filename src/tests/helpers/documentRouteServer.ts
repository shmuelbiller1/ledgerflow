/** The documents router on a random port, with the caller's uid taken from the x-test-uid header. */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import crypto from 'crypto';

export async function startDocumentRoutes(): Promise<{ server: Server; post: (uid: string, type: string, id: string, body: Record<string, unknown>) => Promise<{ status: number; body: Record<string, unknown> }> }> {
  const express = (await import('express')).default;
  const { documentRouter } = await import('../../server/routes/documentRoutes');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as unknown as { user: { uid: string } }).user = { uid: String(req.header('x-test-uid')) }; next(); });
  app.use('/api/v1/documents', documentRouter);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    server,
    async post(uid, type, id, body) {
      const res = await fetch(`${base}/api/v1/documents/${type}/${id}/post`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-test-uid': uid, 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify(body) });
      return { status: res.status, body: await res.json() as Record<string, unknown> };
    },
  };
}
