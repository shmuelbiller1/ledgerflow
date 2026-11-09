import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import { mountJourney, remountJourney, setLedgerField, settleStyles } from './support/journeyFixture';
import { expectNoNewAccessibilityIssues } from './support/a11yGate';

/**
 * D-98 · W10 (RELEASE_GATE): backup → change records → restore → the P&L, balance sheet and trial
 * balance are exactly what they were before the change, in the browser, on phone and desktop.
 *
 * This journey uses the real Settings → Backup & Export screen (`BackupExportSettings.tsx`):
 *  - "Export JSON Backup" downloads the backup file from the server export;
 *  - "Restore backup file" reads that same file back, checks its SHA-256 checksum and uploads it.
 * Only the server's HTTP boundary is stubbed (the export body, the restore reply and the report
 * endpoints); the client code that builds the file, verifies the checksum and posts it is the
 * app's own. The server's own restore transaction is covered by `src/tests/backup-restore.test.ts`
 * and `src/server/services/workspaceRestoreService`.
 *
 * Worked figures (USD cents, January 2026) — every one can be checked by hand:
 *
 *   Accounts (opening balances):
 *     1000 Cash               asset     1,000,000c ($10,000.00)
 *     1200 Receivables        asset             0
 *     2000 Payables           liability         0
 *     3000 Retained Earnings  equity    1,000,000c ($10,000.00)
 *     4000 Sales              income            0
 *     6000 Office Expense     expense           0
 *
 *   In the backup (posted, January 2026):
 *     t1 2026-01-05  sale            Receivables +3,600.00 / Sales -3,600.00
 *     t2 2026-01-10  office expense  Office Expense +600.00 / Cash -600.00
 *
 *   Before the change (the backup's own figures):
 *     P&L        income 3,600.00 − expense 600.00                = net $3,000.00
 *     Balance sheet  assets Cash 9,400.00 + Receivables 3,600.00 = $13,000.00
 *                    claims equity 10,000.00 + profit 3,000.00   = $13,000.00 → balanced
 *     Trial balance  debits  Cash 9,400 + Receivables 3,600 + Office Expense 600 = $13,600.00
 *                    credits equity 10,000 + Sales 3,600                          = $13,600.00
 *
 *   After the change (still January): t3 2026-01-20 expense $2,750.00 → Office Expense / Cash
 *     P&L        income 3,600.00 − expense 3,350.00 = net $250.00
 *     Balance sheet  Cash 6,650.00 + Receivables 3,600.00 = $10,250.00
 *                    claims 10,000.00 + 250.00           = $10,250.00 → balanced
 *     Trial balance  Cash 6,650.00, Office Expense 3,350.00 (the total stays $13,600.00, because
 *                    posting an expense moves money between two accounts, it does not create it)
 *
 *   Restoring the backup removes t3, so every figure is the backup's again.
 */

const WORKSPACE = 'w10-backup';
const USER = { uid: 'journey-user', email: 'owner@example.test', displayName: 'Journey Owner' };

type Account = {
  id: string; uid: string; workspaceId: string; code: string; name: string;
  type: string; category: string; openingBalanceCents: number;
};

const ACCOUNTS: Account[] = [
  { id: 'cash', uid: USER.uid, workspaceId: WORKSPACE, code: '1000', name: 'Cash', type: 'asset', category: 'Cash', openingBalanceCents: 1000000 },
  { id: 'recv', uid: USER.uid, workspaceId: WORKSPACE, code: '1200', name: 'Accounts Receivable', type: 'asset', category: 'Receivables', openingBalanceCents: 0 },
  { id: 'pay', uid: USER.uid, workspaceId: WORKSPACE, code: '2000', name: 'Accounts Payable', type: 'liability', category: 'Payables', openingBalanceCents: 0 },
  { id: 'equity', uid: USER.uid, workspaceId: WORKSPACE, code: '3000', name: 'Retained Earnings', type: 'equity', category: 'Equity', openingBalanceCents: 1000000 },
  { id: 'rev', uid: USER.uid, workspaceId: WORKSPACE, code: '4000', name: 'Sales', type: 'income', category: 'Revenue', openingBalanceCents: 0 },
  { id: 'exp', uid: USER.uid, workspaceId: WORKSPACE, code: '6000', name: 'Office Expense', type: 'expense', category: 'Expense', openingBalanceCents: 0 },
];

