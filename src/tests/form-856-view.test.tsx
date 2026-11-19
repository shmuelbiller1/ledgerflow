/**
 * A-23 (PLAN IL-5) screen: the yearly withholding report. Hand-checked from the loaded payments:
 * one 2026 vendor row with its certificates and an effective rate, the note about the payment with
 * no certificate number, another year chosen from the picker, and the empty state for a year with
 * nothing withheld.
 */
import { stubFetch } from './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import Form856ReportView from '../components/reporting/Form856ReportView';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useDataNeedsStore } from '../stores/useDataNeedsStore';
import { useAuthStore } from '../stores/useAuthStore';
import { getSupabase } from '../lib/db/client';
import { parseCsv } from '../lib/csv';

const payments = [
  { id: 'p1', date: '2026-03-10', direction: 'made', contactId: 'v1', contactName: 'Alpha Ltd', amountCents: 118_000, vatCents: 18_000, withheldCents: 30_000, withholdingCertificate: 'A-1' },
  { id: 'p2', date: '2026-09-02', direction: 'made', contactId: 'v1', contactName: 'Alpha Ltd', amountCents: 59_000, vatCents: 9_000, withheldCents: 10_000, withholdingCertificate: 'A-2' },
  { id: 'p3', date: '2026-05-05', direction: 'made', contactId: 'v2', contactName: 'Beta Works', amountCents: 236_000, vatCents: 36_000, withheldCents: 10_000 },
  { id: 'p4', date: '2025-12-31', direction: 'made', contactId: 'v3', contactName: 'Old Co', amountCents: 100_000, withheldCents: 30_000, withholdingCertificate: 'Z-1' },
  // a recorded year with no withholding at all: the picker offers it and the screen says so
  { id: 'p5', date: '2024-05-01', direction: 'made', contactId: 'v4', contactName: 'Plain Vendor', amountCents: 50_000 },
];

