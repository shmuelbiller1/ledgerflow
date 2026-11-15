/**
 * The API described for tools (Z-01): /api/v1/openapi.json is an OpenAPI 3.1 document whose entry
 * shape comes from the schema the server checks with, and every path it describes is a real route.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { openApiDocument } from '../server/openapi';
import { transactionRouter } from '../server/routes/transactionRoutes';
import { commandRouter } from '../server/routes/commandRoutes';
import { registerApiKeysRoutes } from '../server/routes/apiKeysRoutes';

test('served without sign-in as OpenAPI 3.1', async () => {
  const app = express();
  registerApiKeysRoutes(app, {} as never);
  const server = app.listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/openapi.json`);
    assert.equal(res.status, 200);
    const doc = await res.json() as { openapi: string; paths: Record<string, unknown> };
    assert.equal(doc.openapi, '3.1.0');
    assert.ok(doc.paths['/api/v1/transactions/batch-create']);
  } finally {
    server.close();
  }
});

test('the entry shape is the server\'s own schema: date and balanced lines required, the author filled in by the server', () => {
  const entry = openApiDocument().components.schemas.Transaction as { required: string[]; properties: Record<string, { type?: string; items?: { properties?: Record<string, { type?: string }> } }> };
  assert.ok(entry.required.includes('date') && entry.required.includes('lines') && entry.required.includes('workspaceId'));
  assert.equal(entry.required.includes('uid'), false);
  assert.equal(entry.properties.lines.type, 'array');
  assert.equal(entry.properties.lines.items?.properties?.amountCents?.type, 'integer');
});

test('every documented API path and method is registered on its router', () => {
  type Layer = { route?: { path: string; methods: Record<string, boolean> } };
  const routers = [
    { base: '/api/v1/transactions', router: transactionRouter },
    { base: '/api/v1/commands', router: commandRouter },
  ];
  const openapi = openApiDocument();
  for (const [path, methods] of Object.entries(openapi.paths)) {
    const mount = routers.find(candidate => path === candidate.base || path.startsWith(`${candidate.base}/`));
    assert.ok(mount, `${path} is not under a checked API router`);
    const routes = new Set((mount.router.stack as Layer[]).filter(layer => layer.route)
      .flatMap(layer => Object.keys(layer.route!.methods).map(method => `${method} ${layer.route!.path}`)));
    const local = path.slice(mount.base.length).replace(/\{(\w+)\}/g, ':$1') || '/';
    for (const method of Object.keys(methods)) assert.ok(routes.has(`${method} ${local}`), `${method.toUpperCase()} ${path} is not a route`);
  }
});
