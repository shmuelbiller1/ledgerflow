import './helpers/dom';
import { stubFetchWithBodies } from './helpers/dom';
import test, { afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import SpreadDialog from '../components/common/SpreadDialog';
import PdfPreviewModal from '../components/ui/PdfPreviewModal';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { makeChartAccount } from './fixtures';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';

const accounts = [
  makeChartAccount({ id: 'exp', code: '6100', name: 'Insurance', type: 'expense', category: 'Operating Expenses' }),
  makeChartAccount({ id: 'pre', code: '1300', name: 'Prepaid Expenses', type: 'asset', category: 'Current Assets' }),
  makeChartAccount({ id: 'sales', code: '4000', name: 'Subscriptions', type: 'income', category: 'Revenue' }),
  makeChartAccount({ id: 'def', code: '2400', name: 'Deferred Revenue', type: 'liability', category: 'Current Liabilities' }),
];

describe('Audit 2026-11-16 UI regressions: SpreadDialog non-2-decimal/FX & PdfPreviewModal preview=1', () => {
  afterEach(() => cleanup());

  test('SpreadDialog formats and parses 0-decimal JPY workspace amounts without * 100 or / 100 corruption', async () => {
    setComponentWorkspace('bookkeeper');
    useAuthStore.setState(st => ({
      workspaces: st.workspaces.map(w => (w.id === st.currentWorkspaceId ? { ...w, currency: 'JPY' } : w)),
    }));
    useLedgerStore.setState({ accounts });
    const calls = stubFetchWithBodies(200, { status: 'success', data: {} });
    let closed = 0;
    const jpyBill = {
      id: 'b_jpy',
      number: 'BILL-JPY-1',
      vendorName: 'Tokyo Hosting KK',
      date: '2026-10-15',
      currency: 'JPY',
      amountCents: 120000,
      splits: [{ accountId: 'exp', amountCents: 120000 }],
    };

    render(<SpreadDialog kind="bill" document={jpyBill} onClose={() => closed++} />);
    const input = screen.getByLabelText('Amount (JPY)') as HTMLInputElement;
    assert.equal(input.value, '120000');
    assert.match(document.body.textContent || '', /¥10,000 a month/);

    await act(async () => {
      fireEvent.change(input, { target: { value: '60000' } });
    });
    assert.match(document.body.textContent || '', /¥5,000 a month/);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Spread' }));
    });
    const sent = calls.filter(c => c.url.includes('/spread'));
    assert.equal(sent.length, 1);
    assert.equal((sent[0].body as { amountCents: number }).amountCents, 60000);
    assert.equal(closed, 1);
  });

  test('SpreadDialog formats and parses 3-decimal KWD workspace amounts accurately', async () => {
    setComponentWorkspace('bookkeeper');
    useAuthStore.setState(st => ({
      workspaces: st.workspaces.map(w => (w.id === st.currentWorkspaceId ? { ...w, currency: 'KWD' } : w)),
    }));
    useLedgerStore.setState({ accounts });
    const calls = stubFetchWithBodies(200, { status: 'success', data: {} });
    const kwdBill = {
      id: 'b_kwd',
      number: 'BILL-KWD-1',
      vendorName: 'Kuwait Fiber',
      date: '2026-10-15',
      currency: 'KWD',
      amountCents: 12345,
      splits: [{ accountId: 'exp', amountCents: 12345 }],
    };

    render(<SpreadDialog kind="bill" document={kwdBill} onClose={() => {}} />);
    const input = screen.getByLabelText('Amount (KWD)') as HTMLInputElement;
    assert.equal(input.value, '12.345');

    await act(async () => {
      fireEvent.change(input, { target: { value: '12.000' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Spread' }));
    });
    const sent = calls.filter(c => c.url.includes('/spread'));
    assert.equal(sent.length, 1);
    assert.equal((sent[0].body as { amountCents: number }).amountCents, 12000);
  });

  test('SpreadDialog converts a JPY bill to USD base minor units accurately', async () => {
    setComponentWorkspace('bookkeeper');
    useAuthStore.setState(st => ({
      workspaces: st.workspaces.map(w => (w.id === st.currentWorkspaceId ? { ...w, currency: 'USD' } : w)),
    }));
    useLedgerStore.setState({ accounts });
    const calls = stubFetchWithBodies(200, { status: 'success', data: {} });
    const fxBill = {
      id: 'b_fx_jpy',
      number: 'BILL-FX-1',
      vendorName: 'Osaka Cloud',
      date: '2026-10-15',
      currency: 'JPY',
      exchangeRate: 0.0067,
      amountCents: 110000,
      splits: [{ accountId: 'exp', amountCents: 100000 }],
    };

    render(<SpreadDialog kind="bill" document={fxBill} onClose={() => {}} />);
    const input = screen.getByLabelText('Amount (USD)') as HTMLInputElement;
    assert.equal(input.value, '670.00');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Spread' }));
    });
    const sent = calls.filter(c => c.url.includes('/spread'));
    assert.equal(sent.length, 1);
    assert.equal((sent[0].body as { amountCents: number }).amountCents, 67000);
  });

  test('PdfPreviewModal reuses the preview blob when X-Preview-Only is absent (unpatched server)', async () => {
    const urls: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response('%PDF-1.4\n', { status: 200, headers: { 'content-type': 'application/pdf' } });
    }) as typeof fetch;

    try {
      await act(async () => {
        render(
          <PdfPreviewModal
            isOpen
            onClose={() => {}}
            title="Invoice INV-1"
            documentType="invoice"
            documentId="inv-1"
            workspaceId="ws-1"
          />
        );
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      assert.equal(urls.length, 1);
      assert.ok(urls[0].includes('/api/v1/documents/invoice/inv-1/pdf?') && urls[0].includes('preview=1'));

      const downloadBtn = await screen.findByRole('button', { name: 'Download PDF' });
      await act(async () => {
        fireEvent.click(downloadBtn);
        await Promise.resolve();
        await Promise.resolve();
      });

      assert.equal(urls.length, 1, 'Expected Download PDF to reuse preview blob when X-Preview-Only header is absent');
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test('PdfPreviewModal previews with ?preview=1 and refetches without ?preview=1 when X-Preview-Only: 1 is returned', async () => {
    const urls: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      const headers: Record<string, string> = { 'content-type': 'application/pdf' };
      if (url.includes('preview=1')) headers['x-preview-only'] = '1';
      return new Response('%PDF-1.4\n', { status: 200, headers });
    }) as typeof fetch;

    try {
      await act(async () => {
        render(
          <PdfPreviewModal
            isOpen
            onClose={() => {}}
            title="Invoice INV-1"
            documentType="invoice"
            documentId="inv-1"
            workspaceId="ws-1"
          />
        );
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      assert.ok(urls.some(u => u.includes('/api/v1/documents/invoice/inv-1/pdf?') && u.includes('preview=1')), `Expected preview=1 in ${JSON.stringify(urls)}`);

      const downloadBtn = await screen.findByRole('button', { name: 'Download PDF' });
      await act(async () => {
        fireEvent.click(downloadBtn);
        await Promise.resolve();
        await Promise.resolve();
      });

      const downloadUrls = urls.filter(u => !u.includes('preview=1'));
      assert.ok(downloadUrls.some(u => u.includes('/api/v1/documents/invoice/inv-1/pdf?workspaceId=ws-1')), `Expected non-preview download URL in ${JSON.stringify(urls)}`);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
