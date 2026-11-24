/**
 * E-33 screen: the Uniform Structure file (קובץ אחיד) export. Hand-checked from a small
 * 2026 workspace: the layouts table stays, the file panel blocks demo data, a scoped
 * acknowledged build downloads INI.TXT and BKMVDATA.TXT as ISO-8859-8 bytes with the record
 * counts and document totals on screen, a workspace with no dealer number refuses with the
 * field number, and the empty year says there is nothing to write.
 */
import { stubFetch } from './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import UniformStructureReportView from '../components/reporting/UniformStructureReportView';
import { UNIFORM_RECORD_LAYOUTS } from '../lib/tax/uniformStructure';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useDataNeedsStore } from '../stores/useDataNeedsStore';
import { useAuthStore } from '../stores/useAuthStore';
import { useUIStore } from '../stores/useUIStore';
import { formatCurrency } from '../lib/utils';
import { REPORT_STRINGS_5 } from '../lib/i18n/reportTranslationsMore5';
import { getSupabase } from '../lib/db/client';

const LOADED = {
  transactions: true, accounts: true, invoices: true, bills: true,
  creditNotes: true, vendorCredits: true, payments: true, inventory: true,
};

const accounts = [
  { id: 'a1', code: '1000', name: 'Cash', type: 'asset', category: 'current', archived: false, openingBalanceCents: 0 },
  { id: 'a2', code: '4000', name: 'Sales', type: 'revenue', category: 'operating', archived: false, openingBalanceCents: 0 },
  { id: 'a3', code: '2100', name: 'VAT Payable', type: 'liability', category: 'current', archived: false, openingBalanceCents: 0 },
];

const transactions = [
  {
    id: 't1', workspaceId: 'ws-a', date: '2026-03-15', type: 'invoice', status: 'posted',
    totalAmountCents: 1_180_000, currency: 'ILS', description: 'Cash sale',
    lines: [
      { id: 'l1', accountId: 'a1', amountCents: 1_180_000 },
      { id: 'l2', accountId: 'a2', amountCents: -1_000_000 },
      { id: 'l3', accountId: 'a3', amountCents: -180_000 },
    ],
  },
];

const invoices = [
  {
    id: 'inv1', workspaceId: 'ws-a', number: '1001', customerName: 'Acme',
    amountCents: 1_180_000, taxAmountCents: 180_000, status: 'sent', date: '2026-03-15',
    items: [{ description: 'Consulting services', quantity: 10, rateCents: 100_000, taxRate: 18 }],
  },
  // an older invoice so the year picker offers another year (it is not part of the 2026 file)
  {
    id: 'inv25', workspaceId: 'ws-a', number: '0999', customerName: 'Old Co',
    amountCents: 59_000, taxAmountCents: 9_000, status: 'paid', date: '2025-06-01',
    items: [{ description: 'Retainer', quantity: 1, rateCents: 50_000, taxRate: 18 }],
  },
];

const payments = [
  {
    id: 'p1', workspaceId: 'ws-a', direction: 'received', method: 'bank_transfer',
    amountCents: 1_180_000, status: 'posted', date: '2026-03-20', unappliedCents: 0,
    allocations: [{ documentId: 'inv1', documentType: 'invoice', amountCents: 1_180_000 }],
  },
];

const initialUI = useUIStore.getState();

function setWorkspace(withDealerNumber: boolean): void {
  useAuthStore.setState({
    isGuest: false,
    user: { uid: 'u1' } as never,
    currentWorkspaceId: 'ws-a',
    workspaces: [{
      id: 'ws-a',
      uid: 'u1',
      name: 'Example Consulting Ltd.',
      currency: 'ILS',
      branding: { address: 'Herzl 12\nTel Aviv' },
      taxProfiles: withDealerNumber ? {
        books: {
          name: 'Example',
          place: { country: 'IL' },
          registrations: [{ kind: 'vat', number: '514000001', place: { country: 'IL' } }],
        },
      } : undefined,
    }] as never,
  });
  useDataNeedsStore.setState({ loaded: LOADED as never, loadedWorkspaceId: 'ws-a', failed: {} });
}

