import { RowTable } from '../ui/RowTable';
import { usePageSyncedState } from '../../hooks/usePageSyncedState';
import React, { useState, useMemo } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { computeGeneralLedger } from '../../server/reports/computeReports';
import { useServerGeneralLedger } from '../../hooks/useServerGeneralLedger';
import { RangeReportSourceNote } from '../reporting/RangeReportSourceNote';
import { Search, BookOpen, Printer } from 'lucide-react';
import { Labelled } from '../ui/Labelled';
import { usePagedRows } from '../../hooks/usePagedRows';
import { ShowMoreRows } from '../common/ShowMoreRows';
import { printElementById } from '../../lib/printRoot';
import { useReportDates } from '../reporting/useReportDates';
import { useReportLabelFilter } from '../reporting/ReportLabelFilter';
import { scopeTransactionsToLabel } from '../../lib/reportLabelScope';
import { useReportText } from '../reporting/useReportText';

function keyedLedgerEntries(entries: ReturnType<typeof computeGeneralLedger>['accounts'][number]['entries']) {
  const occurrences = new Map<string, number>();
  return entries.map(entry => {
    const content = JSON.stringify([
      entry.transactionId, entry.date, entry.description, entry.reference, entry.debitCents, entry.creditCents
    ]);
    const occurrence = occurrences.get(content) || 0;
    occurrences.set(content, occurrence + 1);
    return { entry, key: JSON.stringify([content, occurrence]) };
  });
}

type LedgerAccount = ReturnType<typeof computeGeneralLedger>['accounts'][number];

/** One account's ledger. #642: a busy account (the bank) draws its first page of lines at once; printing draws them all. */
function AccountLedgerCard({ acc, resetKey, dateText }: { acc: LedgerAccount; resetKey: string; dateText: (date: string) => string }) {
  const reportText = useReportText();
  const keyed = useMemo(() => keyedLedgerEntries(acc.entries), [acc.entries]);
  // fifty lines per account at first: a ledger of forty accounts would otherwise draw thousands of rows at once
  const paged = usePagedRows(keyed, resetKey, undefined, 50);
  return (
    <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-white dark:bg-slate-900 shadow-2xs">
      {/* Account Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 p-4 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800">
        <div>
          <span className="text-xs font-mono px-2 py-0.5 rounded-md bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 mr-2 font-bold">
            {acc.accountCode || reportText('r.n-a', 'N/A')}
          </span>
          <span className="text-sm font-bold text-slate-900 dark:text-white">
            {acc.accountName}
          </span>
          <span className="text-xs text-[var(--muted)] ml-2 capitalize">
            ({acc.type} • {acc.category})
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3 sm:gap-6 text-xs font-mono">
          <div>
            <span className="text-[var(--muted)] mr-1">{reportText('r.opening', 'Opening:')}</span>
            <span className="font-semibold text-slate-700 dark:text-slate-300">
              {formatCurrency(acc.openingBalanceCents)}
            </span>
          </div>
          <div>
            <span className="text-[var(--muted)] mr-1">{reportText('r.period-debits', 'Period Debits:')}</span>
            <span className="font-semibold text-[var(--pos)]">
              +{formatCurrency(acc.periodDebitsCents)}
            </span>
          </div>
          <div>
            <span className="text-[var(--muted)] mr-1">{reportText('r.period-credits', 'Period Credits:')}</span>
            <span className="font-semibold text-[var(--neg)]">
              -{formatCurrency(acc.periodCreditsCents)}
            </span>
          </div>
          <div className="pl-2 border-l border-slate-300 dark:border-slate-700">
            <span className="text-[var(--muted)] mr-1">{reportText('r.ending', 'Ending:')}</span>
            <span className="font-bold text-slate-900 dark:text-white">
              {formatCurrency(acc.endingBalanceCents)}
            </span>
          </div>
        </div>
      </div>

      {/* Entries Table */}
      {acc.entries.length === 0 ? (
        <div className="p-4 text-center text-xs text-[var(--muted)]">
          {reportText('r.no-transactions-recorded-in-selected-period', 'No transactions recorded in selected period')}
        </div>
      ) : (
        <div className="overflow-x-auto" role="region" aria-label={`${reportText('r.general-ledger', 'General Ledger')}: ${acc.accountName}`} tabIndex={0}>{/* NOSONAR: named, keyboard-scrollable schedule */}
          <RowTable
            caption={reportText('r.general-ledger', 'General Ledger')}
            captionClassName="sr-only"
            tableClassName="w-full text-left text-xs"
            headRowClassName="border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 text-[var(--muted)] font-semibold uppercase text-[10px]"
            bodyClassName="divide-y divide-slate-100 dark:divide-slate-800/60 font-mono"
            rowClassName="hover:bg-slate-50 dark:hover:bg-slate-800/30"
            rows={paged.visible}
            rowKey={({ key }) => key}
            rowHeaderClassName="font-normal text-start"
            columns={[
              {
                header: reportText('r.date-2', 'Date'),
                headClassName: 'py-2.5 px-4', className: 'py-2 px-4 text-slate-600 dark:text-slate-400 whitespace-nowrap',
                cell: ({ entry }) => dateText(entry.date),
              },
              {
                header: reportText('r.description', 'Description'),
                headClassName: 'py-2.5 px-4',
                rowHeader: true,
                className: 'py-2 px-4 text-slate-900 dark:text-white font-sans font-medium',
                cell: ({ entry }) => entry.description,
              },
              {
                header: reportText('r.reference', 'Reference'),
                headClassName: 'py-2.5 px-4', className: 'py-2 px-4 text-[var(--muted)]',
                cell: ({ entry }) => entry.reference || '-',
              },
              {
                header: reportText('r.debit', 'Debit'),
                headClassName: 'py-2.5 px-4 text-right', className: 'py-2 px-4 text-right text-[var(--pos)]',
                cell: ({ entry }) => (entry.debitCents > 0 ? formatCurrency(entry.debitCents) : '-'),
              },
              {
                header: reportText('r.credit', 'Credit'),
                headClassName: 'py-2.5 px-4 text-right', className: 'py-2 px-4 text-right text-[var(--neg)]',
                cell: ({ entry }) => (entry.creditCents > 0 ? formatCurrency(entry.creditCents) : '-'),
              },
              {
                header: reportText('r.running-balance', 'Running Balance'),
                headClassName: 'py-2.5 px-4 text-right', className: 'py-2 px-4 text-right font-bold text-slate-900 dark:text-white',
                cell: ({ entry }) => formatCurrency(entry.runningBalanceCents),
              },
            ]}
          />
          <ShowMoreRows shown={paged.visible.length} total={paged.total} noun="lines" onMore={paged.more} onAll={paged.all} />
        </div>
      )}
    </div>
  );
}

