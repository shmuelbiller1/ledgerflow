/**
 * Loans (A-2, K-30, AI #3): the amortisation schedule and the two entries a loan posts.
 *
 * Every number below is worked out by hand. The small loan is $1,200 over 3 months at 12% a year
 * (1% a month): the annuity payment is 1,200 × 0.01 ÷ (1 − 1.01⁻³) = 40802.653… cents, so the level
 * payment is 40,803 (rounded up so the loan can be repaid inside its term). The longer one is
 * $10,000 over 12 months at 6% a year (0.5% a month), the loan in the screen's example.
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import {
  buildLoanSchedule,
  interestForMonthCents,
  levelPaymentCents,
  nextInstallment,
  scheduleBalanceCents,
  scheduleInterestPaidCents,
} from '../lib/loanSchedule';
import type { LoanSchedule, LoanScheduleInput } from '../lib/loanSchedule';
import {
  createLoanDisbursementEntry,
  createLoanPaymentEntry,
  formatLoanRate,
  loanBankChoices,
  loanInterestChoices,
  loanLedgerCents,
  loanLiabilityChoices,
  loanProblem,
  newLoanReference,
  recordedInstallments,
} from '../lib/loans';
import type { Loan } from '../lib/loans';
import { makeChartAccount, makeTransaction } from './fixtures';
import { lineAmount } from '../lib/txFilters';
import type { Firestore } from '../server/db/pgFirestore';
import type { ChartAccount, Transaction } from '../types';

const bank: ChartAccount = makeChartAccount({ id: 'bank', code: '1010', name: 'Bank', type: 'asset', category: 'Cash' });
const loanAccount: ChartAccount = makeChartAccount({ id: 'loan', code: '2500', name: 'Bank loans', type: 'liability', category: 'Payables' });
const interestAccount: ChartAccount = makeChartAccount({ id: 'interest', code: '6100', name: 'Interest expense', type: 'expense', category: 'Expenses' });
const salesAccount: ChartAccount = makeChartAccount({ id: 'sales', code: '4000', name: 'Sales', type: 'revenue', category: 'Revenue' });

const accounts = [bank, loanAccount, interestAccount, salesAccount];

const small: LoanScheduleInput = {
  principalCents: 120_000,
  annualRate: 0.12,
  termMonths: 3,
  startDate: '2026-01-31',
  firstPaymentDate: '2026-02-28',
};

function scheduleOf(input = small): LoanSchedule {
  const result = buildLoanSchedule(input);
  assert.equal(result.ok, true, result.ok ? '' : result.problem);
  return result.ok ? result.schedule : (null as unknown as LoanSchedule);
}

describe('loan schedule', () => {
  test('each payment splits into interest and principal exactly to the cent', () => {
    const schedule = scheduleOf();
    assert.equal(schedule.paymentCents, 40_803, 'the level payment is the annuity payment rounded up');
    assert.deepEqual(schedule.installments, [
      { number: 1, dueDate: '2026-02-28', paymentCents: 40_803, interestCents: 1_200, principalCents: 39_603, balanceCents: 80_397 },
      { number: 2, dueDate: '2026-03-28', paymentCents: 40_803, interestCents: 804, principalCents: 39_999, balanceCents: 40_398 },
      // The last payment takes the remainder: 40,802, not the level 40,803.
      { number: 3, dueDate: '2026-04-28', paymentCents: 40_802, interestCents: 404, principalCents: 40_398, balanceCents: 0 },
    ]);
    assert.equal(schedule.totalInterestCents, 2_408);
    assert.equal(schedule.totalPaymentsCents, 122_408);
  });

  test('a longer loan closes at exactly zero too, and every row adds up', () => {
    const schedule = scheduleOf({ principalCents: 1_000_000, annualRate: 0.06, termMonths: 12, startDate: '2026-03-01', firstPaymentDate: '2026-04-01' });
    assert.equal(schedule.paymentCents, 86_067);
    assert.equal(schedule.installments.length, 12);
    assert.deepEqual(schedule.installments[0], { number: 1, dueDate: '2026-04-01', paymentCents: 86_067, interestCents: 5_000, principalCents: 81_067, balanceCents: 918_933 });
    assert.deepEqual(schedule.installments[7], { number: 8, dueDate: '2026-11-01', paymentCents: 86_067, interestCents: 2_120, principalCents: 83_947, balanceCents: 340_000 });
    assert.deepEqual(schedule.installments[11], { number: 12, dueDate: '2027-03-01', paymentCents: 86_059, interestCents: 428, principalCents: 85_631, balanceCents: 0 });
    assert.equal(schedule.installments.reduce((sum, i) => sum + i.principalCents, 0), 1_000_000, 'the principal parts repay the principal exactly');
    assert.equal(schedule.totalInterestCents, 32_796);
    assert.equal(schedule.totalPaymentsCents, 1_032_796);
    for (const installment of schedule.installments) {
      assert.equal(installment.paymentCents, installment.interestCents + installment.principalCents);
      assert.ok(Number.isInteger(installment.interestCents) && Number.isInteger(installment.principalCents));
      assert.ok(installment.balanceCents >= 0);
    }
  });

  test('a zero-rate loan is the principal split evenly, with the remainder last', () => {
    const schedule = scheduleOf({ principalCents: 100_000, annualRate: 0, termMonths: 3, startDate: '2026-01-01', firstPaymentDate: '2026-02-01' });
    assert.equal(schedule.paymentCents, 33_334);
    assert.deepEqual(schedule.installments.map(i => [i.paymentCents, i.interestCents, i.principalCents]), [
      [33_334, 0, 33_334], [33_334, 0, 33_334], [33_332, 0, 33_332],
    ]);
  });

  test('the first payment defaults to a month later and a month end stays a month end', () => {
    const defaulted = scheduleOf({ ...small, firstPaymentDate: undefined });
    assert.equal(defaulted.installments[0].dueDate, '2026-02-28', '31 January + 1 month is 28 February');
    const monthEnd = scheduleOf({ principalCents: 100_000, annualRate: 0, termMonths: 3, startDate: '2026-01-01', firstPaymentDate: '2026-01-31' });
    assert.deepEqual(monthEnd.installments.map(i => i.dueDate), ['2026-01-31', '2026-02-28', '2026-03-31']);
  });

  test('what is not a loan is refused with the reason', () => {
    const refused = (input: Parameters<typeof buildLoanSchedule>[0]) => {
      const result = buildLoanSchedule(input);
      assert.equal(result.ok, false);
      return result.ok ? '' : result.problem;
    };
    assert.match(refused({ ...small, principalCents: 0 }), /principal must be a positive/);
    assert.match(refused({ ...small, termMonths: 0 }), /term must be between/);
    assert.match(refused({ ...small, termMonths: 700 }), /term must be between/);
    assert.match(refused({ ...small, annualRate: 1.5 }), /rate must be between/);
    assert.match(refused({ ...small, annualRate: -0.01 }), /rate must be between/);
    assert.match(refused({ ...small, firstPaymentDate: '2026-01-01' }), /first payment must be after/);
    assert.match(refused({ ...small, startDate: 'yesterday' }), /real start date/);
  });

  test('helpers count from the start: the next payment, what is left and the interest paid', () => {
    const schedule = scheduleOf();
    assert.equal(scheduleBalanceCents(schedule, []), 120_000);
    assert.equal(scheduleBalanceCents(schedule, [{ installment: 1 }]), 80_397);
    assert.equal(scheduleBalanceCents(schedule, [{ installment: 1 }, { installment: 2 }]), 40_398);
    assert.equal(scheduleBalanceCents(schedule, [{ installment: 1 }, { installment: 2 }, { installment: 3 }]), 0);
    assert.equal(scheduleBalanceCents(schedule, [{ installment: 2 }]), 120_000, 'out of order does not move the balance');
    assert.equal(scheduleInterestPaidCents(schedule, [{ installment: 1 }, { installment: 2 }]), 2_004);
    assert.equal(nextInstallment(schedule, [{ installment: 1 }])?.number, 2);
    assert.equal(nextInstallment(schedule, [{ installment: 1 }, { installment: 2 }, { installment: 3 }]), null);
    assert.equal(interestForMonthCents(80_397, 0.12), 804, '80,397 × 1% = 803.97, half up');
    assert.equal(levelPaymentCents(120_000, 0.12, 3), 40_803);
  });
});

describe('loan record and entries', () => {
  const draft = {
    lender: 'Northwind Bank',
    principalCents: 120_000,
    annualRate: 0.12,
    termMonths: 3,
    startDate: '2026-01-31',
    firstPaymentDate: '2026-02-28',
    liabilityAccountId: 'loan',
    interestAccountId: 'interest',
    bankAccountId: 'bank',
  };

  const loan: Loan = {
    id: 'loan-1',
    uid: 'test-user',
    workspaceId: 'ws-1',
    lender: 'Northwind Bank',
    principalCents: 120_000,
    annualRate: 0.12,
    termMonths: 3,
    startDate: '2026-01-31',
    firstPaymentDate: '2026-02-28',
    liabilityAccountId: 'loan',
    interestAccountId: 'interest',
    bankAccountId: 'bank',
    currency: 'USD',
    reference: newLoanReference('loan-1'),
  };

  test('the pickers offer the workspace’s own accounts, never a new one', () => {
    assert.deepEqual(loanLiabilityChoices(accounts).map(a => a.id), ['loan']);
    assert.deepEqual(loanInterestChoices(accounts).map(a => a.id), ['interest']);
    assert.deepEqual(loanBankChoices(accounts).map(a => a.id), ['bank']);
    assert.equal(loanLiabilityChoices([]).length, 0, 'a workspace with no liability account offers none');
  });

  test('a loan is refused in plain words when something is missing or wrong', () => {
    assert.equal(loanProblem(draft, accounts), null);
    assert.match(loanProblem({ ...draft, lender: '  ' }, accounts) || '', /Name the lender/);
    assert.match(loanProblem({ ...draft, principalCents: 0 }, accounts) || '', /positive amount/);
    assert.match(loanProblem({ ...draft, annualRate: 1.2 }, accounts) || '', /100% a year or less/);
    assert.match(loanProblem({ ...draft, firstPaymentDate: '2026-01-01' }, accounts) || '', /after the money arrived/);
    assert.match(loanProblem({ ...draft, liabilityAccountId: '' }, accounts) || '', /Choose the liability account/);
    assert.match(loanProblem({ ...draft, liabilityAccountId: 'sales' }, accounts) || '', /is not a liability account/);
    assert.match(loanProblem({ ...draft, interestAccountId: 'loan' }, accounts) || '', /is not an expense account/);
    assert.match(loanProblem({ ...draft, bankAccountId: 'sales' }, accounts) || '', /is not a bank or cash account/);
  });

  test('recording the money arriving: debit the bank, credit the liability, one balanced entry', () => {
    const entry = createLoanDisbursementEntry({ loan, bank, liability: loanAccount });
    assert.equal(entry.totalAmountCents, 120_000);
    // LN-01: the loan- prefix is stripped and the reference keeps full entropy
    assert.equal(entry.reference, 'LOAN-1');
    assert.equal(entry.metadata?.loanId, loan.id);
    assert.equal(entry.date, '2026-01-31');
    assert.equal(entry.description, 'Loan from Northwind Bank');
    assert.deepEqual(entry.lines?.map(l => [l.accountId, l.amountCents]), [['bank', 120_000], ['loan', -120_000]]);
    assert.equal(entry.lines?.reduce((sum, l) => sum + l.amountCents, 0), 0);
    assert.equal(entry.lines?.find(l => l.accountId === 'bank')?.description, undefined, 'the categoriser must not learn the bank');
    assert.equal(entry.lines?.find(l => l.accountId === 'loan')?.description, 'Loan from Northwind Bank');
  });

  test('a payment is one balanced entry: principal, interest and the money leaving the bank', () => {
    const schedule = scheduleOf();
    const entry = createLoanPaymentEntry({ loan, installment: schedule.installments[0], date: '2026-02-28', bank, liability: loanAccount, interest: interestAccount });
    assert.equal(entry.totalAmountCents, 40_803);
    assert.equal(entry.description, 'Loan payment 1/3 — Northwind Bank');
    assert.deepEqual(entry.lines?.map(l => [l.accountId, l.amountCents]), [['loan', 39_603], ['interest', 1_200], ['bank', -40_803]]);
    assert.equal(entry.lines?.reduce((sum, l) => sum + l.amountCents, 0), 0);
    const final = createLoanPaymentEntry({ loan, installment: schedule.installments[2], date: '2026-04-28', bank, liability: loanAccount, interest: interestAccount });
    assert.deepEqual(final.lines?.map(l => [l.accountId, l.amountCents]), [['loan', 40_398], ['interest', 404], ['bank', -40_802]]);
  });

  test('the ledger read-back matches the schedule after the same payments', () => {
    const schedule = scheduleOf();
    const asTransaction = (id: string, entry: Partial<Transaction>, status: Transaction['status'] = 'completed'): Transaction =>
      makeTransaction({ ...entry, id, workspaceId: 'ws-1', status } as Partial<Transaction>);
    const posted: Transaction[] = [
      asTransaction('t-open', createLoanDisbursementEntry({ loan, bank, liability: loanAccount })),
      asTransaction('t-1', createLoanPaymentEntry({ loan, installment: schedule.installments[0], date: '2026-02-28', bank, liability: loanAccount, interest: interestAccount })),
      asTransaction('t-2', createLoanPaymentEntry({ loan, installment: schedule.installments[1], date: '2026-03-28', bank, liability: loanAccount, interest: interestAccount })),
    ];
    assert.equal(loanLedgerCents(loan, posted), 40_398);
    assert.equal(loanLedgerCents(loan, posted), scheduleBalanceCents(schedule, [{ installment: 1 }, { installment: 2 }]));
    // A draft is not in the books, and another loan's entries are none of this loan's business.
    const withDraft = [...posted, asTransaction('t-3', createLoanPaymentEntry({ loan, installment: schedule.installments[2], date: '2026-04-28', bank, liability: loanAccount, interest: interestAccount }), 'draft')];
    assert.equal(loanLedgerCents(loan, withDraft), 40_398);
    // LN-01: a different loan has a different id; its entries (even with a colliding reference) are none of this loan's business
    const otherLoan = { ...loan, id: 'loan-other', reference: loan.reference };
    assert.equal(loanLedgerCents(otherLoan, posted), 0);
    // After the last payment the ledger says nothing is owed and the schedule agrees.
    const settled = [...posted, asTransaction('t-3', createLoanPaymentEntry({ loan, installment: schedule.installments[2], date: '2026-04-28', bank, liability: loanAccount, interest: interestAccount }))];
    assert.equal(loanLedgerCents(loan, settled), 0);
    assert.equal(scheduleBalanceCents(schedule, [{ installment: 1 }, { installment: 2 }, { installment: 3 }]), 0);
  });

  test('a payment posted but not yet noted on the loan still counts: it is never offered twice', () => {
    const schedule = scheduleOf();
    const entry = (id: string, n: number, status: Transaction['status'] = 'completed') => makeTransaction({
      ...createLoanPaymentEntry({ loan, installment: schedule.installments[n - 1], date: '2026-02-28', bank, liability: loanAccount, interest: interestAccount }),
      id, workspaceId: 'ws-1', status,
    } as Partial<Transaction>);
    assert.deepEqual(entry('t-1', 1).metadata, { loanInstallment: 1, loanId: loan.id });
    // payment 1 noted on the loan; payment 2 posted, but noting it on the loan failed
    const noted = { ...loan, payments: [{ installment: 1, date: '2026-02-28' }] };
    const ledger = [entry('t-1', 1), entry('t-2', 2), entry('t-3', 3, 'draft'), { ...entry('t-x', 3), metadata: { loanInstallment: 3, loanId: 'loan-other' } }];
    const recorded = recordedInstallments(noted, ledger);
    assert.deepEqual(recorded.map(r => r.installment), [1, 2], 'a draft and another loan\'s entry do not count');
    assert.equal(nextInstallment(schedule, recorded)?.number, 3);
    assert.equal(scheduleBalanceCents(schedule, recorded), schedule.installments[1].balanceCents);
  });

  test('the reference and the rate read the way a person writes them', () => {
    // LN-01: the whole id is used, not an 8-character slice
    assert.equal(newLoanReference('abc-def-1234'), 'LOAN-ABCDEF1234');
    assert.equal(newLoanReference('loan-abcd1111-1111-4111-8111-111111111111'), 'LOAN-ABCD1111111141118111111111111111');
    assert.equal(formatLoanRate(0.065), '6.5% a year');
    assert.equal(formatLoanRate(0.06), '6% a year');
    assert.equal(formatLoanRate(0.0525), '5.25% a year');
  });
});

const url = process.env.LF_TEST_DATABASE_URL;

/**
 * The posting half of A-2 against a real database: the two entries a loan posts go through the
 * ordinary route (so role and period-lock checks apply), and what the ledger says is owed can be
 * read back and compared with the schedule. Runs when LF_TEST_DATABASE_URL is set.
 */
