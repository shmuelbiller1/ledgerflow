import { usePageSyncedState } from '../../hooks/usePageSyncedState';
import React, { useState, useMemo } from 'react';
import { Users } from 'lucide-react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useServerOperationalReport, collectionStamp } from '../../hooks/useServerOperationalReport';
import { PartyReportLayout, ColumnDef } from './PartyReportLayout';
import { filterPartyBalanceRows, partyBalanceCell, partyNameCell, partyOpenCountCell, partyPaidCell } from './partyBalanceCells';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { computeCustomerBalanceSummary, CustomerBalanceSummaryRow } from '../../server/reports/partyReports';
import { toast } from 'sonner';
import { csvMoney, downloadCsv } from '../../lib/csvExport';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { useReportText } from './useReportText';

export const CustomerBalanceSummaryView: React.FC<{ asOfDate?: string }> = ({ asOfDate: pageAsOfDate }) => {
  const reportText = useReportText();
  const customers = useLedgerStore(s => s.customers);
  const invoices = useLedgerStore(s => s.invoices);
  const payments = useLedgerStore(s => s.payments);
  const creditNotes = useLedgerStore(s => s.creditNotes);
  const truncated = useLedgerStore(s => s.truncatedCollections);
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const currency = useAuthStore(s => s.getCurrentWorkspace()?.currency) || 'USD';
  useLedgerCollections('creditNotes', 'customers', 'invoices', 'payments');
  const [searchTerm, setSearchTerm] = useState('');
  const [asOfDate, setAsOfDate] = usePageSyncedState(pageAsOfDate || '', pageAsOfDate || undefined, getLocalDateISO);
  const isTruncated = Boolean(truncated.customers || truncated.invoices || truncated.payments || truncated.creditNotes);
  const serverRows = useServerOperationalReport<CustomerBalanceSummaryRow[]>(
    isTruncated && Boolean(workspaceId),
    workspaceId ? `/api/v1/reports/party-balances?${new URLSearchParams({ workspaceId, asOfDate })}` : '',
    `${workspaceId}:${currency}:${asOfDate}:${collectionStamp(customers, invoices, payments, creditNotes)}`,
    body => (Array.isArray(body.customerRows) ? (body.customerRows as CustomerBalanceSummaryRow[]) : undefined),
  );

  const localCustomerRows = useMemo<CustomerBalanceSummaryRow[]>(() => {
    return computeCustomerBalanceSummary(
      customers,
      invoices,
      payments,
      creditNotes,
      asOfDate,
      undefined,
      undefined,
      currency
    );
  }, [customers, invoices, payments, creditNotes, asOfDate, currency]);
  const customerRows = serverRows || localCustomerRows;

  const filteredRows = useMemo(() => filterPartyBalanceRows(customerRows, searchTerm), [customerRows, searchTerm]);

  const totalOutstandingCents = useMemo(() => {
    return customerRows.reduce((sum, r) => sum + r.balanceCents, 0);
  }, [customerRows]);

  const totalInvoicedAllCents = useMemo(() => {
    return customerRows.reduce((sum, r) => sum + r.totalInvoicedCents, 0);
  }, [customerRows]);

  const handleExportCSV = () => {
    downloadCsv(`customer_balance_summary_${getLocalDateISO()}.csv`,
      ['Customer Name', 'Email', 'Phone', 'Open Invoices', 'Total Invoiced', 'Total Paid', 'Balance Due'],
      filteredRows.map(r => [r.name, r.email || '', r.phone || '', r.openInvoicesCount, csvMoney(r.totalInvoicedCents), csvMoney(r.totalPaidCents), csvMoney(r.balanceCents)]));
    toast.success('Customer Balance Summary exported to CSV');
  };

  const columns: ColumnDef<CustomerBalanceSummaryRow>[] = [
    { key: 'name', header: 'Customer', render: partyNameCell },
    { key: 'openInvoicesCount', header: 'Open Invoices', align: 'center',
      render: (item) => partyOpenCountCell(item.openInvoicesCount) },
    { key: 'totalInvoicedCents', header: 'Total Invoiced', align: 'right',
      render: (item) => formatCurrency(item.totalInvoicedCents, currency) },
    { key: 'totalPaidCents', header: 'Total Paid', align: 'right',
      render: (item) => partyPaidCell(item.totalPaidCents, currency) },
    { key: 'balanceCents', header: 'Balance Due', align: 'right',
      render: (item) => partyBalanceCell(item.balanceCents, currency, 'rose') },
  ];

  return (
    <PartyReportLayout
      title={reportText('r.customer-balance-summary', 'Customer Balance Summary')}
      description={reportText('r.consolidated-statement-of-account-balances-cumul', 'Consolidated statement of account balances, cumulative invoicing, and payments across all active customers.')}
      icon={Users}
      totalLabel="Total Receivables Due"
      totalAmountCents={totalOutstandingCents}
      currency={currency}
      secondaryTotalLabel="Cumulative Invoiced"
      secondaryTotalCents={totalInvoicedAllCents}
      exportFilename="customer_balance_summary.csv"
      onExportCSV={handleExportCSV}
      searchTerm={searchTerm}
      onSearchChange={setSearchTerm}
      searchPlaceholder="Search customer by name, email, or phone..."
      asOfDate={asOfDate}
      onAsOfDateChange={setAsOfDate}
      columns={columns}
      data={filteredRows}
      emptyMessage="No customer records found matching search filter."
      sumKeys={['totalInvoicedCents', 'totalPaidCents', 'balanceCents']}
      getRowId={(item) => item.customerId}
    />
  );
};

export default CustomerBalanceSummaryView;

