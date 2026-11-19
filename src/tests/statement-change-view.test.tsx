import { stubFetch } from './helpers/dom';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import ProfitAndLoss from '../components/ledger/ProfitAndLossView';
import BalanceSheet from '../components/ledger/BalanceSheetView';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useDataNeedsStore } from '../stores/useDataNeedsStore';
import { useAuthStore } from '../stores/useAuthStore';
import { formatCurrency } from '../lib/utils';
import { makeChartAccount, makeTransaction } from './fixtures';
import { setComponentWorkspace } from './helpers/componentFixtures';

const dates = { startDate: '2026-02-01', endDate: '2026-02-28', compareStartDate: '2026-01-01', compareEndDate: '2026-01-31' };
const accounts = [makeChartAccount({ id: 'cash', type: 'asset', openingBalanceCents: 12000 }), makeChartAccount({ id: 'sales', type: 'income' }), makeChartAccount({ id: 'rent', type: 'expense' })];
const entry = (id: string, date: string, cost: number, sale: number) => makeTransaction({ id, date, description: id, status: 'completed', lines: [
  { accountId: 'cash', amountCents: sale - cost }, { accountId: 'rent', amountCents: cost }, { accountId: 'sales', amountCents: -sale },
] });
// USD: Jan sale $90 less $10 cost = $80. Feb +$130 and -$30 = $100. Change +$20.
// Cash closes at $120 opening + $80 = $200, then $300. Movement +$100, NOT +$20.
const transactions = [entry('January sale', '2026-01-31', 1000, 9000), entry('February sale', '2026-02-01', 0, 13000), entry('February rent', '2026-02-28', 3000, 0)];
const prompt = 'Why did this number change?';
beforeEach(() => {
  const ws = setComponentWorkspace();
  useDataNeedsStore.getState().resetLoaded(ws.id);
  for (const key of ['accounts', 'transactions'] as const) useDataNeedsStore.getState().markLoaded(key);
  useLedgerStore.setState({ accounts, transactions, truncatedCollections: {}, isDataTruncated: false });
  stubFetch(503);
});
afterEach(cleanup);

for (const kind of ['pl', 'bs'] as const) test(`${kind}: the actual comparison lists entry contributions largest first, with record links`, async () => {
  useAuthStore.setState({ user: null, isGuest: true });
  await act(async () => { render(kind === 'pl' ? <ProfitAndLoss {...dates} /> : <BalanceSheet accounts={accounts} formatCurrency={formatCurrency} asOfDate={dates.endDate} {...dates} />); });
  fireEvent.click(screen.getByRole('button', { name: prompt }));
  const panel = within(screen.getByRole('region', { name: prompt }));
  const links = await panel.findAllByRole('link');
  assert.deepEqual(links.map(l => l.textContent), kind === 'pl' ? ['February sale', 'January sale', 'February rent'] : ['February sale', 'February rent']);
  for (const l of links) assert.equal(l.getAttribute('href'), `#transactions/transaction/${encodeURIComponent(l.textContent!)}`);
  assert.match(links[0].closest('li')?.textContent || '', /\$130\.00/);
  assert.match(links.at(-1)?.closest('li')?.textContent || '', /-\$30\.00/);
  assert.ok(panel.getByText(formatCurrency(kind === 'pl' ? 2000 : 10000)));
});

