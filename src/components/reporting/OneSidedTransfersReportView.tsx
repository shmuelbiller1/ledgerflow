import React, { useMemo } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { isCollectionCapped } from '../../lib/ledgerCollections';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { oneSidedTransfers } from '../../lib/oneSidedTransfers';
import { validCustomReportPeriod } from '../../lib/reportCustomPeriod';
import { useUIStore } from '../../stores/useUIStore';
import { formatCurrency } from '../../lib/utils';
import ReportTableScroll from './ReportTableScroll';
import { RowTable } from '../ui/RowTable';

export default function OneSidedTransfersReportView({ endDate = '' }: { endDate?: string }) {
  const transactions = useLedgerStore(s => s.transactions), accounts = useLedgerStore(s => s.accounts);
  const lines = useLedgerStore(s => s.bankLines), truncated = useLedgerStore(s => s.truncatedCollections);
  const failed = useDataNeedsStore(s => s.failed), workspace = useAuthStore(s => s.currentWorkspaceId);
  const currency = useAuthStore(s => s.getCurrentWorkspace()?.currency);
  const openRecord = useUIStore(s => s.openRecord);
  const { loading } = useLedgerCollections('accounts', 'transactions', 'bankLines');
  const valid = validCustomReportPeriod({ startDate: endDate, endDate });
  const partial = (['accounts', 'transactions', 'bankLines'] as const).some(key => isCollectionCapped(truncated, key) || failed[key]);
  const rows = useMemo(() => valid && !loading ? oneSidedTransfers(
    accounts.filter(r => !workspace || r.workspaceId === workspace),
    transactions.filter(r => !workspace || r.workspaceId === workspace),
    lines.filter(r => !workspace || r.workspaceId === workspace), endDate,
  ) : [], [accounts, transactions, lines, workspace, endDate, valid, loading]);
  return <section aria-label="Transfer counterpart review" className="p-4 space-y-4 min-w-0">
    <h2 className="text-lg font-semibold">Transfers needing counterpart review</h2>
    <p className="text-sm text-[var(--muted)]">As of {endDate}, review posted transfers between your own cash or bank accounts when only one ledger cash side exists, the cash sides are unequal, or exactly one side has a matched bank statement line. An unmatched side does not prove the funds never arrived. Separate bank-feed records may be missing their account IDs; those cannot establish a match here.</p>
    {loading && <p role="status">Loading transactions and bank statements…</p>}
    {!valid && <p role="alert">Choose a valid report end date.</p>}
    {partial && <p role="alert">History is incomplete or failed to load. Missing counterpart warnings are provisional.</p>}
    {valid && !loading && <ReportTableScroll><RowTable
      rowClassName="border-t border-[var(--line)]"
      caption={(<>Transfer counterpart review as of {endDate}</>)}
      rows={rows}
      rowKey={row => row.id}
      captionClassName=""
      tableClassName="w-full text-sm"
      headRowClassName=""
      bodyClassName=""
      columns={[
        { header: "Date / transaction", className: "text-left", headClassName: "", cell: (row) => <button type="button" className="underline text-left" onClick={() => openRecord({ type: 'transaction', id: row.id })}>{row.date} — <bdi>{row.description}</bdi></button> },
        { header: "From", headClassName: "", cell: (row) => <bdi>{row.fromAccount}</bdi> },
        { header: "To", headClassName: "", cell: (row) => <bdi>{row.toAccount}</bdi> },
        { header: "Amount", className: "text-right tabular-nums", headClassName: "", cell: (row) => formatCurrency(row.amountCents, currency) },
        { header: "Why review", headClassName: "", cell: (row) => row.status },
      ]}
    />{!rows.length && <p>No one-sided transfer warnings in the loaded history.</p>}</ReportTableScroll>}
  </section>;
}
