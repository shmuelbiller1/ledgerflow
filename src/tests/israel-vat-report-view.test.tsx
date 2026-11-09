import './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import IsraelVatReportView, {
  IsraelVatReportPanel,
} from '../components/reporting/IsraelVatReportView';
import {
  IL_VAT_REPORT_CSV_HEADERS,
  ilVatReportCsvRows,
} from '../lib/ilVatReportCsv';
import { toCsv } from '../lib/csvExport';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { makeChartAccount } from './fixtures';
import { formatCurrency } from '../lib/utils';
import type { Workspace } from '../model/workspace';
import type { IlVatReturn } from '../lib/tax/ilVatReturn';

const TA_REG = 'vat:IL:514000001';
const EILAT_REG = 'vat:IL:514000002';

const mockWorkspace: Workspace = {
  id: 'ws-il-vat',
  name: 'Tel Aviv Enterprises Ltd',
  currency: 'ILS',
  uid: 'owner-1',
  businessType: 'custom',
  createdAt: '2026-01-01',
  roles: { 'owner-1': 'owner' },
  dimensions: [{ id: 'world', isWorld: true, name: 'Entity' }],
  taxProfiles: {
    books: {
      name: 'Acme Tel Aviv',
      place: { country: 'IL', city: 'Tel Aviv' },
      registrations: [
        { kind: 'vat', number: '514000001', place: { country: 'IL' }, filing: 'monthly', validFrom: '2026-01-01' },
      ],
    },
    labels: {
      'world:eilat': {
        name: 'Eilat Branch',
        place: { country: 'IL', city: 'Eilat' },
        registrations: [
          { kind: 'vat', number: '514000002', place: { country: 'IL' }, filing: 'bimonthly', validFrom: '2026-01-01' },
        ],
      },
    },
  },
};

const accounts = [
  makeChartAccount({ id: 'acc-machinery', code: '1500', name: 'Machinery & Equipment', type: 'asset', category: 'Fixed Assets' }),
  makeChartAccount({ id: 'acc-supplies', code: '6000', name: 'Office Supplies', type: 'expense', category: 'Operating' }),
  makeChartAccount({ id: 'acc-stock', code: '1300', name: 'Inventory', type: 'asset', category: 'Inventory' }),
];

const invoices = [
  // Standard taxable invoice for Tel Aviv: 10,000 net + 1,800 VAT (18%) = 11,800
  {
    id: 'inv-1',
    number: 'INV-101',
    date: '2026-09-10',
    status: 'sent',
    taxVersion: 2,
    amountCents: 1_180_000,
    taxAmountCents: 180_000,
    customerId: 'cust-1',
    items: [{ dimensions: { world: 'world' } }],
  },
  // Zero-rated invoice (export) for Tel Aviv: 5,000 net + 0 VAT = 5,000
  {
    id: 'inv-2',
    number: 'INV-102',
    date: '2026-09-12',
    status: 'sent',
    taxVersion: 2,
    taxTreatment: 'zero_rated',
    amountCents: 500_000,
    taxAmountCents: 0,
    customerId: 'cust-2',
  },
  // Invoice for Eilat registration: 2,000 net
  {
    id: 'inv-3',
    number: 'INV-103',
    date: '2026-09-15',
    status: 'sent',
    taxVersion: 2,
    amountCents: 236_000,
    taxAmountCents: 36_000,
    customerId: 'cust-1',
    items: [{ dimensions: { world: 'eilat' } }],
  },
];

const bills = [
  // Equipment bill for Tel Aviv: 100,000 agorot (1,000 NIS) + 18,000 agorot VAT (180 NIS) on Machinery
  {
    id: 'bill-1',
    number: 'BILL-901',
    date: '2026-09-20',
    status: 'pending',
    taxVersion: 2,
    vendorId: 'vend-1',
    taxAmountCents: 18_000,
    amountCents: 118_000,
    splits: [{ accountId: 'acc-machinery', amountCents: 100_000 }],
  },
  // Other input bill for Tel Aviv: 200,000 agorot (2,000 NIS) + 36,000 agorot VAT (360 NIS) on Office supplies
  {
    id: 'bill-2',
    number: 'BILL-902',
    date: '2026-09-22',
    status: 'pending',
    taxVersion: 2,
    vendorId: 'vend-2',
    taxAmountCents: 36_000,
    amountCents: 236_000,
    splits: [{ accountId: 'acc-supplies', amountCents: 200_000 }],
  },
  // Mixed bill for Tel Aviv: Machinery 30,000 + Supplies 20,000 + VAT 9,000
  {
    id: 'bill-3',
    number: 'BILL-903',
    date: '2026-09-24',
    status: 'pending',
    taxVersion: 2,
    vendorId: 'vend-2',
    taxAmountCents: 9_000,
    amountCents: 59_000,
    splits: [
      { accountId: 'acc-machinery', amountCents: 30_000 },
      { accountId: 'acc-supplies', amountCents: 20_000 },
    ],
  },
];

