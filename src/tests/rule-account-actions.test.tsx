import './helpers/dom';
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { applyRuleAction, dryRunRules, executeRulesOnTransactions } from '../lib/rulesEngine';
import { isTransferTransaction } from '../lib/txFilters';
import { useAutoRules } from '../hooks/useAutoRules';
import { RulesSettings } from '../components/platform/settings/RulesSettings';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useAuthStore } from '../stores/useAuthStore';
import { getSupabase } from '../lib/db/client';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { makeTransaction } from './fixtures';
import type { AutoRule, ChartAccount, Transaction } from '../types';

const workspaceId = 'component-workspace';
const account = (id: string, type: ChartAccount['type'], extra: Partial<ChartAccount> = {}): ChartAccount => ({ id, uid: 'test-user', workspaceId, name: id === 'rent' ? 'שכירות / Rent' : id, code: id, type, currency: 'USD', balanceCents: 0, ...extra });
const accounts = [account('bank', 'asset', { category: 'Cash' }), account('savings', 'asset', { category: 'Cash' }), account('expense', 'expense'), account('rent', 'expense'), account('old', 'expense', { isArchived: true }), account('foreign', 'expense', { workspaceId: 'elsewhere' }), account('eur', 'asset', { category: 'Cash', currency: 'EUR' })];
const context = { workspaceId, accounts, currency: 'USD' };
const transaction = (extra: Partial<Transaction> = {}) => makeTransaction({ id: 'entry', workspaceId, status: 'completed', type: 'expense', description: 'AWS שירות', totalAmountCents: 12345,
  currency: 'USD', originalCurrency: 'ILS', exchangeRate: 0.27, updatedAt: '2026-10-01T00:00:00.000Z', metadata: { memo: 'הערה / note' },
  lines: [{ id: 'bank-line', accountId: 'bank', accountName: 'bank', amountCents: -12345, exchangeRate: 0.27, tags: ['bank'] }, { id: 'cost-line', accountId: 'expense', accountName: 'expense', amountCents: 12345, exchangeRate: 0.27, metadata: { memo: 'retained' } }], ...extra });
const rule = (extra: Partial<AutoRule> = {}): AutoRule => ({ id: 'account-rule', uid: 'test-user', workspaceId, name: 'Cloud account', groupName: 'Accounts', isActive: true,
  condition: { descriptionContains: 'AWS' }, action: { targetAccountId: 'rent', targetTransactionKind: 'expense' }, confidence: 1, isHardened: true, priority: 10, createdAt: '2026-10-01', ...extra });

