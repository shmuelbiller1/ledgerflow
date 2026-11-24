/** Real middleware boundary; valid-key/database verification is a separate integration test. */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { apiAuthenticate } from '../server/auth/apiAuthenticate';
let server: Server;
let url: string;
before(async () => {
  const app = express();
  app.get('/probe', apiAuthenticate, (_req, res) => res.json({ reachedHandler: true }));
  await new Promise<void>((resolve, reject) => { server = app.listen(0, '127.0.0.1', error => error ? reject(error) : resolve()); });
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/probe`;
});
after(async () => { await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve())); });
test('API auth rejects a missing token', async () => {
  const res = await fetch(url);
  assert.equal(res.status, 401);
  assert.match((await res.json() as { message: string }).message, /missing api token/i);
});
test('API auth rejects a key ID without its secret before reaching the handler', async () => {
  const res = await fetch(url, { headers: { Authorization: 'Bearer lf_id_workspace_012345' } });
  assert.equal(res.status, 401);
  assert.match((await res.json() as { message: string }).message, /KeyID.*SecretKey/i);
});