describe('Uniform Structure file screen', () => {
  beforeEach(() => {
    stubFetch(404);
    useUIStore.setState({ language: 'en' });
    useLedgerStore.setState({
      transactions: transactions as never,
      accounts: accounts as never,
      invoices: invoices as never,
      bills: [],
      creditNotes: [],
      vendorCredits: [],
      payments: payments as never,
      inventory: [],
      baseCurrency: 'ILS',
    });
    useAuthStore.setState({ isGuest: true, user: null, currentWorkspaceId: null, workspaces: [] });
    useDataNeedsStore.setState({ loaded: {} as never, loadedWorkspaceId: null, failed: {} });
  });
  afterEach(async () => {
    cleanup();
    useUIStore.setState(initialUI, true);
    getSupabase().realtime.disconnect();
    await getSupabase().auth.dispose();
  });

  test('the screen lists every record layout with its width and field count', () => {
    render(<UniformStructureReportView />);
    const layoutsTable = screen.getByRole('table', { name: 'Record layouts' });
    for (const layout of UNIFORM_RECORD_LAYOUTS) {
      assert.ok(within(layoutsTable).getByText(layout.code), `expected record ${layout.code}`);
    }
    assert.ok(within(layoutsTable).getByText('466'));
    assert.ok(within(layoutsTable).getByText('445'));
    assert.ok(screen.getByRole('heading', { name: 'Uniform Structure File (BKMVDATA + INI)' }));
  });

  test('demo data blocks the download and says why', () => {
    render(<UniformStructureReportView />);
    const ini = screen.getByRole('button', { name: 'Download INI.TXT' }) as HTMLButtonElement;
    const bkmv = screen.getByRole('button', { name: 'Download BKMVDATA.TXT' }) as HTMLButtonElement;
    assert.equal(ini.disabled, true);
    assert.equal(bkmv.disabled, true);
    assert.ok(screen.getByText(/Demo data cannot be exported/));
    assert.ok(screen.getByText(/File build, not a filing/));
  });

  test('a scoped acknowledged build downloads both files as ISO-8859-8 with the totals on screen', async () => {
    setWorkspace(true);
    render(<UniformStructureReportView />);

    // record counts: A100 + 3 B100 + 3 B110 + C100 + D110 + D120 + Z900 = 11, no M100
    // (RowTable makes the first column a row header, the rest are cells)
    const countsTable = screen.getByRole('table', { name: 'Records in BKMVDATA.TXT' });
    const countRows = within(countsTable).getAllByRole('row').slice(1);
    assert.deepEqual(
      countRows.map(row => [
        within(row).getByRole('rowheader').textContent,
        ...within(row).getAllByRole('cell').map(cell => cell.textContent),
      ]),
      [['A100', '1'], ['B100', '3'], ['B110', '3'], ['C100', '1'], ['D110', '1'], ['D120', '1'], ['Z900', '1']],
    );
    assert.match(screen.getByText(/Total records/).textContent || '', /11/);
    const balance = screen.getByText(/Journal balance/).parentElement?.textContent || '';
    assert.ok(balance.includes(formatCurrency(1_180_000, 'ILS')), balance);
    assert.ok(balance.includes('='), 'debits and credits shown as equal');

    const totalsTable = screen.getByRole('table', { name: 'Documents by type' });
    const totalRow = within(totalsTable).getAllByRole('row')[1].textContent || '';
    assert.match(totalRow, /305/);
    assert.match(totalRow, new RegExp(formatCurrency(1_180_000, 'ILS').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

    const button = screen.getByRole('button', { name: 'Download INI.TXT' }) as HTMLButtonElement;
    assert.equal(button.disabled, true, 'the acknowledgement is required');
    fireEvent.click(screen.getByRole('checkbox', { name: /I understand this file has not passed/ }));
    assert.equal(button.disabled, false, 'acknowledged eligible build may download');
    assert.ok(screen.getByText(/has not passed the Tax Authority simulator/));

    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    const originalClick = HTMLAnchorElement.prototype.click;
    const blobs: Blob[] = [];
    const filenames: string[] = [];
    URL.createObjectURL = value => { blobs.push(value as Blob); return 'blob:uniform'; };
    URL.revokeObjectURL = () => {};
    HTMLAnchorElement.prototype.click = function () { filenames.push(this.download); };
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Download INI.TXT' }));
      fireEvent.click(screen.getByRole('button', { name: 'Download BKMVDATA.TXT' }));
      assert.deepEqual(filenames, ['INI.TXT', 'BKMVDATA.TXT']);
      assert.equal(blobs.length, 2);
      const decoder = new TextDecoder('iso-8859-8');
      const iniText = decoder.decode(new Uint8Array(await blobs[0].arrayBuffer()));
      const bkmvText = decoder.decode(new Uint8Array(await blobs[1].arrayBuffer()));
      assert.ok(iniText.startsWith('A000'), iniText.slice(0, 20));
      assert.match(iniText, /OPENFRMT\/514000001\.2026\/\d{8}/);
      assert.ok(bkmvText.startsWith('A100'), bkmvText.slice(0, 20));
      assert.ok(bkmvText.includes('\r\nZ900'), 'the file ends with the Z900 record');
      assert.ok(bkmvText.includes('3051001'), 'the invoice is document type 305');
    } finally {
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
      HTMLAnchorElement.prototype.click = originalClick;
    }
  });

  test('a workspace with no Israeli dealer number refuses with the field number', () => {
    setWorkspace(false);
    render(<UniformStructureReportView />);
    assert.ok(screen.getByText(/Business tax ID \(field 1003\) is missing/));
    assert.equal((screen.getByRole('button', { name: 'Download INI.TXT' }) as HTMLButtonElement).disabled, true);
    assert.equal((screen.getByRole('checkbox') as HTMLInputElement).disabled, true, 'blockers disable the acknowledgement');
  });

  test('the default year with no records says there is nothing to write', () => {
    setWorkspace(true);
    // only the 2025 invoice survives, so the default year (the current one) has nothing to write
    useLedgerStore.setState({ transactions: [], invoices: [invoices[1]] as never, payments: [] });
    render(<UniformStructureReportView />);
    assert.ok(screen.getByText(/No journal entries or documents in this year/));
    assert.equal((screen.getByRole('button', { name: 'Download BKMVDATA.TXT' }) as HTMLButtonElement).disabled, true);
    fireEvent.change(screen.getByLabelText('Year'), { target: { value: '2025' } });
    assert.equal(screen.queryByText(/No journal entries or documents in this year/), null, 'the 2025 invoice gives that year something to write');
  });

  test('Hebrew copy: title, column headings and the not-a-filing panel', () => {
    setWorkspace(true);
    useUIStore.setState({ language: 'he' });
    render(<UniformStructureReportView />);
    assert.ok(screen.getByRole('heading', { name: 'קובץ אחיד (BKMVDATA + INI)' }));
    assert.ok(screen.getByRole('columnheader', { name: 'רוחב' }));
    assert.ok(screen.getAllByRole('columnheader', { name: 'כמות' }).length >= 1, 'both data tables name their count column');
    assert.ok(screen.getByText(/הפקת קובץ, לא הגשה/));
  });

  test('every uniform Hebrew string is Hebrew or Latin — no stray scripts (Gitar #1037-5)', () => {
    const offenders: string[] = [];
    for (const entry of REPORT_STRINGS_5) {
      if (!entry.key.startsWith('r.uniform-')) continue;
      for (const ch of entry.he) {
        const c = ch.codePointAt(0)!;
        const hebrew = (c >= 0x0590 && c <= 0x05ff) || (c >= 0xfb1d && c <= 0xfb4f);
        const allowed = hebrew || c < 0x80 || '–—„“”…·×÷°«»§¶†‡• '.includes(ch);
        if (!allowed) offenders.push(`${entry.key} → U+${c.toString(16).toUpperCase()} ${ch}`);
      }
    }
    assert.deepEqual(offenders, []);
    // the two wording regressions Gitar caught stay fixed
    const disclaimer = REPORT_STRINGS_5.find(entry => entry.key === 'r.uniform-simulator-disclaimer')!;
    assert.ok(disclaimer.he.includes('מונפק על ידי הרשות'));
    const help = REPORT_STRINGS_5.find(entry => entry.key === 'r.uniform-no-documents-help')!;
    assert.ok(help.he.includes('שנבחרה'));
  });
});
