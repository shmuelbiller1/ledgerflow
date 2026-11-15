import { inlineEditName } from './helpers/inlineEditName';
import './helpers/dom';
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { RulesSettings } from '../components/platform/settings/RulesSettings';
import { useAutoRules } from '../hooks/useAutoRules';
import { dryRunRules, executeRulesOnTransactions } from '../lib/rulesEngine';
import { getSupabase } from '../lib/db/client';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useAuthStore } from '../stores/useAuthStore';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { makeTransaction } from './fixtures';
import type { AutoRule, Transaction } from '../types';

const rule = (id: string, extra: Partial<AutoRule> = {}): AutoRule => ({
  id, uid: 'test-user', workspaceId: 'component-workspace', name: id, groupName: 'תוכנה / SaaS',
  condition: { descriptionContains: 'AWS' }, action: { addTags: [id] }, priority: 10,
  confidence: 1, isHardened: true, createdAt: '2026-10-01', ...extra,
});
const tx = () => makeTransaction({ id: 'tx', workspaceId: 'component-workspace', description: 'AWS שירות', totalAmountCents: 12345,
  lines: [{ accountId: 'bank', amountCents: -12345 }, { accountId: 'expense', amountCents: 12345 }] });
let durable: AutoRule[];
let writes: { endpoint: string; body: { workspaceId?: string; input?: Record<string, unknown> } }[];
let refuse: boolean;
let release: (() => void) | undefined;
let hold: boolean;

beforeEach(() => {
  setComponentWorkspace();
  durable = [rule('first'), rule('paused', { isActive: false, priority: 20 })];
  writes = []; refuse = false; release = undefined; hold = false;
  useLedgerStore.setState({ autoRules: durable, transactions: [tx()], accounts: [] });
  globalThis.fetch = (async (input, init) => {
    const endpoint = String(input);
    if (endpoint.includes('/rest/v1/autoRules')) {
      const params = new URL(endpoint).searchParams;
      const workspace = params.get('workspace_id')?.replace(/^eq\./, '');
      const offset = Number(params.get('offset') || 0);
      const limit = Number(params.get('limit') || 1000);
      return Response.json(durable.filter(r => !workspace || r.workspaceId === workspace).slice(offset, offset + limit).map(r => ({ id: r.id, data: r })));
    }
    if (endpoint.includes('/api/v1/commands/autorule.')) {
      const body = JSON.parse(String(init?.body)) as typeof writes[number]['body'];
      writes.push({ endpoint, body });
      if (hold) await new Promise<void>(resolve => { release = resolve; });
      if (refuse) return Response.json({ status: 'error', message: 'Permission denied', code: 'ROLE_REQUIRED' }, { status: 403 });
      const input = body.input || {};
      const name = endpoint.split('/').at(-1);
      let data: Record<string, unknown> = {};
      if (name === 'autorule.group') {
        const groupName = String(input.groupName);
        const members = durable.filter(rule => rule.workspaceId === body.workspaceId && (rule.groupName || 'General') === groupName);
        if (typeof input.newName === 'string') {
          for (const rule of members) rule.groupName = input.newName;
        } else {
          for (const rule of members) rule.groupIsActive = input.groupIsActive as boolean;
        }
        data = { groupName: input.newName || groupName, ruleIds: members.map(rule => rule.id) };
      } else if (name === 'autorule.update') {
        const id = String(input.id);
        const patch = input.data as Partial<AutoRule>;
        durable = durable.map(rule => rule.id === id ? { ...rule, ...patch } : rule);
        data = { rule: durable.find(rule => rule.id === id) };
      } else if (name === 'autorule.create') {
        const rule = input.rule as Partial<AutoRule>;
        const created = { ...rule, id: rule.id || 'created-rule', uid: 'test-user', workspaceId: body.workspaceId, createdAt: '2026-11-15T00:00:00.000Z', hitCount: 0 } as AutoRule;
        durable.push(created);
        data = { rule: created };
      } else if (name === 'autorule.delete') {
        durable = durable.filter(rule => rule.id !== input.id);
        data = { id: input.id };
      } else if (name === 'autorule.recordhits') {
        const updates = input.rules as Array<{ id: string; hits: number }>;
        for (const update of updates) durable = durable.map(rule => rule.id === update.id ? { ...rule, hitCount: (rule.hitCount || 0) + update.hits } : rule);
        data = { updated: updates.map(update => ({ id: update.id, hitCount: durable.find(rule => rule.id === update.id)?.hitCount || update.hits, lastTriggeredAt: '2026-11-15T00:00:00.000Z' })) };
      }
      return Response.json({ status: 'success', data, replayed: false });
    }
    return Response.json({});
  }) as typeof fetch;
});
afterEach(() => { release?.(); cleanup(); getSupabase().auth.dispose(); });

