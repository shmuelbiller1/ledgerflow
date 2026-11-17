/**
 * Required labels (Z-12): a label (Project, Property…) can be required on chosen accounts from a
 * date on. Entries missing it are a Data Health finding that opens the entry and goes away once it
 * is labelled; the journal form warns before saving and shows the label columns. Nothing is
 * required until a rule is set; drafts, voided entries and older entries are never flagged.
 */
import './helpers/dom';
import test, { afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { missingLabels, requiredLabelRules, requiredLabelWarnings, withRequiredOn } from '../lib/requiredLabels';
import { DATA_CHECKS, runDataChecks } from '../lib/dataChecks';
import { RequiredLabelRules } from '../components/platform/settings/RequiredLabelRules';
import JournalEntryModal from '../components/ledger/JournalEntryModal';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { stubFetchWithBodies } from './helpers/dom';
import { makeChartAccount, makeTransaction } from './fixtures';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { getSupabase } from '../lib/db/client';
import type { DimensionDefinition, Transaction } from '../types';

const utilities = makeChartAccount({ id: 'util', code: '6200', name: 'Utilities', type: 'expense' });
const rent = makeChartAccount({ id: 'rent', code: '6300', name: 'Rent', type: 'expense' });
const bank = makeChartAccount({ id: 'bank', code: '1000', name: 'Checking', type: 'asset', category: 'Cash' });
const accounts = [utilities, rent, bank];
const dims = (requiredOn?: DimensionDefinition['requiredOn']): DimensionDefinition[] => [
  { id: 'category', name: 'Category', systemDefault: true },
  { id: 'property', name: 'Property', ...(requiredOn ? { requiredOn } : {}) },
  { id: 'project', name: 'Project' },
];
const rule = dims({ accountIds: ['util'], since: '2026-10-01' });
const entry = (over: Partial<Transaction> = {}, utilLine: Record<string, unknown> = {}): Transaction => makeTransaction({
  id: 'tx1', date: '2026-10-05', description: 'Electric bill', status: 'completed',
  lines: [{ accountId: 'util', amountCents: 12000, ...utilLine }, { accountId: 'bank', amountCents: -12000 }],
  ...over,
} as Partial<Transaction>);

describe('The rule', () => {
  test('a line on a required account without the label is missing it; with it anywhere it counts', () => {
    assert.deepEqual(missingLabels(entry(), rule, accounts).map(m => [m.transactionId, m.dimensionName, m.accountName, m.date]), [['tx1', 'Property', 'Utilities', '2026-10-05']]);
    assert.equal(missingLabels(entry({}, { dimensions: { property: 'P5' } }), rule, accounts).length, 0, 'on the line');
    assert.equal(missingLabels(entry({ dimensions: { property: 'P5' } }), rule, accounts).length, 0, 'on the entry');
    assert.equal(missingLabels(entry({}, { tags: ['property:P5'] }), rule, accounts).length, 0, 'as a tag');
    assert.equal(missingLabels(entry({}, { splitAllocations: [{ dimensions: { property: 'P5' }, weight: 0.5 }, { dimensions: { property: 'P6' }, weight: 0.5 }] }), rule, accounts).length, 0, 'every split has one');
    assert.equal(missingLabels(entry({}, { splitAllocations: [{ dimensions: { property: 'P5' }, weight: 0.5 }, { dimensions: {}, weight: 0.5 }] }), rule, accounts).length, 1, 'one split has none');
  });

  test('nothing is flagged before the date, on drafts or voided entries, on other accounts, or without a rule', () => {
    assert.equal(missingLabels(entry({ date: '2026-09-30' }), rule, accounts).length, 0);
    assert.equal(missingLabels(entry({ status: 'draft' }), rule, accounts).length, 0);
    assert.equal(missingLabels(entry({ status: 'void' }), rule, accounts).length, 0);
    assert.equal(missingLabels(entry({ lines: [{ accountId: 'rent', amountCents: 100 }, { accountId: 'bank', amountCents: -100 }] } as Partial<Transaction>), rule, accounts).length, 0);
    assert.equal(missingLabels(entry(), dims(), accounts).length, 0);
    assert.equal(missingLabels(entry(), undefined, accounts).length, 0);
    // two lines on the same account: one finding
    assert.equal(missingLabels(entry({ lines: [{ accountId: 'util', amountCents: 50 }, { accountId: 'util', amountCents: 50 }, { accountId: 'bank', amountCents: -100 }] } as Partial<Transaction>), rule, accounts).length, 1);
    // Category is the account itself and is never required
    assert.deepEqual(requiredLabelRules([{ id: 'category', name: 'Category', requiredOn: { accountIds: ['util'], since: '' } }]), []);
  });

  test('setting and clearing a rule on one label leaves the others alone', () => {
    const set = withRequiredOn(dims(), 'property', { accountIds: ['util', 'util', 'rent'], since: '2026-10-01' });
    assert.deepEqual(set.find(d => d.id === 'property')!.requiredOn, { accountIds: ['util', 'rent'], since: '2026-10-01' });
    assert.equal(set.find(d => d.id === 'project')!.requiredOn, undefined);
    const cleared = withRequiredOn(set, 'property', { accountIds: [], since: '2026-10-01' });
    assert.equal('requiredOn' in cleared.find(d => d.id === 'property')!, false);
  });

  test('the form warning names the label, the account and the line', () => {
    const lines = [{ accountId: 'bank' }, { accountId: 'util' }, { accountId: 'util', dimensions: { property: 'P5' } }, { accountId: '' }];
    assert.deepEqual(requiredLabelWarnings(lines, '2026-10-05', rule, accounts), ['Property is required on Utilities (line 2)']);
    assert.deepEqual(requiredLabelWarnings(lines, '2026-09-05', rule, accounts), []);
  });
});

describe('In Data Health', () => {
  const ctx = (transactions: Transaction[], dimensions?: DimensionDefinition[]) => ({ transactions, accounts, invoices: [], bills: [], recurring: [], today: '2026-10-07', baseCurrency: 'USD', dimensions });
  test('one finding per entry, opening the entry; gone once the label is filled', () => {
    const check = DATA_CHECKS.find(c => c.id === 'missing-label')!;
    assert.ok(check.label.includes('Z-12'));
    const found = runDataChecks(ctx([entry()], rule)).filter(f => f.checkId === 'missing-label');
    assert.deepEqual(found.map(f => [f.title, f.severity, f.record]), [['Electric bill (2026-10-05): no Property on Utilities', 'low', { type: 'transaction', id: 'tx1' }]]);
    assert.equal(runDataChecks(ctx([entry({}, { dimensions: { property: 'P5' } })], rule)).filter(f => f.checkId === 'missing-label').length, 0);
    assert.equal(runDataChecks(ctx([entry()])).filter(f => f.checkId === 'missing-label').length, 0, 'no rules, nothing new');
  });
});

describe('Settings → Dimensions: required labels', () => {
  afterEach(async () => { cleanup(); getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });
  const withDims = (dimensions: DimensionDefinition[]) => useAuthStore.setState(s => ({ workspaces: s.workspaces.map(w => ({ ...w, dimensions })) }));

  test('an owner requires Property on Utilities: saved at once on the workspace, from today', async () => {
    setComponentWorkspace('owner');
    withDims(dims());
    useLedgerStore.setState({ accounts });
    const calls = stubFetchWithBodies(200, null);
    let saved: DimensionDefinition[] = [];
    render(<RequiredLabelRules dimensions={dims()} onSaved={next => { saved = next; }} />);
    assert.equal(screen.queryByLabelText('Require Category on an account'), null, 'Category is the account itself');
    await act(async () => { fireEvent.change(screen.getByLabelText('Require Property on an account'), { target: { value: 'util' } }); });
    await waitFor(() => assert.ok(saved.length > 0));
    // the axis list is a command now: the payload is the `input.dimensions` the server receives
    const write = calls.find(c => c.url.includes('/commands/workspace.dimensionaxes'))!;
    const sent = (write.body as { input: { dimensions: DimensionDefinition[] } }).input.dimensions;
    assert.deepEqual(sent.find(d => d.id === 'property')!.requiredOn!.accountIds, ['util']);
    assert.match(sent.find(d => d.id === 'property')!.requiredOn!.since, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(useAuthStore.getState().getCurrentWorkspace()!.dimensions!.find(d => d.id === 'property')!.requiredOn!.accountIds[0], 'util');
  });

  test('a bookkeeper sees the rule but cannot change it', () => {
    setComponentWorkspace('bookkeeper');
    withDims(rule);
    useLedgerStore.setState({ accounts });
    stubFetchWithBodies(200, null);
    render(<RequiredLabelRules dimensions={rule} onSaved={() => {}} />);
    assert.ok(screen.getByRole('list', { name: 'Accounts that need Property' }));
    assert.match(document.body.textContent || '', /Utilities/);
    assert.equal(screen.queryByLabelText('Require Property on an account'), null);
    assert.equal(screen.queryByRole('button', { name: /no longer required/ }), null);
  });
});

describe('In the journal entry form', () => {
  afterEach(async () => { cleanup(); getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });

  test('a line on Utilities without a Property is named; the Property column shows; filling it clears the warning', () => {
    setComponentWorkspace('bookkeeper');
    useAuthStore.setState(s => ({ workspaces: s.workspaces.map(w => ({ ...w, dimensions: dims({ accountIds: ['util'], since: '2000-01-01' }) })) }));
    useLedgerStore.setState({ baseCurrency: 'USD', transactions: [], lockDate: null, accounts });
    stubFetchWithBodies(200, { status: 'success', data: { templates: [] } });
    render(<JournalEntryModal isOpen onClose={() => {}} user={{ uid: 'test-user' } as never} accounts={accounts} workspaceId="component-workspace" />);
    assert.equal(screen.queryByRole('status', { name: 'Required labels missing' }), null);
    assert.equal(screen.queryByLabelText('Property for line 1'), null, 'label columns hidden until needed');
    fireEvent.change(screen.getByLabelText('Account for line 1'), { target: { value: 'util' } });
    assert.match(screen.getByRole('status', { name: 'Required labels missing' }).textContent || '', /Property is required on Utilities \(line 1\)/);
    fireEvent.change(screen.getByLabelText('Property for line 1'), { target: { value: 'P5' } });
    assert.equal(screen.queryByRole('status', { name: 'Required labels missing' }), null);
  });
});
