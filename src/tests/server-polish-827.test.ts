/** #827: Permissions-Policy on every response, the same header on Vercel, and no raw error text in 500 bodies. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { applySecurityMiddleware, PERMISSIONS_POLICY } from '../server/http/securityMiddleware';
import { maskCardNumbers } from '../lib/cardNumberMask';

test('every response carries the Permissions-Policy header, and Vercel serves the same value', async () => {
  const app = express();
  applySecurityMiddleware(app, () => true);
  app.get('/page', (_req, res) => { res.send('ok'); });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/page`);
    assert.equal(res.headers.get('permissions-policy'), PERMISSIONS_POLICY);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
  assert.match(PERMISSIONS_POLICY, /camera=\(\)/);
  const vercel = JSON.parse(fs.readFileSync('vercel.json', 'utf8')) as { headers: Array<{ headers: Array<{ key: string; value: string }> }> };
  const served = vercel.headers.flatMap(h => h.headers).find(h => h.key === 'Permissions-Policy');
  assert.equal(served?.value, PERMISSIONS_POLICY);
});

test('500 bodies in the email and incoming-event routes do not echo the error', () => {
  for (const file of ['src/server/routes/emailRoutes.ts', 'src/server/routes/incomingEventRoutes.ts']) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /status\(500\)[^\n]*err\.message/, file);
  }
});

test('the empty query key is refused, and AI/client-query text is card-masked', () => {
  assert.match(fs.readFileSync('src/server/routes/transactions/crudRoutes.ts', 'utf8'), /hasOwnProperty\.call\(req\.query, ''\)/);
  assert.equal(maskCardNumbers('paid with 4111 1111 1111 1111').includes('4111 1111 1111 1111'), false);
  assert.match(fs.readFileSync('src/server/services/clientQueryService.ts', 'utf8'), /maskCardNumbers\(input\.question/);
  assert.match(fs.readFileSync('src/server/routes/brainRoutes.ts', 'utf8'), /maskCardNumbers\(JSON\.stringify\(ephemeralData/);
});
