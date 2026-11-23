/**
 * Audit BR-04 (P1): automatic one-to-one matching must use the correct account's signed cash leg,
 * not the journal's header total. The audit's worked case: a $100 bank deposit line and a same-day,
 * similarly described balanced entry — debit cash $20, debit A/R $80, credit sales $100. The entry's
 * header total is $100, but only $20 moved in this bank. Auto-match all must not match the line to
 * the entry: a single one-to-one match cannot explain the other $80.
 */
import './helpers/dom';
import test, { afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import Reconciliation from '../components/ledger/Reconciliation';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useUIStore } from '../stores/useUIStore';
import { makeChartAccount, makeTransaction } from './fixtures';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';
import { stubFetchWithBodies } from './helpers/dom';

afterEach(() => { cleanup(); });

describe('audit BR-04: auto-match matches the cash leg, never the journal total', () => {
  test('a $100 bank line is not matched to an entry whose bank leg is only $20', async () => {
    const calls = stubFetchWithBodies(200, { status: 'ok' });
    setComponentWorkspace('owner');
    markComponentCollectionsLoaded('accounts', 'transactions', 'bankLines');
    useUIStore.setState({ activeTab: 'reconciliation' });
    const accounts = [
      makeChartAccount({ id: 'bank', name: 'Checking', type: 'asset', category: 'Cash' }),
      makeChartAccount({ id: 'ar', name: 'Accounts Receivable', type: 'asset', category: 'Receivables' }),
      makeChartAccount({ id: 'sales', name: 'Sales', type: 'revenue' }),
    ];
    const entry = makeTransaction({
      id: 'entry', date: '2026-05-01', description: 'Acme service', status: 'completed', currency: 'USD', exchangeRate: 1,
      totalAmountCents: 10000,
      lines: [
        { id: '1', accountId: 'bank', amountCents: 2000 },
        { id: '2', accountId: 'ar', amountCents: 8000 },
        { id: '3', accountId: 'sales', amountCents: -10000 },
      ],
    });
    const bankLine = { id: 'line', workspaceId: 'component-workspace', date: '2026-05-01', description: 'Acme service', amountCents: 10000, accountId: 'bank', status: 'pending', currency: 'USD' };
    useLedgerStore.setState({ accounts, transactions: [entry], bankLines: [bankLine as never] });
    try {
      render(<Reconciliation />);
      fireEvent.click(screen.getByRole('button', { name: 'Auto-match all' }));
      // give the action a moment to decide; it must find no confident match
      await new Promise(r => setTimeout(r, 300));
      const call = calls.find(c => c.url.includes('/transactions/reconcile'));
      assert.equal(call, undefined, 'no match operation is sent: the $20 cash leg cannot clear the $100 line');
      const stillPending = useLedgerStore.getState().bankLines[0];
      assert.equal(stillPending.status, 'pending', 'the bank line stays pending');
      console.log(JSON.stringify({ bankLine: 10000, actualBankLeg: 2000, journalTotal: 10000, matched: false }));
    } finally { cleanup(); }
  });
});
