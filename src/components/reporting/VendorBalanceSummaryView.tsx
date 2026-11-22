import { usePageSyncedState } from '../../hooks/usePageSyncedState';
import React, { useState, useMemo } from 'react';
import { Building } from 'lucide-react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useServerOperationalReport, collectionStamp } from '../../hooks/useServerOperationalReport';
import { PartyReportLayout, ColumnDef } from './PartyReportLayout';
import { filterPartyBalanceRows, partyBalanceCell, partyNameCell, partyOpenCountCell, partyPaidCell } from './partyBalanceCells';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { computeVendorBalanceSummary, VendorBalanceSummaryRow } from '../../server/reports/partyReports';
import { toast } from 'sonner';
import { csvMoneyForBook, downloadCsv } from '../../lib/csvExport';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { useReportText } from './useReportText';

export const VendorBalanceSummaryView: React.FC<{ asOfDate?: string }> = ({ asOfDate: pageAsOfDate }) => {
  const reportText = useReportText();
  const vendors = useLedgerStore(s => s.vendors);
  const bills = useLedgerStore(s => s.bills);
  const payments = useLedgerStore(s => s.payments);
  const vendorCredits = useLedgerStore(s => s.vendorCredits);
  const truncated = useLedgerStore(s => s.truncatedCollections);
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const currency = useAuthStore(s => s.getCurrentWorkspace()?.currency) || 'USD';
  // #910 family: the summary is computed in the book currency, so the file's decimals come from it
  const moneyCell = csvMoneyForBook(currency);
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

  const filteredRows = useMemo(() => filterPartyBalanceRows(vendorRows, searchTerm), [vendorRows, searchTerm]);

  const totalOutstandingCents = useMemo(() => {
    return vendorRows.reduce((sum, r) => sum + r.balanceCents, 0);
  }, [vendorRows]);

  const totalBilledAllCents = useMemo(() => {
    return vendorRows.reduce((sum, r) => sum + r.totalBilledCents, 0);
  }, [vendorRows]);

  const handleExportCSV = () => {
    downloadCsv(`vendor_balance_summary_${getLocalDateISO()}.csv`,
      ['Vendor Name', 'Email', 'Phone', 'Open Bills', 'Total Billed', 'Total Paid', 'Balance Due'],
      filteredRows.map(r => [r.name, r.email || '', r.phone || '', r.openBillsCount, moneyCell(r.totalBilledCents), moneyCell(r.totalPaidCents), moneyCell(r.balanceCents)]));
    toast.success('Vendor Balance Summary exported to CSV');
  };

  const columns: ColumnDef<VendorBalanceSummaryRow>[] = [
    { key: 'name', header: reportText('r.vendor', 'Vendor'), render: partyNameCell },
    { key: 'openBillsCount', header: reportText('r.open-bills', 'Open Bills'), align: 'center',
      render: (item) => partyOpenCountCell(item.openBillsCount) },
    { key: 'totalBilledCents', header: reportText('r.total-billed', 'Total Billed'), align: 'right',
      render: (item) => formatCurrency(item.totalBilledCents, currency) },
    { key: 'totalPaidCents', header: reportText('r.total-paid', 'Total Paid'), align: 'right',
      render: (item) => partyPaidCell(item.totalPaidCents, currency) },
    { key: 'balanceCents', header: reportText('r.balance-due', 'Balance Due'), align: 'right',
      render: (item) => partyBalanceCell(item.balanceCents, currency, 'amber') },
  ];

  return (
    <PartyReportLayout
      title={reportText('r.vendor-balance-summary', 'Vendor Balance Summary')}
      description={reportText('r.consolidated-statement-of-accounts-payable-cumul', 'Consolidated statement of accounts payable, cumulative billing, and payments across all active suppliers.')}
      icon={Building}
      totalLabel={reportText('r.total-payables-due', 'Total Payables Due')}
      totalAmountCents={totalOutstandingCents}
      currency={currency}
      secondaryTotalLabel={reportText('r.cumulative-billed', 'Cumulative Billed')}
      secondaryTotalCents={totalBilledAllCents}
      exportFilename="vendor_balance_summary.csv"
      onExportCSV={handleExportCSV}
      searchTerm={searchTerm}
      onSearchChange={setSearchTerm}
      searchPlaceholder={reportText('r.search-vendor-by-name-email-or-phone', 'Search vendor by name, email, or phone...')}
      asOfDate={asOfDate}
      onAsOfDateChange={setAsOfDate}
      columns={columns}
      data={filteredRows}
      emptyMessage={reportText('r.no-vendor-records-found-matching-search-filter', 'No vendor records found matching search filter.')}
      sumKeys={['totalBilledCents', 'totalPaidCents', 'balanceCents']}
      getRowId={(item) => item.vendorId}
    />
  );
};

export default VendorBalanceSummaryView;

