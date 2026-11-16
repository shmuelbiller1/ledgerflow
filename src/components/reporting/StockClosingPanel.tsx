import { runCommand } from '../../lib/runCommand';
import React, { useEffect, useState } from 'react';
import { formatCurrency } from '../../lib/utils';
import type { StockCheckReport } from '../../server/services/stockClosingService';
import { RowTable } from '../ui/RowTable';

/** EG-7: the latest stock closing and the stock checks, read only (GET /api/v1/inventory/stock-closing). */
export const StockClosingPanel: React.FC<{ workspaceId: string | null | undefined; currency?: string }> = ({ workspaceId, currency }) => {
  const [state, setState] = useState<{ key: string; report?: StockCheckReport; error?: string } | null>(null);
  useEffect(() => {
    if (!workspaceId) return;
    let live = true;
    (async () => {
      const data = await runCommand<StockCheckReport>({ path: `/api/v1/inventory/stock-closing?${new URLSearchParams({ workspaceId })}` });
      // both checks must be present, or the panel would draw a report that says nothing
      if (!data?.books?.message || !data?.negative?.message) throw new Error('The stock checks could not be read');
      return data;
    })()
      .then(report => { if (live) setState({ key: workspaceId, report }); })
      .catch((error: unknown) => { if (live) setState({ key: workspaceId, error: error instanceof Error ? error.message : String(error) }); });
    return () => { live = false; };
  }, [workspaceId]);
  if (!workspaceId) return null;
  const current = state?.key === workspaceId ? state : null;
  const money = (cents: number) => formatCurrency(cents, currency);
  const report = current?.report;
  const closing = report?.closing;
  const line = (ok: boolean, text: string) => (
    <li className={ok ? 'text-[var(--muted)]' : 'text-[var(--text)] font-medium'}>{ok ? 'OK: ' : 'Check: '}{text}</li>
  );
  return (
    <section aria-label="Stock closing and checks" className="text-xs p-3 rounded-lg border border-[var(--border)] space-y-2">
      <h3 className="font-semibold text-[var(--text)]">Stock closing and checks</h3>
      {!current && <p role="status" className="text-[var(--muted)]">Reading the stock checks…</p>}
      {current?.error && <p role="status">Stock checks not available: {current.error}</p>}
      {report && (
        <>
          {closing ? (
            <div>
              <p>Closing of {closing.asOf}: stock {money(closing.stockValueCents)}, Inventory account {money(closing.inventoryBalanceCents)}, difference {money(closing.differenceCents)} ({closing.moveCount} stock moves).</p>
              {closing.complete === false && (
                <p>Incomplete: the stock value leaves out {(closing.incompleteItems || []).map(i => `${i.itemName} (${i.reason || `the history starts with ${i.quantity} units it has no value for`})`).join('; ')}.</p>
              )}
              <RowTable
                rowHeaderColumn={false}
                caption={(<>Stock at the closing of {closing.asOf}, by item and location</>)}
                rows={closing.rows}
                rowKey={r => `${r.itemId}|${r.locationId}`}
                tableClassName="mt-1 w-full"
                headRowClassName="text-left text-[var(--muted)]"
                bodyClassName=""
                columns={[
                  { header: "Item", headClassName: "", cell: (r) => r.itemName },
                  { header: "Location", headClassName: "", cell: (r) => r.locationId || 'No location' },
                  { header: "Quantity", align: 'right', headClassName: "", cell: (r) => r.quantity },
                  { header: "Value", align: 'right', headClassName: "", cell: (r) => money(r.valueCents) },
                ]}
              />
            </div>
          ) : <p className="text-[var(--muted)]">No stock closing yet: an owner takes one after closing and locking a period.</p>}
          <ul className="space-y-1">
            {line(report.books.ok, report.books.message)}
            {line(report.negative.ok, report.negative.message)}
            {closing && line(closing.fresh, closing.freshness)}
          </ul>
        </>
      )}
    </section>
  );
};