describe('Safe account/type rule previews', () => {
  it('keeps the bank line, exact minor amounts, FX, identities and other metadata', () => {
    const tx = transaction();
    const result = applyRuleAction(rule(), tx, context);
    assert.equal(result.error, undefined);
    assert.strictEqual(result.modifiedTx.lines[0], tx.lines[0]);
    assert.deepEqual(result.modifiedTx.lines[1], { ...tx.lines[1], accountId: 'rent', accountName: 'שכירות / Rent' });
    assert.deepEqual([result.modifiedTx.totalAmountCents, result.modifiedTx.currency, result.modifiedTx.originalCurrency, result.modifiedTx.exchangeRate], [12345, 'USD', 'ILS', 0.27]);
    assert.deepEqual(result.modifiedTx.metadata, { memo: 'הערה / note' });
    assert.deepEqual(result.recategorization, { id: 'entry', bankAccountId: 'bank', toAccountId: 'rent', expectedUpdatedAt: '2026-10-01T00:00:00.000Z' });
    assert.equal(tx.lines[1].accountId, 'expense');
  });

  it('converts expense to transfer and back; explicit bank selection is required with two cash lines', () => {
    const transfer = applyRuleAction(rule({ action: { targetAccountId: 'savings', targetTransactionKind: 'transfer' } }), transaction(), context).modifiedTx;
    assert.equal(isTransferTransaction(transfer), true);
    assert.deepEqual(transfer.transferDetails, { fromAccountId: 'bank', toAccountId: 'savings' });
    assert.match(applyRuleAction(rule(), transfer, context).error!, /bank account to preserve/);
    const back = applyRuleAction(rule({ action: { bankAccountId: 'bank', targetAccountId: 'rent', targetTransactionKind: 'expense' } }), transfer, context).modifiedTx;
    assert.equal(isTransferTransaction(back), false);
    assert.equal(back.transferDetails, undefined);
    assert.deepEqual(back.lines.map(line => line.amountCents), [-12345, 12345]);
    assert.equal(back.lines[0].accountId, 'bank');
    const incoming = transaction({ lines: transaction().lines.map(line => ({ ...line, amountCents: -line.amountCents })) });
    const result = applyRuleAction(rule({ action: { targetAccountId: 'savings', targetTransactionKind: 'transfer' } }), incoming, context);
    assert.deepEqual(result.modifiedTx.transferDetails, { fromAccountId: 'savings', toAccountId: 'bank' });
  });

  it('refuses absent/foreign/archived/self/currency-mismatched accounts and incompatible classifications', () => {
    for (const targetAccountId of ['missing', 'foreign', 'old', 'bank', 'eur']) assert.ok(applyRuleAction(rule({ action: { targetAccountId } }), transaction(), context).error, targetAccountId);
    assert.match(applyRuleAction(rule({ action: { targetAccountId: 'rent', targetTransactionKind: 'transfer' } }), transaction(), context).error!, /transfer needs/);
    assert.match(applyRuleAction(rule({ action: { targetAccountId: 'savings', targetTransactionKind: 'expense' } }), transaction(), context).error!, /expense needs/);
    assert.match(applyRuleAction(rule(), transaction(), undefined).error!, /workspace chart/);
    assert.match(applyRuleAction(rule(), transaction({ workspaceId: 'elsewhere' }), context).error!, /workspace chart/);
  });

  it('refuses document-linked, tax, split, unbalanced, non-integer and locked entries without inventing a fix', () => {
    const base = transaction();
    const cases = [transaction({ eventId: 'invoice-event' }), transaction({ metadata: { loanId: 'loan' } }), transaction({ status: 'certified' }), transaction({ isLocked: true }),
      transaction({ lines: [...base.lines, { accountId: 'rent', amountCents: 0 }] }),
      transaction({ lines: [base.lines[0], { ...base.lines[1], taxAmountCents: 100 }] }),
      transaction({ lines: [base.lines[0], { ...base.lines[1], splitAllocations: [{ dimensions: {}, weight: 1 }] }] }),
      transaction({ lines: [base.lines[0], { ...base.lines[1], amountCents: 12344 }] }),
      transaction({ lines: [{ ...base.lines[0], amountCents: -0.5 }, { ...base.lines[1], amountCents: 0.5 }] })];
    for (const tx of cases) { const result = applyRuleAction(rule(), tx, context); assert.ok(result.error); assert.strictEqual(result.modifiedTx, tx); assert.deepEqual(result.changes, []); }
    const dry = dryRunRules([rule()], [transaction({ taxAmountCents: 10 })], context);
    assert.equal(dry.matches.length, 0); assert.equal(dry.errors.length, 1);
  });

  it('clears the legacy transfer marker on expense conversion while retaining other metadata', () => {
    const tx = transaction({ isTransfer: true, metadata: { isTransfer: true, memo: 'הערה / note' } });
    const result = applyRuleAction(rule(), tx, context);
    assert.equal(result.error, undefined);
    assert.deepEqual(result.modifiedTx.metadata, { memo: 'הערה / note' });
    assert.equal(isTransferTransaction(result.modifiedTx), false);
    assert.deepEqual(result.modifiedTx.lines.map(line => line.amountCents), [-12345, 12345]);
    assert.equal(tx.metadata?.isTransfer, true);
  });

  it('honors group/priority/stop and refuses combining financial and legacy actions in one rule', async () => {
    const stopped = rule({ stopProcessingOnMatch: true });
    const later = rule({ id: 'later', priority: 20, action: { targetAccountId: 'savings' } });
    assert.deepEqual(dryRunRules([later, stopped], [transaction()], context).matches.map(match => match.matchedRule.id), ['account-rule']);
    assert.equal(dryRunRules([{ ...stopped, groupIsActive: false }, later], [transaction()], context).matches.length, 0);
    assert.match(applyRuleAction(rule({ action: { targetAccountId: 'rent', addTags: ['old'] } }), transaction(), context).error!, /separate rule/);
    await assert.rejects(executeRulesOnTransactions([rule()], [transaction()], () => {}), /validated recategorize/);
  });
});

