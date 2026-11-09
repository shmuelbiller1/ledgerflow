/**
 * A-36 screen: record notes. Hand-checked from the loaded records: a two-word search finds the
 * notes carrying both words newest first, the record picker opens that record's notes panel, a
 * writer adds a note and sees it with who and when, and a viewer reads but cannot write. Notes
 * come from the record's own metadata; junk there is ignored.
 */
import './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import RecordNotesReportView from '../components/reporting/RecordNotesReportView';
import RecordNotesPanel from '../components/common/RecordNotesPanel';
import { recordNotesFromMetadata, RECORD_NOTES_METADATA_KEY } from '../lib/recordNotes';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useDataNeedsStore } from '../stores/useDataNeedsStore';
import { useAuthStore } from '../stores/useAuthStore';

/** Database writes go through the Supabase `lf_update` RPC; let those succeed and nothing else. */
function stubDbWrites(): void {
  globalThis.fetch = (async (input: RequestInfo | URL) => (
    String(input).includes('/rpc/') ? new Response('{}', { status: 200 }) : new Response('{}', { status: 404 })
  )) as typeof fetch;
}

const note = (id: string, body: string, at: string, entityId = 'c1', entityType = 'customer') => ({
  id, workspaceId: 'w1', entityType, entityId, body, authorUid: 'u2', authorName: 'Dana', createdAt: at,
});

const customers = [
  {
    id: 'c1', name: 'Acme Ltd', workspaceId: 'w1',
    metadata: { [RECORD_NOTES_METADATA_KEY]: [
      note('n1', 'Called about the late invoice', '2026-10-01T09:00:00Z'),
      note('n2', 'Late invoice paid, they asked for Net 45', '2026-10-02T09:00:00Z'),
    ] },
  },
  { id: 'c2', name: 'Beta GmbH', workspaceId: 'w1', metadata: {} },
];
const vendors = [
  {
    id: 'v1', name: 'Paper Co', workspaceId: 'w1',
    metadata: { [RECORD_NOTES_METADATA_KEY]: [note('n3', 'Moved warehouse', '2026-10-03T09:00:00Z', 'v1', 'vendor')] },
  },
];

describe('record notes library: what the metadata carries', () => {
  test('junk in metadata is ignored, real notes are kept', () => {
    const notes = recordNotesFromMetadata({
      [RECORD_NOTES_METADATA_KEY]: [
        { id: 'n1', body: 'ok', createdAt: '2026-10-01T09:00:00Z', entityType: 'customer', entityId: 'c1', workspaceId: 'w1' },
        { id: 'broken' }, 'not a note', null, { body: 'no id' },
      ],
    });
    assert.deepEqual(notes.map(n => n.id), ['n1']);
    assert.deepEqual(recordNotesFromMetadata({}), []);
    assert.deepEqual(recordNotesFromMetadata({ [RECORD_NOTES_METADATA_KEY]: 'nope' }), []);
    assert.deepEqual(recordNotesFromMetadata(null), []);
  });
});

describe('Record notes screen', () => {
  beforeEach(() => {
    stubDbWrites();
    useAuthStore.setState({
      isGuest: false, user: { uid: 'u1', email: 'dana@shop.test' } as never,
      currentWorkspaceId: 'w1', workspaces: [{ id: 'w1', uid: 'u1', name: 'W', currency: 'USD' }] as never,
    });
    useDataNeedsStore.setState({ failed: {} as never });
    useLedgerStore.setState({
      customers: customers as never, vendors: vendors as never, inventory: [] as never,
      invoices: [] as never, bills: [] as never, estimates: [] as never,
      transactions: [] as never, projects: [] as never, truncatedCollections: {} as never,
    });
  });
  afterEach(() => { cleanup(); });

  test('a two-word search finds the notes with both words, newest first, with their record', () => {
    render(<RecordNotesReportView />);
    assert.match(screen.getByText(/3 note\(s\) recorded/).textContent || '', /^3 note/);
    fireEvent.change(screen.getByLabelText('Search every note'), { target: { value: 'invoice late' } });
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    assert.equal(rows.length, 2);
    assert.match(rows[0].textContent || '', /Late invoice paid/);
    assert.match(rows[0].textContent || '', /Acme Ltd/);
    assert.match(rows[1].textContent || '', /Called about the late invoice/);
    assert.match(screen.getByText(/2 match this search/).textContent || '', /2 match this search/);
    fireEvent.change(screen.getByLabelText('Search every note'), { target: { value: 'warehouse' } });
    assert.match(within(screen.getByRole('table')).getAllByRole('row')[1].textContent || '', /Moved warehouse/);
    assert.match(within(screen.getByRole('table')).getAllByRole('row')[1].textContent || '', /Paper Co/);
  });

  test('a search hit opens the record it is on', () => {
    render(<RecordNotesReportView />);
    fireEvent.change(screen.getByLabelText('Search every note'), { target: { value: 'warehouse' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open notes on Paper Co' }));
    const panel = screen.getByRole('region', { name: 'Notes on Paper Co' });
    assert.ok(within(panel).getByText('Moved warehouse'));
    assert.equal((screen.getByLabelText('Record') as HTMLSelectElement).value, 'v1');
    assert.equal((screen.getByLabelText('Record kind') as HTMLSelectElement).value, 'vendor');
  });

  test('a writer adds a note and sees it with who and when', async () => {
    render(<RecordNotesReportView />);
    const panel = screen.getByRole('region', { name: 'Notes on Acme Ltd' });
    assert.ok(within(panel).getByText('Called about the late invoice'));
    assert.ok(within(panel).getByText('Late invoice paid, they asked for Net 45'));
    assert.ok(within(panel).getAllByText('Dana').length >= 1);
    fireEvent.change(within(panel).getByLabelText('New note on Acme Ltd'), { target: { value: 'Promised a PO by Friday' } });
    await act(async () => { fireEvent.click(within(panel).getByRole('button', { name: 'Add note' })); });
    await waitFor(() => assert.ok(within(panel).getByText('Promised a PO by Friday')));
    assert.match(within(panel).getByText('Promised a PO by Friday').closest('li')?.textContent || '', /dana@shop\.test/);
  });

  test('a missing secure random source refuses the note and retains its draft', async () => {
    render(<RecordNotesReportView />);
    const panel = screen.getByRole('region', { name: 'Notes on Acme Ltd' });
    const input = within(panel).getByLabelText('New note on Acme Ltd') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'Please retain this draft' } });
    const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto')!;
    try {
      Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
      await act(async () => { fireEvent.click(within(panel).getByRole('button', { name: 'Add note' })); });
      assert.match(within(panel).getByRole('alert').textContent || '', /secure identifier/);
      assert.equal(input.value, 'Please retain this draft');
    } finally {
      Object.defineProperty(globalThis, 'crypto', original);
    }
  });

  test('an empty note is refused in words', async () => {
    render(<RecordNotesReportView />);
    const panel = screen.getByRole('region', { name: 'Notes on Acme Ltd' });
    await act(async () => { fireEvent.click(within(panel).getByRole('button', { name: 'Add note' })); });
    assert.ok(within(panel).getByText('Write something first.'));
  });

  test('a viewer reads the notes but gets no note box', () => {
    useAuthStore.setState({
      user: { uid: 'u9' } as never,
      workspaces: [{ id: 'w1', uid: 'u1', name: 'W', currency: 'USD', roles: { u9: 'viewer' } }] as never,
    });
    render(<RecordNotesReportView />);
    const panel = screen.getByRole('region', { name: 'Notes on Acme Ltd' });
    assert.ok(within(panel).getByText('Called about the late invoice'));
    assert.ok(!within(panel).queryByLabelText('New note on Acme Ltd'));
  });
});

