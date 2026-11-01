/**
 * A-49 / A-175, A-35, A-18 on screen: Customer quote acceptance list with Y-20 signing links on
 * Reports and on the customer portal, one-page proposals with optional items, and recurring
 * estimate schedules with drafts due.
 */
import './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import CustomerQuotesReportView from '../components/reporting/CustomerQuotesReportView';
import CustomerPortalPage from '../components/sales/CustomerPortalPage';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useDataNeedsStore } from '../stores/useDataNeedsStore';
import type { Customer, Estimate } from '../types';

const customer: Customer = {
  id: 'c-1',
  uid: 'u1',
  workspaceId: 'component-workspace',
  name: 'Northwind Studio',
};

const openEst: Estimate = {
  id: 'est-open',
  uid: 'u1',
  workspaceId: 'component-workspace',
  number: 'EST-101',
  customerId: 'c-1',
  customerName: 'Northwind Studio',
  date: '2026-08-01',
  expiryDate: '2026-11-01',
  status: 'sent',
  amountCents: 150000,
  signToken: 'est_tok_101',
  createdAt: '2026-08-01',
  lines: [
    { description: 'Core implementation', quantity: 1, unitPriceCents: 100000, amountCents: 100000 },
    { description: 'Extended training', quantity: 1, unitPriceCents: 50000, amountCents: 50000 },
  ],
};

describe('Customer quotes, proposals and recurring estimates screen (A-49 / A-175 + A-35 + A-18)', () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    setComponentWorkspace('owner');
    markComponentCollectionsLoaded('estimates', 'customers');
    useDataNeedsStore.setState({ failed: {} as never });
    useLedgerStore.setState({
      estimates: [openEst],
      customers: [customer],
      truncatedCollections: {},
    });
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = realFetch;
    window.history.pushState({}, '', '/');
  });

  test('quote-state filters and follow-up drafts respect expiry without sending or changing records', () => {
    useLedgerStore.setState({ customers: [{ ...customer, name: 'לקוח Studio' }] });
    const original = useLedgerStore.getState().estimates;
    render(<CustomerQuotesReportView />);
    fireEvent.change(screen.getByLabelText('Assessment date'), { target: { value: '2026-10-15' } });
    const draft = screen.getByLabelText('Follow-up draft for EST-101') as HTMLTextAreaElement;
    assert.match(draft.value, /Hello לקוח Studio/);
    assert.match(draft.value, /validity runs through 2026-11-01/);
    assert.equal(draft.readOnly, true);
    fireEvent.change(screen.getByLabelText('Quote state'), { target: { value: 'signed' } });
    assert.equal(screen.queryByLabelText('Follow-up draft for EST-101'), null);
    fireEvent.change(screen.getByLabelText('Quote state'), { target: { value: 'expired' } });
    fireEvent.change(screen.getByLabelText('Assessment date'), { target: { value: '2026-11-02' } });
    assert.match((screen.getByLabelText('Follow-up draft for EST-101') as HTMLTextAreaElement).value, /ended on 2026-11-01; please contact us for an updated quote/);
    assert.equal(useLedgerStore.getState().estimates, original);
  });

  test('lists open quotes with the /e/<signToken> link, separates optional proposal items, and computes recurring drafts due', async () => {
    render(<CustomerQuotesReportView />);
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Assessment date'), { target: { value: '2026-10-15' } });
    });

    const link = screen.getByRole('link', { name: '/e/est_tok_101' });
    assert.equal(link.getAttribute('href'), '/e/est_tok_101');

    // Mark the second line item as optional in the one-page proposal builder (A-35)
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Optional item Extended training'));
    });
    const proposalPre = screen.getByLabelText('One-page proposal text');
    assert.match(proposalPre.textContent || '', /Extended training \(optional\)/);
    assert.match(proposalPre.textContent || '', /Total: 1000\.00 USD/);
    assert.match(proposalPre.textContent || '', /Optional items would add 500\.00 USD \(1500\.00 USD with them\)/);

    // Recurring schedule from 2026-08-01 through 2026-10-15 monthly has 2 drafts due (Sept 1 and Oct 1)
    assert.match(document.body.textContent || '', /2026-09-01/);
    assert.match(document.body.textContent || '', /Draft quotes due now:\s*2/);
  });

  test('customer portal page renders open quotes with their /e/<signToken> accept link', async () => {
    window.history.pushState({}, '', '/c/cp_northwind');
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          business: 'Portal Co',
          customer: 'Northwind Studio',
          customerId: 'c-1',
          currency: 'USD',
          owedCents: 0,
          invoices: [],
          // the portal uses the real date, so this quote must never expire (the fixture's 2026-11-01 did)
          estimates: [{ ...openEst, expiryDate: '2999-12-31' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )) as typeof fetch;

    render(<CustomerPortalPage />);
    const acceptLink = await screen.findByRole('link', { name: 'Review and accept quote EST-101' });
    assert.equal(acceptLink.getAttribute('href'), '/e/est_tok_101');
  });
});
