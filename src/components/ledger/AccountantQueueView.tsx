/**
 * A-155: Accountant queue screen — one unified triage inbox for entry questions, held approvals
 * (invoices, purchase orders, submitted expense claims), draft/pending manual journal adjustments,
 * and active period-lock exceptions, linking directly to the owning screen & record.
 */
import React, { useMemo, useState } from 'react';
import { ArrowRight, ClipboardCheck } from 'lucide-react';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useUIStore } from '../../stores/useUIStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { useCollection } from '../../hooks/useCollection';
import { useClientQueries } from '../../services/clientQueryActions';
import type { PurchaseOrder } from '../../types';
import type { ClientQuery } from '../../lib/clientQueries';
import {
  buildAccountantQueue,
  type AccountantQueueItem,
  type AccountantQueueKind,
} from '../../lib/accountantQueue';
import { TanStackDataGrid } from '../ui/TanStackDataGrid';
import { EmptyState } from '../ui/EmptyState';
import { LoadingState } from '../ui/LoadingState';
import type { ColumnDef } from '@tanstack/react-table';

const KIND_LABELS: Record<'all' | AccountantQueueKind, string> = {
  all: 'All items',
  question: 'Entry questions',
  approval: 'Approvals',
  adjustment: 'Adjustments & drafts',
  'locked-period': 'Locked-period items',
};

export default function AccountantQueueView({
  purchaseOrders: purchaseOrdersProp,
  queries: queriesProp,
}: {
  purchaseOrders?: PurchaseOrder[];
  queries?: ClientQuery[];
} = {}) {
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const workspaceId = useAuthStore(s => s.currentWorkspaceId) || '';
  const invoices = useLedgerStore(s => s.invoices);
  const bills = useLedgerStore(s => s.bills);
  const transactions = useLedgerStore(s => s.transactions);
  const setActiveTab = useUIStore(s => s.setActiveTab);
  const openRecord = useUIStore(s => s.openRecord);
  const { loading } = useLedgerCollections('invoices', 'bills', 'transactions');
  const { data: loadedOrders } = useCollection<PurchaseOrder>('purchaseOrders', {
    orderByField: 'createdAt',
    orderDirection: 'desc',
    limit: 500,
  });
  const { queries: loadedQueries } = useClientQueries(workspaceId);

  const purchaseOrders = purchaseOrdersProp ?? loadedOrders;
  const queries = queriesProp ?? loadedQueries;

  const [filterKind, setFilterKind] = useState<'all' | AccountantQueueKind>('all');

  const queue = useMemo(
    () => buildAccountantQueue({
      queries: queries || [],
      invoices: invoices || [],
      purchaseOrders: purchaseOrders || [],
      bills: bills || [],
      transactions: transactions || [],
      workspace,
    }),
    [queries, invoices, purchaseOrders, bills, transactions, workspace],
  );

  /**
   * One row per thing waiting for an accountant: what kind it is, what it is about, the date, the
   * amount when there is one, and the way in. The item names the row; Review still opens it.
   */
  const columns: ColumnDef<AccountantQueueItem, unknown>[] = [
    { id: 'kind', accessorFn: row => KIND_LABELS[row.kind], header: 'Category', cell: info => (
      <span className="inline-block px-2 py-0.5 text-xs font-semibold rounded bg-[var(--elevated)] text-[var(--text)]">{String(info.getValue())}</span>
    ) },
    { id: 'item', accessorFn: row => `${row.title} ${row.subtitle}`, header: 'Item', cell: info => {
      const row = info.row.original as AccountantQueueItem;
      return (
        <span className="block">
          <span className="block font-semibold"><bdi>{row.title}</bdi></span>
          <span className="block text-xs text-[var(--muted)]"><bdi>{row.subtitle}</bdi></span>
        </span>
      );
    } },
    { id: 'date', accessorFn: row => row.date || '', header: 'Date', cell: info => <span className="tabular-nums text-[var(--muted)]">{String(info.getValue()) || '—'}</span> },
    { id: 'amount', accessorFn: row => row.amountFormatted || '', header: 'Amount', cell: info => <span className="tabular-nums font-semibold">{String(info.getValue()) || '—'}</span> },
    { id: 'open', header: 'Open', cell: info => (
      <button
        type="button"
        onClick={() => handleOpen(info.row.original as AccountantQueueItem)}
        className="min-h-10 px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-950/50 dark:text-indigo-300 inline-flex items-center gap-1"
      >
        Review <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
      </button>
    ) },
  ];

  const visible = useMemo(
    () => (filterKind === 'all' ? queue : queue.filter(i => i.kind === filterKind)),
    [queue, filterKind],
  );

  const handleOpen = (item: AccountantQueueItem) => {
    setActiveTab(item.targetTab);
    if (item.recordRef) {
      openRecord(item.recordRef);
    }
  };

  if (loading) {
    // a named placeholder: the queue below can say "queue clear", so it must say "still loading" first
    return <LoadingState what="the accountant queue" rows={5} />;
  }

  return (
    <div className="space-y-6 p-4 sm:p-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
          <ClipboardCheck className="w-6 h-6 text-indigo-600" aria-hidden="true" />
          Accountant Queue
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
          Questions on entries, held approvals across invoices, purchase orders, and expense claims, unposted manual journal adjustments, and open lock-date exceptions in one review list.
        </p>
      </div>

      <div role="tablist" aria-label="Filter accountant queue" className="flex flex-wrap gap-2">
        {(Object.keys(KIND_LABELS) as Array<'all' | AccountantQueueKind>).map(k => {
          const count = k === 'all' ? queue.length : queue.filter(i => i.kind === k).length;
          const active = filterKind === k;
          return (
            <button
              key={k}
              role="tab"
              type="button"
              aria-selected={active}
              onClick={() => setFilterKind(k)}
              className={`min-h-11 px-4 py-2 text-sm font-semibold rounded-lg border transition-colors ${
                active
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              {KIND_LABELS[k]} ({count})
            </button>
          );
        })}
      </div>

      <TanStackDataGrid
        caption="Accountant triage queue"
        data={visible}
        columns={columns}
        rowHeaderColumn="item"
        pageSize={25}
        searchPlaceholder="Search questions, items and dates..."
        searchLabel="Search the triage queue"
        columnScope="accountant-queue"
        columnLabel="Triage queue columns"
        columnNames={['Category', 'Item', 'Date', 'Amount', 'Open']}
        exportConfig={{
          filename: 'accountant-triage-queue.csv',
          label: 'Export CSV',
          headers: ['Category', 'Item', 'Detail', 'Date', 'Amount'],
          mapRow: row => [KIND_LABELS[row.kind], row.title, row.subtitle, row.date || '', row.amountFormatted || ''],
        }}
        emptyState={<EmptyState title="Queue clear" description="No open questions, held approvals, unposted adjustments or lock-date exceptions need attention right now." />}
        filteredEmptyState={<EmptyState title="Nothing in the queue matches your search" description="Try another word, or clear the search." />}
      />
    </div>
  );
}
