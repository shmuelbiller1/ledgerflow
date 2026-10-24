/**
 * A-63 / A-170: Landed cost preview on receipts, plus A-79 / A-171 barcode scanning on receipts.
 * Spreads freight, duty and handling across a purchase receipt's lines (or a custom/scanned
 * receipt draft) by line value or by quantity using BigInt largest-remainder allocation so the
 * allocated extra cents always sum to the exact extra cost.
 *
 * EG-6 (BF-04): below the preview, owners and accountants post it (LandedCostPostPanel: the server shows what will
 * post, then posts it). The preview itself sends nothing.
 */
import React, { useMemo, useRef, useState } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import {
  landedCostPreview,
  landedCostProblem,
  type LandedCostLine,
  type SpreadBasis,
} from '../../lib/landedCostPreview';
import { findItemByBarcode, isScannerBurst, readScan } from '../../lib/barcodeScan';
import { downloadCsv } from '../../lib/csvExport';
import { formatCurrency } from '../../lib/utils';
import type { Bill, ChartAccount, InventoryItem, Vendor } from '../../types';
import ReportTableScroll from './ReportTableScroll';
import LandedCostPostPanel from './LandedCostPostPanel';
import { useCurrentRole } from '../../hooks/useCurrentRole';

interface ReceiptOption {
  key: string;
  label: string;
  currency: string;
  date: string;
  refNumber: string;
  vendorName: string;
  lines: Array<LandedCostLine & { sku?: string }>;
}

const toCents = (text: string): number => {
  const cleaned = text.trim().replace(/,/g, '');
  if (!cleaned) return 0;
  const num = Number(cleaned);
  return Number.isFinite(num) ? Math.round(num * 100) : -1;
};

