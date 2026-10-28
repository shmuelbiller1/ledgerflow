/**
 * The lines of a new quote (BF-08): what is sold, how many, and at what price. A line whose text is
 * a stock item's name or SKU is linked to that item (the same rule as invoice lines,
 * src/lib/invoiceLines.ts), so the order is later invoiced by quantity and each invoice lowers stock
 * and books the cost of exactly the units it bills. Any other text is a plain line with no stock.
 */
import React from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { customerPricer, lineAmountCents, setLineDescription } from '../../lib/invoiceLines';
import { useAuthStore } from '../../stores/useAuthStore';
import { blankEstimateLine, type EstimateLineDraft } from '../../lib/estimateLines';
import { formatCurrency, readAmountCents } from '../../lib/utils';

const input = 'w-full px-2 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white';

export function EstimateLinesEditor({ lines, onChange, currency, customerId }: { lines: EstimateLineDraft[]; onChange: (lines: EstimateLineDraft[]) => void; currency: string; customerId?: string }) {
  useLedgerCollections('inventory');
  const items = useLedgerStore(s => s.inventory || []);
  // M-11: the customer's price list, when they are on one
  const priceLists = useAuthStore(s => s.getCurrentWorkspace()?.priceLists);
  const pricer = customerPricer(priceLists, customerId);
  const change = (id: string, next: (line: EstimateLineDraft) => EstimateLineDraft) => onChange(lines.map(l => (l.id === id ? next(l) : l)));
  const total = lines.reduce((s, l) => s + l.amountCents, 0);

  return (
    <div className="space-y-2">
      <table className="w-full text-xs">
        <caption className="text-left text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Lines</caption>
        <thead>
          <tr className="text-[var(--muted)]">
            <th scope="col" className="text-left font-semibold py-1">Item or description</th>
            <th scope="col" className="text-right font-semibold py-1 w-20">Quantity</th>
            <th scope="col" className="text-right font-semibold py-1 w-28">Price</th>
            <th scope="col" className="text-right font-semibold py-1 w-28">Amount</th>
            <th scope="col" className="w-16"><span className="sr-only">Remove</span></th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, i) => (
            <tr key={line.id}>
              <td className="py-1 pr-2">
                <input aria-label={`Item or description, line ${i + 1}`} list="estimate-line-items" value={line.description} className={input}
                  onChange={e => change(line.id, l => {
                    const next = setLineDescription(l, e.target.value, items, pricer);
                    // a picked item (a service fills the price without linking) shows its price
                    return (next.itemId && next.itemId !== l.itemId) || (!next.itemId && next.rateCents !== l.rateCents) ? { ...next, priceText: (next.rateCents / 100).toFixed(2) } : next;
                  })} />
                {line.itemId && <span className="text-[10px] text-emerald-700 dark:text-emerald-400">Stock item: invoiced by quantity</span>}
              </td>
              <td className="py-1 px-1">
                <input aria-label={`Quantity, line ${i + 1}`} inputMode="decimal" value={line.quantityText} className={`${input} text-right font-mono`}
                  onChange={e => change(line.id, l => {
                    const quantity = Number(e.target.value);
                    return { ...l, quantityText: e.target.value, quantity, amountCents: l.rateCents < 0 ? 0 : lineAmountCents(quantity, l.rateCents) };
                  })} />
              </td>
              <td className="py-1 px-1">
                <input aria-label={`Price, line ${i + 1} (${currency})`} inputMode="decimal" value={line.priceText} className={`${input} text-right font-mono`}
                  onChange={e => change(line.id, l => {
                    // a half-typed or mistyped price ('1.2.3') is not a price yet: -1 keeps the line unsaveable, the box keeps typing
                    const rateCents = readAmountCents(e.target.value) ?? -1;
                    return { ...l, priceText: e.target.value, rateCents, amountCents: rateCents < 0 ? 0 : lineAmountCents(l.quantity, rateCents) };
                  })} />
              </td>
              <td className="py-1 px-1 text-right font-mono">{formatCurrency(line.amountCents, currency)}</td>
              <td className="py-1 pl-1 text-right">
                <button type="button" onClick={() => onChange(lines.filter(l => l.id !== line.id))} className="text-[var(--muted)] hover:underline">
                  Remove<span className="sr-only"> line {i + 1}</span>
                </button>
              </td>
            </tr>
          ))}
          <tr className="border-t border-slate-200 dark:border-slate-700 font-semibold">
            <td className="py-1" colSpan={3}>Total</td>
            <td className="py-1 px-1 text-right font-mono">{formatCurrency(total, currency)}</td>
            <td />
          </tr>
        </tbody>
      </table>
      <datalist id="estimate-line-items">
        {items.map(item => <option key={item.id} value={item.name}>{item.sku ? `[${item.sku}] ` : ''}{item.name} · {formatCurrency(item.unitPriceCents, currency)}</option>)}
      </datalist>
      <button type="button" onClick={() => onChange([...lines, blankEstimateLine()])} className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">
        Add a line
      </button>
    </div>
  );
}
