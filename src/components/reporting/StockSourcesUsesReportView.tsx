import React, { useEffect, useMemo, useState } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { csvMoneyForBook, downloadCsv } from '../../lib/csvExport';
import { resolveDimensionLabel } from '../../lib/dimensionUtils';
import type { ItemDetails } from '../../lib/stockMoves';
import { stockSourcesUses, stockSourcesUsesCsv, type FlowLine, type ItemSourcesUses } from '../../lib/stockSourcesUses';
import { runCommand } from '../../lib/runCommand';
import { GroupedRowTable } from '../ui/RowTable';
import type { BandRow } from '../../lib/tableBands';
import { useReportText } from './useReportText';
import { LoadingState } from '../ui/LoadingState';

/** Code names, form numbers, paths and identifiers shown as-is: they are not words to translate (EU-G1). */
const CODE_NAMES = { c0: '0' } as const;



const field = 'px-2 py-1.5 border border-[var(--line)] rounded bg-[var(--panel)] text-[var(--text)]';
const qty = (n: number) => String(Math.round(n * 1e6) / 1e6);

/**
 * Stock sources and uses (DIM-2 phase 4, GitHub #132): for a period, each item's opening stock, where its units came
 * from (each vendor, Adjust stock, origin not recorded, returns), where they went (each customer and the sold line's
 * labels, vendors sent back to, adjustments by their reason) and its closing stock, with a check that they add up.
 * Read from the stock history the server keeps (src/lib/stockSourcesUses.ts); nothing is written and nothing guessed.
 */
export default function StockSourcesUsesReportView() {
  const reportText = useReportText();
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  useLedgerCollections('vendors', 'customers');
  const vendors = useLedgerStore(s => s.vendors);
  const customers = useLedgerStore(s => s.customers);
  const nodes = useLedgerStore(s => s.dimensionNodes || []);
  const [startDate, setStartDate] = useState(`${getLocalDateISO().slice(0, 4)}-01-01`);
  const [endDate, setEndDate] = useState(getLocalDateISO());
  const [result, setResult] = useState<{ key: string; items?: ItemDetails[]; error?: string } | null>(null);
  const currency = workspace?.currency || 'USD';
  // #910 family: stock values are in the book currency, so the file's decimals come from it
  const moneyCell = csvMoneyForBook(currency);
  const key = workspace && startDate && endDate && startDate <= endDate ? new URLSearchParams({ workspaceId: workspace.id, startDate, endDate }).toString() : '';

  useEffect(() => {
    if (!key) return;
    let live = true;
    (async () => {
      const body = await runCommand<{ items?: ItemDetails[] }>({ path: `/api/v1/reports/inventory-details?${key}` }) ?? {};
      if (!Array.isArray(body.items)) throw new Error('The stock history could not be read');
      return body.items as ItemDetails[];
    })().then(items => { if (live) setResult({ key, items }); }).catch(err => { if (live) setResult({ key, error: err instanceof Error ? err.message : String(err) }); });
    return () => { live = false; };
  }, [key]);
  const shown = result && result.key === key ? result : null;

  const rows = useMemo(() => {
    if (!shown?.items) return null;
    const vendorName = new Map(vendors.map(v => [v.id, v.name]));
    const customerName = new Map(customers.map(c => [c.id, c.name]));
    return stockSourcesUses(shown.items, {
      vendor: id => vendorName.get(id), customer: id => customerName.get(id), label: (dim, id) => resolveDimensionLabel(nodes, dim, id),
    });
  }, [shown, vendors, customers, nodes]);

  const exportCsv = () => {
    if (!rows) return;
    const [headers, ...data] = stockSourcesUsesCsv(rows, moneyCell);
    downloadCsv(`stock-sources-uses-${startDate}-to-${endDate}.csv`, headers, data);
  };

  return (
    <section aria-labelledby="stock-sources-uses-title" className="space-y-4">
      <h2 id="stock-sources-uses-title" className="text-lg font-bold text-[var(--text)]">{reportText('r.stock-sources-and-uses', 'Stock sources and uses')}</h2>
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1 text-[var(--muted)]">{reportText('r.from', 'From')}<input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={field} /></label>
        <label className="flex flex-col gap-1 text-[var(--muted)]">{reportText('r.to', 'To')}<input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className={field} /></label>
        <button type="button" onClick={exportCsv} disabled={!rows || rows.length === 0} className="min-h-11 rounded-lg border border-[var(--line)] px-3 py-2 font-semibold text-[var(--text)] disabled:opacity-50">{reportText('r.export-csv', 'Export CSV')}</button>
      </div>
      {startDate > endDate && <p role="status" className="text-xs text-amber-700 dark:text-amber-400">{reportText('r.the-period-starts-after-it-ends', 'The period starts after it ends.')}</p>}
      {key && !shown && <LoadingState label={reportText('r.loading', 'Loading…')} rows={3} />}
      {shown?.error && <p role="alert" className="text-sm text-rose-600">{shown.error}</p>}
      {rows && rows.length === 0 && <p className="text-sm text-[var(--muted)]">{reportText('r.no-stock-and-no-movements-in-this-period', 'No stock and no movements in this period.')}</p>}
      {rows?.map(r => <ItemFlow key={r.itemId} row={r} currency={currency} />)}
    </section>
  );
}

