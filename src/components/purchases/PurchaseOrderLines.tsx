import { useId, useState } from 'react';
import { X } from 'lucide-react';
import type { PurchaseOrder } from '../../types';
import { addOrderItem, changeOrderItem, removeOrderItem } from '../../lib/purchaseOrders';
import { inBackground } from '../../lib/inBackground';
import { formatCurrency } from '../../lib/utils';
import InlineEdit from '../ui/InlineEdit';
import ReportSchedule from '../reporting/ReportSchedule';

/** An order's lines, editable in place while nothing was received or billed (I-22). */
export default function PurchaseOrderLines({ po, canEdit, suggestions, onSave }: {
  po: PurchaseOrder;
  canEdit: boolean;
  suggestions: string[];
  onSave: (po: PurchaseOrder, changes: Partial<PurchaseOrder>, message: string) => Promise<boolean>;
}) {
  const ids = useId();
  const [desc, setDesc] = useState('');
  const [qty, setQty] = useState('1');
  const [price, setPrice] = useState('');
  const positive = (x: string | number) => (Number(x) > 0 ? null : 'Enter more than 0');
  const add = async () => {
    const quantity = Number(qty);
    const unitPriceCents = Math.round(Number(price) * 100);
    if (!desc.trim() || !(quantity > 0) || !(unitPriceCents > 0)) return;
    const saved = await onSave(po, addOrderItem(po, { id: crypto.randomUUID(), description: desc.trim(), quantity, unitPriceCents, receivedQuantity: 0 }), 'Line added');
    if (saved) { setDesc(''); setQty('1'); setPrice(''); }
  };
  const cell = 'py-1.5 px-2';
  return (
    <ReportSchedule
      caption={<>Lines of {po.poNumber}</>}
      captionClassName="sr-only"
      tableClassName="w-full text-left text-xs mt-2"
      headRowClassName="text-[var(--muted)]"
      bodyClassName=""
      rows={po.items}
      rowKey={(item) => item.id}
      rowHeaderClassName="font-normal text-start"
      footer={
        canEdit && (
          <tr
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                inBackground(add());
              }
            }}
          >
            <td className={cell}>
              <input
                aria-label={`New line on ${po.poNumber}`}
                placeholder="Add a line…"
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                list={`${ids}-items`}
                className="w-full p-1 bg-[var(--surface)] border border-[var(--line)] rounded-md"
              />
              <datalist id={`${ids}-items`}>
                {suggestions.map((x) => (
                  <option key={x} value={x} />
                ))}
              </datalist>
            </td>
            <td className={cell}>
              <input
                aria-label={`Quantity of the new line on ${po.poNumber}`}
                type="number"
                min="0"
                step="any"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                className="w-full p-1 bg-[var(--surface)] border border-[var(--line)] rounded-md text-right"
              />
            </td>
            <td className={cell}>
              <input
                aria-label={`Unit price of the new line on ${po.poNumber}`}
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="w-full p-1 bg-[var(--surface)] border border-[var(--line)] rounded-md text-right font-mono"
              />
            </td>
            <td colSpan={3} className={`${cell} text-[var(--muted)]`}>
              Enter adds the line
            </td>
          </tr>
        )
      }
      columns={[
        {
          header: 'Item',
          headClassName: cell,
          className: cell,
          cell: (item) => (
            <InlineEdit
              value={item.description}
              label={`Item on ${po.poNumber}`}
              canEdit={canEdit}
              suggestions={suggestions}
              validate={(x) => (String(x).trim() ? null : 'Describe the item')}
              onSave={(x) => onSave(po, changeOrderItem(po, item.id, { description: String(x) }), 'Line saved')}
            />
          ),
        },
        {
          header: 'Quantity',
          headClassName: `${cell} text-right`,
          className: `${cell} text-right font-mono`,
          cell: (item) => (
            <InlineEdit
              kind="number"
              value={item.quantity}
              label={`Quantity of ${item.description}`}
              canEdit={canEdit}
              validate={positive}
              onSave={(x) => onSave(po, changeOrderItem(po, item.id, { quantity: Number(x) }), 'Quantity saved')}
            />
          ),
        },
        {
          header: 'Unit price',
          headClassName: `${cell} text-right`,
          className: `${cell} text-right font-mono`,
          cell: (item) => (
            <InlineEdit
              kind="money"
              value={item.unitPriceCents}
              display={formatCurrency(item.unitPriceCents, po.currency)}
              label={`Unit price of ${item.description}`}
              canEdit={canEdit}
              validate={positive}
              onSave={(x) => onSave(po, changeOrderItem(po, item.id, { unitPriceCents: Number(x) }), 'Price saved')}
            />
          ),
        },
        { header: 'Received', headClassName: `${cell} text-right`, className: `${cell} text-right font-mono`, cell: (item) => item.receivedQuantity || 0 },
        {
          header: 'Total',
          headClassName: `${cell} text-right`,
          className: `${cell} text-right font-mono font-bold`,
          cell: (item) => formatCurrency(item.totalCents, po.currency),
        },
        {
          header: <span className="sr-only">Remove</span>,
          headClassName: cell,
          className: `${cell} text-right`,
          cell: (item) =>
            canEdit &&
            po.items.length > 1 && (
              <button
                type="button"
                onClick={() => onSave(po, removeOrderItem(po, item.id), 'Line removed')}
                className="p-1 text-[var(--muted)] hover:text-[var(--neg)]"
                aria-label={`Remove ${item.description}`}
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            ),
        },
      ]}
    />
  );
}
