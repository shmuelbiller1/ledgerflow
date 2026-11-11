/**
 * AU-4: accepting an import by reconciliation (src/lib/importAcceptance.ts, ImportAcceptanceView). Worked figures,
 * cents. The source is a QuickBooks trial balance export as of 2026-03-31:
 *   1010 Main Checking 5,000.00 DR · 1050 Petty Cash 250.00 DR · 1200 Accounts Receivable (A/R) 1,500.00 DR
 *   2000 Accounts Payable (A/P) 800.00 CR · 2100 Sales Tax Payable 120.00 CR · 3200 Opening Balance Equity 5,250.00 CR
 *   4000 Project Revenue 580.00 CR · TOTAL 6,750.00 / 6,750.00
 *
 * 1. LedgerFlow holds the same → accepted; totals TB 675,000, A/R 150,000, A/P 80,000, cash 525,000, tax 12,000.
 * 2. An import that went wrong — one 300.00 invoice missing, an 800.00 bill imported twice (to Office Supplies, an
 *    account the source does not have), Petty Cash never created. LedgerFlow: Checking 500,000, A/R 120,000,
 *    Office Supplies 80,000 DR = 700,000; A/P 160,000, tax 12,000, Opening Balance Equity 500,000, revenue 28,000 CR
 *    = 700,000. Every difference named:
 *      1200 A/R           150,000 → 120,000   −30,000  balance differs
 *      2000 A/P           −80,000 → −160,000  −80,000  balance differs
 *      3200 OBE          −525,000 → −500,000  +25,000  balance differs
 *      4000 Revenue       −58,000 → −28,000   +30,000  balance differs
 *      6100 Office         —      →  80,000   +80,000  not in the source
 *      1050 Petty Cash     25,000 →  —        −25,000  not in LedgerFlow
 *    Totals: TB 675,000 vs 700,000 (+25,000); A/R −30,000; A/P +80,000; cash 500,000 = 500,000 (Petty Cash is
 *    listed above, not guessed into cash); tax agrees. 2 accounts agree.
 */
import './helpers/dom';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { amountCents, compareImport, readSourceTrialBalance, type LedgerRow } from '../lib/importAcceptance';
import { makeChartAccount } from './fixtures';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { useLedgerStore } from '../stores/useLedgerStore';
import ImportAcceptanceView from '../components/reporting/ImportAcceptanceView';

import { BRAND_NAME } from '../config/brand';
const SOURCE = [
  '"Northwind Studio"', '"Trial Balance"', '"As of March 31, 2026"',
  '"","Debit","Credit"',
  '"1010 Main Checking","5,000.00",""',
  '"1050 Petty Cash","250.00",""',
  '"1200 Accounts Receivable (A/R)","1,500.00",""',
  '"2000 Accounts Payable (A/P)","","800.00"',
  '"2100 Sales Tax Payable","","120.00"',
  '"3200 Opening Balance Equity","","5,250.00"',
  '"4000 Project Revenue","","580.00"',
  '"TOTAL","$6,750.00","$6,750.00"',
].join('\n');

const acc = (id: string, code: string, name: string, type: string, category: string) => makeChartAccount({ id, code, name, type: type as never, category });
const CHART = [
  acc('cash', '1010', 'Main Checking', 'asset', 'Cash'), acc('petty', '1050', 'Petty Cash', 'asset', 'Cash'),
  acc('ar', '1200', 'Accounts Receivable', 'asset', 'Receivables'), acc('ap', '2000', 'Accounts Payable', 'liability', 'Payables'),
  acc('tax', '2100', 'Sales Tax Payable', 'liability', 'Tax'), acc('obe', '3200', 'Opening Balance Equity', 'equity', 'Equity'),
  acc('rev', '4000', 'Project Revenue', 'income', 'Sales'), acc('office', '6100', 'Office Supplies', 'expense', 'Expenses'),
];
const row = (id: string, debit: number, credit = 0): LedgerRow => ({ id, debit, credit });
const AGREES = [row('cash', 500_000), row('petty', 25_000), row('ar', 150_000), row('ap', 0, 80_000), row('tax', 0, 12_000), row('obe', 0, 525_000), row('rev', 0, 58_000), row('office', 0)];
const WRONG = [row('cash', 500_000), row('ar', 150_000, 30_000), row('office', 80_000), row('ap', 0, 160_000), row('tax', 0, 12_000), row('obe', 0, 500_000), row('rev', 0, 28_000)];
const WRONG_CHART = CHART.filter(a => a.id !== 'petty');

test('amounts as exports write them', () => {
  assert.deepEqual(['1,234.56', '$1,234.56', '-12.00', '(12.00)', '', '7', '7.5', 'abc', '1.234'].map(amountCents), [123_456, 123_456, -1_200, -1_200, 0, 700, 750, null, null]);
});

