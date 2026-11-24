import { isCollectionCapped } from '../../lib/ledgerCollections';
import React, { useMemo, useState } from 'react';
import { Hash } from 'lucide-react';
import { toast } from 'sonner';
import { usePageSyncedState } from '../../hooks/usePageSyncedState';
import { useUIStore } from '../../stores/useUIStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { PartyReportLayout, ColumnDef } from './PartyReportLayout';
import { formatCurrency } from '../../lib/utils';
import { getFiscalYearBounds } from '../../lib/fiscalCalendar';
import { csvMoneyForBook, downloadCsv } from '../../lib/csvExport';
import type { ReferenceRow } from '../../server/reports/referenceReport';
import { useServerTransactionsByReference } from '../../hooks/useServerTransactionsByReference';
import { RangeReportSourceNote } from './RangeReportSourceNote';
import { useReportText, fill } from './useReportText';

/**
 * Transactions by Reference (J-06): posted entries listed under their reference: a cheque or bank
 * reference, or the invoice or bill number (src/server/reports/referenceReport.ts).
 */
export const TransactionsByReferenceView: React.FC<{ startDate?: string; endDate?: string }> = ({ startDate: pageStartDate, endDate: pageEndDate }) => {
  const reportText = useReportText();
  const openRecord = useUIStore(s => s.openRecord);
  const currency = useAuthStore(s => s.getCurrentWorkspace()?.currency) || 'USD';
  // #910 family: summary amounts are in the book currency, so the file's decimals come from it
  const moneyCell = csvMoneyForBook(currency);
  const periodKey = JSON.stringify([pageStartDate, pageEndDate]);
  const [startDate, setStartDate] = usePageSyncedState(periodKey, pageStartDate || undefined, () => getFiscalYearBounds().startDate);
  const [endDate, setEndDate] = usePageSyncedState(periodKey, pageEndDate || undefined, () => getFiscalYearBounds().endDate);
  const [searchTerm, setSearchTerm] = useState('');
  const truncated = useLedgerStore(s => s.truncatedCollections);
  // L-123 step 5b: what the list was built from, so a capped list is named rather than implied
  const capped = useMemo(
    () => (['bills', 'invoices', 'transactions'] as const).filter(key => isCollectionCapped(truncated, key)),
    [truncated],
  );

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
        ...shown.map(r => [r.reference, r.date, r.description, r.source, moneyCell(r.amountCents)])]);
    if (incomplete) toast.warning('Exported, marked incomplete: only the entries loaded in this browser');
    else toast.success('Transactions by Reference exported to CSV');
  };

  const columns: ColumnDef<ReferenceRow>[] = [
    { key: 'reference', header: reportText('r.reference', 'Reference'), render: (r) => <span className="font-mono font-semibold">{r.reference}</span> },
    { key: 'date', header: reportText('r.date-2', 'Date'), render: (r) => r.date.slice(0, 10) },
    {
      key: 'description',
      header: reportText('r.description', 'Description'),
      render: (r) => (
        <button type="button" onClick={() => openRecord({ type: 'transaction', id: r.transactionId })} className="text-left hover:underline">
          {r.description || reportText('r.no-description', '(no description)')}
        </button>
      ),
    },
    { key: 'source', header: reportText('r.from', 'From'), render: (r) => <span className="text-[var(--muted)]">{r.source}</span> },
    { key: 'amountCents', header: reportText('r.amount', 'Amount'), align: 'right', render: (r) => formatCurrency(r.amountCents, currency) },
  ];

  return (
    <div className="space-y-3">
      <PartyReportLayout
        title={reportText('r.transactions-by-reference', 'Transactions by Reference')}
        description={reportText('r.posted-entries-listed-under-their-cheque-bank-in', 'Posted entries listed under their cheque, bank, invoice or bill reference.')}
        icon={Hash}
        totalLabel={reportText('r.total-of-the-entries-listed', 'Total of the entries listed')}
        totalAmountCents={shown.reduce((sum, r) => sum + r.amountCents, 0)}
        currency={currency}
        exportFilename="transactions_by_reference.csv"
        onExportCSV={exportCsv}
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        searchPlaceholder={reportText('r.search-reference-or-description', 'Search reference or description...')}
        startDate={startDate}
        endDate={endDate}
        onStartDateChange={setStartDate}
        onEndDateChange={setEndDate}
        columns={columns}
        data={shown}
        emptyMessage={reportText('r.no-entries-with-a-reference-in-this-period', 'No entries with a reference in this period.')}
        sumKeys={['amountCents']}
        getRowId={(r) => r.transactionId}
        cappedCollections={source === 'server' ? [] : capped}
        cappedWhat={reportText('r.these-references', 'these references')}
        cappedTestId="transactions-by-reference-capped"
      />
      <RangeReportSourceNote source={source} testId="transactions-by-reference-source" what={reportText('r.these-references', 'these references')} reads="every entry and every invoice and bill number" />
      <p className="text-xs text-[var(--muted)]" role="status">
        {report.referenceCount} {reportText('r.reference-s', 'reference(s).')}{report.withoutReference > 0 ? ` ${fill(report.withoutReference === 1 ? reportText('r.no-ref-one', '{0} posted entry has no reference and is not listed.') : reportText('r.no-ref-many', '{0} posted entries have no reference and are not listed.'), { 0: report.withoutReference })}` : ''}
      </p>
    </div>
  );
};

export default TransactionsByReferenceView;
