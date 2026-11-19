/**
 * #873: the journal's URL identifies a record. Following a link to a second entry while the first
 * entry's editor is open must show the second entry's draft, not the first one's leftover form state.
 * The regression renders the real grid view and the real edit modal; only the grid's bulky model is
 * stubbed, so the assertion covers the call site that owns the React key.
 */
import './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TransactionGridView } from '../components/ledger/TransactionGridView';
import type { TransactionGridModel } from '../components/ledger/TransactionGrid';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { stubFetch } from './helpers/dom';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { makeChartAccount, makeTransaction } from './fixtures';
import type { ChartAccount, Transaction, TransactionLine } from '../types';

const bank = makeChartAccount({ id: 'bank', name: 'Checking', code: '1000', type: 'asset', category: 'Cash' }) as ChartAccount;
const expense = makeChartAccount({ id: 'rent', name: 'Rent', code: '6400', type: 'expense', category: 'COGS' }) as ChartAccount;
const accounts = [bank, expense];

function entry(id: string, description: string, total: number): Transaction {
  const lines: TransactionLine[] = [
    { accountId: expense.id, accountName: expense.name, amountCents: total },
    { accountId: bank.id, accountName: bank.name, amountCents: -total },
  ];
  return makeTransaction({ id, description, totalAmountCents: total, lines });
}

const first = entry('tx_demo_1_guest', 'Acme Enterprise Software Renewal', 120000);
const second = entry('tx_demo_2_guest', 'AWS September Hosting Fee', 45000);
const descriptionPlaceholder = 'e.g. AWS Production Virtual Servers';

/**
 * The grid model is a large bag of view state. Only the fields the modal/route path needs are real;
 * everything else is a stable no-op so the toolbar and body can render without a database.
 */
function modelFor(editingDetailsTx: Transaction | null): TransactionGridModel {
  const concrete: Record<string, unknown> = {
    editingDetailsTx,
    txActions: { handleReverseTransaction: async () => {} },
    accounts,
    projects: [],
    lockDate: null,
    isReverseModeModal: false,
    focusedTxId: null,
    focusedTxMissing: false,
    transactionHealth: {},
    transactionListCapped: false,
    selectedIds: new Set<string>(),
    selectedTransactions: [],
    parsingQueue: [],
    splittingTxId: null,
    splittingTransaction: null,
    transactionsWithBalance: [first, second],
    viewMode: 'pivot',
    pivotData: [],
    searchTerm: '',
    filterCriteria: {},
    columnSearchTerms: {},
    columnFilterValues: {},
    hiddenColumns: new Set<string>(),
    show: {},
    stats: { count: 2, inflowCents: 0, outflowCents: 165000, discrepancies: 0 },
    totalBalancedSum: 0,
    selectedMetricsResult: null,
    sortConfig: null,
    navigationFields: [],
    focusedCell: null,
    editingCell: null,
    itemData: {},
    itemKey: () => '',
    isCompactMode: false,
    isMobileGrid: false,
    isTabletGrid: false,
    dragActive: false,
    formId: 'test-grid',
  };
  return new Proxy(concrete, {
    get(target, key) {
      if (key in target) return target[key as string];
      return () => {};
    },
  }) as unknown as TransactionGridModel;
}

function descriptionInput(): HTMLInputElement {
  return screen.getByPlaceholderText<HTMLInputElement>(descriptionPlaceholder);
}

describe('Following a journal record link', () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    stubFetch(200, { links: [], questions: [] });
    const ws = setComponentWorkspace('owner');
    useAuthStore.setState({ workspaces: [{ ...ws, currency: 'USD' }] });
    useLedgerStore.setState({
      accounts,
      baseCurrency: 'USD',
      transactions: [first, second],
      dimensionNodes: [],
      classes: [],
      locations: [],
      projects: [],
      lockException: null,
    });
  });
  afterEach(() => {
    cleanup();
    globalThis.fetch = realFetch;
  });

  test('a different record reloads the draft; a re-render of the same record keeps edits', () => {
    const { rerender } = render(<TransactionGridView {...modelFor(first)} />);
    assert.equal(descriptionInput().value, first.description, 'entry 1 opens on its own draft');

    fireEvent.change(descriptionInput(), { target: { value: 'Unsaved note on entry 1' } });
    rerender(<TransactionGridView {...modelFor(first)} />);
    assert.equal(descriptionInput().value, 'Unsaved note on entry 1', 'an ordinary re-render must not throw away a draft');

    rerender(<TransactionGridView {...modelFor(second)} />);
    assert.equal(descriptionInput().value, second.description, 'entry 2 must show its own description, not entry 1\'s draft');

    rerender(<TransactionGridView {...modelFor(first)} />);
    assert.equal(descriptionInput().value, first.description, 'returning to entry 1 must load its saved description again');
  });
});
