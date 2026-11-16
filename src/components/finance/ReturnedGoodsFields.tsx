/**
 * Goods returned (BF-06), in the customer credit note form: for each stock line of the credited
 * invoice, how many came back. Shows what was sold and what earlier returns took back; more than is
 * left is refused before saving (src/lib/salesReturns.ts) and again by the server. Offers the credit
 * at the invoice's price for what came back; the amount stays the user's to change.
 */
import React from 'react';
import { formatCurrency } from '../../lib/utils';
import type { ReturnableLine } from '../../lib/salesReturns';
import { RowTable } from '../ui/RowTable';

export default function ReturnedGoodsFields({ lines, value, onChange, currency, onUsePrice }: {
  lines: ReturnableLine[];
  /** quantity typed per invoice line id */
  value: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  currency: string;
  /** fill the credit amount with the price of what came back (cents) */
  onUsePrice: (cents: number) => void;
}) {
  if (lines.length === 0) return null;
  const priceCents = lines.reduce((s, l) => s + Math.round((Number(value[l.invoiceLineId]) || 0) * l.unitPriceCents), 0);
  return (
    <fieldset className="space-y-2 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
      <legend className="px-1 text-sm font-medium text-gray-700 dark:text-gray-300">Goods returned</legend>
      <p className="text-xs text-gray-500">What came back goes back into stock at the cost it left at. Leave 0 for a credit without goods (a discount or a price correction).</p>
            <RowTable
        rowHeaderColumn={false}
        caption={(<>Stock lines of the credited invoice</>)}
        rows={lines}
        rowKey={line => line.invoiceLineId}
        headRowClassName="text-gray-500"
        columns={[
          { header: "Item", className: "font-semibold py-1", cell: (line) => <bdi>{line.description}</bdi> },
          { header: "Sold", align: 'right', className: "font-semibold py-1 font-mono", cell: (line) => line.sold },
          { header: "Already back", align: 'right', className: "font-semibold py-1 font-mono", cell: (line) => line.returned },
          { header: "Came back now", align: 'right', className: "font-semibold py-1 w-24 pl-2", cell: (line) => <input aria-label={`How many of ${line.description} came back`} inputMode="decimal" value={value[line.invoiceLineId] ?? ''} placeholder="0"
                  disabled={line.returnable <= 0}
                  onChange={e => onChange({ ...value, [line.invoiceLineId]: e.target.value })}
                  className="w-full p-1.5 text-right font-mono bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg" /> },
        ]}
      />
      {priceCents > 0 && (
        <button type="button" onClick={() => onUsePrice(priceCents)} className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">
          Credit their price: {formatCurrency(priceCents, currency)}
        </button>
      )}
    </fieldset>
  );
}