type Tx = {
  id: string; uid: string; workspaceId: string; date: string; description: string;
  status: string; type: string; totalAmountCents: number; currency: string;
  lines: Array<{ accountId: string; amountCents: number }>;
};

function tx(id: string, date: string, description: string, debitAccount: string, creditAccount: string, cents: number): Tx {
  return {
    id, uid: USER.uid, workspaceId: WORKSPACE, date, description, status: 'completed', type: 'actual',
    totalAmountCents: cents, currency: 'USD',
    lines: [{ accountId: debitAccount, amountCents: cents }, { accountId: creditAccount, amountCents: -cents }],
  };
}

const BACKUP_TXS: Tx[] = [
  tx('t1', '2026-01-05', 'Sale to Acme', 'recv', 'rev', 360000),
  tx('t2', '2026-01-10', 'Office rent', 'exp', 'cash', 60000),
];

/** The backup as it was before the change, plus the extra expense recorded afterwards. */
const CHANGED_TXS: Tx[] = [...BACKUP_TXS, tx('t3', '2026-01-20', 'Extra office cost', 'exp', 'cash', 275000)];

const sha256 = (text: string) => createHash('sha256').update(new TextEncoder().encode(text)).digest('hex');

/**
 * The server export body, in the shape `workspaceRestoreService` accepts: a schema version, the
 * collections, and a checksum over everything except itself. The key order matters — the client
 * deletes `checksum` and re-hashes the rest, so this is exactly what it will re-hash.
 */
function backupPayload(transactions: Tx[]) {
  const body = {
    schemaVersion: 1,
    exportedAt: '2026-02-01T00:00:00.000Z',
    workspace: { id: WORKSPACE, name: 'Journey Books', currency: 'USD', lockDate: null },
    transactions,
    accounts: ACCOUNTS,
    metadata: {
      transactionCount: transactions.length,
      totalCount: transactions.length,
      currency: 'USD',
      serverAuthoritative: true,
    },
  };
  return { ...body, metadata: { ...body.metadata, checksum: sha256(JSON.stringify(body)) } };
}

/** The checksum a restored file must carry: over the file without its own `metadata.checksum`. */
function fileChecksum(fileText: string): string {
  const parsed = JSON.parse(fileText) as { metadata?: Record<string, unknown> };
  if (parsed.metadata) delete parsed.metadata.checksum;
  return sha256(JSON.stringify(parsed));
}

const BACKUP_SCREEN = { module: '/src/components/platform/settings/BackupExportSettings.tsx' };

async function mountBackupScreen(page: Page, ledger: Tx[]) {
  await mountJourney(page, {
    workspaceId: WORKSPACE,
    ledger: { accounts: ACCOUNTS, transactions: ledger, customers: [], vendors: [], invoices: [], bills: [], payments: [] },
    mounts: [BACKUP_SCREEN],
    api: request => {
      // the reports fall back to the ledger the app already has (BUG-02 fallback path)
      if (request.url.includes('/api/v1/reports/')) return { status: 500, json: {} };
      if (request.url.includes(`/api/v1/workspaces/${WORKSPACE}/export`)) return { json: backupPayload(ledger) };
      if (request.url.includes(`/api/v1/workspaces/${WORKSPACE}/restore`)) {
        return { json: { success: true, message: 'Workspace restored from the backup file.', counts: { transactions: ledger.length } } };
      }
      return null;
    },
  });
}

