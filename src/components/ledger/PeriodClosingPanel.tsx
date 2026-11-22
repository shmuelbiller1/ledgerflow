import React, { useEffect, useState } from 'react';
import { FileCheck2, Printer } from 'lucide-react';
import { GroupedRowTable } from '../ui/RowTable';
import type { RowGroup } from '../../lib/tableBands';
import { formatCurrency } from '../../lib/utils';
import type { ClosingLine, PeriodClosing } from '../../server/services/periodClosingService';
import { printElementById } from '../../lib/printRoot';
import { runCommand } from '../../lib/runCommand';

/**
 * EG-3 (docs/design/EG-3-period-closing.md): the period-closing documents the server wrote when each year was closed,
 * read-only and printable. Every version is kept: a reopened year's document shows as superseded, and closing again
 * wrote the next version. No closing entry is posted (CA-07): the transfer to retained earnings is figures only.
 */
type Closing = PeriodClosing & { id: string };

export default function PeriodClosingPanel({ workspaceId, currency, onOpenMonth }: { workspaceId: string; currency?: string; onOpenMonth?: (month: string) => void }) {
  const [closings, setClosings] = useState<Closing[] | null>(null);
  const [chosen, setChosen] = useState('');
  const [error, setError] = useState('');
  const money = (cents: number) => formatCurrency(cents, currency || 'USD');

  useEffect(() => {
    if (!workspaceId) return;
    let alive = true;
    void (async () => {
      try {
        const data = await runCommand<{ closings?: Closing[] }>({
          path: `/api/v1/transactions/period-closings?workspaceId=${encodeURIComponent(workspaceId)}`,
        }) ?? {};
        if (!alive) return;
        setClosings(Array.isArray(data.closings) ? data.closings : []);
        setError('');
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => { alive = false; };
  }, [workspaceId]);

  if (error) return <p role="alert" className="text-sm text-[var(--neg)]">{error}</p>;
  if (!closings || closings.length === 0) return null;
  const doc = closings.find(c => c.id === chosen) || closings[0];
  const month = doc.yearEnd.slice(0, 7);

  const group = (title: string, g: { total: number; accounts: ClosingLine[] }): RowGroup | null => g.accounts.length === 0 && g.total === 0 ? null : {
    key: title,
    rows: [
      { cells: [{ scope: 'rowgroup', colSpan: 2, className: "text-left pt-2 text-xs font-semibold text-[var(--muted)]", content: title }] },
      ...g.accounts.map(a => ({ key: a.accountId, cells: [
        { scope: 'row', className: "text-left font-normal py-0.5", content: <>{a.code ? `${a.code} · ` : ''}{a.name}</> },
        { className: "text-right tabular-nums", content: money(a.cents) },
      ] })),
      { className: "border-t border-[var(--line)]", cells: [
        { scope: 'row', className: "text-left py-0.5", content: `Total ${title.toLowerCase()}` },
        { className: "text-right tabular-nums font-semibold", content: money(g.total) },
      ] },
    ],
  };

  // H-7/AI #10: the closing document is the print root (it had none, so Print produced the whole
  // application shell). The picker and the navigation link stay off the paper.
  return <section id="period-closing-sheet" data-print-root className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 space-y-4 print:border-0" aria-labelledby="period-closing">
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div>
        <h2 id="period-closing" className="text-lg font-medium text-[var(--text)] flex items-center gap-2"><FileCheck2 className="w-5 h-5" aria-hidden="true" /> Period-closing document</h2>
        <p className="text-sm text-[var(--muted)] mt-1">Written by the server when the year was closed. Read-only. No closing entry is posted: the profit stays in retained earnings on the balance sheet.</p>
      </div>
      <div data-print-hide className="flex items-end gap-2 print:hidden">
        <label className="text-xs font-semibold text-[var(--muted)]">Document
          <select value={doc.id} onChange={e => setChosen(e.target.value)} className="block mt-1 px-2 py-1.5 rounded-lg border border-[var(--line)] bg-[var(--panel)] text-sm text-[var(--text)]">
            {closings.map(c => <option key={c.id} value={c.id}>{c.yearEnd} · version {c.version}{c.status === 'superseded' ? ' (superseded)' : ''}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => printElementById('period-closing-sheet')} className="px-3 py-2 rounded-lg border border-[var(--line)] text-sm text-[var(--text)] inline-flex items-center gap-2">
          <Printer className="w-4 h-4" aria-hidden="true" /> Print
        </button>
      </div>
    </div>

    <p className="text-sm text-[var(--text)]">
      Year {doc.yearStart} to {doc.yearEnd}, version {doc.version}: <b>{doc.status === 'superseded' ? 'Superseded' : 'Current'}</b>.
      {' '}Closed by {doc.closedBy} on {doc.closedAt.slice(0, 10)}; locked through {doc.lockDate}.
      {doc.status === 'superseded' && doc.supersededAt ? ` Superseded on ${doc.supersededAt.slice(0, 10)} by ${doc.supersededBy || 'the server'}${doc.supersededReason ? `: ${doc.supersededReason}` : ''}.` : ''}
    </p>

    <GroupedRowTable
        label="Profit and loss"
        caption={<>Profit and loss, {doc.yearStart} to {doc.yearEnd}</>}
        captionClassName="text-left font-semibold text-[var(--text)] pb-1"
        tableClassName="w-full text-sm"
        groups={[group('Income', doc.profitAndLoss.income), group('Cost of goods', doc.profitAndLoss.cogs), group('Expenses', doc.profitAndLoss.expense), { key: 'net', rows: [{ className: "border-t-2 border-[var(--line)]", cells: [
          { scope: 'row', className: "text-left py-1", content: <>Net {doc.profitAndLoss.netIncome >= 0 ? 'profit' : 'loss'}</> },
          { className: "text-right tabular-nums font-semibold", content: money(doc.profitAndLoss.netIncome) },
        ] }] }]}
      />

    <GroupedRowTable
        label="Transfer to retained earnings"
        caption="Transfer to retained earnings (figures only, no entry posted)"
        captionClassName="text-left font-semibold text-[var(--text)] pb-1"
        tableClassName="w-full text-sm"
        groups={[{ rows: [
          { key: 'before', cells: [{ scope: 'row', className: "text-left font-normal", content: 'Retained earnings before the year' }, { className: "text-right tabular-nums", content: money(doc.retainedEarnings.before) }] },
          { key: 'transfer', cells: [{ scope: 'row', className: "text-left font-normal", content: 'The year’s net profit' }, { className: "text-right tabular-nums", content: money(doc.retainedEarnings.transfer) }] },
          { key: 'after', className: "border-t border-[var(--line)]", cells: [{ scope: 'row', className: "text-left", content: <>Retained earnings at {doc.yearEnd}</> }, { className: "text-right tabular-nums font-semibold", content: money(doc.retainedEarnings.after) }] },
        ] }]}
      />

    <GroupedRowTable
        label="Balance sheet totals"
        caption={<>Balance sheet at {doc.yearEnd}</>}
        captionClassName="text-left font-semibold text-[var(--text)] pb-1"
        tableClassName="w-full text-sm"
        groups={[{ rows: [
          { key: 'totalAssets', cells: [{ scope: 'row', className: "text-left font-normal", content: 'Total assets' }, { className: "text-right tabular-nums", content: money(doc.balanceSheet.totalAssets) }] },
          { key: 'totalLiabilities', cells: [{ scope: 'row', className: "text-left font-normal", content: 'Total liabilities' }, { className: "text-right tabular-nums", content: money(doc.balanceSheet.totalLiabilities) }] },
          { key: 'totalEquity', cells: [{ scope: 'row', className: "text-left font-normal", content: 'Equity accounts' }, { className: "text-right tabular-nums", content: money(doc.balanceSheet.totalEquity) }] },
          { key: 'retainedEarnings', cells: [{ scope: 'row', className: "text-left font-normal", content: 'Retained earnings' }, { className: "text-right tabular-nums", content: money(doc.balanceSheet.retainedEarnings) }] },
          { key: 'claims', className: "border-t border-[var(--line)]", cells: [{ scope: 'row', className: "text-left", content: 'Liabilities and equity' }, { className: "text-right tabular-nums font-semibold", content: money(doc.balanceSheet.totalClaims) }] },
        ] }]}
      />
    <p className="text-sm text-[var(--text)]">{doc.balanceSheet.isBalanced ? 'The balance sheet balances.' : 'The balance sheet does not balance: check the trial balance.'}</p>

    <p className="text-xs text-[var(--muted)] break-all">
      Agrees with balance snapshot {doc.snapshot.id} ({doc.snapshot.entryCount} entries, checksum {doc.snapshot.checksum.slice(0, 16)}…).
    </p>
    <p data-print-hide className="text-sm print:hidden">
      <button type="button" onClick={() => onOpenMonth?.(month)} className="text-xs font-semibold text-[var(--brass)] hover:underline">
        Open the close checklist and close package for {month}
      </button>
      <span className="text-xs text-[var(--muted)]"> ({doc.links.closePackage.file})</span>
    </p>
  </section>;
}
