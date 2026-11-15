import React from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { differenceInDays } from 'date-fns/differenceInDays';
import { toast } from 'sonner';
import {
  Bell, BellOff, Ban, Copy, DollarSign, Download, Eye, Mail, Pencil, Plus, Trash2, Undo2, Users,
} from 'lucide-react';
import type { Customer, Invoice, Payment } from '../../types';
import type { InvoiceApprovalSettings } from '../../lib/invoiceApproval';
import { cn, formatCurrency, formatDate, getLocalDateISO, parseLocalDate, safeConfirm } from '../../lib/utils';
import { calculateAmountDue } from '../../lib/documentMath';
import { estimateDeposits } from '../../lib/advancePayments';
import { applyEstimateDeposits } from '../../services/depositActions';
import { spreadProgress } from '../../lib/prepaidSchedule';
import { undoSpreadRequest } from '../../services/spreadActions';
import { downloadDocumentPdf } from '../../services/documentDownloads';
import { inBackground } from '../../lib/inBackground';
import InlineEdit from '../ui/InlineEdit';
import InvoiceApprovalFlag from './InvoiceApprovalFlag';
import { StageChip } from '../collaboration/StageChip';
import { PartyDetailButton } from '../common/PartyDetailButton';
import PartyRowActions, { ArchivedBadge } from '../common/PartyRowActions';

export type SalesTextFn = (key: string, fallback: string) => string;

export interface InvoiceColumnDeps {
  salesText: SalesTextFn;
  canEditContacts: boolean;
  payments: Payment[];
  currentWorkspaceId: string | null;
  approvalSettings?: InvoiceApprovalSettings;
  homeCurrency: string;
  canDecideApproval: boolean;
  openRecord: (record: { type: 'invoice'; id: string }) => void;
  updateEntity: (collection: 'invoices', id: string, updates: Partial<Invoice>, successMessage?: string) => Promise<unknown>;
  onEditInvoice: (inv: Invoice) => void;
  onDuplicateInvoice: (draft: Partial<Invoice>) => void;
  onOpenPayment: (inv: Invoice) => void;
  onSpreadInvoice: (inv: Invoice) => void;
  onReverseWriteOff: (inv: Invoice) => void;
  onWriteOffInvoice: (inv: Invoice) => void;
  onEmailInvoice: (inv: Invoice) => void;
  onPreviewPdf: (inv: Invoice) => void;
  onDecideApproval: (inv: Invoice, decision: 'approved' | 'rejected') => void;
  onVoidInvoice: (inv: Invoice) => Promise<void>;
}

function getStatusColor(status: Invoice['status']) {
  switch (status) {
    case 'paid': return 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800';
    case 'sent':
    case 'pending':
      return 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800';
    case 'overdue': return 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800';
    case 'void': return 'bg-zinc-100 text-zinc-500 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700 line-through';
    default: return 'bg-[var(--ink)] text-[var(--muted)] border-[var(--line)]';
  }
}

