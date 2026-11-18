/**
 * A-151 (P2-2): the month-end close journey, with hand-worked figures for September 2026.
 *
 * Bank lines in the month: bank 1000 two (one matched, one pending), bank 1010 one (matched), and
 * one line with no bank account (pending). Open at 30 September: invoice 118,000 less 18,000 paid
 * = 100,000 due, one invoice in USD counted apart, one invoice dated 2 October left out, one paid
 * invoice left out; bill 60,000 due. Journal entries dated in the month: two live, one deleted,
 * one dated in October.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeJourney, type CloseJourneyInput } from '../lib/closeJourney';
import { buildCloseChecklist } from '../lib/closeChecklist';
import { makeChartAccount } from './fixtures';

const accounts = [
  makeChartAccount({ id: 'bank-1000', code: '1000', name: 'Bank 1000', type: 'asset', category: 'Cash' }),
  makeChartAccount({ id: 'bank-1010', code: '1010', name: 'Bank 1010', type: 'asset', category: 'Cash' }),
  makeChartAccount({ id: 'sales', code: '4000', name: 'Sales', type: 'income', category: 'Revenue' }),
];
const bankLines = [
  { accountId: 'bank-1000', date: '2026-09-03', status: 'matched' as const, matchedTransactionId: 't1' },
  { accountId: 'bank-1000', date: '2026-09-10', status: 'pending' as const },
  { accountId: 'bank-1010', date: '2026-09-02', status: 'matched' as const, matchedTransactionId: 't2' },
  { date: '2026-09-30', status: 'pending' as const },
  { accountId: 'bank-1000', date: '2026-10-01', status: 'pending' as const },
];
const invoices = [
  { id: 'i1', number: '1001', status: 'sent', date: '2026-09-05', amountCents: 118000, amountPaidCents: 18000, currency: 'ILS' },
  { id: 'i2', number: '1002', status: 'sent', date: '2026-10-02', amountCents: 50000, currency: 'ILS' },
  { id: 'i3', number: '1003', status: 'paid', date: '2026-09-06', amountCents: 40000, amountPaidCents: 40000, currency: 'ILS' },
  { id: 'i4', number: '1004', status: 'sent', date: '2026-09-07', amountCents: 50000, currency: 'USD' },
];
const bills = [{ id: 'b1', number: '9001', status: 'pending', date: '2026-09-08', amountCents: 60000, currency: 'ILS' }];
const journalEntries = [
  { id: 'j1', date: '2026-09-30' },
  { id: 'j2', date: '2026-09-15' },
  { id: 'j3', date: '2026-09-20', deletedAt: '2026-09-21' },
  { id: 'j4', date: '2026-10-01' },
];
const items: CloseJourneyInput['items'] = [
  { id: 'drafts', title: 'Drafts dated in the month', status: 'blocker', detail: '2 drafts dated in this month.', count: 2 },
  { id: 'categorize', title: 'Every transaction has an account', status: 'attention', detail: '3 transactions without an account.', count: 3 },
  { id: 'trial-balance', title: 'Trial balance balances', status: 'done', detail: 'Debits equal credits through the end of the month.', count: 0 },
];

const journey = (extra: Partial<CloseJourneyInput> = {}) => closeJourney({
  month: '2026-09', state: 'open', items, accounts, bankLines, invoices, bills, journalEntries, currency: 'ILS', ...extra,
});

test('A-151 the path is in the order the work is done, and each step names its screen', () => {
  const found = journey();
  assert.deepEqual(found.steps.map(s => s.id),
    ['banks', 'categorize', 'receivables', 'payables', 'accruals', 'drafts', 'trial-balance', 'lock', 'report-pack']);
  assert.equal(found.steps.find(s => s.id === 'banks')!.screen, 'reconciliation');
  assert.equal(found.steps.find(s => s.id === 'receivables')!.screen, 'ar-aging');
  assert.equal(found.steps.find(s => s.id === 'lock')!.screen, 'month-end-close');
  assert.equal(found.endDate, '2026-09-30');
});

test('A-151 each bank is reconciled apart: 4 lines in the month, 2 unmatched, 1 line with no account', () => {
  const step = journey().steps.find(s => s.id === 'banks')!;
  assert.equal(step.status, 'attention');
  assert.deepEqual(step.banks.map(b => [b.accountId, b.lines, b.unmatched]), [
    ['bank-1000', 2, 1], // the October line is not in this month
    ['bank-1010', 1, 0],
    ['', 1, 1],
  ]);
  const figure = (label: string) => step.figures.find(f => f.label === label)?.count;
  assert.equal(figure('Bank lines to reconcile in the month'), 4);
  assert.equal(figure('Not matched'), 2);
  assert.match(step.detail, /Bank 1000 \(1\)/);
});

test('R-1 reviewed duplicates do not count against reconciliation in either close view', () => {
  const lines = [bankLines[0], { date: '2026-09-27', accountId: 'bank-1000', status: 'ignored' as const }];
  const checklist = buildCloseChecklist({ month: '2026-09', transactions: [], invoices: [], bills: [], bankLines: lines });
  const banks = journey({ bankLines: lines, items: checklist }).steps.find(s => s.id === 'banks')!;
  assert.equal(checklist.find(s => s.id === 'reconcile')!.status, 'done');
  assert.equal(banks.status, 'done');
  assert.deepEqual(banks.banks.map(b => [b.accountId, b.lines, b.unmatched]), [['bank-1000', 1, 0], ['bank-1010', 0, 0]]);
});

test('A-151 current unpaid invoices and bills dated through month end: 100,000 for the open invoice, the USD one counted apart, October left out', () => {
  const found = journey();
  const receivables = found.steps.find(s => s.id === 'receivables')!;
  assert.equal(receivables.figures.find(f => f.label === 'Invoices open')?.count, 2, 'ils and usd');
  assert.equal(receivables.figures.find(f => f.label === 'Due in the workspace currency')?.cents, 100000);
  assert.match(receivables.detail, /another currency/);
  assert.match(receivables.what, /today’s unpaid amounts.*Payments and credits after that date are not reversed/);
  const payables = found.steps.find(s => s.id === 'payables')!;
  assert.equal(payables.figures.find(f => f.label === 'Bills open')?.count, 1);
  assert.equal(payables.figures.find(f => f.label === 'Due in the workspace currency')?.cents, 60000);
  // open documents are a review, never a blocker
  assert.equal(receivables.status, 'review');
  assert.equal(payables.status, 'review');
});

test('A-151 the accrual reminder counts the month’s journal entries and claims no decision', () => {
  const step = journey().steps.find(s => s.id === 'accruals')!;
  assert.equal(step.figures[0].count, 2, 'two live entries in September; deleted and October entries left out');
  assert.equal(step.status, 'review');
  assert.match(step.detail, /cannot decide which costs belong to the month/);
});

test('A-151 the checklist’s own blocker and attention statuses are carried, never softened', () => {
  const found = journey();
  assert.equal(found.steps.find(s => s.id === 'drafts')!.status, 'blocker');
  assert.equal(found.steps.find(s => s.id === 'categorize')!.status, 'attention');
  assert.equal(found.steps.find(s => s.id === 'trial-balance')!.status, 'done');
  assert.equal(found.blockers, 1);
  assert.equal(found.attention, 3, 'banks, categorize and the open month');
  assert.equal(found.nextStep, 'banks', 'the first open step in the order');
  assert.equal(found.readyToClose, false);
});

test('A-151 a closed month with nothing needing attention is ready; a soft close is still a close', () => {
  const clean: CloseJourneyInput['items'] = [
    { id: 'drafts', title: 'Drafts', status: 'done', detail: 'No drafts dated in this month.', count: 0 },
    { id: 'categorize', title: 'Accounts', status: 'done', detail: 'All transactions have an account.', count: 0 },
    { id: 'trial-balance', title: 'Trial balance', status: 'done', detail: 'Debits equal credits.', count: 0 },
  ];
  const soft = journey({ items: clean, state: 'soft', bankLines: [bankLines[0], bankLines[2]] });
  assert.equal(soft.steps.find(s => s.id === 'banks')!.status, 'done');
  assert.equal(soft.steps.find(s => s.id === 'lock')!.status, 'done');
  assert.equal(soft.readyToClose, true);
  assert.equal(soft.nextStep, undefined);
  assert.match(soft.steps.find(s => s.id === 'lock')!.detail, /soft-closed/);

  const partly = journey({ items: clean, state: 'partly-open', bankLines: [bankLines[0], bankLines[2]] });
  assert.equal(partly.steps.find(s => s.id === 'lock')!.status, 'done', 'a close with unlocked dates is still closed');
  assert.match(partly.steps.find(s => s.id === 'lock')!.detail, /unlocked/);
});

test('A-151 no bank account and no month are said plainly', () => {
  const none = journey({ accounts: [], bankLines: [] });
  assert.equal(none.steps.find(s => s.id === 'banks')!.status, 'not-applicable');
  assert.match(none.steps.find(s => s.id === 'banks')!.detail, /No bank or cash account/);
  const broken = closeJourney({ month: '09/2026', state: 'open', items: [], currency: 'ILS' });
  assert.match(broken.problems.join(' '), /2026-09/);
  assert.equal(broken.readyToClose, false);
});