type Call = { url: string; body: Record<string, unknown> };
let calls: Call[];
let records: Map<string, Transaction>;
let refusal: boolean;
let hold: boolean;
let release: (() => void) | undefined;
beforeEach(() => {
  setComponentWorkspace(); calls = []; records = new Map([['entry', transaction()]]); refusal = false; hold = false; release = undefined;
  useLedgerStore.setState({ accounts, autoRules: [rule()], transactions: [transaction()] });
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (url.includes('/transactions/recategorize')) {
      const body = JSON.parse(String(init?.body)) as { workspaceId: string; changes: Array<{ id: string; bankAccountId: string; toAccountId: string }> };
      calls.push({ url, body });
      if (hold) await new Promise<void>(resolve => { release = resolve; });
      if (refusal) return Response.json({ error: 'Entry was changed by someone else', entryId: body.changes[0].id }, { status: 409 });
      for (const change of body.changes) {
        const tx = records.get(change.id)!;
        const target = accounts.find(account => account.id === change.toAccountId)!;
        const transfer = target.category === 'Cash';
        const saved = { ...tx, updatedAt: '2026-10-06T12:00:00.000Z', lines: tx.lines.map(line => {
          if (line.accountId === change.bankAccountId) return line;
          const next = { ...line, accountId: target.id, accountName: target.name };
          if (transfer) next.isTransfer = true; else delete next.isTransfer;
          return next;
        }) };
        if (transfer) { saved.isTransfer = true; saved.transferDetails = { fromAccountId: change.bankAccountId, toAccountId: target.id }; }
        else {
          delete saved.isTransfer; delete saved.transferDetails;
          if (saved.metadata && 'isTransfer' in saved.metadata) { saved.metadata = { ...saved.metadata }; delete saved.metadata.isTransfer; }
        }
        records.set(change.id, saved);
      }
      return Response.json({ status: 'success', changed: body.changes.length });
    }
    if (url.includes('/transactions/batch')) { const body = JSON.parse(String(init?.body)) as Record<string, unknown>; calls.push({ url, body }); return Response.json({ status: 'success' }); }
    if (url.includes('/rest/v1/transactions')) {
      const id = new URL(url).searchParams.get('id')?.replace(/^eq\./, '') || '';
      return Response.json(records.has(id) ? { id, data: records.get(id) } : null);
    }
    if (url.includes('/api/v1/commands/autorule.')) {
      const body = JSON.parse(String(init?.body)) as { workspaceId: string; input: Record<string, unknown> };
      calls.push({ url, body: body as unknown as Record<string, unknown> });
      const name = url.split('/').at(-1);
      if (name === 'autorule.create') {
        const ruleData = body.input.rule as Partial<AutoRule>;
        const saved = { ...ruleData, id: ruleData.id || 'created-rule', uid: 'test-user', workspaceId, createdAt: '2026-11-15T00:00:00.000Z', hitCount: 0 };
        return Response.json({ status: 'success', command: name, data: { rule: saved }, replayed: false });
      }
      if (name === 'autorule.recordhits') {
        const rules = body.input.rules as Array<{ id: string; hits: number }>;
        return Response.json({ status: 'success', command: name, data: { updated: rules.map(item => ({ id: item.id, hitCount: item.hits, lastTriggeredAt: '2026-11-15T00:00:00.000Z' })) }, replayed: false });
      }
      return Response.json({ status: 'success', command: name, data: {}, replayed: false });
    }
    if (url.includes('/rest/v1/autoRules')) return Response.json([{ id: 'account-rule', data: rule() }]);
    if (url.includes('/rpc/lf_')) { calls.push({ url, body: JSON.parse(String(init?.body)) as Record<string, unknown> }); return Response.json(null); }
    return Response.json({});
  }) as typeof fetch;
});
afterEach(() => { release?.(); cleanup(); getSupabase().auth.dispose(); });

