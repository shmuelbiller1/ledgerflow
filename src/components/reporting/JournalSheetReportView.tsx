import React, { useMemo } from 'react';
import { ShowMoreRows } from '../common/ShowMoreRows';
import { usePagedRows } from '../../hooks/usePagedRows';
import { BookOpen, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { formatCurrency, cn } from '../../lib/utils';
import { computeJournalSheet, yearRange } from '../../server/reports/itemReports';

interface Props {
  selectedYear?: number;
  startDate?: string;
  endDate?: string;
}

export const JournalSheetReportView: React.FC<Props> = ({ selectedYear, startDate, endDate }) => {
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
            Journal Sheet
          </h2>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            Every posted journal entry in the period, oldest first, with debits and credits in your base currency.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs font-mono">
          <div>Debits: <span className="font-bold">{formatCurrency(sheet.totals.debitCents)}</span></div>
          <div>Credits: <span className="font-bold">{formatCurrency(sheet.totals.creditCents)}</span></div>
          {unbalancedCount > 0 ? (
            <div role="status" className="flex items-center gap-2 px-3 py-1.5 border border-[var(--neg)] rounded-xl text-[var(--neg)] font-bold font-sans">
              <AlertTriangle size={16} aria-hidden="true" />
              {unbalancedCount} unbalanced {unbalancedCount === 1 ? 'entry' : 'entries'}
            </div>
          ) : (
            <div role="status" className="flex items-center gap-2 px-3 py-1.5 border border-[var(--pos)] rounded-xl text-[var(--pos)] font-bold font-sans">
              <CheckCircle2 size={16} aria-hidden="true" />
              All entries balance
            </div>
          )}
        </div>
      </div>

      {sheet.entries.length === 0 ? (
        <div className="text-center py-12 bg-[var(--panel)] rounded-lg border border-[var(--line)] text-[var(--muted)] text-xs">
          No posted transactions in the selected period.
        </div>
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
                  <div>Debits: <span className="font-bold">{formatCurrency(entry.debitCents)}</span></div>
                  <div>Credits: <span className="font-bold">{formatCurrency(entry.creditCents)}</span></div>
                  {!entry.isBalanced && (
                    <div className="flex items-center gap-1 text-[var(--neg)] font-bold">
                      <AlertTriangle size={14} aria-hidden="true" />
                      Off by {formatCurrency(Math.abs(entry.imbalanceCents))}
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <caption className="sr-only">{`Lines of ${entry.description || entry.id}`}</caption>
                  <thead>
                    <tr className="text-[var(--muted)] font-bold uppercase text-[10px]">
                      <th scope="col" className="pb-2">Account</th>
                      <th scope="col" className="pb-2">Memo</th>
                      <th scope="col" className="pb-2 text-right">Debit</th>
                      <th scope="col" className="pb-2 text-right">Credit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--line)]">
                    {entry.lines.map(line => (
                      <tr key={line.key}>
                        <td className="py-2 font-medium">{line.accountName}</td>
                        <td className="py-2 text-[var(--muted)]">{line.description || '—'}</td>
                        <td className="py-2 text-right font-mono">{line.debitCents ? formatCurrency(line.debitCents) : '—'}</td>
                        <td className="py-2 text-right font-mono">{line.creditCents ? formatCurrency(line.creditCents) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
