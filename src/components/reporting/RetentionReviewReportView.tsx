import React, { useEffect, useMemo, useState } from 'react';
import { useCollection } from '../../hooks/useCollection';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { loadAttachmentLinkIndex, type AttachmentLinkIndexRow } from '../../services/attachmentActions';
import { validCustomReportPeriod } from '../../lib/reportCustomPeriod';
import { getLocalDateISO } from '../../lib/utils';
import { normalizeSearchText } from '../../lib/textNormalization';
import { downloadCsv } from '../../lib/csvExport';
import { retentionReview, retentionReviewCsvRows, RECORD_RETENTION_REVIEW_PERIODS, RETENTION_REVIEW_CSV_HEADERS, type RetentionReviewReport, type RetentionSourceRecord } from '../../lib/retentionReview';
import ReportTableScroll from './ReportTableScroll';
import type { AttachmentCollection } from '../../lib/attachments';
import type { Bill, CreditNote, DimensionNode, Estimate, Invoice, PurchaseOrder, VendorCredit } from '../../types';

const field = 'min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]';
const RETENTION_COLLECTIONS: AttachmentCollection[] = ['invoices', 'bills', 'estimates', 'purchaseOrders'];
const DOCUMENT_LIMIT = 10_000;

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function dimensionMap(value: unknown): Record<string, string> | undefined {
  const object = asObject(value);
  if (!object) return undefined;
  const entries = Object.entries(object).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && Boolean(entry[1].trim()));
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function dimensionsOf(record: { metadata?: unknown; dimensions?: unknown }, worldDimensionId: string): Record<string, string> | undefined {
  const direct = dimensionMap(record.dimensions);
  if (direct?.[worldDimensionId]) return direct;
  const metadataDimensions = dimensionMap(asObject(record.metadata)?.dimensions);
  return metadataDimensions?.[worldDimensionId] ? metadataDimensions : direct || metadataDimensions;
}

function toRetentionRecords(input: {
  workspaceId: string;
  invoices: Invoice[];
  bills: Bill[];
  creditNotes: CreditNote[];
  vendorCredits: VendorCredit[];
  estimates: Estimate[];
  purchaseOrders: PurchaseOrder[];
  worldDimensionId: string;
}): RetentionSourceRecord[] {
  const inWorkspace = <T extends { workspaceId: string }>(records: T[]) => records.filter(record => record.workspaceId === input.workspaceId);
  return [
    ...inWorkspace(input.invoices).map(invoice => ({
      collection: 'invoices' as const, id: invoice.id, number: invoice.number, date: invoice.date, status: invoice.status,
      metadata: invoice.metadata as Record<string, unknown> | undefined,
      dimensions: dimensionsOf(invoice, input.worldDimensionId),
      lineDimensions: (invoice.items || []).map(line => dimensionMap(line.dimensions)),
    })),
    ...inWorkspace(input.bills).map(bill => ({
      collection: 'bills' as const, id: bill.id, number: bill.number, date: bill.date || bill.issueDate, status: bill.status,
      metadata: bill.metadata as Record<string, unknown> | undefined,
      dimensions: dimensionsOf(bill, input.worldDimensionId),
      lineDimensions: (bill.splits || []).map(line => dimensionMap(line.dimensions)),
    })),
    ...inWorkspace(input.creditNotes).map(note => ({
      collection: 'creditNotes' as const, id: note.id, number: note.number, date: note.date, status: note.status,
      metadata: note.metadata as Record<string, unknown> | undefined,
      dimensions: dimensionsOf(note, input.worldDimensionId),
    })),
    ...inWorkspace(input.vendorCredits).map(note => ({
      collection: 'vendorCredits' as const, id: note.id, number: note.number, date: note.date, status: note.status,
      metadata: note.metadata as Record<string, unknown> | undefined,
      dimensions: dimensionsOf(note, input.worldDimensionId),
    })),
    ...inWorkspace(input.estimates).map(estimate => {
      const metadata = (estimate as Estimate & { metadata?: Record<string, unknown> }).metadata;
      return {
        collection: 'estimates' as const, id: estimate.id, number: estimate.number, date: estimate.date, status: estimate.status,
        metadata,
        dimensions: dimensionsOf(estimate as Estimate & { metadata?: Record<string, unknown> }, input.worldDimensionId),
      };
    }),
    ...inWorkspace(input.purchaseOrders).map(order => {
      const metadata = (order as PurchaseOrder & { metadata?: Record<string, unknown> }).metadata;
      return {
        collection: 'purchaseOrders' as const, id: order.id, number: order.poNumber, date: order.issueDate, status: order.status,
        metadata,
        dimensions: dimensionsOf(order as PurchaseOrder & { metadata?: Record<string, unknown> }, input.worldDimensionId),
      };
    }),
  ];
}