describe('Recording a loan against a real database', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const wsId = `ws_loans_${crypto.randomBytes(4).toString('hex')}`;
  const loanId = `${wsId}_loan`;
  const loan: Loan = {
    id: loanId, uid: 'owner-1', workspaceId: wsId, lender: 'Northwind Bank',
    principalCents: 120_000, annualRate: 0.12, termMonths: 3,
    startDate: '2026-01-31', firstPaymentDate: '2026-02-28',
    liabilityAccountId: `${wsId}_loanacct`, interestAccountId: `${wsId}_interest`, bankAccountId: `${wsId}_bank`,
    currency: 'USD', reference: newLoanReference(loanId), payments: [],
  };
  // the accounts as this workspace holds them (the entries must name its own accounts)
  const dbBank = { ...bank, id: `${wsId}_bank` };
  const dbLoan = { ...loanAccount, id: `${wsId}_loanacct` };
  const dbInterest = { ...interestAccount, id: `${wsId}_interest` };
  const schedule = scheduleOf({ principalCents: loan.principalCents, annualRate: loan.annualRate, termMonths: loan.termMonths, startDate: loan.startDate, firstPaymentDate: loan.firstPaymentDate });
  let server: Server;
  let base = '';
  let db: Firestore;

  const post = async (uid: string, transaction: Partial<Transaction>) => {
    const res = await fetch(`${base}/api/v1/transactions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-uid': uid, 'x-operation-id': String(transaction.id || '') },
      body: JSON.stringify({ transaction: { ...transaction, id: transaction.id || `tx_${crypto.randomBytes(4).toString('hex')}` } }),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) as Record<string, unknown> };
  };
  const ledger = async (): Promise<Transaction[]> => (await db.collection('transactions').where('workspaceId', '==', wsId).get()).docs.map(d => d.data() as unknown as Transaction);

  before(async () => {
    process.env.DATABASE_URL = url;
    const express = (await import('express')).default;
    const { transactionRouter } = await import('../server/routes/transactionRoutes');
    const { getDb } = await import('../server/db/firestore');
    db = getDb();
    await db.collection('workspaces').doc(wsId).set({
      uid: 'owner-1', name: 'Loans', currency: 'USD', members: ['owner-1', 'book-1', 'view-1'],
      roles: { 'book-1': 'bookkeeper', 'view-1': 'viewer' },
    });
    await db.collection('chartAccounts').doc(`${wsId}_bank`).set({ workspaceId: wsId, code: '1010', name: 'Business Checking', type: 'asset', category: 'Cash' });
    await db.collection('chartAccounts').doc(`${wsId}_loanacct`).set({ workspaceId: wsId, code: '2500', name: 'Bank loans', type: 'liability', category: 'Long-term Liabilities' });
    await db.collection('chartAccounts').doc(`${wsId}_interest`).set({ workspaceId: wsId, code: '6100', name: 'Interest expense', type: 'expense', category: 'Operating Expenses' });
    // The loans table itself (migration 20261009000000_loans.sql): a writer's row has to be there.
    await db.collection('loans').doc(loanId).set(loan as unknown as Record<string, unknown>);
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as unknown as { user: { uid: string; email: string } }).user = { uid: String(req.header('x-test-uid')), email: `${req.header('x-test-uid')}@test.local` }; next(); });
    app.use('/api/v1/transactions', transactionRouter);
    app.use('/api/v1/documents', (await import('../server/routes/documentPostRoutes')).documentPostRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server?.close();
    for (const table of ['transactions', 'chartAccounts', 'loans', 'idempotencyKeys', 'workspaces']) {
      await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [wsId]);
    }
    await db.terminate();
  });

  test('the money arriving is one balanced entry and the ledger reads the principal back', async () => {
    assert.equal((await post('view-1', createLoanDisbursementEntry({ loan, bank: dbBank, liability: dbLoan }))).status, 403, 'a viewer cannot post');
    const res = await post('book-1', createLoanDisbursementEntry({ loan, bank: dbBank, liability: dbLoan }));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const posted = await ledger();
    assert.equal(posted.length, 1);
    assert.equal(loanLedgerCents(loan, posted), 120_000);
    assert.equal(loanLedgerCents(loan, posted), scheduleBalanceCents(schedule, []));
  });

  test('a payment is split to the cent and the ledger balance follows the schedule', async () => {
    const first = schedule.installments[0];
    const res = await post('owner-1', createLoanPaymentEntry({ loan, installment: first, date: first.dueDate, bank: dbBank, liability: dbLoan, interest: dbInterest }));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const posted = await ledger();
    const payment = posted.find(t => t.description === `Loan payment 1/3 — Northwind Bank`);
    assert.ok(payment, 'the payment entry is in the ledger');
    const byAccount = (id: string) => (payment!.lines || []).filter(l => l.accountId === id).reduce((sum, l) => sum + lineAmount(l, payment!), 0);
    assert.equal(byAccount(loan.liabilityAccountId), 39_603, 'the principal part comes off the loan');
    assert.equal(byAccount(loan.interestAccountId), 1_200, 'the interest part goes to the expense');
    assert.equal(byAccount(loan.bankAccountId), -40_803, 'the bank pays the whole payment');
    assert.equal(payment!.lines.reduce((sum, l) => sum + lineAmount(l, payment!), 0), 0, 'balanced');
    assert.equal(loanLedgerCents(loan, posted), 80_397);
    assert.equal(loanLedgerCents(loan, posted), scheduleBalanceCents(schedule, [{ installment: 1 }]));
  });

  test('a closed month refuses the entry, so a payment cannot be back-dated into it', async () => {
    await db.collection('workspaces').doc(wsId).update({ lockDate: '2026-02-28' });
    const refused = await post('book-1', createLoanPaymentEntry({ loan, installment: schedule.installments[1], date: '2026-02-28', bank: dbBank, liability: dbLoan, interest: dbInterest }));
    assert.equal(refused.status, 400, JSON.stringify(refused.body));
    assert.equal(refused.body.code, 'PERIOD_LOCKED', 'the period lock is what refused it');
    await db.collection('workspaces').doc(wsId).update({ lockDate: null });
    const allowed = await post('book-1', createLoanPaymentEntry({ loan, installment: schedule.installments[1], date: '2026-03-28', bank: dbBank, liability: dbLoan, interest: dbInterest }));
    assert.equal(allowed.status, 200, JSON.stringify(allowed.body));
    assert.equal(loanLedgerCents(loan, await ledger()), 40_398);
  });
});
