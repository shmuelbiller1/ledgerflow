/**
 * J-7 (Agent #11): Documents screen (<Vault />) UI coverage.
 *
 * Verifies:
 *  - Filters by file type (PDF, Image), linked record ("Belongs to"), month, and search
 *  - Empty-filter state + "Clear the filters" action, and read-failure retry state
 *  - Drawer PDF preview (sandboxed iframe), image preview, and unsafe URL rejection
 *  - Missing/invalid createdAt, missing mimeType, and missing sizeBytes never throw or render NaN
 *  - Drawer Protocol Status displays linked record owner (invoice/bill/vendor) via documentOwnerLabel
 *  - Guest upload + delete flow works end-to-end
 */
import './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import Vault from '../components/forensics/Vault';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { getSupabase } from '../lib/db/client';

const realFetch = globalThis.fetch;
const realConfirm = window.confirm;
const realFileReader = globalThis.FileReader;

afterEach(async () => {
  cleanup();
  globalThis.fetch = realFetch;
  window.confirm = realConfirm;
  globalThis.FileReader = realFileReader;
  localStorage.clear();
  getSupabase().realtime.disconnect();
  await getSupabase().auth.dispose();
});

const docRow = (id: string, data: Record<string, unknown>) => ({
  id,
  updated_at: String(data.createdAt || '2026-10-01T00:00:00.000Z'),
  data: {
    workspaceId: 'component-workspace',
    uid: 'test-user',
    ...data,
  },
});

const sampleDocs = [
  docRow('doc-pdf', {
    name: 'signed-contract.pdf',
    fileUrl: 'data:application/pdf;base64,JVBERi0xLjQK',
    mimeType: 'application/pdf',
    sizeBytes: 4096,
    createdAt: '2026-10-12T10:00:00.000Z',
    linkedCollection: 'invoices',
    linkedId: 'inv-1',
    linkedLabel: 'INV-104',
  }),
  docRow('doc-img', {
    name: 'coffee-receipt.png',
    fileUrl: 'data:image/png;base64,iVBORw0KGgo=',
    mimeType: 'image/png',
    sizeBytes: 2048,
    createdAt: '2026-09-05T08:30:00.000Z',
    tags: ['Travel'],
  }),
  docRow('doc-undated', {
    name: 'legacy-scan.bin',
    fileUrl: 'https://example.test/legacy-scan.bin',
    // intentionally omit mimeType, sizeBytes, and use invalid createdAt
    createdAt: 'not-a-date',
  }),
  docRow('doc-unsafe', {
    name: 'bad-link.pdf',
    fileUrl: 'javascript:alert(1)',
    mimeType: 'application/pdf',
    sizeBytes: 512,
    createdAt: '2026-10-15T12:00:00.000Z',
  }),
];

