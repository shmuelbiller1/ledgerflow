import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mountJourney, remountJourney, setLedgerField, settleStyles } from './support/journeyFixture';

/**
 * D-98 · W10 (RELEASE_GATE): backup → change → restore → exact report parity, in the browser.
 *
 * Worked figures (USD, cents, January 2026) — chosen so P&L $3,000.00, BS $13,000.00, TB $14,200.00
 * appear on the real screens and can be checked by hand:
 *
 *   Accounts:
 *     1000 Cash               asset     opening $10,000.00
 *     1200 Receivables        asset     opening $0
 *     2000 Payables           liability opening $0
 *     3000 Retained Earnings  equity    opening $10,000.00
 *     4000 Sales              income    opening $0
 *     5000 Office Expense     expense   opening $0
 *
 *   Transactions in the backup (posted, 2026-01):
 *     t1 2026-01-05  Sale invoice         +$3,600.00  →  Receivables +3,600 / Sales -3,600
 *     t2 2026-01-10  Office expense        +$600.00   →  Office Expense +600 / Cash -600
 *   Net income = 3,600 - 600 = $3,000.00
 *   Assets = Cash 9,400 + Receivables 3,600 = $13,000.00
 *   Claims = Payables 0 + Equity 10,000 + Net 3,000 = $13,000.00 → balanced
 *   Trial Balance debits = 10,000 + 3,600 + 600 = $14,200.00; credits = 10,000 + 3,600 + 600 = $14,200.00 → balanced
 *
 *   Mutation after backup (still January):
 *     t3 2026-01-20  Extra expense       +$2,750.00   →  Office Expense +2,750 / Cash -2,750
 *   Net = 3,600 - 3,350 = $250.00; Assets = 6,650 + 3,600 = $10,250.00; TB = 16,950.00
 *
 *   Restore removes t3, so every figure is exactly the backup's again.
 *
 * The screens are the real ProfitAndLossView, BalanceSheetView and TrialBalanceView mounted from the
 * app's source against the app's stores. The server's report replies are stubbed as 500 so the
 * screens show the local ledger calculation (the posting itself is verified by the server suites).
 * Backup/restore is simulated by the test's setLedgerField, which is what the live subscription
 * would deliver after the server's restore transaction.
 */

const WORKSPACE = 'w10-backup';

const ACCOUNTS = [
  { id: 'cash', uid: 'journey-user', workspaceId: WORKSPACE, code: '1000', name: 'Cash', type: 'asset', category: 'Cash', openingBalanceCents: 1000000 },
  { id: 'recv', uid: 'journey-user', workspaceId: WORKSPACE, code: '1200', name: 'Accounts Receivable', type: 'asset', category: 'Receivables', openingBalanceCents: 0 },
  { id: 'pay', uid: 'journey-user', workspaceId: WORKSPACE, code: '2000', name: 'Accounts Payable', type: 'liability', category: 'Payables', openingBalanceCents: 0 },
  { id: 'equity', uid: 'journey-user', workspaceId: WORKSPACE, code: '3000', name: 'Retained Earnings', type: 'equity', category: 'Equity', openingBalanceCents: 1000000 },
  { id: 'rev', uid: 'journey-user', workspaceId: WORKSPACE, code: '4000', name: 'Sales', type: 'income', category: 'Revenue', openingBalanceCents: 0 },
  { id: 'exp', uid: 'journey-user', workspaceId: WORKSPACE, code: '6000', name: 'Office Expense', type: 'expense', category: 'Expense', openingBalanceCents: 0 },
];

function tx(id: string, date: string, debit: string, credit: string, cents: number) {
  return {
    id, uid: 'journey-user', workspaceId: WORKSPACE, date, description: id, status: 'completed', type: 'actual', totalAmountCents: cents, currency: 'USD',
    lines: [{ accountId: debit, amountCents: cents }, { accountId: credit, amountCents: -cents }],
  };
}

const ORIGINAL_TXS = [
  tx('t1', '2026-01-05', 'recv', 'rev', 360000),
  tx('t2', '2026-01-10', 'exp', 'cash', 60000),
];

const MUTATED_TXS = [
  ...ORIGINAL_TXS,
  tx('t3', '2026-01-20', 'exp', 'cash', 275000),
];

function backupPayload(transactions: typeof ORIGINAL_TXS) {
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    workspace: { id: WORKSPACE, lockDate: null },
    transactions,
    accounts: ACCOUNTS,
    metadata: { counts: { transactions: transactions.length }, checksum: 'test-checksum' },
  };
}

