import { runCommand } from '../../lib/runCommand';
import React, { useEffect, useState } from 'react';
import { formatCurrency } from '../../lib/utils';
import type { StockCheckReport } from '../../server/services/stockClosingService';
import { RowTable } from '../ui/RowTable';
import { useReportText } from './useReportText';

/** EG-7: the latest stock closing and the stock checks, read only (GET /api/v1/inventory/stock-closing). */
export const StockClosingPanel: React.FC<{ workspaceId: string | null | undefined; currency?: string }> = ({ workspaceId, currency }) => {
  const reportText = useReportText();
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
    <li className={ok ? 'text-[var(--muted)]' : 'text-[var(--text)] font-medium'}>{ok ? `${reportText('r.ok', 'OK:')} ` : `${reportText('r.check-2', 'Check:')} `}{text}</li>
  );
  return (
    <section aria-label={reportText('r.stock-closing-and-checks', 'Stock closing and checks')} className="text-xs p-3 rounded-lg border border-[var(--border)] space-y-2">
      <h3 className="font-semibold text-[var(--text)]">{reportText('r.stock-closing-and-checks', 'Stock closing and checks')}</h3>
      {!current && <p role="status" className="text-[var(--muted)]">{reportText('r.reading-the-stock-checks', 'Reading the stock checks…')}</p>}
      {current?.error && <p role="status">{reportText('r.stock-checks-not-available', 'Stock checks not available:')} {current.error}</p>}
      {report && (
        <>
          {closing ? (
            <div>
              <p>{reportText('r.closing-of', 'Closing of')} {closing.asOf}{reportText('r.stock-2', ': stock')} {money(closing.stockValueCents)}{reportText('r.inventory-account', ', Inventory account')} {money(closing.inventoryBalanceCents)}{reportText('r.difference', ', difference')} {money(closing.differenceCents)} ({closing.moveCount} {reportText('r.stock-moves-2', 'stock moves).')}</p>
              {closing.complete === false && (
                <p>{reportText('r.incomplete-the-stock-value-leaves-out', 'Incomplete: the stock value leaves out')} {(closing.incompleteItems || []).map(i => `${i.itemName} (${i.reason || `the history starts with ${i.quantity} units it has no value for`})`).join('; ')}.</p>
              )}
              <RowTable
                rowHeaderColumn={false}
                caption={(<>{reportText('r.stock-at-the-closing-of', 'Stock at the closing of')} {closing.asOf}{reportText('r.by-item-and-location', ', by item and location')}</>)}
                rows={closing.rows}
                rowKey={r => `${r.itemId}|${r.locationId}`}
                tableClassName="mt-1 w-full"
                headRowClassName="text-left text-[var(--muted)]"
                bodyClassName=""
                columns={[
                  { header: reportText('r.item', 'Item'), headClassName: "", cell: (r) => r.itemName },
                  { header: reportText('r.location', 'Location'), headClassName: "", cell: (r) => r.locationId || 'No location' },
                  { header: reportText('r.quantity', 'Quantity'), align: 'right', headClassName: "", cell: (r) => r.quantity },
                  { header: reportText('r.value', 'Value'), align: 'right', headClassName: "", cell: (r) => money(r.valueCents) },
                ]}
              />
            </div>
          ) : <p className="text-[var(--muted)]">{reportText('r.no-stock-closing-yet-an-owner-takes-one-after-cl', 'No stock closing yet: an owner takes one after closing and locking a period.')}</p>}
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
