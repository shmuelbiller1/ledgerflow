import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mountJourney, remountJourney, setLedgerField, settleStyles } from './support/journeyFixture';
import { expectNoNewAccessibilityIssues, waitForFiniteAnimations } from './support/a11yGate';
import { backupFromWorkspaceArchive, buildWorkspaceArchive } from '../src/lib/workspaceArchive';

/**
 * D-98 · W10 (RELEASE_GATE): backup → change records → restore → the P&L, balance sheet and trial
 * balance are exactly what they were before the change, in the browser, on phone and desktop.
 *
 * This journey uses the real Settings → Backup & Export screen (`BackupExportSettings.tsx`):
 *  - "Export JSON Backup" downloads the backup file from the server export;
 *  - "Restore backup file" checks the file's SHA-256 and uploads it only when the owner confirms.
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
      counts: { transactions: transactions.length, accounts: ACCOUNTS.length },
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

async function mountBackupScreen(page: Page, ledger: Tx[], options: { exportStatus?: number; role?: 'owner' | 'viewer'; invalidExport?: boolean } = {}) {
  return mountJourney(page, {
    workspaceId: WORKSPACE,
    role: options.role,
    ledger: { accounts: ACCOUNTS, transactions: ledger, customers: [], vendors: [], invoices: [], bills: [], payments: [] },
    mounts: [BACKUP_SCREEN],
    api: request => {
      // the reports fall back to the ledger the app already has (BUG-02 fallback path)
      if (request.url.includes('/api/v1/reports/')) return { status: 500, json: {} };
      if (request.url.includes(`/api/v1/workspaces/${WORKSPACE}/export`)) {
        if (options.exportStatus) return { status: options.exportStatus, json: { error: 'Backup unavailable.' } };
        if (options.invalidExport) return { json: {} };
        return { json: backupPayload(ledger) };
      }
      if (request.url.includes(`/api/v1/workspaces/${WORKSPACE}/restore`)) {
        return { json: { success: true, message: 'Workspace restored from the backup file.', counts: { transactions: ledger.length } } };
      }
      return null;
    },
  });
}

const restoreDialog = (page: Page) => page.getByRole('dialog', { name: 'Restore backup?' });
const fileInput = (page: Page) => page.getByLabel('Restore backup file');
const restoreButton = (page: Page) => page.getByRole('button', { name: 'Restore Workspace', exact: true });
const backupMarker = (page: Page) => page.evaluate(id => localStorage.getItem(`ledgerflow:last_backup:${id}`), WORKSPACE);

async function selectJsonBackup(page: Page, name: string, text: string) {
  await fileInput(page).setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(text) });
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

async function restoreBackup(page: Page, fileText: string, restoreUploads: string[]) {
  await restoreButton(page).focus();
  await selectJsonBackup(page, 'ledgerflow-backup.json', fileText);
  const dialog = restoreDialog(page);
  await expect(dialog).toContainText('Journey Books');
  await expect(dialog).toContainText('ledgerflow-backup.json');
  await expect(dialog).toContainText('replaces');
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  expect(restoreUploads).toHaveLength(0);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(restoreButton(page)).toBeFocused();
  expect(restoreUploads).toHaveLength(0);

  await selectJsonBackup(page, 'ledgerflow-backup.json', fileText);
  await expect(dialog).toBeVisible();
  const [request] = await Promise.all([
    page.waitForRequest(request => request.url().endsWith('/restore') && request.method() === 'POST'),
    dialog.getByRole('button', { name: 'Replace workspace records' }).click(),
  ]);
  await expect(dialog).toHaveCount(0);
  return request;
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

    await expect.poll(() => backupMarker(page)).not.toBeNull();
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
    const restoreRequest = await restoreBackup(page, backupFile, restoreUploads);
    const sent = JSON.parse(restoreRequest.postData() || '{}') as { transactions?: Tx[]; metadata?: { checksum?: string } };
    expect(restoreUploads).toHaveLength(1);
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
    await selectJsonBackup(page, 'ledgerflow-backup.json', JSON.stringify(tampered));
    await expect(page.getByRole('alert')).toContainText('Checksum verification failed');
    await expect(restoreDialog(page)).toHaveCount(0);
    expect(restoreUploads, 'a damaged backup must never reach the server').toHaveLength(1);

    // ---------------------------------------------------------------- 7. accessibility of the restored screen
    await showTrialBalance(page);
    await settleStyles(page);
    // The trial balance's known contrast debt is in e2e/journey-a11y-baseline.json; anything new fails.
    await expectNoNewAccessibilityIssues(page, `w10:trial-balance:${width}`, testInfo);

    expect(pageErrors, 'page errors').toEqual([]);
  });
}

test('W10 a failed server export offers only a separately named, non-restorable partial copy', async ({ page }) => {
  const { requests } = await mountBackupScreen(page, BACKUP_TXS, { exportStatus: 503 });
  const downloads: string[] = [];
  page.on('download', download => downloads.push(download.suggestedFilename()));
  await expect(page.getByRole('heading', { name: 'Firestore Point-In-Time Recovery', exact: false })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Verify Backup Policy' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Export JSON Backup' }).click();
  await expect(page.getByRole('alert')).toContainText('The full backup could not be downloaded');
  expect(downloads).toEqual([]);
  expect(await backupMarker(page)).toBeNull();

  await page.locator('html').evaluate(element => element.classList.add('light'));
  await waitForFiniteAnimations(page);
  const { violations } = await new AxeBuilder({ page }).include('section[aria-label="Full Workspace Backup"]').withRules(['color-contrast']).analyze();
  expect(violations).toEqual([]);

  const [partial] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download partial copy' }).click(),
  ]);
  const filename = partial.suggestedFilename();
  expect(filename).toMatch(/^ledgerflow-partial-export-w10-backup-\d{4}-\d{2}-\d{2}\.json$/);
  const text = fs.readFileSync((await partial.path())!, 'utf8');
  expect(JSON.parse(text).metadata.serverAuthoritative).toBe(false);
  expect(JSON.parse(text).metadata.checksum).toBe(fileChecksum(text));
  expect(await backupMarker(page)).toBeNull();

  // Earlier browser copies had the full filename. The format marker, not the filename, controls refusal.
  await selectJsonBackup(page, 'ledgerflow-backup.json', text);
  await expect(page.getByRole('alert').filter({ hasText: 'cannot be restored' })).toBeVisible();
  await expect(restoreDialog(page)).toHaveCount(0);
  expect(requests.filter(request => request.url.endsWith('/restore'))).toHaveLength(0);
});

for (const [scenario, options] of [
  ['the server refuses access', { exportStatus: 403 }],
  ['a successful response is not a backup', { invalidExport: true }],
] as const) {
  test(`W10 does not mark a backup complete when ${scenario}`, async ({ page }) => {
    await mountBackupScreen(page, BACKUP_TXS, options);
    const downloads: string[] = [];
    page.on('download', download => downloads.push(download.suggestedFilename()));
    await page.getByRole('button', { name: 'Export JSON Backup' }).click();
    await expect(page.getByRole('alert')).toContainText('The full backup could not be downloaded');
    await expect(page.getByRole('button', { name: 'Download partial copy' })).toHaveCount(0);
    expect(downloads).toEqual([]);
    expect(await backupMarker(page)).toBeNull();
  });
}

async function blockReminderWrite(page: Page) {
  await page.evaluate(id => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (this === localStorage && key === `ledgerflow:last_backup:${id}`) {
        throw new DOMException('Storage is full', 'QuotaExceededError');
      }
      setItem.call(this, key, value);
    };
  }, WORKSPACE);
}

test('W10 a blocked reminder write does not report a failed download', async ({ page }) => {
  await mountBackupScreen(page, BACKUP_TXS);
  await blockReminderWrite(page);
  const text = await exportBackup(page);
  expect(JSON.parse(text).metadata.checksum).toBe(fileChecksum(text));
  await expect(page.getByRole('status')).toContainText('The backup download started, but the reminder could not be updated');
  await expect(page.getByRole('alert').filter({ hasText: 'The full backup could not be downloaded' })).toHaveCount(0);
  expect(await backupMarker(page)).toBeNull();
});

test('W10 ZIP downloads even when its reminder cannot be updated', async ({ page }) => {
  await mountBackupScreen(page, BACKUP_TXS);
  await blockReminderWrite(page);
  const button = page.getByRole('button', { name: 'Download workspace ZIP archive' });
  const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);
  expect(download.suggestedFilename()).toMatch(/^ledgerflow-archive-w10-backup-\d{4}-\d{2}-\d{2}\.zip$/);
  const path = await download.path();
  expect(path, 'the verified archive must actually download').toBeTruthy();
  const { backup } = await backupFromWorkspaceArchive(fs.readFileSync(path!));
  expect(backup).toEqual(backupPayload(BACKUP_TXS));
  await expect(page.getByRole('status')).toContainText('The ZIP download started, but the reminder could not be updated');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(button).toBeEnabled();
  expect(await backupMarker(page)).toBeNull();
});

test('W10 reports unmatched attachments after restoring records', async ({ page }) => {
  await mountBackupScreen(page, BACKUP_TXS);
  const payload = {
    ...backupPayload(BACKUP_TXS),
    attachments: [{ id: 'file-1' }, { id: 'file-2' }, { id: 'file-3' }],
  };
  payload.metadata.checksum = fileChecksum(JSON.stringify(payload));
  const text = JSON.stringify(payload);
  let missing = ['file-2', 'file-3'];
  await page.route('**/restore', route => route.fulfill({ json: {
    success: true,
    message: 'General ledger workspace successfully restored from backup.',
    attachments: { listed: 3, present: 3 - missing.length, missing },
  } }));

  const notice = page.getByRole('status').filter({ hasText: 'Attachments not matched' });
  const uploads: string[] = [];
  page.on('request', request => {
    if (request.url().endsWith('/restore') && request.method() === 'POST') uploads.push(request.postData() ?? '');
  });
  await restoreBackup(page, text, uploads);
  await expect(notice).toContainText('Attachments not matched: 2');
  await expect(notice).toContainText('This backup does not contain the files');
  await expect(notice).not.toContainText('file-2');
  await expect(page.getByRole('alert')).toHaveCount(0);

  missing = [];
  await selectJsonBackup(page, 'ledgerflow-next-backup.json', text);
  await expect(notice).toHaveCount(0);
  await restoreDialog(page).getByRole('button', { name: 'Replace workspace records' }).click();
  await expect(restoreDialog(page)).toHaveCount(0);
  await expect(notice).toHaveCount(0);
  expect(uploads).toEqual([text, text]);
});

