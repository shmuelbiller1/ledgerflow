import React, { useMemo } from 'react';
import { Download, Eye, Mail, Pencil, Trash2, ExternalLink } from 'lucide-react';
import type { Customer, Invoice, Payment, Transaction } from '../../types';
import { calculateAmountDue } from '../../lib/documentMath';
import { formatCurrency, formatDate, getLocalDateISO, parseLocalDate, safeConfirm } from '../../lib/utils';
import { differenceInDays } from 'date-fns/differenceInDays';
import { approvalDetail, approvalStatus, holdsSending } from '../../lib/invoiceApproval';
import { isPostable } from '../../lib/txFilters';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useUIStore } from '../../stores/useUIStore';
import { useEntityOperations } from '../../hooks/useEntityOperations';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { offeredSteps } from '../../hooks/useCommand';
import InlineEdit from '../ui/InlineEdit';
import AttachmentsPanel from '../common/AttachmentsPanel';
import RecordNotesPanel from '../common/RecordNotesPanel';
import { RecordPage, type RecordMetric, type RecordNextAction, type RecordStep } from '../common/RecordPage';
import { LinkedRecordStatus } from '../common/LinkedRecordStatus';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';

interface InvoiceRecordPageProps {
  invoiceId: string;
  onBack: () => void;
  onEdit: (invoice: Invoice) => void;
  onSendEmail: (invoice: Invoice) => void;
  onReceivePayment: (invoice: Invoice) => void;
  onPreviewPdf: (invoice: Invoice) => void;
  onDownloadPdf: (invoice: Invoice) => void;
  onVoid: (invoice: Invoice) => void;
  onOpenCustomer: (customerId: string) => void;
}

type InvoiceWithOptionalNotes = Invoice & { notes?: string; transactionId?: string };