export default function GeneralLedgerView({ startDate: pageStartDate, endDate: pageEndDate, embedded = false }: { startDate?: string; endDate?: string; embedded?: boolean } = {}) {
  const reportText = useReportText();
  const accounts = useLedgerStore(s => s.accounts);
  const reportDates = useReportDates();

  const [startDate, setStartDate] = usePageSyncedState(JSON.stringify([pageStartDate, pageEndDate]), pageStartDate || undefined, '2026-01-01');
  const [endDate, setEndDate] = usePageSyncedState(JSON.stringify([pageStartDate, pageEndDate]), pageEndDate || undefined, getLocalDateISO());
  // Follow the Reports page period when it gives one
  const [selectedAccountId, setSelectedAccountId] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');

  // L-123 step 5a: the server's ledger when the loaded entries are capped; one account is picked from it
  const { ledger: wholeLedger, source } = useServerGeneralLedger(startDate, endDate);
  // EU-E4: one label's lines only. Built from the loaded entries, so it is offered only when none are left out
  const capped = useLedgerStore(s => Boolean(s.truncatedCollections?.transactions));
  const { filter: labelFilter, control: labelControl } = useReportLabelFilter();
  const allTransactions = useLedgerStore(s => s.transactions);
  const nodes = useLedgerStore(s => s.dimensionNodes);
  const ledger = useMemo(() => (labelFilter && !capped
    // the chart's opening balance belongs to the whole company, not to one label: it is left out here
    ? computeGeneralLedger(accounts.map(a => ({ ...a, openingBalanceCents: 0 })), scopeTransactionsToLabel(allTransactions || [], labelFilter, nodes || []), startDate, endDate)
    : wholeLedger), [labelFilter, capped, accounts, allTransactions, nodes, startDate, endDate, wholeLedger]);
  const glData = useMemo(() => (selectedAccountId === 'all' ? ledger : { ...ledger, accounts: ledger.accounts.filter(a => a.accountId === selectedAccountId) }),
    [ledger, selectedAccountId]);

  const filteredAccounts = useMemo(() => {
    if (!searchTerm) return glData.accounts;
    const term = searchTerm.toLowerCase();
    return glData.accounts.filter(a => 
      a.accountName.toLowerCase().includes(term) ||
      a.accountCode.toLowerCase().includes(term) ||
      a.category.toLowerCase().includes(term)
    );
  }, [glData.accounts, searchTerm]);

  // Row pagination resets when the requested period or account search changes.
  // This is an internal hook key; it is never displayed as a reader-facing date.
  const paginationKey = [startDate, endDate, searchTerm].join('|');

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto">
      <div id="general-ledger-sheet" data-print-root={embedded ? undefined : ''} className="space-y-6">
        <div className="hidden print:block">
          <h1 className="text-xl font-bold">{reportText('r.general-ledger', 'General Ledger')}</h1>
          <p className="text-xs">{selectedAccountId === 'all' ? reportText('r.all-accounts', 'All accounts') : accounts.find(a => a.id === selectedAccountId)?.name || reportText('r.account', 'Account')} · {reportDates.periodText(startDate, endDate)}</p>
          {labelFilter && !capped && <p className="text-xs">{reportText('r.only', 'Only')} {labelFilter.dimensionId} = {labelFilter.value}{reportText('r.opening-balances-not-carried-by-a-label-are-left', '; opening balances not carried by a label are left out.')}</p>}
        </div>
      <RangeReportSourceNote source={source} testId="general-ledger-source" what={reportText('r.these-balances-and-lines', 'these balances and lines')} />
      {/* Header */}
      <div data-print-hide className="flex flex-wrap items-start sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
            <BookOpen aria-hidden="true" className="w-6 h-6" />
          </div>
          <div>
            {embedded
              ? <h2 className="text-xl font-bold text-slate-900 dark:text-white">{reportText('r.general-ledger', 'General Ledger')}</h2>
              : <h1 className="text-xl font-bold text-slate-900 dark:text-white">{reportText('r.general-ledger', 'General Ledger')}</h1>}
            <p className="text-xs text-[var(--muted)] dark:text-slate-400">
              {reportText('r.complete-itemized-transaction-ledger-for-all-cha', 'Complete itemized transaction ledger for all chart of accounts')}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => embedded ? window.print() : printElementById('general-ledger-sheet')}
          className="inline-flex items-center gap-2 min-h-11 px-3.5 py-2 text-xs font-semibold bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-100 text-white dark:text-slate-900 rounded-lg transition-colors print:hidden"
        >
          <Printer aria-hidden="true" className="w-4 h-4" />
          {reportText('r.print-ledger', 'Print Ledger')}
        </button>
      </div>

      {/* Filter Bar */}
      <div data-print-hide className="flex flex-wrap items-center justify-between gap-4 p-4 bg-slate-50 dark:bg-slate-900/60 rounded-xl border border-slate-200 dark:border-slate-800">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <Labelled labelClassName="block text-[10px] font-bold text-[var(--muted)] uppercase mb-1" label={reportText('r.from', 'From')}>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="min-h-11 px-3 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
              />
            </Labelled>
          </div>
          <div>
            <Labelled labelClassName="block text-[10px] font-bold text-[var(--muted)] uppercase mb-1" label={reportText('r.to', 'To')}>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="min-h-11 px-3 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
              />
            </Labelled>
          </div>
          <div>
            <Labelled labelClassName="block text-[10px] font-bold text-[var(--muted)] uppercase mb-1" label={reportText('r.account', 'Account')}>
              <select
                value={selectedAccountId}
                onChange={e => setSelectedAccountId(e.target.value)}
                className="min-h-11 px-3 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white max-w-full"
              >
                <option value="all">{reportText('r.all-accounts-2', 'All Accounts (')}{accounts.length})</option>
                {accounts.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.code ? `${a.code} - ${a.name}` : a.name}
                  </option>
                ))}
              </select>
            </Labelled>
          </div>
          {/* EU-E4: hidden, not ignored, when entries are left out of this browser */}
          {!capped && labelControl && <div className="w-full sm:w-56">{labelControl}</div>}
        </div>

        <div className="relative w-full sm:w-auto">
          <Search aria-hidden="true" className="w-4 h-4 absolute left-3 top-3.5 text-[var(--muted)]" />
          <input aria-label={reportText('r.search-gl-accounts', 'Search GL accounts')}
            type="text"
            placeholder={reportText('r.search-gl-accounts-2', 'Search GL accounts...')}
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="min-h-11 pl-9 pr-3 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white w-full sm:w-56"
          />
        </div>
      </div>

      {/* Account Ledgers List */}
      <div className="space-y-6">
        {filteredAccounts.map(acc => <AccountLedgerCard key={acc.accountId} acc={acc} resetKey={paginationKey} dateText={reportDates.dateText} />)}
      </div>
      </div>
    </div>
  );
}