test('W10 a workspace archive requires confirmation and submits its exact JSON once on server refusal', async ({ page }) => {
  await mountBackupScreen(page, BACKUP_TXS);
  const payload = backupPayload(BACKUP_TXS);
  const archive = await buildWorkspaceArchive(payload, WORKSPACE);
  const { promise: canReply, resolve: releaseResponse } = Promise.withResolvers<void>();
  const uploads: string[] = [];
  await page.route('**/restore', async route => {
    uploads.push(route.request().postData() ?? '');
    await canReply;
    await route.fulfill({ status: 409, json: { error: 'Books are closed through 2026-01-31.' } });
  });
  try {
    await fileInput(page).setInputFiles({ name: 'workspace-archive.zip', mimeType: 'application/zip', buffer: Buffer.from(await archive.blob.arrayBuffer()) });
    const dialog = restoreDialog(page);
    const cancel = dialog.getByRole('button', { name: 'Cancel' });
    const confirm = dialog.getByRole('button', { name: 'Replace workspace records' });
    await expect(cancel).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(confirm).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(cancel).toBeFocused();
    expect(uploads).toHaveLength(0);
    await waitForFiniteAnimations(page);
    const { violations } = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
    expect(violations.filter(violation => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([]);

    await confirm.click({ clickCount: 2 });
    await expect(dialog.getByRole('button', { name: 'Restoring…' })).toBeDisabled();
    await page.keyboard.press('Tab');
    await expect(dialog).toBeFocused();
    await expect(cancel).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await expect.poll(() => uploads).toEqual([JSON.stringify(payload, null, 2)]);
  } finally {
    releaseResponse();
  }
  await expect(restoreDialog(page)).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText('Books are closed through 2026-01-31');
  expect(uploads).toHaveLength(1);
});

test('W10 discards a staged backup when the owner changes workspace', async ({ page }) => {
  const { requests } = await mountBackupScreen(page, BACKUP_TXS);
  await selectJsonBackup(page, 'ledgerflow-backup.json', JSON.stringify(backupPayload(BACKUP_TXS)));
  await expect(restoreDialog(page)).toBeVisible();

  await page.evaluate(async () => {
    const path = '/src/stores/useAuthStore.ts';
    const { useAuthStore } = await import(/* @vite-ignore */ path) as typeof import('../src/stores/useAuthStore');
    const auth = useAuthStore.getState();
    auth.setWorkspaces([...auth.workspaces, { ...auth.workspaces[0], id: 'other-books', name: 'Other Books' }]);
    auth.setCurrentWorkspaceId('other-books');
  });

  await expect(restoreDialog(page)).toHaveCount(0);
  await expect(restoreButton(page)).toBeEnabled();
  expect(requests.filter(request => request.url.endsWith('/restore'))).toHaveLength(0);
});

test('W10 refuses a checksummed backup from another workspace before confirmation', async ({ page }) => {
  const { requests } = await mountBackupScreen(page, BACKUP_TXS);
  const payload = backupPayload(BACKUP_TXS);
  payload.workspace.id = 'other-books';
  const text = JSON.stringify(payload);
  payload.metadata.checksum = fileChecksum(text);
  await selectJsonBackup(page, 'other-workspace.json', JSON.stringify(payload));
  await expect(page.getByRole('alert')).toContainText('belongs to a different workspace');
  await expect(restoreDialog(page)).toHaveCount(0);
  expect(requests.filter(request => request.url.endsWith('/restore'))).toHaveLength(0);
});

test('W10 drops a file still being checked when a new sign-in starts for the same user', async ({ page }) => {
  const { requests } = await mountBackupScreen(page, BACKUP_TXS);
  // Pause only this file read. Let the genuine validator finish after the new sign-in.
  await page.evaluate(() => {
    const readFile = File.prototype.text;
    File.prototype.text = async function () {
      File.prototype.text = readFile;
      await new Promise<void>(resolve => {
        window.addEventListener('w10-resume-file-read', () => resolve(), { once: true });
      });
      return readFile.call(this);
    };
  });
  const text = JSON.stringify(backupPayload(BACKUP_TXS));
  await selectJsonBackup(page, 'old-session.json', text);
  await expect(page.getByRole('button', { name: 'Checking backup…' })).toBeVisible();
  await page.evaluate(async () => {
    const path = '/src/stores/useAuthStore.ts';
    const { useAuthStore } = await import(/* @vite-ignore */ path) as typeof import('../src/stores/useAuthStore');
    const { user, setUser } = useAuthStore.getState();
    if (!user) throw new Error('Expected a signed-in fixture owner');
    setUser({ ...user, getIdTokenResult: async () => ({ claims: {}, token: '', expirationTime: '', issuedAtTime: '', signInProvider: null }) });
    window.dispatchEvent(new Event('w10-resume-file-read'));
  });
  await expect(restoreButton(page)).toBeEnabled();
  await selectJsonBackup(page, 'new-session.json', text);
  await expect(restoreDialog(page)).toContainText('new-session.json');
  expect(requests.filter(request => request.url.endsWith('/restore'))).toHaveLength(0);
});

test('W10 shows the owner requirement without enabling restore for a viewer', async ({ page }) => {
  await mountBackupScreen(page, BACKUP_TXS, { role: 'viewer' });
  await expect(restoreButton(page)).toBeDisabled();
  await expect(page.getByText('Only a signed-in workspace owner can restore a backup.')).toBeVisible();
});
