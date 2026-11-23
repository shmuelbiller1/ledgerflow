/**
 * MU-01 / IM-01: amounts are scaled by the currency's ISO 4217 minor-unit exponent, not a fixed
 * ×100. Audit scenario (PR #1002, `camt053-minor-units.test.ts`, `minor-unit-inputs-ui.test.tsx`)
 * with the assertions inverted to the correct accounting result.
 *
 * - CAMT.053 `<Amt Ccy="JPY">10000</Amt>` is ¥10,000 = 10,000 minor units (was 1,000,000)
 * - CAMT.053 `<Amt Ccy="KWD">100.125</Amt>` is KWD 100.125 = 100,125 fils (was 10,013)
 * - OpeningBalancesSetup typed "1000000" in a JPY workspace posts 1,000,000 minor units
 *   (was 100,000,000); typed "1000.125" in a KWD workspace posts 1,000,125 fils (was 100,013)
 * - LoansView typed JPY principal "1000000" saves principalCents 1,000,000 (was 100,000,000)
 */
import './helpers/dom';
import { stubFetchWithBodies } from './helpers/dom';
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { parseCamt053Statement } from '../lib/camt053Parser';
import { formatMoney, parseAmountToCents, readAmountCents } from '../lib/moneyFormat';
import OpeningBalancesSetup from '../components/onboarding/OpeningBalancesSetup';
import LoansView from '../components/finance/LoansView';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { makeChartAccount } from './fixtures';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';
import { getSupabase } from '../lib/db/client';

test('MU-01: parseAmountToCents scales by the currency minor-unit exponent', () => {
  assert.equal(parseAmountToCents('1000000', { currency: 'JPY' }), 1_000_000, 'JPY: whole yen, no ×100');
  assert.equal(parseAmountToCents('1000.125', { currency: 'KWD' }), 1_000_125, 'KWD: fils, no ÷10');
  assert.equal(parseAmountToCents('12.345', { currency: 'KWD' }), 12_345);
  assert.equal(parseAmountToCents('12.34'), 1234, 'no currency: the two-decimal books convention stays');
  assert.equal(parseAmountToCents('(12.34'), -1234);
  assert.equal(readAmountCents('1000000', { currency: 'JPY' }), 1_000_000);
  assert.equal(readAmountCents('1000.125', { currency: 'KWD' }), 1_000_125);
  assert.equal(formatMoney(10_000, 'JPY', { locale: 'en-US' }), '¥10,000');
  assert.equal(formatMoney(100_125, 'KWD', { locale: 'en-US' }), 'KWD 100.125');
});

test('IM-01: the CAMT.053 parser scales JPY and KWD by their minor-unit exponent', () => {
  const xml = `
    <Document>
      <BkToCstmrStmt>
        <Stmt>
          <Ntry>
            <Amt Ccy="JPY">10000</Amt>
            <CdtDbtInd>CRDT</CdtDbtInd>
            <BookgDt><Dt>2026-05-10</Dt></BookgDt>
            <NtryDtls><TxDtls><RmtInf><Ustrd>Tokyo customer wire</Ustrd></RmtInf></TxDtls></NtryDtls>
          </Ntry>
          <Ntry>
            <Amt Ccy="KWD">100.125</Amt>
            <CdtDbtInd>CRDT</CdtDbtInd>
            <BookgDt><Dt>2026-05-11</Dt></BookgDt>
            <NtryDtls><TxDtls><RmtInf><Ustrd>Kuwait settlement</Ustrd></RmtInf></TxDtls></NtryDtls>
          </Ntry>
          <Ntry>
            <Amt Ccy="USD">123.45</Amt>
            <CdtDbtInd>DBIT</CdtDbtInd>
            <BookgDt><Dt>2026-05-12</Dt></BookgDt>
            <NtryDtls><TxDtls><RmtInf><Ustrd>Two-decimal entry</Ustrd></RmtInf></TxDtls></NtryDtls>
          </Ntry>
        </Stmt>
      </BkToCstmrStmt>
    </Document>
  `;
  const lines = parseCamt053Statement(xml);
  assert.equal(lines.length, 3);
  assert.equal(lines[0].currency, 'JPY');
  assert.equal(lines[0].amountCents, 10_000, '¥10,000 = 10,000 minor units');
  assert.equal(lines[0].type, 'credit');
  assert.equal(lines[1].currency, 'KWD');
  assert.equal(lines[1].amountCents, 100_125, 'KWD 100.125 = 100,125 fils');
  assert.equal(lines[2].currency, 'USD');
  assert.equal(lines[2].amountCents, -12_345, 'USD keeps cents; DBIT is negative');
  assert.equal(formatMoney(lines[0].amountCents, lines[0].currency, { locale: 'en-US' }), '¥10,000');
  assert.equal(formatMoney(lines[1].amountCents, lines[1].currency, { locale: 'en-US' }), 'KWD 100.125');
});