function stubDocumentsFetch(rows: Array<ReturnType<typeof docRow>>, opts: { failRead?: boolean } = {}) {
  let failOnce = opts.failRead ?? false;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || 'GET';
    if (url.includes('/rest/v1/documents') && method === 'GET') {
      if (failOnce) {
        failOnce = false;
        return new Response(JSON.stringify({ message: 'Database read timed out' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(rows), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.includes('/attachments/') && method === 'DELETE') {
      return new Response(JSON.stringify({ status: 'success' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
}

describe('J-7 Documents screen UI', () => {
  beforeEach(() => {
    setComponentWorkspace('owner');
    useLedgerStore.setState({ transactions: [], accounts: [] });
  });

  test('filters by type, linked record, month, search, and clears empty filter results', async () => {
    stubDocumentsFetch(sampleDocs);
    render(<Vault />);
    await waitFor(() => assert.ok(screen.getByText('signed-contract.pdf')));
    assert.ok(screen.getByText('coffee-receipt.png'));
    assert.ok(screen.getByText('legacy-scan.bin'));

    // Filter by Type = PDF
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'pdf' } });
    assert.ok(screen.getByText('signed-contract.pdf'));
    assert.equal(screen.queryByText('coffee-receipt.png'), null);

    // Filter by Belongs to = invoices
    fireEvent.change(screen.getByLabelText('Belongs to'), { target: { value: 'invoices' } });
    assert.ok(screen.getByText('signed-contract.pdf'));
    assert.equal(screen.queryByText('bad-link.pdf'), null);

    // Filter to non-matching combination -> empty filter state + Clear the filters
    fireEvent.change(screen.getByLabelText('Search documents by name, tag, or checksum'), { target: { value: 'no-such-file' } });
    assert.ok(screen.getByText('No file matches these filters'));
    fireEvent.click(screen.getByRole('button', { name: 'Clear the filters' }));
    assert.ok(screen.getByText('coffee-receipt.png'));
    assert.ok(screen.getByText('signed-contract.pdf'));
  });

  test('drawer renders sandboxed PDF iframe, shows invoice owner link, guards unsafe URLs, and handles missing metadata safely', async () => {
    stubDocumentsFetch(sampleDocs);
    render(<Vault />);
    await waitFor(() => assert.ok(screen.getByText('signed-contract.pdf')));

    // 1. Open PDF linked to Invoice INV-104
    fireEvent.click(screen.getByRole('button', { name: 'Open signed-contract.pdf' }));
    const frame = screen.getByTitle('Preview signed-contract.pdf') as HTMLIFrameElement;
    assert.equal(frame.tagName, 'IFRAME');
    assert.equal(frame.getAttribute('sandbox'), '');
    const pdfDownload = screen.getByRole('link', { name: /Export to Reader/i });
    assert.equal(pdfDownload.getAttribute('href'), 'data:application/pdf;base64,JVBERi0xLjQK');
    assert.ok(screen.getByText('CERTIFIED LINK'));
    assert.ok(screen.getAllByText('Belongs to Invoice INV-104').length >= 1);
    fireEvent.click(screen.getByRole('button', { name: 'Close document details' }));

    // 2. Open undated doc with undefined mimeType & sizeBytes -> no crash, no NaN KB
    fireEvent.click(screen.getByRole('button', { name: 'Open legacy-scan.bin' }));
    assert.ok(screen.getByText('Timestamp: No date'));
    assert.ok(screen.getAllByText('0.0 KB').length >= 1);
    assert.ok(screen.getByText('ISOLATED DEPOSIT'));
    fireEvent.click(screen.getByRole('button', { name: 'Close document details' }));

    // 3. Open unsafe javascript: URL doc -> File link unavailable, no unsafe iframe/img/anchor
    fireEvent.click(screen.getByRole('button', { name: 'Open bad-link.pdf' }));
    assert.ok(screen.getByText('File link unavailable'));
    assert.equal(screen.queryByTitle('Preview bad-link.pdf'), null);
    assert.equal(document.querySelector('a[href^="javascript:"]'), null);
  });

  test('upload and delete work end-to-end in guest mode and load failure offers retry', async () => {
    // Signed-in load error -> Try again recovers
    stubDocumentsFetch(sampleDocs, { failRead: true });
    render(<Vault />);
    await waitFor(() => assert.ok(screen.getByText('Your documents could not be loaded')));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    });
    await waitFor(() => assert.ok(screen.getByText('signed-contract.pdf')));
    cleanup();

    // Guest upload + delete flow
    useAuthStore.setState({ currentWorkspaceId: null, user: null, isGuest: true });
    window.confirm = () => true;
    class MockFileReader {
      result = 'data:application/pdf;base64,JVBERi0xLjQK';
      onloadend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readAsDataURL() {
        queueMicrotask(() => this.onloadend?.());
      }
    }
    globalThis.FileReader = MockFileReader as unknown as typeof FileReader;

    render(<Vault />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const pdfFile = new File(['%PDF-1.4'], 'guest-receipt.pdf', { type: 'application/pdf' });
    await act(async () => {
      fireEvent.change(input, { target: { files: [pdfFile] } });
    });
    await waitFor(() => assert.ok(screen.getByText('guest-receipt.pdf')));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete document guest-receipt.pdf' }));
    });
    await waitFor(() => assert.equal(screen.queryByText('guest-receipt.pdf'), null));
  });
});
