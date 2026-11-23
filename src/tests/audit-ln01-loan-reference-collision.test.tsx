// LN-01 acceptance: loan entries match their loan by the immutable metadata.loanId (the reference is
// only a fallback for entries that carry no loanId), and new references keep full entropy.
import '../../src/tests/helpers/dom';
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import LoansView from '../../src/components/finance/LoansView';
import { useLedgerStore } from '../../src/stores/useLedgerStore';
import { newLoanReference, recordedInstallments, loanLedgerCents, createLoanDisbursementEntry, createLoanPaymentEntry } from '../../src/lib/loans';
import { makeChartAccount, makeTransaction } from '../../src/tests/fixtures';
import { markComponentCollectionsLoaded, setComponentWorkspace } from '../../src/tests/helpers/componentFixtures';
import { stubFetch } from '../../src/tests/helpers/dom';
import { getSupabase } from '../../src/lib/db/client';

test('entries match their loan by loanId, not by a colliding reference', async () => {
  const id1 = 'loan-abcd1111-1111-4111-8111-111111111111';
  const id2 = 'loan-abcd2222-2222-4222-8222-222222222222';

  // LN-01: references no longer truncate to 4 hex digits — the loan- prefix is stripped and the
  // whole id is used, so two loans can never share a reference
  const ref1 = newLoanReference(id1);
  const ref2 = newLoanReference(id2);
  assert.notEqual(ref1, ref2, 'references of distinct loans differ');
  assert.ok(ref1.length > 12, `reference ${ref1} carries full entropy`);

  const loan = {
    id: id2, uid: 'test-user', workspaceId: 'component-workspace', lender: 'Second Lender',
    principalCents: 100000, annualRate: 0, termMonths: 2, startDate: '2026-01-01',
    firstPaymentDate: '2026-02-01', liabilityAccountId: 'loan', interestAccountId: 'interest',
    bankAccountId: 'bank', currency: 'USD', reference: ref1, payments: [],
  };
  // the first loan's payment entry: it carries loanId of loan 1, so it must not be attributed to loan 2
  const entry = makeTransaction({
    id: 'first-loan-payment', workspaceId: 'component-workspace', date: '2026-02-01', reference: ref1,
    totalAmountCents: 50000, metadata: { loanInstallment: 1, loanId: id1 },
    lines: [{ id: '1', accountId: 'loan', amountCents: 50000 }, { id: '2', accountId: 'bank', amountCents: -50000 }],
  });
  const accounts = [
    makeChartAccount({ id: 'bank', name: 'Checking', type: 'asset', category: 'Cash' }),
    makeChartAccount({ id: 'loan', name: 'Loans', type: 'liability' }),
    makeChartAccount({ id: 'interest', name: 'Interest', type: 'expense' }),
  ];
  try {
    setComponentWorkspace('owner');
    markComponentCollectionsLoaded('loans');
    useLedgerStore.setState({ accounts, loans: [loan], transactions: [entry] } as never);
    stubFetch(404, {});
    render(<LoansView />);
    // LN-01: loan 2 has no entries of its own — the colliding-reference entry belongs to loan 1
    assert.deepEqual(recordedInstallments(loan, [entry]), []);
    assert.equal(loanLedgerCents(loan, [entry]), 0);
    assert.equal(screen.queryByRole('button', { name: /In the books/ }), null);
    assert.ok(screen.getByText(/\$1,000\.00 still owed/));
    // the schedule is open for the first loan, so recording the money arriving is offered
    assert.ok(screen.getByRole('button', { name: /arriving/ }));
  } finally {
    cleanup();
    await getSupabase().auth.dispose();
  }
});

test('entries with no loanId still match by reference (backward compatible)', () => {
  const id1 = 'loan-abcd1111-1111-4111-8111-111111111111';
  const id2 = 'loan-abcd2222-2222-4222-8222-222222222222';
  const ref1 = newLoanReference(id1);
  const loan2 = {
    id: id2, reference: ref1, liabilityAccountId: 'loan', payments: [],
  };
  // an entry made before the fix (no loanId): it matches loan 2 by the shared reference
  const oldEntry = makeTransaction({
    id: 'old-payment', workspaceId: 'component-workspace', date: '2026-02-01', reference: ref1,
    totalAmountCents: 50000, metadata: { loanInstallment: 1 },
    lines: [{ id: '1', accountId: 'loan', amountCents: 50000 }, { id: '2', accountId: 'bank', amountCents: -50000 }],
  });
  assert.deepEqual(recordedInstallments(loan2 as never, [oldEntry]), [{ installment: 1 }]);
  assert.equal(loanLedgerCents(loan2 as never, [oldEntry]), -50000);
});

test('the entry builders stamp the loan id on the entries they create', () => {
  const loan = {
    id: 'loan-xyz', lender: 'Bank', principalCents: 100000, reference: 'LOAN-XYZ', currency: 'USD',
    workspaceId: 'w', uid: 'u', startDate: '2026-01-01', termMonths: 2, liabilityAccountId: 'loan',
  };
  const bank = makeChartAccount({ id: 'bank', name: 'Checking', type: 'asset', category: 'Cash' });
  const liability = makeChartAccount({ id: 'loan', name: 'Loans', type: 'liability' });
  const interest = makeChartAccount({ id: 'interest', name: 'Interest', type: 'expense' });
  const disbursement = createLoanDisbursementEntry({ loan, bank, liability });
  assert.equal(disbursement.metadata?.loanId, 'loan-xyz');
  const payment = createLoanPaymentEntry({
    loan, installment: { number: 1, dueDate: '2026-02-01', principalCents: 50000, interestCents: 0, paymentCents: 50000, balanceCents: 50000 },
    date: '2026-02-01', bank, liability, interest,
  });
  assert.equal(payment.metadata?.loanId, 'loan-xyz');
});