async function exportBackup(page: Page): Promise<string> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Export JSON Backup/ }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^ledgerflow-backup-w10-backup-\d{4}-\d{2}-\d{2}\.json$/);
  const path = await download.path();
  expect(path, 'the browser download must land on disk').toBeTruthy();
  return fs.readFileSync(path!, 'utf8');
}

async function restoreBackup(page: Page, fileText: string) {
  const restoreRequest = page.waitForRequest(request => request.url().includes('/restore') && request.method() === 'POST');
  await page.locator('input[aria-label="Restore backup file"]').setInputFiles({
    name: 'ledgerflow-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(fileText, 'utf8'),
  });
  return restoreRequest;
}

async function showProfitAndLoss(page: Page) {
  await remountJourney(page, [{ module: '/src/components/ledger/ProfitAndLossView.tsx', props: { startDate: '2026-01-01', endDate: '2026-01-31' } }]);
  await expect(page.getByText('Profit & Loss Statement')).toBeVisible();
}

async function showBalanceSheet(page: Page) {
  await remountJourney(page, [{ module: '/src/components/ledger/BalanceSheetView.tsx', props: { accounts: ACCOUNTS, formatCurrency: '__fn:formatCurrency', asOfDate: '2026-01-31' } }]);
  await expect(page.getByText('Total Equity & Liabilities').first()).toBeVisible();
}

async function showTrialBalance(page: Page) {
  await remountJourney(page, [{ module: '/src/components/ledger/TrialBalanceView.tsx', props: { accounts: ACCOUNTS, formatCurrency: '__fn:formatCurrency', onDrillDown: '__fn:noop' } }]);
  await page.getByLabel('As of date').fill('2026-01-31');
  await expect(page.getByText('Total Trial Balance')).toBeVisible();
}

/** The whole row of one account on the trial balance: its code, name, and its debit and credit. */
function trialBalanceRow(page: Page, code: string) {
  return page.locator('tr', { has: page.getByText(code, { exact: true }) });
}

