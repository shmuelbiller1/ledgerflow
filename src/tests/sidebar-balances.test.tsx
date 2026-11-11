/**
 * D-92/D-82: the sidebar box that used to be called "Worlds" now says what it shows — your
 * projects, or the balance of each account type — explains the figure, and offers one real
 * action instead of rows that looked clickable but did nothing.
 */
import './helpers/dom';
import test, { afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import Sidebar from '../components/layout/Sidebar';
import { useUIStore } from '../stores/useUIStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useAuthStore } from '../stores/useAuthStore';
import { setComponentWorkspace } from './helpers/componentFixtures';
import type { ChartAccount, Project } from '../types';
import { getSupabase } from '../lib/db/client';

function sidebar(props: Partial<React.ComponentProps<typeof Sidebar>> = {}) {
  return render(<Sidebar
    activeTab={'dashboard' as never}
    setActiveTab={() => {}}
    onLogout={() => {}}
    projects={[]}
    onNewProject={() => {}}
    workspaces={useAuthStore.getState().workspaces}
    currentWorkspaceId={useAuthStore.getState().currentWorkspaceId}
    onSelectWorkspace={() => {}}
    onNewWorkspace={() => {}}
    onAction={() => {}}
    {...props}
  />);
}

const accounts = [
  { id: 'a1', name: 'Checking', type: 'asset', category: 'Cash', balanceCents: 120000 },
  { id: 'a2', name: 'Card', type: 'liability', category: 'Debt', balanceCents: -30000 },
  { id: 'a3', name: 'Materials', type: 'cost_of_goods', category: 'COGS', balanceCents: 70000 },
] as ChartAccount[];

describe('Sidebar balances box (D-92)', () => {
  afterEach(async () => { cleanup(); await getSupabase().auth.dispose(); });

  test('names the account-type balances, explains them and offers the balance sheet', () => {
    setComponentWorkspace();
    useUIStore.setState({ isSidebarOpen: true, language: 'en', activeTab: 'dashboard' });
    useLedgerStore.setState({ projects: [], accounts });
    const opened: string[] = [];
    sidebar({ setActiveTab: tab => opened.push(tab) });

    const box = screen.getByTestId('sidebar-balances');
    assert.equal(screen.queryByText('Worlds'), null, 'the invented label is gone');
    assert.ok(screen.getByRole('heading', { level: 2, name: 'Balances by account type' }));
    assert.match(box.textContent || '', /total of every account in each type/i);
    for (const name of ['Asset', 'Liability', 'Cost of goods']) {
      assert.ok(box.textContent?.includes(name), `${name} is written as words`);
    }
    // amounts are shown, and the row itself is not a fake button
    assert.equal(box.querySelectorAll('button').length, 1, 'only the real action is a button');

    fireEvent.click(screen.getByRole('button', { name: 'Open balance sheet' }));
    assert.deepEqual(opened, ['reports']);
    assert.equal(useUIStore.getState().activeReportTab, 'balance-sheet');
  });

  test('with projects it shows the project budgets and opens projects', () => {
    setComponentWorkspace();
    useUIStore.setState({ isSidebarOpen: true, language: 'en', activeTab: 'dashboard' });
    useLedgerStore.setState({
      projects: [{ id: 'p1', name: 'Shop refit', budgetCents: 450000 }] as Project[],
      accounts,
    });
    const opened: string[] = [];
    sidebar({ setActiveTab: tab => opened.push(tab) });

    assert.ok(screen.getByRole('heading', { level: 2, name: 'Projects' }));
    assert.match(screen.getByTestId('sidebar-balances').textContent || '', /budget you set for each project/i);
    fireEvent.click(screen.getByRole('button', { name: 'Open projects' }));
    assert.deepEqual(opened, ['projects']);
  });
});