describe('Rules use the validated financial writer', () => {
  it('persists classification-only changes even when the counterparty line already matches', async () => {
    const tx = transaction();
    tx.lines[1] = { ...tx.lines[1], accountId: 'savings', accountName: 'Savings', isTransfer: true };
    act(() => useLedgerStore.setState({ transactions: [tx] }));
    records.set(tx.id, tx);
    const { result } = renderHook(() => useAutoRules());
    await act(async () => { assert.equal(await result.current.applyToExisting([rule({ action: { targetAccountId: 'savings', bankAccountId: 'bank', targetTransactionKind: 'transfer' } })], [tx]), 1); });
    assert.equal(calls.filter(call => call.url.includes('/transactions/recategorize')).length, 1);
  });
  it('collapses successive rules to one request and refreshes confirmed server state', async () => {
    const { result } = renderHook(() => useAutoRules());
    const earlier = rule({ id: 'early', action: { targetAccountId: 'savings', bankAccountId: 'bank' }, priority: 1 });
    const later = rule({ id: 'late', action: { targetAccountId: 'rent', bankAccountId: 'bank' }, priority: 2 });
    await act(async () => { assert.equal(await result.current.applyToExisting([earlier, later], [transaction()]), 1); });
    const financialRequests = calls.filter(call => call.url.includes('/transactions/recategorize'));
    assert.equal(financialRequests.length, 1);
    assert.deepEqual(financialRequests[0].body, { workspaceId, changes: [{ id: 'entry', bankAccountId: 'bank', toAccountId: 'rent', expectedUpdatedAt: '2026-10-01T00:00:00.000Z' }] });
    assert.equal(calls.filter(call => call.url.includes('/api/v1/commands/autorule.recordhits')).length, 1);
    assert.equal(useLedgerStore.getState().transactions[0].updatedAt, '2026-10-06T12:00:00.000Z');
    assert.equal(useLedgerStore.getState().transactions[0].lines[1].accountId, 'rent');
    assert.equal(calls.filter(call => call.url.includes('/rpc/')).length, 0, 'live rule hit counters no longer use browser RPC writes');
  });

  it('refusals keep the preview and entry; retry sends the expected version and succeeds', async () => {
    const { result } = renderHook(() => useAutoRules()); refusal = true;
    await act(async () => { assert.equal(await result.current.applyToExisting([rule()], [transaction()]), 0); });
    assert.match(result.current.applyError!, /entry.*entry/);
    assert.equal(useLedgerStore.getState().transactions[0].lines[1].accountId, 'expense');
    refusal = false;
    await act(async () => { assert.equal(await result.current.applyToExisting([rule()], [transaction()]), 1); });
    assert.equal(result.current.applyError, null);
  });

  it('denies viewer, invalid/mixed previews and oversized financial batches before any write', async () => {
    const { result } = renderHook(() => useAutoRules());
    await act(async () => { assert.equal(await result.current.applyToExisting([rule(), rule({ id: 'tag', action: { addTags: ['cloud'] } })], [transaction()]), 0); });
    assert.match(result.current.applyError!, /separately/);
    await act(async () => { assert.equal(await result.current.applyToExisting([rule()], [transaction({ eventId: 'document' })]), 0); });
    await act(async () => { assert.equal(await result.current.applyToExisting([rule()], Array.from({ length: 501 }, (_, i) => transaction({ id: `t-${i}` }))), 0); });
    assert.match(result.current.applyError!, /500/);
    act(() => { setComponentWorkspace('viewer'); });
    await act(async () => { assert.equal(await result.current.applyToExisting([rule()], [transaction()]), 0); });
    assert.equal(calls.length, 0);
  });

  it('refuses double activation and does not install an obsolete response into another workspace', async () => {
    const { result } = renderHook(() => useAutoRules()); hold = true;
    let pending!: Promise<number>;
    act(() => { pending = result.current.applyToExisting([rule()], [transaction()]); });
    await waitFor(() => assert.equal(calls.length, 1));
    await act(async () => { assert.equal(await result.current.applyToExisting([rule()], [transaction()]), 0); });
    const other = transaction({ id: 'other', workspaceId: 'other' });
    act(() => { useAuthStore.setState({ currentWorkspaceId: 'other' }); useLedgerStore.setState({ transactions: [other] }); });
    await act(async () => { release!(); await pending; });
    assert.deepEqual(useLedgerStore.getState().transactions, [other]);
  });

  it('ordinary rules still use /batch and send the final cumulative snapshot once', async () => {
    const { result } = renderHook(() => useAutoRules());
    const a = rule({ id: 'a', action: { descriptionPrefix: '[cloud] ' } });
    const b = rule({ id: 'b', action: { addTags: ['cloud'] }, priority: 20 });
    await act(async () => { assert.equal(await result.current.applyToExisting([a, b], [transaction()]), 1); });
    const api = calls.filter(call => call.url.includes('/transactions/batch'));
    assert.equal(api.length, 1);
    const updates = api[0].body.updates as Array<{ id: string; data: Partial<Transaction> }>;
    assert.equal(updates.length, 1); assert.equal(updates[0].data.description, '[cloud] AWS שירות');
    assert.deepEqual(updates[0].data.tags, ['cloud']);
  });
});

