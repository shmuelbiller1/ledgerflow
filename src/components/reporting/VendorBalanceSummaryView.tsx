import { usePageSyncedState } from '../../hooks/usePageSyncedState';
import React, { useState, useMemo } from 'react';
import { Building, Mail, Phone } from 'lucide-react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useServerOperationalReport, collectionStamp } from '../../hooks/useServerOperationalReport';
import { PartyReportLayout, ColumnDef } from './PartyReportLayout';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { computeVendorBalanceSummary, VendorBalanceSummaryRow } from '../../server/reports/partyReports';
import { toast } from 'sonner';
import { csvMoney, downloadCsv } from '../../lib/csvExport';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';

export const VendorBalanceSummaryView: React.FC<{ asOfDate?: string }> = ({ asOfDate: pageAsOfDate }) => {
  const vendors = useLedgerStore(s => s.vendors);
  const bills = useLedgerStore(s => s.bills);
  const payments = useLedgerStore(s => s.payments);
  const vendorCredits = useLedgerStore(s => s.vendorCredits);
  const truncated = useLedgerStore(s => s.truncatedCollections);
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const currency = useAuthStore(s => s.getCurrentWorkspace()?.currency) || 'USD';
  useLedgerCollections('bills', 'payments', 'vendorCredits', 'vendors');
  const [searchTerm, setSearchTerm] = useState('');
  const [asOfDate, setAsOfDate] = usePageSyncedState(pageAsOfDate || '', pageAsOfDate || undefined, getLocalDateISO);
  const isTruncated = Boolean(truncated.vendors || truncated.bills || truncated.payments || truncated.vendorCredits);
  const serverRows = useServerOperationalReport<VendorBalanceSummaryRow[]>(
    isTruncated && Boolean(workspaceId),
    workspaceId ? `/api/v1/reports/party-balances?${new URLSearchParams({ workspaceId, asOfDate })}` : '',
    `${workspaceId}:${currency}:${asOfDate}:${collectionStamp(vendors, bills, payments, vendorCredits)}`,
    body => (Array.isArray(body.vendorRows) ? (body.vendorRows as VendorBalanceSummaryRow[]) : undefined),
  );

  const localVendorRows = useMemo<VendorBalanceSummaryRow[]>(() => {
    return computeVendorBalanceSummary(
      vendors,
      bills,
      payments,
      vendorCredits,
      asOfDate,
      undefined,
      undefined,
      currency
    );
  }, [vendors, bills, payments, vendorCredits, asOfDate, currency]);
  const vendorRows = serverRows || localVendorRows;

  const filteredRows = useMemo(() => {
    if (!searchTerm.trim()) return vendorRows;
    const term = searchTerm.toLowerCase();
    return vendorRows.filter(r => 
      r.name.toLowerCase().includes(term) || 
      (r.email && r.email.toLowerCase().includes(term)) ||
      (r.phone && r.phone.includes(term))
    );
  }, [vendorRows, searchTerm]);

  const totalOutstandingCents = useMemo(() => {
    return vendorRows.reduce((sum, r) => sum + r.balanceCents, 0);
  }, [vendorRows]);

  const totalBilledAllCents = useMemo(() => {
    return vendorRows.reduce((sum, r) => sum + r.totalBilledCents, 0);
  }, [vendorRows]);

  const handleExportCSV = () => {
    downloadCsv(`vendor_balance_summary_${getLocalDateISO()}.csv`,
      ['Vendor Name', 'Email', 'Phone', 'Open Bills', 'Total Billed', 'Total Paid', 'Balance Due'],
      filteredRows.map(r => [r.name, r.email || '', r.phone || '', r.openBillsCount, csvMoney(r.totalBilledCents), csvMoney(r.totalPaidCents), csvMoney(r.balanceCents)]));
    toast.success('Vendor Balance Summary exported to CSV');
  };

  const columns: ColumnDef<VendorBalanceSummaryRow>[] = [
    {
      key: 'name',
      header: 'Vendor',
      render: (item) => (
        <div>
          <div className="font-semibold text-neutral-900 dark:text-white">{item.name}</div>
          <div className="flex items-center gap-3 text-[10px] text-neutral-400 mt-0.5">
            {item.email && <span className="flex items-center gap-1"><Mail className="w-2.5 h-2.5" />{item.email}</span>}
            {item.phone && <span className="flex items-center gap-1"><Phone className="w-2.5 h-2.5" />{item.phone}</span>}
          </div>
        </div>
      )
    },
    {
      key: 'openBillsCount',
      header: 'Open Bills',
      align: 'center',
      render: (item) => (
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
          item.openBillsCount > 0 
            ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' 
            : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400'
        }`}>
          {item.openBillsCount}
        </span>
      )
    },
    {
      key: 'totalBilledCents',
      header: 'Total Billed',
      align: 'right',
      render: (item) => formatCurrency(item.totalBilledCents, currency)
    },
    {
      key: 'totalPaidCents',
      header: 'Total Paid',
      align: 'right',
      render: (item) => (
        <span className="text-emerald-600 dark:text-emerald-400 font-medium">
          {formatCurrency(item.totalPaidCents, currency)}
        </span>
      )
    },
    {
      key: 'balanceCents',
      header: 'Balance Due',
      align: 'right',
      render: (item) => (
        <span className={`font-bold ${item.balanceCents > 0 ? 'text-amber-600 dark:text-amber-400' : item.balanceCents < 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-neutral-500'}`}>
          {formatCurrency(item.balanceCents, currency)}
        </span>
      )
    }
  ];

  return (
    <PartyReportLayout
      title="Vendor Balance Summary"
      description="Consolidated statement of accounts payable, cumulative billing, and payments across all active suppliers."
      icon={Building}
      totalLabel="Total Payables Due"
      totalAmountCents={totalOutstandingCents}
      currency={currency}
      secondaryTotalLabel="Cumulative Billed"
      secondaryTotalCents={totalBilledAllCents}
      exportFilename="vendor_balance_summary.csv"
      onExportCSV={handleExportCSV}
      searchTerm={searchTerm}
      onSearchChange={setSearchTerm}
      searchPlaceholder="Search vendor by name, email, or phone..."
      asOfDate={asOfDate}
      onAsOfDateChange={setAsOfDate}
      columns={columns}
      data={filteredRows}
      emptyMessage="No vendor records found matching search filter."
      sumKeys={['totalBilledCents', 'totalPaidCents', 'balanceCents']}
      getRowId={(item) => item.vendorId}
    />
  );
};

export default VendorBalanceSummaryView;

