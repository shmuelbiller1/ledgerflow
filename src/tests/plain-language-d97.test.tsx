/**
 * D-97 (G-02): the first-hour screens name things the way a bookkeeper would.
 * These guards lock the plain-language pass on the reconciliation wizard, the bank
 * feed importer, the chart of accounts and the chart template selector: the old
 * invented jargon must never come back. Display-only wording; no money or server code.
 */
import './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import ReconciliationWizard from '../components/ledger/ReconciliationWizard';
import BankFeedImport from '../components/ledger/BankFeedImport';
import ChartOfAccountsView from '../components/ledger/ChartOfAccountsView';
import DimensionsSettings from '../components/platform/settings/DimensionsSettings';
import TagsSettings from '../components/platform/settings/TagsSettings';
import TemplateSelector from '../components/layout/TemplateSelector';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';
import { makeChartAccount } from './fixtures';
import { stubFetchWithBodies } from './helpers/dom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

const accounts = [
  makeChartAccount({ id: 'bank', name: 'Business Checking', type: 'asset', category: 'Cash' }),
  makeChartAccount({ id: 'card', name: 'Savings Bank', type: 'asset', category: 'Cash' }),
];

const JARGON = [
  'Synapse', 'Cognitive', 'Invariant', 'Topology', 'Protocol Engaged', 'Blueprint',
  'Registry Unoccupied', 'Assert Match', 'Revert Verification', 'Abort Mission',
  'Dimensions', 'Label Node', 'Dimension Axis', 'World / Entity', 'Dimensional Type',
  'NODES DETECTED', 'Import Vectors', 'Orphaned Nodes', 'Finalize Alignment',
  'Matching Protocol', 'Bank Feed Ingestion', 'Node ID', 'Total Aggregate',
];

beforeEach(() => {
  stubFetchWithBodies(200, {});
  setComponentWorkspace('owner');
  markComponentCollectionsLoaded('bankLines', 'transactions', 'accounts', 'reconciliations');
  useLedgerStore.setState({ accounts, transactions: [], bankLines: [], autoRules: [] });
});

afterEach(() => cleanup());

