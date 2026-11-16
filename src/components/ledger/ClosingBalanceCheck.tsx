import React, { useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import { formatCurrency } from '../../lib/utils';
import type { SnapshotChange } from '../../lib/closingSnapshot';
import { TanStackDataGrid } from '../ui/TanStackDataGrid';
import { EmptyState } from '../ui/EmptyState';
import { csvMoney } from '../../lib/csvExport';
import type { ColumnDef } from '@tanstack/react-table';
import { runCommand } from '../../lib/runCommand';

/**
 * Closing balance check (CA-06): a closed month's balances on its last day, worked out again by
 * the server from the whole ledger and compared with the snapshot taken when it was closed. "Still
 * as closed" or the accounts that moved since, with the balance then and now. Read only.
 */
interface CheckResult {
  snapshot: { asOfDate: string; takenAt: string; entries: number; accounts: number } | null;
  entriesNow?: number;
  changes: SnapshotChange[];
}

export default function ClosingBalanceCheck({ workspaceId, month, currency }: { workspaceId: string; month: string; currency?: string }) {
  const [result, setResult] = useState<CheckResult | null>(null);
  const [error, setError] = useState('');
  const money = (cents: number) => formatCurrency(cents, currency || 'USD');

  useEffect(() => {
    if (!workspaceId) return;
    let live = true;
    void (async () => {
      try {
        const data = await runCommand<Omit<CheckResult, 'snapshot'> & { snapshot?: CheckResult['snapshot'] }>({
          path: `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/periods/${month}/balance-check`,
        }) ?? { changes: [] };
        if (!live) return;
        setResult({ snapshot: data.snapshot ?? null, entriesNow: data.entriesNow, changes: Array.isArray(data.changes) ? data.changes : [] });
        setError('');
      } catch (err) {
        if (live) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => { live = false; };
  }, [workspaceId, month]);

  if (error) return <p role="alert" className="text-sm text-rose-600">{error}</p>;
  if (!result?.snapshot) return null;
  const { snapshot, changes } = result;

  /**
   * The accounts that moved since the month was closed: what the balance was then, what it is now,
   * and the difference. The account names the row, so it is a row header.
   */
  const columns: ColumnDef<SnapshotChange, unknown>[] = [
    { id: 'account', accessorFn: row => `${row.code ? `${row.code} · ` : ''}${row.name}`, header: 'Account', cell: info => <bdi>{String(info.getValue())}</bdi> },
    { id: 'atClose', accessorFn: row => row.atCloseCents, header: 'At the close', cell: info => <span className="tabular-nums">{money(Number(info.getValue()))}</span> },
    { id: 'now', accessorFn: row => row.nowCents, header: 'Now', cell: info => <span className="tabular-nums">{money(Number(info.getValue()))}</span> },
    { id: 'difference', accessorFn: row => row.differenceCents, header: 'Difference', cell: info => <span className="tabular-nums font-semibold">{money(Number(info.getValue()))}</span> },
  ];
  const closedOn = snapshot.takenAt.slice(0, 10);

  return (
    <section aria-labelledby="closing-balance-check" className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 space-y-3">
      <h2 id="closing-balance-check" className="text-sm font-semibold text-[var(--text)]">Balances since the close</h2>
      {changes.length === 0 ? (
        <p className="text-sm text-[var(--pos)] flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
          Every balance on {snapshot.asOfDate} is still what it was when {month} was closed on {closedOn} ({snapshot.accounts} accounts, {snapshot.entries} entries).
        </p>
      ) : (
        <>
          <p className="text-sm text-amber-700 dark:text-amber-400 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              {changes.length} {changes.length === 1 ? 'account has' : 'accounts have'} a different balance on {snapshot.asOfDate} than when {month} was closed on {closedOn}
              {typeof result.entriesNow === 'number' && result.entriesNow !== snapshot.entries ? ` (${snapshot.entries} entries then, ${result.entriesNow} now)` : ''}.
              The Audit Trail shows what was posted or changed in the closed dates.
            </span>
          </p>
          <TanStackDataGrid
            caption={`Balances on ${snapshot.asOfDate}: at the close and now`}
            data={changes}
            columns={columns}
            rowHeaderColumn="account"
            pageSize={25}
            searchPlaceholder="Search accounts..."
            searchLabel="Search accounts with a different balance"
            columnScope="closing-balance-check"
            columnLabel="Balances since the close columns"
            columnNames={['Account', 'At the close', 'Now', 'Difference']}
            exportConfig={{
              filename: `balances-since-close-${month}.csv`,
              label: 'Export CSV',
              // code and name in separate columns: an imported row can then be matched on either,
              // and the code is not also buried in the account cell (an account without a code is blank)
              headers: ['Code', 'Account', 'At the close', 'Now', 'Difference'],
              mapRow: row => [row.code ?? '', row.name, csvMoney(row.atCloseCents), csvMoney(row.nowCents), csvMoney(row.differenceCents)],
            }}
            filteredEmptyState={<EmptyState title="No account matches your search" description="Try another account name or code." />}
          />
          <p className="text-xs text-[var(--muted)]">Balances are debits positive, credits negative, as in the trial balance.</p>
        </>
      )}
    </section>
  );
}
