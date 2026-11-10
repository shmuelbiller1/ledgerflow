/**
 * R-4: a note per report and period, kept on the workspace, shown above the report (and so in its print / PDF).
 */
import './helpers/dom';
import test, { afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ReportNote from '../components/reporting/ReportNote';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { useAuthStore } from '../stores/useAuthStore';
import { getSupabase } from '../lib/db/client';
import { REPORT_NOTE_MAX, reportNoteKey, withReportNote } from '../lib/reportNotes';

describe('R-4: report notes', () => {
  test('one note per report and period; blank removes it; too long is refused', () => {
    const key = reportNoteKey('pnl', '2026-03-01', '2026-03-31');
    assert.equal(key, 'pnl|2026-03-01|2026-03-31');
    const set = withReportNote({ other: 'kept' }, key, '  Rent paid late  ');
    assert.deepEqual(set, { notes: { other: 'kept', [key]: 'Rent paid late' } });
    assert.deepEqual(withReportNote((set as { notes: Record<string, string> }).notes, key, '   '), { notes: { other: 'kept' } });
    assert.ok('problem' in withReportNote({}, key, 'x'.repeat(REPORT_NOTE_MAX + 1)));
  });
});

describe('R-4: the note on the report', () => {
  const realFetch = globalThis.fetch;
  afterEach(async () => { cleanup(); globalThis.fetch = realFetch; await getSupabase().auth.dispose(); });
  const key = reportNoteKey('pnl', '2026-03-01', '2026-03-31');
  const withNotes = (role: 'owner' | 'viewer' | 'bookkeeper', reportNotes?: Record<string, string>) => {
    const ws = setComponentWorkspace(role);
    useAuthStore.setState({ workspaces: [{ ...ws, ...(reportNotes ? { reportNotes } : {}) } as never] });
  };

  test('a writer adds a note: it is saved under the report and period, and shown', async () => {
    withNotes('owner');
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), body: typeof init?.body === 'string' ? JSON.parse(init.body) : {} });
      return new Response('null', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    render(<ReportNote report="pnl" startDate="2026-03-01" endDate="2026-03-31" />);
    fireEvent.click(screen.getByRole('button', { name: 'Add a note for this period' }));
    fireEvent.change(screen.getByLabelText('Note for this report and period'), { target: { value: 'Rent was paid late' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save note' })); });
    await waitFor(() => assert.ok(calls.some(c => c.url.includes('lf_update'))));
    const saved = (calls.find(c => c.url.includes('lf_update'))!.body.p_set as { reportNotes: Record<string, string> }).reportNotes;
    assert.deepEqual(saved, { [key]: 'Rent was paid late' });
    await waitFor(() => assert.match(screen.getByTestId('report-note').textContent || '', /Note: Rent was paid late/));
  });

  test('a bookkeeper reads the note but cannot write one (workspace settings are for owners and accountants)', () => {
    withNotes('bookkeeper', { [key]: 'Rent was paid late' });
    render(<ReportNote report="pnl" startDate="2026-03-01" endDate="2026-03-31" />);
    assert.match(screen.getByTestId('report-note').textContent || '', /Rent was paid late/);
    assert.equal(screen.queryByRole('button', { name: 'Edit note' }), null);
  });

  test('a viewer reads the note and cannot change it; with no note, a viewer sees nothing', () => {
    withNotes('viewer', { [key]: 'Rent was paid late' });
    const { unmount } = render(<ReportNote report="pnl" startDate="2026-03-01" endDate="2026-03-31" />);
    assert.match(screen.getByTestId('report-note').textContent || '', /Rent was paid late/);
    assert.equal(screen.queryByRole('button', { name: 'Edit note' }), null);
    unmount();
    render(<ReportNote report="pnl" startDate="2026-04-01" endDate="2026-04-30" />);
    assert.equal(screen.queryByTestId('report-note'), null, 'another period has no note');
  });
});