/** Country period table plus review list, based on stored record dates and current Tax profiles. */
export default function RetentionReviewReportView({ asOfDate = '' }: { asOfDate?: string }) {
  const workspaceId = useAuthStore(state => state.currentWorkspaceId);
  const workspace = useAuthStore(state => state.getCurrentWorkspace());
  const isGuest = useAuthStore(state => state.isGuest && !state.user);
  const dimensionNodes = useLedgerStore(state => state.dimensionNodes);
  const asOf = asOfDate || getLocalDateISO();
  const worldDimensionId = workspace?.dimensions?.find(dimension => dimension.isWorld)?.id || 'world';
  const validAsOf = validCustomReportPeriod({ startDate: asOf, endDate: asOf });

  if (isGuest || !workspaceId) {
    const report = validAsOf ? retentionReview({ records: [], profiles: workspace?.taxProfiles, worldDimensionId, dimensionNodes, asOfDate: asOf }) : null;
    return <RetentionReviewPanel report={report} asOfDate={asOf} loading={false} partial attachmentIndexAvailable={false} />;
  }

  return <RetentionReviewWorkspaceData key={workspaceId} workspaceId={workspaceId} asOfDate={asOf} worldDimensionId={worldDimensionId} dimensionNodes={dimensionNodes} />;
}

function RetentionReviewWorkspaceData({ workspaceId, asOfDate, worldDimensionId, dimensionNodes }: {
  workspaceId: string;
  asOfDate: string;
  worldDimensionId: string;
  dimensionNodes: DimensionNode[];
}) {
  const workspace = useAuthStore(state => state.getCurrentWorkspace());
  const invoices = useCollection<Invoice>('invoices', { workspaceId, limit: DOCUMENT_LIMIT });
  const bills = useCollection<Bill>('bills', { workspaceId, limit: DOCUMENT_LIMIT });
  const creditNotes = useCollection<CreditNote>('creditNotes', { workspaceId, limit: DOCUMENT_LIMIT });
  const vendorCredits = useCollection<VendorCredit>('vendorCredits', { workspaceId, limit: DOCUMENT_LIMIT });
  const estimates = useCollection<Estimate>('estimates', { workspaceId, limit: DOCUMENT_LIMIT });
  const purchaseOrders = useCollection<PurchaseOrder>('purchaseOrders', { workspaceId, limit: DOCUMENT_LIMIT });
  const [attachmentSnapshot, setAttachmentSnapshot] = useState<{
    workspaceId: string;
    rows: AttachmentLinkIndexRow[];
    loading: boolean;
    error: Error | null;
    truncated: boolean;
  } | null>(null);

  useEffect(() => {
    let active = true;
    loadAttachmentLinkIndex(workspaceId, RETENTION_COLLECTIONS)
      .then(index => {
        if (active) setAttachmentSnapshot({ workspaceId, rows: index.rows, loading: false, error: null, truncated: index.truncated });
      })
      .catch(error => {
        if (active) setAttachmentSnapshot({ workspaceId, rows: [], loading: false, error: error instanceof Error ? error : new Error(String(error)), truncated: false });
      });
    return () => { active = false; };
  }, [workspaceId]);

  const sourceRecords = useMemo(() => toRetentionRecords({
    workspaceId,
    invoices: invoices.data,
    bills: bills.data,
    creditNotes: creditNotes.data,
    vendorCredits: vendorCredits.data,
    estimates: estimates.data,
    purchaseOrders: purchaseOrders.data,
    worldDimensionId,
  }), [workspaceId, invoices.data, bills.data, creditNotes.data, vendorCredits.data, estimates.data, purchaseOrders.data, worldDimensionId]);
  const currentAttachments = attachmentSnapshot?.workspaceId === workspaceId ? attachmentSnapshot : null;
  const report = useMemo(() => {
    if (!validCustomReportPeriod({ startDate: asOfDate, endDate: asOfDate })) return null;
    return retentionReview({
      records: sourceRecords,
      attachments: currentAttachments?.rows || [],
      profiles: workspace?.taxProfiles,
      worldDimensionId,
      dimensionNodes,
      asOfDate,
    });
  }, [sourceRecords, currentAttachments?.rows, workspace?.taxProfiles, worldDimensionId, dimensionNodes, asOfDate]);

  const collections = [invoices, bills, creditNotes, vendorCredits, estimates, purchaseOrders];
  const loading = collections.some(result => result.loading) || Boolean(currentAttachments?.loading || !currentAttachments);
  const partial = collections.some(result => result.error || result.truncated) || Boolean(currentAttachments?.error || currentAttachments?.truncated);
  return <RetentionReviewPanel report={report} asOfDate={asOfDate} loading={loading} partial={partial}
    attachmentIndexAvailable={Boolean(currentAttachments)} attachmentError={Boolean(currentAttachments?.error)} />;
}

