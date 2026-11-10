import { test, expect } from '@playwright/test';
test('related details drawer retains an actual bill draft, saves an address and closes alone', async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ status: 200, json: {} }));
  await page.addInitScript(() => { localStorage.setItem('isGuest', 'true'); localStorage.setItem('has_seen_onboarding', 'true'); });
  page.on('dialog', async dialog => { await dialog.accept(); });
  await page.goto('/');
  await page.evaluate(async () => {
    const reactPath = '/node_modules/.vite/deps/react.js', domPath = '/node_modules/.vite/deps/react-dom_client.js', panelPath = '/src/components/common/RecordDetailsDrawer.tsx', billPath = '/src/components/purchases/BillModal.tsx';
    const [{ default: React }, { default: { createRoot } }, { RecordDetailsPanel }, { default: BillModal }] = await Promise.all([import(reactPath), import(domPath), import(panelPath), import(billPath)]);
    const vendor = { id: 'vendor-drawer', uid: '', workspaceId: 'test', name: 'ספק Supply', category: 'Supplier' };
    let address = 'Old';
    const adapter = { session: () => ({ uid: 'test', workspaceId: 'test', writable: true }), read: async () => ({ ...vendor, address }), update: async (_target: unknown, changes: Record<string, string>) => { address = changes.address; } };
    function Harness() {
      const [open, setOpen] = React.useState(false);
      const [billOpen, setBillOpen] = React.useState(true);
      return React.createElement(React.Fragment, null,
        React.createElement(BillModal, { isOpen: billOpen, onClose: () => setBillOpen(false), onSave: () => {}, vendors: [vendor], accounts: [] }),
        React.createElement('button', { onClick: () => setOpen(true), style: { position: 'fixed', bottom: 0, right: 0, zIndex: 650 } }, 'Edit selected vendor'),
        open && React.createElement(RecordDetailsPanel, { initialTarget: { kind: 'vendors', id: vendor.id }, onClose: () => setOpen(false), adapter }));
    }
    const node = document.createElement('div'); document.body.appendChild(node); createRoot(node).render(React.createElement(Harness));
  });
  const bill = page.getByRole('dialog', { name: 'Record New Bill' });
  await expect(bill).toBeVisible();
  await bill.getByLabel('Vendor', { exact: true }).selectOption('vendor-drawer');
  await bill.locator('summary').filter({ hasText: 'More options' }).click();
  await bill.getByLabel('Bill Number', { exact: true }).fill('Draft 17');
  await page.getByRole('button', { name: 'Edit selected vendor', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Edit record details' });
  await drawer.getByRole('textbox', { name: 'Address', exact: true }).fill('ירושלים\nStreet 7');
  await drawer.getByRole('button', { name: 'Save details', exact: true }).click();
  await expect(drawer.getByRole('status')).toHaveText('Details saved for future use.');
  await page.keyboard.press('Escape'); await expect(drawer).toHaveCount(0); await expect(bill).toBeVisible();
  await expect(bill.getByLabel('Bill Number', { exact: true })).toHaveValue('Draft 17');
  await page.getByRole('button', { name: 'Edit selected vendor', exact: true }).click();
  await expect(drawer.getByRole('textbox', { name: 'Address', exact: true })).toHaveValue('ירושלים\nStreet 7');
});
