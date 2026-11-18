import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mountJourney, remountJourney, settleStyles } from './support/journeyFixture';
import { settleAnimations } from './support/a11yGate';

const WORKSPACE = 'a10-screens-ws';

test.describe('H-1 RTL Hebrew · H-4 screen-reader/axe · H-6 empty & failed-load retry states', () => {
  for (const width of [390, 1280]) {
    test(`Hebrew RTL layout, focusable wide table, empty/error retry, and axe check at ${width}px`, async ({ page }) => {
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

      // Simulate collection load failure -> ScreenDataNotice appears, disables CSV export, and clears on "Try again".
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

      // Mount TaxLiabilityView: verify filing stays disabled when /tax-returns fails and re-enables on retry.
      let failReturns = true;
      await page.route(`**/api/v1/workspaces/${WORKSPACE}/tax-returns`, route => {
        if (failReturns && route.request().method() === 'GET') {
          return route.fulfill({ status: 503, json: { status: 'error', error: 'Service down.' } });
        }
        return route.fulfill({ status: 200, json: { returns: [] } });
      });
      await remountJourney(page, [{
        module: '/src/components/reporting/TaxLiabilityView.tsx',
        props: { startDate: '2026-09-01', endDate: '2026-09-30' },
      }]);
      await expect(page.getByText(/Couldn't load previously filed returns/i)).toBeVisible();
      await expect(page.getByRole('button', { name: 'File this return' })).toBeDisabled();
      failReturns = false;
      await page.getByRole('button', { name: 'Try again' }).click();
      await expect(page.getByRole('button', { name: 'File this return' })).toBeEnabled();

      const taxAxe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).disableRules(['color-contrast']).analyze();
      expect(taxAxe.violations.filter(v => v.impact === 'critical' || v.impact === 'serious').map(v => v.id)).toEqual([]);
      expect(journey.errors).toEqual([]);
    });
  }
});
