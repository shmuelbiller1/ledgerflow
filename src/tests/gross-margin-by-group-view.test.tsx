/**
 * A-193 screen: gross margin by item group. Widgets sold 10 × $10 in January of this year at a
 * recorded unit cost of $4 — margin 60%, marked estimated on screen (lib test works the figures).
 */
import { stubFetch } from './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import GrossMarginByItemGroupReportView from '../components/reporting/GrossMarginByItemGroupReportView';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useDataNeedsStore } from '../stores/useDataNeedsStore';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';
import { getSupabase } from '../lib/db/client';
import { getLocalDateISO } from '../lib/utils';

const year = getLocalDateISO().slice(0, 4);

describe('Gross margin by item group screen', () => {
  beforeEach(() => {
    stubFetch(404);
    setComponentWorkspace('owner');
    markComponentCollectionsLoaded('invoices', 'inventory', 'transactions', 'accounts');
    useDataNeedsStore.setState({ failed: {} as never });
    useLedgerStore.setState({
      invoices: [{
        id: 'i1', customerId: 'c1', status: 'sent', date: `${year}-01-10`, currency: 'USD', workspaceId: 'component-workspace',
        items: [{ id: 'l1', itemId: 'a', description: 'Widget A', quantity: 10, amountCents: 10_000 }],
      }],
      inventory: [{ id: 'a', name: 'Widget A', sku: 'WA', unitCostCents: 400, category: 'Widgets', workspaceId: 'component-workspace' }],
      transactions: [], accounts: [], truncatedCollections: {},
    } as never);
  });
  afterEach(async () => { cleanup(); getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });

  test('the group shows its January margin and the estimate mark', () => {
    render(<GrossMarginByItemGroupReportView />);
    const row = screen.getByRole('rowheader', { name: /Widgets/ }).parentElement!;
    assert.match(row.textContent || '', /60\.0%/, 'January margin $60 on $100');
    assert.match(row.textContent || '', /\$100\.00/, 'year sales');
    assert.match(row.textContent || '', /\$60\.00/, 'year margin');
    assert.ok(screen.getByText(/estimated from recorded unit costs/), 'the estimate is said in words');
  });
});