test('the QuickBooks export is read: titles skipped, codes taken from the name, the total row checked', () => {
  const s = readSourceTrialBalance(SOURCE);
  assert.deepEqual(s.lines.map(l => [l.row, l.code, l.account, l.debitCents]), [
    [5, '1010', 'Main Checking', 500_000], [6, '1050', 'Petty Cash', 25_000], [7, '1200', 'Accounts Receivable (A/R)', 150_000],
    [8, '2000', 'Accounts Payable (A/P)', -80_000], [9, '2100', 'Sales Tax Payable', -12_000], [10, '3200', 'Opening Balance Equity', -525_000], [11, '4000', 'Project Revenue', -58_000],
  ]);
  assert.deepEqual([s.totalDebitCents, s.totalCreditCents, s.problems], [675_000, 675_000, []]);
  assert.match(readSourceTrialBalance(SOURCE.replace('$6,750.00","$6,750.00', '$6,700.00","$6,750.00')).problems[0], /total row \(6700\.00 \/ 6750\.00\) is not the sum of its lines \(6750\.00 \/ 6750\.00\)/);
  assert.match(readSourceTrialBalance('Account,Amount\nCash,10').problems[0], /No header row/);
});

test('the same books: accepted, every total agrees', () => {
  const r = compareImport(readSourceTrialBalance(SOURCE), CHART, AGREES);
  assert.deepEqual(r.checks.map(c => [c.key, c.sourceCents, c.ledgerCents, c.differenceCents]), [
    ['trial-balance', 675_000, 675_000, 0], ['ar', 150_000, 150_000, 0], ['ap', 80_000, 80_000, 0], ['cash', 525_000, 525_000, 0], ['tax', 12_000, 12_000, 0],
  ]);
  assert.deepEqual([r.accepted, r.differences, r.agreeing], [true, [], 7]);
  assert.equal(r.checks[4].label, 'Tax payable (Sales Tax Payable)');
});

test('an import that went wrong: every difference is named, with its amount', () => {
  const r = compareImport(readSourceTrialBalance(SOURCE), WRONG_CHART, WRONG);
  assert.deepEqual(r.differences.map(d => [d.label, d.sourceCents, d.ledgerCents, d.differenceCents, d.why]), [
    ['1200 Accounts Receivable', 150_000, 120_000, -30_000, 'balance differs'],
    ['2000 Accounts Payable', -80_000, -160_000, -80_000, 'balance differs'],
    ['3200 Opening Balance Equity', -525_000, -500_000, 25_000, 'balance differs'],
    ['4000 Project Revenue', -58_000, -28_000, 30_000, 'balance differs'],
    ['6100 Office Supplies', null, 80_000, 80_000, 'not in the source'],
    ['1050 Petty Cash (row 6)', 25_000, null, -25_000, `not in ${BRAND_NAME}`],
  ]);
  assert.deepEqual(r.checks.map(c => [c.key, c.sourceCents, c.ledgerCents, c.differenceCents]), [
    ['trial-balance', 675_000, 700_000, 25_000], ['ar', 150_000, 120_000, -30_000], ['ap', 80_000, 160_000, 80_000], ['cash', 500_000, 500_000, 0], ['tax', 12_000, 12_000, 0],
  ]);
  assert.deepEqual([r.accepted, r.agreeing], [false, 2]);
});

test('a source file that does not balance is a problem, never accepted', () => {
  const r = compareImport(readSourceTrialBalance(SOURCE.replace('"4000 Project Revenue","","580.00"', '"4000 Project Revenue","","570.00"').replace('"TOTAL","$6,750.00","$6,750.00"', '')), CHART, AGREES);
  assert.equal(r.accepted, false);
  assert.ok(r.problems.some(p => /does not balance: debits 6750\.00, credits 6740\.00/.test(p)), r.problems.join(' | '));
});

afterEach(() => cleanup());

test(`the screen: upload the source, read ${BRAND_NAME}'s trial balance on the date, name the differences`, async () => {
  setComponentWorkspace('viewer');
  useLedgerStore.setState({ accounts: WRONG_CHART } as never);
  const asked: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    asked.push(String(input));
    return new Response(JSON.stringify({ accounts: WRONG, totalDebit: 730_000, totalCredit: 730_000, isBalanced: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  render(<ImportAcceptanceView />);
  fireEvent.change(screen.getByLabelText('As of'), { target: { value: '2026-03-31' } });
  fireEvent.change(screen.getByLabelText('Source trial balance (CSV)'), { target: { files: [new File([SOURCE], 'qb-trial-balance.csv', { type: 'text/csv' })] } });
  const card = await waitFor(() => screen.getByTestId('import-acceptance'));
  assert.match(asked[0], /\/api\/v1\/reports\/trial-balance\?workspaceId=component-workspace&asOfDate=2026-03-31/);
  assert.match(within(card).getByRole('status').textContent || '', /Not accepted yet: 6 accounts differ/);
  const rows = within(card).getAllByRole('row').map(r => r.textContent || '');
  assert.ok(rows.some(t => t === 'Accounts receivable$1,500.00$1,200.00-$300.00'), rows.join(' | '));
  assert.ok(rows.some(t => t === 'Cash and bank$5,000.00$5,000.00agrees'), rows.join(' | '));
  assert.ok(rows.some(t => t === `1050 Petty Cash (row 6)not in ${BRAND_NAME}$250.00—-$250.00`), rows.join(' | '));
});
