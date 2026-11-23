/**
 * Audit BR-01 and BR-03 (P1), wizard side:
 *
 * BR-01 — a search that hides a selected entry must not change the difference the wizard adds up.
 * The audit's scenario: no beginning balance, one $100 deposit, statement ending balance $0. Select
 * the deposit, then search so it is hidden. The difference must stay $100 and finishing must be
 * refused — the search only hides rows, it never changes the cleared total.
 *
 * BR-03 — a first reconciliation must start from the recorded opening balance, not the current balance
 * that already contains the entries to be selected. The audit's scenario: a genuine $0 opening
 * balance and one posted $100 receipt on the statement. The wizard must use $0 as the beginning
 * balance, so a $100 statement with no selection has a $100 difference and cannot be finished.
 */
import './helpers/dom';
import test, { afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ReconciliationWizard, { type ReconciliationResult } from '../components/ledger/ReconciliationWizard';
import { useLedgerStore } from '../stores/useLedgerStore';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';
import { makeChartAccount, makeTransaction } from './fixtures';
import { stubFetchWithBodies } from './helpers/dom';

afterEach(() => { cleanup(); });

describe('audit BR-01/BR-03: the reconciliation wizard adds up every selected entry', () => {
  test('BR-01: searching away a selected deposit keeps its $100 in the difference and refuses to finish', async () => {
    stubFetchWithBodies(200, {});
    setComponentWorkspace('owner');
    markComponentCollectionsLoaded('transactions', 'accounts', 'reconciliations');
    const bank = makeChartAccount({ id: 'bank', name: 'Checking', type: 'asset', category: 'Cash', openingBalanceCents: 0, balanceCents: 0 });
    const sale = makeTransaction({ id: 'receipt100', date: '2026-05-01', description: 'Customer receipt', totalAmountCents: 10000, status: 'completed', lines: [{ id: 'l1', accountId: 'bank', amountCents: 10000 }, { id: 'l2', accountId: 'sales', amountCents: -10000 }] });
    useLedgerStore.setState({ accounts: [bank], transactions: [sale], reconciliations: [] });
    let result: ReconciliationResult | undefined;
    try {
      render(<ReconciliationWizard isOpen onClose={() => {}} accounts={[bank]} onComplete={r => { result = r; }} formatCurrency={n => `$${(n / 100).toFixed(2)}`} />);
      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Checking' } });
      fireEvent.change(screen.getByLabelText('Statement date'), { target: { value: '2026-05-31' } });
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      const receipt = await screen.findByRole('button', { name: /Customer receipt/ });
      fireEvent.click(receipt);
      fireEvent.change(screen.getByRole('textbox', { name: 'Search ledger transactions' }), { target: { value: 'not a match' } });
      assert.equal(screen.queryByRole('button', { name: /Customer receipt/ }), null, 'the search hides the row');
      fireEvent.click(screen.getByRole('button', { name: 'Finish reconciliation' }));
      // the difference is still $100 (statement $0 − beginning $0 − cleared $100), so finishing is refused
      await waitFor(() => assert.equal(result, undefined, 'a hidden selection must not make the difference zero'));
    } finally { cleanup(); }
  });

  test('BR-03: a first reconciliation starts from the recorded $0 opening balance, not the current balance', async () => {
    stubFetchWithBodies(200, {});
    setComponentWorkspace('owner');
    markComponentCollectionsLoaded('transactions', 'accounts', 'reconciliations');
    // Ledger supplies a computed account: 0 opening plus one 100.00 posted receipt = 100.00 current.
    const bank = makeChartAccount({ id: 'bank', name: 'Checking', type: 'asset', category: 'Cash', openingBalanceCents: 0, balanceCents: 10000 });
    const sale = makeTransaction({ id: 'receipt100', date: '2026-05-01', description: 'Customer receipt', totalAmountCents: 10000, status: 'completed', lines: [{ id: 'l1', accountId: 'bank', amountCents: 10000 }, { id: 'l2', accountId: 'sales', amountCents: -10000 }] });
    useLedgerStore.setState({ accounts: [bank], transactions: [sale], reconciliations: [] });
    let result: ReconciliationResult | undefined;
    try {
      render(<ReconciliationWizard isOpen onClose={() => {}} accounts={[bank]} onComplete={r => { result = r; }} formatCurrency={n => `$${(n / 100).toFixed(2)}`} />);
      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Checking' } });
      fireEvent.change(screen.getByLabelText('Statement date'), { target: { value: '2026-05-31' } });
      fireEvent.change(screen.getByLabelText('Statement ending balance ($)'), { target: { value: '100' } });
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      const receipt = await screen.findByRole('button', { name: /Customer receipt/ });
      assert.equal(receipt.getAttribute('aria-pressed'), 'false');
      // the beginning balance is the recorded $0, so a $100 statement with no selection differs by $100
      fireEvent.click(screen.getByRole('button', { name: 'Finish reconciliation' }));
      await waitFor(() => assert.equal(result, undefined, 'the $100 receipt on the statement is not cleared for free'));
    } finally { cleanup(); }
  });
});
