/**
 * A-178: Project profitability with budget vs actual cost comparison (worked figures + screen test).
 */
import './helpers/dom';
import test, { afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { computeProjectProfitability } from '../lib/projectProfitability';
import ProfitabilityByView from '../components/reporting/ProfitabilityByView';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { makeChartAccount } from './fixtures';

const expenseAcc = makeChartAccount({ id: 'exp-1', name: 'Subcontractors', type: 'expense', category: 'Operating Expenses' });

describe('A-178 project profitability with budget vs actual', () => {
  afterEach(() => cleanup());

  test('computes exact whole-cent budget remaining and % used, including zero-spend budgeted projects and over-budget projects', () => {
    const rows = computeProjectProfitability({
      accounts: [expenseAcc],
      projects: [
        { id: 'p-1', name: 'Harbor Bridge', budgetCents: 100_000, status: 'active' },
        { id: 'p-2', name: 'Solar Roof', budgetCents: 50_000, status: 'active' },
        { id: 'p-3', name: 'Reserve Initiative', budgetCents: 25_000, status: 'active' },
      ],
      invoices: [
        {
          id: 'inv-1', uid: 'u1', workspaceId: 'ws1', customerId: 'c1', customerName: 'City',
          number: 'INV-1', date: '2026-05-10', dueDate: '2026-06-10', status: 'paid', currency: 'USD',
          amountCents: 180_000,
          items: [
            { id: 'l1', description: 'Phase 1', quantity: 1, unitPriceCents: 120_000, amountCents: 120_000, dimensions: { project: 'Harbor Bridge' } },
            { id: 'l2', description: 'Install', quantity: 1, unitPriceCents: 60_000, amountCents: 60_000, dimensions: { project: 'Solar Roof' } },
          ],
        } as never,
      ],
      transactions: [
        {
          id: 'tx-1', uid: 'u1', workspaceId: 'ws1', date: '2026-05-15', description: 'Crew costs',
          totalAmountCents: 135_000, status: 'posted', type: 'expense',
          lines: [
            { accountId: 'exp-1', amountCents: 75_000, project: 'Harbor Bridge' },
            { accountId: 'exp-1', amountCents: 60_000, project: 'Solar Roof' },
          ],
        } as never,
      ],
    });

    const harbor = rows.find(r => r.project === 'Harbor Bridge')!;
    assert.equal(harbor.costCents, 75_000);
    assert.equal(harbor.budgetCents, 100_000);
    assert.equal(harbor.budgetRemainingCents, 25_000);
    assert.equal(harbor.budgetUsedPct, 75);

    const solar = rows.find(r => r.project === 'Solar Roof')!;
    assert.equal(solar.costCents, 60_000);
    assert.equal(solar.budgetCents, 50_000);
    assert.equal(solar.budgetRemainingCents, -10_000); // $100.00 over budget
    assert.equal(solar.budgetUsedPct, 120);

    const reserve = rows.find(r => r.project === 'Reserve Initiative')!;
    assert.equal(reserve.revenueCents, 0);
    assert.equal(reserve.costCents, 0);
    assert.equal(reserve.budgetCents, 25_000);
    assert.equal(reserve.budgetRemainingCents, 25_000);
    assert.equal(reserve.budgetUsedPct, 0);
  });

  test('ProfitabilityByView renders Cost budget, Budget left and Used % columns when By = Project', () => {
    useAuthStore.setState({ isGuest: true, user: null, currentWorkspaceId: null } as never);
    useLedgerStore.setState({
      accounts: [expenseAcc],
      customers: [],
      inventory: [],
      projects: [{ id: 'p-1', uid: 'u1', workspaceId: 'ws1', name: 'Harbor Bridge', status: 'active', budgetCents: 100_000 } as never],
      invoices: [{
        id: 'inv-1', uid: 'u1', workspaceId: 'ws1', customerId: 'c1', customerName: 'City',
        number: 'INV-1', date: '2026-05-10', dueDate: '2026-06-10', status: 'paid', currency: 'USD',
        amountCents: 120_000,
        items: [{ id: 'l1', description: 'Work', quantity: 1, unitPriceCents: 120_000, amountCents: 120_000, dimensions: { project: 'Harbor Bridge' } }],
      } as never],
      transactions: [{
        id: 'tx-1', uid: 'u1', workspaceId: 'ws1', date: '2026-05-15', description: 'Crew',
        totalAmountCents: 40_000, status: 'posted', type: 'expense',
        lines: [{ accountId: 'exp-1', amountCents: 40_000, project: 'Harbor Bridge' }],
      } as never],
    });

    render(<ProfitabilityByView selectedYear={2026} />);
    fireEvent.change(screen.getByLabelText('By'), { target: { value: 'project' } });
    assert.ok(screen.getByText('Cost budget'));
    assert.ok(screen.getByText('Budget left'));
    assert.ok(screen.getByText('Harbor Bridge'));
    assert.ok(screen.getAllByText('40%').length >= 1);
  });
});
