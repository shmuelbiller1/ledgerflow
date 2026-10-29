import { test, expect, type Locator, type Page } from '@playwright/test';
import { mountJourney } from './support/journeyFixture';

/**
 * A-259: the keyboard path on five busy screens — Sales, Purchases, Banking, Reconciliation and
 * Settings → Users (Team & Invites). On each screen a keyboard user must be able to reach the main
 * list, open a row's dialog with Enter, move inside it with Tab (focus stays in), close it with
 * Escape, and land back on the row button that opened it. The Sales leg also proves the row actions
 * are *visible* while they hold focus: they used to be revealed by hover only (`lg:opacity-0`),
 * which hides the focus ring itself.
 *
 * Each screen is mounted from the app's own source on the shared journey harness (stores seeded,
 * API boundary recorded), at desktop width so the large-screen hover behaviour is the one measured.
 */

const BANK = (workspaceId: string) => ({ id: 'bank-1000', uid: 'journey-user', workspaceId, code: '1000', name: 'Operating Bank', type: 'asset', subtype: 'bank', category: 'Cash' });

/** The product of the element's and every ancestor's opacity: 1 only when a sighted user sees it. */
function effectiveOpacity(locator: Locator): Promise<number> {
  return locator.evaluate((el) => {
    let opacity = 1;
    let node: HTMLElement | null = el as HTMLElement;
    while (node) {
      opacity *= parseFloat(getComputedStyle(node).opacity || '1');
      node = node.parentElement;
    }
    return opacity;
  });
}

/**
 * Focus a row button the way Tab would land on it, open its dialog with Enter, Tab around inside,
 * close with Escape, and require focus back on the same button.
 */
async function keyboardRoundTrip(page: Page, opener: Locator, dialogName: string, options: { tabs?: number } = {}) {
  await opener.focus();
  await expect(opener, 'the row button takes keyboard focus').toBeFocused();
  const outline = await opener.evaluate((el) => getComputedStyle(el as HTMLElement).outlineStyle);
  expect(outline, 'the focused row button shows a focus ring').not.toBe('none');
  await expect.poll(() => effectiveOpacity(opener), { message: 'the focused row button is visible, not hover-hidden' }).toBe(1);

  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: dialogName });
  await expect(dialog, `Enter opened the “${dialogName}” dialog`).toBeVisible();
  await expect.poll(
    () => dialog.evaluate((d) => d === document.activeElement || d.contains(document.activeElement)),
    { message: 'focus moved into the dialog' },
  ).toBe(true);

  for (let i = 0; i < (options.tabs ?? 6); i++) {
    await page.keyboard.press('Tab');
    const inside = await dialog.evaluate((d) => d === document.activeElement || d.contains(document.activeElement));
    expect(inside, `Tab ${i + 1} keeps focus inside the dialog`).toBe(true);
  }

  await page.keyboard.press('Escape');
  await expect(dialog, 'Escape closed the dialog').toHaveCount(0);
  await expect(opener, 'focus returned to the row button that opened the dialog').toBeFocused();
}

test.use({ reducedMotion: 'reduce' });

test.beforeEach(async ({ page }) => {
  // The discard-changes confirmations are covered elsewhere; here a native confirm, if one appears,
  // accepts so the Escape/focus contract is what is measured.
  page.on('dialog', (d) => { void d.accept(); });
  await page.setViewportSize({ width: 1280, height: 900 });
});

test('A-259 Sales: invoice row → Edit invoice dialog → Escape → focus back on the row', async ({ page }) => {
  test.setTimeout(120_000);
  const workspaceId = 'kbd-sales';
  const { errors } = await mountJourney(page, {
    workspaceId,
    ledger: {
      accounts: [
        BANK(workspaceId),
        { id: 'ar-1100', uid: 'journey-user', workspaceId, code: '1100', name: 'Accounts receivable', type: 'asset', category: 'Receivables' },
        { id: 'rev-4000', uid: 'journey-user', workspaceId, code: '4000', name: 'Consulting revenue', type: 'income', category: 'Revenue' },
      ],
      customers: [{ id: 'cust-acme', uid: 'journey-user', workspaceId, name: 'Acme Corp', status: 'active', email: 'ap@acme.example.test' }],
      invoices: [{
        id: 'inv-1001', uid: 'journey-user', workspaceId, number: '1001', customerId: 'cust-acme', customerName: 'Acme Corp',
        status: 'sent', date: '2026-09-05', dueDate: '2026-10-05', amountCents: 118000, amountPaidCents: 0, currency: 'USD',
        items: [{ id: 'line-1', description: 'Consulting', quantity: 1, rateCents: 118000, amountCents: 118000 }],
      }],
    },
    mounts: [{ module: '/src/components/sales/Sales.tsx' }],
  });
  await expect(page.getByText('Acme Corp', { exact: true }).first()).toBeVisible();
  await keyboardRoundTrip(page, page.getByRole('button', { name: 'Edit invoice 1001', exact: true }), 'Edit invoice 1001');
  expect(errors).toEqual([]);
});

