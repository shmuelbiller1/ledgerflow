/**
 * A-46 / A-172: Printable delivery notes from sales orders and invoices in English ('en', LTR)
 * and Hebrew ('he', RTL), numbered in their own DN-YYYY-NNN series, with an option to hide or
 * show prices (default: goods only, no prices).
 */
import React, { useMemo, useState } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import {
  buildDeliveryNote,
  deliveryNoteColumns,
  nextDeliveryNoteNumber,
  type DeliveryNoteLanguage,
  type DeliveryNoteOrder,
} from '../../lib/deliveryNoteDocument';
import { orderDeliveries, type Delivery } from '../../lib/deliveries';
import { downloadCsv } from '../../lib/csvExport';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import type { Customer, Estimate, InventoryItem, Invoice, Transaction } from '../../types';
import ReportTableScroll from './ReportTableScroll';
import { printElementById } from '../../lib/printRoot';

interface SourceEntry {
  key: string;
  label: string;
  currency: string;
  order: DeliveryNoteOrder;
  delivery: Pick<Delivery, 'deliveryId' | 'date' | 'lines'>;
}

export default function DeliveryNotesReportView({ embedded = false }: { embedded?: boolean } = {}) {
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const userId = useAuthStore(s => s.user?.uid);
  return <DeliveryNotesContent key={JSON.stringify([userId, workspaceId])} embedded={embedded} />;
}

