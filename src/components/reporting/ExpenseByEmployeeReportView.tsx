import { RowTable } from '../ui/RowTable';
import React, { useEffect, useMemo, useState } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { loadAttachmentLinkIndex, type AttachmentLinkIndexRow } from '../../services/attachmentActions';
import { formatCurrency } from '../../lib/utils';
import { downloadCsv } from '../../lib/csvExport';
import {
  expenseByEmployee, expenseByEmployeeCsvRows, EXPENSE_BY_EMPLOYEE_CSV_HEADERS,
} from '../../lib/expenseByEmployee';
import type { ReceiptChecklistRow } from '../../lib/receiptChecklist';
import ReportTableScroll from './ReportTableScroll';
import { useReportText, fill } from './useReportText';

const stateText: Record<string, string> = { submitted: 'Waiting', approved: 'Approved', rejected: 'Rejected' };
const evidenceText = (row: ReceiptChecklistRow) =>
  row.evidenceStatus === 'recorded'
    ? row.attachmentCount ? `${row.attachmentCount} linked file(s); content not checked` : 'Receipt URL recorded; link not verified'
    : row.evidenceStatus === 'missing' ? 'No receipt URL or linked file — review' : 'Not checked';

/**
 * A-191: expense by employee with receipt status. The receipt checklist's claims (A-133) grouped by
 * the employee each claim bill is owed to, with where each claim stands and whether receipt
 * evidence is recorded. Amounts stay in each bill's own currency. Read-only.
 */
