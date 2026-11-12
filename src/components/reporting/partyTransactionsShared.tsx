import { usePageSyncedState } from '../../hooks/usePageSyncedState';
import React, { useState, useMemo } from 'react';
import { LucideIcon } from 'lucide-react';
import type { LedgerState } from '../../stores/useLedgerStore';
import type { LedgerKey } from '../../lib/ledgerCollections';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { PartyReportLayout, ColumnDef } from './PartyReportLayout';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { getFiscalYearBounds } from '../../lib/fiscalCalendar';
import { PartyTransactionRow } from '../../server/reports/partyReports';
import { toast } from 'sonner';
import { csvMoney, downloadCsv } from '../../lib/csvExport';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';

/**
 * Configuration for a party-transaction report (customer or vendor).
 *
 * TransactionsByCustomerView and TransactionsByVendorView were near-duplicates
 * (58% duplicated lines each). They share every behaviour — date syncing,
 * search/filter, CSV export, paged layout — and differ only in domain specifics
 * (which store collections, which compute function, which type strings and
 * colours, which labels). This component takes those specifics as a config so the
 * shared logic lives in one place.
 */
export interface TransactionsByPartyConfig<P, D1, D2> {
  title: string;
  description: string;
  icon: LucideIcon;
  /** Column header for the party name (e.g. 'Customer' / 'Vendor'). */
  partyHeader: string;
  /** Document type treated as income on this view ('Invoice' / 'Bill'). */
  incomeType: string;
  /** Footer label for the income total. */
  incomeLabel: string;
  /** Document type treated as a payment on this view ('Payment' / 'Vendor Payment'). */
  paymentType: string;
  /** Footer label for the payment total. */
  paymentLabel: string;
  exportFilename: string;
  toastMessage: string;
  searchPlaceholder: string;
  emptyMessage: string;
  partyStore: (state: LedgerState) => P[];
  docStore1: (state: LedgerState) => D1[];
  docStore2: (state: LedgerState) => D2[];
  paymentStore: (state: LedgerState) => LedgerState['payments'];
  collections: LedgerKey[];
  computeFn: (
    parties: P[],
    docs1: D1[],
    payments: LedgerState['payments'],
    docs2: D2[],
    startDate?: string,
    endDate?: string,
    baseCurrency?: string,
  ) => PartyTransactionRow[];
  /** Tailwind colour classes per transaction type string. */
  typeColors: Record<string, string>;
}

