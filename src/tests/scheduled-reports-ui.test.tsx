/**
 * Settings → Scheduled reports (K-28): owners add a schedule (a bad address refused, nothing saved),
 * send one now and stop one; others only see the list.
 */
import './helpers/dom';
import test, { afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ScheduledReportsSettings from '../components/platform/settings/ScheduledReportsSettings';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { useAuthStore } from '../stores/useAuthStore';
import { getSupabase } from '../lib/db/client';

const realFetch = globalThis.fetch;
const stub = () => {
  const calls: Array<{ url: string; method: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method || 'GET', body: typeof init?.body === 'string' ? JSON.parse(init.body) : {} });
    const body = url.includes('/send-now') ? { status: 'success', sent: 1, failed: [], period: { label: '2026-09' } } : null;
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return calls;
};
const withSchedules = (role: 'owner' | 'viewer', scheduledReports: unknown[]) => {
  const ws = setComponentWorkspace(role);
  useAuthStore.setState({ workspaces: [{ ...ws, scheduledReports } as never] });
};
const pl = { id: 'pl', report: 'profit-and-loss', frequency: 'monthly', recipients: ['owner@example.com'] };

describe('Scheduled reports settings', () => {
  afterEach(async () => { cleanup(); globalThis.fetch = realFetch; await getSupabase().auth.dispose(); });

  test('add: a bad address is refused and nothing saved; a good one is saved with the others', async () => {
    withSchedules('owner', [pl]);
    const calls = stub();
    render(<ScheduledReportsSettings />);
    fireEvent.change(screen.getByLabelText('Report'), { target: { value: 'balance-sheet' } });
    fireEvent.change(screen.getByLabelText('How often'), { target: { value: 'weekly' } });
    fireEvent.change(screen.getByLabelText('Email to (commas between addresses)'), { target: { value: 'not-an-address' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add' })); });
    assert.equal(calls.filter(c => c.url.includes('/commands/workspace.settings')).length, 0);
    fireEvent.change(screen.getByLabelText('Email to (commas between addresses)'), { target: { value: 'a@b.co, c@d.org' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add' })); });
    await waitFor(() => assert.ok(calls.some(c => c.url.includes('/commands/workspace.settings'))));
    const saved = (calls.find(c => c.url.includes('/commands/workspace.settings'))!.body as
      { input: { scheduledReports: Array<Record<string, unknown>> } }).input.scheduledReports;
    assert.equal(saved.length, 2);
    assert.deepEqual([saved[1].report, saved[1].frequency, saved[1].recipients], ['balance-sheet', 'weekly', ['a@b.co', 'c@d.org']]);
  });

  test('Send now asks the server; stopping saves the list without it', async () => {
    withSchedules('owner', [pl]);
    const calls = stub();
    render(<ScheduledReportsSettings />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send Profit and loss now' })); });
    await waitFor(() => assert.ok(calls.some(c => c.url.endsWith('/report-schedules/pl/send-now'))));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Stop Profit and loss monthly' })); });
    await waitFor(() => assert.ok(calls.some(c => c.url.includes('/commands/workspace.settings'))));
    assert.deepEqual((calls.find(c => c.url.includes('/commands/workspace.settings'))!.body as
      { input: { scheduledReports: unknown[] } }).input.scheduledReports, []);
  });

  test('a viewer sees the list but cannot change it', () => {
    withSchedules('viewer', [pl]);
    stub();
    render(<ScheduledReportsSettings />);
    assert.ok(screen.getByText('Profit and loss'));
    assert.equal(screen.queryByRole('button', { name: 'Add' }), null);
    assert.equal(screen.queryByRole('button', { name: /Send .* now/ }), null);
  });
});