describe('Notes panel on a record', () => {
  afterEach(() => { cleanup(); });

  test('the author can change their own note, and the panel names the record', async () => {
    stubDbWrites();
    useAuthStore.setState({
      isGuest: false, user: { uid: 'u2', email: 'dana@shop.test' } as never,
      currentWorkspaceId: 'w1', workspaces: [{ id: 'w1', uid: 'u1', name: 'W', currency: 'USD' }] as never,
    });
    useLedgerStore.setState({ truncatedCollections: {} as never });
    render(<RecordNotesPanel entityType="customer" entityId="c1" entityName="Acme Ltd"
      metadata={{ [RECORD_NOTES_METADATA_KEY]: [note('n1', 'Called about the late invoice', '2026-10-01T09:00:00Z')] }} />);
    assert.ok(screen.getByRole('region', { name: 'Notes on Acme Ltd' }));
    const change = screen.getByRole('button', { name: /Change note on Acme Ltd/ });
    fireEvent.click(change);
    fireEvent.change(screen.getByLabelText('Change note on Acme Ltd'), { target: { value: 'Called twice' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save note' })); });
    await waitFor(() => assert.ok(screen.getByText('Called twice')));
    assert.match(screen.getByText('Called twice').closest('li')?.textContent || '', /edited/);
  });

  test('a note of someone else cannot be changed from the panel', () => {
    stubDbWrites();
    useAuthStore.setState({
      isGuest: false, user: { uid: 'u1', email: 'other@shop.test' } as never,
      currentWorkspaceId: 'w1', workspaces: [{ id: 'w1', uid: 'u1', name: 'W', currency: 'USD' }] as never,
    });
    render(<RecordNotesPanel entityType="customer" entityId="c1" entityName="Acme Ltd"
      metadata={{ [RECORD_NOTES_METADATA_KEY]: [note('n1', 'Called about the late invoice', '2026-10-01T09:00:00Z')] }} />);
    assert.ok(!screen.queryByRole('button', { name: /Change note on Acme Ltd/ }));
  });

  test('the comment thread posts an @mention reply and allows editing within 10 minutes (A-21 / A-181)', async () => {
    stubDbWrites();
    useAuthStore.setState({
      isGuest: false, user: { uid: 'u1', displayName: 'Alex', email: 'alex@shop.test' } as never,
      currentWorkspaceId: 'w1', workspaces: [{ id: 'w1', uid: 'u1', name: 'W', currency: 'USD', roles: { u2: 'accountant' } }] as never,
    });
    render(<RecordNotesPanel entityType="customer" entityId="c1" entityName="Acme Ltd" metadata={{}} />);
    fireEvent.change(screen.getByLabelText('New comment on Acme Ltd'), { target: { value: 'Ping @u2 about the renewal quote' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Post comment' })); });
    await waitFor(() => assert.ok(screen.getByText('Ping @u2 about the renewal quote')));
    assert.match(document.body.textContent || '', /mentioned: u2/);

    fireEvent.click(screen.getByRole('button', { name: 'Edit comment on Acme Ltd' }));
    fireEvent.change(screen.getByLabelText('Edit comment on Acme Ltd'), { target: { value: 'Ping @u2 — renewal confirmed' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save comment' })); });
    await waitFor(() => assert.ok(screen.getByText('Ping @u2 — renewal confirmed')));
  });
});
