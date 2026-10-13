import './helpers/dom';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, waitFor, within, act } from '@testing-library/react';
import ReportPackDialog from '../components/reporting/reportPack/ReportPackDialog';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { useAuthStore } from '../stores/useAuthStore';
import { computeProfitAndLoss, computeBalanceSheet } from '../server/reports/computeReports';
afterEach(cleanup);
const aging = { current: 12345, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0, total: 12345 };
function setup() {
  setComponentWorkspace();
  const user = useAuthStore.getState().user!;
  useAuthStore.setState({ user: { ...user, getIdToken: async () => 'token' } });
}
function answer(url: string) { return url.includes('profit-and-loss') ? computeProfitAndLoss([], []) : url.includes('balance-sheet') ? computeBalanceSheet([], []) : aging; }
test('a refused section keeps choices and blocks print; retry prints only a fully prepared pack', async () => {
  setup(); let refused = true; const calls: string[] = [];
  globalThis.fetch = (async input => { const url = String(input); calls.push(url); return new Response(JSON.stringify(answer(url)), { status: refused && url.includes('/aging') ? 403 : 200 }); }) as typeof fetch;
  const view = render(<ReportPackDialog startDate="2024-01-01" endDate="2024-01-31" onClose={() => {}} />);
  const print = view.getByRole('button', { name: 'Print pack / PDF' }) as HTMLButtonElement;
  assert.ok(print.disabled); fireEvent.click(view.getByRole('button', { name: 'Prepare pack' }));
  await waitFor(() => assert.match(view.getByRole('alert').textContent!, /403/));
  assert.ok(print.disabled); assert.equal(view.queryByRole('region', { name: 'Receivables aging' }), null);
  assert.equal((view.getByRole('checkbox', { name: 'Receivables aging' }) as HTMLInputElement).checked, true);
  refused = false; fireEvent.click(view.getByRole('button', { name: 'Prepare pack' }));
  await waitFor(() => assert.equal(print.disabled, false));
  assert.match(view.getByText(/It is not a historical balance/).textContent!, /2024-01-31/);
  const section = view.getByRole('region', { name: 'Receivables aging' });
  assert.match(within(section).getByRole('row', { name: /Total outstanding/ }).textContent!, /123\.45/);
  assert.ok(calls.every(url => !url.includes('/aging') || !url.includes('2024')));
  fireEvent.click(view.getByRole('checkbox', { name: 'Receivables aging' })); assert.ok(print.disabled);
});
test('changing workspace during token retrieval refuses old requests and closes the pack', async () => {
  setup(); let resolve!: (token: string) => void; let calls = 0, closed = 0;
  useAuthStore.setState({ user: { ...useAuthStore.getState().user!, getIdToken: () => new Promise<string>(r => { resolve = r; }) } });
  globalThis.fetch = (async () => { calls++; return new Response('{}'); }) as typeof fetch;
  const view = render(<ReportPackDialog startDate="2024-01-01" endDate="2024-01-31" onClose={() => { closed++; }} />);
  fireEvent.click(view.getByRole('button', { name: 'Prepare pack' }));
  await act(async () => { useAuthStore.setState({ currentWorkspaceId: 'other' }); resolve('old-token'); });
  assert.equal(calls, 0); assert.ok(closed > 0); assert.equal(view.queryByRole('dialog'), null);
});
