/**
 * A-234: the first-run setup wizard saves at **every** step, and a later visit shows the saved
 * values instead of an empty form — the regression the 27 Oct migration
 * `20261027000000_server_fields_allowed` fixed (the server was stripping the wizard's own fields).
 *
 * The browser journey is still missing (this environment has no Chromium); this is the same journey
 * at the component level, with a stub that behaves like the server: it records every write and the
 * workspace the screen is re-opened on is built from what the server kept. If the wizard stops
 * sending one of the allowlisted fields — or stops reading them on the way back — this fails.
 */
import './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import SetupWizard from '../components/onboarding/SetupWizard';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import type { Workspace } from '../types';
import { getSupabase } from '../lib/db/client';
import { makeChartAccount } from './fixtures';

const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

interface Call { url: string; method: string; body: unknown }

/** a server that keeps what it is sent, the way the workspace row does */
function keepTheWrites() {
  const calls: Call[] = [];
  const kept: Record<string, unknown> = {};
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url, method, body });
    if (url.includes('/rest/v1/rpc/lf_update')) {
      const set = (body as { p_set?: Record<string, unknown> } | undefined)?.p_set;
      if (set) Object.assign(kept, set);
      return new Response(JSON.stringify(body ?? {}), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (/\/opening-balances$/.test(url)) {
      return new Response(JSON.stringify({ status: 'success', debitsCents: 100000, equityCents: 70000 }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ status: 'success' }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { calls, kept };
}

function openWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  const workspace: Workspace = {
    id: 'w1', uid: 'u1', name: 'Acme', currency: 'USD', timezone: deviceZone,
    fiscalYearStartMonth: 1, roles: { u1: 'owner' }, ...overrides,
  } as Workspace;
  useAuthStore.setState({
    user: { uid: 'u1', getIdToken: async () => 'token' } as never,
    isGuest: false,
    currentWorkspaceId: workspace.id,
    workspaces: [workspace],
  });
  return workspace;
}

beforeEach(() => {
  openWorkspace();
  useLedgerStore.setState({ accounts: [
    makeChartAccount({ id: 'cash', name: 'Checking', type: 'asset', category: 'Cash' }),
    makeChartAccount({ id: 'loan', name: 'Bank Loan', type: 'liability', category: 'Long-term' }),
    makeChartAccount({ id: 'ar', name: 'Accounts Receivable', type: 'asset', category: 'Receivables' }),
    makeChartAccount({ id: 'obe', name: 'Opening Balance Equity', type: 'equity', category: 'Equity' }),
  ] });
});
afterEach(async () => { cleanup(); getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });

describe('A-234: set-up wizard saves every step and keeps the values', () => {
  test('all four steps save, and re-opening the wizard shows what was saved', async () => {
    const server = keepTheWrites();
    let done = false;
    const { unmount } = render(<SetupWizard onStarted={() => {}} onDone={() => { done = true; }} />);

    // ---- Step 1, "Your business": the allowlisted workspace fields are written, not dropped
    assert.ok(screen.getByRole('heading', { name: 'Your business' }));
    fireEvent.change(screen.getByLabelText('Business name'), { target: { value: 'Northwind Ltd' } });
    fireEvent.change(screen.getByLabelText('Home currency'), { target: { value: 'GBP' } });
    fireEvent.change(screen.getByLabelText('Financial year starts in'), { target: { value: '4' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Next' })); });

    // the write reaches the server as the `lf_update` row update the workspace allowlist guards
    const workspaceWrite = server.calls.find(c => c.url.includes('/rest/v1/rpc/lf_update'));
    assert.ok(workspaceWrite, 'the business step wrote the workspace');
    const rpc = workspaceWrite!.body as { p_table?: string; p_id?: string; p_set?: Record<string, unknown> };
    assert.equal(rpc.p_table, 'workspaces');
    assert.equal(rpc.p_id, 'w1');
    const written = rpc.p_set || {};
    for (const field of ['name', 'currency', 'timezone', 'fiscalYearStartMonth', 'fiscalYearStartDay']) {
      assert.ok(field in written, `the wizard sends ${field} (the server allowlist has to keep it)`);
    }
    assert.equal(written.name, 'Northwind Ltd');
    assert.equal(written.currency, 'GBP');
    assert.equal(written.fiscalYearStartMonth, 4);
    assert.equal(written.fiscalYearStartDay, 1);
    assert.equal(written.timezone, deviceZone);
    assert.equal(useAuthStore.getState().getCurrentWorkspace()?.name, 'Northwind Ltd', 'the open workspace shows the new name at once');

    // ---- Step 2, "Chart of accounts": the chosen template is applied on the server
    assert.ok(screen.getByRole('heading', { name: 'Chart of accounts' }));
    const templateRadios = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="template"]'))
      .filter(input => input.id !== 'tpl-keep');
    assert.ok(templateRadios.length > 0, 'at least one starter template is offered');
    fireEvent.click(templateRadios[0]);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Next' })); });
    const templateWrite = server.calls.find(c => c.url.endsWith('/apply-template'));
    assert.ok(templateWrite, 'the chart step was saved');
    assert.equal((templateWrite!.body as { templateId: string }).templateId, templateRadios[0].id.replace('tpl-', ''));

    // ---- Step 3, "Opening balances": one call, the amounts in cents, the balance sentence after
    assert.ok(screen.getByRole('heading', { name: 'Opening balances' }));
    fireEvent.change(screen.getByLabelText(/Checking/), { target: { value: '1000' } });
    fireEvent.change(screen.getByLabelText(/Bank Loan/), { target: { value: '300' } });
    assert.ok(screen.getByText(/Debits £1,000\.00 = credits £1,000\.00/), 'the live balance check uses the workspace currency');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Record opening balances' })); });
    const balancesWrite = server.calls.find(c => c.url.endsWith('/opening-balances'));
    assert.ok(balancesWrite, 'the opening balances were saved');
    const balances = balancesWrite!.body as { date: string; balances: Array<{ accountId: string; amountCents: number }> };
    assert.deepEqual(balances.balances, [{ accountId: 'cash', amountCents: 100000 }, { accountId: 'loan', amountCents: 30000 }]);
    assert.match(balances.date, /^\d{4}-\d{2}-01$/, 'the start date is the first day of a month');
    assert.match(document.body.textContent || '', /debits and credits are both £1,000\.00/, 'the done step repeats the figure it saved');

    // ---- Step 4, "Done"
    assert.ok(screen.getByRole('heading', { name: 'Your books are set up' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Go to the dashboard' })); });
    assert.ok(done, 'the wizard hands the reader to the dashboard');
    unmount();

    // ---- and a later visit reads the saved values back, not an empty form
    openWorkspace({ name: String(server.kept.name), currency: String(server.kept.currency), fiscalYearStartMonth: Number(server.kept.fiscalYearStartMonth) });
    render(<SetupWizard onStarted={() => {}} onDone={() => {}} />);
    assert.equal((screen.getByLabelText('Business name') as HTMLInputElement).value, 'Northwind Ltd');
    assert.equal((screen.getByLabelText('Home currency') as HTMLSelectElement).value, 'GBP');
    assert.equal((screen.getByLabelText('Financial year starts in') as HTMLSelectElement).value, '4');
    assert.equal((screen.getByLabelText('Time zone') as HTMLSelectElement).value, String(server.kept.timezone));
  });
});
