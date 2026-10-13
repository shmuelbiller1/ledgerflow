/**
 * Account groups (K-14) on the screens: choosing a parent in the chart of accounts, and what the
 * trial balance, the balance sheet and the P&L do with a group — children indented, a subtotal for
 * the group, and the report's own total exactly where it was. Looking at a group writes nothing.
 */
import { stubFetch, stubFetchWithBodies } from './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ChartOfAccountsView from '../components/ledger/ChartOfAccountsView';
import TrialBalanceView from '../components/ledger/TrialBalanceView';
import BalanceSheetView from '../components/ledger/BalanceSheetView';
import ProfitAndLossView from '../components/ledger/ProfitAndLossView';
import { getSupabase } from '../lib/db/client';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { makeChartAccount, makeTransaction } from './fixtures';
import { setComponentWorkspace } from './helpers/componentFixtures';

const money = (cents: number) => `${cents < 0 ? '-' : ''}$${(Math.abs(cents) / 100).toFixed(2)}`;

/** Overheads holds Rent and Electricity; Cash and Sales stand alone. */
const groupedChart = [
  makeChartAccount({ id: 'cash', code: '1000', name: 'Cash', type: 'asset', category: 'Cash' }),
  makeChartAccount({ id: 'sales', code: '4000', name: 'Sales', type: 'income', category: 'Revenue' }),
  makeChartAccount({ id: 'overhead', code: '6000', name: 'Overheads', type: 'expense', category: 'Operating' }),
  makeChartAccount({ id: 'rent', code: '6100', name: 'Rent', type: 'expense', category: 'Operating', parentId: 'overhead' }),
  makeChartAccount({ id: 'electricity', code: '6200', name: 'Electricity', type: 'expense', category: 'Operating', parentId: 'overhead' }),
];

/**
 * March: 195.00 of sales into cash, then Overheads itself 5.00, Rent 120.00 and Electricity 70.00
 * back out of it. So the group's subtotal is 5.00 + 120.00 + 70.00 = 195.00, cash ends at nothing,
 * and the trial balance has 195.00 of debits and 195.00 of credits.
 */
const groupedLedger = [
  makeTransaction({
    id: 'tx-sales', date: '2026-03-02', status: 'completed', posted: true,
    lines: [{ accountId: 'cash', amountCents: 19500 }, { accountId: 'sales', amountCents: -19500 }],
  }),
  makeTransaction({
    id: 'tx-overhead', date: '2026-03-05', status: 'completed', posted: true,
    lines: [{ accountId: 'overhead', amountCents: 500 }, { accountId: 'cash', amountCents: -500 }],
  }),
  makeTransaction({
    id: 'tx-rent', date: '2026-03-06', status: 'completed', posted: true,
    lines: [{ accountId: 'rent', amountCents: 12000 }, { accountId: 'cash', amountCents: -12000 }],
  }),
  makeTransaction({
    id: 'tx-power', date: '2026-03-07', status: 'completed', posted: true,
    lines: [{ accountId: 'electricity', amountCents: 7000 }, { accountId: 'cash', amountCents: -7000 }],
  }),
];

const chart = () => render(
  <ChartOfAccountsView accounts={groupedChart} searchTerm="" formatCurrency={money} onDrillDown={() => {}} onDeleteAccount={() => {}} />,
);
/** How far a chart row is indented: the wrapper of the code cell. */
const chartIndent = (name: string) =>
  (screen.getByRole('button', { name: `Edit Code of ${name}` }).closest('td')!.firstElementChild as HTMLElement).style.paddingLeft;

beforeEach(() => {
  stubFetch(404);
  useAuthStore.setState({ user: null, currentWorkspaceId: null, workspaces: [] });
  useLedgerStore.setState({ transactions: groupedLedger, accounts: groupedChart, journalEntries: [], isDataTruncated: false });
});
afterEach(async () => { cleanup(); await getSupabase().auth.dispose(); });

