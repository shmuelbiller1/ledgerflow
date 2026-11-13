/**
 * EU-C4: the "Snap a receipt" dialog, mounted. The database writes are stubbed at the dialog's own
 * boundary (`writes`), so these tests see exactly what would be saved, and in which order.
 */
import './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SnapReceiptDialog, { type ReceiptWrites } from '../components/layout/SnapReceiptDialog';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { SAMPLE_UID, SAMPLE_WORKSPACE_ID } from '../lib/db/guestDatabase';
import type { Vendor, Workspace } from '../types';

type Call = [string, unknown[]];
const vendors = [
  { id: 'v1', name: 'Corner Hardware', status: 'active' },
  { id: 'v2', name: 'Old Supplier', status: 'archived' },
  { id: 'v3', name: 'Paused Vendor', status: 'inactive' },
] as unknown as Vendor[];

function stubWrites(calls: Call[], fail: Partial<Record<keyof ReceiptWrites, string>> = {}): ReceiptWrites {
  const step = <T,>(name: keyof ReceiptWrites, value: T) => async (...args: unknown[]) => {
    calls.push([name, args]);
    if (fail[name]) throw new Error(fail[name]);
    return value;
  };
  return { saveDocument: step('saveDocument', 'doc-1'), saveBill: step('saveBill', 'bill-1'), linkDocument: step('linkDocument', undefined) } as ReceiptWrites;
}

async function fillIn(amount = '42.50') {
  const photo = new window.File([new Uint8Array([1, 2, 3])], 'IMG_0042.JPG', { type: 'image/jpeg' });
  await act(async () => { fireEvent.change(screen.getByTestId('snap-receipt-photo'), { target: { files: [photo] } }); });
  await screen.findByAltText('Snapped receipt');
  fireEvent.change(screen.getByLabelText('Vendor'), { target: { value: 'v1' } });
  fireEvent.change(screen.getByLabelText('Amount'), { target: { value: amount } });
  fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-11-12' } });
}

describe('EU-C4: Snap a receipt', () => {
  let calls: Call[] = [];
  let closed = 0;
  beforeEach(() => {
    calls = [];
    closed = 0;
    setComponentWorkspace('owner');
    useLedgerStore.setState({ vendors });
    markComponentCollectionsLoaded('vendors');
  });
  afterEach(() => cleanup());

  test('saves the photo, then a draft bill for it, then links the two', async () => {
    render(<SnapReceiptDialog onClose={() => { closed++; }} writes={stubWrites(calls)} />);
    await fillIn();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save draft' })); });
    await waitFor(() => assert.equal(closed, 1));
    assert.deepEqual(calls.map(([name]) => name), ['saveDocument', 'saveBill', 'linkDocument']);
    const documentData = calls[0][1][0] as Record<string, unknown>;
    assert.deepEqual({ ...documentData, createdAt: 'x', fileUrl: String(documentData.fileUrl).slice(0, 15) }, {
      uid: 'test-user', workspaceId: 'component-workspace', name: 'Receipt 2026-11-12.jpg', fileUrl: 'data:image/jpeg',
      mimeType: 'image/jpeg', sizeBytes: 3, tags: ['Receipt'], createdAt: 'x',
    });
    assert.deepEqual(calls[1][1][0], {
      vendorId: 'v1', vendorName: 'Corner Hardware', amountCents: 4_250, amountPaidCents: 0,
      date: '2026-11-12', issueDate: '2026-11-12', dueDate: '2026-11-12', currency: 'USD',
      status: 'draft', posted: false, tags: ['Receipt'],
      splits: [{ amountCents: 4_250, accountId: '', description: 'Receipt' }],
      metadata: { source: 'phone-receipt', receiptDocId: 'doc-1' },
    });
    assert.deepEqual(calls[2][1], ['doc-1', { linkedCollection: 'bills', linkedId: 'bill-1', linkedLabel: 'Corner Hardware receipt (draft)' }]);
  });

  test('archived and inactive vendors are not offered', () => {
    render(<SnapReceiptDialog onClose={() => {}} writes={stubWrites(calls)} />);
    const options = [...(screen.getByLabelText('Vendor') as HTMLSelectElement).options].map(o => o.textContent);
    assert.deepEqual(options, ['Choose a vendor', 'Corner Hardware']);
  });

  test('a refused bill keeps the dialog open and says the photo is in Documents', async () => {
    render(<SnapReceiptDialog onClose={() => { closed++; }} writes={stubWrites(calls, { saveBill: 'the database refused it' })} />);
    await fillIn();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save draft' })); });
    const alert = await screen.findByRole('alert');
    assert.equal(alert.textContent, 'The photo is saved in Documents, but the database refused it. Open Documents to try again.');
    assert.equal(closed, 0);
    assert.deepEqual(calls.map(([name]) => name), ['saveDocument', 'saveBill']);
  });

  test('switching workspace drops the receipt instead of saving it into the other books', async () => {
    render(<SnapReceiptDialog onClose={() => { closed++; }} writes={stubWrites(calls)} />);
    await fillIn();
    const other: Workspace = { ...useAuthStore.getState().workspaces[0], id: 'other-workspace' };
    act(() => { useAuthStore.setState({ workspaces: [...useAuthStore.getState().workspaces, other], currentWorkspaceId: 'other-workspace' }); });
    await waitFor(() => assert.equal(closed, 1));
    assert.deepEqual(calls, [], 'nothing was written');
  });

  test('the sample company saves through its local editor', async () => {
    const sample: Workspace = { id: SAMPLE_WORKSPACE_ID, uid: SAMPLE_UID, name: 'Sample', businessType: 'custom', createdAt: '2026-01-01', currency: 'USD', roles: {} };
    useAuthStore.setState({ user: null, isGuest: true, currentWorkspaceId: SAMPLE_WORKSPACE_ID, workspaces: [sample] });
    render(<SnapReceiptDialog onClose={() => { closed++; }} writes={stubWrites(calls)} />);
    await fillIn('7');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save draft' })); });
    await waitFor(() => assert.equal(closed, 1));
    const documentData = calls[0][1][0] as Record<string, unknown>;
    assert.equal(documentData.uid, SAMPLE_UID);
    assert.equal(documentData.workspaceId, SAMPLE_WORKSPACE_ID);
    assert.equal((calls[1][1][0] as { amountCents: number }).amountCents, 700);
  });
});