test('MU-01: OpeningBalancesSetup posts typed amounts at the workspace currency minor units', async () => {
  try {
    const accounts = [
      makeChartAccount({ id: 'bank', code: '1010', name: 'Checking', type: 'asset', category: 'Cash' }),
      makeChartAccount({ id: 'obe', code: '3900', name: 'Opening Balance Equity', type: 'equity', subtype: 'opening_balance_equity' } as never),
    ];
    setComponentWorkspace('owner');
    const auth = useAuthStore.getState();
    auth.setWorkspaces(auth.workspaces.map(w => ({ ...w, currency: 'JPY' })));
    useLedgerStore.setState({ accounts });
    const jpyCalls = stubFetchWithBodies(200, { debitsCents: 1_000_000 });
    render(<OpeningBalancesSetup onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/Checking/), { target: { value: '1000000' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Record opening balances' })); });
    await waitFor(() => assert.ok(jpyCalls.some(c => c.url.endsWith('/opening-balances') && c.method === 'POST')));
    const jpyBody = jpyCalls.find(c => c.url.endsWith('/opening-balances'))!.body as { balances: Array<{ accountId: string; amountCents: number }> };
    assert.deepEqual(jpyBody.balances, [{ accountId: 'bank', amountCents: 1_000_000 }]);
    cleanup();

    auth.setWorkspaces(auth.workspaces.map(w => ({ ...w, currency: 'KWD' })));
    useLedgerStore.setState({ accounts });
    const kwdCalls = stubFetchWithBodies(200, { debitsCents: 1_000_125 });
    render(<OpeningBalancesSetup onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/Checking/), { target: { value: '1000.125' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Record opening balances' })); });
    await waitFor(() => assert.ok(kwdCalls.some(c => c.url.endsWith('/opening-balances') && c.method === 'POST')));
    const kwdBody = kwdCalls.find(c => c.url.endsWith('/opening-balances'))!.body as { balances: Array<{ accountId: string; amountCents: number }> };
    assert.deepEqual(kwdBody.balances, [{ accountId: 'bank', amountCents: 1_000_125 }]);
  } finally {
    cleanup();
    await getSupabase().auth.dispose();
  }
});

test('MU-01: LoansView saves a typed JPY principal at the JPY minor units', async () => {
  try {
    setComponentWorkspace('owner');
    const auth = useAuthStore.getState();
    auth.setWorkspaces(auth.workspaces.map(w => ({ ...w, currency: 'JPY' })));
    const accounts = [
      makeChartAccount({ id: 'bank', code: '1010', name: 'Checking', type: 'asset', category: 'Cash' }),
      makeChartAccount({ id: 'loan', code: '2500', name: 'Bank Loan', type: 'liability', category: 'Long-term Liabilities' }),
      makeChartAccount({ id: 'interest', code: '6100', name: 'Interest Expense', type: 'expense', category: 'Expenses' }),
    ];
    markComponentCollectionsLoaded('loans');
    useLedgerStore.setState({ accounts, loans: [], transactions: [] });
    const calls = stubFetchWithBodies(200, { ok: true, data: { id: 'loan-jpy' } });
    render(<LoansView />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Add a loan' })[0]);
    fireEvent.change(screen.getByLabelText('Lender'), { target: { value: 'Tokyo Bank' } });
    fireEvent.change(screen.getByLabelText('Principal'), { target: { value: '1000000' } });
    fireEvent.change(screen.getByLabelText('Rate (% a year)'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Loan (liability) account'), { target: { value: 'loan' } });
    fireEvent.change(screen.getByLabelText('Interest expense account'), { target: { value: 'interest' } });
    fireEvent.change(screen.getByLabelText('Bank the money comes to'), { target: { value: 'bank' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save the loan' })); });
    await waitFor(() => assert.ok(calls.some(c => c.method === 'POST')));
    const post = calls.find(c => c.method === 'POST')!.body as { input?: { data?: { principalCents?: number; currency?: string } } };
    assert.equal(post.input?.data?.currency, 'JPY');
    assert.equal(post.input?.data?.principalCents, 1_000_000, '¥1,000,000 = 1,000,000 minor units');
  } finally {
    cleanup();
    await getSupabase().auth.dispose();
  }
});
