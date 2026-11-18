import React from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { AlertCircle, Ban, CheckCircle, DollarSign, ExternalLink, Pencil, Printer, Trash2 } from 'lucide-react';
import type { Bill } from '../../types';
import { StageChip } from '../collaboration/StageChip';
import InlineEdit from '../ui/InlineEdit';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { spreadProgress } from '../../lib/prepaidSchedule';
import { calculateAmountDue } from '../../lib/documentMath';
import { claimOf } from '../../lib/expenseClaims';
import { inBackground } from '../../lib/inBackground';
import { billMayBeVoided } from './billVoidEligibility';

type PurchaseText = (key: string, fallback: string) => string;

export interface BillColumnDeps {
  purchasesText: PurchaseText;
  canEditContacts: boolean;
  updateEntity: (collection: 'bills', id: string, data: Partial<Bill>, successMsg?: string) => Promise<unknown>;
  billOpenerId: (id: string) => string;
  openRecord: (record: { type: 'bill'; id: string }) => void;
  onPreviewPdf: (bill: Bill) => void;
  onEdit: (bill: Bill) => void;
  onUndoSpread: (bill: Bill) => Promise<void>;
  onSpread: (bill: Bill) => void;
  onPay: (bill: Bill) => void;
  onVoid: (bill: Bill) => Promise<void>;
  onDelete: (bill: Bill) => Promise<void>;
}