for (const width of [390, 1280]) {
  test(`W10 backup → change → restore keeps every report figure at ${width}px`, async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: 900 });

    // every restore upload the app makes, watched at the browser level so it is counted across remounts
    const restoreUploads: string[] = [];
    const pageErrors: string[] = [];
    page.on('request', request => {
      if (request.method() === 'POST' && request.url().includes('/restore')) restoreUploads.push(request.postData() ?? '');
    });
    page.on('pageerror', error => pageErrors.push(error.message));

    // ---------------------------------------------------------------- 1. make the backup
    await mountBackupScreen(page, BACKUP_TXS);
    await expect(page.getByRole('heading', { name: 'Backup & Export' })).toBeVisible();
    const backupFile = await exportBackup(page);

    const exported = JSON.parse(backupFile) as { transactions: Tx[]; accounts: Account[]; metadata: { checksum: string } };
    expect(exported.transactions.map(t => t.id)).toEqual(['t1', 't2']);
    expect(exported.accounts).toHaveLength(6);
    // the file checksums itself: what the app will verify on restore
    expect(exported.metadata.checksum).toBe(fileChecksum(backupFile));

    // ---------------------------------------------------------------- 2. the reports of that backup
    await showProfitAndLoss(page);
    await expect(page.getByText('$3,600.00').first()).toBeVisible();   // income
    await expect(page.getByText('$600.00').first()).toBeVisible();     // office expense
    await expect(page.getByText('$3,000.00').first()).toBeVisible();   // net profit

    await showBalanceSheet(page);
    await expect(page.getByText('$13,000.00').first()).toBeVisible();  // assets = claims
    await expect(page.getByText('Balanced', { exact: false }).first()).toBeVisible();

    await showTrialBalance(page);
    await expect(trialBalanceRow(page, '1000')).toContainText('$9,400.00');    // cash after the rent
    await expect(trialBalanceRow(page, '6000')).toContainText('$600.00');      // office expense
    await expect(page.getByText('$13,600.00').first()).toBeVisible();          // debits = credits
    await expect(page.getByText('Balanced Double-Entry')).toBeVisible();

    // ---------------------------------------------------------------- 3. change records after the backup
    await setLedgerField(page, 'transactions', CHANGED_TXS);

    await showProfitAndLoss(page);
    await expect(page.getByText('$250.00').first()).toBeVisible();     // 3,600 − 3,350
    await showBalanceSheet(page);
    await expect(page.getByText('$10,250.00').first()).toBeVisible();  // 6,650 + 3,600
    await showTrialBalance(page);
    await expect(trialBalanceRow(page, '1000')).toContainText('$6,650.00');
    await expect(trialBalanceRow(page, '6000')).toContainText('$3,350.00');
    // a change is visible in the two rows above and nowhere in the totals: the extra expense moved
    // money between two accounts, it did not create any
    await expect(page.getByText('$13,600.00').first()).toBeVisible();

    // ---------------------------------------------------------------- 4. restore the file the test downloaded
    await mountBackupScreen(page, CHANGED_TXS);       // the app after the change
    await expect(page.getByRole('heading', { name: 'Backup & Export' })).toBeVisible();
    const restoreRequest = await restoreBackup(page, backupFile);
    const sent = JSON.parse(restoreRequest.postData() || '{}') as { transactions?: Tx[]; metadata?: { checksum?: string } };
    expect(restoreUploads.length).toBeGreaterThanOrEqual(1);
    // the client uploads the file it read, checksum verified first — untouched
    expect(sent.metadata?.checksum).toBe(exported.metadata.checksum);
    expect(sent.transactions?.map(t => t.id)).toEqual(['t1', 't2']);
    expect(restoreRequest.postData()).toBe(backupFile);

    // the restore transaction removes t3; the live subscription delivers the restored ledger
    await setLedgerField(page, 'transactions', BACKUP_TXS);

    // ---------------------------------------------------------------- 5. every figure is the backup's again
    await showProfitAndLoss(page);
    await expect(page.getByText('$3,000.00').first()).toBeVisible();
    await showBalanceSheet(page);
    await expect(page.getByText('$13,000.00').first()).toBeVisible();
    await expect(page.getByText('Balanced', { exact: false }).first()).toBeVisible();
    await showTrialBalance(page);
    await expect(trialBalanceRow(page, '1000')).toContainText('$9,400.00');
    await expect(trialBalanceRow(page, '6000')).toContainText('$600.00');
    await expect(page.getByText('$13,600.00').first()).toBeVisible();
    await expect(page.getByText('Balanced Double-Entry')).toBeVisible();

    // ---------------------------------------------------------------- 6. a damaged file is refused whole
    const tampered = JSON.parse(backupFile) as { transactions: Tx[] };
    tampered.transactions[0].totalAmountCents = 999999;
    await mountBackupScreen(page, BACKUP_TXS);
    const uploadsBefore = restoreUploads.length;
    const damagedInput = page.locator('input[aria-label="Restore backup file"]');
    await damagedInput.setInputFiles({
      name: 'ledgerflow-backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(tampered), 'utf8'),
    });
    // the client reads the file, fails the checksum and clears the input; nothing is posted
    await expect.poll(() => damagedInput.evaluate((input: HTMLInputElement) => input.value), { timeout: 5000 }).toBe('');
    await page.waitForTimeout(500);
    expect(restoreUploads, 'a damaged backup must never reach the server').toHaveLength(uploadsBefore);

    // ---------------------------------------------------------------- 7. accessibility of the restored screen
    await showTrialBalance(page);
    await settleStyles(page);
    // The trial balance's known contrast debt is in e2e/journey-a11y-baseline.json; anything new fails.
    await expectNoNewAccessibilityIssues(page, `w10:trial-balance:${width}`, testInfo);

    expect(pageErrors, 'page errors').toEqual([]);
  });
}
