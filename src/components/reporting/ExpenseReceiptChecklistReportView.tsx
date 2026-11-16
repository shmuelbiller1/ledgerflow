import React, { useEffect, useMemo, useState } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { loadAttachmentLinkIndex, type AttachmentLinkIndexRow } from '../../services/attachmentActions';
import { receiptChecklist, receiptChecklistCsvRows, RECEIPT_CHECKLIST_CSV_HEADERS, type ReceiptChecklistSummary } from '../../lib/receiptChecklist';
import { validCustomReportPeriod } from '../../lib/reportCustomPeriod';
import { formatCurrency } from '../../lib/utils';
import { downloadCsv } from '../../lib/csvExport';
import ReportTableScroll from './ReportTableScroll';
import { RowTable } from '../ui/RowTable';

/** A-133: expense claims are bills; linked file metadata is loaded without selecting file contents. */
export default function ExpenseReceiptChecklistReportView({ startDate = '', endDate = '' }: { startDate?: string; endDate?: string }) {
  const bills = useLedgerStore(state => state.bills);
  const truncated = useLedgerStore(state => state.truncatedCollections);
  const failed = useDataNeedsStore(state => state.failed);
  const workspaceId = useAuthStore(state => state.currentWorkspaceId);
  const isGuest = useAuthStore(state => state.isGuest && !state.user);
  const workspace = useAuthStore(state => state.getCurrentWorkspace());
  const { loading: billsLoading } = useLedgerCollections('bills');
  const [attachmentSnapshot, setAttachmentSnapshot] = useState<{
    workspaceId: string;
    rows: AttachmentLinkIndexRow[];
    loading: boolean;
    error: Error | null;
    truncated: boolean;
    available: boolean;
  } | null>(null);

  useEffect(() => {
    let active = true;
    if (!workspaceId || isGuest) return () => { active = false; };
    loadAttachmentLinkIndex(workspaceId, ['bills'])
      .then(index => {
        if (active) setAttachmentSnapshot({ workspaceId, rows: index.rows, loading: false, error: null, truncated: index.truncated, available: true });
      })
      .catch(error => {
        if (active) setAttachmentSnapshot({ workspaceId, rows: [], loading: false, error: error instanceof Error ? error : new Error(String(error)), truncated: false, available: true });
      });
    return () => { active = false; };
  }, [workspaceId, isGuest]);

  const currentAttachmentSnapshot = !isGuest && attachmentSnapshot?.workspaceId === (workspaceId || '') ? attachmentSnapshot : null;
  const attachmentLoading = !isGuest && Boolean(workspaceId) && (!currentAttachmentSnapshot || currentAttachmentSnapshot.loading);
  const attachmentIndexComplete = currentAttachmentSnapshot?.available === true && !currentAttachmentSnapshot.loading &&
    !currentAttachmentSnapshot.error && !currentAttachmentSnapshot.truncated;
  const periodValid = (!startDate && !endDate) || validCustomReportPeriod({ startDate: startDate || endDate, endDate: endDate || startDate });
  const scopedBills = useMemo(() => bills.filter(bill => !workspaceId || bill.workspaceId === workspaceId), [bills, workspaceId]);
  const report = useMemo(() => receiptChecklist({
    bills: scopedBills,
    attachmentLinks: currentAttachmentSnapshot?.rows || [],
    attachmentIndexComplete,
    from: startDate || undefined,
    to: endDate || undefined,
    homeCurrency: workspace?.currency || 'USD',
  }), [scopedBills, currentAttachmentSnapshot?.rows, attachmentIndexComplete, startDate, endDate, workspace?.currency]);

  const loading = billsLoading || attachmentLoading;
  const partial = Boolean(truncated.bills || failed.bills || currentAttachmentSnapshot?.truncated || currentAttachmentSnapshot?.error);
  return <ExpenseReceiptChecklistPanel
    report={report}
    from={startDate}
    to={endDate}
    loading={loading}
    partial={partial}
    attachmentIndexAvailable={currentAttachmentSnapshot?.available === true}
    attachmentError={Boolean(currentAttachmentSnapshot?.error)}
    periodValid={periodValid}
  />;
}

