import './helpers/dom';
import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { useTransactionColumnLayout } from '../hooks/useTransactionColumnLayout';
import { TransactionColumnLayoutControls } from '../components/ledger/TransactionColumnLayoutControls';
import { TransactionColumnGrid } from '../components/ledger/TransactionColumnGrid';
import { normalizeColumnLayout } from '../lib/columnLayout';
import { gridTracks, orderedGridTracks, gridTemplate } from '../lib/transactionColumns';
import { useAuthStore } from '../stores/useAuthStore';
import { setComponentWorkspace } from './helpers/componentFixtures';

function Harness() {
  const model = useTransactionColumnLayout();
  const layout = { mobile: false, tablet: false, compact: false };
  const natural = gridTracks(layout, model.hiddenColumns).map(([id]) => id);
  const order = orderedGridTracks(layout, model.hiddenColumns, model.layout).map(([id]) => id);
  return <>
    <TransactionColumnLayoutControls layout={model.layout} setWidth={model.setColumnWidth} move={model.moveColumn} reset={model.resetColumnLayout} />
    <TransactionColumnGrid data-testid="columns" naturalOrder={natural} order={order} style={{ display: 'grid', gridTemplateColumns: gridTemplate(layout, model.hiddenColumns, model.layout) }}>{natural.map(id => <div key={id}>{id}</div>)}</TransactionColumnGrid>
    <button onClick={() => model.toggleColumnVisibility('project')}>Toggle project</button>
  </>;
}
beforeEach(() => { localStorage.clear(); setComponentWorkspace(); });
afterEach(cleanup);

test('width/order controls persist after remount, update cell DOM order, and reset', () => {
  let view = render(<Harness />);
  const width = view.getByRole('spinbutton', { name: 'Description width in pixels' });
  fireEvent.change(width, { target: { value: '320' } }); fireEvent.blur(width);
  fireEvent.click(view.getByRole('button', { name: 'Move Description left' }));
  const columns = () => Array.from(view.getByTestId('columns').children).map(cell => cell.getAttribute('data-column'));
  assert.deepEqual(columns().slice(0, 3), ['select', 'description', 'date']);
  assert.ok(view.getByTestId('columns').style.gridTemplateColumns.startsWith('48px 320px 110px'));
  fireEvent.click(view.getByText('Toggle project'));
  assert.ok(!columns().includes('project'));
  view.unmount(); view = render(<Harness />);
  assert.equal((view.getByRole('spinbutton', { name: 'Description width in pixels' }) as HTMLInputElement).value, '320');
  assert.deepEqual(columns().slice(0, 3), ['select', 'description', 'date']);
  assert.ok(!columns().includes('project'));
  fireEvent.click(view.getByRole('button', { name: 'Reset widths and order' }));
  assert.deepEqual(columns().slice(0, 3), ['select', 'date', 'description']);
  assert.ok(view.getByTestId('columns').style.gridTemplateColumns.includes('1fr'));
});

test('switching people immediately loads their widths, order and visibility without copying old preferences', () => {
  const view = render(<Harness />);
  const firstUser = useAuthStore.getState().user!;
  const width = view.getByRole('spinbutton', { name: 'Date width in pixels' });
  fireEvent.change(width, { target: { value: '208' } }); fireEvent.blur(width);
  fireEvent.click(view.getByText('Toggle project'));
  act(() => useAuthStore.setState({ user: { ...firstUser, uid: 'second-person' } }));
  assert.equal((view.getByRole('spinbutton', { name: 'Date width in pixels' }) as HTMLInputElement).value, '');
  assert.ok(view.getByTestId('columns').querySelector('[data-column="project"]'));
  assert.equal(localStorage.getItem('lf_tx_layout_second-person'), null);
  act(() => useAuthStore.setState({ user: firstUser }));
  assert.equal((view.getByRole('spinbutton', { name: 'Date width in pixels' }) as HTMLInputElement).value, '208');
  assert.equal(view.getByTestId('columns').querySelector('[data-column="project"]'), null);
});

test('invalid preferences are sanitized, boundaries stay pinned and mobile order stays compact', () => {
  const preferences = normalizeColumnLayout({ order: ['amount', 'date', 'amount', 'bogus', 'select'], widths: { amount: 900, date: -2, description: 123.5, bogus: 100, status: Infinity } });
  assert.equal(preferences.order[0], 'select'); assert.equal(preferences.order.at(-1), 'actions');
  assert.equal(new Set(preferences.order).size, 11);
  assert.deepEqual(preferences.widths, { amount: 600, date: 64, description: 124 });
  assert.equal(gridTemplate({ mobile: true, tablet: false, compact: false }, new Set(), preferences), '40px 100px 1fr 100px');
  localStorage.setItem('lf_tx_layout_test-user', '{');
  const view = render(<Harness />);
  assert.ok(view.getByTestId('columns'));
});
