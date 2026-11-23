/**
 * Audit RP-02 (reporting review, 22 Nov 2026), as acceptance tests: CSV exports write money in
 * the book currency's own minor-unit scale. The audit scenario: balanced synthetic JPY
 * (zero minor digits) entries of 100 minor units export as `100`, not `1.00`; KWD (three
 * minor digits) exports as `0.100`, not `1.00`. USD keeps two decimals.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAccountantPack } from '../lib/accountantExportPack';
import { agingTable, profitAndLossTable, reportCsv } from '../lib/scheduledReports';
import type { AccountantPackInput } from '../lib/accountantExportPack';
import type { ChartAccount, Transaction } from '../types';

const accounts = [
  { id: 'cash', name: 'Cash', type: 'asset' },
  { id: 'capital', name: 'Capital', type: 'equity' },
] as ChartAccount[];
const tx = {
  id: 't', date: '2026-06-01', status: 'completed',
  lines: [{ accountId: 'cash', amountCents: 100 }, { accountId: 'capital', amountCents: -100 }],
} as Transaction;

function packFor(currency: string) {
  return buildAccountantPack({
    workspaceName: `${currency} books`, currency, startDate: '2026-01-01', endDate: '2026-12-31',
    asOfDate: '2026-12-31', generatedAt: '2026-12-31',
    accounts, transactions: [tx], invoices: [], bills: [], customers: [], vendors: [],
  } as unknown as AccountantPackInput);
}

test('RP-02: accountant pack trial balance scales money by the book currency', () => {
  const jpy = packFor('JPY');
  const jpyTb = jpy.sections.find(s => s.key === 'trial-balance')!;
  const jpyMoney = jpyTb.rows.flatMap(r => [r[3], r[4]]).filter(v => v !== '' && v !== undefined && Number(v) !== 0) as string[];
  assert.deepEqual(jpyMoney, ['100', '100', '100', '100'], `JPY 100 minor units must export as 100: ${JSON.stringify(jpyTb.rows)}`);

  const kwd = packFor('KWD');
  const kwdTb = kwd.sections.find(s => s.key === 'trial-balance')!;
  const kwdMoney = kwdTb.rows.flatMap(r => [r[3], r[4]]).filter(v => v !== '' && v !== undefined && Number(v) !== 0) as string[];
  assert.deepEqual(kwdMoney, ['0.100', '0.100', '0.100', '0.100'], `KWD 100 minor units must export as 0.100: ${JSON.stringify(kwdTb.rows)}`);

  const usd = packFor('USD');
  const usdTb = usd.sections.find(s => s.key === 'trial-balance')!;
  const usdMoney = usdTb.rows.flatMap(r => [r[3], r[4]]).filter(v => v !== '' && v !== undefined && Number(v) !== 0) as string[];
  assert.deepEqual(usdMoney, ['1.00', '1.00', '1.00', '1.00'], `USD 100 cents must export as 1.00: ${JSON.stringify(usdTb.rows)}`);
});

test('RP-02: scheduled report CSV scales money by the book currency', () => {
  const table = profitAndLossTable(
    { income: { total: 100, accounts: {} }, cogs: { total: 0, accounts: {} }, expense: { total: 0, accounts: {} }, grossProfit: 100, netIncome: 100 },
    { key: 'M:2026-01', startDate: '2026-01-01', endDate: '2026-01-31', label: '2026-01' },
  );
  const jpy = reportCsv(table, 'JPY');
  assert.match(jpy, /100/, `JPY CSV must write 100: ${jpy}`);
  assert.doesNotMatch(jpy, /1\.00/, `JPY CSV must not write 1.00: ${jpy}`);
  const kwd = reportCsv(table, 'KWD');
  assert.match(kwd, /0\.100/, `KWD CSV must write 0.100: ${kwd}`);
  assert.doesNotMatch(kwd, /1\.00/, `KWD CSV must not write 1.00: ${kwd}`);
  const usd = reportCsv(table, 'USD');
  assert.match(usd, /1\.00/, `USD CSV must write 1.00: ${usd}`);
});

test('RP-02: a malformed workspace currency falls back to two decimals, not a broken export', () => {
  const table = agingTable([{ partyName: 'Acme', buckets: { current: 100, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 }, total: 100 }], [{ key: 'current', label: 'Current' }], { key: 'M:2026-01', startDate: '2026-01-01', endDate: '2026-01-31', label: '2026-01' });
  assert.match(reportCsv(table, 'XYZ'), /1\.00/, 'an unknown currency code must not throw or scale wrongly');
});
