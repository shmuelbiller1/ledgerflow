import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mountJourney, remountJourney, settleStyles } from './support/journeyFixture';
import { settleAnimations } from './support/a11yGate';

const WORKSPACE = 'a10-screens-ws';

function signedBackup(serverAuthoritative: boolean) {
  const body = {
    schemaVersion: 1,
    exportedAt: '2026-11-18T00:00:00.000Z',
    workspace: { id: WORKSPACE, name: 'סטודיו תל אביב', currency: 'ILS', lockDate: null },
    metadata: {
      version: '2.0.0',
      workspaceId: WORKSPACE,
      accountCount: 1,
      transactionCount: 1,
      serverAuthoritative,
    } as Record<string, unknown>,
    accounts: [{ id: 'acc-1', uid: 'journey-user', workspaceId: WORKSPACE, code: '1000', name: 'בנק לאומי', type: 'asset', category: 'Cash', openingBalanceCents: 100_000 }],
    transactions: [{ id: 'tx-1', uid: 'journey-user', workspaceId: WORKSPACE, date: '2026-09-01', description: 'הפקדה', status: 'posted', type: 'actual', totalAmountCents: 100_000, currency: 'ILS', lines: [{ accountId: 'acc-1', amountCents: 100_000 }] }],
  };
  body.metadata.checksum = createHash('sha256').update(new TextEncoder().encode(JSON.stringify(body))).digest('hex');
  return JSON.stringify(body);
}