export default function ExpenseByEmployeeReportView({ startDate = '', endDate = '' }: { startDate?: string; endDate?: string }) {
  const reportText = useReportText();
  const bills = useLedgerStore(state => state.bills);
  const truncated = useLedgerStore(state => state.truncatedCollections);
  const failed = useDataNeedsStore(state => state.failed);
  const workspaceId = useAuthStore(state => state.currentWorkspaceId);
  const isGuest = useAuthStore(state => state.isGuest && !state.user);
  const workspace = useAuthStore(state => state.getCurrentWorkspace());
  const { loading: billsLoading } = useLedgerCollections('bills');
  const [attachmentSnapshot, setAttachmentSnapshot] = useState<{
    workspaceId: string; rows: AttachmentLinkIndexRow[]; loading: boolean; error: Error | null; truncated: boolean; available: boolean;
  } | null>(null);

  useEffect(() => {
    let active = true;
    if (!workspaceId || isGuest) return () => { active = false; };
    loadAttachmentLinkIndex(workspaceId, ['bills'])
      .then(index => { if (active) setAttachmentSnapshot({ workspaceId, rows: index.rows, loading: false, error: null, truncated: index.truncated, available: true }); })
      .catch(error => { if (active) setAttachmentSnapshot({ workspaceId, rows: [], loading: false, error: error instanceof Error ? error : new Error(String(error)), truncated: false, available: true }); });
    return () => { active = false; };
  }, [workspaceId, isGuest]);

  const currentAttachmentSnapshot = !isGuest && attachmentSnapshot?.workspaceId === (workspaceId || '') ? attachmentSnapshot : null;
  const attachmentLoading = !isGuest && Boolean(workspaceId) && (!currentAttachmentSnapshot || currentAttachmentSnapshot.loading);
  const attachmentIndexComplete = currentAttachmentSnapshot?.available === true && !currentAttachmentSnapshot.loading
    && !currentAttachmentSnapshot.error && !currentAttachmentSnapshot.truncated;
  const scopedBills = useMemo(() => bills.filter(bill => !workspaceId || bill.workspaceId === workspaceId), [bills, workspaceId]);
  const report = useMemo(() => expenseByEmployee({
    bills: scopedBills,
    attachmentLinks: currentAttachmentSnapshot?.rows || [],
    attachmentIndexComplete,
    from: startDate || undefined,
    to: endDate || undefined,
    homeCurrency: workspace?.currency || 'USD',
  }), [scopedBills, currentAttachmentSnapshot?.rows, attachmentIndexComplete, startDate, endDate, workspace?.currency]);

  const loading = billsLoading || attachmentLoading;
  const partial = Boolean(truncated.bills || failed.bills || currentAttachmentSnapshot?.truncated || currentAttachmentSnapshot?.error);

  return <section aria-label={reportText('r.expense-by-employee', 'Expense by employee')} className="p-4 space-y-4 min-w-0">
    <h2>{reportText('r.expense-by-employee', 'Expense by employee')}</h2>
    <p className="text-sm text-[var(--muted)]">
      {reportText('r.expense-claims-grouped-by-the-employee-each-clai', 'Expense claims grouped by the employee each claim is owed to: how much was claimed in each currency, where the claims stand, and whether receipt evidence is recorded — the Expense Receipt Checklist\'s own reading (a recorded receipt address or a linked file; the file itself is not inspected and may not be a receipt). Amounts stay in each claim bill\'s own currency and are never added across currencies. Employees with the most missing receipts come first.')}
    </p>

    {loading && <p role="status">{reportText('r.loading-expense-claims-and-linked-file-metadata', 'Loading expense claims and linked-file metadata…')}</p>}
    {partial && <p role="alert">{reportText('r.claim-or-attachment-history-is-capped-or-failed-2', 'Claim or attachment history is capped or failed to load. Results may be incomplete; a receipt is marked missing only when the linked-file metadata is complete.')}</p>}

    <div data-print-hide>
      <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]" disabled={!report.rows.length}
        onClick={() => downloadCsv('expense-by-employee', [...EXPENSE_BY_EMPLOYEE_CSV_HEADERS], expenseByEmployeeCsvRows(report.rows))}>{reportText('r.export-csv', 'Export CSV')}</button>
    </div>

    <ReportTableScroll nameFromCaption allowDisplayedExport={false}>
      <RowTable
        caption={
          <>
            {reportText('r.expense-claims-by-employee', 'Expense claims by employee')}
            {startDate || endDate
              ? fill(reportText('r.0-to-1', ', {0} to {1}'), { 0: startDate || 'any date', 1: endDate || 'any date' })
              : ` ${reportText('r.in-the-loaded-history', 'in the loaded history')}`}
          </>
        }
        captionClassName=""
        tableClassName="w-full text-sm"
        headRowClassName=""
        bodyClassName=""
        rowClassName="border-b border-[var(--line)]/50"
        rows={report.rows}
        rowKey={(row) => row.employee}
        columns={[
          {
            header: reportText('r.employee', 'Employee'),
            headClassName: 'text-left py-1 px-2',
            className: 'text-left font-normal py-1 px-2',
            cell: (row) => <bdi>{row.employee}</bdi>,
          },
          {
            header: reportText('r.claims', 'Claims'),
            headClassName: 'text-left py-1 px-2',
            className: 'py-1 px-2 tabular-nums',
            cell: (row) => row.claims,
          },
          {
            header: reportText('r.claimed', 'Claimed'),
            headClassName: 'text-right py-1 px-2',
            className: 'py-1 px-2 text-right tabular-nums',
            cell: (row) =>
              row.totals.map((t) => (
                <span key={t.currency} className="inline-block ml-2">
                  <bdi>{formatCurrency(t.cents, t.currency)}</bdi>
                </span>
              )),
          },
          {
            header: reportText('r.waiting', 'Waiting'),
            headClassName: 'text-right py-1 px-2',
            className: 'py-1 px-2 text-right tabular-nums',
            cell: (row) => row.waiting,
          },
          {
            header: reportText('r.approved', 'Approved'),
            headClassName: 'text-right py-1 px-2',
            className: 'py-1 px-2 text-right tabular-nums',
            cell: (row) => row.approved,
          },
          {
            header: reportText('r.rejected', 'Rejected'),
            headClassName: 'text-right py-1 px-2',
            className: 'py-1 px-2 text-right tabular-nums',
            cell: (row) => row.rejected,
          },
          {
            header: reportText('r.receipts-recorded', 'Receipts recorded'),
            headClassName: 'text-right py-1 px-2',
            className: 'py-1 px-2 text-right tabular-nums',
            cell: (row) => row.receiptsRecorded,
          },
          {
            header: reportText('r.receipts-missing', 'Receipts missing'),
            headClassName: 'text-right py-1 px-2',
            className: 'py-1 px-2 text-right tabular-nums',
            cell: (row) => row.receiptsMissing,
          },
          {
            header: reportText('r.not-checked-2', 'Not checked'),
            headClassName: 'text-right py-1 px-2',
            className: 'py-1 px-2 text-right tabular-nums',
            cell: (row) => row.receiptsNotChecked,
          },
        ]}
      />
      {!report.rows.length && !loading && <p className="text-sm text-[var(--muted)]">{reportText('r.no-expense-claim-is-recorded-in-this-period', 'No expense claim is recorded in this period.')}</p>}
    </ReportTableScroll>

    {report.claims.length > 0 && <div className="space-y-2">
      <h3 className="font-semibold">{reportText('r.the-claims-behind-these-rows', 'The claims behind these rows')}</h3>
      <ReportTableScroll nameFromCaption allowDisplayedExport={false}>
        <RowTable
          caption={reportText('r.every-expense-claim-in-the-period-with-its-recei', 'Every expense claim in the period with its receipt record')}
          captionClassName=""
          tableClassName="w-full text-sm"
          headRowClassName=""
          bodyClassName=""
          rowClassName="border-b border-[var(--line)]/50"
          rows={report.claims}
          rowKey={(row) => row.billId}
          columns={[
            {
              header: reportText('r.employee', 'Employee'),
              headClassName: 'text-left py-1 px-2',
              className: 'text-left font-normal py-1 px-2',
              cell: (row) => <bdi>{row.employeeName}</bdi>,
            },
            {
              header: reportText('r.date-2', 'Date'),
              headClassName: 'text-left py-1 px-2',
              className: 'py-1 px-2',
              cell: (row) => row.date || '—',
            },
            {
              header: reportText('r.claim', 'Claim'),
              headClassName: 'text-left py-1 px-2',
              className: 'py-1 px-2',
              cell: (row) => <bdi>{row.billNumber}</bdi>,
            },
            {
              header: reportText('r.state', 'State'),
              headClassName: 'text-left py-1 px-2',
              className: 'py-1 px-2',
              cell: (row) => stateText[row.state] || row.state,
            },
            {
              header: reportText('r.amount', 'Amount'),
              headClassName: 'text-right py-1 px-2',
              className: 'py-1 px-2 text-right tabular-nums',
              cell: (row) => formatCurrency(row.amountCents, row.currency),
            },
            {
              header: reportText('r.receipt-record', 'Receipt record'),
              headClassName: 'text-left py-1 px-2',
              className: 'py-1 px-2',
              cell: (row) => evidenceText(row),
            },
          ]}
        />
      </ReportTableScroll>
    </div>}

    <p className="text-xs text-[var(--muted)]">
      {reportText('r.a-claim-is-a-bill-carrying-an-expense-claim-reco', 'A claim is a bill carrying an expense-claim record; approving it stays on the Expense Claims screen. Missing evidence is a review cue, not a decision about the claim.')}
    </p>
  </section>;
}