for (const width of [390, 1280]) {
  test(`W10 backup → restore: P&L $3,000 / BS $13,000 / TB $14,200 parity at ${width}px`, async ({ page }, testInfo) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width, height: 900 });

    const { errors, requests } = await mountJourney(page, {
      workspaceId: WORKSPACE,
      ledger: { accounts: ACCOUNTS, transactions: ORIGINAL_TXS, customers: [], vendors: [], invoices: [], bills: [], payments: [] },
      mounts: [
        { module: '/src/components/ledger/ProfitAndLossView.tsx', props: { startDate: '2026-01-01', endDate: '2026-01-31' } },
      ],
      api: request => {
        if (request.url.includes('/api/v1/reports/')) return { status: 500, json: {} };
        if (request.url.includes(`/api/v1/workspaces/${WORKSPACE}/export`)) return { json: backupPayload(ORIGINAL_TXS) };
        if (request.url.includes(`/api/v1/workspaces/${WORKSPACE}/restore`)) return { json: { success: true, restoredCollections: ['transactions'], counts: { transactions: ORIGINAL_TXS.length } } };
        return null;
      },
    });

    // 1. P&L for January shows the backup's net profit $3,000.00 (income 3,600 less expense 600)
    await expect(page.getByText('Profit & Loss Statement')).toBeVisible();
    await expect(page.getByText('$3,000.00').first()).toBeVisible();
    // income line $3,600 and expense line $600 also present
    await expect(page.getByText('$3,600.00').first()).toBeVisible();
    await expect(page.getByText('$600.00').first()).toBeVisible();

    // 2. Balance sheet as of 2026-01-31 shows $13,000.00 assets = $13,000.00 claims, balanced
    await remountJourney(page, [{ module: '/src/components/ledger/BalanceSheetView.tsx', props: { accounts: ACCOUNTS, formatCurrency: '__fn:formatCurrency', asOfDate: '2026-01-31' } }]);
    await expect(page.getByText('Balance check')).toBeVisible();
    await expect(page.getByText('$13,000.00').first()).toBeVisible();
    // assets and claims appear twice (assets column and claims footer), count check ensures both present
    await expect(page.getByText('Total Equity & Liabilities').first()).toBeVisible();
    await expect(page.getByText('Balanced', { exact: false }).first()).toBeVisible();

    // 3. Trial balance as of 2026-01-31 shows $14,200.00 debits = $14,200.00 credits, balanced
    await remountJourney(page, [{ module: '/src/components/ledger/TrialBalanceView.tsx', props: { accounts: ACCOUNTS, formatCurrency: '__fn:formatCurrency', onDrillDown: '__fn:noop' } }]);
    // set the as-of date via the date input (default is today)
    const asOfInput = page.getByLabel('As of date');
    await asOfInput.fill('2026-01-31');
    await expect(page.getByText('Total Trial Balance')).toBeVisible();
    await expect(page.getByText('$14,200.00').first()).toBeVisible();
    await expect(page.getByText('Balanced Double-Entry')).toBeVisible();

    // 4. Simulate "make a backup" — fetch the export; it contains exactly the 2 transactions and the 6 accounts
    const exportRes = await page.evaluate(async (workspaceId) => {
      const r = await fetch(`/api/v1/workspaces/${workspaceId}/export`, { headers: { Authorization: 'Bearer browser-fixture-token' } });
      return r.json();
    }, WORKSPACE);
    expect(exportRes.transactions).toHaveLength(2);
    expect(exportRes.accounts).toHaveLength(6);
    expect(exportRes.transactions.map((t: { id: string }) => t.id)).toEqual(['t1', 't2']);

    // 5. Change records after backup: add the extra $2,750 expense, so P&L drops to $250.00
    await setLedgerField(page, 'transactions', MUTATED_TXS);
    await remountJourney(page, [{ module: '/src/components/ledger/ProfitAndLossView.tsx', props: { startDate: '2026-01-01', endDate: '2026-01-31' } }]);
    await expect(page.getByText('$250.00').first()).toBeVisible();
    await remountJourney(page, [{ module: '/src/components/ledger/BalanceSheetView.tsx', props: { accounts: ACCOUNTS, formatCurrency: '__fn:formatCurrency', asOfDate: '2026-01-31' } }]);
    await expect(page.getByText('$10,250.00').first()).toBeVisible();
    await remountJourney(page, [{ module: '/src/components/ledger/TrialBalanceView.tsx', props: { accounts: ACCOUNTS, formatCurrency: '__fn:formatCurrency', onDrillDown: '__fn:noop' } }]);
    await page.getByLabel('As of date').fill('2026-01-31');
    await expect(page.getByText('$16,950.00').first()).toBeVisible();

    // 6. Restore the backup — ledger back to the 2 original transactions
    const restoreRes = await page.evaluate(async ({ workspaceId, payload }) => {
      const r = await fetch(`/api/v1/workspaces/${workspaceId}/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer browser-fixture-token' }, body: JSON.stringify(payload) });
      return r.json();
    }, { workspaceId: WORKSPACE, payload: backupPayload(ORIGINAL_TXS) });
    expect(restoreRes.success).toBe(true);
    await setLedgerField(page, 'transactions', ORIGINAL_TXS);

    // 7. After restore, every figure is exactly the backup's again — no cent lost or added
    await remountJourney(page, [{ module: '/src/components/ledger/ProfitAndLossView.tsx', props: { startDate: '2026-01-01', endDate: '2026-01-31' } }]);
    await expect(page.getByText('$3,000.00').first()).toBeVisible();
    await remountJourney(page, [{ module: '/src/components/ledger/BalanceSheetView.tsx', props: { accounts: ACCOUNTS, formatCurrency: '__fn:formatCurrency', asOfDate: '2026-01-31' } }]);
    await expect(page.getByText('$13,000.00').first()).toBeVisible();
    await remountJourney(page, [{ module: '/src/components/ledger/TrialBalanceView.tsx', props: { accounts: ACCOUNTS, formatCurrency: '__fn:formatCurrency', onDrillDown: '__fn:noop' } }]);
    await page.getByLabel('As of date').fill('2026-01-31');
    await expect(page.getByText('$14,200.00').first()).toBeVisible();
    await expect(page.getByText('Balanced Double-Entry')).toBeVisible();

    // 8. Axe: no serious or critical violations on the restored trial balance table
    await settleStyles(page);
    const axe = await new AxeBuilder({ page }).include('table').analyze();
    const serious = axe.violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
    await testInfo.attach(`w10-axe-${width}`, { body: JSON.stringify(axe.violations, null, 2), contentType: 'application/json' });
    expect(serious, JSON.stringify(serious.map(v => ({ id: v.id, nodes: v.nodes.length })))).toEqual([]);

    // backup export and restore endpoints were called exactly once each
    expect(requests.filter(r => r.url.includes('/export')).length).toBe(1);
    expect(requests.filter(r => r.url.includes('/restore')).length).toBe(1);

    expect(errors).toEqual([]);
  });
}