export default function LandedCostPreviewReportView() {
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const homeCurrency = (workspace?.currency || 'USD').toUpperCase();
  const truncated = useLedgerStore(s => s.truncatedCollections);
  const failed = useDataNeedsStore(s => s.failed);
  const { loading } = useLedgerCollections('bills', 'inventory', 'vendors');

  const bills = useLedgerStore(s => s.bills) as Bill[];
  const inventory = useLedgerStore(s => s.inventory) as InventoryItem[];
  const vendors = useLedgerStore(s => s.vendors) as Vendor[];
  const accounts = useLedgerStore(s => s.accounts) as ChartAccount[];
  const role = useCurrentRole();
  const canPost = role === 'owner' || role === 'accountant';

  const wsItems = useMemo(
    () => (inventory || []).filter(i => !workspaceId || !i.workspaceId || i.workspaceId === workspaceId),
    [inventory, workspaceId],
  );
  const itemsById = useMemo(() => new Map(wsItems.map(i => [i.id, i])), [wsItems]);
  const vendorsById = useMemo(
    () => new Map((vendors || []).filter(v => !workspaceId || !v.workspaceId || v.workspaceId === workspaceId).map(v => [v.id, v])),
    [vendors, workspaceId],
  );

  const receipts = useMemo<ReceiptOption[]>(() => {
    const out: ReceiptOption[] = [];
    for (const bill of bills || []) {
      if (workspaceId && bill.workspaceId && bill.workspaceId !== workspaceId) continue;
      if (bill.status === 'void' || bill.status === 'cancelled' || bill.status === 'rejected') continue;
      const vendorName = bill.vendorName || vendorsById.get(bill.vendorId)?.name || bill.vendorId || 'Vendor';
      const billCurrency = (bill.currency || homeCurrency).toUpperCase();
      const lines: Array<LandedCostLine & { sku?: string }> = [];
      for (const [idx, split] of (bill.splits || []).entries()) {
        if (!split.itemId || split.landedCost) continue;
        const item = itemsById.get(split.itemId);
        const quantity = Number(split.quantity) || 0;
        if (quantity <= 0) continue;
        const unitCostCents = Math.round((Number(split.amountCents) || 0) / quantity);
        lines.push({
          id: `${bill.id}:${idx}:${split.itemId}`,
          description: item?.name || split.description || split.itemId,
          quantity,
          unitCostCents,
          ...(item?.sku ? { sku: item.sku } : {}),
        });
      }
      if (lines.length > 0) {
        const refNumber = bill.number || bill.id;
        const date = bill.date || bill.issueDate || bill.dueDate || '';
        out.push({
          key: bill.id,
          label: `${refNumber} · Receipt ${date} · ${vendorName}`,
          currency: billCurrency,
          date,
          refNumber,
          vendorName,
          lines,
        });
      }
    }
    return out;
  }, [bills, workspaceId, vendorsById, itemsById, homeCurrency]);

  const [selectedKey, setSelectedKey] = useState<string>('');
  const [basis, setBasis] = useState<SpreadBasis>('value');
  const [extraInput, setExtraInput] = useState<string>('0');
  const [scannedLines, setScannedLines] = useState<Array<LandedCostLine & { sku?: string }>>([]);
  const [scanInput, setScanInput] = useState<string>('');
  const [scanNotice, setScanNotice] = useState<string | null>(null);
  const keystrokeTimes = useRef<number[]>([]);

  const selectedReceipt = receipts.find(r => r.key === selectedKey) || (selectedKey === '__custom__' ? undefined : receipts[0]);
  const activeCurrency = selectedReceipt?.currency || homeCurrency;

  const activeLines = useMemo(() => {
    const base = selectedReceipt ? selectedReceipt.lines.map(l => ({ ...l })) : [];
    for (const sl of scannedLines) {
      const existing = base.find(b => b.id === sl.id && b.unitCostCents === sl.unitCostCents);
      if (existing) existing.quantity += sl.quantity;
      else base.push({ ...sl });
    }
    return base;
  }, [selectedReceipt, scannedLines]);

  const parsedExtraCents = useMemo(() => toCents(extraInput), [extraInput]);

  const problem = useMemo(() => {
    if (parsedExtraCents < 0) return 'Freight, duty and handling cannot be negative.';
    if (activeLines.length === 0) return 'Select a purchase receipt or scan an item barcode to preview landed cost.';
    return landedCostProblem(activeLines, parsedExtraCents, basis);
  }, [activeLines, parsedExtraCents, basis]);

  const result = useMemo(
    () => (problem ? null : landedCostPreview(activeLines, parsedExtraCents, basis)),
    [activeLines, parsedExtraCents, basis, problem],
  );
  const preview = result && result.ok ? result.preview : null;

  const handleScan = () => {
    const scan = readScan(scanInput);
    const burst = isScannerBurst(keystrokeTimes.current);
    keystrokeTimes.current = [];
    if (!scan.ok) {
      setScanNotice(scan.reason);
      return;
    }
    const match = findItemByBarcode(wsItems, scan.code);
    if (match.status === 'none') {
      setScanNotice(`No item in this workspace has barcode “${scan.code}”.`);
      return;
    }
    if (match.status === 'ambiguous') {
      setScanNotice(`More than one item uses barcode “${scan.code}” (${match.items.map(i => i.name).join(', ')}) — disambiguate the SKU first.`);
      return;
    }
    const item = match.item;
    setScannedLines(prev => {
      const existing = prev.find(p => p.id === item.id);
      if (existing) {
        return prev.map(p => (p.id === item.id ? { ...p, quantity: p.quantity + 1 } : p));
      }
      return [
        ...prev,
        {
          id: item.id,
          description: item.name,
          quantity: 1,
          unitCostCents: item.unitCostCents || 0,
          ...(item.sku ? { sku: item.sku } : {}),
        },
      ];
    });
    setScanInput('');
    setScanNotice(`Added 1 × ${item.name} (${scan.code})${burst ? ' via scanner' : ''} to the receipt preview.`);
  };

  const partial = Boolean(
    truncated.bills || truncated.inventory || truncated.vendors ||
    failed.bills || failed.inventory || failed.vendors,
  );

  const exportCsv = () => {
    if (!preview) return;
    downloadCsv(
      `landed-cost-preview-${selectedReceipt?.refNumber || 'draft'}.csv`,
      ['Item', 'SKU', 'Quantity', 'Unit Cost Before', 'Goods Value', 'Allocated Freight & Duty', 'Landed Total', 'Landed Unit Cost', 'Currency'],
      preview.lines.map((line) => {
        const meta = activeLines.find(a => a.id === line.id);
        return [
          line.description,
          meta?.sku || '',
          line.quantity,
          (line.unitCostCents / 100).toFixed(2),
          (line.goodsCents / 100).toFixed(2),
          (line.allocatedCents / 100).toFixed(2),
          (line.landedCents / 100).toFixed(2),
          (line.landedUnitCents / 100).toFixed(2),
          activeCurrency,
        ];
      }),
    );
  };

  return (
    <section aria-label="Landed cost preview" className="p-4 space-y-4 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2>Landed cost preview on receipts</h2>
          <p className="text-sm text-[var(--muted)]">
            Spread freight, duty and handling across receipt lines by value or by quantity. The preview posts nothing;
            owners and accountants can post it below (Inventory, or cost of goods sold for units already sold).
          </p>
        </div>
        <button
          type="button"
          onClick={exportCsv}
          disabled={!preview || preview.lines.length === 0}
          className="px-3 py-1.5 rounded border text-sm disabled:opacity-50"
        >
          Download CSV
        </button>
      </div>

      {loading && <p role="status" className="text-sm text-[var(--muted)]">Loading receipts and items…</p>}
      {partial && (
        <p role="alert" className="text-sm text-amber-700">
          Bills, items or vendors are only partly loaded; receipts outside the loaded list are not shown.
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3" data-print-hide>
        <label className="flex flex-col gap-1 text-sm">
          Receipt source
          <select
            aria-label="Receipt source"
            value={selectedReceipt?.key || (selectedKey === '__custom__' ? '__custom__' : '')}
            onChange={e => {
              setSelectedKey(e.target.value);
              setScannedLines([]);
            }}
            className="min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]"
          >
            {receipts.map(r => (
              <option key={r.key} value={r.key}>{r.label} ({r.currency})</option>
            ))}
            <option value="__custom__">Draft receipt (scan or add items)</option>
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Spread basis
          <select
            aria-label="Spread basis"
            value={basis}
            onChange={e => setBasis(e.target.value as SpreadBasis)}
            className="min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]"
          >
            <option value="value">By line value</option>
            <option value="quantity">By quantity</option>
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Freight, duty and handling ({activeCurrency})
          <input
            aria-label="Freight, duty and handling"
            type="text"
            inputMode="decimal"
            value={extraInput}
            onChange={e => setExtraInput(e.target.value)}
            className="min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)] w-44"
          />
        </label>

        <div className="flex items-end gap-2">
          <label className="flex flex-col gap-1 text-sm">
            Scan barcode for receipt
            <input
              aria-label="Scan barcode for receipt"
              type="text"
              placeholder="Scan or type SKU"
              value={scanInput}
              onChange={e => {
                keystrokeTimes.current.push(Date.now());
                setScanInput(e.target.value);
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleScan();
                }
              }}
              className="min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)] w-48"
            />
          </label>
          <button
            type="button"
            onClick={handleScan}
            className="min-h-11 px-3 rounded border text-sm"
          >
            Add scanned item
          </button>
        </div>
      </div>

      {scanNotice && (
        <p role="status" className="text-sm text-[var(--muted)]">{scanNotice}</p>
      )}

      {problem && (
        <p role="alert" className="text-sm text-amber-700">{problem}</p>
      )}

      {preview && preview.lines.length > 0 && (
        <>
          <div className="text-sm text-[var(--muted)]">
            Goods value: <strong>{formatCurrency(preview.goodsCents, activeCurrency)}</strong>
            {' · '}Freight, duty &amp; handling: <strong>{formatCurrency(preview.extraCostCents, activeCurrency)}</strong>
            {' · '}Landed total: <strong>{formatCurrency(preview.landedCents, activeCurrency)}</strong>
          </div>
          <ReportTableScroll>
            <table className="w-full text-sm border-collapse">
              <caption className="sr-only">Landed cost allocation preview</caption>
              <thead>
                <tr className="border-b text-left">
                  <th scope="col" className="py-2 pr-3">Item</th>
                  <th scope="col" className="py-2 pr-3">SKU</th>
                  <th scope="col" className="py-2 pr-3 text-right">Quantity</th>
                  <th scope="col" className="py-2 pr-3 text-right">Unit cost before</th>
                  <th scope="col" className="py-2 pr-3 text-right">Goods value</th>
                  <th scope="col" className="py-2 pr-3 text-right">Allocated freight/duty</th>
                  <th scope="col" className="py-2 pr-3 text-right">Landed line total</th>
                  <th scope="col" className="py-2 text-right">Landed unit cost</th>
                </tr>
              </thead>
              <tbody>
                {preview.lines.map((line) => {
                  const meta = activeLines.find(a => a.id === line.id);
                  return (
                    <tr key={`${line.id}:${line.unitCostCents}`} className="border-b">
                      <td className="py-2 pr-3"><bdi>{line.description}</bdi></td>
                      <td className="py-2 pr-3 font-mono text-xs">{meta?.sku || '—'}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{line.quantity}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{formatCurrency(line.unitCostCents, activeCurrency)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{formatCurrency(line.goodsCents, activeCurrency)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{formatCurrency(line.allocatedCents, activeCurrency)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{formatCurrency(line.landedCents, activeCurrency)}</td>
                      <td className="py-2 text-right tabular-nums font-medium">{formatCurrency(line.landedUnitCents, activeCurrency)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ReportTableScroll>
        </>
      )}

      {canPost && workspaceId && (
        <LandedCostPostPanel
          key={workspaceId}
          workspaceId={workspaceId}
          currency={homeCurrency}
          bills={(bills || []).filter(b => !workspaceId || !b.workspaceId || b.workspaceId === workspaceId)}
          accounts={(accounts || []).filter(a => !a.workspaceId || a.workspaceId === workspaceId)}
          receipts={receipts.map(r => ({ key: r.key, label: r.label }))}
          defaultReceiptId={selectedReceipt?.key}
        />
      )}
    </section>
  );
}