export function RetentionReviewPanel({ report, asOfDate, loading = false, partial = false, attachmentIndexAvailable = true, attachmentError = false }: {
  report: RetentionReviewReport | null;
  asOfDate: string;
  loading?: boolean;
  partial?: boolean;
  attachmentIndexAvailable?: boolean;
  attachmentError?: boolean;
}) {
  const [filter, setFilter] = useState<'all' | 'due' | 'not-due' | 'unclassified'>('all');
  const [search, setSearch] = useState('');
  const validAsOf = validCustomReportPeriod({ startDate: asOfDate, endDate: asOfDate });
  const query = normalizeSearchText(search.trim());
  const rows = (report?.rows || []).filter(row => {
    if (filter !== 'all' && row.reviewState !== filter) return false;
    if (!query) return true;
    return normalizeSearchText([row.recordType, row.recordNumber, row.recordId, row.entity, row.countryName, row.reason, row.relatedRecord]
      .filter(Boolean).join(' ')).includes(query);
  });

  return <section aria-label="Record retention review" className="p-4 space-y-4 min-w-0">
    <h2>Record retention review</h2>
    <p className="text-sm text-[var(--muted)]">
      This review uses the owner-specified IL, US and UK timetable below to identify records whose document-date anniversary after the stated calendar years has passed. Country is resolved from the books or the Company Tax profile; missing dates, missing countries and countries without a period stay unclassified. The report is read-only: it does not delete records or authorize deletion, and its timetable is not legal advice.
    </p>
    <p className="text-sm text-[var(--muted)]">
      Scope: invoices, bills (including expense claims), customer/vendor credits, estimates, purchase orders, and attached files linked to supported invoices, bills, estimates or purchase orders. Attached files inherit their source record date and entity; orphaned or unloaded sources are unclassified. This is separate from <code>Workspace.retention</code>, which controls server log and workspace-recovery retention.
    </p>

    <ReportTableScroll>
      <table className="w-full text-sm">
        <caption>Owner-specified country review timetable — verify before acting</caption>
        <thead><tr><th scope="col" className="text-left">Country</th><th scope="col" className="text-left">Review period</th><th scope="col" className="text-left">Basis</th></tr></thead>
        <tbody>{RECORD_RETENTION_REVIEW_PERIODS.map(period => <tr key={period.countryCode} className="border-b border-[var(--line)]/50">
          <th scope="row" className="text-left font-normal py-1 px-2">{period.countryName} ({period.countryCode === 'GB' ? 'UK' : period.countryCode})</th>
          <td className="py-1 px-2">{period.years} years</td>
          <td className="py-1 px-2">{period.source}</td>
        </tr>)}</tbody>
      </table>
    </ReportTableScroll>

    <div className="flex flex-wrap items-end gap-3" data-print-hide>
      <label className="flex flex-col gap-1 text-sm">Review status
        <select aria-label="Retention review status" className={field} value={filter} onChange={event => setFilter(event.target.value as typeof filter)}>
          <option value="all">All records</option>
          <option value="due">Due for review</option>
          <option value="not-due">Not yet due</option>
          <option value="unclassified">Unclassified</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">Find a record
        <input aria-label="Find a retained record" className={field} value={search} onChange={event => setSearch(event.target.value)} placeholder="Number, entity or country" />
      </label>
      <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]" disabled={!rows.length || loading || partial || !report}
        onClick={() => report && downloadCsv('record-retention-review', RETENTION_REVIEW_CSV_HEADERS, retentionReviewCsvRows(rows))}>Export CSV</button>
    </div>

    {!validAsOf && <p role="alert">Choose a valid as-of date.</p>}
    {loading && <p role="status">Loading documents and attachment metadata…</p>}
    {partial && <p role="alert">The review history is incomplete. Some source records or linked attachments may be missing, so CSV is unavailable until all required history is available.</p>}
    {!attachmentIndexAvailable && !loading && <p role="note">Attached-file metadata is not available in demo/offline mode. Source records can still be listed, but linked files are not included.</p>}
    {attachmentError && <p role="alert">Attached-file metadata could not be loaded. The source-document rows remain, but the attachment list is incomplete.</p>}

    {report && <>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 text-sm" aria-label="Retention review summary">
        <p><b>As of:</b> {report.asOfDate}</p>
        <p><b>Due for review:</b> {report.dueCount}</p>
        <p><b>Not yet due:</b> {report.notDueCount}</p>
        <p><b>Unclassified:</b> {report.unclassifiedCount}</p>
      </div>
      <ReportTableScroll>
        <table className="w-full text-sm">
          <caption>Document review status as of {report.asOfDate}; no deletion action is available here</caption>
          <thead><tr>
            {['Type', 'Document / file', 'Date', 'Status', 'Entity', 'Country', 'Period', 'Review due', 'Review status', 'Reason', 'Source record'].map(head => <th key={head} scope="col" className="text-left py-1 px-2">{head}</th>)}
          </tr></thead>
          <tbody>{rows.map(row => <tr key={row.key} className="border-b border-[var(--line)]/50 align-top">
            <th scope="row" className="text-left font-normal py-1 px-2">{row.recordType}</th>
            <td className="py-1 px-2"><bdi>{row.recordNumber}</bdi><div className="text-xs text-[var(--muted)]"><code>{row.recordId}</code></div></td>
            <td className="py-1 px-2">{row.recordDate || '—'}</td>
            <td className="py-1 px-2">{row.recordStatus || '—'}</td>
            <td className="py-1 px-2"><bdi>{row.entity}</bdi><div className="text-xs text-[var(--muted)]">{row.profileSource}</div></td>
            <td className="py-1 px-2">{row.countryName}{row.countryCode && row.countryName !== row.countryCode ? ` (${row.countryCode === 'GB' ? 'UK' : row.countryCode})` : ''}</td>
            <td className="py-1 px-2">{row.periodYears === undefined ? '—' : `${row.periodYears} years`}</td>
            <td className="py-1 px-2">{row.reviewDueOn || '—'}</td>
            <td className="py-1 px-2">{row.reviewState === 'due' ? 'Due for review' : row.reviewState === 'not-due' ? 'Not yet due' : 'Unclassified'}</td>
            <td className="py-1 px-2">{row.reason || '—'}</td>
            <td className="py-1 px-2"><bdi>{row.relatedRecord || '—'}</bdi></td>
          </tr>)}</tbody>
        </table>
        {!loading && !rows.length && <p className="text-sm text-[var(--muted)]">No record matches this review filter.</p>}
      </ReportTableScroll>
    </>}
  </section>;
}
