import './helpers/dom';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
afterEach(() => cleanup());
import { formatCurrency } from '../lib/utils';
import { makeChartAccount } from './fixtures';
import type { CloseItem } from '../lib/closeChecklist';
import type { MonthCloseState } from '../lib/periodLock';
import CloseJourneyPanel from '../components/ledger/CloseJourneyPanel';

const accounts = [
  makeChartAccount({ id: 'bank-1000', code: '1000', name: 'Bank 1000', type: 'asset', category: 'Cash' }),
  makeChartAccount({ id: 'bank-1010', code: '1010', name: 'Bank 1010', type: 'asset', category: 'Cash' }),
];
const bankLines = [
  { accountId: 'bank-1000', date: '2026-09-03', status: 'matched' as const, matchedTransactionId: 't1' },
  { accountId: 'bank-1000', date: '2026-09-10', status: 'pending' as const },
  { accountId: 'bank-1010', date: '2026-09-02', status: 'matched' as const, matchedTransactionId: 't2' },
];
const invoices = [
  { id: 'i1', number: '1001', status: 'sent', date: '2026-09-05', amountCents: 118000, amountPaidCents: 18000, currency: 'ILS' },
];
const bills = [{ id: 'b1', number: '9001', status: 'pending', date: '2026-09-08', amountCents: 60000, currency: 'ILS' }];
const items: CloseItem[] = [
  { id: 'drafts', title: 'Drafts dated in the month', status: 'blocker', detail: '2 drafts dated in this month.', count: 2 },
  { id: 'categorize', title: 'Every transaction has an account', status: 'attention', detail: '3 transactions without an account.', count: 3 },
  { id: 'trial-balance', title: 'Trial balance balances', status: 'done', detail: 'Debits equal credits through the end of the month.', count: 0 },
] as CloseItem[];

const panel = (extra: Partial<React.ComponentProps<typeof CloseJourneyPanel>> = {}) => render(
  <CloseJourneyPanel month="2026-09" state={'open' as MonthCloseState} items={items} accounts={accounts}
    bankLines={bankLines} invoices={invoices} bills={bills} journalEntries={[{ id: 'j1', date: '2026-09-30' }]} currency="ILS" {...extra} />,
);

test('A-151 screen: the journey is listed in order as a read-only path', () => {
  panel();
  assert.ok(screen.getByRole('heading', { name: 'Close journey' }));
  assert.match(screen.getByText(/nothing here is signed, posted or closed/).textContent ?? '', /nothing here is signed/);
  const headings = screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent || '');
  assert.deepEqual(headings, [
    '1. Reconcile each bank',
    '2. Give every entry an account',
    '3. Review receivables aging',
    '4. Review payables aging',
    '5. Review accruals and prepayments',
    '6. Clear the drafts dated in the month',
    '7. Check the trial balance',
    '8. Lock the month',
    '9. Take the report pack',
  ]);
  assert.ok(screen.getByText('Blocks the close'), 'the draft blocker is named');
  assert.ok(screen.getAllByText('Needs attention').length >= 2, 'the bank, account and lock steps');
  assert.ok(screen.getAllByText('For review').length >= 3, 'open invoices, open bills and accruals');
});

test('A-151 screen: each bank account is shown with its own unmatched count', () => {
  panel();
  const table = screen.getByRole('table', { name: /Each bank account for 2026-09/ });
  const rows = Array.from(table.querySelectorAll('tbody tr')).map(row => Array.from(row.querySelectorAll('th,td')).map(cell => cell.textContent));
  assert.deepEqual(rows, [
    ['Bank 1000', '2', '1'],
    ['Bank 1010', '1', '0'],
  ]);
});

test('A-151 screen: money on the open documents is the workspace currency, and every step opens its screen', () => {
  panel();
  assert.ok(screen.getAllByText(formatCurrency(100000, 'ILS')).length >= 1, 'the open invoice');
  assert.ok(screen.getAllByText(formatCurrency(60000, 'ILS')).length >= 1, 'the open bill');
  assert.ok(screen.getByRole('button', { name: /Open Reconcile/ }));
  assert.ok(screen.getAllByRole('button', { name: /Open Ledger & Journal/ }).length >= 2, 'the account and accrual steps');
  assert.ok(screen.getByRole('link', { name: 'Open Current A/R Aging' }));
  assert.ok(screen.getByRole('link', { name: 'Open Current A/P Aging' }));
  for (const name of ['Open Trial Balance', 'Open Profit & Loss', 'Open Balance Sheet']) {
    const url = new URL(screen.getByRole('link', { name }).getAttribute('href')!, 'https://example.test');
    assert.equal(url.hash, '#reports');
    assert.equal(url.searchParams.get('start'), '2026-09-01');
    assert.equal(url.searchParams.get('end'), '2026-09-30');
  }
  assert.ok(screen.getAllByRole('button', { name: /Open Month-End Close/ }).length >= 1);
});

test('A-151 screen: a closed month says so and the path is complete when nothing needs attention', () => {
  const clean: CloseItem[] = [
    { id: 'drafts', title: 'Drafts', status: 'done', detail: 'No drafts dated in this month.', count: 0 },
    { id: 'categorize', title: 'Every transaction has an account', status: 'done', detail: 'All transactions have an account.', count: 0 },
    { id: 'trial-balance', title: 'Trial balance balances', status: 'done', detail: 'Debits equal credits.', count: 0 },
  ] as CloseItem[];
  panel({ items: clean, state: 'hard' as MonthCloseState, bankLines: [bankLines[0], bankLines[2]] });
  assert.match(screen.getByText(/nothing in the recorded data blocks the close/).textContent ?? '', /nothing in the recorded data/);
  assert.ok(screen.getAllByText('Done').length >= 4, 'banks, account, trial balance and the lock');
  assert.match(screen.getByText(/2026-09 is closed\./).textContent ?? '', /is closed/);
});

test('A-151 screen: a month that is not written as one is reported, never guessed', () => {
  panel({ month: '09/2026' });
  assert.match(screen.getByRole('alert').textContent ?? '', /A month is written as 2026-09/);
});
