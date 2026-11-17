/**
 * DIM-3: label roles — informational, fully attributed, self-balancing (src/lib/labelRoles.ts). Worked figures with
 * AI #3's A-210 ledger (a210-label-worked-figures.test.ts), cents, label Property:
 *   INV-1 30,000 (tax 3,000), receipt 20,000, BILL-1 15,000 (tax 1,500), vendor payment 6,000 — every line carries
 *   A or B and each value nets to zero in every entry (A's sheet 8,889 = 8,889, B's 15,111 = 15,111).
 * Added:
 *   a deposit of 2,000 whose cash line says A and whose A/P line has no Property
 *     → attributed: 1 line unlabelled (A/P); self-balancing: that line, and A is off by +2,000.00
 *   bank fees of 25.00 with no Property on either line
 *     → attributed / self-balancing: 2 lines unlabelled (Bank fees, Cash); nothing to balance
 *   a draft labelled on one side only, and a corrected entry with its reversal → never judged
 *   informational (the default) → no findings at all, whatever the lines say.
 */
import './helpers/dom';
import test, { afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TransactionTemplates, type LineAccountWeight } from '../kernel/templates/TransactionTemplates';
import { labelRoleFindings, labelRoleProblems, withLabelRole } from '../lib/labelRoles';
import { runDataChecks, type CheckContext } from '../lib/dataChecks';
import { makeChartAccount, makeTransaction } from './fixtures';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { stubFetchWithBodies } from './helpers/dom';
import { useAuthStore } from '../stores/useAuthStore';
import { getSupabase } from '../lib/db/client';
import { LabelRoles } from '../components/platform/settings/LabelRoles';
import LabelBalanceSheetReportView from '../components/reporting/LabelBalanceSheetReportView';
import { balanceSheetByLabel } from '../server/reports/byLabel';
import { useLedgerStore } from '../stores/useLedgerStore';
import type { DimensionDefinition, Transaction } from '../types';

