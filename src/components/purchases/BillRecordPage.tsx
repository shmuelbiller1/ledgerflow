import React, { useMemo } from 'react';
import { Eye, ExternalLink, Pencil, Trash2 } from 'lucide-react';
import type { Bill, Payment, Vendor } from '../../types';
import { calculateAmountDue } from '../../lib/documentMath';
import { daysOverdue } from '../../lib/aging';
import { claimOf, decisionProblem } from '../../lib/expenseClaims';
import { formatCurrency, formatDate, getLocalDateISO } from '../../lib/utils';
import { offeredSteps } from '../../hooks/useCommand';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { useEntityOperations } from '../../hooks/useEntityOperations';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { COMMAND_MANIFEST } from '../../lib/commands.generated';
import { roleMayRun } from '../../lib/paletteRoleFilter';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useUIStore } from '../../stores/useUIStore';
import AttachmentsPanel from '../common/AttachmentsPanel';
import RecordNotesPanel from '../common/RecordNotesPanel';
import { RecordPage, type RecordMetric, type RecordNextAction, type RecordStep } from '../common/RecordPage';
import InlineEdit from '../ui/InlineEdit';
import { EmptyState } from '../ui/EmptyState';
import { LoadingState } from '../ui/LoadingState';
import { ScreenDataNotice } from '../ui/ScreenDataNotice';
import { useScreenDataHealth } from '../../hooks/useScreenDataHealth';

export interface BillRecordPageProps {
  billId: string;
  onBack: () => void;
  onEdit: (bill: Bill) => void;
  onPay: (bill: Bill) => void;
  onPreviewPdf: (bill: Bill) => void;
  onVoid: (bill: Bill) => void;
  onOpenVendor: (vendorId: string) => void;
  onApproveClaim: (bill: Bill) => void;
}