export function TransactionsByPartyView<P, D1, D2>({
  config,
  startDate: pageStartDate,
  endDate: pageEndDate,
}: {
  config: TransactionsByPartyConfig<P, D1, D2>;
  startDate?: string;
  endDate?: string;
}) {
  const {
    title,
    description,
    icon,
    partyHeader,
    incomeType,
    incomeLabel,
    paymentType,
    paymentLabel,
    exportFilename,
    toastMessage,
    searchPlaceholder,
    emptyMessage,
    partyStore,
    docStore1,
    docStore2,
    paymentStore,
    collections,
    computeFn,
    typeColors,
  } = config;

  const parties = useLedgerStore(partyStore);
  const docs1 = useLedgerStore(docStore1);
  const payments = useLedgerStore(paymentStore);
  const docs2 = useLedgerStore(docStore2);
  const currency = useAuthStore((s) => s.getCurrentWorkspace()?.currency) || 'USD';
  useLedgerCollections(...collections);
  const [searchTerm, setSearchTerm] = useState('');

  const [startDate, setStartDate] = usePageSyncedState(
    JSON.stringify([pageStartDate, pageEndDate]),
    pageStartDate || undefined,
    () => {
      const params = new URLSearchParams(window.location.search);
      return params.get('startDate') || getFiscalYearBounds().startDate;
    },
  );
  const [endDate, setEndDate] = usePageSyncedState(
    JSON.stringify([pageStartDate, pageEndDate]),
    pageEndDate || undefined,
    () => {
      const params = new URLSearchParams(window.location.search);
      return params.get('endDate') || getFiscalYearBounds().endDate;
    },
  );

  const handleStartDateChange = (val: string) => {
    setStartDate(val);
    const url = new URL(window.location.href);
    if (val) url.searchParams.set('startDate', val);
    else url.searchParams.delete('startDate');
    window.history.replaceState({}, '', url.toString());
  };

  const handleEndDateChange = (val: string) => {
    setEndDate(val);
    const url = new URL(window.location.href);
    if (val) url.searchParams.set('endDate', val);
    else url.searchParams.delete('endDate');
    window.history.replaceState({}, '', url.toString());
  };

  const rows = useMemo<PartyTransactionRow[]>(() => {
    return computeFn(parties, docs1, payments, docs2, startDate || undefined, endDate || undefined, currency);
  }, [parties, docs1, payments, docs2, startDate, endDate, computeFn, currency]);

  const filteredRows = useMemo(() => {
    if (!searchTerm.trim()) return rows;
    const term = searchTerm.toLowerCase();
    return rows.filter((r) =>
      r.partyName.toLowerCase().includes(term) ||
      r.reference.toLowerCase().includes(term) ||
      r.type.toLowerCase().includes(term),
    );
  }, [rows, searchTerm]);

  const totalAmountCents = useMemo(() => {
    return filteredRows.filter((r) => r.type === incomeType).reduce((sum, r) => sum + r.amountCents, 0);
  }, [filteredRows, incomeType]);

  const totalPaidCents = useMemo(() => {
    return filteredRows.filter((r) => r.type === paymentType).reduce((sum, r) => sum + Math.abs(r.amountCents), 0);
  }, [filteredRows, paymentType]);

  const handleExportCSV = () => {
    downloadCsv(`${exportFilename}_${getLocalDateISO()}.csv`, [
      'Date',
      `${partyHeader} Name`,
      'Type',
      'Reference / Number',
      'Status',
      'Amount',
    ], filteredRows.map((r) => [r.date, r.partyName, r.type, r.reference, r.status, csvMoney(r.amountCents)]));
    toast.success(toastMessage);
  };

  const columns: ColumnDef<PartyTransactionRow>[] = [
    {
      key: 'date',
      header: 'Date',
      className: 'whitespace-nowrap font-mono',
    },
    {
      key: 'partyName',
      header: partyHeader,
      render: (item) => (
        <span className="font-medium text-neutral-900 dark:text-white">
          {item.partyName}
        </span>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      render: (item) => (
        <span
          className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
            typeColors[item.type] ??
            'bg-neutral-100 text-neutral-800 dark:bg-neutral-900/30 dark:text-neutral-300'
          }`}
        >
          {item.type}
        </span>
      ),
    },
    {
      key: 'reference',
      header: 'Number / Ref',
      className: 'font-mono text-neutral-600 dark:text-neutral-400',
    },
    {
      key: 'status',
      header: 'Status',
      render: (item) => (
        <span className="capitalize text-[11px] text-neutral-500 dark:text-neutral-400">
          {item.status}
        </span>
      ),
    },
    {
      key: 'amountCents',
      header: 'Amount',
      align: 'right',
      render: (item) => (
        <span className={`font-bold ${
          item.amountCents < 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-neutral-900 dark:text-white'
        }`}>
          {formatCurrency(item.amountCents)}
        </span>
      ),
    },
  ];

  return (
    <PartyReportLayout
      title={title}
      description={description}
      icon={icon}
      totalLabel={incomeLabel}
      totalAmountCents={totalAmountCents}
      secondaryTotalLabel={paymentLabel}
      secondaryTotalCents={totalPaidCents}
      exportFilename={exportFilename}
      onExportCSV={handleExportCSV}
      searchTerm={searchTerm}
      onSearchChange={setSearchTerm}
      searchPlaceholder={searchPlaceholder}
      startDate={startDate}
      endDate={endDate}
      onStartDateChange={handleStartDateChange}
      onEndDateChange={handleEndDateChange}
      columns={columns}
      data={filteredRows}
      emptyMessage={emptyMessage}
      getRowId={(item) => item.id}
    />
  );
}