describe('Account/type settings controls', () => {
  it('offers current active chart records only and saves their IDs with explicit classification', async () => {
    render(<RulesSettings />);
    fireEvent.click(screen.getByRole('button', { name: 'Create Rule' }));
    const select = screen.getByLabelText('Counterparty account (existing chart)');
    assert.ok(select.textContent?.includes('שכירות / Rent'));
    assert.equal(select.textContent?.includes('foreign'), false); assert.equal(select.textContent?.includes('old'), false);
    fireEvent.change(select, { target: { value: 'savings' } });
    fireEvent.change(screen.getByLabelText('Bank account to preserve'), { target: { value: 'bank' } });
    fireEvent.change(screen.getByLabelText('Expense / transfer classification'), { target: { value: 'transfer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Rule' }));
    await waitFor(() => assert.equal(Boolean(screen.queryByRole('dialog')), false));
    const command = calls.find(call => call.url.endsWith('/api/v1/commands/autorule.create'))!;
    const saved = (command.body.input as { rule: AutoRule }).rule;
    assert.deepEqual(saved.action, { targetAccountId: 'savings', bankAccountId: 'bank', targetTransactionKind: 'transfer' });
    assert.equal(calls.filter(call => call.url.includes('/transactions/')).length, 0, 'saving a definition never posts a ledger entry');
  });

  it('mixed-action save is refused with its draft retained; blocked layouts are visible in the dry run', async () => {
    render(<RulesSettings />);
    fireEvent.click(screen.getByRole('button', { name: 'Create Rule' }));
    fireEvent.change(screen.getByLabelText('Counterparty account (existing chart)'), { target: { value: 'rent' } });
    fireEvent.change(screen.getByLabelText('Add Tags (comma-separated)'), { target: { value: 'cloud' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Rule' }));
    assert.match(screen.getByRole('alert').textContent!, /separate rule/);
    assert.equal((screen.getByLabelText('Add Tags (comma-separated)') as HTMLInputElement).value, 'cloud');
    assert.equal(calls.length, 0);
    fireEvent.click(screen.getByRole('button', { name: 'Close rule editor' }));
    act(() => { useLedgerStore.setState({ transactions: [transaction({ taxAmountCents: 10 })] }); });
    fireEvent.click(screen.getByRole('button', { name: 'Test Against Ledger' }));
    assert.match(screen.getByRole('alert').textContent!, /without tax or splits/);
    assert.equal((screen.getByRole('button', { name: /Apply .*Updates/ }) as HTMLButtonElement).disabled, true);
  });
});
