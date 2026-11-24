import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { statusRouter } from '../server/routes/statusRoutes';

let server: Server;
let origin: string;
before(async () => {
  const app = express();
  app.use('/api', statusRouter);
  await new Promise<void>((resolve, reject) => { server = app.listen(0, '127.0.0.1', error => error ? reject(error) : resolve()); });
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => { await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve())); });

test('the mounted public health endpoint answers without a token', async () => {
  const response = await fetch(`${origin}/api/health`);
  const body = await response.json() as { status: string; timestamp: string; version: string };
  assert.equal(response.status, 200);
  assert.equal(body.status, 'ok');
  assert.ok(Number.isFinite(Date.parse(body.timestamp)));
  assert.equal(typeof body.version, 'string');
});

test('the schedule route refuses a request without authentication', async () => {
  const response = await fetch(`${origin}/api/v1/schedule`);
  assert.equal(response.status, 401);
  assert.match((await response.json() as { message: string }).message, /missing api token/i);
});