// A signed-in book reads the full server lines, never a local ranking after a refusal.
test('one scoped read for both periods; failure is retryable and an equal delta on wrong totals does not reconcile', async () => {
  const calls: Record<string, unknown>[] = [];
  const { explainFigure } = await import('../server/reports/explain');
  const { computeProfitAndLoss } = await import('../server/reports/computeReports');
  useLedgerStore.setState({ transactions: [], truncatedCollections: { transactions: true }, isDataTruncated: true });
  let response = 'failure';
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input), 'http://example.test');
    if (url.pathname.endsWith('/explain')) {
      assert.equal(init?.method, 'POST');
      const query = JSON.parse(String(init?.body));
      calls.push(query);
      if (response === 'failure') return new Response(null, { status: 503 });
      const adjusted = response === 'mismatch' ? [...transactions, entry('January adjustment', '2026-01-10', 0, 300), entry('February adjustment', '2026-02-10', 0, 300)] : transactions;
      return Response.json(explainFigure(accounts, adjusted, query));
    }
    if (url.pathname.endsWith('/profit-and-loss')) return Response.json(computeProfitAndLoss(accounts, transactions, url.searchParams.get('startDate')!, url.searchParams.get('endDate')!));
    return new Response(null, { status: 404 });
  };
  await act(async () => { render(<ProfitAndLoss {...dates} />); });
  assert.equal(calls.length, 0);
  fireEvent.click(screen.getByRole('button', { name: prompt }));
  const panel = within(screen.getByRole('region', { name: prompt }));
  assert.ok(await panel.findByText(/could not be loaded/));
  assert.equal(panel.queryAllByRole('link').length, 0);
  assert.deepEqual(calls, [{ workspaceId: 'component-workspace', accountIds: ['sales', 'rent'], startDate: '2026-01-01', endDate: '2026-02-28' }]);
  response = 'mismatch';
  fireEvent.click(panel.getByRole('button', { name: 'Try again' }));
  assert.ok(await panel.findByText(/do not match both totals/));
  assert.equal(panel.queryAllByRole('link').length, 0);
  response = 'match';
  fireEvent.click(panel.getByRole('button', { name: 'Try again' }));
  assert.equal((await panel.findAllByRole('link')).length, 3);
  act(() => useAuthStore.setState({ currentWorkspaceId: 'second-book' }));
  assert.ok(!screen.queryByRole('link', { name: 'January sale' }));
});

test('does not explain a budget or cash comparison from posted ledger lines', async () => {
  await act(async () => { render(<ProfitAndLoss {...dates} />); });
  assert.ok(screen.getByRole('button', { name: prompt }));
  fireEvent.change(screen.getByRole('combobox', { name: 'Compare to' }), { target: { value: 'budget' } });
  assert.ok(!screen.queryByRole('button', { name: prompt }));
  await act(async () => { fireEvent.change(screen.getByLabelText('Basis'), { target: { value: 'cash' } }); });
  assert.ok(!screen.queryByRole('button', { name: prompt }));
});

test('a capped chart or stale workspace flags cannot supply the list of accounts to explain', async () => {
  useLedgerStore.setState({ truncatedCollections: { chartAccounts: true } });
  const calls = stubFetch(404);
  await act(async () => { render(<ProfitAndLoss {...dates} />); });
  fireEvent.click(screen.getByRole('button', { name: prompt }));
  assert.ok(screen.getByText(/full account list is needed/));
  act(() => { useLedgerStore.setState({ truncatedCollections: {} }); useDataNeedsStore.setState({ loadedWorkspaceId: 'previous-book' }); });
  assert.ok(screen.getByText(/full account list is needed/));
  assert.ok(!calls.some(url => url.endsWith('/explain')));
});

test('a label is sent to the explanation read and an answer for a different book arriving later is ignored', async () => {
  const labelled = transactions.map((t, i) => ({ ...t, lines: t.lines.map(l => ({ ...l, dimensions: { location: i === 2 ? 'South' : 'North' } })) }));
  useLedgerStore.setState({ transactions: labelled });
  let received: Record<string, unknown> | undefined;
  let resolve!: (r: Response) => void;
  globalThis.fetch = async (input, init) => {
    if (!String(input).endsWith('/explain')) return new Response(null, { status: 503 });
    received = JSON.parse(String(init?.body));
    return new Promise<Response>(done => { resolve = done; });
  };
  await act(async () => { render(<ProfitAndLoss {...dates} />); });
  fireEvent.change(screen.getByLabelText('Label kind'), { target: { value: 'location' } });
  fireEvent.change(screen.getByLabelText('Label value'), { target: { value: 'North' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: prompt })); });
  assert.equal(received?.labelDimension, 'location');
  assert.equal(received?.labelValue, 'North');
  const panel = within(screen.getByRole('region', { name: prompt }));
  assert.ok(panel.getByText('$50.00')); // $130 minus $80, South's rent is not in this comparison.
  act(() => useAuthStore.setState({ currentWorkspaceId: 'other' }));
  await act(async () => { resolve(Response.json({ lines: [{ transactionId: 'secret-fixture', description: 'Old book activity', amountCents: 1000 }] })); });
  assert.ok(!screen.queryByRole('link', { name: 'Old book activity' }));
  assert.equal(screen.getByRole('button', { name: prompt }).getAttribute('aria-expanded'), 'false');
});