test.describe('H-1 RTL Hebrew · H-4 screen-reader/axe · H-6 empty/error · #776 & #779 backup safety', () => {
  test('#779 & #776: BackupExportSettings removes fake PITR copy, flags partial offline exports, refuses partial restores, and confirms full restores', async ({ page }) => {
    const restoreCalls: string[] = [];
    const journey = await mountJourney(page, {
      workspaceId: WORKSPACE,
      ledger: {
        accounts: [{ id: 'acc-1', uid: 'journey-user', workspaceId: WORKSPACE, code: '1000', name: 'Cash', type: 'asset', category: 'Cash', openingBalanceCents: 0 }],
        transactions: [],
      },
      mounts: [{ module: '/src/components/platform/settings/BackupExportSettings.tsx' }],
      api: request => {
        if (request.url.endsWith(`/workspaces/${WORKSPACE}/export`)) {
          return { status: 503, json: { status: 'error', error: 'server unreachable' } };
        }
        if (request.url.endsWith(`/workspaces/${WORKSPACE}/restore`) && request.method === 'POST') {
          restoreCalls.push(typeof request.body === 'string' ? request.body : JSON.stringify(request.body));
          return { json: { status: 'success', message: 'Restored.' } };
        }
        return null;
      },
    });

    await expect(page.getByRole('heading', { name: 'Backup & Export' })).toBeVisible();
    await expect(page.getByText(/Firestore|PITR Active|Verify Backup Policy|coming in Q4/i)).toHaveCount(0);
    await expect(page.getByText(/Backup verification & accountant copies/i)).toBeVisible();

    // 1. Offline fallback names file `-partial-offline-`, renders alert, and never marks backup health complete.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: /Export JSON Backup/i }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^ledgerflow-partial-offline-backup-a10-screens-ws-\d{4}-\d{2}-\d{2}\.json$/);
    const dlPath = await download.path();
    expect(dlPath).toBeTruthy();
    const offlineJson = JSON.parse(fs.readFileSync(dlPath!, 'utf8')) as { metadata: { serverAuthoritative: boolean } };
    expect(offlineJson.metadata.serverAuthoritative).toBe(false);
    await expect(page.getByRole('alert').filter({ hasText: /cannot restore a workspace/i })).toBeVisible();
    const storedBackupStamp = await page.evaluate(ws => localStorage.getItem(`ledgerflow:last_backup:${ws}`), WORKSPACE);
    expect(storedBackupStamp).toBeNull();

    // 2. Uploading a partial offline snapshot is rejected immediately without opening confirm dialog or hitting /restore.
    const fileInput = page.locator('input[aria-label="Restore backup file"]');
    await fileInput.setInputFiles({
      name: 'partial.json',
      mimeType: 'application/json',
      buffer: Buffer.from(signedBackup(false), 'utf8'),
    });
    await expect.poll(() => fileInput.evaluate((el: HTMLInputElement) => el.value)).toBe('');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(restoreCalls).toHaveLength(0);

    // 3. Uploading a server-authoritative backup opens accessible confirm dialog; Escape cancels; Confirm sends /restore.
    const fullBackup = signedBackup(true);
    await fileInput.setInputFiles({
      name: 'verified.json',
      mimeType: 'application/json',
      buffer: Buffer.from(fullBackup, 'utf8'),
    });
    const dialog = page.getByRole('dialog', { name: /Replace workspace records from backup/i });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    expect(restoreCalls).toHaveLength(0);

    await fileInput.setInputFiles({
      name: 'verified.json',
      mimeType: 'application/json',
      buffer: Buffer.from(fullBackup, 'utf8'),
    });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Confirm restore' }).click();
    await expect.poll(() => restoreCalls.length).toBe(1);
    expect(journey.errors).toEqual([]);
  });

  for (const width of [390, 1280]) {
    test(`H-1 · H-4 · H-6: Hebrew RTL layout, empty/error retry, and axe check at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const accounts = [
        { id: 'grp', uid: 'journey-user', workspaceId: WORKSPACE, code: '1000', name: 'מזומנים ובנקים', type: 'asset', category: 'Cash', openingBalanceCents: 0 },
        { id: 'bank', uid: 'journey-user', workspaceId: WORKSPACE, code: '1010', name: 'עו״ש בנק לאומי', type: 'asset', category: 'Cash', parentId: 'grp', openingBalanceCents: 250_000 },
        { id: 'eq', uid: 'journey-user', workspaceId: WORKSPACE, code: '3000', name: 'הון עצמי', type: 'equity', category: 'Equity', openingBalanceCents: 250_000 },
      ];

      const journey = await mountJourney(page, {
        workspaceId: WORKSPACE,
        ledger: { accounts, transactions: [], invoices: [], bills: [], creditNotes: [], vendorCredits: [] },
        mounts: [{
          module: '/src/components/ledger/TrialBalanceView.tsx',
          props: { accounts, formatCurrency: '__fn:formatCurrency', onDrillDown: '__fn:noop' },
        }],
      });

      // Switch page into Hebrew RTL and verify logical right-edge alignment + child indentation + focusable table region.
      await page.evaluate(async () => {
        document.documentElement.lang = 'he';
        document.documentElement.dir = 'rtl';
        const mod = '/src/stores/useUIStore.ts';
        const { useUIStore } = await import(/* @vite-ignore */ mod) as typeof import('../src/stores/useUIStore');
        useUIStore.getState().setLanguage('he');
      });
      await settleStyles(page);
      await settleAnimations(page, 400);

      const region = page.getByRole('region', { name: 'Trial balance table' });
      await expect(region).toHaveAttribute('tabindex', '0');

      const childPadding = await page.getByText('עו״ש בנק לאומי').evaluate(el => {
        const indented = el.closest('div[style]') as HTMLElement | null;
        if (!indented) return { paddingRight: '0px', paddingLeft: '0px' };
        const cs = getComputedStyle(indented);
        return { paddingRight: cs.paddingRight, paddingLeft: cs.paddingLeft };
      });
      expect(childPadding).toEqual({ paddingRight: '16px', paddingLeft: '0px' });

      const tbAxe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).disableRules(['color-contrast']).analyze();
      expect(tbAxe.violations.filter(v => v.impact === 'critical' || v.impact === 'serious').map(v => v.id)).toEqual([]);

      // Mount Israel VAT Report in Hebrew RTL: configure IL dealer registration, check empty state, failed-load retry, and RTL alignment.
      await page.evaluate(async wsId => {
        const mod = '/src/stores/useAuthStore.ts';
        const { useAuthStore } = await import(/* @vite-ignore */ mod) as typeof import('../src/stores/useAuthStore');
        const st = useAuthStore.getState();
        useAuthStore.setState({
          workspaces: st.workspaces.map(w => w.id === wsId ? {
            ...w,
            currency: 'ILS',
            taxProfiles: {
              books: {
                name: 'סטודיו תל אביב',
                place: { country: 'IL', city: 'תל אביב' },
                registrations: [{ kind: 'vat', number: '514000001', place: { country: 'IL' }, filing: 'monthly', validFrom: '2026-01-01' }],
              },
            },
          } : w),
        });
      }, WORKSPACE);

      await remountJourney(page, [{
        module: '/src/components/reporting/IsraelVatReportView.tsx',
        props: { startDate: '2026-09-01', endDate: '2026-09-30' },
      }]);
      await expect(page.getByTestId('il-vat-empty-period')).toBeVisible();

      const vatAlign = await page.getByRole('rowheader', { name: 'Output VAT' }).evaluate(th => {
        const amountCell = th.parentElement?.querySelector('td:last-child') as HTMLElement | null;
        return {
          labelAlign: getComputedStyle(th).textAlign,
          amountAlign: amountCell ? getComputedStyle(amountCell).textAlign : '',
          numeric: amountCell ? getComputedStyle(amountCell).fontVariantNumeric : '',
        };
      });
      expect(vatAlign.labelAlign).toBe('right');
      expect(vatAlign.amountAlign).toBe('right');
      expect(vatAlign.numeric).toContain('tabular-nums');

      // Simulate collection load failure -> ScreenDataNotice appears with working "Try again".
      await page.evaluate(async () => {
        const mod = '/src/stores/useDataNeedsStore.ts';
        const { useDataNeedsStore } = await import(/* @vite-ignore */ mod) as typeof import('../src/stores/useDataNeedsStore');
        useDataNeedsStore.getState().markFailed('invoices', 'Network error.');
      });
      const notice = page.locator('[data-screen-data-notice]');
      await expect(notice).toBeVisible();
      await expect(page.getByRole('button', { name: /Export CSV/i })).toBeDisabled();
      await notice.getByRole('button', { name: 'Try again' }).click();
      await expect(notice).toHaveCount(0);

      const vatAxe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).disableRules(['color-contrast']).analyze();
      expect(vatAxe.violations.filter(v => v.impact === 'critical' || v.impact === 'serious').map(v => v.id)).toEqual([]);
      expect(journey.errors).toEqual([]);
    });
  }
});