function flowRows(lines: FlowLine[], currency: string, reportText: ReturnType<typeof useReportText>): BandRow[] {
  return lines.map(l => ({
    key: l.key,
    className: "border-b border-[var(--line)]/50",
    cells: [
      { scope: 'row', className: "text-left font-normal py-1 pl-4", content: <><bdi>{l.label}</bdi>{l.unknown && <span className="ml-1 text-xs text-amber-700 dark:text-amber-400">{reportText('r.not-recorded-2', '(not recorded)')}</span>}</> },
      { className: "text-right font-mono py-1", content: qty(l.quantity) },
      { className: "text-right font-mono py-1", content: formatCurrency(l.valueCents, currency) },
    ],
  }));
}

function ItemFlow({ row, currency }: { row: ItemSourcesUses; currency: string }) {
  const reportText = useReportText();
  const sectionRow = (text: string): BandRow => ({ cells: [{ scope: 'rowgroup', colSpan: 3, className: "text-left text-xs font-semibold text-[var(--muted)] pt-2", content: text }] });
  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3" data-testid="stock-flow">
      <GroupedRowTable
        caption={<bdi>{row.itemName}</bdi>}
        captionClassName="text-left font-semibold text-[var(--text)] pb-1"
        tableClassName="w-full text-sm"
        head={[{ className: "border-b border-[var(--line)] text-xs text-[var(--muted)]", cells: [
          { scope: 'col', className: "text-left font-semibold py-1", content: reportText('r.line', 'Line') },
          { scope: 'col', className: "text-right font-semibold py-1", content: reportText('r.units', 'Units') },
          { scope: 'col', className: "text-right font-semibold py-1", content: reportText('r.value', 'Value') },
        ] }]}
        groups={[{ rows: [
          { key: 'opening', cells: [
            { scope: 'row', className: "text-left font-normal py-1", content: reportText('r.opening-2', 'Opening') },
            { className: "text-right font-mono py-1", content: qty(row.opening.quantity) },
            { className: "text-right font-mono py-1", content: formatCurrency(row.opening.valueCents, currency) },
          ] },
          ...row.sources.length > 0 ? [sectionRow(reportText('r.came-from', 'Came from')), ...flowRows(row.sources, currency, reportText)] : [],
          ...row.uses.length > 0 ? [sectionRow(reportText('r.went-to', 'Went to')), ...flowRows(row.uses, currency, reportText)] : [],
          row.costChanges.moves > 0 && { key: 'cost-changes', cells: [
            { scope: 'row', className: "text-left font-normal py-1", content: reportText('r.cost-changes-no-units', 'Cost changes (no units)') },
            { className: "text-right font-mono py-1", content: CODE_NAMES.c0 },
            { className: "text-right font-mono py-1", content: formatCurrency(row.costChanges.valueCents, currency) },
          ] },
          row.transfers.moves > 0 && { key: 'transfers', className: "text-[var(--muted)]", cells: [
            { scope: 'row', className: "text-left font-normal py-1", content: <>{reportText('r.moved-between-locations', 'Moved between locations (')}{row.transfers.moves} {reportText('r.moves-not-counted-twice', 'moves, not counted twice)')}</> },
            { className: "text-right font-mono py-1", content: qty(row.transfers.net) },
            { content: null },
          ] },
        ] }]}
        footClassName=""
        foot={[{ className: "font-semibold", cells: [
          { scope: 'row', className: "text-left py-1", content: reportText('r.closing', 'Closing') },
          { className: "text-right font-mono py-1", content: qty(row.closing.quantity) },
          { className: "text-right font-mono py-1", content: formatCurrency(row.closing.valueCents, currency) },
        ] }]}
      />
      {row.differenceUnits !== 0
        ? <p role="alert" className="mt-1 text-xs text-rose-600">{reportText('r.these-do-not-add-up', 'These do not add up:')} {qty(row.differenceUnits)} {reportText('r.units-are-not-explained-by-the-stock-history', 'units are not explained by the stock history.')}</p>
        : <p className="mt-1 text-xs text-[var(--muted)]">{reportText('r.opening-came-from-went-to-closing', 'Opening + came from − went to = closing.')}</p>}
      {row.unknownUnits > 0 && <p className="text-xs text-amber-700 dark:text-amber-400">{qty(row.unknownUnits)} {reportText('r.units-have-no-vendor-customer-or-reason-recorded', 'units have no vendor, customer or reason recorded.')}</p>}
    </div>
  );
}
