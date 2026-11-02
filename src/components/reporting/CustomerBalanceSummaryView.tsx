import { usePageSyncedState } from '../../hooks/usePageSyncedState';
import React, { useState, useMemo } from 'react';
import { Users, Mail, Phone } from 'lucide-react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { PartyReportLayout, ColumnDef } from './PartyReportLayout';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { computeCustomerBalanceSummary, CustomerBalanceSummaryRow } from '../../server/reports/partyReports';
import { toast } from 'sonner';
import { csvMoney, downloadCsv } from '../../lib/csvExport';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';

export const CustomerBalanceSummaryView: React.FC<{ asOfDate?: string }> = ({ asOfDate: pageAsOfDate }) => {
  const customers = useLedgerStore(s => s.customers);
  const invoices = useLedgerStore(s => s.invoices);
  const payments = useLedgerStore(s => s.payments);
  const creditNotes = useLedgerStore(s => s.creditNotes);
  useLedgerCollections('creditNotes', 'customers', 'invoices', 'payments');
  const [searchTerm, setSearchTerm] = useState('');
  const [asOfDate, setAsOfDate] = usePageSyncedState(pageAsOfDate || '', pageAsOfDate || undefined, getLocalDateISO);
  // Follow the Reports page period when it gives one

  const customerRows = useMemo<CustomerBalanceSummaryRow[]>(() => {
    return computeCustomerBalanceSummary(
      customers,
      invoices,
      payments,
      creditNotes,
      asOfDate
    );
  }, [customers, invoices, payments, creditNotes, asOfDate]);

  const filteredRows = useMemo(() => {
    if (!searchTerm.trim()) return customerRows;
    const term = searchTerm.toLowerCase();
    return customerRows.filter(r => 
      r.name.toLowerCase().includes(term) || 
      (r.email && r.email.toLowerCase().includes(term)) ||
      (r.phone && r.phone.includes(term))
    );
  }, [customerRows, searchTerm]);

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
    {
      key: 'name',
      header: 'Customer',
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
      key: 'openInvoicesCount',
      header: 'Open Invoices',
      align: 'center',
      render: (item) => (
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
          item.openInvoicesCount > 0 
            ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' 
            : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400'
        }`}>
          {item.openInvoicesCount}
        </span>
      )
    },
    {
      key: 'totalInvoicedCents',
      header: 'Total Invoiced',
      align: 'right',
      render: (item) => formatCurrency(item.totalInvoicedCents)
    },
    {
      key: 'totalPaidCents',
      header: 'Total Paid',
      align: 'right',
      render: (item) => (
        <span className="text-emerald-600 dark:text-emerald-400 font-medium">
          {formatCurrency(item.totalPaidCents)}
        </span>
      )
    },
    {
      key: 'balanceCents',
      header: 'Balance Due',
      align: 'right',
      render: (item) => (
        <span className={`font-bold ${item.balanceCents > 0 ? 'text-rose-600 dark:text-rose-400' : item.balanceCents < 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-neutral-500'}`}>
          {formatCurrency(item.balanceCents)}
        </span>
      )
    }
  ];

  return (
    <PartyReportLayout
      title="Customer Balance Summary"
      description="Consolidated statement of account balances, cumulative invoicing, and payments across all active customers."
      icon={Users}
      totalLabel="Total Receivables Due"
      totalAmountCents={totalOutstandingCents}
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

