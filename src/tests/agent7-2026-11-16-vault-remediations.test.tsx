/**
 * Agent #7 (2026-11-16) authorized-lane remediations A7C-04 / A7C-05 (Vault).
 *
 * Kept in its own file: the Vault and Sales screens each pull in the whole ledger store, and rendering
 * both in one test process exhausts the runner's heap.
 *
 * - A7C-04: signed-in deletions go through the server attachment route; a refusal keeps the row
 *   instead of claiming a local removal that never happened.
 * - A7C-05: receipt injection is idempotent (deterministic id + operation key + stable timestamp),
 *   books in the workspace currency, and refuses an already-linked document.
 */
import './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import Vault from '../components/forensics/Vault';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { makeChartAccount } from './fixtures';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { getSupabase } from '../lib/db/client';

const realFetch = globalThis.fetch;
const realConfirm = window.confirm;

afterEach(async () => {
  cleanup();
  globalThis.fetch = realFetch;
  window.confirm = realConfirm;
  localStorage.clear();
  getSupabase().realtime.disconnect();
  await getSupabase().auth.dispose();
});

type FetchCall = { url: string; method: string; body: unknown; headers: Record<string, string> };

const vaultAccounts = [
  makeChartAccount({ id: 'bank', name: 'Operating Bank', type: 'asset', category: 'Cash' }),
  makeChartAccount({ id: 'exp', name: 'Office Supplies', type: 'expense', category: 'Expenses' }),
];

const docRow = (id: string, name: string, createdAt: string, extra: Record<string, unknown> = {}) => ({
  id,
  updated_at: createdAt,
  data: {
    workspaceId: 'component-workspace', uid: 'test-user', name,
    fileUrl: 'https://example.test/receipt.png', mimeType: 'image/png', sizeBytes: 2048, createdAt, ...extra,
  },
});

/**
 * Stubs the documents read, the attachment delete, the OCR call and the transaction write.
 * `rows` is live: a successful delete removes the row from it, exactly as the server would, so the
 * screen's refetch cannot resurrect a document it just deleted.
 */
function stubVaultFetch(
  rows: Array<ReturnType<typeof docRow>>,
  opts: { deleteStatus?: number; deleteBody?: unknown } = {},
) {
  const calls: FetchCall[] = [];
  const store = [...rows];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || 'GET';
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => { headers[k] = v; });
    calls.push({ url, method, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined, headers });
    const json = (payload: unknown, status = 200) =>
      new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
    if (url === 'https://example.test/receipt.png') {
      return new Response(new Blob(['fake-image'], { type: 'image/png' }), { status: 200 });
    }
    if (url.includes('/rest/v1/documents') && method === 'GET') return json(store);
    if (url.includes('/attachments/') && method === 'DELETE') {
      const status = opts.deleteStatus ?? 200;
      if (status < 300) {
        const id = decodeURIComponent(url.split('/attachments/')[1]);
        const at = store.findIndex(r => r.id === id);
        if (at >= 0) store.splice(at, 1);
      }
      return json(opts.deleteBody ?? { status: 'success' }, status);
    }
    if (url.includes('/api/ai/process')) {
      return json({
        vendorName: 'Acme Store', date: '2026-11-10', totalAmountCents: 12_050, taxAmountCents: 0,
        lines: [{ description: 'Widget', amountCents: 12_050 }],
      });
    }
    if (url.includes('/api/v1/transactions') && method === 'POST') return json({ status: 'ok' });
    return json(null);
  }) as typeof fetch;
  return calls;
}

const openReceipt = async () => {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Open receipt.png' })); });
  await waitFor(() => assert.ok(screen.getByRole('dialog'), 'the document detail overlay opens'));
};

