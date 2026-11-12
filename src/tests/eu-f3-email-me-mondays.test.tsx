/**
 * EU-F3: "Email me this every Monday" on Profit & Loss, Balance Sheet and A/R Aging adds a weekly Monday schedule to
 * the person's own address (kept with the others), says so once it is there, and is not offered to a viewer.
 */
import './helpers/dom';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import EmailMeMondays from '../components/reporting/EmailMeMondays';
import { addMondayEmail, mondayScheduleFor } from '../lib/emailMeMondays';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { useAuthStore } from '../stores/useAuthStore';
import { getSupabase } from '../lib/db/client';
import type { ScheduledReport } from '../lib/scheduledReports';

const realFetch = globalThis.fetch;
afterEach(async () => { cleanup(); globalThis.fetch = realFetch; await getSupabase().auth.dispose(); });

const monthlyPl: ScheduledReport = { id: 'pl', report: 'profit-and-loss', frequency: 'monthly', recipients: ['test@example.test'] };

test('EU-F3: a Monday schedule for my address is added beside the others; twice is refused', () => {
  const r = addMondayEmail([monthlyPl], 'profit-and-loss', 'Test@Example.test', 'new');
  assert.ok('next' in r);
  assert.deepEqual(r.next[1], { id: 'new', report: 'profit-and-loss', frequency: 'weekly', recipients: ['Test@Example.test'] });
  assert.ok(mondayScheduleFor(r.next, 'profit-and-loss', 'test@example.test'), 'any case');
  assert.deepEqual(addMondayEmail(r.next, 'profit-and-loss', 'test@example.test', 'x'), { problem: 'Already emailed to you every Monday' });
  assert.equal(mondayScheduleFor([{ ...r.next[1], sendDay: 3 }], 'profit-and-loss', 'test@example.test'), undefined, 'a Wednesday one is not Monday');
});

test('EU-F3: the button saves the schedule list with the new one, then says it is there', async () => {
  const ws = setComponentWorkspace('owner');
  useAuthStore.setState({ workspaces: [{ ...ws, scheduledReports: [monthlyPl] } as never] });
  const calls: Array<{ url: string; body: { p_set?: { scheduledReports?: ScheduledReport[] } } }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), body: typeof init?.body === 'string' ? JSON.parse(init.body) : {} });
    return new Response('null', { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  render(<EmailMeMondays reportTab="pnl" />);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Email me this every Monday' })); });
  await waitFor(() => assert.ok(calls.some(c => c.url.includes('lf_update'))));
  const saved = calls.find(c => c.url.includes('lf_update'))!.body.p_set!.scheduledReports!;
  assert.deepEqual(saved.map(s => [s.report, s.frequency, s.recipients]), [['profit-and-loss', 'monthly', ['test@example.test']], ['profit-and-loss', 'weekly', ['test@example.test']]]);
  await waitFor(() => assert.ok(screen.getByText('Emailed to you every Monday')));
});

test('EU-F3: not offered to a viewer, nor on a report that cannot be emailed', () => {
  setComponentWorkspace('viewer');
  render(<EmailMeMondays reportTab="pnl" />);
  assert.equal(screen.queryByTestId('email-me-mondays'), null);
  cleanup();
  setComponentWorkspace('owner');
  render(<EmailMeMondays reportTab="cash-flow" />);
  assert.equal(screen.queryByTestId('email-me-mondays'), null);
});
