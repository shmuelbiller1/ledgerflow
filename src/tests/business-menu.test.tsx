import './helpers/dom';
import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { APP_TABS, isTabVisible } from '../config/registry';
import { DAILY_TOOL_IDS } from '../config/businessNavigation';
import { pageIndex } from '../config/pageIndex';
import { BUSINESS_PRESETS } from '../lib/businessPresets';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { useAuthStore } from '../stores/useAuthStore';
import { useUIStore } from '../stores/useUIStore';
import AllToolsMenu from '../components/layout/AllToolsMenu';
import ModuleSubNav from '../components/layout/ModuleSubNav';

const base = { isOwner: true, isProMode: false, developerMode: true };
beforeEach(() => { setComponentWorkspace('owner'); useAuthStore.setState({ isAdmin: true }); useUIStore.setState({ isProMode: false, developerMode: true, language: 'en' }); });
afterEach(cleanup);
for (const preset of BUSINESS_PRESETS) test(`${preset.name}: seven daily tools, Pro recommendations, every screen discoverable`, () => {
  const visible = APP_TABS.filter(t => isTabVisible(t, { ...base, businessType: preset.id }));
  assert.deepEqual(visible.map(t => t.id), APP_TABS.filter(t => DAILY_TOOL_IDS.some(id => id === t.id)).map(t => t.id));
  const index = pageIndex('en', { developerMode: true });
  for (const tab of APP_TABS) {
    assert.equal(typeof tab.isAdvanced, 'boolean', tab.id);
    assert.ok(tab.businessTypes.length, tab.id);
    assert.ok(isTabVisible(tab, { ...base, businessType: preset.id, showAll: true }), `${tab.id} available through all tools`);
    assert.ok(index.some(p => p.page.tab === tab.id), `${tab.id} available through search`);
  }
  const inventory = APP_TABS.find(t => t.id === 'inventory')!;
  assert.equal(isTabVisible(inventory, { ...base, businessType: preset.id, isProMode: true }), inventory.businessTypes.includes(preset.id));
});

test('all tools never overrides owner, developer or disabled-module boundaries', () => {
  assert.equal(isTabVisible({ id: 'payroll', isAdvanced: true }, { ...base, showAll: true, modules: { payroll: false } }), false);
  assert.equal(isTabVisible({ requiresOwner: true }, { ...base, showAll: true, isOwner: false }), false);
  assert.equal(isTabVisible({ developerOnly: true }, { ...base, showAll: true, developerMode: false }), false);
});

test('tool search opens advanced tools without Pro mode and can recover from no matches', () => {
  let opened = '';
  render(<AllToolsMenu onSelect={id => { opened = id; }} />);
  fireEvent.change(screen.getByLabelText('Find a tool'), { target: { value: 'ledger journal' } });
  fireEvent.click(screen.getByRole('button', { name: 'Ledger & Journal' }));
  assert.equal(opened, 'ledger');
  fireEvent.change(screen.getByLabelText('Find a tool'), { target: { value: 'unfindable123' } });
  assert.match(screen.getByRole('status').textContent || '', /No tools matched/);
});

test('Pro mode reveals only business-relevant module pages and module-off still wins', () => {
  const ws = useAuthStore.getState().getCurrentWorkspace()!;
  useAuthStore.setState({ workspaces: [{ ...ws, businessType: 'retail' }] });
  const { rerender } = render(<ModuleSubNav activeTab="purchases" onTabChange={() => {}} />);
  assert.equal(screen.queryByRole('button', { name: 'Inventory' }), null);
  act(() => { useUIStore.setState({ isProMode: true }); });
  rerender(<ModuleSubNav activeTab="purchases" onTabChange={() => {}} />);
  assert.ok(screen.getByRole('button', { name: 'Inventory' }));
  act(() => { useAuthStore.setState({ workspaces: [{ ...ws, businessType: 'creative' }] }); });
  rerender(<ModuleSubNav activeTab="purchases" onTabChange={() => {}} />);
  assert.equal(screen.queryByRole('button', { name: 'Inventory' }), null);
});


test('an advanced page opened through discovery keeps its active context in basic mode', () => {
  render(<ModuleSubNav activeTab="inventory" onTabChange={() => {}} />);
  assert.equal(screen.getByRole('button', { name: 'Inventory' }).getAttribute('aria-current'), 'page');
});
