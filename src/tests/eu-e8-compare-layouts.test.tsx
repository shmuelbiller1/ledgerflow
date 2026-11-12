/** EU-E8: the pivot is "Compare" under Reports, and a person can save a layout and open it again. */
import './helpers/dom';
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { REPORT_TABS_REGISTRY } from '../config/registry';
import CompareReportView from '../components/reporting/CompareReportView';
import { layoutsKey, readLayouts, saveLayout } from '../lib/compareLayouts';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { makeTransaction } from './fixtures';

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

test('EU-E8: Compare is a report; the old names are gone', () => {
  assert.ok(REPORT_TABS_REGISTRY.some(r => r.id === 'compare' && r.label.en === 'Compare'));
  for (const file of ['src/components/ledger/PivotSheetView.tsx', 'src/components/intelligence/intelligenceChannels.ts']) {
    const text = readFileSync(file, 'utf8');
    for (const old of ['Spreadsheet Pivot Matrix', 'Cross-tabulation', 'Dimension Aggregator', "'Pivot Sheet'"]) assert.ok(!text.includes(old), `${old} in ${file}`);
  }
});

test('EU-E8: layouts are kept per workspace and replaced by name', () => {
  saveLayout('w1', { name: 'Property by month', pivotMode: 'matrix', rowDim: 'property', colDim: 'month', groupBy: 'category', period: 'this_year' });
  saveLayout('w1', { name: 'property BY month', pivotMode: 'flat', rowDim: 'property', colDim: 'month', groupBy: 'payee', period: 'all' });
  assert.deepEqual(readLayouts('w1').map(l => [l.name, l.pivotMode]), [['property BY month', 'flat']]);
  assert.deepEqual(readLayouts('w2'), []);
  localStorage.setItem(layoutsKey('w3'), 'not json');
  assert.deepEqual(readLayouts('w3'), []);
});

test('EU-E8: on the screen — save a layout, and it is offered again', async () => {
  setComponentWorkspace('owner');
  markComponentCollectionsLoaded('transactions', 'accounts');
  useLedgerStore.setState({ transactions: [makeTransaction({ id: 't', workspaceId: 'component-workspace', date: '2026-03-02', status: 'completed', lines: [{ accountId: 'a', amountCents: 100 }, { accountId: 'b', amountCents: -100 }] })] });
  render(<CompareReportView />);
  fireEvent.change(screen.getByLabelText('Layout name'), { target: { value: 'By payee' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save layout' })); });
  const ws = useAuthStore.getState().currentWorkspaceId!;
  assert.deepEqual(readLayouts(ws).map(l => l.name), ['By payee']);
  assert.ok(screen.getByRole('option', { name: 'By payee' }));
});

test('EU-E8: with no posted entries Compare says what to do', () => {
  setComponentWorkspace('owner');
  useLedgerStore.setState({ transactions: [] });
  render(<CompareReportView />);
  assert.ok(screen.getByText(/No posted entries yet/));
});