describe('Rule group evaluation preserves existing rule behavior', () => {
  it('pauses every member, keeps its individual flag, and restores priority/stop order', async () => {
    const first = rule('first', { priority: 20 });
    const stop = rule('stop', { priority: 10, stopProcessingOnMatch: true });
    const paused = rule('paused', { priority: 1, isActive: false });
    const other = rule('other', { groupName: 'Other', priority: 30 });
    assert.deepEqual(dryRunRules([first, stop, paused, other], [tx()]).matches.map(m => m.matchedRule.id), ['stop']);
    // Even a partly loaded/mixed legacy group fails closed when one member disables it.
    const disabled = [first, { ...stop, groupIsActive: false }, paused, other];
    assert.deepEqual(dryRunRules(disabled, [tx()]).matches.map(m => m.matchedRule.id), ['other']);
    const changed: Transaction[] = [];
    await executeRulesOnTransactions(disabled, [tx()], next => { changed.push(next); });
    assert.deepEqual(changed[0].lines.map(line => [line.accountId, line.amountCents]), [["bank", -12345], ["expense", 12345]]);
    assert.equal(changed[0].totalAmountCents, 12345);
    assert.deepEqual(changed[0].tags, ['other']);
    assert.equal(paused.isActive, false);
  });

  it('legacy flags default on; priority ties retain input order and cumulative actions', () => {
    const result = dryRunRules([rule('a'), rule('b')], [tx()]);
    assert.deepEqual(result.matches.map(m => m.matchedRule.id), ['a', 'b']);
    assert.deepEqual(result.matches[1].txModified.tags, ['a', 'b']);
    assert.deepEqual(tx().tags, undefined);
  });
});

describe('Durable rule group writes', () => {
  it('reads group members missing from the cache and changes only group state in one atomic batch', async () => {
    durable.push(rule('uncached'));
    durable.push(rule('foreign', { workspaceId: 'elsewhere' }));
    useLedgerStore.setState({ autoRules: durable.slice(0, 2) });
    const { result } = renderHook(() => useAutoRules());
    await act(async () => { await result.current.updateGroup('תוכנה / SaaS', { groupIsActive: false }); });
    assert.deepEqual(writes[0].body.input, { groupName: 'תוכנה / SaaS', groupIsActive: false });
    assert.deepEqual(durable.filter(r => r.workspaceId === 'component-workspace' && r.groupName === 'תוכנה / SaaS').map(r => r.groupIsActive), [false, false, false]);
    await act(async () => { await result.current.updateGroup('תוכנה / SaaS', { groupIsActive: true }); });
    assert.equal(durable.find(r => r.id === 'paused')!.isActive, false);
    assert.equal(durable.find(r => r.id === 'foreign')!.groupIsActive, undefined);
    assert.equal(dryRunRules(durable.filter(r => r.workspaceId === 'component-workspace'), [tx()]).matches.length, 2);
  });

  it('reads beyond the 1000-rule cache cap before disabling a group', async () => {
    durable = Array.from({ length: 1001 }, (_, index) => rule(`r-${index}`));
    useLedgerStore.setState({ autoRules: durable.slice(0, 1000) });
    const { result } = renderHook(() => useAutoRules());
    await act(async () => { await result.current.updateGroup('תוכנה / SaaS', { groupIsActive: false }); });
    assert.equal(writes.length, 1);
    assert.deepEqual(writes[0].body.input, { groupName: 'תוכנה / SaaS', groupIsActive: false });
    assert.equal(durable.filter(rule => rule.groupIsActive === false).length, 1001);
    assert.equal(durable[1000].groupIsActive, false);
  });

  it('renames exact mixed-language labels, rejects collisions, and inherits the off state when adding a rule', async () => {
    durable[0].groupIsActive = false;
    const { result } = renderHook(() => useAutoRules());
    await act(async () => { assert.equal(await result.current.saveRule(rule('new')), true); });
    assert.equal(durable.find(r => r.id === 'new')!.groupIsActive, false);
    await act(async () => { await result.current.updateGroup('תוכנה / SaaS', { groupName: 'ענן / Cloud' }); });
    assert.ok(durable.every(r => r.groupName === 'ענן / Cloud'));
    durable.push(rule('other', { groupName: 'Other' }));
    await act(async () => { await assert.rejects(result.current.updateGroup('ענן / Cloud', { groupName: 'Other' }), /already exists/); });
    assert.equal(durable[0].groupName, 'ענן / Cloud');
  });

  it('refuses invalid priorities, denied roles, duplicate group writes and obsolete responses', async () => {
    const { result } = renderHook(() => useAutoRules());
    await assert.rejects(result.current.setRulePriority('first', 1.5), /whole-number/);
    hold = true;
    let pending!: Promise<void>;
    act(() => { pending = result.current.updateGroup('תוכנה / SaaS', { groupIsActive: false }); });
    await waitFor(() => assert.equal(writes.length, 1));
    await act(async () => { await assert.rejects(result.current.updateGroup('תוכנה / SaaS', { groupIsActive: true }), /still being saved/); });
    const newRule = rule('new-workspace', { workspaceId: 'new-workspace' });
    act(() => { useAuthStore.setState({ currentWorkspaceId: 'new-workspace' }); useLedgerStore.setState({ autoRules: [newRule] }); });
    await act(async () => { release!(); await pending; });
    assert.deepEqual(useLedgerStore.getState().autoRules, [newRule]);
    act(() => { setComponentWorkspace('viewer'); });
    await act(async () => { await assert.rejects(result.current.updateGroup('תוכנה / SaaS', { groupIsActive: false }), /role cannot/); });
    assert.equal(writes.length, 1);
  });
});