describe('A7C-04: Vault deletes go through the server', () => {
  beforeEach(() => {
    setComponentWorkspace('owner');
    useLedgerStore.setState({ accounts: vaultAccounts, transactions: [] });
    window.confirm = () => true;
  });

  test('a signed-in delete calls the attachment route and removes the row', async () => {
    const calls = stubVaultFetch([docRow('doc1', 'receipt.png', '2026-11-10T09:00:00.000Z')]);
    render(<Vault />);
    await waitFor(() => assert.ok(screen.queryAllByText('receipt.png').length > 0));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Delete document receipt.png' })); });
    await waitFor(() => assert.equal(screen.queryAllByText('receipt.png').length, 0));
    const removal = calls.find(c => c.method === 'DELETE');
    assert.ok(removal, 'the delete went to the server');
    assert.equal(removal.url, '/api/v1/workspaces/component-workspace/attachments/doc1');
  });

  test('a refused delete keeps the row instead of claiming local removal', async () => {
    const calls = stubVaultFetch([docRow('doc1', 'receipt.png', '2026-11-10T09:00:00.000Z')], {
      deleteStatus: 403,
      deleteBody: { message: 'Only owners can remove files.' },
    });
    render(<Vault />);
    await waitFor(() => assert.ok(screen.queryAllByText('receipt.png').length > 0));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Delete document receipt.png' })); });
    await waitFor(() => assert.ok(calls.some(c => c.method === 'DELETE')), { timeout: 4000 });
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });
    assert.ok(screen.queryAllByText('receipt.png').length > 0, 'the document is still listed after the refusal');
  });
});

describe('A7C-05: Vault receipt injection is idempotent and workspace-currency aware', () => {
  beforeEach(() => {
    const ws = setComponentWorkspace('owner');
    useAuthStore.setState({ workspaces: [{ ...ws, currency: 'ILS' }] });
    useLedgerStore.setState({ accounts: vaultAccounts, transactions: [] });
    window.confirm = () => true;
  });

  test('inject posts one deterministic entry in the workspace currency with the document timestamp', async () => {
    const calls = stubVaultFetch([docRow('doc1', 'receipt.png', '2026-11-10T09:00:00.000Z')]);
    render(<Vault />);
    await waitFor(() => assert.ok(screen.queryAllByText('receipt.png').length > 0));
    await openReceipt();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Deep OCR Scan/ })); });
    await waitFor(() => assert.ok(screen.getByRole('button', { name: 'Inject & Sync Ledger' })));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Inject & Sync Ledger' })); });
    await waitFor(() => assert.ok(calls.some(c => c.url.includes('/api/v1/transactions') && c.method === 'POST')));
    const posts = calls.filter(c => c.url.includes('/api/v1/transactions') && c.method === 'POST');
    assert.equal(posts.length, 1, 'one entry per receipt');
    const post = posts[0];
    const tx = (post.body as { transaction: Record<string, unknown> }).transaction;
    assert.equal(tx.id, 'vault-receipt-doc1', 'the entry id is derived from the document, so a retry posts once');
    assert.equal(post.headers['x-operation-id'], 'vault-receipt-doc1');
    assert.equal(tx.currency, 'ILS', 'the workspace currency, not hardcoded USD');
    assert.equal(tx.createdAt, '2026-11-10T09:00:00.000Z', 'the document timestamp, stable across retries');
    assert.equal(tx.date, '2026-11-10');
    // after injection the document shows as certified and cannot be injected again
    await openReceipt();
    assert.equal(screen.queryByRole('button', { name: 'Inject & Sync Ledger' }), null);
    assert.equal((screen.getByRole('button', { name: /Already Synced/ }) as HTMLButtonElement).disabled, true);
  });

  test('an already-linked document offers no inject', async () => {
    const calls = stubVaultFetch([
      docRow('doc1', 'receipt.png', '2026-11-10T09:00:00.000Z', { linkedTransactionId: 'tx-existing' }),
    ]);
    render(<Vault />);
    await waitFor(() => assert.ok(screen.queryAllByText('receipt.png').length > 0));
    await openReceipt();
    assert.equal(screen.queryByRole('button', { name: 'Inject & Sync Ledger' }), null);
    assert.equal((screen.getByRole('button', { name: /Already Synced/ }) as HTMLButtonElement).disabled, true);
    assert.equal(calls.filter(c => c.url.includes('/api/v1/transactions')).length, 0, 'nothing was posted');
  });
});