export function buildInvoiceColumns(deps: InvoiceColumnDeps): ColumnDef<Invoice, unknown>[] {
  const {
    salesText, canEditContacts, payments, currentWorkspaceId, approvalSettings, homeCurrency,
    canDecideApproval, openRecord, updateEntity, onEditInvoice, onDuplicateInvoice,
    onOpenPayment, onSpreadInvoice, onReverseWriteOff, onWriteOffInvoice, onEmailInvoice,
    onPreviewPdf, onDecideApproval, onVoidInvoice,
  } = deps;

  return [
    {
      accessorKey: 'number',
      header: salesText('table.number', 'Number'),
      cell: ({ row }) => {
        const inv = row.original;
        return (
          <button
            type="button"
            onClick={() => openRecord({ type: 'invoice', id: inv.id })}
            className="font-mono font-bold text-[var(--text)] hover:underline cursor-pointer"
          >
            {inv.number || inv.id}
          </button>
        );
      },
    },
    {
      accessorKey: 'customerName',
      header: salesText('table.customer', 'Customer'),
      cell: ({ row }) => <span className="font-bold text-[var(--text)] text-sm tracking-tight">{row.original.customerName}</span>,
    },
    {
      accessorKey: 'date',
      header: salesText('table.date', 'Date'),
      cell: ({ row }) => {
        const inv = row.original;
        return (
          <InlineEdit
            kind="date"
            value={inv.date?.slice(0, 10)}
            display={inv.date ? formatDate(inv.date) : 'N/A'}
            label={`Date of invoice ${inv.number || ''}`.trim()}
            canEdit={canEditContacts && inv.status === 'draft'}
            onSave={v => updateEntity('invoices', inv.id, { date: String(v) }, 'Date saved')}
            className="font-semibold text-[var(--text)]"
          />
        );
      },
    },
    {
      accessorKey: 'dueDate',
      header: salesText('table.due', 'Due'),
      cell: ({ row }) => {
        const inv = row.original;
        return (
          <div className="flex flex-col">
            <InlineEdit
              kind="date"
              value={inv.dueDate?.slice(0, 10)}
              display={inv.dueDate ? formatDate(inv.dueDate) : 'N/A'}
              label={`Due date of invoice ${inv.number || ''}`.trim()}
              canEdit={canEditContacts && !['paid', 'void', 'written_off'].includes(String(inv.status))}
              validate={v => (inv.date && String(v) < inv.date.slice(0, 10) ? 'The due date is before the invoice date' : null)}
              onSave={v => updateEntity('invoices', inv.id, { dueDate: String(v) }, 'Due date saved')}
              className={cn('font-semibold text-[var(--text)]', inv.status === 'overdue' && 'text-rose-600')}
            />
            {inv.status === 'pending' && (
              <span className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest mt-0.5 opacity-60">
                {differenceInDays(parseLocalDate(inv.dueDate), new Date())} {salesText('status.daysLeft', 'T-Days Left')}
              </span>
            )}
          </div>
        );
      },
    },
    {
      accessorKey: 'amountCents',
      header: salesText('table.amount', 'Amount'),
      cell: ({ row }) => (
        <span className="block text-right font-bold font-mono text-[var(--text)] text-sm tracking-tight tabular-nums">
          {formatCurrency(row.original.amountCents || 0)}
        </span>
      ),
    },
    {
      accessorKey: 'status',
      header: salesText('table.state', 'State'),
      cell: ({ row }) => {
        const inv = row.original;
        const statusLabel = salesText(`status.${inv.status}`, inv.status);
        return (
          <div className="flex flex-col items-center gap-1">
            <div className="flex flex-wrap items-center justify-center gap-1">
              <span className={cn('px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider border shadow-2xs', getStatusColor(inv.status))}>
                {statusLabel}
              </span>
              {Boolean(inv.metadata?.saleReceipt) && (
                <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase tracking-wider border border-[var(--line)] text-[var(--muted)]">
                  {salesText('status.receipt', 'Receipt')}
                </span>
              )}
              {(inv.writtenOffCents || 0) > 0 && (
                <span className="text-[10px] text-amber-700 dark:text-amber-300 font-bold" title={inv.writeOffReason || undefined}>
                  {salesText('status.writtenOff', 'written off')} {formatCurrency(inv.writtenOffCents || 0)}
                </span>
              )}
            </div>
            {inv.viewedAt && inv.status !== 'paid' && (
              <div className="text-center text-[10px] text-[var(--muted)]" title={inv.lastViewedAt ? `Last opened ${formatDate(inv.lastViewedAt.slice(0, 10))}${(inv.viewCount || 0) > 1 ? `, ${inv.viewCount} times` : ''}` : undefined}>
                {salesText('status.openedByCustomer', 'Opened by the customer')} {formatDate(inv.viewedAt.slice(0, 10))}
              </div>
            )}
            {inv.revenueSchedule && <div className="text-center text-[10px] text-[var(--muted)]">{spreadProgress(inv.revenueSchedule, getLocalDateISO())}</div>}
            <StageChip kind="invoice" id={inv.id} label={`invoice ${inv.number || ''}`.trim()} />
            <InvoiceApprovalFlag
              invoice={inv}
              settings={approvalSettings}
              currency={homeCurrency}
              canDecide={canDecideApproval}
              onDecide={d => onDecideApproval(inv, d)}
            />
            {inv.metadata?.cogsPending && (
              <div className="flex items-center justify-center gap-2 text-[10px] text-[var(--neg)]">
                <span title={salesText('help.costNotRecorded', 'The cost of the items sold was not recorded: add an Inventory and a Cost of Goods Sold account, then retry.')}>
                  {salesText('status.costNotRecorded', 'Cost not recorded')}
                </span>
                <button type="button" onClick={() => void updateEntity('invoices', inv.id, {}, 'Invoice re-posted')} className="underline font-bold">
                  {salesText('action.retry', 'Retry')}
                </button>
              </div>
            )}
          </div>
        );
      },
    },
    {
      id: 'actions',
      enableSorting: false,
      header: () => <span className="sr-only">{salesText('table.actions', 'Actions')}</span>,
      cell: ({ row }) => {
        const inv = row.original;
        const estId = inv.metadata?.convertedFromEstimateId as string | undefined;
        const deposit = estId ? estimateDeposits(payments || [], estId) : null;
        const due = calculateAmountDue(inv);
        const canApplyDeposit = Boolean(
          canEditContacts && deposit && deposit.unappliedCents > 0 && due > 0 &&
          !['draft', 'void', 'rejected', 'cancelled', 'paid'].includes(String(inv.status)),
        );
        return (
          <div className="flex items-center justify-end gap-1.5 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100 transition-opacity">
            {inv.status !== 'void' && (
              <button
                type="button"
                onClick={() => onEditInvoice(inv)}
                className="p-2.5 bg-[var(--surface)] border border-[var(--line)] rounded-xl text-[var(--muted)] hover:text-indigo-600 transition-all"
                title="Edit invoice"
                aria-label={`Edit invoice ${inv.number || ''}`.trim()}
              >
                <Pencil aria-hidden="true" size={15} />
              </button>
            )}
            {inv.status !== 'paid' && (
              <button
                type="button"
                onClick={() => onOpenPayment(inv)}
                className="p-2.5 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 transition-all shadow-sm"
                title="Receive Payment"
                aria-label={`Receive payment for invoice ${inv.number || inv.id}`}
              >
                <DollarSign aria-hidden="true" size={15} />
              </button>
            )}
            {canApplyDeposit && deposit && (
              <button
                type="button"
                onClick={() => void applyEstimateDeposits(currentWorkspaceId || '', inv, deposit.waiting, due)}
                className="px-3 py-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 rounded-xl hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                aria-label={`Apply the estimate's deposit to invoice ${inv.number || ''}`.trim()}
              >
                {salesText('action.applyDeposit', 'Apply deposit')} {formatCurrency(Math.min(deposit.unappliedCents, due), inv.currency)}
              </button>
            )}
            {canEditContacts && !['draft', 'void', 'rejected', 'cancelled'].includes(String(inv.status)) && (inv.revenueSchedule ? (
              <button
                type="button"
                onClick={async () => {
                  if (safeConfirm(`Undo the spread of invoice ${inv.number || ''}? Its monthly entries are voided and the whole income is back in the invoice's month.`)
                    && await undoSpreadRequest('invoice', currentWorkspaceId || '', inv.id)) toast.success('Spread undone');
                }}
                className="px-3 py-2 text-xs text-[var(--muted)] hover:text-[var(--text)] rounded-xl"
                aria-label={`Undo the spread of invoice ${inv.number || ''}`.trim()}
              >
                {salesText('action.undoSpread', 'Undo spread')}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onSpreadInvoice(inv)}
                className="px-3 py-2 text-xs text-indigo-700 dark:text-indigo-300 hover:underline rounded-xl"
                title="Income earned over time (a subscription, a retainer): spread it over the months it covers"
                aria-label={`Spread invoice ${inv.number || ''} over months`.replace('  ', ' ')}
              >
                {salesText('action.spread', 'Spread')}
              </button>
            ))}
            {(inv.writtenOffCents || 0) > 0 && (
              <button
                type="button"
                onClick={() => onReverseWriteOff(inv)}
                className="p-2.5 bg-[var(--surface)] border border-[var(--line)] rounded-xl text-amber-700 dark:text-amber-300 transition-all"
                title="Customer paid after all: reverse the bad debt write-off"
                aria-label="Reverse the bad debt write-off"
              >
                <Undo2 aria-hidden="true" size={15} />
              </button>
            )}
            {inv.status !== 'draft' && (inv.status === 'overdue' || (inv.status !== 'paid' && inv.status !== 'void' && differenceInDays(new Date(), parseLocalDate(inv.dueDate)) > 0)) && (
              <button
                type="button"
                onClick={() => onWriteOffInvoice(inv)}
                className="p-2.5 bg-amber-500 text-white rounded-xl hover:bg-amber-600 transition-all shadow-sm"
                title="Write Off Bad Debt"
                aria-label={`Write off invoice ${inv.number || inv.id}`}
              >
                <Ban aria-hidden="true" size={15} />
              </button>
            )}
            {inv.status !== 'draft' && inv.status !== 'void' && (
              <button
                type="button"
                onClick={() => onEmailInvoice(inv)}
                className="p-2.5 bg-[var(--surface)] border border-[var(--line)] rounded-xl text-[var(--muted)] hover:text-indigo-600 transition-all"
                title="Email the invoice or a reminder; see emails sent"
                aria-label="Email the invoice"
              >
                <Mail aria-hidden="true" size={15} />
              </button>
            )}
            <button
              type="button"
              onClick={() => onPreviewPdf(inv)}
              className="p-2.5 bg-[var(--surface)] border border-[var(--line)] rounded-xl text-[var(--muted)] hover:text-indigo-600 transition-all"
              title="Preview PDF"
              aria-label="Preview PDF"
            >
              <Eye aria-hidden="true" size={15} />
            </button>
            <button
              type="button"
              onClick={() => downloadDocumentPdf('invoice', inv.id, currentWorkspaceId || 'default', `invoice_${inv.number || inv.id}.pdf`)}
              className="p-2.5 bg-[var(--surface)] border border-[var(--line)] rounded-xl text-[var(--muted)] hover:text-indigo-600 transition-all"
              title="Download PDF"
              aria-label={`Download PDF for invoice ${inv.number || inv.id}`}
            >
              <Download aria-hidden="true" size={15} />
            </button>
            <button
              type="button"
              onClick={() => {
                const {
                  id: _id, uid: _uid, number: _number, status: _status, amountPaidCents: _paid, depositCents: _deposit,
                  settledByRecordsCents: _settled, writtenOffCents: _wo, writeOffTransactionId: _woTx, writeOffReason: _wr,
                  writtenOffAt: _woAt, writeOffReversalTransactionId: _woRev, paymentDate: _pd, paidAt: _pa,
                  posted: _posted, isLocked: _locked, lockedAt: _lockedAt, paymentToken: _token, metadata: _meta,
                  dueDate: _due, ...fields
                } = inv;
                onDuplicateInvoice({ ...fields, date: getLocalDateISO(), status: 'draft' });
              }}
              className="p-2.5 bg-[var(--surface)] border border-[var(--line)] rounded-xl text-[var(--muted)] hover:text-indigo-600 transition-all"
              title="Duplicate as a new draft"
              aria-label="Duplicate as a new draft"
            >
              <Copy aria-hidden="true" size={15} />
            </button>
            <button
              type="button"
              onClick={async () => {
                const spread = inv.revenueSchedule ? ' Its spread over months is undone too.' : '';
                if (safeConfirm(`Void invoice ${inv.number || ''} for ${inv.customerName || 'this customer'} (${formatCurrency(inv.amountCents || 0, inv.currency)})? It stays on record as void and its entries are reversed.${spread}`)) {
                  await onVoidInvoice(inv);
                }
              }}
              className="p-2.5 bg-[var(--surface)] border border-[var(--line)] rounded-xl text-[var(--muted)] hover:text-rose-500 transition-all"
              title="Void invoice"
              aria-label="Void invoice"
            >
              <Trash2 aria-hidden="true" size={15} />
            </button>
          </div>
        );
      },
    },
  ];
}