describe('Rules settings group interactions', () => {
  it('retains a refused rename draft, retries on Enter, and saves priority in place', async () => {
    render(<RulesSettings />);
    fireEvent.click(screen.getByRole('button', { name: inlineEditName('Edit Name of group תוכנה / SaaS') }));
    const name = screen.getByRole('combobox', { name: 'Name of group תוכנה / SaaS' });
    refuse = true;
    fireEvent.change(name, { target: { value: 'ענן / Cloud' } });
    fireEvent.keyDown(name, { key: 'Enter' });
    await screen.findByRole('alert');
    assert.equal((screen.getByRole('combobox', { name: 'Name of group תוכנה / SaaS' }) as HTMLInputElement).value, 'ענן / Cloud');
    refuse = false;
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Name of group תוכנה / SaaS' }), { key: 'Enter' });
    await screen.findByRole('button', { name: inlineEditName('Edit Name of group ענן / Cloud') });
    fireEvent.click(screen.getByRole('button', { name: inlineEditName('Edit Priority of first') }));
    const priority = screen.getByRole('textbox', { name: 'Priority of first' });
    fireEvent.change(priority, { target: { value: '0' } });
    fireEvent.keyDown(priority, { key: 'Enter' });
    await waitFor(() => assert.equal(screen.getByRole('button', { name: inlineEditName('Edit Priority of first') }).textContent?.trim(), 'Priority #0'));
    assert.equal(durable.find(r => r.id === 'first')!.priority, 0);
    assert.equal(writes.at(-1)!.endpoint.endsWith('/autorule.update'), true);
    assert.equal((writes.at(-1)!.body.input?.data as Record<string, unknown>).priority, 0);
  });

  it('keeps paused individual switches and shows group-off state after reload', async () => {
    const view = render(<RulesSettings />);
    fireEvent.click(screen.getByRole('button', { name: 'Enable group תוכנה / SaaS' }));
    await waitFor(() => assert.equal(screen.getByRole('button', { name: 'Enable group תוכנה / SaaS' }).getAttribute('aria-pressed'), 'false'));
    assert.equal((screen.getByRole('checkbox', { name: 'Enable rule paused' }) as HTMLInputElement).checked, false);
    view.unmount();
    useLedgerStore.setState({ autoRules: JSON.parse(JSON.stringify(durable)) as AutoRule[] });
    render(<RulesSettings />);
    assert.equal(screen.getByRole('button', { name: 'Enable group תוכנה / SaaS' }).textContent?.trim(), 'Off');
    fireEvent.click(screen.getByRole('button', { name: 'Enable group תוכנה / SaaS' }));
    await waitFor(() => assert.equal(screen.getByRole('button', { name: 'Enable group תוכנה / SaaS' }).textContent?.trim(), 'On'));
    assert.equal((screen.getByRole('checkbox', { name: 'Enable rule paused' }) as HTMLInputElement).checked, false);
  });

  it('editing group/priority keeps a paused rule and conditions/actions outside the editor intact', async () => {
    durable[1] = rule('paused', { isActive: false, priority: 20,
      condition: { descriptionContains: 'AWS', exactAmount: 123.45 },
      action: { addTags: ['cloud'], setNotes: 'הערה / note', descriptionSuffix: ' [receipt]' } });
    useLedgerStore.setState({ autoRules: durable });
    render(<RulesSettings />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit rule paused' }));
    fireEvent.change(screen.getByLabelText('Priority (lower runs first)'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Rule' }));
    await waitFor(() => assert.equal(Boolean(screen.queryByRole('dialog')), false));
    const saved = durable.find(r => r.id === 'paused')!;
    assert.equal(saved.isActive, false);
    assert.equal(saved.priority, 0);
    assert.equal(saved.condition.exactAmount, 123.45);
    assert.equal(saved.action.setNotes, 'הערה / note');
    assert.equal(saved.action.descriptionSuffix, ' [receipt]');
  });

  it('a group named all filters independently; blank priorities stay drafts and legacy labels stay exact', async () => {
    durable = [rule('first', { groupName: 'all' }), rule('paused', { groupName: ' תוכנה / SaaS ', isActive: false })];
    useLedgerStore.setState({ autoRules: durable });
    render(<RulesSettings />);
    fireEvent.click(screen.getByRole('button', { name: 'all' }));
    assert.equal(Boolean(screen.queryByRole('button', { name: 'Edit rule paused' })), false);
    assert.ok(screen.getByRole('button', { name: 'Edit rule first' }));
    fireEvent.click(screen.getByRole('button', { name: 'All Rules (2)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit rule paused' }));
    const priority = screen.getByLabelText('Priority (lower runs first)');
    fireEvent.change(priority, { target: { value: '' } });
    assert.equal((priority as HTMLInputElement).value, '');
    assert.equal((screen.getByRole('button', { name: 'Save Rule' }) as HTMLButtonElement).disabled, true);
    fireEvent.change(priority, { target: { value: '-5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Rule' }));
    await waitFor(() => assert.equal(Boolean(screen.queryByRole('dialog')), false));
    assert.equal(durable.find(r => r.id === 'paused')!.groupName, ' תוכנה / SaaS ');
    assert.equal(durable.find(r => r.id === 'paused')!.priority, -5);
  });

  it('a bookkeeper can edit rule metadata; a stale foreign-workspace row cannot be edited', async () => {
    setComponentWorkspace('bookkeeper');
    const { result } = renderHook(() => useAutoRules());
    await act(async () => { await result.current.setRulePriority('first', 5); });
    assert.equal(durable[0].priority, 5);
    act(() => { useLedgerStore.setState({ autoRules: [rule('foreign', { workspaceId: 'elsewhere' })] }); });
    await assert.rejects(result.current.setRulePriority('foreign', 7), /current workspace/);
    assert.equal(writes.length, 1);
  });

  it('viewer sees read-only values and context changes close the previous editor', () => {
    const view = render(<RulesSettings />);
    fireEvent.click(screen.getByRole('button', { name: 'Create Rule' }));
    assert.ok(screen.getByRole('dialog'));
    act(() => { useAuthStore.setState({ currentWorkspaceId: 'other' }); });
    assert.equal(Boolean(screen.queryByRole('dialog')), false);
    view.unmount();
    setComponentWorkspace('viewer');
    render(<RulesSettings />);
    assert.equal(screen.queryByRole('button', { name: inlineEditName('Edit Priority of first') }), null);
    assert.equal((screen.getByRole('button', { name: 'Enable group תוכנה / SaaS' }) as HTMLButtonElement).disabled, true);
    fireEvent.click(screen.getByRole('button', { name: 'Create Rule' }));
    assert.equal(Boolean(screen.queryByRole('dialog')), false);
    assert.equal(writes.length, 0);
  });
});
