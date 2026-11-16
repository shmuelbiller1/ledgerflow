/**
 * Goods sent back (BF-07), in the vendor credit form: for each stock line of the credited bill, how
 * many go back to the vendor. Shows what the line brought in and what earlier credits sent back;
 * more than is left is refused before saving (src/lib/vendorReturns.ts). Offers the credit at the
 * lines' cost for what goes back; the amount stays the user's to change.
 */
import React from 'react';
import { formatCurrency } from '../../lib/utils';
import { returnValue, type ReturnableBillLine } from '../../lib/vendorReturns';
import { RowTable } from '../ui/RowTable';

export default function VendorReturnFields({ lines, value, onChange, currency, onUseCost }: {
  lines: ReturnableBillLine[];
  /** units typed per bill line */
  value: Record<number, string>;
  onChange: (next: Record<number, string>) => void;
  currency: string;
  onUseCost: (cents: number) => void;
}) {
  if (lines.length === 0) return null;
  const costCents = lines.reduce((s, l) => s + (Number(value[l.billLine]) > 0 ? returnValue(l, Number(value[l.billLine])) : 0), 0);
  return (
    <fieldset className="space-y-2 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
      <legend className="px-1 text-sm font-medium text-gray-700 dark:text-gray-300">Goods sent back</legend>
      <p className="text-xs text-gray-500">What goes back leaves stock at the bill line's cost. Leave 0 for a credit without goods (a rebate or a price correction).</p>
            <RowTable
        rowHeaderColumn={false}
        caption={(<>Stock lines of the credited bill</>)}
        rows={lines}
        rowKey={line => line.billLine}
        headRowClassName="text-gray-500"
        columns={[
          { header: "Item", className: "font-semibold py-1", cell: (line) => <bdi>{line.description || line.itemId}</bdi> },
          { header: "Bought", align: 'right', className: "font-semibold py-1 font-mono", cell: (line) => line.quantity },
          { header: "Already back", align: 'right', className: "font-semibold py-1 font-mono", cell: (line) => line.returned },
          { header: "Sent back now", align: 'right', className: "font-semibold py-1 w-24 pl-2", cell: (line) => <input aria-label={`How many of ${line.description || line.itemId} go back`} inputMode="decimal" value={value[line.billLine] ?? ''} placeholder="0"
                  disabled={line.returned >= line.quantity}
                  onChange={e => onChange({ ...value, [line.billLine]: e.target.value })}
                  className="w-full p-1.5 text-right font-mono bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg" /> },
        ]}
      />
      {costCents > 0 && (
        <button type="button" onClick={() => onUseCost(costCents)} className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">
          Credit their cost: {formatCurrency(costCents, currency)}
        </button>
      )}
    </fieldset>
  );
}
