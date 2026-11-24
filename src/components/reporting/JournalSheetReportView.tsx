import React, { useMemo } from 'react';
import { ShowMoreRows } from '../common/ShowMoreRows';
import { usePagedRows } from '../../hooks/usePagedRows';
import { BookOpen, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { formatCurrency, cn } from '../../lib/utils';
import { computeJournalSheet, yearRange } from '../../server/reports/itemReports';
import { RowTable } from '../ui/RowTable';
import { useReportText, fill } from './useReportText';
import { useBookCurrency } from '../../hooks/useBookCurrency';
import ReportEmptyState from './ReportEmptyState';
import { CappedCollectionsNote } from '../common/LoadedEntriesOnlyNote';

interface Props {
  selectedYear?: number;
  startDate?: string;
  endDate?: string;
}

export const JournalSheetReportView: React.FC<Props> = ({ selectedYear, startDate, endDate }) => {
  const reportText = useReportText();
  // R-11 / #926: the sheet says "in your base currency"; the amounts follow the book's currency
  const bookCurrency = useBookCurrency();
  const money = (cents: number) => formatCurrency(cents, bookCurrency);
  const transactions = useLedgerStore(s => s.transactions);
  const accounts = useLedgerStore(s => s.accounts);

  const { startDate: from, endDate: to } = startDate || endDate ? { startDate, endDate } : yearRange(selectedYear);
  const sheet = useMemo(
    () => computeJournalSheet(transactions || [], accounts || [], from, to),
    [transactions, accounts, from, to]
  );
  const unbalancedCount = sheet.unbalanced.length;
  // R-5: the first page draws at once; an unbalanced entry is always drawn, as the header counts it
  const paged = usePagedRows(sheet.entries, `${from || ''}|${to || ''}`, e => !e.isBalanced);
  const visible = paged.visible;

  return (
    <div className="space-y-6 max-w-6xl mx-auto p-4 sm:p-6 text-[var(--text)]" id="journal-sheet-report">
      <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-[var(--line)] pb-4 gap-4">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-[var(--brass)]" />
            {reportText('r.journal-sheet', 'Journal Sheet')}
          </h2>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            {reportText('r.every-posted-journal-entry-in-the-period-oldest', 'Every posted journal entry in the period, oldest first, with debits and credits in your base currency.')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs font-mono">
          <div>{reportText('r.debits', 'Debits:')} <span className="font-bold">{money(sheet.totals.debitCents)}</span></div>
          <div>{reportText('r.credits-2', 'Credits:')} <span className="font-bold">{money(sheet.totals.creditCents)}</span></div>
          {unbalancedCount > 0 ? (
            <div role="status" className="flex items-center gap-2 px-3 py-1.5 border border-[var(--neg)] rounded-xl text-[var(--neg)] font-bold font-sans">
              <AlertTriangle size={16} aria-hidden="true" />
              {unbalancedCount} {reportText('r.unbalanced', 'unbalanced')} {unbalancedCount === 1 ? reportText('r.entry-2', 'entry') : reportText('r.entries-3', 'entries')}
            </div>
          ) : (
            <div role="status" className="flex items-center gap-2 px-3 py-1.5 border border-[var(--pos)] rounded-xl text-[var(--pos)] font-bold font-sans">
              <CheckCircle2 size={16} aria-hidden="true" />
              {reportText('r.all-entries-balance', 'All entries balance')}
            </div>
          )}
        </div>
      </div>

      {/* R-8: the sheet is worked out from the entries loaded in this browser; when that list is
          capped the sheet covers the loaded entries and says so rather than looking complete. */}
      <CappedCollectionsNote testId="journal-sheet-capped" keys={['transactions']} what={reportText('r.this-journal-sheet', 'this journal sheet')} />

      {sheet.entries.length === 0 ? (
        (transactions || []).length === 0 ? (
          <ReportEmptyState
            title={reportText('r.no-entries-loaded-yet', 'No entries loaded yet')}
            description={reportText('r.this-sheet-reads-the-entries-in-this-browser-recor', 'This sheet reads the entries in this browser: record or import an entry and it appears here.')}
          />
        ) : (
          <ReportEmptyState
            title={reportText('r.no-posted-entries-between-these-dates', 'No posted entries between these dates')}
            description={reportText('r.choose-another-period-or-post-an-entry-drafts-an', 'Choose another period, or post an entry. Draft and voided entries are left out of a journal sheet.')}
          />
        )
      ) : (
        <div className="space-y-4">
          {visible.map(entry => (
            <div
              key={entry.id}
              className={cn('bg-[var(--panel)] rounded-2xl border p-5', entry.isBalanced ? 'border-[var(--line)]' : 'border-[var(--neg)]')}
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-[var(--line)]">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs font-bold text-[var(--muted)]">{entry.date}</span>
                  <span className="font-bold text-sm">{entry.description}</span>
                  {entry.type && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--surface)] text-[var(--muted)] uppercase">{entry.type}</span>
                  )}
                </div>
                <div className="flex items-center gap-4 text-xs font-mono">
                  <div>{reportText('r.debits', 'Debits:')} <span className="font-bold">{money(entry.debitCents)}</span></div>
                  <div>{reportText('r.credits-2', 'Credits:')} <span className="font-bold">{money(entry.creditCents)}</span></div>
                  {!entry.isBalanced && (
                    <div className="flex items-center gap-1 text-[var(--neg)] font-bold">
                      <AlertTriangle size={14} aria-hidden="true" />
                      {reportText('r.off-by', 'Off by')} {money(Math.abs(entry.imbalanceCents))}
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-3 overflow-x-auto">
                <RowTable
                  rowHeaderColumn={false}
                  caption={fill(reportText('r.lines-of-0', 'Lines of {0}'), { 0: entry.description || entry.id })}
                  rows={entry.lines}
                  rowKey={line => line.key}
                  tableClassName="w-full text-left text-xs"
                  headRowClassName="text-[var(--muted)] font-bold uppercase text-[10px]"
                  columns={[
                    { header: reportText('r.account', 'Account'), className: "py-2 font-medium", headClassName: "pb-2", cell: (line) => line.accountName },
                    { header: reportText('r.memo', 'Memo'), className: "py-2 text-[var(--muted)]", headClassName: "pb-2", cell: (line) => line.description || '—' },
                    { header: reportText('r.debit', 'Debit'), align: 'right', className: "py-2 font-mono", headClassName: "pb-2", cell: (line) => line.debitCents ? money(line.debitCents) : '—' },
                    { header: reportText('r.credit', 'Credit'), align: 'right', className: "py-2 font-mono", headClassName: "pb-2", cell: (line) => line.creditCents ? money(line.creditCents) : '—' },
                  ]}
                />
              </div>
            </div>
          ))}
          <ShowMoreRows shown={visible.length} total={paged.total} noun="entries" onMore={paged.more} onAll={paged.all} />
        </div>
      )}
    </div>
  );
};

export default JournalSheetReportView;
