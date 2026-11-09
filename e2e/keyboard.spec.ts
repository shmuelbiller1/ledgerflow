import { test, expect } from '@playwright/test';
import { TransactionTemplates } from '../src/kernel/templates/TransactionTemplates';
import { computeProfitAndLoss } from '../src/server/reports/computeReports';
import { makeChartAccount, makeTransaction } from '../src/tests/fixtures';
import type { ChartAccount, Customer, Invoice, Payment, Transaction } from '../src/types';

/**
 * Keyboard basics (E-22, E-29): the first Tab reaches "Skip to content", which moves focus to the
 * screen without changing it, and focused controls show a ring.
 */
test.describe('Keyboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('isGuest', 'true');
      localStorage.setItem('has_seen_onboarding', 'true');
    });
    // (a URL hash would make the browser start Tab navigation at the element with that id)
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeAttached();
  });

  test('skip to content moves focus to the screen and keeps the screen', async ({ page }) => {
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main-content')).toBeFocused();
    expect(['', '#dashboard']).toContain(new URL(page.url()).hash);
  });

  test('a focused button shows a visible ring', async ({ page }) => {
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    const outline = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return el ? getComputedStyle(el).outlineStyle : 'none';
    });
    expect(outline).not.toBe('none');
  });

  test('an invoice can be opened, filled in and saved with the keyboard only (E-23)', async ({ page }) => {
    const press = async (name: string) => {
      const target = page.getByRole('button', { name, exact: true }).first();
      await target.focus();
      await page.keyboard.press('Enter');
    };
    await press('Money In');
    await press('Invoices');
    await page.getByRole('button', { name: /Add Invoice/ }).first().focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'New invoice' })).toBeVisible();

    // every field and the save button are reachable with Tab, in order
    await page.getByLabel('Customer', { exact: true }).focus();
    await page.keyboard.type('Keyboard Customer');
    const reached = new Set<string>();
    for (let i = 0; i < 60 && !reached.has('Save Draft'); i++) {
      await page.keyboard.press('Tab');
      const label = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el) return '';
        const id = el.getAttribute('id');
        const byFor = id ? document.querySelector(`label[for="${id}"]`)?.textContent : '';
        return (byFor || el.getAttribute('aria-label') || el.textContent || '').trim();
      });
      reached.add(label);
      if (label === 'Item / Description') await page.keyboard.type('Consulting');
      if (/^Rate/.test(label)) await page.keyboard.type('120');
    }
    for (const field of ['Invoice Number', 'Invoice Date', 'Due Date', 'Tax', 'Item / Description', 'Qty', 'Save Draft']) {
      expect([...reached].some(r => r === field || r.startsWith(field)), `${field} reachable by Tab`).toBe(true);
    }
    await expect(page.getByLabel('Invoice totals')).toContainText('120.00');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'New invoice' })).toBeHidden({ timeout: 8000 });
  });

  test('a budget target can be opened, filled in and saved with the keyboard only (A-226)', async ({ page }) => {
    await page.goto('/#budgets');
    await expect(page.getByRole('heading', { name: 'Budget Protocol' })).toBeVisible();

    const openBtn = page.getByRole('button', { name: 'Define Target', exact: true });
    await openBtn.focus();
    await expect(openBtn).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Define Objective' })).toBeVisible();

    await page.getByLabel('Rule Mapping (Account)', { exact: true }).focus();
    await page.keyboard.type('Cloud Hosting');
    const reached = new Set<string>();
    for (let i = 0; i < 20 && !reached.has('Confirm Allocation'); i++) {
      await page.keyboard.press('Tab');
      const label = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el) return '';
        const id = el.getAttribute('id');
        const byFor = id ? document.querySelector(`label[for="${id}"]`)?.textContent : '';
        return (byFor || el.getAttribute('aria-label') || el.textContent || '').trim();
      });
      reached.add(label);
      if (label === 'Target Magnitude ($)') {
        await page.keyboard.press('Backspace');
        await page.keyboard.type('2500');
      }
    }
    for (const field of ['Target Magnitude ($)', 'Velocity Period', 'Abort', 'Confirm Allocation']) {
      expect([...reached].some(r => r === field || r.startsWith(field)), `${field} reachable by Tab`).toBe(true);
    }
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Define Objective' })).toBeHidden({ timeout: 8000 });
    await expect(page.locator('#main-content')).toContainText('$2,500.00');
    await expect(page.getByRole('button', { name: 'Edit budget for Cloud Hosting' })).toBeVisible();
  });

  test('a project can be opened, filled in and saved with the keyboard only (A-226)', async ({ page }) => {
    await page.goto('/#projects');
    await expect(page.getByRole('heading', { name: 'Project & Initiative Tracking' })).toBeVisible();

    const openBtn = page.getByRole('button', { name: 'Initialize Project', exact: true });
    await openBtn.focus();
    await expect(openBtn).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Initialize Project' })).toBeVisible();

    await page.getByLabel('Protocol Name', { exact: true }).focus();
    await page.keyboard.type('Keyboard Initiative');
    const reached = new Set<string>();
    for (let i = 0; i < 20 && !reached.has('INITIALIZE PROTOCOL'); i++) {
      await page.keyboard.press('Tab');
      const label = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el) return '';
        const id = el.getAttribute('id');
        const byFor = id ? document.querySelector(`label[for="${id}"]`)?.textContent : '';
        return (byFor || el.getAttribute('aria-label') || el.textContent || '').trim();
      });
      reached.add(label);
      if (label === 'Strategic Description') {
        await page.keyboard.type('Keyboard-only project flow');
      }
    }
    for (const field of ['General', 'Publication', 'Event', 'Campaign', 'Strategic Description', 'Cancel', 'INITIALIZE PROTOCOL']) {
      expect([...reached].some(r => r === field || r.startsWith(field)), `${field} reachable by Tab`).toBe(true);
    }
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 8000 });
    await expect(page.locator('#main-content')).toContainText('Keyboard Initiative');
  });

  test('customer → invoice → payment → P&L journey with keyboard only and visible focus (A-226 / H-3)', async ({ page }) => {
    const workspaceId = 'h3-kbd-books';
    const uid = 'h3-kbd-owner';
    const accounts: ChartAccount[] = [
      makeChartAccount({ id: 'cash', code: '1000', name: 'Operating Cash', type: 'asset', subtype: 'bank', category: 'Cash' }),
      makeChartAccount({ id: 'ar', code: '1100', name: 'Accounts receivable', type: 'asset', category: 'Receivables' }),
      makeChartAccount({ id: 'revenue', code: '4000', name: 'Consulting revenue', type: 'income', category: 'Revenue' }),
    ];
    const customers: Customer[] = [];
    const invoices: Invoice[] = [];
    const payments: Payment[] = [];
    const transactions: Transaction[] = [];
    const paymentRequests: Array<Record<string, unknown>> = [];

    const workspace = {
      id: workspaceId,
      uid,
      name: 'H3 Keyboard Books',
      currency: 'USD',
      fiscalYearStartMonth: 1,
      roles: { [uid]: 'owner' },
    };

    const syncPageStores = async () => {
      await page.evaluate(async ({ customers, invoices, payments, transactions }) => {
        const { useLedgerStore } = await import('/src/stores/useLedgerStore.ts');
        useLedgerStore.setState({ customers, invoices, payments, transactions });
      }, { customers, invoices, payments, transactions });
    };

    await page.route('**/rest/v1/**', async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      if (req.method() === 'POST' && url.pathname.includes('/rpc/lf_set')) {
        const body = req.postDataJSON() as { p_table?: string; p_id?: string; p_data?: Record<string, unknown> };
        if (body.p_table === 'customers' && body.p_id && body.p_data) {
          const customer = { id: body.p_id, ...body.p_data } as unknown as Customer;
          const idx = customers.findIndex(c => c.id === customer.id);
          if (idx >= 0) customers[idx] = customer;
          else customers.push(customer);
          await syncPageStores();
        }
        await route.fulfill({ status: 200, json: {} });
        return;
      }
      if (req.method() === 'GET') {
        const table = url.pathname.split('/rest/v1/')[1]?.split('/')[0] || '';
        const tables: Record<string, Array<{ id: string }>> = {
          workspaces: [workspace],
          users: [{ id: uid, uid, email: 'h3@example.test', role: 'client' } as { id: string }],
          chartAccounts: accounts,
          customers,
          invoices,
          payments,
          transactions,
        };
        const rows = (tables[table] || []).map(r => ({
          id: r.id,
          data: r,
          updated_at: new Date().toISOString(),
        }));
        const accept = req.headers()['accept'] || '';
        if (accept.includes('application/vnd.pgrst.object+json')) {
          await route.fulfill({ status: 200, json: rows[0] || null });
        } else {
          await route.fulfill({ status: 200, json: rows });
        }
        return;
      }
      await route.fulfill({ status: 200, json: {} });
    });

    await page.route('**/api/**', async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      if (req.method() === 'POST' && url.pathname.endsWith('/next-number')) {
        await route.fulfill({ status: 200, json: { number: 'INV-1001' } });
        return;
      }
      if (req.method() === 'POST' && /\/api\/v1\/documents\/invoices\/([^/]+)\/post$/.test(url.pathname)) {
        const match = url.pathname.match(/\/api\/v1\/documents\/invoices\/([^/]+)\/post$/);
        const docId = decodeURIComponent(match?.[1] || 'inv-h3-1');
        const body = req.postDataJSON() as { data?: Partial<Invoice>; postingDay?: string };
        const invData = body.data || {};
        const totalCents = Number(invData.amountCents) || 25000;
        const invoiceRecord: Invoice = {
          id: docId,
          uid,
          workspaceId,
          number: String(invData.number || 'INV-1001'),
          customerId: String(invData.customerId || customers[0]?.id || 'cust-h3-1'),
          customerName: String(invData.customerName || customers[0]?.name || 'H3 Keyboard Customer'),
          date: String(invData.date || body.postingDay || '2026-10-26'),
          dueDate: String(invData.dueDate || invData.date || '2026-11-25'),
          status: (invData.status as Invoice['status']) || 'pending',
          amountCents: totalCents,
          amountPaidCents: 0,
          currency: 'USD',
          items: invData.items || [],
        };
        invoices.push(invoiceRecord);
        const invTx = makeTransaction({
          id: `tx-${docId}`,
          date: invoiceRecord.date,
          description: `Invoice ${invoiceRecord.number}`,
          totalAmountCents: totalCents,
          lines: TransactionTemplates.buildInvoiceLines({
            invoiceNumber: invoiceRecord.number,
            customerName: invoiceRecord.customerName,
            totalCents,
            taxCents: 0,
            arAccount: { id: 'ar', name: 'Accounts receivable' },
            revenueAccount: { id: 'revenue', name: 'Consulting revenue' },
          }),
        });
        transactions.push(invTx);
        await syncPageStores();
        await route.fulfill({ status: 200, json: { id: docId, transactions: [invTx] } });
        return;
      }
      if (req.method() === 'POST' && url.pathname.endsWith('/api/v1/payments')) {
        const body = req.postDataJSON() as Record<string, unknown>;
        paymentRequests.push(body);
        const amountCents = Number(body.amountCents) || 0;
        const allocations = Array.isArray(body.allocations) ? body.allocations as Payment['allocations'] : [];
        const allocatedCents = allocations.reduce((sum, a) => sum + (Number(a.amountCents) || 0), 0);
        const payRecord: Payment = {
          id: 'pay-h3-1',
          uid,
          workspaceId,
          direction: 'received',
          status: 'posted',
          contactId: String(body.customerId || customers[0]?.id || ''),
          date: String(body.paymentDate || '2026-10-26'),
          amountCents,
          currency: 'USD',
          method: 'bank_transfer',
          depositAccountId: String(body.cashAccountId || 'cash'),
          allocations,
          unappliedCents: Math.max(0, amountCents - allocatedCents),
          createdAt: new Date().toISOString(),
        };
        payments.push(payRecord);
        if (invoices[0]) {
          invoices[0] = {
            ...invoices[0],
            amountPaidCents: amountCents,
            status: amountCents >= (invoices[0].amountCents || 0) ? 'paid' : invoices[0].status,
          };
        }
        const payTx = makeTransaction({
          id: 'tx-pay-h3-1',
          date: payRecord.date,
          description: `Payment for ${invoices[0]?.number || 'INV-1001'}`,
          totalAmountCents: amountCents,
          lines: TransactionTemplates.buildPaymentLines({
            documentNumber: invoices[0]?.number || 'INV-1001',
            entityName: 'H3 Keyboard Customer',
            amountCents,
            cashAccount: { id: 'cash', name: 'Operating Cash' },
            offsetAccount: { id: 'ar', name: 'Accounts receivable' },
            isReceipt: true,
          }),
        });
        transactions.push(payTx);
        await syncPageStores();
        await route.fulfill({ status: 201, json: { id: payRecord.id, status: 'posted' } });
        return;
      }
      if (req.method() === 'GET' && url.pathname.endsWith('/api/v1/reports/profit-and-loss')) {
        const startDate = url.searchParams.get('startDate') || '2026-01-01';
        const endDate = url.searchParams.get('endDate') || '2026-12-31';
        const report = computeProfitAndLoss(accounts, transactions, startDate, endDate);
        await route.fulfill({ status: 200, json: report });
        return;
      }
      await route.fulfill({ status: 200, json: {} });
    });

    await page.evaluate(async ({ workspaceId, uid, accounts }) => {
      const [{ useAuthStore }, { useLedgerStore }, { useDataNeedsStore }] = await Promise.all([
        import('/src/stores/useAuthStore.ts'),
        import('/src/stores/useLedgerStore.ts'),
        import('/src/stores/useDataNeedsStore.ts'),
      ]);
      const signedIn = { uid, email: 'h3@example.test', isAnonymous: false, getIdToken: async () => 'h3-token' };
      const workspace = {
        id: workspaceId,
        uid,
        name: 'H3 Keyboard Books',
        currency: 'USD',
        fiscalYearStartMonth: 1,
        roles: { [uid]: 'owner' },
      };
      useAuthStore.setState({ user: signedIn, isGuest: false, currentWorkspaceId: workspaceId, workspaces: [workspace] } as never);
      useDataNeedsStore.setState({
        loaded: {
          transactions: true, accounts: true, customers: true, vendors: true,
          invoices: true, creditNotes: true, payments: true, estimates: true,
          bills: true, vendorCredits: true, inventory: true, budgets: true, projects: true,
        },
      } as never);
      useLedgerStore.setState({ accounts, customers: [], invoices: [], payments: [], transactions: [] });
    }, { workspaceId, uid, accounts });

    const pressButton = async (name: string | RegExp) => {
      const target = page.getByRole('button', { name }).first();
      await target.focus();
      await expect(target).toBeFocused();
      const outline = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return el ? getComputedStyle(el).outlineStyle : 'none';
      });
      expect(outline).not.toBe('none');
      await page.keyboard.press('Enter');
    };

    // 1. Navigate to Sales → Customers & Clients and create a customer via keyboard
    await pressButton('Money In');
    await pressButton('Invoices');
    await pressButton('Customers');
    const newCustomerInput = page.getByLabel('New customer name');
    await newCustomerInput.focus();
    await expect(newCustomerInput).toBeFocused();
    await page.keyboard.type('H3 Keyboard Customer');
    await page.keyboard.press('Enter');
    await expect(page.locator('#main-content')).toContainText('H3 Keyboard Customer');

    // 2. Switch to Invoices & AP and issue an invoice for that customer via keyboard
    await pressButton('Invoices');
    await pressButton(/Add Invoice/);
    await expect(page.getByRole('heading', { name: 'New invoice' })).toBeVisible();
    await page.getByLabel('Customer', { exact: true }).focus();
    await page.keyboard.type('H3 Keyboard Customer');
    for (let i = 0; i < 65; i++) {
      await page.keyboard.press('Tab');
      const label = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el) return '';
        const id = el.getAttribute('id');
        const byFor = id ? document.querySelector(`label[for="${id}"]`)?.textContent : '';
        return (byFor || el.getAttribute('aria-label') || el.textContent || '').trim();
      });
      if (label === 'Item / Description') await page.keyboard.type('Advisory Retainer');
      if (/^Rate/.test(label)) await page.keyboard.type('250');
      if (label === 'Save & Close') break;
    }
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'New invoice' })).toBeHidden({ timeout: 8000 });
    await expect(page.locator('#main-content')).toContainText('$250.00');

    // 3. Record payment on the invoice via keyboard and verify the payment write boundary
    const receiveBtn = page.getByRole('button', { name: 'Receive Payment' }).first();
    await receiveBtn.focus();
    await expect(receiveBtn).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Receive Customer Payment' })).toBeVisible();
    const recordBtn = page.getByRole('button', { name: 'Record & Post Payment' });
    await recordBtn.focus();
    await expect(recordBtn).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Receive Customer Payment' })).toBeHidden({ timeout: 8000 });

    expect(paymentRequests).toHaveLength(1);
    expect(paymentRequests[0]).toMatchObject({
      workspaceId,
      amountCents: 25000,
      customerId: customers[0].id,
      allocations: [{ documentId: invoices[0].id, documentType: 'invoice', amountCents: 25000 }],
    });
    await expect(page.locator('#main-content')).toContainText(/paid/i);

    // 4. Open Profit & Loss through the keyboard navigation and verify the posted figure
    await pressButton('Reports');
    await expect(page.getByRole('heading', { name: /Profit & Loss/i }).first()).toBeVisible();
    await expect(page.locator('#main-content')).toContainText('Consulting revenue');
    await expect(page.locator('#main-content')).toContainText('$250.00');
  });
});

