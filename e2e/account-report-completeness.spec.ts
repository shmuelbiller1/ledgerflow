import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { parse } from 'csv-parse/sync';
import { mountJourney, setLedgerField } from './support/journeyFixture';

// Both posted entries arrived; just Rent is outside the chart page. Test the actual downloaded
// file, not only the displayed warning. The API is stubbed; the same route has Postgres tests.
const WORKSPACE = 'account-report-fixture';
const expense = (id: string, accountId: string, description: string, amountCents: number) => ({
  id, workspaceId: WORKSPACE, date: '2026-03-01', status: 'completed', type: 'journal', currency: 'USD',
  description, totalAmountCents: amountCents, lines: [{ accountId, amountCents }, { accountId: 'cash', amountCents: -amountCents }],
});
const rows = [expense('large', 'rent', 'Office lease', 200_000), expense('small', 'fuel', 'Fuel stop', 500)];
const serverRows = [
  { id: 'large-0', date: '2026-03-01', description: 'Office lease', accountName: 'Rent', amountCents: 200_000 },
  { id: 'small-0', date: '2026-03-01', description: 'Fuel stop', accountName: 'Fuel', amountCents: 500 },
];

test('Top Line Items: only a complete ranking can be downloaded, including after a refused full read', async ({ page }) => {
  let reads = 0;
  const { errors } = await mountJourney(page, {
    workspaceId: WORKSPACE,
    ledger: { accounts: [{ id: 'fuel', type: 'expense', name: 'Fuel' }, { id: 'cash', type: 'asset', name: 'Cash' }], transactions: rows },
    mounts: [{ module: '/src/components/reporting/TopExpensesIncomeReportView.tsx', props: { selectedYear: 2026 } }],
    api: ({ url }) => {
      if (!new URL(url).pathname.endsWith('/balances/top-lines')) return null;
      return ++reads === 1 ? { status: 503, json: {} } : { json: { topExpenses: serverRows, topIncome: [] } };
    },
  });
  await setLedgerField(page, 'truncatedCollections', { chartAccounts: true });
  const csv = page.getByRole('button', { name: 'Export CSV' });
  const retry = page.getByRole('button', { name: 'Load the full report' });
  await expect(retry).toBeVisible();
  await expect(page.getByText('Fuel stop')).toBeVisible(); // labelled preview is still useful
  await expect(csv).toHaveCount(0);
  await retry.click();
  await expect(page.getByText('Office lease')).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), csv.click()]);
  expect(download.suggestedFilename()).toBe('top-expenses.csv');
  const data = parse(await readFile((await download.path())!), { bom: true });
  expect(data).toEqual([
    ['Date', 'Description', 'Payee', 'Account / Category', 'Amount'],
    ['2026-03-01', 'Office lease', '', 'Rent', '2000.00'],
    ['2026-03-01', 'Fuel stop', '', 'Fuel', '5.00'],
  ]);
  expect(reads).toBe(2);
  expect(errors).toEqual([]);
});
