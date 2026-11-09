import './helpers/dom';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import DashboardWidgets from '../components/dashboard/DashboardWidgets';
import { setComponentWorkspace, markComponentCollectionsLoaded } from './helpers/componentFixtures';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useDataNeedsStore } from '../stores/useDataNeedsStore';
import { getSupabase } from '../lib/db/client';

afterEach(async () => { cleanup(); await getSupabase().auth.dispose(); });
test('E-5: every displayed widget provides refresh and describes actual cache freshness', () => {
  setComponentWorkspace();
  markComponentCollectionsLoaded('transactions', 'accounts', 'invoices', 'bills', 'customers', 'vendors', 'scenarios');
  useLedgerStore.setState({ accounts: [], transactions: [], invoices: [], bills: [], customers: [], vendors: [], truncatedCollections: {} });
  render(<DashboardWidgets />);
  const revenue = within(screen.getByRole('article', { name: 'Revenue' }));
  assert.ok(revenue.getByRole('button', { name: 'Refresh Revenue' }));
  assert.ok(revenue.getByText('Live data; update time not tracked'));
  assert.ok(within(screen.getByRole('article', { name: 'Owed to you' })).getByRole('button', { name: 'Refresh Owed to you' }));
});
test('E-5: failed financial collection shows an actionable retry, not a misleading zero', () => {
  setComponentWorkspace();
  markComponentCollectionsLoaded('transactions', 'accounts', 'invoices', 'bills', 'customers', 'vendors');
  useLedgerStore.setState({ accounts: [], transactions: [], invoices: [], bills: [], customers: [], vendors: [], truncatedCollections: {} });
  useDataNeedsStore.getState().markFailed('transactions', 'Connection dropped');
  render(<DashboardWidgets />);
  const revenue = within(screen.getByRole('article', { name: 'Revenue' }));
  assert.ok(revenue.getByRole('button', { name: 'Refresh Revenue' }));
  assert.match(revenue.getByRole('alert').textContent || '', /Could not load transactions/);
  assert.equal(revenue.queryByText(/\$0\.00/), null);
  const receivables = within(screen.getByRole('article', { name: 'Owed to you' }));
  assert.equal(receivables.queryByRole('alert'), null);
  useDataNeedsStore.getState().retry('transactions');
});