const accounts = [
  makeChartAccount({ id: 'cash', code: '1000', name: 'Cash', type: 'asset', category: 'Cash' }),
  makeChartAccount({ id: 'ar', code: '1100', name: 'Accounts receivable', type: 'asset', category: 'Receivables' }),
  makeChartAccount({ id: 'ap', code: '2100', name: 'Accounts payable', type: 'liability', category: 'Payables' }),
  makeChartAccount({ id: 'tax', code: '2200', name: 'Net tax payable', type: 'liability', category: 'Payables' }),
  makeChartAccount({ id: 'revenue', code: '4000', name: 'Rental income', type: 'income', category: 'Revenue' }),
  makeChartAccount({ id: 'repairs', code: '6100', name: 'Repairs', type: 'expense', category: 'Expenses' }),
  makeChartAccount({ id: 'fees', code: '6200', name: 'Bank fees', type: 'expense', category: 'Expenses' }),
];
const ref = (id: string, name: string) => ({ id, name });
const shares: LineAccountWeight[] = [
  { account: ref('revenue', 'Rental income'), weightCents: 10_000, dimensions: { property: 'A' } },
  { account: ref('revenue', 'Rental income'), weightCents: 17_000, dimensions: { property: 'B' } },
];
const billShares: LineAccountWeight[] = [
  { account: ref('repairs', 'Repairs'), weightCents: 5_000, dimensions: { property: 'A' } },
  { account: ref('repairs', 'Repairs'), weightCents: 8_500, dimensions: { property: 'B' } },
];
const tx = (id: string, date: string, lines: Transaction['lines'], over: Partial<Transaction> = {}) => makeTransaction({ id, date, description: id, lines, ...over });
const A210: Transaction[] = [
  tx('invoice-1', '2026-01-05', TransactionTemplates.buildInvoiceLines({ invoiceNumber: 'INV-1', customerName: 'Tenant', totalCents: 30_000, taxCents: 3_000, arAccount: ref('ar', 'AR'), revenueAccount: ref('revenue', 'Rental income'), taxAccount: ref('tax', 'Tax'), lineAccounts: shares })),
  tx('receipt-1', '2026-01-12', TransactionTemplates.buildPaymentLines({ documentNumber: 'INV-1', entityName: 'Tenant', amountCents: 20_000, cashAccount: ref('cash', 'Cash'), offsetAccount: ref('ar', 'AR'), isReceipt: true, lineAccounts: shares })),
  tx('bill-1', '2026-01-15', TransactionTemplates.buildBillLines({ billNumber: 'BILL-1', vendorName: 'Repairs Co', totalCents: 15_000, taxCents: 1_500, apAccount: ref('ap', 'AP'), expenseAccount: ref('repairs', 'Repairs'), taxAccount: ref('tax', 'Tax'), lineAccounts: billShares })),
  tx('vendor-payment-1', '2026-01-22', TransactionTemplates.buildPaymentLines({ documentNumber: 'BILL-1', entityName: 'Repairs Co', amountCents: 6_000, cashAccount: ref('cash', 'Cash'), offsetAccount: ref('ap', 'AP'), isReceipt: false, lineAccounts: billShares })),
];
const deposit = tx('deposit', '2026-01-25', [{ accountId: 'cash', amountCents: 2_000, dimensions: { property: 'A' } }, { accountId: 'ap', amountCents: -2_000 }]);
const fees = tx('fees', '2026-01-31', [{ accountId: 'fees', amountCents: 2_500 }, { accountId: 'cash', amountCents: -2_500 }]);
const draft = tx('draft', '2026-01-26', [{ accountId: 'cash', amountCents: 900, dimensions: { property: 'A' } }, { accountId: 'ap', amountCents: -900 }], { status: 'draft' });
const wrong = tx('wrong', '2026-01-27', [{ accountId: 'cash', amountCents: 700, dimensions: { property: 'A' } }, { accountId: 'ap', amountCents: -700 }]);
const undo = tx('wrong-reversal', '2026-01-27', [{ accountId: 'cash', amountCents: -700, dimensions: { property: 'A' } }, { accountId: 'ap', amountCents: 700 }], { metadata: { isReversal: true, reversesTxId: 'wrong' } });
const LEDGER = [...A210, deposit, fees, draft, wrong, undo];
const property = (role?: DimensionDefinition['role']): DimensionDefinition[] => [{ id: 'category', name: 'Category' }, { id: 'property', name: 'Property', ...(role ? { role } : {}) }];
const summary = (role?: DimensionDefinition['role']) => labelRoleFindings(LEDGER, property(role), accounts).map(p => [p.transactionId, p.kind, p.accountName ?? p.value, p.cents ?? null]);

test('the A-210 ledger meets every role: every line labelled, each property nets to zero in every entry', () => {
  for (const role of ['attributed', 'self-balancing'] as const) {
    assert.deepEqual(A210.flatMap(t => labelRoleProblems(t, property(role), accounts)), [], role);
  }
});

test('informational (the default): nothing is asked of the lines', () => {
  assert.deepEqual(summary(), []);
  assert.deepEqual(summary('informational'), []);
});

test('fully attributed: the A/P line of the deposit and both lines of the bank fees have no Property', () => {
  assert.deepEqual(summary('attributed'), [
    ['deposit', 'unlabelled', 'Accounts payable', null],
    ['fees', 'unlabelled', 'Bank fees', null], ['fees', 'unlabelled', 'Cash', null],
  ]);
});

test('self-balancing: the same lines, and property A is off by +2,000 in the deposit', () => {
  assert.deepEqual(summary('self-balancing'), [
    ['deposit', 'unlabelled', 'Accounts payable', null], ['deposit', 'unbalanced', 'A', 2_000],
    ['fees', 'unlabelled', 'Bank fees', null], ['fees', 'unlabelled', 'Cash', null],
  ]);
});