function DeliveryNotesContent({ embedded }: { embedded: boolean }) {
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const homeCurrency = (workspace?.currency || 'USD').toUpperCase();
  const truncated = useLedgerStore(s => s.truncatedCollections);
  const failed = useDataNeedsStore(s => s.failed);
  const { loading } = useLedgerCollections('estimates', 'invoices', 'inventory', 'customers');

  const estimates = useLedgerStore(s => s.estimates) as Estimate[];
  const invoices = useLedgerStore(s => s.invoices) as Invoice[];
  const inventory = useLedgerStore(s => s.inventory) as InventoryItem[];
  const customers = useLedgerStore(s => s.customers) as Customer[];
  const transactions = useLedgerStore(s => s.transactions) as Transaction[];

  const today = getLocalDateISO();
  const currentYear = today.slice(0, 4) || '2026';

  const itemsById = useMemo(
    () => new Map((inventory || []).filter(i => !workspaceId || !i.workspaceId || i.workspaceId === workspaceId).map(i => [i.id, i])),
    [inventory, workspaceId],
  );
  const customersById = useMemo(
    () => new Map((customers || []).filter(c => !workspaceId || !c.workspaceId || c.workspaceId === workspaceId).map(c => [c.id, c])),
    [customers, workspaceId],
  );

  const { sources, existingNumbers } = useMemo(() => {
    const list: SourceEntry[] = [];
    const numbers: string[] = [];

    for (const est of estimates || []) {
      if (workspaceId && est.workspaceId && est.workspaceId !== workspaceId) continue;
      if (est.status === 'declined') continue;
      const customer = est.customerId ? customersById.get(est.customerId) : undefined;
      const customerName = est.customerName || customer?.name || 'Customer';
      const currency = (customer?.currency || homeCurrency).toUpperCase();
      const orderNum = est.number || est.id;

      const orderDoc: DeliveryNoteOrder = {
        id: est.id,
        number: orderNum,
        customerName,
        ...(est.customerReference ? { customerReference: est.customerReference } : {}),
        lines: (est.lines || []).map(l => {
          const item = l.itemId ? itemsById.get(l.itemId) : undefined;
          return {
            description: l.description || item?.name || 'Item',
            unitPriceCents: l.unitPriceCents,
            ...(item?.measurementUnit ? { measurementUnit: item.measurementUnit } : {}),
          };
        }),
      };

      const recordedDeliveries = orderDeliveries(transactions || [], est.id);
      for (const del of recordedDeliveries) {
        if (del.lines.length > 0) {
          list.push({
            key: `order-delivery:${est.id}:${del.deliveryId}`,
            label: `Sales Order ${orderNum} · Delivery ${del.date} · ${customerName}`,
            currency,
            order: orderDoc,
            delivery: del,
          });
        }
      }

      if (orderDoc.lines.length > 0) {
        list.push({
          key: `order:${est.id}`,
          label: `Sales Order ${orderNum} · ${customerName}`,
          currency,
          order: orderDoc,
          delivery: {
            deliveryId: `dlv_${est.id}`,
            date: est.date || today,
            lines: (est.lines || []).map((l, position) => ({
              position,
              itemId: l.itemId || `line-${position}`,
              quantity: Number(l.quantity) || 0,
              entryId: `${est.id}_${position}`,
            })),
          },
        });
      }
    }

    for (const inv of invoices || []) {
      if (workspaceId && inv.workspaceId && inv.workspaceId !== workspaceId) continue;
      if (inv.status === 'void' || inv.status === 'cancelled' || inv.status === 'rejected') continue;
      const customer = inv.customerId ? customersById.get(inv.customerId) : undefined;
      const customerName = inv.customerName || customer?.name || 'Customer';
      const currency = (inv.currency || homeCurrency).toUpperCase();
      const invNum = inv.number || inv.id;
      const metaDn = typeof inv.metadata?.deliveryNoteNumber === 'string' ? inv.metadata.deliveryNoteNumber : undefined;
      if (metaDn) numbers.push(metaDn);

      const invItems = inv.items || [];
      if (invItems.length > 0) {
        const orderDoc: DeliveryNoteOrder = {
          id: inv.id,
          number: invNum,
          customerName,
          lines: invItems.map(l => {
            const item = l.itemId ? itemsById.get(l.itemId) : undefined;
            return {
              description: l.description || item?.name || 'Item',
              unitPriceCents: l.rateCents,
              ...(item?.measurementUnit ? { measurementUnit: item.measurementUnit } : {}),
              // A-112: the invoice line's recorded serials and lot print on the note; order and delivery lines record none
              ...((l.serialNumbers || []).length ? { serialNumbers: l.serialNumbers } : {}),
              ...(l.lotNumber ? { lotNumber: l.lotNumber } : {}),
            };
          }),
        };
        list.push({
          key: `invoice:${inv.id}`,
          label: `Invoice ${invNum} · ${customerName}`,
          currency,
          order: orderDoc,
          delivery: {
            deliveryId: `dlv_${inv.id}`,
            date: inv.date || inv.dueDate || today,
            lines: invItems.map((l, position) => ({
              position,
              itemId: l.itemId || l.id || `line-${position}`,
              quantity: Number(l.quantity) || 0,
              entryId: `${inv.id}_${position}`,
            })),
          },
        });
      }
    }

    return { sources: list, existingNumbers: numbers };
  }, [estimates, invoices, transactions, itemsById, customersById, workspaceId, homeCurrency, today]);

  const defaultNextNumber = useMemo(
    () => nextDeliveryNoteNumber(existingNumbers, currentYear),
    [existingNumbers, currentYear],
  );

  const [selectedKey, setSelectedKey] = useState<string>('');
  const [language, setLanguage] = useState<DeliveryNoteLanguage>('en');
  const [showPrices, setShowPrices] = useState<boolean>(false);
  const [customNumber, setCustomNumber] = useState<string>('');
  const [customDate, setCustomDate] = useState<string>('');

  const [search, setSearch] = useState('');
  const [sourceType, setSourceType] = useState('all');
  const filteredSources = useMemo(() => sources.filter(source =>
    (sourceType === 'all' || (sourceType === 'invoice' ? source.key.startsWith('invoice:') : source.key.startsWith('order'))) &&
    source.label.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())), [sources, sourceType, search]);
  const selected = filteredSources.find(s => s.key === selectedKey) || filteredSources[0];
  const effectiveNumber = customNumber.trim() || defaultNextNumber;
  const effectiveDate = customDate || selected?.delivery.date || today;

  const doc = useMemo(() => {
    if (!selected) return null;
    return buildDeliveryNote({
      order: selected.order,
      delivery: { ...selected.delivery, date: effectiveDate },
      number: effectiveNumber,
      company: workspace?.name || '',
      language,
      showPrices,
    });
  }, [selected, effectiveNumber, effectiveDate, workspace, language, showPrices]);

  const hasSerials = useMemo(() => (doc?.rows || []).some(r => r.serials), [doc]);
  const hasLots = useMemo(() => (doc?.rows || []).some(r => r.lot), [doc]);
  const columns = useMemo(
    () => deliveryNoteColumns(showPrices, language, { serials: hasSerials, lot: hasLots }),
    [showPrices, language, hasSerials, hasLots],
  );

  const partial = Boolean(
    truncated.estimates || truncated.invoices || truncated.inventory || truncated.customers ||
    failed.estimates || failed.invoices || failed.inventory || failed.customers,
  );

  const exportCsv = () => {
    if (!doc || !selected) return;
    downloadCsv(
      `delivery-note-${doc.number}.csv`,
      columns,
      doc.rows.map(r => {
        const base: Array<string | number> = [r.item, r.quantity];
        if (doc.showPrices) {
          base.push(
            r.unitPriceCents !== undefined ? (r.unitPriceCents / 100).toFixed(2) : '',
            r.amountCents !== undefined ? (r.amountCents / 100).toFixed(2) : '',
          );
        }
        if (hasSerials) base.push(r.serials || '');
        if (hasLots) base.push(r.lot || '');
        return base;
      }),
    );
  };

  return (
    <section aria-label="Delivery notes" className="p-4 space-y-4 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2" data-print-hide>
        <div>
          <h2>Delivery notes (EN / HE)</h2>
          <p className="text-sm text-[var(--muted)]">
            Printable delivery notes from sales orders and invoices, numbered in their own series ({defaultNextNumber}),
            in English or Hebrew, with prices hidden by default. Serials and lots print only when the source invoice
            line recorded them; delivery entries record none, so those notes show none.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => embedded ? window.print() : printElementById('delivery-note-sheet')}
            disabled={!doc}
            className="min-h-11 px-3 py-1.5 rounded border text-sm disabled:opacity-50"
          >
            Print delivery note
          </button>
          <button
            type="button"
            onClick={exportCsv}
            disabled={!doc}
            className="min-h-11 px-3 py-1.5 rounded border text-sm disabled:opacity-50"
          >
            Download CSV
          </button>
        </div>
      </div>

      {loading && <p role="status" className="text-sm text-[var(--muted)]">Loading orders and invoices…</p>}
      {partial && (
        <p role="alert" className="text-sm text-amber-700">
          Orders, invoices, items or customers are only partly loaded; documents outside the loaded list are not shown.
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3" data-print-hide>
        <label className="flex flex-col gap-1 text-sm">Find source document
          <input aria-label="Find source document" dir="auto" value={search} onChange={event => setSearch(event.target.value)}
            className="min-h-11 max-w-full border rounded px-3 bg-[var(--panel)] text-[var(--text)]" />
        </label>
        <label className="flex flex-col gap-1 text-sm">Source type
          <select aria-label="Source type" value={sourceType} onChange={event => setSourceType(event.target.value)}
            className="min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]">
            <option value="all">All sources</option><option value="order">Sales orders and deliveries</option><option value="invoice">Invoices</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Source document
          <select
            aria-label="Source document"
            disabled={!filteredSources.length}
            value={selected?.key || ''}
            onChange={e => setSelectedKey(e.target.value)}
            className="min-h-11 max-w-full border rounded px-3 bg-[var(--panel)] text-[var(--text)]"
          >
            {!filteredSources.length && <option value="">No matching sources</option>}
            {filteredSources.map(s => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Delivery note language
          <select
            aria-label="Delivery note language"
            value={language}
            onChange={e => setLanguage(e.target.value as DeliveryNoteLanguage)}
            className="min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]"
          >
            <option value="en">English (LTR)</option>
            <option value="he">עברית / Hebrew (RTL)</option>
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Delivery note number
          <input
            aria-label="Delivery note number"
            type="text"
            value={customNumber}
            placeholder={defaultNextNumber}
            onChange={e => setCustomNumber(e.target.value)}
            className="min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)] w-44"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Delivery date
          <input
            aria-label="Delivery date"
            type="date"
            value={effectiveDate}
            onChange={e => setCustomDate(e.target.value)}
            className="min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]"
          />
        </label>

        <label className="flex items-center gap-2 min-h-11 text-sm text-[var(--text)]">
          <input
            aria-label="Show prices on delivery note"
            type="checkbox"
            checked={showPrices}
            onChange={e => setShowPrices(e.target.checked)}
          />
          Show prices on delivery note
        </label>
      </div>

      {!doc && !loading && (
        <p className="text-sm text-[var(--muted)]">
          {sources.length ? 'No matching source documents. Clear the search or choose All sources.' : 'No sales orders or invoices with item lines are loaded in this workspace yet.'}
        </p>
      )}

      {doc && selected && (
        <article
          id="delivery-note-sheet"
          data-print-root={embedded ? undefined : ''}
          aria-label="Printable delivery note"
          dir={doc.direction}
          className="border border-[var(--line)] rounded p-5 space-y-4 bg-[var(--panel)]"
        >
          <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--line)] pb-3">
            <div>
              <h3 className="text-lg font-semibold">{doc.labels.title}</h3>
              <p className="text-sm text-[var(--muted)]">
                {doc.labels.number}: <span className="font-mono">{doc.number}</span>
                {' · '}
                {doc.labels.date}: {doc.date}
              </p>
              <p className="text-sm text-[var(--muted)]">
                {doc.labels.order}: <span className="font-mono">{doc.order}</span>
                {doc.customerReference ? ` · ${doc.labels.customerReference}: ${doc.customerReference}` : ''}
              </p>
            </div>
            <div>
              <div className="text-xs text-[var(--muted)]">{doc.labels.customer}</div>
              <div className="font-medium"><bdi>{doc.customer}</bdi></div>
            </div>
          </header>

          <ReportTableScroll>
            <table className="w-full text-sm border-collapse">
              <caption className="sr-only">{doc.labels.title} {doc.number}</caption>
              <thead>
                <tr className="border-b">
                  <th scope="col" className="py-2 px-2 text-start">#</th>
                  {columns.map(col => (
                    <th key={col} scope="col" className="py-2 px-2 text-start">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {doc.rows.map(row => (
                  <tr key={`${row.line}:${row.item}`} className="border-b">
                    <td className="py-2 px-2 tabular-nums">{row.line}</td>
                    <td className="py-2 px-2"><bdi>{row.item}</bdi></td>
                    <td className="py-2 px-2 tabular-nums font-medium">
                      {row.quantity}{row.unit ? ` ${row.unit}` : ''}
                    </td>
                    {doc.showPrices && (
                      <>
                        <td className="py-2 px-2 tabular-nums">
                          {row.unitPriceCents !== undefined ? formatCurrency(row.unitPriceCents, selected.currency) : '—'}
                        </td>
                        <td className="py-2 px-2 tabular-nums">
                          {row.amountCents !== undefined ? formatCurrency(row.amountCents, selected.currency) : '—'}
                        </td>
                      </>
                    )}
                    {hasSerials && <td className="py-2 px-2"><bdi>{row.serials || '\u2014'}</bdi></td>}
                    {hasLots && <td className="py-2 px-2"><bdi>{row.lot || '\u2014'}</bdi></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </ReportTableScroll>

          {doc.showPrices && doc.totalCents !== undefined ? (
            <div className="text-sm font-semibold">
              {doc.labels.total}: {formatCurrency(doc.totalCents, selected.currency)}
            </div>
          ) : (
            <p className="text-xs text-[var(--muted)]">{doc.labels.noPrices}</p>
          )}

          <footer className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-[var(--line)] text-sm text-[var(--muted)]">
            <div>{doc.signatureLine.receivedBy}: ________________________</div>
            <div>{doc.signatureLine.receivedDate}: ________________________</div>
          </footer>
        </article>
      )}
    </section>
  );
}