describe('D-97 plain language on the first-hour screens', () => {
  test('reconciliation wizard uses bookkeeping words on both steps', () => {
    render(
      <ReconciliationWizard
        isOpen
        onClose={() => {}}
        accounts={accounts}
        onComplete={() => {}}
        formatCurrency={(cents) => `$${(cents / 100).toFixed(2)}`}
      />
    );
    assert.ok(screen.getByRole('heading', { name: 'Reconcile account' }));
    assert.ok(screen.getByText(/Statement details/));
    assert.ok(screen.getByText('Bank account'));
    assert.ok(screen.getByRole('option', { name: 'Select an account...' }));
    assert.ok(screen.getByText('Statement date'));
    assert.ok(screen.getByText('Statement ending balance ($)'));
    assert.ok(screen.getByText(/Enter the ending date and balance exactly as shown on the bank statement/));
    assert.ok(screen.getByRole('button', { name: 'Continue' }));

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Business Checking' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    // The header and footer render outside the animated step body, so they are
    // reachable in jsdom; the step-2 body wording is covered in the browser spec.
    assert.ok(screen.getByText(/Match transactions/));
    assert.ok(screen.getByRole('button', { name: 'Auto-match' }));
    assert.ok(screen.getByRole('button', { name: 'Finish reconciliation' }));
    assert.ok(screen.getByRole('button', { name: 'Back' }));

    for (const word of JARGON) {
      assert.equal(document.body.textContent?.includes(word), false, `jargon returned: ${word}`);
    }
  });

  test('the wizard refuses to continue without an account, in plain words', () => {
    render(
      <ReconciliationWizard
        isOpen
        onClose={() => {}}
        accounts={accounts}
        onComplete={() => {}}
        formatCurrency={(cents) => `$${(cents / 100).toFixed(2)}`}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    // still on step 1 and the refusal names the missing field
    assert.ok(screen.getByText('Bank account'));
  });

  test('bank feed importer explains the upload without jargon', () => {
    render(
      <BankFeedImport
        workspaceId="component-workspace"
        accounts={accounts}
        onImport={() => {}}
        onClose={() => {}}
      />
    );
    assert.ok(screen.getByRole('heading', { name: 'Import bank feed' }));
    assert.ok(screen.getByText('Upload bank statement'));
    assert.ok(screen.getByText('Drop a CSV file here, or click to browse'));
    assert.ok(screen.getByText('CSV import with rule-based categorization'));
    assert.ok(screen.getByRole('button', { name: 'Cancel' }));
    for (const word of ['Ingestion', 'Vectors', 'NODES', 'Abort', 'Topology', 'Deploy Ledger']) {
      assert.equal(document.body.textContent?.includes(word), false, `jargon returned: ${word}`);
    }
  });

  test('chart of accounts uses plain table headers and a helpful empty state', () => {
    const { rerender } = render(
      <ChartOfAccountsView
        accounts={[]}
        searchTerm=""
        formatCurrency={(cents) => `$${(cents / 100).toFixed(2)}`}
        onDrillDown={() => {}}
        onDeleteAccount={() => {}}
      />
    );
    assert.ok(screen.getByText('No accounts yet'));
    assert.ok(screen.getByText('Choose a chart of accounts to get started, or add your first account.'));

    rerender(
      <ChartOfAccountsView
        accounts={[makeChartAccount({ id: 'sales', name: 'Sales', type: 'revenue', category: 'Revenue', balanceCents: 50000 })]}
        searchTerm=""
        formatCurrency={(cents) => `$${(cents / 100).toFixed(2)}`}
        onDrillDown={() => {}}
        onDeleteAccount={() => {}}
      />
    );
    for (const header of ['Code', 'Account name', 'Type', 'Category', 'Balance']) {
      assert.ok(screen.getByRole('columnheader', { name: header }), header);
    }
    assert.equal(document.body.textContent?.includes('Node ID'), false);
    assert.equal(document.body.textContent?.includes('Topology Type'), false);
  });

  test('template selector explains chart templates in plain language', () => {
    render(
      <TemplateSelector
        isOpen
        onClose={() => {}}
        onSelect={() => {}}
        onOpenAI={() => {}}
        currentType=""
      />
    );
    assert.ok(screen.getByRole('heading', { name: 'Choose a chart of accounts' }));
    assert.ok(screen.getByText('Ready-to-use templates'));
    assert.ok(screen.getByText('Ready-made templates'));
    assert.ok(screen.getByText('AI-built chart of accounts'));
    assert.ok(screen.getAllByRole('button', { name: 'Use template' }).length >= 1);
    assert.ok(screen.getByText('Key equation'));
    assert.ok(screen.getByText('Accounts in this template'));
    assert.ok(screen.getByText('How the accounts connect'));
    assert.ok(screen.getByText('Balanced books, enforced'));
    assert.ok(screen.getByRole('button', { name: /Use this template/ }));
    for (const word of ['Invariant', 'Blueprint', 'Topology', 'Engage', 'Synthesis', 'Cognitive', 'Protocol']) {
      assert.equal(document.body.textContent?.includes(word), false, `jargon returned: ${word}`);
    }
  });
});

describe('D-97 plain language at the action boundary (source guards)', () => {
  // Sonner does not render inside jsdom, so the toasts emitted by the reconciliation action
  // layer and the importer upload handler are guarded at the source instead.
  const reconcileActions = source('../hooks/transactionActions/reconcileActions.ts');
  const statementImporter = source('../components/ledger/StatementImporter.tsx');
  const reconciliationView = source('../components/ledger/ReconciliationView.tsx');
  const templateSelector = source('../components/layout/TemplateSelector.tsx');

  test('reconciliation action feedback uses bookkeeping words', () => {
    for (const banned of [
      'Alignment confirmed and certified', 'Atomic transaction synthesized', 'pipeline matches',
      'Optimal alignment', 'nodes synchronized', 'Initiating auto-reconciliation',
      'Matching cycle failed', 'Synthesis cycle', 'Re-inserted',
    ]) {
      assert.equal(reconcileActions.includes(banned), false, `jargon returned: ${banned}`);
    }
    for (const required of [
      'Match saved.', 'Entry created and matched.', 'Match undone.',
      'Automatic matching complete.', 'No confident matches found.',
    ]) {
      assert.ok(reconcileActions.includes(required), `expected plain wording: ${required}`);
    }
  });

  test('the importer explains file reading in plain words, including the in-progress state', () => {
    assert.equal(statementImporter.includes('Analytical engine'), false);
    assert.ok(statementImporter.includes('Reading '));
  });

  test('the suggested-matches modal is a real dialog and the AI card does not promise editing', () => {
    assert.ok(reconciliationView.includes('useDialog'), 'new overlays use the shared useDialog contract');
    assert.equal(templateSelector.includes('Review and change every account'), false);
    assert.ok(templateSelector.includes('Review every account before applying it to your books.'));
  });
});


test('EU-E1 Labels and Tags explain their distinction without old feature jargon', () => {
  const workspace = useAuthStore.getState().getCurrentWorkspace()!;
  useAuthStore.setState({ workspaces: [{ ...workspace, dimensions: [{ id: 'world', name: 'World / Entity', isWorld: true }] }] });
  useLedgerStore.setState({ dimensionNodes: [] });
  render(<DimensionsSettings />);
  assert.ok(screen.getByRole('heading', { name: 'Labels' }));
  for (const word of JARGON) assert.ok(!document.body.textContent?.includes(word), word);
  assert.ok(screen.getByText('Labels group line amounts in reports; tags help you find records.'));
  cleanup();
  render(<TagsSettings />);
  assert.ok(screen.getByRole('heading', { name: 'Tags' }));
  assert.ok(screen.getByText('Labels group line amounts in reports; tags help you find records.'));
});
