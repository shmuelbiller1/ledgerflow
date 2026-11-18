import React, { useEffect, useMemo, useState } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { downloadCsv } from '../../lib/csvExport';
import type { ItemDetails } from '../../lib/stockMoves';
import { inventoryTurnover, turnoverCsvRows, TURNOVER_CSV_HEADERS } from '../../lib/inventoryTurnover';
import ReportTableScroll from './ReportTableScroll';
import { inBackground } from '../../lib/inBackground';
import { runCommand } from '../../lib/runCommand';
import { useReportText } from './useReportText';

const qty = (n: number) => String(Math.round(n * 100) / 100);
const ratio = (n: number | null) => (n === null ? '—' : n.toFixed(2));

/**
 * A-192: inventory turnover by item. Reads the stock history from the server (the same
 * inventory-details report Stock Aging uses — the browser's loaded copies can be capped) and
 * shows, per item, what sold against the average held. Read-only.
 */
export default function InventoryTurnoverReportView() {
  const reportText = useReportText();
  const workspace = useAuthStore(state => state.getCurrentWorkspace());
  const workspaceId = workspace?.id || '';
  const home = workspace?.currency || 'USD';
  const today = getLocalDateISO();
  const [from, setFrom] = useState(`${today.slice(0, 4)}-01-01`);
  const [to, setTo] = useState(today);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; items?: ItemDetails[]; error?: string } | null>(null);

  const periodValid = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to;
  const key = workspaceId && periodValid ? `${workspaceId}:${from}:${to}:${attempt}` : '';

  useEffect(() => {
    if (!key) return;
    let alive = true;
    inBackground((async () => {
      try {
        const query = new URLSearchParams({ workspaceId, startDate: from, endDate: to }).toString();
        const data = await runCommand<{ items?: ItemDetails[] }>({ path: `/api/v1/reports/inventory-details?${query}` }) ?? {};
        if (alive) setResult({ key, items: data.items || [] });
      } catch (error) {
        if (alive) setResult({ key, error: error instanceof Error ? error.message : String(error) });
      }
    })());
    return () => { alive = false; };
  }, [key, workspaceId, from, to]);

  const current = result && result.key === key ? result : null;
  const loading = Boolean(key) && !current;
  const rows = useMemo(
    () => (current?.items ? inventoryTurnover(current.items, from, to) : []),
    [current, from, to],
  );

  return <section aria-label={reportText('r.inventory-turnover', 'Inventory turnover')} className="p-4 space-y-4 min-w-0">
    <h2>{reportText('r.inventory-turnover', 'Inventory turnover')}</h2>
    <p className="text-sm text-[var(--muted)]">
      {reportText('r.inventory-turnover-intro', 'How many times each item\'s average stock sold through in the period, from the stock history the server keeps. Sold is the net of sales and returns; stock that left for another reason (a count write-off, a purchase return) is under Issued, never in Sold. The average is (opening + closing) ÷ 2 — a two-point average, not a daily one. Where nothing sold, or the average is not positive, the turnover is — rather than an invented number.')}
    </p>

    <div className="flex flex-wrap items-end gap-3" data-print-hide>
      <label className="flex flex-col gap-1 text-sm">{reportText('r.from', 'From')}
        <input type="date" aria-label={reportText('r.period-start', 'Period start')} className="min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]" value={from} onChange={e => setFrom(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-sm">{reportText('r.to', 'To')}
        <input type="date" aria-label={reportText('r.period-end', 'Period end')} className="min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]" value={to} onChange={e => setTo(e.target.value)} />
      </label>
      <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]" disabled={!rows.length}
        onClick={() => downloadCsv('inventory-turnover', [...TURNOVER_CSV_HEADERS], turnoverCsvRows(rows))}>{reportText('r.export-csv', 'Export CSV')}</button>
    </div>

    {!periodValid && <p role="alert" className="text-sm">{reportText('r.choose-a-valid-period-the-start-must-not-be-afte', 'Choose a valid period: the start must not be after the end.')}</p>}
    {loading && <p role="status" className="text-sm text-[var(--muted)]">{reportText('r.reading-the-stock-history', 'Reading the stock history…')}</p>}
    {current?.error && <div className="space-y-2">
      <p role="alert" className="text-sm">{reportText('r.the-stock-history-could-not-be-read', 'The stock history could not be read:')} {current.error}</p>
      <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]" onClick={() => setAttempt(n => n + 1)}>{reportText('r.retry', 'Retry')}</button>
    </div>}

    <ReportTableScroll>
      <table className="w-full text-sm">
        <caption>{reportText('r.inventory-turnover-by-item', 'Inventory turnover by item,')} {from} {reportText('r.to-2', 'to')} {to} {reportText('r.values-in', '(values in')} {home})</caption>
        <thead>
          <tr>
            {['Item', 'Opening units', 'Received', 'Sold (net)', 'Issued (all reasons)', 'Closing units', 'Average units',
              'Cost of what sold', 'Average value', 'Turnover (units)', 'Turnover (value)', 'Days of stock'].map((head, i) =>
              <th key={head} scope="col" className={`${i === 0 ? 'text-left' : 'text-right'} py-1 px-2`}>{head}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.itemId} className="border-b border-[var(--line)]/50">
              <th scope="row" className="text-left font-normal py-1 px-2"><bdi>{row.itemName}</bdi>
                {row.note === 'negative-stock' && <span className="text-[var(--muted)]"> {reportText('r.stock-was-negative', '· stock was negative')}</span>}</th>
              <td className="py-1 px-2 text-right tabular-nums">{qty(row.openingQty)}</td>
              <td className="py-1 px-2 text-right tabular-nums">{qty(row.receivedQty)}</td>
              <td className="py-1 px-2 text-right tabular-nums">{qty(row.soldQty)}</td>
              <td className="py-1 px-2 text-right tabular-nums">{qty(row.issuedQty)}</td>
              <td className="py-1 px-2 text-right tabular-nums">{qty(row.closingQty)}</td>
              <td className="py-1 px-2 text-right tabular-nums">{qty(row.averageQty)}</td>
              <td className="py-1 px-2 text-right tabular-nums">{formatCurrency(row.costOfSoldCents, home)}</td>
              <td className="py-1 px-2 text-right tabular-nums">{formatCurrency(row.averageValueCents, home)}</td>
              <td className="py-1 px-2 text-right tabular-nums font-semibold">{ratio(row.turnoverUnits)}</td>
              <td className="py-1 px-2 text-right tabular-nums">{ratio(row.turnoverValue)}</td>
              <td className="py-1 px-2 text-right tabular-nums">{row.daysOfStock === null ? '—' : row.daysOfStock.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {current?.items && !rows.length && <p className="text-sm text-[var(--muted)]">{reportText('r.no-item-has-stock-or-a-stock-movement-in-this-pe', 'No item has stock or a stock movement in this period.')}</p>}
    </ReportTableScroll>

    <p className="text-xs text-[var(--muted)]">
      {reportText('r.inventory-turnover-footnote', 'Values are the stock ledger\'s own, as in Inventory Valuation. Days of stock is the period\'s days divided by the units turnover — about how long the average stock lasts at this period\'s pace, not a promise about the next one.')}
    </p>
  </section>;
}
