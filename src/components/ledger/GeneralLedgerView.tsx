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
  const keyed = useMemo(() => keyedLedgerEntries(acc.entries), [acc.entries]);
  // fifty lines per account at first: a ledger of forty accounts would otherwise draw thousands of rows at once
  const paged = usePagedRows(keyed, resetKey, undefined, 50);
  return (
    <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-white dark:bg-slate-900 shadow-2xs">
      {/* Account Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 p-4 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800">
        <div>
          <span className="text-xs font-mono px-2 py-0.5 rounded-md bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 mr-2 font-bold">
            {acc.accountCode || 'N/A'}
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
            <span className="text-[var(--muted)] mr-1">Opening:</span>
            <span className="font-semibold text-slate-700 dark:text-slate-300">
              {formatCurrency(acc.openingBalanceCents)}
            </span>
          </div>
          <div>
            <span className="text-[var(--muted)] mr-1">Period Debits:</span>
            <span className="font-semibold text-emerald-600 dark:text-emerald-400">
              +{formatCurrency(acc.periodDebitsCents)}
            </span>
          </div>
          <div>
            <span className="text-[var(--muted)] mr-1">Period Credits:</span>
            <span className="font-semibold text-rose-600 dark:text-rose-400">
              -{formatCurrency(acc.periodCreditsCents)}
            </span>
          </div>
          <div className="pl-2 border-l border-slate-300 dark:border-slate-700">
            <span className="text-[var(--muted)] mr-1">Ending:</span>
            <span className="font-bold text-slate-900 dark:text-white">
              {formatCurrency(acc.endingBalanceCents)}
            </span>
          </div>
        </div>
      </div>

      {/* Entries Table */}
      {acc.entries.length === 0 ? (
        <div className="p-4 text-center text-xs text-[var(--muted)]">
          No transactions recorded in selected period
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">General Ledger</caption>
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 text-[var(--muted)] font-semibold uppercase text-[10px]">
                <th scope="col" className="py-2.5 px-4">Date</th>
                <th scope="col" className="py-2.5 px-4">Description</th>
                <th scope="col" className="py-2.5 px-4">Reference</th>
                <th scope="col" className="py-2.5 px-4 text-right">Debit</th>
                <th scope="col" className="py-2.5 px-4 text-right">Credit</th>
                <th scope="col" className="py-2.5 px-4 text-right">Running Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-mono">
              {paged.visible.map(({ entry, key }) => (
                <tr key={key} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                  <td className="py-2 px-4 text-slate-600 dark:text-slate-400 whitespace-nowrap">{dateText(entry.date)}</td>
                  <td className="py-2 px-4 text-slate-900 dark:text-white font-sans font-medium">{entry.description}</td>
                  <td className="py-2 px-4 text-[var(--muted)]">{entry.reference || '-'}</td>
                  <td className="py-2 px-4 text-right text-emerald-600 dark:text-emerald-400">
                    {entry.debitCents > 0 ? formatCurrency(entry.debitCents) : '-'}
                  </td>
                  <td className="py-2 px-4 text-right text-rose-600 dark:text-rose-400">
                    {entry.creditCents > 0 ? formatCurrency(entry.creditCents) : '-'}
                  </td>
                  <td className="py-2 px-4 text-right font-bold text-slate-900 dark:text-white">
                    {formatCurrency(entry.runningBalanceCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <ShowMoreRows shown={paged.visible.length} total={paged.total} noun="lines" onMore={paged.more} onAll={paged.all} />
        </div>
      )}
    </div>
  );
}

export default function GeneralLedgerView({ startDate: pageStartDate, endDate: pageEndDate, embedded = false }: { startDate?: string; endDate?: string; embedded?: boolean } = {}) {
  const accounts = useLedgerStore(s => s.accounts);
  const reportDates = useReportDates();

  const [startDate, setStartDate] = usePageSyncedState(JSON.stringify([pageStartDate, pageEndDate]), pageStartDate || undefined, '2026-01-01');
  const [endDate, setEndDate] = usePageSyncedState(JSON.stringify([pageStartDate, pageEndDate]), pageEndDate || undefined, getLocalDateISO());
  // Follow the Reports page period when it gives one
  const [selectedAccountId, setSelectedAccountId] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');

  // L-123 step 5a: the server's ledger when the loaded entries are capped; one account is picked from it
  const { ledger, source } = useServerGeneralLedger(startDate, endDate);
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

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto">
      <div id="general-ledger-sheet" data-print-root={embedded ? undefined : ''} className="space-y-6">
        <div className="hidden print:block">
          <h1 className="text-xl font-bold">General Ledger</h1>
          <p className="text-xs">{selectedAccountId === 'all' ? 'All accounts' : accounts.find(a => a.id === selectedAccountId)?.name || 'Account'} · {reportDates.periodText(startDate, endDate)}</p>
        </div>
      <RangeReportSourceNote source={source} testId="general-ledger-source" what="these balances and lines" />
      {/* Header */}
      <div data-print-hide className="flex flex-wrap items-start sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
            <BookOpen aria-hidden="true" className="w-6 h-6" />
          </div>
          <div>
            {embedded
              ? <h2 className="text-xl font-bold text-slate-900 dark:text-white">General Ledger</h2>
              : <h1 className="text-xl font-bold text-slate-900 dark:text-white">General Ledger</h1>}
            <p className="text-xs text-[var(--muted)] dark:text-slate-400">
              Complete itemized transaction ledger for all chart of accounts
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => embedded ? window.print() : printElementById('general-ledger-sheet')}
          className="inline-flex items-center gap-2 min-h-11 px-3.5 py-2 text-xs font-semibold bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-100 text-white dark:text-slate-900 rounded-lg transition-colors print:hidden"
        >
          <Printer aria-hidden="true" className="w-4 h-4" />
          Print Ledger
        </button>
      </div>

      {/* Filter Bar */}
      <div data-print-hide className="flex flex-wrap items-center justify-between gap-4 p-4 bg-slate-50 dark:bg-slate-900/60 rounded-xl border border-slate-200 dark:border-slate-800">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <Labelled labelClassName="block text-[10px] font-bold text-[var(--muted)] uppercase mb-1" label="From">
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="min-h-11 px-3 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
              />
            </Labelled>
          </div>
          <div>
            <Labelled labelClassName="block text-[10px] font-bold text-[var(--muted)] uppercase mb-1" label="To">
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="min-h-11 px-3 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
              />
            </Labelled>
          </div>
          <div>
            <Labelled labelClassName="block text-[10px] font-bold text-[var(--muted)] uppercase mb-1" label="Account">
              <select
                value={selectedAccountId}
                onChange={e => setSelectedAccountId(e.target.value)}
                className="min-h-11 px-3 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white max-w-full"
              >
                <option value="all">All Accounts ({accounts.length})</option>
                {accounts.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.code ? `${a.code} - ${a.name}` : a.name}
                  </option>
                ))}
              </select>
            </Labelled>
          </div>
        </div>

        <div className="relative w-full sm:w-auto">
          <Search aria-hidden="true" className="w-4 h-4 absolute left-3 top-3.5 text-[var(--muted)]" />
          <input aria-label="Search GL accounts"
            type="text"
            placeholder="Search GL accounts..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="min-h-11 pl-9 pr-3 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white w-full sm:w-56"
          />
        </div>
      </div>

      {/* Account Ledgers List */}
      <div className="space-y-6">
        {filteredAccounts.map(acc => <AccountLedgerCard key={acc.accountId} acc={acc} resetKey={`${startDate}|${endDate}|${searchTerm}`} dateText={reportDates.dateText} />)}
      </div>
      </div>
    </div>
  );
}
