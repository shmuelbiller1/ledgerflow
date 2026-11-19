import React, { useMemo, useState } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import {
  DOCUMENT_NUMBER_GAP_CSV_HEADERS, documentNumberGapCsvRows, documentNumberGaps,
  type DocumentNumberReport, type NumberedDocument, type NumberSeriesGap,
} from '../../lib/documentNumberGaps';
import { downloadCsv } from '../../lib/csvExport';
import ReportTableScroll from './ReportTableScroll';
import { RowTable } from '../ui/RowTable';
import { useReportText, fill } from './useReportText';

/** Drafts, voids and cancelled documents are not part of the issued sequence. */
const NOT_ISSUED = new Set(['draft', 'void', 'cancelled', 'canceled', 'rejected']);
const MAX_MISSING_SHOWN = 24;

interface SourceDocument {
  id: string;
  number?: string;
  date?: string;
  status?: string;
  workspaceId?: string;
}

/**
 * A-184: missing and repeated numbers inside each document series. Read-only: a gap can be a
 * legitimate draft, a document from another system or a lost document, so the report shows the
 * numbers instead of judging them.
 */
export default function DocumentNumberGapsReportView() {
  const invoices = useLedgerStore(state => state.invoices);
  const bills = useLedgerStore(state => state.bills);
  const creditNotes = useLedgerStore(state => state.creditNotes);
  const estimates = useLedgerStore(state => state.estimates);
  const truncated = useLedgerStore(state => state.truncatedCollections);
  const failed = useDataNeedsStore(state => state.failed);
  const workspaceId = useAuthStore(state => state.currentWorkspaceId);
  const { loading } = useLedgerCollections('invoices', 'bills', 'creditNotes', 'estimates');

  const report = useMemo(() => {
    const collect = (rows: readonly SourceDocument[], collection: string, numbered: NumberedDocument[], excluded: { count: number }) => {
      for (const row of rows) {
        if (workspaceId && row.workspaceId && row.workspaceId !== workspaceId) continue;
        if (NOT_ISSUED.has((row.status || '').toLowerCase())) { excluded.count++; continue; }
        numbered.push({ id: row.id, collection, number: row.number, date: row.date, status: row.status });
      }
    };
    const documents: NumberedDocument[] = [];
    const excluded = { count: 0 };
    collect(invoices as SourceDocument[], 'Invoice', documents, excluded);
    collect(bills as SourceDocument[], 'Bill', documents, excluded);
    collect(creditNotes as SourceDocument[], 'Credit note', documents, excluded);
    collect(estimates as SourceDocument[], 'Estimate', documents, excluded);
    return { report: documentNumberGaps(documents), excludedDrafts: excluded.count, documents: documents.length };
  }, [invoices, bills, creditNotes, estimates, workspaceId]);

  const partial = Boolean(truncated.invoices || failed.invoices || truncated.bills || failed.bills ||
    truncated.creditNotes || failed.creditNotes || truncated.estimates || failed.estimates);
  return <DocumentNumberGapsPanel report={report.report} documents={report.documents} excludedDrafts={report.excludedDrafts} loading={loading} partial={partial} />;
}