export function ExpenseReceiptChecklistPanel({
  report,
  from = '',
  to = '',
  loading = false,
  partial = false,
  attachmentIndexAvailable = true,
  attachmentError = false,
  periodValid = true,
}: {
  report: ReceiptChecklistSummary;
  from?: string;
  to?: string;
  loading?: boolean;
  partial?: boolean;
  attachmentIndexAvailable?: boolean;
  attachmentError?: boolean;
  periodValid?: boolean;
}) {
  const exportRows = () => downloadCsv('expense-receipt-checklist', RECEIPT_CHECKLIST_CSV_HEADERS, receiptChecklistCsvRows(report.rows));
  const evidenceLabel = (row: ReceiptChecklistSummary['rows'][number]) => {
    if (row.receiptUrlRecorded && row.attachmentCount) return `Receipt URL and ${row.attachmentCount} linked file(s); content not checked`;
    if (row.receiptUrlRecorded) return 'Receipt URL recorded; link not verified';
    if (row.attachmentCount) return `${row.attachmentCount} linked file(s); content not checked`;
    if (row.evidenceStatus === 'missing') return 'No receipt URL or linked file — review';
    if (attachmentError) return 'Not checked — attachment metadata failed to load';
    if (!attachmentIndexAvailable) return 'Not checked in demo / offline mode';
    return 'Not checked';
  };

  return <section aria-label="Expense receipt checklist" className="p-4 space-y-4 min-w-0">
    <h2>Expense receipt checklist</h2>
    <p className="text-sm text-[var(--muted)]">
      Expense claims are bills carrying an expense-claim record. Claims with no receipt URL or linked bill file are grouped for review by employee; the bill date follows the Reports period. A linked file is not inspected and may not be a receipt, so absence is a review cue, not an approval or deletion decision.
    </p>

    {!periodValid && <p role="alert">Choose a valid report period.</p>}
    {loading && <p role="status">Loading expense claims and linked-file metadata…</p>}
    {partial && <p role="alert">Claim or attachment history is capped or failed to load. Results may be incomplete; attachment absence is marked missing only when linked-file metadata is complete, and CSV is unavailable until the loaded history is complete.</p>}
    {!attachmentIndexAvailable && !loading && <p role="note">The attachment index is not available in demo/offline mode. A receipt URL can still be shown, but no file is assumed missing.</p>}

    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm" aria-label="Receipt checklist summary">
      <p><b>Claims in period:</b> {report.rows.length}</p>
      <p><b>No receipt link or file recorded:</b> {report.missingClaims}</p>
      <p><b>Not checked:</b> {report.notCheckedClaims}</p>
    </div>

    {report.missingByEmployee.length > 0 && <div className="space-y-2">
      <h3 className="font-semibold">Claims to review by employee</h3>
      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
        {report.missingByEmployee.map(employee => <li key={employee.employeeName}><bdi>{employee.employeeName}</bdi>: {employee.claims}</li>)}
      </ul>
    </div>}

    <div data-print-hide>
      <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]" onClick={exportRows} disabled={!report.rows.length || loading || partial}>Export CSV</button>
    </div>

    <ReportTableScroll>
      <RowTable
        rowClassName="border-b border-[var(--line)]/50 align-top"
        caption={(<>Expense claims{from || to ? ` from ${from || 'any date'} to ${to || 'any date'}` : ' in the loaded history'}; receipt evidence is not verified</>)}
        rows={report.rows}
        rowKey={row => row.billId}
        captionClassName=""
        tableClassName="w-full text-sm"
        headRowClassName=""
        bodyClassName=""
        columns={[
          { header: "Employee", className: "text-left font-normal py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => <bdi>{row.employeeName}</bdi> },
          { header: "Submitted by", className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => <bdi>{row.submittedBy || '—'}</bdi> },
          { header: "Date", className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => row.date || '—' },
          { header: "Claim", className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => <bdi>{row.billNumber}</bdi> },
          { header: "Claim state", className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => row.state },
          { header: "Amount", className: "py-1 px-2 text-right tabular-nums", headClassName: "text-left py-1 px-2", cell: (row) => formatCurrency(row.amountCents, row.currency) },
          { header: "Receipt record", className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => evidenceLabel(row) },
        ]}
      />
      {!loading && report.rows.length === 0 && <p className="text-sm text-[var(--muted)]">No expense claim is recorded in this period. Ordinary bills are not included.</p>}
    </ReportTableScroll>
  </section>;
}