test('Data Health lists each entry once: the unbalanced one as medium, the unlabelled one as low', () => {
  const ctx = { transactions: LEDGER, accounts, invoices: [], bills: [], recurring: [], today: '2026-02-01', baseCurrency: 'USD', dimensions: property('self-balancing') } as unknown as CheckContext;
  const found = runDataChecks(ctx).filter(f => f.checkId === 'label-role');
  assert.deepEqual(found.map(f => [f.record?.id, f.severity, f.title]), [
    ['deposit', 'medium', 'deposit (2026-01-25): no Property on Accounts payable; Property A is off by 20.00'],
    ['fees', 'low', 'fees (2026-01-31): no Property on Bank fees; no Property on Cash'],
  ]);
  assert.equal(runDataChecks({ ...ctx, dimensions: property() } as CheckContext).filter(f => f.checkId === 'label-role').length, 0, 'no role, nothing new');
});

test('the role is stored on the label; informational is stored as no role', () => {
  const set = withLabelRole(property(), 'property', 'self-balancing');
  assert.equal(set.find(d => d.id === 'property')!.role, 'self-balancing');
  assert.equal('role' in withLabelRole(set, 'property', 'informational').find(d => d.id === 'property')!, false);
});

describe('Settings → Dimensions: label roles', () => {
  afterEach(async () => { cleanup(); getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });
  const withDims = (dimensions: DimensionDefinition[]) => useAuthStore.setState(s => ({ workspaces: s.workspaces.map(w => ({ ...w, dimensions })) }));

  test('an owner makes Property self-balancing: saved at once on the workspace', async () => {
    setComponentWorkspace('owner');
    withDims(property());
    const calls = stubFetchWithBodies(200, null);
    let saved: DimensionDefinition[] = [];
    render(<LabelRoles dimensions={property()} onSaved={next => { saved = next; }} />);
    assert.equal(screen.queryByLabelText('Role of Category'), null, 'Category is the account itself');
    await act(async () => { fireEvent.change(screen.getByLabelText('Role of Property'), { target: { value: 'self-balancing' } }); });
    await waitFor(() => assert.ok(saved.length > 0));
    // the axis list is a command now: the payload is the `input.dimensions` the server receives
    const write = calls.find(c => c.url.includes('/commands/workspace.dimensionaxes'))!;
    const sent = (write.body as { input: { dimensions: DimensionDefinition[] } }).input.dimensions;
    assert.equal(sent.find(d => d.id === 'property')!.role, 'self-balancing');
    assert.equal(useAuthStore.getState().getCurrentWorkspace()!.dimensions!.find(d => d.id === 'property')!.role, 'self-balancing');
  });

  test('a bookkeeper sees the role but cannot change it', () => {
    setComponentWorkspace('bookkeeper');
    withDims(property('attributed'));
    stubFetchWithBodies(200, null);
    render(<LabelRoles dimensions={property('attributed')} onSaved={() => {}} />);
    assert.equal(screen.queryByLabelText('Role of Property'), null);
    assert.match(document.body.textContent || '', /Fully attributed/);
  });
});

describe('Balance sheet by label: only a self-balancing label must balance', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { cleanup(); globalThis.fetch = realFetch; });
  const show = async (role?: DimensionDefinition['role']) => {
    const ws = setComponentWorkspace('viewer');
    useAuthStore.setState({ workspaces: [{ ...ws, dimensions: property(role).filter(d => d.id === 'property') }] } as never);
    useLedgerStore.setState({ dimensionNodes: [{ id: 'A', dimensionId: 'property', description: 'Harbour flats' }] } as never);
    globalThis.fetch = (async () => new Response(JSON.stringify(balanceSheetByLabel(accounts, [...A210, deposit], 'property', 'A', '2026-01-31')), { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
    render(<LabelBalanceSheetReportView />);
    return waitFor(() => screen.getByTestId('label-balance-sheet'));
  };

  test('self-balancing: A off by 20.00 is an alert that points to Data Health', async () => {
    await show('self-balancing');
    assert.match(screen.getByRole('alert').textContent || '', /does not balance by \$20\.00, and Property is self-balancing/);
  });

  test('informational: the same difference is a note, with the way to have it checked', async () => {
    await show();
    assert.equal(screen.queryByRole('alert'), null);
    assert.match(screen.getByRole('status').textContent || '', /Property is informational, so that is allowed/);
  });
});
