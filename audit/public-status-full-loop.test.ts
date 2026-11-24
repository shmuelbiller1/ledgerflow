import '../src/tests/helpers/dom';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import StatusPage from '../src/components/system/StatusPage';
import { callApi, closeServer, listenOnRandomPort, restoreEnv, useLiveApiEnv } from '../src/tests/helpers/liveApiServer';
const enabled = Boolean(process.env.LF_TEST_DATABASE_URL);
describe('public status component through local app', { skip: !enabled && 'requires LF_TEST_DATABASE_URL' }, () => {
  let server: Server | undefined, base = '', env: Record<string, string | undefined> = {};
  const fetchOriginal = globalThis.fetch;
  before(async () => {
    env = useLiveApiEnv('public-status-http');
    const { createApp } = await import('../server');
    ({ server, base } = await listenOnRandomPort(await createApp()));
  });
  after(async () => { cleanup(); globalThis.fetch = fetchOriginal; await closeServer(server); restoreEnv(env); });
  it('anonymous API response renders and configuration is not represented as provider health', async () => {
    const response = await callApi(base, 'GET', '/api/v1/public/status');
    assert.equal(response.status, 200);
    const data = response.json as { checkedAt: string; components: Array<{ id: string; state: string }> };
    assert.ok(Number.isFinite(Date.parse(data.checkedAt)));
    assert.ok(data.components.some(item => item.id === 'database' && item.state === 'operational'));
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => fetchOriginal(new URL(String(input), base), init)) as typeof fetch;
    render(React.createElement(StatusPage));
    assert.ok(await screen.findByText('No problems reported by available checks'));
    assert.ok(screen.getByText(/checked for configuration only, not live provider availability/));
    assert.ok(screen.getByText('Database'));
  });
});
