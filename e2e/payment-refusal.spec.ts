import { test, expect } from '@playwright/test';
import { mountJourney } from './support/journeyFixture';

for (const [width, language] of [[390, 'he'], [1280, 'en']] as const) {
  test(`N-3 a refused payment says what to change at ${width}px (${language})`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    const { requests, errors } = await mountJourney(page, {
      workspaceId: 'payment-refusal',
      ledger: {
        accounts: [{ id: 'bank', name: 'Checking', type: 'asset', category: 'Cash' }],
        customers: [{ id: 'c1', name: 'Test Customer' }],
        invoices: [{ id: 'i2', number: 'INV-2', customerId: 'c1', status: 'sent', amountCents: 8000, date: '2026-08-01' }],
      },
      mounts: [
        { module: '/src/components/sales/ReceivePaymentModal.tsx', props: { isOpen: true, defaultContactId: 'c1', defaultDocumentId: 'i2' } },
        { module: '/e2e/support/journeyRuntime.ts', exportName: 'Toaster' },
      ],
      api: ({ url, method }) => method === 'POST' && new URL(url).pathname === '/api/v1/payments'
        ? { status: 400, json: { status: 'error', message: 'Overpayment not allowed: allocation of 8000 cents exceeds remaining balance of 6000 cents for document i2' } }
        : null,
    });
    await page.evaluate(async lang => {
      const { useUIStore } = await import('/src/stores/useUIStore.ts');
      useUIStore.getState().setLanguage(lang);
    }, language);
    const allocation = page.getByLabel('Allocation amount for document INV-2');
    await expect(allocation).toHaveValue('80.00');
    await page.getByRole('button', { name: 'Record & Post Payment' }).click();
    const toast = page.locator('[data-sonner-toast]');
    await expect(toast.getByText(language === 'he'
      ? 'התשלום לא נרשם: הסכום שהוקצה גבוה מיתרת המסמך'
      : 'Payment not recorded: the allocated amount is more than the document balance', { exact: true })).toBeInViewport();
    await expect(toast.getByText(language === 'he'
      ? 'יש לבדוק את היתרה העדכנית בחשבונית או בחשבון הספק ולהקטין את הסכום שהוקצה למסמך.'
      : 'Reduce the amount applied to the invoice or bill after checking its current balance.', { exact: true })).toBeInViewport();
    await expect(allocation).toHaveValue('80.00');
    expect(requests.filter(request => new URL(request.url).pathname === '/api/v1/payments')).toHaveLength(1);
    expect(errors).toEqual([]);
    await testInfo.attach(`payment-refusal-${language}-${width}.png`, { body: await page.screenshot(), contentType: 'image/png' });
  });
}