export interface CustomerColumnDeps {
  salesText: SalesTextFn;
  canEditContacts: boolean;
  customerBalances: Record<string, number>;
  detailOpenerId: (id: string) => string;
  updateEntity: (collection: 'customers', id: string, updates: Partial<Customer>, successMessage?: string) => Promise<unknown>;
  onSelectCustomer: (customerId: string) => void;
  onEnterInvoice: (cust: Customer) => void;
}

export function buildCustomerColumns(deps: CustomerColumnDeps): ColumnDef<Customer, unknown>[] {
  const { salesText, canEditContacts, customerBalances, detailOpenerId, updateEntity, onSelectCustomer, onEnterInvoice } = deps;

  return [
    {
      accessorKey: 'name',
      header: salesText('customer.table.profile', 'Customer Profile'),
      cell: ({ row }) => {
        const cust = row.original;
        return (
          <div className="flex items-center gap-4">
            <div className="w-11 h-11 bg-slate-900 rounded-2xl flex items-center justify-center text-white font-black text-sm border border-white/10 shadow-sm shrink-0">
              {(cust.name || 'CU').slice(0, 2).toUpperCase()}
            </div>
            <div className="flex flex-col min-w-0">
              <InlineEdit
                value={cust.name}
                label={`Name of ${cust.name}`}
                canEdit={canEditContacts}
                validate={v => (String(v) ? null : 'A customer needs a name')}
                onSave={v => updateEntity('customers', cust.id, { name: String(v) }, 'Name saved')}
                className="font-bold text-[var(--text)] text-base tracking-tight"
              />
              <ArchivedBadge party={cust} />
              <PartyDetailButton id={detailOpenerId(cust.id)} side="customer" name={cust.name} onOpen={() => onSelectCustomer(cust.id)} />
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation();
                  inBackground(updateEntity('customers', cust.id, { noReminders: !cust.noReminders }, cust.noReminders ? `Automatic reminders on for ${cust.name}` : `No automatic reminders for ${cust.name}`));
                }}
                className={`flex items-center gap-1.5 min-h-11 text-[10px] font-bold uppercase tracking-widest ${cust.noReminders ? 'text-[var(--muted)]' : 'text-emerald-700 dark:text-emerald-300'}`}
                aria-pressed={!cust.noReminders}
                title="Automatic payment reminders (Settings → Emails & Reminders)"
              >
                {cust.noReminders ? <BellOff size={10} aria-hidden="true" /> : <Bell size={10} aria-hidden="true" />}
                {cust.noReminders ? salesText('action.remindersOff', 'No reminders') : salesText('action.remindersOn', 'Reminders on')}
              </button>
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: 'email',
      header: salesText('customer.table.contact', 'Contact'),
      cell: ({ row }) => {
        const cust = row.original;
        return (
          <div className="flex items-center gap-2">
            <Users aria-hidden="true" size={16} className="text-[var(--muted)] opacity-40 shrink-0" />
            <div className="flex flex-col gap-1 min-w-0">
              <InlineEdit
                kind="email"
                value={cust.email}
                label={`Email of ${cust.name}`}
                placeholder="Add email"
                canEdit={canEditContacts}
                onSave={v => updateEntity('customers', cust.id, { email: String(v) }, 'Email saved')}
                className="font-semibold text-[var(--text)]"
              />
              <InlineEdit
                kind="tel"
                value={cust.phone}
                label={`Phone of ${cust.name}`}
                placeholder="Add phone"
                canEdit={canEditContacts}
                onSave={v => updateEntity('customers', cust.id, { phone: String(v) }, 'Phone saved')}
                className="text-xs text-[var(--muted)]"
              />
            </div>
          </div>
        );
      },
    },
    {
      id: 'receivable',
      accessorFn: cust => customerBalances[cust.id] ?? 0,
      header: salesText('customer.table.receivable', 'Net Receivable'),
      cell: ({ row }) => (
        <span className="block text-right font-bold font-mono text-[var(--text)] text-base tracking-tight tabular-nums">
          {formatCurrency(customerBalances[row.original.id] ?? 0)}
        </span>
      ),
    },
    {
      id: 'actions',
      enableSorting: false,
      header: () => <span className="sr-only">{salesText('table.actions', 'Actions')}</span>,
      cell: ({ row }) => {
        const cust = row.original;
        return (
          <div className="flex items-center gap-1 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100 transition-all justify-end">
            <button
              type="button"
              onClick={e => {
                e.stopPropagation();
                onEnterInvoice(cust);
              }}
              className="inline-flex items-center justify-center min-h-11 min-w-11 p-2 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 rounded"
              title="Enter Invoice"
              aria-label={`Enter invoice for ${cust.name}`}
            >
              <Plus aria-hidden="true" size={14} />
            </button>
            {canEditContacts && <PartyRowActions side="customer" party={cust} />}
          </div>
        );
      },
    },
  ];
}
