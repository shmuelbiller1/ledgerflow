/**
 * The close package (R-11): the close status with every item's sign-off, a trial balance on the last
 * day (opening balances included, drafts and later entries left out, a total row that balances),
 * the month's ledger lines, and the month's questions with the latest answer. Hand-checked numbers.
 */
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { closePackageSheets } from '../lib/closePackage';
import { makeChartAccount, makeTransaction } from './fixtures';
import type { ClientQuery } from '../lib/clientQueries';

const bank = makeChartAccount({ id: 'bank', code: '1000', name: 'Checking', type: 'asset', openingBalanceCents: 100_000 });
const equity = makeChartAccount({ id: 'eq', code: '3000', name: 'Opening equity', type: 'equity', openingBalanceCents: 100_000 });
const sales = makeChartAccount({ id: 'sales', code: '4000', name: 'Sales', type: 'revenue' });
const sale = (id: string, date: string, cents: number, status = 'completed') =>
  makeTransaction({ id, date, status: status as never, description: id, reference: `R-${id}`, lines: [{ accountId: 'bank', accountName: 'Checking', amountCents: cents }, { accountId: 'sales', accountName: 'Sales', amountCents: -cents }] });
const query = (id: string, date: string, status: ClientQuery['status']): ClientQuery => ({
  id, workspaceId: 'w', transactionId: `t-${id}`, entry: { date, description: `Entry ${id}`, amountCents: 34_000, currency: 'USD' }, askedBy: 'book', askedAt: date, status, updatedAt: date,
  messages: [{ uid: 'book', text: 'What was this?', at: date }, { uid: 'owner', text: 'Office chairs', at: date }, { uid: 'book', text: 'Receipt?', at: date }],
});

describe('Close package', () => {
  const sheets = closePackageSheets({
    month: '2026-09', monthEnd: '2026-09-30', state: 'Closed: nobody can post', closedThrough: '2026-09-30',
    items: [
      { id: 'reconcile', title: 'Bank lines matched', status: 'attention', detail: '2 lines not matched.' },
      { id: 'drafts', title: 'Drafts dated in the month', status: 'done', detail: 'No drafts.' },
      { id: 'step:cs_1', title: 'Get the payroll report', status: 'attention', detail: "This client's own step." },
    ],
    signOffs: { reconcile: { by: 'ann@x.test', at: '2026-10-02T09:00:00Z', note: 'timing differences' }, 'step:cs_1': { by: 'bo@x.test', at: '2026-10-03T09:00:00Z' } },
    accounts: [bank, equity, sales],
    transactions: [sale('aug', '2026-08-20', 20_000), sale('sep', '2026-09-10', 30_000), sale('draft', '2026-09-12', 99_000, 'draft'), sale('oct', '2026-10-01', 5_000)],
    queries: [query('q1', '2026-09-10', 'answered'), query('q2', '2026-08-20', 'open')],
  });
  const [status, tb, gl, questions] = sheets;

  test('close status: state, and each item with who signed it off', () => {
    assert.deepEqual(status.rows.map(r => [r.item, r.status]), [
      ['Month', '2026-09'], ['State', 'Closed: nobody can post'],
      ['Bank lines matched', 'Signed off by ann@x.test on 2026-10-02: timing differences'],
      ['Drafts dated in the month', 'Done'], ['Get the payroll report', 'Signed off by bo@x.test on 2026-10-03'],
    ]);
  });

  test('trial balance on the last day: opening balances in, drafts and October out, totals equal', () => {
    // bank 1,000 + 200 + 300 = 1,500 debit; sales 500 credit; equity 1,000 credit
    assert.deepEqual(tb.rows.map(r => [r.code, r.debit, r.credit, r.net]), [
      ['1000', 1500, 0, 1500], ['3000', 0, 1000, -1000], ['4000', 0, 500, -500], ['', 1500, 1500, 0],
    ]);
    assert.equal(typeof tb.rows[0].debit, 'number', 'numbers, not text');
  });

  test('the month\'s ledger lines and questions (latest answer from the other side)', () => {
    assert.deepEqual(gl.rows.map(r => [r.date, r.ref, r.account, r.amount]), [['2026-09-10', 'R-sep', 'Checking', 300], ['2026-09-10', 'R-sep', 'Sales', -300]]);
    assert.deepEqual(questions.rows, [{ date: '2026-09-10', entry: 'Entry q1', amount: 340, currency: 'USD', status: 'Answered', question: 'What was this?', answer: 'Office chairs' }]);
  });
});

test('the workbook preserves minor units for a JPY ledger and a KWD question', () => {
  const q = query('q', '2026-09-05', 'open');
  q.entry = { ...q.entry, currency: 'KWD', amountCents: 1234 };
  const [, tb, gl, questions] = closePackageSheets({
    month: '2026-09', monthEnd: '2026-09-30', state: 'Open', closedThrough: '', currency: 'JPY',
    accounts: [], transactions: [sale('jpy', '2026-09-10', 40000)], items: [], signOffs: {}, queries: [q],
  });
  assert.deepEqual([tb.rows.at(-1)?.debit, tb.rows.at(-1)?.credit], [40000, 40000]);
  assert.deepEqual(gl.rows.map(r => r.amount), [40000, -40000]);
  assert.deepEqual([questions.rows[0].currency, questions.rows[0].amount], ['KWD', 1.234]);
});
