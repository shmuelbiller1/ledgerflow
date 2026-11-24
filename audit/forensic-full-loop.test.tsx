/** Component through its real transport to the real local app and disposable PostgreSQL; synthetic identity. */
import '../src/tests/helpers/dom';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import ForensicAudit from '../src/components/forensics/ForensicAudit';
import { useAuthStore } from '../src/stores/useAuthStore';
import { useLedgerStore } from '../src/stores/useLedgerStore';
import { auth } from '../src/firebase';
import { makeTransaction } from '../src/tests/fixtures';
import { setComponentWorkspace } from '../src/tests/helpers/componentFixtures';
import { closeServer, listenOnRandomPort, restoreEnv, signTestJwt, useLiveApiEnv } from '../src/tests/helpers/liveApiServer';

const enabled = Boolean(process.env.LF_TEST_DATABASE_URL);
describe('forensic scan component to local API and DB', { skip: !enabled && 'requires LF_TEST_DATABASE_URL' }, () => {
  const owner = randomUUID(), ws = `ws_forensic_ui_${randomUUID()}`;
  const originalFetch = globalThis.fetch;
  let server: Server | undefined, base = '';
  let env: Record<string, string | undefined> = {};
  let db: Awaited<ReturnType<(typeof import('../src/server/db/firestore'))['getDb']>>;
  before(async () => {
    env = useLiveApiEnv('forensic-full-loop');
    const [{ getDb }, { createApp }] = await Promise.all([import('../src/server/db/firestore'), import('../server')]);
    db = getDb();
    await db.pool.query("insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data) values ($1::uuid, $2, now(), '{}'::jsonb)", [owner, `${owner}@example.test`]);
    await db.collection('workspaces').doc(ws).set({ id: ws, name: 'Forensic integration', uid: owner, members: [owner], roles: { [owner]: 'owner' }, currency: 'USD' });
    for (let i = 0; i < 8; i++) {
      const amount = i === 7 ? 12345 : 100;
      await db.collection('transactions').doc(`${ws}_${i}`).set({ workspaceId: ws, date: '2026-01-01', description: i === 7 ? 'Actual database outlier' : 'Normal', totalAmountCents: amount, status: 'completed', type: 'actual', lines: [{ accountId: 'one', amountCents: amount }, { accountId: 'two', amountCents: -amount }] });
    }
    const token = await signTestJwt({ uid: owner, email: `${owner}@example.test`, aal: 'aal2', userMetadata: { email_verified: true } });
    ({ server, base } = await listenOnRandomPort(await createApp()));
    setComponentWorkspace();
    const user = { ...auth.currentUser!, uid: owner, getIdToken: async () => token };
    auth.currentUser = user;
    useAuthStore.setState({ user, currentWorkspaceId: ws, workspaces: [{ id: ws, uid: owner, name: 'Forensic integration', currency: 'USD', businessType: 'custom', createdAt: '2026-01-01' }], isGuest: false });
    useLedgerStore.setState({ transactions: Array.from({ length: 8 }, (_, i) => makeTransaction({ id: `${ws}_${i}` })), accounts: [] });
    globalThis.ResizeObserver = window.ResizeObserver;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => originalFetch(new URL(String(input), base), init)) as typeof fetch;
  });
  after(async () => {
    cleanup(); globalThis.fetch = originalFetch;
    await closeServer(server);
    if (db) {
      await db.pool.query('delete from public.transactions where workspace_id = $1', [ws]);
      await db.pool.query('delete from public.workspaces where id = $1', [ws]);
      await db.pool.query('delete from public.users where id = $1', [owner]);
      await db.pool.query('delete from auth.users where id = $1::uuid', [owner]);
    }
    restoreEnv(env);
  });
  it('renders a real returned outlier without crashing or inventing a currency', async () => {
    render(<ForensicAudit />);
    assert.ok(await screen.findByText('Actual database outlier'));
    assert.ok(screen.getByText('12,345 minor units (currency not supplied)'));
    assert.equal(screen.queryByText(/No outliers were returned/), null);
  });
});
