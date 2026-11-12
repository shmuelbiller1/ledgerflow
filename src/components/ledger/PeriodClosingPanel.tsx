import React, { useEffect, useState } from 'react';
import { FileCheck2, Printer } from 'lucide-react';
import { getIdToken } from '../../firebase';
import { formatCurrency } from '../../lib/utils';
import type { ClosingLine, PeriodClosing } from '../../server/services/periodClosingService';
import { printElementById } from '../../lib/printRoot';

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
        const token = await getIdToken().catch(() => null);
        const res = await fetch(`/api/v1/transactions/period-closings?workspaceId=${encodeURIComponent(workspaceId)}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        const data = await res.json().catch(() => ({}));
        if (!alive) return;
        if (!res.ok) throw new Error(data.error || data.message || 'The closing documents could not be read');
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

  const group = (title: string, g: { total: number; accounts: ClosingLine[] }) => g.accounts.length === 0 && g.total === 0 ? null : <tbody>
    <tr><th scope="rowgroup" colSpan={2} className="text-left pt-2 text-xs font-semibold text-[var(--muted)]">{title}</th></tr>
    {g.accounts.map(a => <tr key={a.accountId}><th scope="row" className="text-left font-normal py-0.5">{a.code ? `${a.code} · ` : ''}{a.name}</th><td className="text-right tabular-nums">{money(a.cents)}</td></tr>)}
    <tr className="border-t border-[var(--line)]"><th scope="row" className="text-left py-0.5">Total {title.toLowerCase()}</th><td className="text-right tabular-nums font-semibold">{money(g.total)}</td></tr>
  </tbody>;

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

    <table className="w-full text-sm" aria-label="Profit and loss">
      <caption className="text-left font-semibold text-[var(--text)] pb-1">Profit and loss, {doc.yearStart} to {doc.yearEnd}</caption>
      {group('Income', doc.profitAndLoss.income)}
      {group('Cost of goods', doc.profitAndLoss.cogs)}
      {group('Expenses', doc.profitAndLoss.expense)}
      <tbody><tr className="border-t-2 border-[var(--line)]"><th scope="row" className="text-left py-1">Net {doc.profitAndLoss.netIncome >= 0 ? 'profit' : 'loss'}</th><td className="text-right tabular-nums font-semibold">{money(doc.profitAndLoss.netIncome)}</td></tr></tbody>
    </table>

    <table className="w-full text-sm" aria-label="Transfer to retained earnings">
      <caption className="text-left font-semibold text-[var(--text)] pb-1">Transfer to retained earnings (figures only, no entry posted)</caption>
      <tbody>
        <tr><th scope="row" className="text-left font-normal">Retained earnings before the year</th><td className="text-right tabular-nums">{money(doc.retainedEarnings.before)}</td></tr>
        <tr><th scope="row" className="text-left font-normal">The year&apos;s net profit</th><td className="text-right tabular-nums">{money(doc.retainedEarnings.transfer)}</td></tr>
        <tr className="border-t border-[var(--line)]"><th scope="row" className="text-left">Retained earnings at {doc.yearEnd}</th><td className="text-right tabular-nums font-semibold">{money(doc.retainedEarnings.after)}</td></tr>
      </tbody>
    </table>

    <table className="w-full text-sm" aria-label="Balance sheet totals">
      <caption className="text-left font-semibold text-[var(--text)] pb-1">Balance sheet at {doc.yearEnd}</caption>
      <tbody>
        <tr><th scope="row" className="text-left font-normal">Total assets</th><td className="text-right tabular-nums">{money(doc.balanceSheet.totalAssets)}</td></tr>
        <tr><th scope="row" className="text-left font-normal">Total liabilities</th><td className="text-right tabular-nums">{money(doc.balanceSheet.totalLiabilities)}</td></tr>
        <tr><th scope="row" className="text-left font-normal">Equity accounts</th><td className="text-right tabular-nums">{money(doc.balanceSheet.totalEquity)}</td></tr>
        <tr><th scope="row" className="text-left font-normal">Retained earnings</th><td className="text-right tabular-nums">{money(doc.balanceSheet.retainedEarnings)}</td></tr>
        <tr className="border-t border-[var(--line)]"><th scope="row" className="text-left">Liabilities and equity</th><td className="text-right tabular-nums font-semibold">{money(doc.balanceSheet.totalClaims)}</td></tr>
      </tbody>
    </table>
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
