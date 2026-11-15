import React, { useState } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useUIStore } from '../../stores/useUIStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { formatCurrency, formatDate, getLocalDateISO } from '../../lib/utils';
import { isCashAccount } from '../../lib/txFilters';
import { EmptyState } from '../ui/EmptyState';
import { LoadingState } from '../ui/LoadingState';
import { bankClearance } from '../../lib/bankClearance';
import { csvMoney } from '../../lib/csvExport';
import { TanStackDataGrid } from '../ui/TanStackDataGrid';
import type { ColumnDef } from '@tanstack/react-table';

type ClearanceRow = ReturnType<typeof bankClearance>['rows'][number];

const field = 'px-2 py-1.5 border border-[var(--line)] rounded bg-[var(--panel)] text-[var(--text)]';

/**
 * Bank clearance summary (CB-24): for a bank account and a period, each entry on it and the day the
 * bank cleared it (from the matched statement lines), and at the end what is still outstanding, with
 * the balance the bank should show (src/lib/bankClearance.ts). Each entry opens.
 */
export default function BankClearanceReportView() {
  const { loading } = useLedgerCollections('accounts', 'transactions', 'bankLines');
  const currency = useAuthStore(s => s.getCurrentWorkspace()?.currency) || 'USD';
  const accounts = useLedgerStore(s => s.accounts);
  const transactions = useLedgerStore(s => s.transactions);
  const bankLines = useLedgerStore(s => s.bankLines);
  const openRecord = useUIStore(s => s.openRecord);
  const banks = (accounts || []).filter(a => !a.isArchived && isCashAccount(a)).sort((a, b) => a.name.localeCompare(b.name));
  const [picked, setPicked] = useState('');
  const accountId = picked || banks[0]?.id || '';
  const [from, setFrom] = useState(`${getLocalDateISO().slice(0, 7)}-01`);
  const [to, setTo] = useState(getLocalDateISO());
  const summary = accountId && from <= to ? bankClearance(accountId, transactions || [], bankLines || [], from, to) : null;
  const money = (cents: number) => formatCurrency(cents, currency);
  const clearedText = (row: ClearanceRow) =>
    row.clearedOn === null || (row.clearedOn && row.clearedOn > to) ? 'Outstanding' : row.clearedOn ? formatDate(row.clearedOn) : 'Reconciled';
  /**
   * The order the Cleared column sorts in: reconciled entries, then the dates, then outstanding ones.
   * An entry that cleared after the period reads as outstanding, and `clearedOn` is `null` for an
   * outstanding entry but `''` for one reconciled with no date, so the state comes from `clearedText`
   * — the same rule the cell prints.
   */
  const clearedSortKey = (row: ClearanceRow) =>
    clearedText(row) === 'Outstanding' ? '2Outstanding' : row.clearedOn ? `1${row.clearedOn}` : '0Reconciled';

  const clearanceColumns: ColumnDef<ClearanceRow, unknown>[] = [
    { id: 'date', accessorFn: row => row.date, header: 'Date', cell: info => <span className="font-mono text-xs">{formatDate(String(info.getValue()))}</span> },
    { id: 'entry', accessorFn: row => row.description || 'Entry', header: 'Entry', cell: info => (
      <button type="button" className="text-left text-indigo-600 dark:text-indigo-400 hover:underline" onClick={() => openRecord({ type: 'transaction', id: (info.row.original as ClearanceRow).id })}>
        <bdi>{String(info.getValue())}</bdi><span className="sr-only">: open it</span>
      </button>
    ) },
    { id: 'in', accessorFn: row => (row.amountCents > 0 ? row.amountCents : null), header: 'In', cell: info => (info.getValue() === null ? '' : <span className="font-mono">{money(Number(info.getValue()))}</span>) },
    { id: 'out', accessorFn: row => (row.amountCents < 0 ? -row.amountCents : null), header: 'Out', cell: info => (info.getValue() === null ? '' : <span className="font-mono">{money(Number(info.getValue()))}</span>) },
    /**
     * Sorted on the stored date, with the two states on either side of the dates: sorting the printed
     * date put "Feb 01, 2026" before "Jan 20, 2026", and a day-first format sorted by day of month.
     * Two jobs, kept apart.
     *
     * Sorting: `sortingFn` compares `clearedSortKey`, which starts with the state and then the stored
     * date (`0Reconciled` / `1<iso date>` / `2Outstanding`). The printed date cannot be the sort value —
     * "Feb 01, 2026" sorted before "Jan 20, 2026", and a day-first format sorted by day of month.
     *
     * Searching: `accessorFn` returns what the cell prints, so typing "Outstanding" finds every
     * outstanding entry — including the ones that cleared after the period — and "Reconciled" does not
     * also return them. The key must not lead the accessor: the grid's global filter compares the
     * accessor, and a key in front of it would put the printed-first ordering back.
     */
    { id: 'cleared', accessorFn: clearedText, sortingFn: (a, b) => clearedSortKey(a.original).localeCompare(clearedSortKey(b.original)), header: 'Cleared', cell: info => {
      // the cell prints the record's own state; only the sort key carries the stored date
      const text = clearedText(info.row.original as ClearanceRow);
      return text === 'Outstanding' ? <span className="text-amber-700 dark:text-amber-400">{text}</span> : <span className="text-xs">{text}</span>;
    } },
  ];

  return (
    <section aria-labelledby="bank-clearance-title" className="space-y-4">
      <h2 id="bank-clearance-title" className="text-lg font-bold text-[var(--text)]">Bank clearance summary</h2>
      {banks.length === 0 ? <p className="text-sm text-[var(--muted)]">No bank or cash account yet.</p> : (
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label className="flex flex-col gap-1 text-[var(--muted)]">Bank account
            <select value={accountId} onChange={e => setPicked(e.target.value)} className={field}>
              {banks.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[var(--muted)]">From<input type="date" value={from} onChange={e => setFrom(e.target.value)} className={field} /></label>
          <label className="flex flex-col gap-1 text-[var(--muted)]">To<input type="date" value={to} onChange={e => setTo(e.target.value)} className={field} /></label>
        </div>
      )}
      {loading && <LoadingState what="this account's entries" rows={5} />}
      {summary && (
        <>
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            {[['Book balance', summary.bookBalanceCents], ['Deposits not yet on the statement', summary.outstandingInCents], ['Payments not yet taken', summary.outstandingOutCents], ['The bank should show', summary.bankBalanceCents]].map(([label, cents]) => (
              <div key={label} className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3">
                <dt className="text-xs text-[var(--muted)]">{label} on {formatDate(to)}</dt>
                <dd className="font-mono font-semibold text-[var(--text)]">{money(Number(cents))}</dd>
              </div>
            ))}
          </dl>
          <TanStackDataGrid
            caption={`Each entry on the account in the period and the day the bank cleared it`}
            data={summary.rows}
            columns={clearanceColumns}
            rowHeaderColumn="entry"
            pageSize={25}
            searchPlaceholder="Search this account's entries..."
            searchLabel="Search this account's entries"
            columnScope="report-bank-clearance"
            columnLabel="Bank clearance columns"
            columnNames={['Date', 'Entry', 'In', 'Out', 'Cleared']}
            exportConfig={{
              filename: 'bank-clearance.csv',
              label: 'Export CSV',
              headers: ['Date', 'Entry', 'In', 'Out', 'Cleared'],
              // amounts leave the app as plain decimals (`1234.50`), never the display format
              mapRow: row => [row.date, row.description || 'Entry', row.amountCents > 0 ? csvMoney(row.amountCents) : '', row.amountCents < 0 ? csvMoney(-row.amountCents) : '', clearedText(row)],
            }}
            emptyState={<EmptyState title="No entries on this account in the period" description="Choose another account or a wider period." />}
            filteredEmptyState={<EmptyState title="No entry matches your search" description="Try another description or date." />}
          />
        </>
      )}
    </section>
  );
}