const creditNotes = [
  // Credit note for Tel Aviv: 1,000 net + 180 VAT (18%) = 1,180
  {
    id: 'cn-1',
    number: 'CN-501',
    date: '2026-09-25',
    status: 'issued',
    taxVersion: 2,
    amountCents: 118_000,
    taxAmountCents: 18_000,
    customerId: 'cust-1',
  },
];

const vendorCredits = [
  // Vendor credit on equipment bill-1: 10,000 + 1,800 VAT
  {
    id: 'vc-1',
    number: 'VC-701',
    date: '2026-09-28',
    status: 'open',
    taxVersion: 2,
    billId: 'bill-1',
    amountCents: 11_800,
    taxAmountCents: 1_800,
  },
];

describe('C-40: Israel VAT Report View (IsraelVatReportView)', () => {
  beforeEach(() => {
    useAuthStore.setState({
      workspaces: [mockWorkspace],
      currentWorkspaceId: 'ws-il-vat',
      user: { uid: 'owner-1', email: 'owner@acme.il' } as never,
    });
    useLedgerStore.setState({
      accounts,
      invoices: invoices as never,
      bills: bills as never,
      creditNotes: creditNotes as never,
      vendorCredits: vendorCredits as never,
      truncatedCollections: {},
    });
  });

  afterEach(() => {
    cleanup();
  });

  test('renders Form 836 report with bilingual titles and expected figures', () => {
    render(<IsraelVatReportView startDate="2026-09-01" endDate="2026-09-30" />);

    // Header and titles
    assert.ok(screen.getByRole('heading', { name: /Israel VAT Report/i }));
    assert.ok(screen.getAllByText(/טופס 836/).length >= 1);

    // Form 836 field labels in both English and Hebrew
    assert.ok(screen.getByText(/Taxable sales \(excluding VAT\)/));
    assert.ok(screen.getByText(/עסקאות חייבות במס/));
    assert.ok(screen.getByText(/Output VAT/));
    assert.ok(screen.getByText(/מע״מ עסקאות/));
    assert.ok(screen.getByText(/Zero-rated sales/));
    assert.ok(screen.getByText(/עסקאות בשיעור אפס/));
    assert.ok(screen.getByText(/Input VAT on fixed assets \(equipment\)/));
    assert.ok(screen.getByText(/מס תשומות על ציוד/));
    assert.ok(screen.getByText(/Input VAT on other purchases/));
    assert.ok(screen.getByText(/מס תשומות אחרות/));
    assert.ok(screen.getByText(/Total VAT to pay/));
    assert.ok(screen.getByText(/סך הכל לתשלום/));

    // Figures check for September:
    // Taxable sales: inv-1 10,000 - cn-1 1,000 = 9,000 NIS (900,000 cents)
    assert.ok(screen.getByText(formatCurrency(900_000, 'ILS')));
    // Output VAT: 180,000 - 18,000 = 162,000 cents (1,620 NIS)
    assert.ok(screen.getByText(formatCurrency(162_000, 'ILS')));
    // Zero-rated sales: inv-2 500,000 cents (5,000 NIS)
    assert.ok(screen.getByText(formatCurrency(500_000, 'ILS')));
    // Fixed asset input VAT: bill-1 18,000 - vc-1 1,800 = 16,200 cents (162 NIS)
    assert.ok(screen.getByText(formatCurrency(16_200, 'ILS')));
    // Other inputs: bill-2 36,000 + bill-3 (mixed) 9,000 = 45,000 cents (450 NIS)
    assert.ok(screen.getByText(formatCurrency(45_000, 'ILS')));
    // Total VAT to pay: Output 162,000 - Total inputs (16,200 + 45,000 = 61,200) = 100,800 cents (1,008 NIS)
    assert.ok(screen.getByText(formatCurrency(100_800, 'ILS')));
  });

  test('notifies user about mixed bills reported under other inputs', () => {
    render(<IsraelVatReportView startDate="2026-09-01" endDate="2026-09-30" />);
    assert.ok(screen.getByText(/1 bill\(s\) mix equipment and operating expense accounts/i));
  });

  test('switches between multiple Israeli VAT registrations', () => {
    render(<IsraelVatReportView startDate="2026-09-01" endDate="2026-09-30" />);

    const regSelect = screen.getByRole('combobox', { name: /VAT Registration/i });
    assert.ok(regSelect);

    // Switch to Eilat registration (514000002)
    act(() => {
      fireEvent.change(regSelect, { target: { value: EILAT_REG } });
    });

    assert.ok(screen.getByText('514000002'));
    // Eilat invoice: 200,000 agorot = 2,000 NIS net
    assert.ok(screen.getAllByText(formatCurrency(200_000, 'ILS')).length >= 1);
  });

  test('displays refund / reclaim status when input VAT exceeds output VAT', () => {
    const refundMockReturn: IlVatReturn = {
      registration: 'vat:IL:514000001',
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      taxableSalesCents: 100_000,
      outputVatCents: 18_000,
      zeroRatedSalesCents: 0,
      exemptSalesCents: 0,
      fixedAssetInputVatCents: 50_000,
      otherInputVatCents: 20_000,
      toPayCents: -52_000,
      documentCount: 3,
    };

    render(
      <IsraelVatReportPanel
        report={refundMockReturn}
        registrations={[{ registration: TA_REG, number: '514000001', from: 'books' }]}
        activeReg={TA_REG}
        onRegistrationChange={() => {}}
        startDate="2026-09-01"
        onStartDateChange={() => {}}
        endDate="2026-09-30"
        onEndDateChange={() => {}}
      />
    );

    assert.ok(screen.getByText(/Total VAT to reclaim/i));
    assert.ok(screen.getByText(/סך הכל להחזר/i));
    assert.ok(screen.getByText(/reclaim \/ להחזר/i));
  });

  test('triggers window.print when Print button is clicked', () => {
    let printed = false;
    const originalPrint = window.print;
    window.print = () => { printed = true; };

    try {
      render(<IsraelVatReportView startDate="2026-09-01" endDate="2026-09-30" />);
      const printButton = screen.getByRole('button', { name: /Print/i });
      fireEvent.click(printButton);

      assert.equal(printed, true);
    } finally {
      window.print = originalPrint;
    }
  });

  test('exports only a complete, loaded report with a CSV filename', async () => {
    const report: IlVatReturn = {
      registration: TA_REG,
      startDate: '2026-09-01', endDate: '2026-09-30',
      taxableSalesCents: 900_000, outputVatCents: 162_000,
      zeroRatedSalesCents: 500_000, exemptSalesCents: 0,
      fixedAssetInputVatCents: 16_200, otherInputVatCents: 45_000,
      toPayCents: 100_800, documentCount: 5,
    };
    const props = {
      report, registrations: [], activeReg: TA_REG, onRegistrationChange: () => {},
      startDate: report.startDate, onStartDateChange: () => {},
      endDate: report.endDate, onEndDateChange: () => {},
    };
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    const originalClick = HTMLAnchorElement.prototype.click;
    let blob: Blob | undefined;
    let filename = '';
    URL.createObjectURL = value => { blob = value as Blob; return 'blob:vat-test'; };
    URL.revokeObjectURL = () => {};
    HTMLAnchorElement.prototype.click = function () { filename = this.download; };

    try {
      const { rerender } = render(<IsraelVatReportPanel {...props} partial />);
      const exportButton = screen.getByRole('button', { name: /Export CSV/i }) as HTMLButtonElement;
      assert.equal(exportButton.disabled, true);
      fireEvent.click(exportButton);
      assert.equal(filename, '');

      rerender(<IsraelVatReportPanel {...props} loading />);
      assert.equal(exportButton.disabled, true);
      rerender(<IsraelVatReportPanel {...props} report={null} />);
      assert.equal(exportButton.disabled, true);
      rerender(<IsraelVatReportPanel {...props} />);
      assert.equal(exportButton.disabled, false);
      fireEvent.click(exportButton);
      assert.equal(filename, 'israel-vat-report-2026-09-01-to-2026-09-30.csv');
      assert.ok(blob);
      const downloadedBlob = blob;
      await act(async () => {
        assert.deepEqual(Buffer.from(await downloadedBlob.arrayBuffer()), Buffer.from('\uFEFF' + toCsv(IL_VAT_REPORT_CSV_HEADERS, ilVatReportCsvRows(report))));
        await new Promise(resolve => setTimeout(resolve, 0));
      });
    } finally {
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
      HTMLAnchorElement.prototype.click = originalClick;
    }
  });

  test('validates date range entry', () => {
    render(<IsraelVatReportView startDate="2026-09-30" endDate="2026-09-01" />);
    assert.ok(screen.getByRole('alert'));
    assert.match(screen.getByRole('alert').textContent || '', /valid date range/i);
  });

  test('produces correct CSV export rows', () => {
    const sampleReturn: IlVatReturn = {
      registration: 'vat:IL:514000001',
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      taxableSalesCents: 900_000,
      outputVatCents: 162_000,
      zeroRatedSalesCents: 500_000,
      exemptSalesCents: 0,
      fixedAssetInputVatCents: 16_200,
      otherInputVatCents: 45_000,
      toPayCents: 100_800,
      documentCount: 5,
    };

    const rows = ilVatReportCsvRows(sampleReturn);
    assert.equal(IL_VAT_REPORT_CSV_HEADERS.length, 4);
    assert.deepEqual(rows[0], ['Header', 'VAT Registration', 'מספר עוסק מורשה', '514000001']);
    assert.deepEqual(rows[4], ['Box 1', 'Taxable sales (excluding VAT)', 'עסקאות חייבות במס (ללא מע״מ)', '9000.00']);
    assert.deepEqual(rows[5], ['Box 2', 'Output VAT', 'מע״מ עסקאות', '1620.00']);
    assert.deepEqual(rows[8], ['Box 5', 'Input VAT on fixed assets (equipment)', 'מס תשומות על ציוד', '162.00']);
    assert.deepEqual(rows[10], ['Box 7', 'VAT to pay', 'סכום לתשלום', '1008.00']);
  });
});
