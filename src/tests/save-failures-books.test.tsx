/**
 * Failure tests for the money saves on the purchases and books side (PREV-5): a bill (new and
 * edited) on the Purchases screen, a journal entry in its dialog, and a bank statement import
 * through the review dialog and the import action the app wires to it, each with the server
 * refusing, failing, unreachable, or slow while the user opens another workspace. The cases
 * themselves are in helpers/failureHarness.ts.
 */
import { describeSaveFailures, standardChart, WORKSPACE_A } from './helpers/failureHarness';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import '../services/ledgerPost/postingKit';
import Purchases from '../components/purchases/Purchases';
import JournalEntryModal from '../components/ledger/JournalEntryModal';
import StatementImporter from '../components/ledger/StatementImporter';
import { useTransactionActions } from '../hooks/useTransactionActions';
import { useLedgerStore } from '../stores/useLedgerStore';
import { makeBill, makeChartAccount, makeVendor } from './fixtures';

const ws = { workspaceId: WORKSPACE_A };
const value = (label: string | RegExp) => (screen.getByLabelText(label) as HTMLInputElement).value;
const type = (label: string | RegExp, text: string) => fireEvent.change(screen.getByLabelText(label), { target: { value: text } });

function seedA() {
  useLedgerStore.setState({
    accounts: standardChart(),
    vendors: [makeVendor({ ...ws, id: 'v1', name: 'Paper Co' })],
    bills: [makeBill({
      ...ws, id: 'a-bill', number: 'A-1', vendorId: 'v1', vendorName: 'Paper Co', status: 'pending', amountCents: 4000, date: '2026-10-01', dueDate: '2026-10-31',
      splits: [{ accountId: 'office', amountCents: 4000, description: 'Paper' }],
    } as never)],
    transactions: [],
    invoices: [],
    payments: [],
  });
}

// Keep one directly registered test in this module: the failure cases below are registered through
// the shared harness, while this checks the chart roles those bill, journal, and import cases need.
test('books failure fixtures include every posting account role', () => {
  assert.deepEqual(new Set(standardChart().map(account => account.id)), new Set(['cash', 'ar', 'ap', 'sales', 'office']));
});

const DRAFT_TEXT = 'Printer paper, 40 boxes';
const billCollections = ['bills', 'vendors', 'recurring'] as const;

describeSaveFailures({
  name: 'bill create (Purchases screen)',
  collections: [...billCollections],
  async open() {
    seedA();
    render(<Purchases />);
    fireEvent.click(await screen.findByText('Record Bill'));
    type('Vendor', 'v1');
    type('Description', DRAFT_TEXT);
    type('Expense Account', 'office');
    type(/^Amount \(/, '120');
  },
  save: () => act(async () => { fireEvent.click(screen.getByText('Save & Close')); }),
  draftKept() {
    assert.ok(screen.getByText('Save & Close'), 'the bill dialog stays open');
    assert.equal(value('Vendor'), 'v1');
    assert.equal(value('Description'), DRAFT_TEXT);
    assert.equal(value(/^Amount \(/), '120');
  },
});

describeSaveFailures({
  name: 'bill update (Purchases screen)',
  collections: [...billCollections],
  async open() {
    seedA();
    render(<Purchases />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit bill A-1' }));
    type('Description', DRAFT_TEXT);
    type(/^Amount \(/, '55');
  },
  save: () => act(async () => { fireEvent.click(screen.getByText('Save & Close')); }),
  draftKept() {
    assert.ok(screen.getByText('Save & Close'), 'the bill dialog stays open');
    assert.equal(value('Description'), DRAFT_TEXT);
    assert.equal(value(/^Amount \(/), '55');
    assert.equal(useLedgerStore.getState().bills.find(b => b.id === 'a-bill')?.amountCents, 4000, 'the saved bill is as it was');
  },
});

let journalClosed = 0;
describeSaveFailures({
  name: 'journal entry (journal entry dialog)',
  open() {
    seedA();
    journalClosed = 0;
    const accounts = useLedgerStore.getState().accounts;
    render(<JournalEntryModal isOpen onClose={() => { journalClosed++; }} user={{ uid: 'test-user' } as never} accounts={accounts} workspaceId={WORKSPACE_A} />);
    type('Account for line 1', 'office');
    type('Debit amount for line 1', '100');
    type('Account for line 2', 'cash');
    type('Credit amount for line 2', '100');
  },
  save: () => act(async () => { fireEvent.click(screen.getByRole('button', { name: /COMMIT TO LEDGER/ })); }),
  draftKept() {
    assert.equal(journalClosed, 0, 'the dialog stays open');
    assert.match(value('Account for line 1'), /Office supplies/);
    assert.equal(value('Debit amount for line 1'), '100');
    assert.match(value('Account for line 2'), /Checking/);
    assert.equal(value('Credit amount for line 2'), '100');
  },
});

// the import as the app wires it (CommandPortal): the review dialog and the import action
let importerClosed = 0;
function ImportScreen() {
  const { handleImportTransactions } = useTransactionActions();
  const transactions = useLedgerStore(s => s.transactions);
  const accounts = useLedgerStore(s => s.accounts);
  return <StatementImporter isOpen onClose={() => { importerClosed++; }} onImport={rows => handleImportTransactions(rows as never)} existingTransactions={transactions} businessContext="" accounts={accounts} patternCache={{}} />;
}
// a card payment is booked to the card account on its own, so the import writes ledger entries too
const STATEMENT = ['!Type:Bank', 'D02/10/2026', 'T-250.00', 'PPayment to credit card', '^', 'D03/10/2026', 'T-80.00', 'PPayment thank you card', '^'].join('\n');

describeSaveFailures({
  name: 'bank statement import (review dialog)',
  async open() {
    seedA();
    importerClosed = 0;
    useLedgerStore.setState({ accounts: [...standardChart(), makeChartAccount({ ...ws, id: 'card', code: '2100', name: 'Company card', type: 'liability', category: 'Credit Card', subtype: 'Credit Card' })] });
    render(<ImportScreen />);
    fireEvent.change(screen.getByLabelText('QIF date order'), { target: { value: 'dmy' } });
    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    await act(async () => { fireEvent.change(input, { target: { files: [{ name: 'checking.qif', type: 'text/plain', text: async () => STATEMENT }] } }); });
    await screen.findByText('Payment to credit card');
    for (const row of screen.getAllByRole('button', { name: /^Select .+ on / })) if (row.getAttribute('aria-pressed') !== 'true') fireEvent.click(row);
  },
  save: () => act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Import 2 Entries' })); }),
  draftKept() {
    assert.equal(importerClosed, 0, 'the review stays open');
    assert.ok(screen.getByRole('button', { name: 'Import 2 Entries' }), 'with the same selection');
    assert.ok(screen.getByText('Payment thank you card'));
  },
});
