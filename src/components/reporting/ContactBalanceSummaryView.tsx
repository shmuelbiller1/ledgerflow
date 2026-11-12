import React, { useMemo, useState } from 'react';
import { Contact } from 'lucide-react';
import { toast } from 'sonner';
import { usePageSyncedState } from '../../hooks/usePageSyncedState';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useServerOperationalReport, collectionStamp } from '../../hooks/useServerOperationalReport';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { PartyReportLayout, ColumnDef } from './PartyReportLayout';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { csvMoney, downloadCsv } from '../../lib/csvExport';
import {
  computeContactBalanceSummary, computeCustomerBalanceSummary, computeVendorBalanceSummary, ContactBalanceSummaryRow,
} from '../../server/reports/partyReports';

/**
 * Contact Balance Summary (J-03): every customer and vendor with what they owe you, what you owe
 * them and the net, on one row when a business is both (src/server/reports/partyReports.ts).
 */
export const ContactBalanceSummaryView: React.FC<{ asOfDate?: string }> = ({ asOfDate: pageAsOfDate }) => {
  const customers = useLedgerStore(s => s.customers);
  const vendors = useLedgerStore(s => s.vendors);
  const invoices = useLedgerStore(s => s.invoices);
  const bills = useLedgerStore(s => s.bills);
  const payments = useLedgerStore(s => s.payments);
  const creditNotes = useLedgerStore(s => s.creditNotes);
  const vendorCredits = useLedgerStore(s => s.vendorCredits);
  const truncated = useLedgerStore(s => s.truncatedCollections);
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const currency = useAuthStore(s => s.getCurrentWorkspace()?.currency) || 'USD';
  useLedgerCollections('bills', 'creditNotes', 'customers', 'invoices', 'payments', 'vendorCredits', 'vendors');
  const [searchTerm, setSearchTerm] = useState('');
  const [asOfDate, setAsOfDate] = usePageSyncedState(pageAsOfDate || '', pageAsOfDate || undefined, getLocalDateISO);
  const isTruncated = Boolean(
    truncated.customers || truncated.vendors || truncated.invoices || truncated.bills ||
    truncated.payments || truncated.creditNotes || truncated.vendorCredits
  );
  const serverRows = useServerOperationalReport<ContactBalanceSummaryRow[]>(
    isTruncated && Boolean(workspaceId),
    workspaceId ? `/api/v1/reports/party-balances?${new URLSearchParams({ workspaceId, asOfDate })}` : '',
    `${workspaceId}:${currency}:${asOfDate}:${collectionStamp(customers, vendors, invoices, bills, payments, creditNotes, vendorCredits)}`,
    body => (Array.isArray(body.contactRows) ? (body.contactRows as ContactBalanceSummaryRow[]) : undefined),
  );

  const localRows = useMemo(() => computeContactBalanceSummary(
    computeCustomerBalanceSummary(customers, invoices, payments, creditNotes, asOfDate, undefined, undefined, currency),
    computeVendorBalanceSummary(vendors, bills, payments, vendorCredits, asOfDate, undefined, undefined, currency),
  ), [customers, vendors, invoices, bills, payments, creditNotes, vendorCredits, asOfDate, currency]);
  const rows = serverRows || localRows;

  const shown = useMemo(() => {
    const term = searchTerm.trim().toLocaleLowerCase();
    return term ? rows.filter(r => r.name.toLocaleLowerCase().includes(term) || (r.email || '').toLowerCase().includes(term)) : rows;
  }, [rows, searchTerm]);

  const netCents = rows.reduce((sum, r) => sum + r.netCents, 0);
  const role = (r: ContactBalanceSummaryRow) => [r.customerId && 'Customer', r.vendorId && 'Vendor'].filter(Boolean).join(' & ');

  const exportCsv = () => {
    downloadCsv(`contact_balance_summary_${asOfDate}.csv`,
      ['Contact', 'Email', 'Is', 'They owe you', 'You owe them', 'Net'],
      shown.map(r => [r.name, r.email || '', role(r), csvMoney(r.receivableCents), csvMoney(r.payableCents), csvMoney(r.netCents)]));
    toast.success('Contact Balance Summary exported to CSV');
  };

  const columns: ColumnDef<ContactBalanceSummaryRow>[] = [
    {
      key: 'name',
      header: 'Contact',
      render: (r) => (
        <div>
          <div className="font-semibold text-[var(--text)]">{r.name}</div>
          <div className="text-[10px] text-[var(--muted)]">{role(r)}{r.email ? ` · ${r.email}` : ''}</div>
        </div>
      ),
    },
    { key: 'receivableCents', header: 'They owe you', align: 'right', render: (r) => formatCurrency(r.receivableCents, currency) },
    { key: 'payableCents', header: 'You owe them', align: 'right', render: (r) => formatCurrency(r.payableCents, currency) },
    {
      key: 'netCents',
      header: 'Net',
      align: 'right',
      render: (r) => (
        <span className={`font-bold ${r.netCents > 0 ? 'text-[var(--pos)]' : r.netCents < 0 ? 'text-[var(--neg)]' : 'text-[var(--muted)]'}`}>
          {formatCurrency(r.netCents, currency)}
        </span>
      ),
    },
  ];

  return (
    <PartyReportLayout
      title="Contact Balance Summary"
      description="What each customer and vendor owes you and what you owe them, with one row for a business that is both."
      icon={Contact}
      totalLabel="Net (owed to you minus owed by you)"
      totalAmountCents={netCents}
      currency={currency}
      exportFilename="contact_balance_summary.csv"
      onExportCSV={exportCsv}
      searchTerm={searchTerm}
      onSearchChange={setSearchTerm}
      searchPlaceholder="Search contact by name or email..."
      asOfDate={asOfDate}
      onAsOfDateChange={setAsOfDate}
      columns={columns}
      data={shown}
      emptyMessage="No customers or vendors match the search."
      sumKeys={['receivableCents', 'payableCents', 'netCents']}
      getRowId={(r) => r.key}
    />
  );
};

export default ContactBalanceSummaryView;