describe('the chart of accounts', () => {
  beforeEach(() => setComponentWorkspace('owner'));

  test('a group stays closed until it is opened, and every account inside it is there', () => {
    chart();
    assert.ok(screen.getByText('Overheads'));
    assert.equal(screen.queryByText('Rent'), null, 'the accounts inside a closed group are hidden');
    assert.equal(screen.queryByText('Electricity'), null);
    fireEvent.click(screen.getByRole('button', { name: 'Show the accounts inside Overheads' }));
    assert.ok(screen.getByText('Rent'));
    assert.ok(screen.getByText('Electricity'));
    assert.deepEqual([chartIndent('Overheads'), chartIndent('Rent')], ['0px', '16px'], 'a child is indented one level');
    fireEvent.click(screen.getByRole('button', { name: 'Hide the accounts inside Overheads' }));
    assert.equal(screen.queryByText('Rent'), null);
    assert.ok(screen.getByText('Overheads'));
  });

  test('a parent is chosen in place, and only the accounts it may hold are offered', async () => {
    const calls = stubFetchWithBodies(200, null);
    const flat = [
      makeChartAccount({ id: 'cash', code: '1000', name: 'Cash', type: 'asset', category: 'Cash' }),
      makeChartAccount({ id: 'overhead', code: '6000', name: 'Overheads', type: 'expense', category: 'Operating' }),
      makeChartAccount({ id: 'rent', code: '6100', name: 'Rent', type: 'expense', category: 'Operating' }),
    ];
    render(<ChartOfAccountsView accounts={flat} searchTerm="" formatCurrency={money} onDrillDown={() => {}} onDeleteAccount={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Parent account of Rent' }));
    const picker = screen.getByLabelText('Parent account of Rent') as HTMLSelectElement;
    assert.deepEqual(
      [...picker.options].map(option => option.textContent),
      ['No parent (top level)', '6000 · Overheads'],
      'Cash is an asset account, so it is not offered as a parent for an expense',
    );
    fireEvent.change(picker, { target: { value: 'overhead' } });
    await act(async () => { fireEvent.keyDown(picker, { key: 'Enter' }); });
    await waitFor(() => assert.equal(calls.filter(call => call.url.includes('/rpc/lf_update')).length, 1));
    const saved = calls.find(call => call.url.includes('/rpc/lf_update'))!.body as { p_table: string; p_id: string; p_set: Record<string, unknown> };
    assert.deepEqual([saved.p_table, saved.p_id, saved.p_set.parentId], ['chartAccounts', 'rent', 'overhead']);
    assert.equal(typeof saved.p_set.updatedAt, 'string');
  });

  test('taking an account out of its group saves no parent, and a viewer only reads the group', async () => {
    const calls = stubFetchWithBodies(200, null);
    chart();
    fireEvent.click(screen.getByRole('button', { name: 'Show the accounts inside Overheads' }));
    const shown = screen.getByRole('button', { name: 'Edit Parent account of Rent' });
    assert.equal(shown.textContent, 'Overheads', 'the row reads the parent\'s name, not its id');
    fireEvent.click(shown);
    const picker = screen.getByLabelText('Parent account of Rent') as HTMLSelectElement;
    // Overheads is the saved parent, so it stays listed even though Rent is already inside it (a
    // loop would be refused); its sibling Electricity is a parent Rent could move into
    assert.deepEqual(
      [...picker.options].map(option => option.textContent),
      ['No parent (top level)', '6000 · Overheads', '6200 · Electricity'],
    );
    assert.equal(picker.value, 'overhead');
    fireEvent.change(picker, { target: { value: '' } });
    await act(async () => { fireEvent.keyDown(picker, { key: 'Enter' }); });
    await waitFor(() => assert.equal(calls.filter(call => call.url.includes('/rpc/lf_update')).length, 1));
    const saved = calls.find(call => call.url.includes('/rpc/lf_update'))!.body as { p_id: string; p_set: Record<string, unknown> };
    assert.deepEqual([saved.p_id, saved.p_set.parentId], ['rent', null]);
    cleanup();
    setComponentWorkspace('viewer');
    chart();
    assert.equal(screen.queryByRole('button', { name: /^Edit Parent account/ }), null, 'a viewer cannot move an account');
    assert.ok(screen.getByRole('button', { name: 'Show the accounts inside Overheads' }), 'a viewer can still open the group');
    assert.equal(calls.filter(call => call.url.includes('/rpc/lf_update')).length, 1, 'reading a group writes nothing');
  });
});

describe('the trial balance', () => {
  const view = () => render(<TrialBalanceView accounts={groupedChart} formatCurrency={money} onDrillDown={() => {}} />);
  const rows = () => screen.getAllByRole('row').map(row => row.textContent || '');
  const footer = () => rows().find(row => row.includes('Total Trial Balance'))!;

  test('a group shows its accounts and a subtotal, and the trial balance total does not move', async () => {
    view();
    await waitFor(() => assert.ok(rows().some(row => row.includes('Total Overheads'))));
    const subtotal = rows().find(row => row.includes('Total Overheads'))!;
    assert.match(subtotal, /\$195\.00/, 'the subtotal is 5.00 + 120.00 + 70.00');
    assert.deepEqual(footer().match(/\$195\.00/g)!.length, 2, 'debits and credits still agree');
    const nameCell = (name: string) => screen.getByText(name).closest('div[style]') as HTMLElement;
    assert.deepEqual([nameCell('Overheads').style.paddingLeft, nameCell('Rent').style.paddingLeft], ['0px', '16px']);
  });

  test('closing a group hides its accounts and its subtotal, and nothing else', async () => {
    view();
    await waitFor(() => assert.ok(rows().some(row => row.includes('Total Overheads'))));
    const openFooter = footer();
    fireEvent.click(screen.getByRole('button', { name: 'Hide the accounts inside Overheads' }));
    const closed = rows();
    assert.equal(closed.some(row => row.includes('Rent')), false);
    assert.equal(closed.some(row => row.includes('Electricity')), false);
    assert.equal(closed.some(row => row.includes('Total Overheads')), false);
    assert.ok(closed.some(row => row.includes('Overheads')), 'the group\'s own account stays');
    assert.ok(closed.some(row => row.includes('Sales')), 'another account is untouched');
    assert.equal(footer(), openFooter, 'the totals do not move');
    fireEvent.click(screen.getByRole('button', { name: 'Show the accounts inside Overheads' }));
    assert.ok(rows().some(row => row.includes('Total Overheads')));
    assert.equal(footer(), openFooter);
  });

  test('looking at a group never posts or writes', async () => {
    const calls = stubFetchWithBodies(404);
    view();
    await waitFor(() => assert.ok(rows().some(row => row.includes('Total Overheads'))));
    fireEvent.click(screen.getByRole('button', { name: 'Hide the accounts inside Overheads' }));
    assert.deepEqual(calls.filter(call => call.method !== 'GET'), []);
  });
});

describe('the balance sheet', () => {
  /** Current assets (a group) holds Cash and Bank; Equipment, the loan and the capital stand alone. */
  const sheetChart = [
    makeChartAccount({ id: 'current', code: '1000', name: 'Current assets', type: 'asset', category: 'Current Assets' }),
    makeChartAccount({ id: 'cash', code: '1100', name: 'Cash', type: 'asset', category: 'Cash', parentId: 'current' }),
    makeChartAccount({ id: 'bank', code: '1200', name: 'Bank', type: 'asset', category: 'Cash', parentId: 'current' }),
    makeChartAccount({ id: 'equipment', code: '1500', name: 'Equipment', type: 'asset', category: 'Fixed Assets' }),
    makeChartAccount({ id: 'loan', code: '2000', name: 'Bank loan', type: 'liability', category: 'Loans' }),
    makeChartAccount({ id: 'capital', code: '3000', name: 'Owner capital', type: 'equity', category: 'Equity' }),
  ];
  /** 150.00 of capital into cash, 250.00 borrowed: 50.00 into the bank and 200.00 into equipment. */
  const sheetLedger = [
    makeTransaction({
      id: 'tx-capital', date: '2026-01-05', status: 'completed', posted: true,
      lines: [{ accountId: 'cash', amountCents: 15000 }, { accountId: 'capital', amountCents: -15000 }],
    }),
    makeTransaction({
      id: 'tx-loan-bank', date: '2026-02-01', status: 'completed', posted: true,
      lines: [{ accountId: 'bank', amountCents: 5000 }, { accountId: 'loan', amountCents: -5000 }],
    }),
    makeTransaction({
      id: 'tx-loan-equipment', date: '2026-02-02', status: 'completed', posted: true,
      lines: [{ accountId: 'equipment', amountCents: 20000 }, { accountId: 'loan', amountCents: -20000 }],
    }),
  ];
  const sheet = () => {
    useLedgerStore.setState({ transactions: sheetLedger, accounts: sheetChart });
    return render(<BalanceSheetView accounts={sheetChart} formatCurrency={money} asOfDate="2026-03-31" />);
  };
  const totalAssets = (view: ReturnType<typeof sheet>) =>
    view.getByText(/Total Assets/).closest('div')!.parentElement!.textContent || '';

  test('assets are grouped with a subtotal, and total assets are unchanged', async () => {
    const view = sheet();
    await waitFor(() => assert.ok(view.queryByText('Total Current assets')));
    assert.equal(view.getByText('Total Current assets').parentElement!.textContent, 'Total Current assets$200.00');
    assert.match(totalAssets(view), /\$400\.00/, '150.00 + 50.00 inside the group, plus 200.00 of equipment');
    assert.ok(view.getByText('Balanced'), 'the sheet still balances');
    assert.equal((view.getByTitle('Click to drill down into Cash').parentElement as HTMLElement).style.paddingLeft, '16px');
    assert.equal((view.getByTitle('Click to drill down into Equipment').parentElement as HTMLElement).style.paddingLeft, '0px');
  });

  test('closing a group hides its accounts and its subtotal; the totals stay', async () => {
    const view = sheet();
    await waitFor(() => assert.ok(view.queryByText('Total Current assets')));
    fireEvent.click(view.getByRole('button', { name: 'Hide the accounts inside Current assets' }));
    assert.equal(view.queryByTitle('Click to drill down into Cash'), null);
    assert.equal(view.queryByTitle('Click to drill down into Bank'), null);
    assert.equal(view.queryByText('Total Current assets'), null);
    assert.ok(view.getByTitle('Click to drill down into Equipment'), 'an account with no group stays');
    assert.match(totalAssets(view), /\$400\.00/);
    assert.match(view.getByText(/Total Equity & Liabilities/).closest('div')!.parentElement!.textContent || '', /\$400\.00/);
    assert.ok(view.getByText('Balanced'));
  });
});

describe('the profit and loss', () => {
  /** Sales (a group) holds Product sales and Service sales; Rent stands alone. */
  const plChart = [
    makeChartAccount({ id: 'cash', code: '1000', name: 'Cash', type: 'asset', category: 'Cash' }),
    makeChartAccount({ id: 'sales', code: '4000', name: 'Sales', type: 'income', category: 'Revenue' }),
    makeChartAccount({ id: 'products', code: '4100', name: 'Product sales', type: 'income', category: 'Revenue', parentId: 'sales' }),
    makeChartAccount({ id: 'services', code: '4200', name: 'Service sales', type: 'income', category: 'Revenue', parentId: 'sales' }),
    makeChartAccount({ id: 'rent', code: '6100', name: 'Rent', type: 'expense', category: 'Operating' }),
  ];
  /** 50.00 posted on Sales itself, so the group's own line is part of its subtotal. */
  const plLedger = [
    makeTransaction({
      id: 'tx-sales', date: '2026-03-01', status: 'completed', posted: true,
      lines: [{ accountId: 'cash', amountCents: 5000 }, { accountId: 'sales', amountCents: -5000 }],
    }),
    makeTransaction({
      id: 'tx-products', date: '2026-03-02', status: 'completed', posted: true,
      lines: [{ accountId: 'cash', amountCents: 30000 }, { accountId: 'products', amountCents: -30000 }],
    }),
    makeTransaction({
      id: 'tx-services', date: '2026-03-09', status: 'completed', posted: true,
      lines: [{ accountId: 'cash', amountCents: 15000 }, { accountId: 'services', amountCents: -15000 }],
    }),
    makeTransaction({
      id: 'tx-rent', date: '2026-03-15', status: 'completed', posted: true,
      lines: [{ accountId: 'rent', amountCents: 8000 }, { accountId: 'cash', amountCents: -8000 }],
    }),
  ];
  const pl = () => {
    useLedgerStore.setState({ transactions: plLedger, accounts: plChart });
    return render(<ProfitAndLossView startDate="2026-03-01" endDate="2026-03-31" />);
  };

  test('income is grouped with a subtotal that adds up to the section total', async () => {
    const view = pl();
    await waitFor(() => assert.ok(view.queryByText('Total Sales')));
    assert.equal(view.getByText('Total Sales').parentElement!.textContent, 'Total Sales$500.00', '50.00 + 300.00 + 150.00');
    assert.ok(view.getByText('Product sales'));
    assert.ok(view.getByText('Service sales'));
    assert.equal(view.getAllByText('$500.00').length >= 2, true, 'the subtotal and the section header agree');
    assert.equal((view.getByTitle('Click to drill down into Product sales').parentElement as HTMLElement).style.paddingLeft, '16px');
  });

  test('closing a group hides its accounts and its subtotal, and the income total stays', async () => {
    const view = pl();
    await waitFor(() => assert.ok(view.queryByText('Total Sales')));
    fireEvent.click(view.getByRole('button', { name: 'Hide the accounts inside Sales' }));
    assert.equal(view.queryByText('Product sales'), null);
    assert.equal(view.queryByText('Service sales'), null);
    assert.equal(view.queryByText('Total Sales'), null);
    assert.ok(view.getByText('Sales'), 'the group\'s own account stays');
    assert.ok(view.getByText('Rent'), 'another section is untouched');
    assert.ok(view.getAllByText('$500.00').length >= 1, 'the income total is still the section header');
    fireEvent.click(view.getByRole('button', { name: 'Show the accounts inside Sales' }));
    assert.ok(view.getByText('Total Sales'));
  });
});