export default function InvoiceRecordPage({
  invoiceId,
  onBack,
  onEdit,
  onSendEmail,
  onReceivePayment,
  onPreviewPdf,
  onDownloadPdf,
  onVoid,
  onOpenCustomer,
}: InvoiceRecordPageProps) {
  useLedgerCollections('invoices', 'customers', 'payments', 'auditLogs', 'transactions');
  const invoices = useLedgerStore(s => s.invoices);
  const customers = useLedgerStore(s => s.customers);
  const payments = useLedgerStore(s => s.payments);
  const transactions = useLedgerStore(s => s.transactions);
  const auditLogs = useLedgerStore(s => s.auditLogs);
  const language = useUIStore(s => s.language);
  const openRecord = useUIStore(s => s.openRecord);
  const approvalSettings = useAuthStore(s => s.getCurrentWorkspace()?.invoiceApproval);
  const homeCurrency = useAuthStore(s => s.getCurrentWorkspace()?.currency) || 'USD';
  const canEdit = useCurrentRole() !== 'viewer';
  const { updateEntity } = useEntityOperations();

  const invoice = useMemo(
    () => (invoices || []).find(inv => inv.id === invoiceId) as InvoiceWithOptionalNotes | undefined,
    [invoices, invoiceId],
  );

  const customer = useMemo<Customer | undefined>(
    () => (invoice?.customerId ? (customers || []).find(c => c.id === invoice.customerId) : undefined),
    [customers, invoice],
  );

  const relatedPayments = useMemo<Payment[]>(() => {
    if (!invoice) return [];
    return (payments || []).filter(p => {
      if ((p as Payment & { status?: string }).status === 'void') return false;
      if ((p as Payment & { invoiceId?: string }).invoiceId === invoice.id) return true;
      return Array.isArray(p.allocations) && p.allocations.some(a => a.documentId === invoice.id);
    });
  }, [payments, invoice]);

  const linkedTx = useMemo<Transaction | undefined>(() => {
    if (!invoice) return undefined;
    // Only a live entry may be shown as the invoice's posting: a void or draft entry is not in the ledger
    // (CLAUDE.md: ledger computations go through isPostable).
    const postable = (transactions || []).filter(isPostable);
    const byDocument = postable.find(t => {
      if (invoice.transactionId && t.id === invoice.transactionId) return true;
      const meta = t.metadata as Record<string, unknown> | undefined;
      return Boolean(meta && (meta.invoiceId === invoice.id || meta.sourceId === invoice.id || meta.documentId === invoice.id));
    });
    // The reference is the weakest link: a bill, payment or journal entry can carry the same number, so it
    // only answers when nothing ties the invoice id to an entry.
    if (byDocument) return byDocument;
    return invoice.number ? postable.find(t => t.reference === invoice.number) : undefined;
  }, [transactions, invoice]);

  const historyItems = useMemo(() => {
    if (!invoice) return [];
    const matchedLogs = (auditLogs || [])
      .filter(log => log.entityId === invoice.id)
      .map(log => ({
        id: log.id,
        when: log.timestamp,
        summary: log.details?.description || log.action,
        actor: log.userEmail || log.email || log.uid || 'System',
      }));
    const derived: Array<{ id: string; when: string; summary: string; actor: string }> = [];
    if (invoice.createdAt) {
      derived.push({ id: 'created', when: invoice.createdAt, summary: 'Invoice created', actor: 'Workspace' });
    }
    const lastSentAt = typeof invoice.metadata?.lastSentAt === 'string' ? invoice.metadata.lastSentAt : '';
    if (lastSentAt) {
      derived.push({ id: 'sent', when: lastSentAt, summary: 'Invoice emailed to customer', actor: 'Workspace' });
    }
    if (invoice.approval?.decidedAt) {
      derived.push({
        id: 'approval',
        when: invoice.approval.decidedAt,
        summary: `Approval: ${invoice.approval.state}`,
        actor: invoice.approval.decidedBy || 'Approver',
      });
    }
    if (invoice.paidAt) {
      derived.push({ id: 'paid', when: invoice.paidAt, summary: 'Invoice marked paid', actor: 'Payment' });
    }
    const merged = matchedLogs.length > 0 ? matchedLogs : derived;
    return merged.sort((a, b) => String(b.when).localeCompare(String(a.when)));
  }, [auditLogs, invoice]);

  if (!invoice) return <LinkedRecordStatus kind="invoice" onBack={onBack} />;

  const invLabel = invoice.number ? `Invoice ${invoice.number}` : `Invoice ${invoice.id}`;
  const currency = invoice.currency || homeCurrency;
  const amountDue = calculateAmountDue(invoice);
  const isSettled = invoice.status === 'paid' || amountDue <= 0;
  const isDraft = invoice.status === 'draft';
  const isClosed = invoice.status === 'void' || invoice.status === 'cancelled' || (invoice.writtenOffCents || 0) > 0;
  const isSentOrOpen = !isDraft && !isClosed;
  const isOverdue = isSentOrOpen && !isSettled && (invoice.status === 'overdue' || differenceInDays(parseLocalDate(getLocalDateISO()), parseLocalDate(invoice.dueDate)) > 0);
  const apprState = approvalStatus(invoice, approvalSettings, homeCurrency);
  const blockedFromSending = holdsSending(invoice, approvalSettings, homeCurrency);

  // U-9 Step Path: Draft → Sent → Paid
  const steps: RecordStep[] = [
    { id: 'draft', label: 'Draft', done: !isDraft && !isClosed, current: isDraft },
    { id: 'sent', label: 'Sent', done: isSettled && !isClosed, current: isSentOrOpen && !isSettled },
    { id: 'paid', label: 'Paid', done: isSettled && !isClosed, current: isSettled && !isClosed },
  ];

  // What comes after a draft is sent is not a decision this page makes: the manifest names it
  // (`invoice.update` offers `payment.receive`, "Record a payment"), so the button cannot promise a step the
  // command does not offer, and the same sentence appears here and in the refusal that points at it. Sending is
  // the page's own action — it is an email, not a ledger command — so it keeps its own words.
  const paymentStep = offeredSteps('invoice.update').find(step => step.command === 'payment.receive');
  let nextStepAction: RecordNextAction | undefined;
  if (canEdit && !isClosed) {
    if (isDraft) {
      nextStepAction = {
        label: 'Send invoice',
        onClick: () => onSendEmail(invoice),
      };
    } else if (!isSettled) {
      nextStepAction = {
        label: paymentStep?.label ?? 'Record payment',
        onClick: () => onReceivePayment(invoice),
      };
    }
  }

  const metrics: RecordMetric[] = [
    {
      id: 'total',
      label: 'Invoice total',
      value: formatCurrency(invoice.amountCents || 0, currency),
    },
    {
      id: 'paid',
      label: 'Paid',
      value: formatCurrency(Math.max(0, (invoice.amountCents || 0) - amountDue), currency),
      tone: (invoice.amountPaidCents || 0) > 0 ? 'positive' : 'default',
    },
    {
      id: 'due',
      label: 'Still due',
      value: formatCurrency(Math.max(0, amountDue), currency),
      tone: isOverdue && amountDue > 0 ? 'danger' : amountDue > 0 ? 'warning' : 'default',
      hint: invoice.dueDate ? `Due ${formatDate(invoice.dueDate)}` : undefined,
    },
    {
      id: 'status',
      label: 'Status',
      value: invoice.status,
      tone: invoice.status === 'paid' ? 'positive' : isOverdue ? 'danger' : 'default',
    },
  ];

  const canEditDue = canEdit && !['paid', 'void'].includes(String(invoice.status)) && !(invoice.writtenOffCents && invoice.writtenOffCents > 0);
  const items = Array.isArray(invoice.items) ? invoice.items : [];
  const invoiceNotes = invoice.notes || '';

  return (
    <RecordPage
      backLabel="Back to invoices"
      onBack={onBack}
      focusKey={invoice.id}
      dir={language === 'he' ? 'rtl' : 'ltr'}
      lang={language}
      title={invLabel}
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          <span>{invoice.customerName || 'Customer'}</span>
          {invoice.date && (
            <>
              <span aria-hidden="true">·</span>
              <span>Issued {formatDate(invoice.date)}</span>
            </>
          )}
        </span>
      }
      badge={
        <span className="px-2.5 py-1 rounded-lg text-[11px] font-bold uppercase tracking-wider border border-[var(--line)] bg-[var(--panel)] text-[var(--text)]">
          {invoice.status}
        </span>
      }
      steps={isClosed ? undefined : steps}
      nextStepAction={nextStepAction}
      banner={
        apprState !== 'off' && apprState !== 'not_needed' ? (
          <div role="status" className="p-3 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-xs text-[var(--text)]">
            {approvalDetail(apprState, approvalSettings, invoice.approval, currency)}
          </div>
        ) : undefined
      }
      metrics={metrics}
      secondaryActions={
        <>
          {canEdit && invoice.status !== 'void' && (
            <button
              type="button"
              onClick={() => onEdit(invoice)}
              className="inline-flex min-h-11 items-center gap-1.5 px-3 py-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] text-xs font-semibold hover:bg-[var(--elevated)]"
            >
              <Pencil aria-hidden="true" size={14} />
              <span>Edit invoice</span>
            </button>
          )}
          {canEdit && !isDraft && !isClosed && !blockedFromSending && (
            <button
              type="button"
              onClick={() => onSendEmail(invoice)}
              className="inline-flex min-h-11 items-center gap-1.5 px-3 py-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] text-xs font-semibold hover:bg-[var(--elevated)]"
            >
              <Mail aria-hidden="true" size={14} />
              <span>Email</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => onPreviewPdf(invoice)}
            className="inline-flex min-h-11 items-center gap-1.5 px-3 py-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] text-xs font-semibold hover:bg-[var(--elevated)]"
          >
            <Eye aria-hidden="true" size={14} />
            <span>Preview PDF</span>
          </button>
          <button
            type="button"
            onClick={() => onDownloadPdf(invoice)}
            className="inline-flex min-h-11 items-center gap-1.5 px-3 py-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] text-xs font-semibold hover:bg-[var(--elevated)]"
          >
            <Download aria-hidden="true" size={14} />
            <span>Download PDF</span>
          </button>
          {canEdit && invoice.status !== 'void' && (
            <button
              type="button"
              onClick={() => {
                if (safeConfirm(`Void invoice ${invoice.number || ''}? It stays on record as void and its ledger entries are reversed.`)) {
                  onVoid(invoice);
                }
              }}
              className="inline-flex min-h-11 items-center gap-1.5 px-3 py-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30"
            >
              <Trash2 aria-hidden="true" size={14} />
              <span>Void</span>
            </button>
          )}
        </>
      }
      details={
        <div className="space-y-4">
          <h2 className="text-sm font-bold text-[var(--text)]">Editable details</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-xs text-[var(--muted)] mb-1">Due date</p>
              <InlineEdit
                kind="date"
                value={invoice.dueDate?.slice(0, 10) || ''}
                display={invoice.dueDate ? formatDate(invoice.dueDate) : 'Set due date'}
                label={`Due date of ${invLabel}`}
                canEdit={canEditDue}
                validate={v => (invoice.date && String(v) < invoice.date.slice(0, 10) ? 'The due date is before the invoice date' : null)}
                onSave={v => updateEntity('invoices', invoice.id, { dueDate: String(v) }, 'Due date updated')}
                className="font-semibold text-[var(--text)]"
              />
            </div>
            <div>
              <p className="text-xs text-[var(--muted)] mb-1">Milestone / Reference</p>
              <InlineEdit
                value={invoice.milestone || ''}
                placeholder="Add milestone or reference"
                label={`Reference of ${invLabel}`}
                canEdit={canEdit && !isClosed}
                onSave={v => updateEntity('invoices', invoice.id, { milestone: String(v) }, 'Reference updated')}
                className="font-semibold text-[var(--text)]"
              />
            </div>
            <div>
              <p className="text-xs text-[var(--muted)] mb-1">Customer memo</p>
              <InlineEdit
                value={invoiceNotes}
                placeholder="Add memo for this invoice"
                label={`Memo of ${invLabel}`}
                canEdit={canEdit && !isClosed}
                onSave={v => updateEntity('invoices', invoice.id, { notes: String(v) } as Partial<Invoice>, 'Memo updated')}
                className="font-semibold text-[var(--text)]"
              />
            </div>
          </div>
        </div>
      }
      related={
        <>
          <div className="p-5 rounded-2xl border border-[var(--line)] bg-[var(--surface)] space-y-3">
            <h2 className="text-sm font-bold text-[var(--text)]">Customer &amp; ledger links</h2>
            <div className="space-y-2 text-xs">
              {customer ? (
                <div className="flex items-center justify-between gap-2 py-1.5 border-b border-[var(--line)]">
                  <span className="text-[var(--muted)]">Customer</span>
                  <button
                    type="button"
                    onClick={() => onOpenCustomer(customer.id)}
                    className="inline-flex min-h-11 items-center gap-1 font-semibold text-indigo-700 dark:text-indigo-300 hover:underline"
                  >
                    <bdi>{customer.name}</bdi>
                    <ExternalLink aria-hidden="true" size={12} />
                  </button>
                </div>
              ) : (
                <p className="text-[var(--muted)]">No customer record linked.</p>
              )}
              {linkedTx && (
                <div className="flex items-center justify-between gap-2 py-1.5">
                  <span className="text-[var(--muted)]">Journal entry</span>
                  <button
                    type="button"
                    onClick={() => openRecord({ type: 'transaction', id: linkedTx.id })}
                    className="inline-flex min-h-11 items-center gap-1 font-mono font-semibold text-indigo-700 dark:text-indigo-300 hover:underline"
                  >
                    <span>{linkedTx.description || linkedTx.id}</span>
                    <ExternalLink aria-hidden="true" size={12} />
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="p-5 rounded-2xl border border-[var(--line)] bg-[var(--surface)] space-y-3">
            <h2 className="text-sm font-bold text-[var(--text)]">Payments ({relatedPayments.length})</h2>
            {relatedPayments.length === 0 ? (
              <p className="text-xs text-[var(--muted)]">No payments applied to this invoice yet.</p>
            ) : (
              <ul className="divide-y divide-[var(--line)] text-xs">
                {relatedPayments.map(p => (
                  <li key={p.id} className="py-2 flex items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold text-[var(--text)]">{p.reference || p.method.replace('_', ' ')}</p>
                      <p className="text-[var(--muted)]">{p.date ? formatDate(p.date) : ''}</p>
                    </div>
                    <span className="font-mono font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                      {formatCurrency(p.amountCents || 0, p.currency || currency)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      }
      attachments={
        <AttachmentsPanel
          target={{ collection: 'invoices', id: invoice.id, label: invLabel }}
        />
      }
      notes={
        <RecordNotesPanel
          entityType="invoice"
          entityId={invoice.id}
          entityName={invLabel}
          metadata={invoice.metadata}
          canEdit={canEdit}
        />
      }
      history={
        <div className="space-y-3">
          <h2 className="text-sm font-bold text-[var(--text)]">History</h2>
          {historyItems.length === 0 ? (
            <p className="text-xs text-[var(--muted)]">No history entries recorded yet.</p>
          ) : (
            <ul className="divide-y divide-[var(--line)] text-xs">
              {historyItems.map(item => (
                <li key={item.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold text-[var(--text)]">{item.summary}</p>
                    <p className="text-[var(--muted)]">{item.actor}</p>
                  </div>
                  <time dateTime={item.when} className="font-mono text-[var(--muted)]">
                    {formatDate(item.when.slice(0, 10))}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </div>
      }
    >
      <section aria-label="Invoice lines" className="p-5 rounded-2xl border border-[var(--line)] bg-[var(--surface)] space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-[var(--text)]">Lines ({items.length})</h2>
          {canEdit && invoice.status !== 'void' && (
            <button
              type="button"
              onClick={() => onEdit(invoice)}
              className="text-xs font-semibold text-indigo-700 dark:text-indigo-300 hover:underline"
            >
              Edit lines &amp; tax
            </button>
          )}
        </div>
        {items.length === 0 ? (
          <p className="text-xs text-[var(--muted)]">No itemized lines recorded.</p>
        ) : (
          <ul className="divide-y divide-[var(--line)] text-xs">
            {items.map(line => (
              <li key={line.id} className="py-2.5 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-[var(--text)]"><bdi>{line.description || 'Line item'}</bdi></p>
                  <p className="text-[var(--muted)]">
                    Qty {line.quantity} × {formatCurrency(line.rateCents || 0, currency)}
                  </p>
                </div>
                <div className="font-mono font-bold tabular-nums text-[var(--text)]">
                  {formatCurrency(line.amountCents || 0, currency)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </RecordPage>
  );
}
