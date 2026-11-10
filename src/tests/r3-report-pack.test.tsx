/**
 * R-3: a scheduled report pack (profit and loss, balance sheet and receivables aging in one email, a spreadsheet each)
 * and the preview before saving (nothing is sent).
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
import { agingTable, lastFinishedPeriod, reportEmailHtml, scheduleParts, scheduleProblem, profitAndLossTable } from '../lib/scheduledReports';

describe('R-3: the report pack', () => {
  test('a pack is the three reports, in order; one email holds them all with one footer', () => {
    assert.deepEqual(scheduleParts('report-pack'), ['profit-and-loss', 'balance-sheet', 'receivables-aging']);
    assert.deepEqual(scheduleParts('balance-sheet'), ['balance-sheet']);
    assert.equal(scheduleProblem({ report: 'report-pack', frequency: 'monthly', recipients: ['a@b.co'] }), null);
    const period = lastFinishedPeriod('monthly', '2026-10-01');
    const pl = profitAndLossTable({ income: { total: 100, accounts: {} }, expense: { total: 0, accounts: {} }, netIncome: 100 }, period);
    const aging = agingTable([], [{ key: 'current', label: 'Current' }], period);
    const html = reportEmailHtml([pl, aging], { workspaceName: 'Acme', currency: 'USD', format: c => String(c) });
    assert.match(html, /Profit and loss, 2026-09/);
    assert.match(html, /<hr/);
    assert.equal((html.match(/Sent by LedgerFlow/g) || []).length, 1);
    assert.match(html, /spreadsheets \(CSV\), one per report/);
  });
});

describe('R-3: the preview before saving', () => {
  const realFetch = globalThis.fetch;
  afterEach(async () => { cleanup(); globalThis.fetch = realFetch; await getSupabase().auth.dispose(); });

  test('Preview asks the server for the email of the chosen report and shows it; nothing is saved or sent', async () => {
    const ws = setComponentWorkspace('owner');
    useAuthStore.setState({ workspaces: [{ ...ws, scheduledReports: [] } as never] });
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : {} });
      const body = url.includes('/preview')
        ? { status: 'success', subject: 'Report pack 2026-09-01 – 2026-09-30 · Acme', html: '<h2>Profit and loss, 2026-09</h2>', attachments: ['profit-and-loss-2026-09-30.csv', 'balance-sheet-2026-09-30.csv', 'receivables-aging-2026-09-30.csv'] }
        : null;
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    render(<ScheduledReportsSettings />);
    fireEvent.change(screen.getByLabelText('Report'), { target: { value: 'report-pack' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Preview' })); });
    await waitFor(() => assert.ok(screen.getByTestId('schedule-preview')));
    const asked = calls.find(c => c.url.includes('/report-schedules/preview'));
    assert.deepEqual(asked?.body, { report: 'report-pack', frequency: 'monthly' });
    assert.match(screen.getByTestId('schedule-preview').textContent || '', /Report pack 2026-09-01 – 2026-09-30 · Acme/);
    assert.match(screen.getByTestId('schedule-preview').textContent || '', /receivables-aging-2026-09-30\.csv/);
    const frame = screen.getByTitle('Email preview') as HTMLIFrameElement;
    assert.equal(frame.getAttribute('sandbox'), '', 'the email runs no script');
    assert.equal(calls.filter(c => c.url.includes('lf_update') || c.url.includes('send-now')).length, 0);
  });
});