describe('Form 856 withholding report screen', () => {
  beforeEach(() => {
    stubFetch(404);
    useAuthStore.setState({ isGuest: true, user: null });
    useDataNeedsStore.setState({ loaded: { payments: true } as never });
    useLedgerStore.setState({ payments: payments as never, baseCurrency: 'ILS' });
  });
  afterEach(async () => { cleanup(); getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });

  test('shows the year’s vendors with withheld figures, rate, certificates and what is missing', () => {
    render(<Form856ReportView />);
    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    assert.equal(rows.length, 2, 'only the two 2026 vendors');
    const alpha = within(table).getAllByRole('row')[1];
    assert.match(alpha.textContent || '', /Alpha Ltd/);
    assert.match(alpha.textContent || '', /26\.67%/);
    assert.match(alpha.textContent || '', /A-1, A-2/);
    assert.match(within(table).getAllByRole('row')[2].textContent || '', /Beta Works/);
    const notes = screen.getAllByRole('listitem').map(li => li.textContent || '');
    assert.ok(notes.some(n => /no certificate number recorded/.test(n)));
    assert.ok(notes.some(n => /Beta Works/.test(n)));
  });

  test('the year picker moves to the recorded year and the empty state says so', () => {
    render(<Form856ReportView />);
    fireEvent.change(screen.getByLabelText('Year'), { target: { value: '2025' } });
    const table = screen.getByRole('table');
    assert.match(within(table).getAllByRole('row')[1].textContent || '', /Old Co/);
    fireEvent.change(screen.getByLabelText('Year'), { target: { value: '2024' } });
    assert.equal(screen.queryByRole('table'), null);
    assert.match(screen.getByText(/No vendor payment in 2024 has tax withheld/).textContent || '', /2024/);
  });
  test('E-17: review export stays blocked for guest, incomplete workspace and capped payment cache', () => {
    render(<Form856ReportView />);
    const button = screen.getByRole('button', { name: 'Download review worksheet CSV' }) as HTMLButtonElement;
    assert.equal(button.disabled, true, 'guest records never count as verified history');
    assert.match(screen.getByText(/Demo data cannot be exported/).textContent || '', /Demo data/);
    cleanup();

    useAuthStore.setState({ isGuest: false, currentWorkspaceId: 'book-a' });
    useDataNeedsStore.setState({
      loaded: { payments: true } as never, loadedWorkspaceId: 'book-b', failed: {},
    });
    useLedgerStore.setState({
      payments: payments.map(payment => ({ ...payment, workspaceId: 'book-a', status: 'posted' })) as never,
      baseCurrency: 'ILS',
    });
    render(<Form856ReportView />);
    assert.equal((screen.getByRole('button', { name: 'Download review worksheet CSV' }) as HTMLButtonElement).disabled, true);
    assert.ok(screen.getByText(/has not finished loading for this workspace/));
    cleanup();

    useDataNeedsStore.setState({ loadedWorkspaceId: 'book-a' });
    render(<Form856ReportView />);
    const enabledAfterReview = screen.getByRole('button', { name: 'Download review worksheet CSV' }) as HTMLButtonElement;
    assert.equal(enabledAfterReview.disabled, true, 'explicit review acknowledgement required');
    fireEvent.click(screen.getByRole('checkbox', { name: /I understand this is a review/ }));
    assert.equal(enabledAfterReview.disabled, false, 'eligible scoped worksheet may be reviewed');
    fireEvent.change(screen.getByLabelText('Year'), { target: { value: '2025' } });
    assert.equal(enabledAfterReview.disabled, true, 'acknowledgement does not carry across tax years');
  });

  test('E-17: an invalid payment or a foreign workspace record refuses the review export', () => {
    useAuthStore.setState({ isGuest: false, currentWorkspaceId: 'book-a' });
    useDataNeedsStore.setState({ loaded: { payments: true } as never, loadedWorkspaceId: 'book-a', failed: {} });
    useLedgerStore.setState({
      payments: [
        { ...payments[0], workspaceId: 'book-a', status: 'posted', currency: 'USD' },
        { ...payments[1], workspaceId: 'book-b', status: 'posted' },
      ] as never,
      baseCurrency: 'ILS',
    });
    render(<Form856ReportView />);
    assert.equal((screen.getByRole('button', { name: 'Download review worksheet CSV' }) as HTMLButtonElement).disabled, true);
    assert.ok(screen.getByText(/different workspace/));
    assert.ok(screen.getByText(/Foreign\/unknown-currency/));
  });

  test('E-17: the authority-order CSV needs the file number, follows record 60 and names what is missing', async () => {
    useAuthStore.setState({ isGuest: false, currentWorkspaceId: 'book-a' });
    useDataNeedsStore.setState({ loaded: { payments: true } as never, loadedWorkspaceId: 'book-a', failed: {} });
    useLedgerStore.setState({
      payments: [
        { ...payments[0], workspaceId: 'book-a', status: 'posted', contactTaxId: '511111111', withholdingRatePercent: 10 },
        { ...payments[1], workspaceId: 'book-a', status: 'posted', contactTaxId: '511111111', withholdingRatePercent: 10 },
        { ...payments[2], workspaceId: 'book-a', status: 'posted' },
      ] as never,
      baseCurrency: 'ILS',
    });
    render(<Form856ReportView />);
    const button = screen.getByRole('button', { name: 'Download authority-order CSV (draft)' }) as HTMLButtonElement;
    assert.equal(button.disabled, true, 'the file number and the acknowledgement are both required');
    fireEvent.change(screen.getByLabelText('Withholding file number (תיק ניכויים)'), { target: { value: '912345678' } });
    assert.equal(button.disabled, true, 'the acknowledgement is still required');
    fireEvent.click(screen.getByRole('checkbox', { name: /I understand this is a review/ }));
    assert.equal(button.disabled, false, 'nine digits + acknowledgement unlock the draft');
    // Beta Works has neither a tax ID nor a recorded rate; the screen says so before any download
    assert.ok(screen.getByText(/no tax ID \(field 6\)/));
    assert.ok(screen.getByText(/no withholding rate is recorded/));

    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    const originalClick = HTMLAnchorElement.prototype.click;
    let blob: Blob | undefined;
    let filename = '';
    URL.createObjectURL = value => { blob = value as Blob; return 'blob:auth856'; };
    URL.revokeObjectURL = () => {};
    HTMLAnchorElement.prototype.click = function () { filename = this.download; };
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Download authority-order CSV (draft)' }));
      assert.ok(blob, 'the action must produce a file');
      assert.equal(filename, 'form-856-authority-2026.csv');
      const rows = parseCsv(await blob.text());
      assert.equal(rows.length, 3, 'header + two vendors');
      assert.equal(rows[0].length, 20, 'one column per authority field');
      assert.match(rows[0][0], /^1\. מספר תיק ניכויים/);
      assert.match(rows[0][10], /^11\. .*Gross payments \(incl\. VAT\) \(97-107, 11\)$/);
      const alpha = rows[1];
      assert.deepEqual(alpha.slice(0, 3), ['912345678', '96', '2026']);
      assert.equal(alpha[5], '511111111', 'field 6: the payee ID');
      assert.equal(alpha[10], '00000177000', 'field 11: 1,770.00 ILS as 177,000 agorot');
      assert.equal(alpha[11], '000040000', 'field 12: 400.00 ILS withheld');
      assert.equal(alpha[14], '10', 'field 15: the recorded rate, no % sign');
      assert.equal(alpha[19], '60', 'field 20: record type 60');
      const beta = rows[2];
      assert.equal(beta[7], 'Beta Works');
      assert.equal(beta[5], '000000000', 'the missing ID stays zeros, never invented');
      assert.equal(beta[14], '00', 'the missing rate stays 00, never guessed');
    } finally {
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
      HTMLAnchorElement.prototype.click = originalClick;
    }
  });

});
