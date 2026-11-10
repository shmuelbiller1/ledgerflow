import { test, expect } from '@playwright/test';

/**
 * Issue #146: a nested "Edit record details" drawer did not close on Escape under full-suite load.
 *
 * The cause was focus, not the drawer's own listener: `Save details` disables itself while the write
 * is in flight, so the browser drops focus to the body, and an Escape that starts outside the dialog
 * never reaches the dialog's own keydown handler. The shared `useDialog` now answers that at the
 * document in the capture phase, for the topmost open dialog only.
 *
 * These tests reproduce the real sequence in a browser against the real `RecordDetailsPanel` under a
 * real bill modal — the write is slow on purpose, so the disabled-button window (and the focus drop it
 * causes) is observable rather than simulated with a blur.
 */

type Page = import('@playwright/test').Page;

async function mountDrawerOverBill(page: Page, options: { saveDelayMs?: number } = {}) {
  await page.route('**/api/**', route => route.fulfill({ status: 200, json: {} }));
  await page.addInitScript(() => {
    localStorage.setItem('isGuest', 'true');
    localStorage.setItem('has_seen_onboarding', 'true');
  });
  // closing the bill with a draft asks first; accept, as a reader would
  page.on('dialog', dialog => { void dialog.accept(); });
  await page.goto('/');
  await page.evaluate(async ({ saveDelayMs }) => {
    const [{ default: React }, { default: { createRoot } }, { RecordDetailsPanel }, { default: BillModal }] = await Promise.all([
      import('/node_modules/.vite/deps/react.js'),
      import('/node_modules/.vite/deps/react-dom_client.js'),
      import('/src/components/common/RecordDetailsDrawer.tsx'),
      import('/src/components/purchases/BillModal.tsx'),
    ]);
    const vendor = { id: 'vendor-146', uid: '', workspaceId: 'test', name: 'ספק Supply', category: 'Supplier' };
    let address = 'Old';
    const adapter = {
      session: () => ({ uid: 'test', workspaceId: 'test', writable: true }),
      read: async () => ({ ...vendor, address }),
      update: async (_target: unknown, changes: Record<string, string>) => {
        (window as unknown as { __writes: number }).__writes = 0;
        await new Promise(resolve => setTimeout(resolve, saveDelayMs));
        address = changes.address;
        (window as unknown as { __writes: number }).__writes += 1;
      },
    };
    function Harness() {
      const [open, setOpen] = React.useState(false);
      const [billOpen, setBillOpen] = React.useState(true);
      return React.createElement(
        React.Fragment,
        null,
        React.createElement(BillModal, { isOpen: billOpen, onClose: () => setBillOpen(false), onSave: () => {}, vendors: [vendor], accounts: [] }),
        React.createElement('button', { onClick: () => setOpen(true), style: { position: 'fixed', bottom: 0, right: 0, zIndex: 650 } }, 'Edit selected vendor'),
        open && React.createElement(RecordDetailsPanel, { initialTarget: { kind: 'vendors', id: vendor.id }, onClose: () => setOpen(false), adapter }),
      );
    }
    const node = document.createElement('div');
    document.body.appendChild(node);
    createRoot(node).render(React.createElement(Harness));
  }, { saveDelayMs: options.saveDelayMs ?? 1200 });
}

/** Where focus actually is, as a reader would experience it: a control's name, or the whole page. */
const focusedName = (page: Page) =>
  page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    if (!active || active === document.body) return 'body';
    return active.getAttribute('aria-label') || active.textContent?.trim().slice(0, 40) || active.tagName;
  });

async function openDrawer(page: Page) {
  const bill = page.getByRole('dialog', { name: 'Record New Bill' });
  await expect(bill).toBeVisible({ timeout: 60_000 });
  // a draft the reader can lose if the wrong dialog closes
  await bill.getByLabel('Vendor', { exact: true }).selectOption('vendor-146');
  await page.getByRole('button', { name: 'Edit selected vendor', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Edit record details' });
  await expect(drawer).toBeVisible();
  return { bill, drawer };
}

test.describe('issue #146: the nested record-details drawer answers Escape after a save drops focus', () => {
  test('a slow save disables Save, focus falls to the body, and Escape still closes only the drawer', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mountDrawerOverBill(page);
    const { bill, drawer } = await openDrawer(page);

    const address = drawer.getByRole('textbox', { name: 'Address', exact: true });
    await expect(address).toBeEnabled();
    await address.fill('כתובת חדשה\nStreet 7');

    const save = drawer.getByRole('button', { name: 'Save details', exact: true });
    await save.focus();
    await expect(save).toBeFocused();
    await save.press('Enter');

    // the button disables itself for the write ("Saving…"), and the browser drops the focused control
    await expect(drawer.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    await expect.poll(() => focusedName(page)).toBe('body');

    // …and the drawer still answers Escape, closing alone, with the bill open and its draft intact
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await expect(bill).toBeVisible();
    await expect(bill.getByLabel('Vendor', { exact: true })).toHaveValue('vendor-146');
    await expect(drawer.getByRole('status')).toHaveCount(0);

    // the write that was in flight still lands: closing the drawer must not throw away an accepted save
    await expect.poll(() => page.evaluate(() => (window as unknown as { __writes?: number }).__writes ?? 0), { timeout: 10_000 }).toBe(1);
    // and a drawer reopened after it landed reads that address back
    await page.getByRole('button', { name: 'Edit selected vendor', exact: true }).click();
    await expect(drawer.getByRole('textbox', { name: 'Address', exact: true })).toHaveValue('כתובת חדשה\nStreet 7');

    // one Escape closes one dialog: the reopened drawer goes first, the bill stays
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await expect(bill).toBeVisible();
    // and now that the bill is the topmost dialog, the next Escape reaches it (the draft asks first)
    await page.keyboard.press('Escape');
    await expect(bill).toHaveCount(0);
  });

  test('with focus still inside, Escape closes the drawer alone and leaves the bill open', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mountDrawerOverBill(page);
    const { bill, drawer } = await openDrawer(page);

    const address = drawer.getByRole('textbox', { name: 'Address', exact: true });
    await expect(address).toBeEnabled();
    await address.focus();
    await expect(address).toBeFocused();

    // Escape from inside: the dialog's own handler wins and stops the event reaching the bill
    await address.press('Escape');
    await expect(drawer).toHaveCount(0);
    await expect(bill).toBeVisible();
    await expect(bill.getByLabel('Vendor', { exact: true })).toHaveValue('vendor-146');
    // the escape did not also submit or save the record-details form
    await expect(page.getByText('Details saved for future use.')).toHaveCount(0);
  });
});
