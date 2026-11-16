import React, { useMemo, useState } from 'react';
import { PackageSearch } from 'lucide-react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { csvMoney, downloadCsv } from '../../lib/csvExport';
import { SLOW_MOVING_BUCKETS, noSaleInDays, slowMovingRows, slowMovingTotals } from '../../lib/slowMovingStock';
import { RowTable } from '../ui/RowTable';

const field = 'px-2 py-1.5 border border-[var(--line)] rounded bg-[var(--panel)] text-[var(--text)]';

/**
 * Slow-moving items (A-9, W-09): every stock item with units on hand, its value at cost, the day it
 * last sold and how long ago, in age buckets. "No sale in N days" narrows the list. Read-only; the
 * figures come from the items and issued invoices already loaded (src/lib/slowMovingStock.ts).
 */
export const SlowMovingStockView: React.FC = () => {
  useLedgerCollections('inventory', 'invoices');
  const inventory = useLedgerStore(s => s.inventory);
  const invoices = useLedgerStore(s => s.invoices);
  const [asOf, setAsOf] = useState(getLocalDateISO());
  const [noSaleDays, setNoSaleDays] = useState<number | ''>('');
  const validDay = /^\d{4}-\d{2}-\d{2}$/.test(asOf);

  const all = useMemo(() => (validDay ? slowMovingRows(inventory || [], invoices || [], asOf) : []), [inventory, invoices, asOf, validDay]);
  const shown = useMemo(() => (noSaleDays === '' ? all : noSaleInDays(all, noSaleDays)), [all, noSaleDays]);
  const totals = useMemo(() => slowMovingTotals(shown), [shown]);

  const exportCsv = () => {
    downloadCsv(`slow_moving_items_${asOf}.csv`,
      ['Item', 'SKU', 'On hand', 'Unit cost', 'Value', 'Last sold', 'Days since sale', 'Age'],
      shown.map(r => [r.name, r.sku, r.quantity, csvMoney(r.unitCostCents), csvMoney(r.valueCents), r.lastSold || 'never', r.daysSinceSold ?? '', SLOW_MOVING_BUCKETS.find(b => b.key === r.bucket)?.label || '']));
  };

  return (
    <section aria-labelledby="slow-moving-title" className="space-y-4">
      <div className="flex items-center gap-2">
        <PackageSearch aria-hidden="true" size={20} className="text-[var(--muted)]" />
        <h2 id="slow-moving-title" className="text-lg font-bold text-[var(--text)]">Slow-moving items</h2>
      </div>
      <div className="flex flex-wrap gap-4 items-end">
        <label className="flex flex-col gap-1 text-sm text-[var(--muted)] w-fit">As of<input type="date" value={asOf} onChange={e => setAsOf(e.target.value)} className={field} /></label>
        <label className="flex flex-col gap-1 text-sm text-[var(--muted)] w-fit">Only items with no sale in (days)
          <input type="number" min={0} step={1} value={noSaleDays} placeholder="All" aria-describedby="slow-moving-help"
            onChange={e => setNoSaleDays(e.target.value === '' ? '' : Math.max(0, Math.floor(Number(e.target.value))))} className={`${field} w-28`} />
        </label>
        <button type="button" onClick={exportCsv} disabled={shown.length === 0}
          className="min-h-[44px] px-4 py-2 rounded border border-[var(--line)] text-sm text-[var(--text)] disabled:opacity-50">Export CSV</button>
      </div>
      <p id="slow-moving-help" className="text-xs text-[var(--muted)]">
        Value = units on hand × the item's unit cost. Last sold = the latest issued invoice line for the item on or before the day (drafts, estimates and voided documents do not count; credit notes do not reduce it). Never sold is listed first.
      </p>
      {!validDay && <p role="alert" className="text-sm text-rose-600">Enter a valid date.</p>}
      {validDay && shown.length === 0 && <p className="text-sm text-[var(--muted)]">No stock items match.</p>}
      {shown.length > 0 && (
        <>
          <ul className="flex flex-wrap gap-3 text-sm" aria-label="Value by age">
            {SLOW_MOVING_BUCKETS.map(b => (
              <li key={b.key} className="px-3 py-2 rounded-lg border border-[var(--line)] bg-[var(--surface)]">
                <span className="text-[var(--muted)]">{b.label}: </span><span className="font-mono">{formatCurrency(totals[b.key])}</span>
              </li>
            ))}
            <li className="px-3 py-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] font-semibold">Total: <span className="font-mono">{formatCurrency(totals.totalCents)}</span></li>
          </ul>
          <div className="overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3">
                        <RowTable
              rowClassName="border-b border-[var(--line)]/50"
              caption={(<>Stock items with units on hand, oldest sale first</>)}
              rows={shown}
              rowKey={r => r.itemId}
              tableClassName="w-full text-sm"
              headRowClassName="border-b border-[var(--line)] text-xs text-[var(--muted)]"
              columns={[
                { header: "Item", className: "font-semibold py-1 px-2 font-normal", cell: (r) => (<><bdi>{r.name}</bdi>{r.sku && <span className="text-xs text-[var(--muted)]"> · {r.sku}</span>}</>) },
                { header: "On hand", align: 'right', className: "font-semibold py-1 px-2 font-mono", cell: (r) => r.quantity },
                { header: "Value", align: 'right', className: "font-semibold py-1 px-2 font-mono", cell: (r) => formatCurrency(r.valueCents) },
                { header: "Age", className: "font-semibold py-1 px-2", cell: (r) => SLOW_MOVING_BUCKETS.find(b => b.key === r.bucket)?.label },
                { header: "Last sold", align: 'right', className: "font-semibold py-1 px-2 text-xs", cell: (r) => r.lastSold ? `${r.lastSold} (${r.daysSinceSold} days ago)` : 'never' },
              ]}
            />
          </div>
        </>
      )}
    </section>
  );
};

export default SlowMovingStockView;
