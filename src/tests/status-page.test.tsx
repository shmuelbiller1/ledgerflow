/**
 * Status page (L-17): the server works out each part's state (database, daily job, outside
 * services set up or not), and /status shows it without sign-in.
 */
import { stubFetch } from './helpers/dom';
import test, { afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import StatusPage from '../components/system/StatusPage';
import { checkSystemStatus, recordDailyJobRun } from '../server/services/statusService';
import type { Firestore } from '../server/db/firestore';

/** A database with one jobRuns document, or one that fails. */
function fakeDb(run?: Record<string, unknown>, fail = false) {
  const store = new Map<string, Record<string, unknown>>(run ? [['daily_latest', run]] : []);
  return {
    collection: () => ({
      doc: (id: string) => ({
        get: async () => { if (fail) throw new Error('connection refused'); return { data: () => store.get(id) }; },
        set: async (data: Record<string, unknown>) => { store.set(id, data); },
      }),
    }),
    store,
  } as unknown as Firestore & { store: Map<string, Record<string, unknown>> };
}

const now = new Date('2026-10-02T12:00:00Z');
const env = { CRON_SECRET: 'x', SUPABASE_URL: 'https://db', STRIPE_SECRET_KEY: 'sk' } as NodeJS.ProcessEnv;
const state = (s: Awaited<ReturnType<typeof checkSystemStatus>>, id: string) => s.components.find(c => c.id === id)?.state;

describe('System status', () => {
  test('a recent clean daily run: working; services not set up do not count as problems', async () => {
    const db = fakeDb();
    await recordDailyJobRun(db, '2026-10-02T06:10:00Z', { maintenance: 'ok', reminders: 'ok' }, new Date('2026-10-02T06:11:00Z'));
    const status = await checkSystemStatus(db, env, now);
    assert.equal(status.state, 'operational');
    assert.equal(state(status, 'database'), 'operational');
    assert.equal(state(status, 'jobs'), 'operational');
    assert.equal(state(status, 'payments'), 'operational');
    assert.equal(state(status, 'banks'), 'not_configured');
  });

  test('a failed or late daily job shows problems', async () => {
    const failed = await checkSystemStatus(fakeDb({ finishedAt: '2026-10-02T06:11:00Z', status: 'failed', failedJobs: ['reminders'] }), env, now);
    assert.equal(failed.state, 'degraded');
    assert.match(failed.components.find(c => c.id === 'jobs')!.detail, /reminders/);
    const late = await checkSystemStatus(fakeDb({ finishedAt: '2026-09-30T06:11:00Z', status: 'ok' }), env, now);
    assert.equal(state(late, 'jobs'), 'degraded');
  });

  test('the database not answering: not working', async () => {
    const status = await checkSystemStatus(fakeDb(undefined, true), env, now);
    assert.equal(status.state, 'down');
    assert.equal(state(status, 'database'), 'down');
  });

  test('without the cron secret the daily job is "not set up", not a problem', async () => {
    const status = await checkSystemStatus(fakeDb(), { SUPABASE_URL: 'x' } as NodeJS.ProcessEnv, now);
    assert.equal(state(status, 'jobs'), 'not_configured');
    assert.equal(status.state, 'operational');
  });
});

describe('Status page', () => {
  afterEach(() => cleanup());

  test('shows each part and its state', async () => {
    stubFetch(200, {
      state: 'degraded', checkedAt: '2026-10-02T12:00:00Z',
      components: [
        { id: 'database', name: 'Database', state: 'operational', detail: 'Answering.' },
        { id: 'jobs', name: 'Scheduled jobs', state: 'degraded', detail: 'Last ran 40 hours ago.' },
      ],
    });
    render(<StatusPage />);
    await waitFor(() => screen.getByText('Some parts have problems'));
    assert.ok(screen.getByText('Last ran 40 hours ago.'));
    assert.ok(screen.getByText('Problems'));
    assert.ok(screen.getByText('Working'));
  });

  test('says so when the server does not answer', async () => {
    stubFetch(503, {});
    render(<StatusPage />);
    assert.ok(await screen.findByText('The server is not answering'));
  });
});