export function DocumentNumberGapsPanel({ report, documents = 0, excludedDrafts = 0, loading = false, partial = false }: {
  report: DocumentNumberReport;
  documents?: number;
  excludedDrafts?: number;
  loading?: boolean;
  partial?: boolean;
}) {
  const reportText = useReportText();
  const [onlyGaps, setOnlyGaps] = useState(false);
  const visible = report.series.filter(series => !onlyGaps || series.missingCount > 0 || series.duplicates.length > 0);
  const missingText = (series: NumberSeriesGap) => series.missing.slice(0, MAX_MISSING_SHOWN).join(', ') +
    (series.missing.length > MAX_MISSING_SHOWN ? ` … (${series.missingCount} missing in all)` : '');

  return <section aria-label={reportText('r.document-number-gaps', 'Document number gaps')} className="p-4 space-y-4 min-w-0">
    <h2>{reportText('r.document-number-gaps', 'Document number gaps')}</h2>
    <p className="text-sm text-[var(--muted)]">
      {reportText('r.issued-invoices-bills-credit-notes-and-estimates', 'Issued invoices, bills, credit notes and estimates are read by their number: everything before the trailing digits is the series, and the digits are the counter. A missing number is not proof that a document was deleted — a number skipped by an import, a numbering restart or a hand-written book all leave the same hole — and repeated numbers are shown separately because they matter more. Draft, void, cancelled and rejected documents are excluded and counted; this report changes nothing.')}
    </p>

    {loading && <p role="status">{reportText('r.loading-documents', 'Loading documents…')}</p>}
    {partial && <p role="alert">{reportText('r.at-least-one-loaded-document-list-is-capped-or-f', 'At least one loaded document list is capped or failed. Series gaps and the export are provisional until every list is complete.')}</p>}
    <div className="flex flex-wrap items-end gap-3" data-print-hide>
      <label className="min-h-11 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={onlyGaps} onChange={event => setOnlyGaps(event.target.checked)} />
        {reportText('r.only-series-with-a-gap-or-a-repeated-number', 'Only series with a gap or a repeated number')}
      </label>
      <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]" disabled={loading || partial || !visible.length}
        onClick={() => downloadCsv('document-number-gaps', DOCUMENT_NUMBER_GAP_CSV_HEADERS, documentNumberGapCsvRows(visible))}>{reportText('r.export-csv', 'Export CSV')}</button>
    </div>

    <dl className="text-sm grid gap-1 sm:grid-cols-2 lg:grid-cols-4">
      <div><dt className="text-[var(--muted)]">{reportText('r.issued-documents-read', 'Issued documents read')}</dt><dd className="font-semibold tabular-nums">{documents - excludedDrafts}</dd></div>
      <div><dt className="text-[var(--muted)]">{reportText('r.series', 'Series')}</dt><dd className="font-semibold tabular-nums">{report.series.length}</dd></div>
      <div><dt className="text-[var(--muted)]">{reportText('r.missing-numbers', 'Missing numbers')}</dt><dd className="font-semibold tabular-nums">{report.missingTotal}</dd></div>
      <div><dt className="text-[var(--muted)]">{reportText('r.repeated-numbers', 'Repeated numbers')}</dt><dd className="font-semibold tabular-nums">{report.duplicateTotal}</dd></div>
    </dl>
    <p className="text-sm text-[var(--muted)]">
      {reportText('r.excluded-2', 'Excluded:')} {excludedDrafts} {reportText('r.draft-void-cancelled-or-rejected-document-s', 'draft, void, cancelled or rejected document(s).')}
      {report.unnumbered > 0 ? ` ${fill(reportText('r.0-issued-document-s-have-no-number-at-all', '{0} issued document(s) have no number at all.'), { 0: report.unnumbered })}` : ''}
      {report.unparsable.length > 0 ? ` ${fill(reportText('r.0-number-s-have-no-trailing-digits-to-read-a-ser', '{0} number(s) have no trailing digits to read a series from.'), { 0: report.unparsable.length })}` : ''}
    </p>

    <ReportTableScroll>
      <RowTable
        rowClassName="border-b border-[var(--line)]/50 align-top"
        caption={(<>{reportText('r.number-series-with-their-first-and-last-number-t', 'Number series with their first and last number, the numbers missing between them and any repeated number')}</>)}
        rows={visible}
        rowKey={series => `${series.collection}-${series.prefix}`}
        captionClassName="text-left font-semibold text-[var(--text)] pb-1"
        tableClassName="w-full text-sm"
        headRowClassName="border-b border-[var(--line)] text-xs text-[var(--muted)]"
        bodyClassName=""
        columns={[
          { header: reportText('r.document-type', 'Document type'), className: "text-left font-normal py-1 px-2", headClassName: "text-left py-1 px-2", cell: (series) => series.collection },
          { header: reportText('r.series', 'Series'), className: "py-1 px-2 font-mono", headClassName: "text-left py-1 px-2", cell: (series) => series.prefix || '(no prefix)' },
          { header: reportText('r.documents-heading', 'Documents'), className: "py-1 px-2 tabular-nums", headClassName: "text-left py-1 px-2", cell: (series) => series.documents },
          { header: reportText('r.first-last', 'First–last'), className: "py-1 px-2 tabular-nums", headClassName: "text-left py-1 px-2", cell: (series) => (<>{series.first}–{series.last}</>) },
          { header: reportText('r.missing', 'Missing'), className: "py-1 px-2 tabular-nums", headClassName: "text-left py-1 px-2", cell: (series) => series.missingCount === 0 ? 'None' : missingText(series) },
          { header: reportText('r.repeated', 'Repeated'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (series) => series.duplicates.length === 0 ? 'None' : series.duplicates.map(duplicate => duplicate.number).join(', ') },
        ]}
      />
      {!loading && !visible.length && <p className="text-sm text-[var(--muted)]">{reportText('r.no-series-to-show', 'No series to show')}{onlyGaps ? ` ${reportText('r.with-a-gap', 'with a gap')}` : ''}.</p>}
    </ReportTableScroll>

    {report.unparsable.length > 0 && <div className="space-y-1">
      <h3 className="font-semibold text-sm">{reportText('r.numbers-without-a-readable-series', 'Numbers without a readable series')}</h3>
      <ul className="text-sm list-disc ps-5">
        {report.unparsable.slice(0, 20).map(row => <li key={`${row.collection}-${row.id}`}>{row.collection}: <bdi className="font-mono">{row.number}</bdi></li>)}
      </ul>
      {report.unparsable.length > 20 && <p className="text-sm text-[var(--muted)]">{fill(reportText('r.and-n-more', '…and {n} more.'), { n: report.unparsable.length - 20 })}</p>}
    </div>}
  </section>;
}