test('A-259 Purchases: bill row → Edit bill dialog → Escape → focus back on the row', async ({ page }) => {
  test.setTimeout(120_000);
  const workspaceId = 'kbd-purchases';
  const { errors } = await mountJourney(page, {
    workspaceId,
    ledger: {
      accounts: [
        BANK(workspaceId),
        { id: 'ap-2000', uid: 'journey-user', workspaceId, code: '2000', name: 'Accounts payable', type: 'liability', category: 'Payables' },
        { id: 'exp-5000', uid: 'journey-user', workspaceId, code: '5000', name: 'Office costs', type: 'expense', category: 'Expenses' },
      ],
      vendors: [{ id: 'vendor-parts', uid: 'journey-user', workspaceId, name: 'Parts Ltd', status: 'active', category: 'Supplies', email: '' }],
      bills: [{
        id: 'bill-2001', uid: 'journey-user', workspaceId, number: '2001', vendorId: 'vendor-parts', vendorName: 'Parts Ltd',
        status: 'pending', date: '2026-09-08', dueDate: '2026-09-20', amountCents: 42000, amountPaidCents: 0, currency: 'USD',
        items: [{ id: 'line-1', description: 'Widgets', quantity: 1, rateCents: 42000, amountCents: 42000, accountId: 'exp-5000' }],
      }],
    },
    mounts: [{ module: '/src/components/purchases/Purchases.tsx' }],
  });
  await expect(page.getByText('Parts Ltd', { exact: true }).first()).toBeVisible();
  await keyboardRoundTrip(page, page.getByRole('button', { name: 'Edit bill 2001', exact: true }), 'Edit bill 2001');
  expect(errors).toEqual([]);
});

test('A-259 Banking: bank account list → Make deposit dialog → Escape → focus back', async ({ page }) => {
  test.setTimeout(120_000);
  const workspaceId = 'kbd-banking';
  const { errors } = await mountJourney(page, {
    workspaceId,
    ledger: {
      accounts: [
        BANK(workspaceId),
        { id: 'undeposited', uid: 'journey-user', workspaceId, code: '1050', name: 'Undeposited Funds', type: 'asset', category: 'Other Assets' },
      ],
      payments: [],
    },
    mounts: [{ module: '/src/components/banking/Banking.tsx' }],
  });
  await expect(page.getByRole('heading', { name: 'Bank & Institution Connections' })).toBeVisible();
  await expect(page.getByText('Operating Bank', { exact: true })).toBeVisible();
  // The account card's own action takes focus and shows its ring…
  const sync = page.getByRole('button', { name: 'Sync Feed', exact: true }).first();
  await sync.focus();
  await expect(sync).toBeFocused();
  // …and the deposit dialog (wired to the shared dialog contract by A-259) round-trips by keyboard.
  await keyboardRoundTrip(page, page.getByRole('button', { name: 'Make deposit', exact: true }), 'Make deposit', { tabs: 4 });
  expect(errors).toEqual([]);
});

test('A-259 Reconciliation: bank line row → select → Split dialog → Escape → focus back', async ({ page }) => {
  test.setTimeout(120_000);
  const workspaceId = 'kbd-reconcile';
  const bank = BANK(workspaceId);
  const { errors } = await mountJourney(page, {
    workspaceId,
    ledger: {
      accounts: [bank, { id: 'exp-5000', uid: 'journey-user', workspaceId, code: '5000', name: 'Office costs', type: 'expense', category: 'Expenses' }],
      bankLines: [{
        id: 'bl-1', uid: 'journey-user', workspaceId, accountId: bank.id, status: 'pending',
        date: '2026-09-03', description: 'ACME SUPPLIES', amountCents: -42000, currency: 'USD',
      }],
      transactions: [],
      bills: [], invoices: [],
    },
    mounts: [{ module: '/src/components/ledger/Reconciliation.tsx' }],
  });
  await expect(page.getByRole('heading', { name: 'Smart Matching & Bank Reconciliation' })).toBeVisible();
  // Open (select) the bank-line row itself by keyboard…
  const row = page.getByRole('button', { name: /ACME SUPPLIES/ }).first();
  await row.focus();
  await expect(row).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(row).toHaveAttribute('aria-pressed', 'true');
  // …then act on it: Split opens the bank-line dialog, Escape closes it, focus returns to Split.
  await keyboardRoundTrip(page, page.getByRole('button', { name: 'Split', exact: true }), 'Split this bank line', { tabs: 4 });
  expect(errors).toEqual([]);
});

test('A-259 Settings → Users: member row → Remove dialog → Escape → focus back on Revoke', async ({ page }) => {
  test.setTimeout(120_000);
  const workspaceId = 'kbd-team';
  const { errors } = await mountJourney(page, {
    workspaceId,
    ledger: {},
    mounts: [{ module: '/src/components/platform/settings/TeamSettings.tsx' }],
    api: (request) => {
      if (request.url.endsWith(`/api/v1/workspaces/${workspaceId}/members`)) {
        return { json: { status: 'success', members: ['member-ada'], ownerUid: 'journey-user' } };
      }
      if (request.url.endsWith(`/api/v1/workspaces/${workspaceId}/roles`)) {
        return { json: { status: 'success', roles: { 'journey-user': 'owner', 'member-ada': 'bookkeeper' } } };
      }
      if (request.url.endsWith(`/api/v1/workspaces/${workspaceId}/invites`)) {
        return { json: { status: 'success', invites: [] } };
      }
      return null;
    },
  });
  const rowText = page.getByText('member-ada', { exact: true });
  await expect(rowText, 'the member list loaded the seeded member').toBeVisible();
  await keyboardRoundTrip(page, page.getByRole('button', { name: /Revoke/ }), 'Remove member-ada?', { tabs: 3 });
  expect(errors).toEqual([]);
});
