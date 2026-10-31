/**
 * AF-001 (CSV path of Bank Feed Import): the other side of each imported row is booked to the bank
 * account the person chose, never to a placeholder id; with no bank account in the books, nothing is
 * imported. Proved at the import callback, the dialog's write boundary (Codex on #457).
 */
import './helpers/dom';
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import BankFeedImport from '../components/ledger/BankFeedImport';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { makeChartAccount } from './fixtures';
import { getSupabase } from '../lib/db/client';

const rows = [{ id: 'r1', date: '2026-10-20', description: 'Coffee', amountCents: -450 }];

beforeEach(() => {
  setComponentWorkspace('owner');
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    // the upload answers with the parsed rows; the rule and history reads (database rows) answer with none
    const body = String(input).includes('/api/upload-bank-csv') ? rows : [];
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
});
// the rule and history reads open the database client: close it so the test run can exit
afterEach(async () => { cleanup(); getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });

async function stageCsv() {
  const input = screen.getByLabelText('Upload bank statement') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(['date,amount\n'], 'statement.csv', { type: 'text/csv' })] } });
  fireEvent.click(await screen.findByRole('button', { name: /process|upload|analy/i }));
  await screen.findByRole('button', { name: 'Import selected rows' });
  // the row is staged, so a disabled import can only come from the bank account
  await screen.findByText('Coffee');
}

test('the bank line goes to the bank account the person chose', async () => {
  const accounts = [
    makeChartAccount({ id: 'checking', name: 'Business Checking', type: 'asset', category: 'Cash' }),
    makeChartAccount({ id: 'savings', name: 'Savings', type: 'asset', category: 'Cash' }),
    makeChartAccount({ id: 'meals', name: 'Meals', type: 'expense', category: 'Meals' }),
  ];
  const imported: Array<Array<{ lines: Array<{ accountId: string; accountName: string; amountCents: number }> }>> = [];
  render(<BankFeedImport workspaceId="component-workspace" accounts={accounts} onImport={tx => imported.push(tx as never)} onClose={() => {}} />);
  await stageCsv();
  const picker = screen.getByLabelText(/Bank account/i) as HTMLSelectElement;
  assert.equal(picker.value, 'checking', 'the first bank account is pre-selected');
  fireEvent.change(picker, { target: { value: 'savings' } });
  await waitFor(() => assert.equal((screen.getByRole('button', { name: 'Import selected rows' }) as HTMLButtonElement).disabled, false));
  fireEvent.click(screen.getByRole('button', { name: 'Import selected rows' }));
  assert.equal(imported.length, 1);
  const bankLine = imported[0][0].lines[1];
  assert.deepEqual([bankLine.accountId, bankLine.accountName, bankLine.amountCents], ['savings', 'Savings', 450]);
  assert.equal(imported[0][0].lines.some(l => l.accountId === 'offset-bank'), false);
});

test('with no bank account in the books, nothing is imported', async () => {
  const accounts = [makeChartAccount({ id: 'meals', name: 'Meals', type: 'expense', category: 'Meals' })];
  let calls = 0;
  render(<BankFeedImport workspaceId="component-workspace" accounts={accounts} onImport={() => { calls += 1; }} onClose={() => {}} />);
  await stageCsv();
  const button = screen.getByRole('button', { name: 'Import selected rows' }) as HTMLButtonElement;
  assert.equal(button.disabled, true);
  fireEvent.click(button);
  assert.equal(calls, 0);
});