/** Only bill columns/row actions differ; the list and the single-record layout remain shared. */
export function buildBillColumns({
  purchasesText, canEditContacts, updateEntity, billOpenerId, openRecord,
  onPreviewPdf, onEdit, onUndoSpread, onSpread, onPay, onVoid, onDelete,
}: BillColumnDeps): ColumnDef<Bill, unknown>[] {
  // A submitted claim is approved or rejected in ExpenseClaims, not in an ordinary bill editor.
  const canEditBill = (bill: Bill) => canEditContacts && claimOf(bill)?.state !== 'submitted';
  return [
    {
      accessorKey: 'vendorName',
      header: purchasesText('col.vendor', 'Vendor'),
      cell: ({ row }) => (
        <span className="font-semibold text-slate-900 dark:text-white">
          {row.original.vendorName || purchasesText('fallback.unknownVendor', 'Unknown Vendor')}
        </span>
      ),
    },
    {
      accessorKey: 'number',
      header: purchasesText('col.billNumber', 'Bill #'),
      cell: ({ row }) => {
        const b = row.original;
        const openLabel = purchasesText('aria.openBill', 'Open bill {n}').replace('{n}', b.number || b.id);
        return (
          <div className="flex items-center gap-1">
            <InlineEdit
              value={b.number}
              display={b.number || b.id.slice(0, 8).toUpperCase()}
              label={purchasesText('label.billNumberFrom', 'Number of bill from {vendor}').replace('{vendor}', () => b.vendorName || purchasesText('fallback.vendor', 'vendor'))}
              canEdit={canEditBill(b) && b.status !== 'void'}
              onSave={x => updateEntity('bills', b.id, { number: String(x) }, 'Bill number saved')}
              className="text-slate-600 dark:text-slate-400 font-mono text-xs"
            />
            <button id={billOpenerId(b.id)} type="button" onClick={() => openRecord({ type: 'bill', id: b.id })}
              aria-label={openLabel} title={openLabel}
              className="inline-flex min-h-11 min-w-11 items-center justify-center text-indigo-700 dark:text-indigo-300 rounded-lg hover:bg-[var(--elevated)]">
              <ExternalLink className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        );
      },
    },
    {
      accessorKey: 'date',
      header: purchasesText('col.date', 'Date'),
      cell: ({ row }) => {
        const b = row.original;
        return (
          <InlineEdit
            kind="date"
            value={b.date?.slice(0, 10)}
            label={`Date of bill ${b.number || ''}`.trim()}
            canEdit={canEditBill(b) && b.status === 'draft'}
            onSave={x => updateEntity('bills', b.id, { date: String(x) }, 'Date saved')}
          />
        );
      },
    },
    {
      accessorKey: 'dueDate',
      header: purchasesText('col.dueDate', 'Due Date'),
      cell: ({ row }) => {
        const b = row.original;
        return (
          <InlineEdit
            kind="date"
            value={b.dueDate?.slice(0, 10)}
            label={`Due date of bill ${b.number || ''}`.trim()}
            canEdit={canEditBill(b) && b.status !== 'paid' && b.status !== 'void'}
            validate={x => (b.date && String(x) < b.date.slice(0, 10) ? 'The due date is before the bill date' : null)}
            onSave={x => updateEntity('bills', b.id, { dueDate: String(x) }, 'Due date saved')}
          />
        );
      },
    },
    {
      accessorKey: 'status',
      header: purchasesText('col.status', 'Status'),
      cell: ({ row }) => {
        const b = row.original;
        const isOverdue = b.dueDate && new Date(b.dueDate) < new Date() && b.status !== 'paid' && b.status !== 'void';
        return (
          <div>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
              b.status === 'paid'
                ? 'bg-emerald-100 text-emerald-800'
                : isOverdue
                  ? 'bg-rose-100 text-rose-800'
                  : 'bg-amber-100 text-amber-800'
            }`}>
              {b.status === 'paid' ? <CheckCircle size={10} aria-hidden="true" /> : <AlertCircle size={10} aria-hidden="true" />}
              {b.status || purchasesText('status.unpaid', 'Unpaid')}
            </span>
            {b.prepaidSchedule && <div className="mt-1 text-[10px] text-[var(--muted)]">{spreadProgress(b.prepaidSchedule, getLocalDateISO())}</div>}
            <StageChip kind="bill" id={b.id} label={`bill ${b.number || ''}`.trim()} />
            {claimOf(b) && (
              <div className="mt-1 text-[10px] text-[var(--muted)]">
                {purchasesText('label.expenseClaim', 'Expense claim')}{claimOf(b)?.state === 'rejected' ? ` · ${purchasesText('label.rejected', 'rejected')}${claimOf(b)?.reason ? `: ${claimOf(b)?.reason}` : ''}` : ''}
              </div>
            )}
          </div>
        );
      },
    },
    {
      accessorKey: 'amountCents',
      header: purchasesText('col.amount', 'Amount'),
      cell: ({ row }) => (
        <span className="block text-right font-mono font-bold text-slate-900 dark:text-white tabular-nums">
          {formatCurrency(row.original.amountCents || 0)}
        </span>
      ),
    },
    {
      id: 'actions',
      enableSorting: false,
      header: () => <span className="sr-only">{purchasesText('col.actions', 'Actions')}</span>,
      cell: ({ row }) => {
        const b = row.original;
        return (
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onPreviewPdf(b); }}
              className="p-1 text-[var(--muted)] hover:text-slate-800 rounded-lg"
              title={purchasesText('title.preview', 'Preview / download PDF')}
              aria-label={purchasesText('aria.pdf', 'PDF of bill {n}').replace('{n}', b.number || '').trim()}
            >
              <Printer className="w-4 h-4" aria-hidden="true" />
            </button>
            {canEditBill(b) && b.status !== 'void' && (
              <button
                type="button"
                onClick={e => { e.stopPropagation(); onEdit(b); }}
                className="p-1 text-[var(--muted)] hover:text-slate-800 rounded-lg"
                title={purchasesText('title.edit', 'Edit bill')}
                aria-label={purchasesText('aria.edit', 'Edit bill {n}').replace('{n}', b.number || '').trim()}
              >
                <Pencil className="w-4 h-4" aria-hidden="true" />
              </button>
            )}
            {canEditContacts && b.status !== 'draft' && b.status !== 'void' && (b.prepaidSchedule ? (
              <button
                type="button"
                onClick={e => { e.stopPropagation(); void onUndoSpread(b); }}
                className="px-2 py-1 text-xs text-[var(--muted)] hover:text-slate-800 rounded-md"
                aria-label={purchasesText('aria.undoSpread', 'Undo the spread of bill {n}').replace('{n}', b.number || '').trim()}
              >
                {purchasesText('action.undoSpread', 'Undo spread')}
              </button>
            ) : (
              <button
                type="button"
                onClick={e => { e.stopPropagation(); onSpread(b); }}
                className="px-2 py-1 text-xs text-indigo-700 dark:text-indigo-300 hover:underline rounded-md"
                title={purchasesText('title.spread', 'A prepaid expense: spread the cost over the months it covers')}
                aria-label={purchasesText('aria.spread', 'Spread bill {n} over months').replace('{n}', b.number || '').replace('  ', ' ')}
              >
                {purchasesText('action.spread', 'Spread')}
              </button>
            ))}
            {canEditContacts && Boolean(b.vendorId) && calculateAmountDue(b) > 0 &&
              ['approved', 'unpaid', 'overdue', 'partially_paid'].includes(b.status) && claimOf(b)?.state !== 'submitted' && (
              <button
                type="button"
                onClick={e => { e.stopPropagation(); onPay(b); }}
                className="min-h-11 px-2 py-1 text-xs bg-emerald-100 hover:bg-emerald-200 text-emerald-800 font-semibold rounded-md flex items-center gap-1 shadow-xs transition-colors"
              >
                <DollarSign className="w-3.5 h-3.5" aria-hidden="true" />
                {purchasesText('action.pay', 'Pay')}
              </button>
            )}
            {canEditContacts && billMayBeVoided(b) && (
              <button
                type="button"
                onClick={e => { e.stopPropagation(); inBackground(onVoid(b)); }}
                className="min-h-11 px-2 py-1 text-xs bg-amber-100 hover:bg-amber-200 text-amber-800 font-semibold rounded-md flex items-center gap-1 shadow-xs transition-colors"
              >
                <Ban className="w-3.5 h-3.5" aria-hidden="true" />
                {purchasesText('action.void', 'Void')}
              </button>
            )}
            {canEditBill(b) && b.status === 'draft' && (
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation();
                  inBackground(onDelete(b));
                }}
                className="text-rose-500 hover:text-rose-700 p-1 rounded-lg"
                title={purchasesText('title.deleteDraft', 'Delete draft')}
                aria-label={purchasesText('aria.deleteDraft', 'Delete draft bill {n}').replace('{n}', b.number || '').trim()}
              >
                <Trash2 className="w-4 h-4" aria-hidden="true" />
              </button>
            )}
          </div>
        );
      },
    },
  ];
}
