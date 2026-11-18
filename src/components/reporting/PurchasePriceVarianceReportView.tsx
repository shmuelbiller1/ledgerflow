import React, { useMemo, useState } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { purchasePriceVariance, purchasePriceVarianceCsvRows, PURCHASE_PRICE_VARIANCE_CSV_HEADERS, type PurchasePriceVarianceRow } from '../../lib/purchasePriceVariance';
import { validCustomReportPeriod } from '../../lib/reportCustomPeriod';
import { normalizeSearchText } from '../../lib/textNormalization';
import { formatCurrency } from '../../lib/utils';
import { downloadCsv } from '../../lib/csvExport';
import ReportTableScroll from './ReportTableScroll';
import { RowTable } from '../ui/RowTable';

const field = 'min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]';

/** A-141: compare vendor purchase prices against peers for the same item and currency. */
export default function PurchasePriceVarianceReportView({ startDate = '', endDate = '' }: { startDate?: string; endDate?: string }) {
  const bills = useLedgerStore(state => state.bills);
  const vendors = useLedgerStore(state => state.vendors);
  const items = useLedgerStore(state => state.inventory);
  const truncated = useLedgerStore(state => state.truncatedCollections);
  const failed = useDataNeedsStore(state => state.failed);
  const workspaceId = useAuthStore(state => state.currentWorkspaceId);
  const workspace = useAuthStore(state => state.getCurrentWorkspace());
  const { loading } = useLedgerCollections('bills', 'vendors', 'inventory');
  const validPeriod = (!startDate && !endDate) || validCustomReportPeriod({ startDate: startDate || endDate, endDate: endDate || startDate });

  const rows = useMemo(() => {
    if (!validPeriod) return [];
    return purchasePriceVariance({
      bills: bills.filter(bill => !workspaceId || bill.workspaceId === workspaceId),
      vendors: vendors.filter(vendor => !workspaceId || vendor.workspaceId === workspaceId),
      items: items.filter(item => !workspaceId || item.workspaceId === workspaceId),
      from: startDate || undefined,
      to: endDate || undefined,
      homeCurrency: workspace?.currency || 'USD',
    });
  }, [bills, vendors, items, workspaceId, workspace?.currency, startDate, endDate, validPeriod]);

  const partial = Boolean(truncated.bills || failed.bills || truncated.vendors || failed.vendors || truncated.inventory || failed.inventory);
  return <PurchasePriceVariancePanel rows={rows} from={startDate} to={endDate} loading={loading} partial={partial} validPeriod={validPeriod} />;
}

export function PurchasePriceVariancePanel({ rows, from = '', to = '', loading = false, partial = false, validPeriod = true }: {
  rows: readonly PurchasePriceVarianceRow[];
  from?: string;
  to?: string;
  loading?: boolean;
  partial?: boolean;
  validPeriod?: boolean;
}) {
  const [vendorId, setVendorId] = useState('');
  const [itemSearch, setItemSearch] = useState('');
  const vendors = [...new Map(rows.map(row => [row.vendorId, row.vendorName])).entries()];
  const query = normalizeSearchText(itemSearch.trim());
  const visible = rows.filter(row => {
    if (vendorId && row.vendorId !== vendorId) return false;
    return !query || normalizeSearchText(`${row.itemName} ${row.sku || ''}`).includes(query);
  });
  const comparable = visible.filter(row => row.peerMedianUnitCents !== undefined).length;

  return <section aria-label="Purchase price variance by vendor" className="p-4 space-y-4 min-w-0">
    <h2>Purchase price variance by vendor</h2>
    <p className="text-sm text-[var(--muted)]">
      Each vendor&apos;s unit cost is the quantity-weighted average of its bill-line amounts divided by units. The reference is the median of the other vendors&apos; averages for the same item and currency; a vendor with no peer baseline is left unscored. The bill lines use the same whole-cent unit-cost rule as Vendor Price History and Vendor Scorecard, with no currency conversion, catalogue-price comparison or change to any bill.
    </p>

    <div className="flex flex-wrap items-end gap-3" data-print-hide>
      <label className="flex flex-col gap-1 text-sm">Vendor
        <select aria-label="Variance vendor" className={field} value={vendorId} onChange={event => setVendorId(event.target.value)}>
          <option value="">All vendors</option>
          {vendors.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">Item or SKU
        <input aria-label="Variance item" className={field} value={itemSearch} onChange={event => setItemSearch(event.target.value)} placeholder="Search items" />
      </label>
      <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]" disabled={!visible.length || loading || partial || !validPeriod}
        onClick={() => downloadCsv('purchase-price-variance', PURCHASE_PRICE_VARIANCE_CSV_HEADERS, purchasePriceVarianceCsvRows(visible))}>Export CSV</button>
    </div>

    {!validPeriod && <p role="alert">Choose a valid report period.</p>}
    {loading && <p role="status">Loading bills, vendors and items…</p>}
    {partial && <p role="alert">Bill, vendor or item history is capped or failed. Peer baselines may be incomplete and CSV is unavailable until the data loads completely.</p>}
    <p className="text-sm"><b>Vendor/item comparisons:</b> {visible.length} · <b>with peer baseline:</b> {comparable}</p>

    <ReportTableScroll>
      <RowTable
        rowClassName="border-b border-[var(--line)]/50"
        caption={(<>Purchase-price variance{from || to ? ` from ${from || 'any date'} to ${to || 'any date'}` : ' in the loaded bill history'}; peer comparisons remain within currency</>)}
        rows={visible}
        rowKey={row => `${row.vendorId}:${row.itemId}:${row.currency}`}
        captionClassName=""
        tableClassName="w-full text-sm"
        headRowClassName=""
        bodyClassName=""
        columns={[
          { header: "Vendor", className: "text-left font-normal py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => <bdi>{row.vendorName}</bdi> },
          { header: "Item", className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => (<><bdi>{row.itemName}</bdi>{row.sku ? <span className="text-[var(--muted)]"> ({row.sku})</span> : null}</>) },
          { header: "Currency", className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => row.currency },
          { header: "Purchases", className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => row.purchases },
          { header: "Units", className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => row.units },
          { header: "Vendor average", className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => formatCurrency(row.averageUnitCents, row.currency) },
          { header: "Peer median", className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => row.peerMedianUnitCents === undefined ? 'No peer baseline' : formatCurrency(row.peerMedianUnitCents, row.currency) },
          { header: "Variance", className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => row.varianceUnitCents === undefined ? '—' : `${formatCurrency(row.varianceUnitCents, row.currency)} ${row.varianceUnitCents > 0 ? '(higher)' : row.varianceUnitCents < 0 ? '(lower)' : '(same)'}` },
          { header: "Variance %", className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => row.variancePercent === undefined ? '—' : `${row.variancePercent > 0 ? '+' : ''}${row.variancePercent.toFixed(2)}%` },
        ]}
      />
      {validPeriod && !loading && !visible.length && <p className="text-sm text-[var(--muted)]">No comparable bill line has an item and positive units in this period.</p>}
    </ReportTableScroll>
  </section>;
}