/** A saved bill on the same record shell as an invoice: entered → approved → paid, with one real next step. */
export default function BillRecordPage({
  billId, onBack, onEdit, onPay, onPreviewPdf, onVoid, onOpenVendor, onApproveClaim,
}: BillRecordPageProps) {
  const { loading } = useLedgerCollections('bills', 'vendors', 'payments', 'auditLogs');
  const dataHealth = useScreenDataHealth(['bills', 'vendors', 'payments', 'auditLogs']);
  const dataNotice = <ScreenDataNotice failedKeys={dataHealth.failedKeys} message={dataHealth.message}
    onRetry={dataHealth.retry} what="this bill" />;
  const bills = useLedgerStore(s => s.bills);
  const vendors = useLedgerStore(s => s.vendors);
  const payments = useLedgerStore(s => s.payments);
  const auditLogs = useLedgerStore(s => s.auditLogs);
  const language = useUIStore(s => s.language);
  const homeCurrency = useAuthStore(s => s.getCurrentWorkspace()?.currency) || 'USD';
  const actor = useAuthStore(s => s.user?.uid || '');
  const role = useCurrentRole();
  const { updateEntity } = useEntityOperations();

  const bill = useMemo(() => (bills || []).find(b => b.id === billId), [bills, billId]);
  const vendor = useMemo<Vendor | undefined>(
    () => (bill?.vendorId ? (vendors || []).find(v => v.id === bill.vendorId) : undefined),
    [vendors, bill],
  );
  const relatedPayments = useMemo<Array<Payment & { appliedToBillCents: number }>>(() => {
    if (!bill) return [];
    return (payments || []).filter(p =>
      p.direction === 'made' && p.status !== 'void' &&
      ((p as Payment & { billId?: string }).billId === bill.id ||
        (Array.isArray(p.allocations) && p.allocations.some(a => a.documentType === 'bill' && a.documentId === bill.id))),
    ).map(payment => {
      // A single vendor payment can settle several bills: the related row must show this bill's
      // allocation, not the entire payment. Older records only carry billId and keep their total.
      const allocations = payment.allocations?.filter(a => a.documentType === 'bill' && a.documentId === bill.id) || [];
      return { ...payment, appliedToBillCents: allocations.length
        ? allocations.reduce((sum, allocation) => sum + allocation.amountCents, 0)
        : payment.amountCents };
    });
  }, [payments, bill]);
  const historyItems = useMemo(() => {
    if (!bill) return [];
    const logs = (auditLogs || []).filter(log => log.entityId === bill.id && ['bill', 'bills'].includes(log.entityType || ''))
      .map(log => ({ id: log.id, when: log.timestamp, summary: log.details?.description || log.action, actor: log.userEmail || log.email || log.uid || 'System' }));
    const derived = [
      ...(bill.createdAt ? [{ id: 'created', when: bill.createdAt, summary: 'Bill recorded', actor: 'Workspace' }] : []),
      ...(bill.paidAt ? [{ id: 'paid', when: bill.paidAt, summary: 'Bill marked paid', actor: 'Payment' }] : []),
    ];
    return (logs.length ? logs : derived).sort((a, b) => String(b.when).localeCompare(String(a.when)));
  }, [auditLogs, bill]);

  if (!bill && dataHealth.failedKeys.includes('bills')) return (
    <div className="p-4 sm:p-6 space-y-4">{dataNotice}<EmptyState title="Bill unavailable"
      description="The bill list could not be loaded yet." actionLabel="Back to bills" onAction={onBack} /></div>
  );
  if (loading && !bill && dataHealth.loadingKeys.includes('bills')) return <div className="p-4 sm:p-6"><LoadingState what="bill" /></div>;
  if (!bill) return (
    <div className="p-4 sm:p-6"><EmptyState title="Bill not found"
      description="This bill may have been deleted or belongs to another workspace."
      actionLabel="Back to bills" onAction={onBack} /></div>
  );

  const label = bill.number ? `Bill ${bill.number}` : `Bill ${bill.id}`;
  const currency = bill.currency || homeCurrency;
  const isClosed = ['void', 'cancelled', 'rejected'].includes(bill.status);
  const isDraft = bill.status === 'draft';
  const amountDue = calculateAmountDue(bill);
  // A legacy 'paid' document need not carry amountPaidCents: its status is the settled result.
  const isSettled = !isClosed && (bill.status === 'paid' || (bill.amountCents > 0 && amountDue === 0));
  // A void/rejected bill is no longer payable, even when its old amountPaidCents is zero.
  const remaining = isClosed || isSettled ? 0 : amountDue;
  const paidCents = isSettled ? bill.amountCents || 0 : Math.max(0, (bill.amountCents || 0) - amountDue);
  const isApproved = ['approved', 'partially_paid', 'overdue', 'unpaid', 'paid'].includes(bill.status) || isSettled;
  const isOverdue = !isClosed && !isDraft && !isSettled && remaining > 0 && daysOverdue(bill, getLocalDateISO()) > 0;
  const claim = claimOf(bill);
  const canEdit = role !== 'viewer';
  // A submitted expense claim is decided by the existing owner/accountant action, not by
  // opening an ordinary bill editor (whose Approve Bill button does not decide the claim).
  const canEditBill = canEdit && !isClosed && claim?.state !== 'submitted';

  // The saved document's lifecycle is about this bill, not the whole vendor relationship. A pending
  // bill opens the existing editor for approval; an expense claim uses its existing decision action.
  // The payment button is the manifest's `bill.update → payment.receive` offer, shown only when owed.
  const steps: RecordStep[] = [
    { id: 'entered', label: 'Entered', done: !isDraft, current: isDraft },
    { id: 'approved', label: 'Approved', done: isApproved, current: !isDraft && !isSettled },
    { id: 'paid', label: 'Paid', done: isSettled, current: isSettled },
  ];
  const paymentStep = offeredSteps('bill.update').find(step => step.command === 'payment.receive');
  const paymentCommand = COMMAND_MANIFEST.find(command => command.name === paymentStep?.command);
  let nextStepAction: RecordNextAction | undefined;
  if (!isClosed && !isSettled && canEdit) {
    if (claim?.state === 'submitted') {
      if (!decisionProblem(claim, role, actor)) {
        nextStepAction = { label: 'Approve claim', onClick: () => onApproveClaim(bill) };
      }
    } else if (isDraft || bill.status === 'pending') {
      nextStepAction = { label: 'Review and approve', onClick: () => onEdit(bill) };
    } else if (bill.vendorId && remaining > 0 &&
        ['approved', 'unpaid', 'overdue', 'partially_paid'].includes(bill.status) &&
        paymentStep && roleMayRun(paymentCommand?.roles, role)) {
      nextStepAction = { label: paymentStep.label, onClick: () => onPay(bill) };
    }
  }

  const metrics: RecordMetric[] = [
    { id: 'total', label: 'Bill total', value: formatCurrency(bill.amountCents || 0, currency) },
    { id: 'paid', label: 'Paid', value: formatCurrency(paidCents, currency), tone: paidCents > 0 ? 'positive' : 'default' },
    { id: 'due', label: 'Still due', value: formatCurrency(remaining, currency), tone: isOverdue ? 'danger' : remaining > 0 && !isClosed ? 'warning' : 'default', hint: bill.dueDate ? `Due ${formatDate(bill.dueDate)}` : undefined },
    { id: 'status', label: 'Status', value: bill.status.replace(/_/g, ' '), tone: isSettled ? 'positive' : isOverdue ? 'danger' : 'default' },
  ];
  const canEditDue = canEditBill && !isSettled;
  const splitKeys = new Map<string, number>();
  const splits = (bill.splits || []).map(line => {
    // An old split need not have an id; identical lines still need distinct React keys.
    const content = JSON.stringify([line.accountId, line.description || '', line.amountCents, line.itemId || '']);
    const occurrence = (splitKeys.get(content) || 0) + 1;
    splitKeys.set(content, occurrence);
    return { line, key: `${content}:${occurrence}` };
  });

  return (
    <RecordPage backLabel="Back to bills" onBack={onBack} focusKey={bill.id}
      dir={language === 'he' ? 'rtl' : 'ltr'} lang={language}
      title={label}
      subtitle={<>{bill.vendorName || vendor?.name || 'Vendor'}{bill.date && <> · Entered {formatDate(bill.date)}</>}</>}
      badge={<span className="px-2.5 py-1 rounded-lg text-[11px] font-bold uppercase tracking-wider border border-[var(--line)] bg-[var(--panel)] text-[var(--text)]">{bill.status.replace(/_/g, ' ')}</span>}
      steps={isClosed ? undefined : steps}
      nextStepAction={nextStepAction}
      banner={<>{dataNotice}{claim?.state === 'submitted' && <p role="status" className="p-3 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-sm text-[var(--text)]">
        Expense claim awaiting approval. {decisionProblem(claim, role, actor) || 'Review it before the bill can be paid.'}
      </p>}</>}
      metrics={metrics}
      secondaryActions={<>
        {canEditBill && <button type="button" onClick={() => onEdit(bill)}
          className="inline-flex min-h-11 items-center gap-1.5 px-3 py-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] text-xs font-semibold hover:bg-[var(--elevated)]">
          <Pencil aria-hidden="true" size={14} /> Edit bill
        </button>}
        <button type="button" onClick={() => onPreviewPdf(bill)}
          className="inline-flex min-h-11 items-center gap-1.5 px-3 py-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] text-xs font-semibold hover:bg-[var(--elevated)]">
          <Eye aria-hidden="true" size={14} /> Preview PDF
        </button>
        {canEditBill && <button type="button" onClick={() => onVoid(bill)}
          className="inline-flex min-h-11 items-center gap-1.5 px-3 py-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30">
          <Trash2 aria-hidden="true" size={14} /> Void
        </button>}
      </>}
      details={<div className="space-y-3">
        <h2 className="text-sm font-bold text-[var(--text)]">Editable details</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-xs text-[var(--muted)] mb-1">Bill number</p>
            <InlineEdit value={bill.number || ''} display={bill.number || bill.id.slice(0, 8).toUpperCase()}
              label={`Number of ${label}`} canEdit={canEditBill}
              onSave={value => updateEntity('bills', bill.id, { number: String(value) }, 'Bill number saved')}
              className="font-semibold text-[var(--text)]" />
          </div>
          <div>
            <p className="text-xs text-[var(--muted)] mb-1">Bill date</p>
            <InlineEdit kind="date" value={bill.date?.slice(0, 10) || ''} display={bill.date ? formatDate(bill.date) : 'Set bill date'}
              label={`Date of ${label}`} canEdit={canEditBill && isDraft}
              onSave={value => updateEntity('bills', bill.id, { date: String(value) }, 'Bill date saved')}
              className="font-semibold text-[var(--text)]" />
          </div>
          <div>
            <p className="text-xs text-[var(--muted)] mb-1">Due date</p>
            <InlineEdit kind="date" value={bill.dueDate?.slice(0, 10) || ''} display={bill.dueDate ? formatDate(bill.dueDate) : 'Set due date'}
              label={`Due date of ${label}`} canEdit={canEditDue}
              validate={value => (bill.date && String(value) < bill.date.slice(0, 10) ? 'The due date is before the bill date' : null)}
              onSave={value => updateEntity('bills', bill.id, { dueDate: String(value) }, 'Due date saved')}
              className="font-semibold text-[var(--text)]" />
          </div>
        </div>
      </div>}
      related={<>
        <div className="p-5 rounded-2xl border border-[var(--line)] bg-[var(--surface)] space-y-3">
          <h2 className="text-sm font-bold text-[var(--text)]">Vendor</h2>
          {vendor ? <button type="button" onClick={() => onOpenVendor(vendor.id)}
            className="inline-flex min-h-11 items-center gap-1 font-semibold text-indigo-700 dark:text-indigo-300 hover:underline">
            <bdi>{vendor.name}</bdi><ExternalLink aria-hidden="true" size={12} />
          </button> : <p className="text-xs text-[var(--muted)]">No vendor record linked.</p>}
        </div>
        <div className="p-5 rounded-2xl border border-[var(--line)] bg-[var(--surface)] space-y-3">
          <h2 className="text-sm font-bold text-[var(--text)]">Payments ({relatedPayments.length})</h2>
          {relatedPayments.length === 0 ? <p className="text-xs text-[var(--muted)]">No payments applied to this bill yet.</p> :
            <ul className="divide-y divide-[var(--line)] text-xs">
              {relatedPayments.map(payment => <li key={payment.id} className="py-2 flex items-center justify-between gap-2">
                <div><p className="font-semibold text-[var(--text)]">{payment.reference || payment.method.replace('_', ' ')}</p>
                  <p className="text-[var(--muted)]">{formatDate(payment.date)}</p></div>
                <span className="font-mono font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{formatCurrency(payment.appliedToBillCents, payment.currency || currency)}</span>
              </li>)}
            </ul>}
        </div>
      </>}
      attachments={<AttachmentsPanel target={{ collection: 'bills', id: bill.id, label }} />}
      notes={<RecordNotesPanel entityType="bill" entityId={bill.id} entityName={label} metadata={bill.metadata} canEdit={canEditBill} />}
      history={<div className="space-y-3">
        <h2 className="text-sm font-bold text-[var(--text)]">History</h2>
        {historyItems.length === 0 ? <p className="text-xs text-[var(--muted)]">No history entries recorded yet.</p> :
          <ul className="divide-y divide-[var(--line)] text-xs">{historyItems.map(item =>
            <li key={item.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
              <div><p className="font-semibold text-[var(--text)]">{item.summary}</p><p className="text-[var(--muted)]">{item.actor}</p></div>
              <time dateTime={item.when} className="font-mono text-[var(--muted)]">{formatDate(item.when.slice(0, 10))}</time>
            </li>)}</ul>}
      </div>}
    >
      <section aria-label="Bill lines" className="p-5 rounded-2xl border border-[var(--line)] bg-[var(--surface)] space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-[var(--text)]">Lines ({splits.length})</h2>
          {canEditBill && <button type="button" onClick={() => onEdit(bill)}
            className="min-h-11 text-xs font-semibold text-indigo-700 dark:text-indigo-300 hover:underline">Edit lines &amp; tax</button>}
        </div>
        {splits.length === 0 ? <p className="text-xs text-[var(--muted)]">No cost lines recorded.</p> :
          <ul className="divide-y divide-[var(--line)] text-xs">{splits.map(({ line, key }) =>
            <li key={key} className="py-2.5 flex flex-wrap items-center justify-between gap-3">
              <span className="min-w-0 flex-1 font-semibold text-[var(--text)]"><bdi>{line.description || 'Cost line'}</bdi></span>
              <span className="font-mono font-bold tabular-nums text-[var(--text)]">{formatCurrency(line.amountCents || 0, currency)}</span>
            </li>)}</ul>}
      </section>
    </RecordPage>
  );
}
