import React, { useMemo, useState } from 'react';
import { Hash } from 'lucide-react';
import { toast } from 'sonner';
import { usePageSyncedState } from '../../hooks/usePageSyncedState';
import { useUIStore } from '../../stores/useUIStore';
import { PartyReportLayout, ColumnDef } from './PartyReportLayout';
import { formatCurrency } from '../../lib/utils';
import { getFiscalYearBounds } from '../../lib/fiscalCalendar';
import { csvMoney, downloadCsv } from '../../lib/csvExport';
import type { ReferenceRow } from '../../server/reports/referenceReport';
import { useServerTransactionsByReference } from '../../hooks/useServerTransactionsByReference';
import { RangeReportSourceNote } from './RangeReportSourceNote';

/**
 * Transactions by Reference (J-06): posted entries listed under their reference: a cheque or bank
 * reference, or the invoice or bill number (src/server/reports/referenceReport.ts).
 */
export const TransactionsByReferenceView: React.FC<{ startDate?: string; endDate?: string }> = ({ startDate: pageStartDate, endDate: pageEndDate }) => {
  const openRecord = useUIStore(s => s.openRecord);
  const periodKey = JSON.stringify([pageStartDate, pageEndDate]);
  const [startDate, setStartDate] = usePageSyncedState(periodKey, pageStartDate || undefined, () => getFiscalYearBounds().startDate);
  const [endDate, setEndDate] = usePageSyncedState(periodKey, pageEndDate || undefined, () => getFiscalYearBounds().endDate);
  const [searchTerm, setSearchTerm] = useState('');

  // L-123 step 5b: the server's list when the loaded entries, invoices or bills are short
  const { report, source } = useServerTransactionsByReference(startDate, endDate);

  const shown = useMemo(() => {
    const term = searchTerm.trim().toLocaleLowerCase();
    return term ? report.rows.filter(r => `${r.reference} ${r.description}`.toLocaleLowerCase().includes(term)) : report.rows;
  }, [report.rows, searchTerm]);

  const exportCsv = () => {
    // only what is loaded, the server not reached: the file says so in its name and first row (CodeRabbit on #512)
    const incomplete = source === 'loaded-incomplete';
    downloadCsv(`transactions_by_reference_${startDate}_${endDate}${incomplete ? '_INCOMPLETE' : ''}.csv`,
      ['Reference', 'Date', 'Description', 'From', 'Amount'],
      [...(incomplete ? [['INCOMPLETE: only the entries loaded in this browser; the server could not be asked', '', '', '', '']] : []),
        ...shown.map(r => [r.reference, r.date, r.description, r.source, csvMoney(r.amountCents)])]);
    if (incomplete) toast.warning('Exported, marked incomplete: only the entries loaded in this browser');
    else toast.success('Transactions by Reference exported to CSV');
  };

  const columns: ColumnDef<ReferenceRow>[] = [
    { key: 'reference', header: 'Reference', render: (r) => <span className="font-mono font-semibold">{r.reference}</span> },
    { key: 'date', header: 'Date', render: (r) => r.date.slice(0, 10) },
    {
      key: 'description',
      header: 'Description',
      render: (r) => (
        <button type="button" onClick={() => openRecord({ type: 'transaction', id: r.transactionId })} className="text-left hover:underline">
          {r.description || '(no description)'}
        </button>
      ),
    },
    { key: 'source', header: 'From', render: (r) => <span className="text-[var(--muted)]">{r.source}</span> },
    { key: 'amountCents', header: 'Amount', align: 'right', render: (r) => formatCurrency(r.amountCents) },
  ];

  return (
    <div className="space-y-3">
      <PartyReportLayout
        title="Transactions by Reference"
        description="Posted entries listed under their cheque, bank, invoice or bill reference."
        icon={Hash}
        totalLabel="Total of the entries listed"
        totalAmountCents={shown.reduce((sum, r) => sum + r.amountCents, 0)}
        exportFilename="transactions_by_reference.csv"
        onExportCSV={exportCsv}
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        searchPlaceholder="Search reference or description..."
        startDate={startDate}
        endDate={endDate}
        onStartDateChange={setStartDate}
        onEndDateChange={setEndDate}
        columns={columns}
        data={shown}
        emptyMessage="No entries with a reference in this period."
        sumKeys={['amountCents']}
        getRowId={(r) => r.transactionId}
      />
      <RangeReportSourceNote source={source} testId="transactions-by-reference-source" what="these references" reads="every entry and every invoice and bill number" />
      <p className="text-xs text-[var(--muted)]" role="status">
        {report.referenceCount} reference(s).{report.withoutReference > 0 ? ` ${report.withoutReference} posted entr${report.withoutReference === 1 ? 'y has' : 'ies have'} no reference and are not listed.` : ''}
      </p>
    </div>
  );
};

export default TransactionsByReferenceView;
