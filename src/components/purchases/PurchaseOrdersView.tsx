import { useDialog } from '../../hooks/useDialog';
import React, { useId, useMemo, useState } from 'react';
import { ShoppingCart, Plus, ShieldCheck, X, Check, CheckCircle2, FileText, Ban, Printer, Trash2, ChevronRight, ChevronDown, Copy } from 'lucide-react';
import InlineEdit from '../ui/InlineEdit';
import PdfPreviewModal from '../ui/PdfPreviewModal';
import type { Bill, GoodsReceipt, PurchaseOrder, PurchaseOrderItem, Vendor } from '../../types';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useCollection } from '../../hooks/useCollection';
import { useEntityOperations } from '../../hooks/useEntityOperations';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { performThreeWayMatch } from '../../lib/threeWayMatchEngine';
import { lotExpiryProblem, lotProblem, normalizeLot, parseSerialList, serialListProblem } from '../../lib/serialNumbers';
import { addOrderItem, awaitingApproval, billLinesFromOrder, canChangeOrder, canDeleteOrder, canMoveDelivery, changeOrderItem, lastOrderLines, nextPoNumber, orderDecision, orderDecisionProblem, poOrderNeedsApproval, removeOrderItem, vendorsByOrders } from '../../lib/purchaseOrders';
import { normalizePoApproval } from '../../lib/invoiceApproval';
import { suggestionsFrom } from '../../lib/inlineEdit';
import { isArchivedParty } from '../../lib/contacts';
import { formatCurrency, formatDate, formatTzDate } from '../../lib/utils';
import BillModal from './BillModal';
import AttachmentsPanel from '../common/AttachmentsPanel';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';

/**
 * Purchase orders (saved in `purchaseOrders`), goods received against them, and turning an order
 * into a bill (BE-11): the bill form opens filled with the vendor and the received (or ordered)
 * lines; the bill is posted like any other bill, and the order is marked billed. The 3-way match
 * compares order, receipts and bill. Before, orders and receipts lived only in the open page.
 */

type Tab = 'pos' | 'match' | 'receipts';
interface DraftLine { key: string; desc: string; qty: string; unitPrice: string; itemId: string }

const newLine = (): DraftLine => ({ key: crypto.randomUUID(), desc: '', qty: '1', unitPrice: '', itemId: '' });
const inputClass = 'w-full p-2 bg-[var(--panel)] border border-[var(--line)] rounded-lg text-[var(--text)]';

export const PurchaseOrdersView: React.FC = () => {
  const bills = useLedgerStore(s => (s.bills || []) as Bill[]);
  const vendors = useLedgerStore(s => (s.vendors || []) as Vendor[]);
  const accounts = useLedgerStore(s => s.accounts || []);
  useLedgerCollections('bills', 'inventory', 'vendors');
  // J-08: an order line can be a stock item; the bill made from the order brings its units in
  const stockItems = (useLedgerStore(s => s.inventory) || []).filter(i => i.itemType !== 'service');
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const role = useCurrentRole();
  const canEdit = role === 'owner' || role === 'accountant' || role === 'bookkeeper';
  const myUid = useAuthStore(s => s.user?.uid) || '';
  const [declining, setDeclining] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState('');
  const { addEntity, updateEntity, deleteEntity } = useEntityOperations();
  const { data: purchaseOrders, loading } = useCollection<PurchaseOrder>('purchaseOrders', { orderByField: 'createdAt', orderDirection: 'desc', limit: 500 });
  const goodsReceipts = useMemo(() => purchaseOrders.flatMap(po => po.receipts || []), [purchaseOrders]);
  const matchSummary = useMemo(() => performThreeWayMatch(purchaseOrders, goodsReceipts, bills), [purchaseOrders, goodsReceipts, bills]);
  const ids = useId();
  const today = formatTzDate(new Date(), workspace?.timezone);

  const [activeTab, setActiveTab] = useState<Tab>('pos');
  const [isCreatingPO, setIsCreatingPO] = useState(false);
  const [poVendorId, setPoVendorId] = useState('');
  const [poExpectedDate, setPoExpectedDate] = useState(today);
  const [poItems, setPoItems] = useState<DraftLine[]>([newLine()]);
  // K-23 + A-120: evaluate PO approval threshold against the draft total in the workspace currency
  const draftPoTotalCents = useMemo(() => poItems.reduce((sum, l) => {
    const q = Number(l.qty);
    const p = Number(l.unitPrice);
    return sum + (q > 0 && p > 0 ? Math.round(q * Math.round(p * 100)) : 0);
  }, 0), [poItems]);
  const poRule = normalizePoApproval(workspace?.invoiceApproval);
  const asRequest = poOrderNeedsApproval(role, {
    totalAmountCents: draftPoTotalCents,
    settings: workspace?.invoiceApproval,
    currency: workspace?.currency || 'USD',
    workspaceCurrency: workspace?.currency || 'USD',
  });
  const [receivingPO, setReceivingPO] = useState<PurchaseOrder | null>(null);
  const [receivedCondition, setReceivedCondition] = useState<GoodsReceipt['items'][number]['condition']>('good');
  const [receivedQuantities, setReceivedQuantities] = useState<Record<string, number>>({});
  // A-112/A-113: serials, lot and expiry typed per stock line while receiving; saved onto the receipt's lines
  const [receivedSerials, setReceivedSerials] = useState<Record<string, string>>({});
  const [receivedLots, setReceivedLots] = useState<Record<string, string>>({});
  const [receivedExpiry, setReceivedExpiry] = useState<Record<string, string>>({});
  const [billingPO, setBillingPO] = useState<PurchaseOrder | null>(null);
  const [previewPO, setPreviewPO] = useState<PurchaseOrder | null>(null);
  const pdfWorkspaceId = useAuthStore(s => s.currentWorkspaceId);
  const [saving, setSaving] = useState(false);
  const [openOrders, setOpenOrders] = useState<Set<string>>(() => new Set());
  const vendorChoices = useMemo(() => vendorsByOrders(vendors.filter(v => !isArchivedParty(v)), purchaseOrders), [vendors, purchaseOrders]);
  const itemSuggestions = useMemo(() => suggestionsFrom(purchaseOrders.flatMap(po => po.items), i => i.description), [purchaseOrders]);
  const lastOrder = useMemo(() => (poVendorId ? lastOrderLines(purchaseOrders, poVendorId) : null), [purchaseOrders, poVendorId]);
  const linesEmpty = poItems.every(l => !l.desc.trim() && !l.unitPrice);
  const billFromOrder = useMemo<Partial<Bill> | undefined>(() => (billingPO
    ? { vendorId: billingPO.vendorId, vendorName: billingPO.vendorName, currency: billingPO.currency, splits: billLinesFromOrder(billingPO), metadata: { poId: billingPO.id, poNumber: billingPO.poNumber } }
    : undefined), [billingPO]);

  const setLine = (key: string, field: keyof Omit<DraftLine, 'key'>, value: string) =>
    setPoItems(lines => lines.map(l => (l.key === key ? { ...l, [field]: value } : l)));

  const handleSavePO = async () => {
    const vendor = vendors.find(v => v.id === poVendorId);
    if (!vendor || poItems.some(i => !i.desc.trim() || !(Number(i.unitPrice) > 0) || !(Number(i.qty) > 0))) return;
    const items: PurchaseOrderItem[] = poItems.map(line => {
      const quantity = Number(line.qty);
      const unitPriceCents = Math.round(Number(line.unitPrice) * 100);
      return { id: line.key, description: line.desc.trim(), quantity, unitPriceCents, totalCents: Math.round(quantity * unitPriceCents), receivedQuantity: 0, ...(line.itemId ? { itemId: line.itemId } : {}) };
    });
    setSaving(true);
    const poNumber = nextPoNumber(purchaseOrders, today.slice(0, 4));
    const saved = await addEntity('purchaseOrders', {
      poNumber, vendorId: vendor.id, vendorName: vendor.name, issueDate: today, expectedDeliveryDate: poExpectedDate,
      status: asRequest ? 'pending_approval' : 'approved', ...(asRequest ? { approvalStatus: 'pending' } : {}),
      items, totalAmountCents: items.reduce((sum, i) => sum + i.totalCents, 0),
      currency: workspace?.currency || 'USD', receipts: [],
    }, asRequest ? `Purchase order ${poNumber} sent for approval` : `Purchase order ${poNumber} saved`);
    setSaving(false);
    if (saved) {
      setIsCreatingPO(false);
      setPoVendorId('');
      setPoItems([newLine()]);
    }
  };

  const openReceive = (po: PurchaseOrder) => {
    setReceivingPO(po);
    setReceivedCondition('good');
    setReceivedQuantities(Object.fromEntries(po.items.map(i => [i.id, Math.max(0, i.quantity - (i.receivedQuantity || 0))])));
    setReceivedSerials({});
    setReceivedLots({});
    setReceivedExpiry({});
  };

  /** Why a received stock line's typed serials, lot or expiry cannot be saved, or null. */
  const receivedLineProblem = (poItemId: string): string | null =>
    serialListProblem(receivedSerials[poItemId] || '')
    || lotProblem(receivedLots[poItemId] || '')
    || lotExpiryProblem(receivedExpiry[poItemId] || '');

  const handleSaveGoodsReceipt = async () => {
    const po = receivingPO;
    if (!po) return;
    if (po.items.some(item => item.itemId && receivedLineProblem(item.id))) return;
    const receipt: GoodsReceipt = {
      id: crypto.randomUUID(),
      uid: useAuthStore.getState().user?.uid || '',
      workspaceId: po.workspaceId,
      receiptNumber: `GR-${po.poNumber}-${(po.receipts?.length || 0) + 1}`,
      poId: po.id,
      poNumber: po.poNumber,
      vendorId: po.vendorId,
      vendorName: po.vendorName,
      receivedDate: today,
      items: po.items.map(item => {
        const serials = item.itemId ? parseSerialList(receivedSerials[item.id] || '') : [];
        const lot = item.itemId ? normalizeLot(receivedLots[item.id] || '') : '';
        const expiry = item.itemId ? (receivedExpiry[item.id] || '').trim() : '';
        return {
          poItemId: item.id, description: item.description, quantityReceived: receivedQuantities[item.id] ?? 0,
          unitPriceCents: item.unitPriceCents, condition: receivedCondition,
          ...(serials.length ? { serialNumbers: serials } : {}),
          ...(lot ? { lotNumber: lot } : {}),
          ...(expiry ? { lotExpiryDate: expiry } : {}),
        };
      }),
      status: receivedCondition === 'good' ? 'verified' : 'discrepancy',
      createdAt: new Date().toISOString(),
    };
    const accepted = receivedCondition === 'rejected' ? 0 : 1;
    const items = po.items.map(item => ({ ...item, receivedQuantity: (item.receivedQuantity || 0) + accepted * (receivedQuantities[item.id] ?? 0) }));
    const complete = items.every(i => (i.receivedQuantity || 0) >= i.quantity);
    setSaving(true);
    await updateEntity('purchaseOrders', po.id, {
      items, receipts: [...(po.receipts || []), receipt],
      status: po.status === 'billed' ? 'billed' : complete ? 'received' : 'partially_received',
    }, `Goods received for ${po.poNumber}`);
    setSaving(false);
    setReceivingPO(null);
  };

  const handleBillSaved = async (bill: Partial<Bill>) => {
    const po = billingPO;
    if (!po) return;
    const ref = await addEntity('bills', { ...bill, metadata: { ...(bill.metadata || {}), poId: po.id, poNumber: po.poNumber } }, `Bill recorded from ${po.poNumber}`);
    if (ref) await updateEntity('purchaseOrders', po.id, { status: 'billed', billId: ref.id });
    setBillingPO(null);
  };

  // edit in place (I-22): vendor, delivery date and lines while nothing was received or billed
  const saveOrder = (po: PurchaseOrder, changes: Partial<PurchaseOrder>, message: string) => updateEntity('purchaseOrders', po.id, changes, message);
  const toggleOrder = (id: string) => setOpenOrders(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const deletePO = (po: PurchaseOrder) => {
    if (!window.confirm(`Delete purchase order ${po.poNumber}? This can't be undone.`)) return;
    deleteEntity('purchaseOrders', po.id, `${po.poNumber} deleted`);
  };

  const decideOrder = (po: PurchaseOrder, approve: boolean, reason?: string) =>
    updateEntity('purchaseOrders', po.id, { ...orderDecision(approve, myUid, new Date().toISOString(), reason), updatedAt: new Date().toISOString() },
      approve ? `${po.poNumber} approved` : `${po.poNumber} declined`);

  const cancelPO = (po: PurchaseOrder) => {
    if (!window.confirm(`Cancel purchase order ${po.poNumber}?`)) return;
    updateEntity('purchaseOrders', po.id, { status: 'cancelled' }, `${po.poNumber} cancelled`);
  };

  const tabs: [Tab, string][] = [
    ['pos', `Purchase orders (${purchaseOrders.length})`],
    ['match', `3-way match (${matchSummary.varianceCount} differences)`],
    ['receipts', `Goods received (${goodsReceipts.length})`],
  ];
  const statusClass = (status: string) => status === 'received' || status === 'billed' || status === 'matched'
    ? 'bg-[var(--pos)]/10 text-[var(--pos)]' : status === 'cancelled' ? 'bg-[var(--line)] text-[var(--muted)]' : 'bg-[var(--brass-soft)] text-[var(--text)]';

  const { dialogProps: newPoDialogProps } = useDialog(() => setIsCreatingPO(false), isCreatingPO);
  const { dialogProps: receiveDialogProps } = useDialog(() => setReceivingPO(null), !!receivingPO);

  return (
    <div className="space-y-6 max-w-6xl mx-auto p-4 sm:p-6 text-[var(--text)]" id="purchase-orders-view">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--line)] pb-5">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2"><ShoppingCart className="w-5 h-5" aria-hidden="true" /> Purchase orders</h1>
          <p className="text-sm text-[var(--muted)] mt-1">
            Order from a vendor, record what arrives, then turn the order into a bill. The 3-way match compares all three.
            {poRule.enabled && poRule.thresholdCents > 0 ? ` Orders above ${formatCurrency(poRule.thresholdCents, workspace?.currency)} require approval before receiving or billing.` : ''}
          </p>
        </div>
        {canEdit && (
          <button type="button" onClick={() => setIsCreatingPO(true)} id="create-po-btn"
            className="px-4 py-2 text-xs font-semibold bg-[var(--brass)] text-[var(--ink)] rounded-lg flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" aria-hidden="true" /> New purchase order
          </button>
        )}
      </div>

      <div className="flex gap-1 p-1 rounded-lg w-fit bg-[var(--panel)] border border-[var(--line)]" role="tablist" aria-label="Purchase orders">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={activeTab === id} onClick={() => setActiveTab(id)}
            className={`px-4 py-1.5 text-xs font-semibold rounded-md ${activeTab === id ? 'bg-[var(--surface)] text-[var(--text)]' : 'text-[var(--muted)]'}`}>
            {id === 'match' && <ShieldCheck className="w-3.5 h-3.5 inline mr-1" aria-hidden="true" />}{label}
          </button>
        ))}
      </div>

      {activeTab === 'pos' && (
        <div className="bg-[var(--surface)] border border-[var(--line)] rounded-lg overflow-x-auto">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">Purchase orders</caption>
            <thead className="border-b border-[var(--line)] text-[var(--muted)] font-semibold uppercase tracking-wider">
              <tr>
                <th scope="col" className="py-3 px-4">Number</th><th scope="col" className="py-3 px-4">Vendor</th>
                <th scope="col" className="py-3 px-4">Issued</th><th scope="col" className="py-3 px-4">Expected</th>
                <th scope="col" className="py-3 px-4 text-right">Amount</th><th scope="col" className="py-3 px-4 text-center">Status</th>
                <th scope="col" className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {loading && <tr><td colSpan={7} className="py-6 px-4 text-center text-[var(--muted)]">Loading…</td></tr>}
              {!loading && purchaseOrders.length === 0 && (
                <tr><td colSpan={7} className="py-10 px-4 text-center text-[var(--muted)]">No purchase orders yet.{canEdit ? ' Choose "New purchase order" to create one.' : ''}</td></tr>
              )}
              {purchaseOrders.map(po => (
                <React.Fragment key={po.id}>
                <tr>
                  <td className="py-3 px-4 font-mono font-bold">
                    <button type="button" onClick={() => toggleOrder(po.id)} aria-expanded={openOrders.has(po.id)} aria-label={`Lines of ${po.poNumber}`}
                      className="inline-flex items-center gap-1">
                      {openOrders.has(po.id) ? <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" /> : <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />}
                      {po.poNumber}
                    </button>
                  </td>
                  <td className="py-3 px-4">
                    <InlineEdit kind="select" value={po.vendorId} display={po.vendorName} label={`Vendor of ${po.poNumber}`}
                      options={vendorChoices.map(v => ({ value: v.id, label: v.name }))} canEdit={canEdit && canChangeOrder(po)}
                      onSave={x => { const v = vendors.find(vendor => vendor.id === x); return v ? saveOrder(po, { vendorId: v.id, vendorName: v.name }, 'Vendor changed') : undefined; }} />
                  </td>
                  <td className="py-3 px-4 font-mono">{formatDate(po.issueDate)}</td>
                  <td className="py-3 px-4 font-mono">
                    <InlineEdit kind="date" value={po.expectedDeliveryDate?.slice(0, 10)} display={po.expectedDeliveryDate ? formatDate(po.expectedDeliveryDate) : undefined}
                      label={`Expected delivery of ${po.poNumber}`} placeholder="Add date" canEdit={canEdit && canMoveDelivery(po)}
                      validate={x => (po.issueDate && String(x) < po.issueDate.slice(0, 10) ? 'Delivery can\'t be before the order date' : null)}
                      onSave={x => saveOrder(po, { expectedDeliveryDate: String(x) }, 'Expected delivery saved')} />
                  </td>
                  <td className="py-3 px-4 text-right font-mono font-bold">{formatCurrency(po.totalAmountCents, po.currency)}</td>
                  <td className="py-3 px-4 text-center"><span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${statusClass(po.status)}`}>{po.status.replace('_', ' ')}</span></td>
                  <td className="py-3 px-4 text-right whitespace-nowrap space-x-2">
                    {awaitingApproval(po) && (() => {
                      const problem = orderDecisionProblem(po, role, myUid);
                      if (problem) return <span className="text-[var(--muted)]">{problem === 'Not waiting for approval' ? '' : problem}</span>;
                      if (declining === po.id) return (
                        <span className="inline-flex items-center gap-2">
                          <label htmlFor={`decline-${po.id}`} className="sr-only">Why is it declined?</label>
                          <input id={`decline-${po.id}`} value={declineReason} onChange={e => setDeclineReason(e.target.value)} placeholder="Why? (optional)" className="px-2 py-1 border border-[var(--line)] rounded bg-[var(--panel)]" />
                          <button type="button" onClick={() => { void decideOrder(po, false, declineReason.trim() || undefined); setDeclining(null); setDeclineReason(''); }} className="font-semibold text-[var(--neg)]">Decline</button>
                          <button type="button" onClick={() => setDeclining(null)} className="text-[var(--muted)]">Cancel</button>
                        </span>
                      );
                      return (
                        <>
                          <button type="button" onClick={() => void decideOrder(po, true)} aria-label={`Approve ${po.poNumber}`} className="px-2.5 py-1 font-semibold bg-[var(--pos)] text-white rounded-md">Approve</button>
                          <button type="button" onClick={() => setDeclining(po.id)} aria-label={`Decline ${po.poNumber}`} className="px-2.5 py-1 font-semibold border border-[var(--line)] rounded-md">Decline</button>
                        </>
                      );
                    })()}
                    {canEdit && !awaitingApproval(po) && !['received', 'billed', 'cancelled', 'closed'].includes(po.status) && (
                      <button type="button" onClick={() => openReceive(po)} className="px-2.5 py-1 font-semibold border border-[var(--line)] rounded-md">Receive goods</button>
                    )}
                    {canEdit && !awaitingApproval(po) && !po.billId && po.status !== 'cancelled' && (
                      <button type="button" onClick={() => setBillingPO(po)} className="px-2.5 py-1 font-semibold bg-[var(--brass)] text-[var(--ink)] rounded-md inline-flex items-center gap-1">
                        <FileText className="w-3 h-3" aria-hidden="true" /> Create bill
                      </button>
                    )}
                    {canEdit && !po.billId && po.status !== 'cancelled' && (
                      <button type="button" onClick={() => cancelPO(po)} className="p-1 text-[var(--muted)]" aria-label={`Cancel ${po.poNumber}`} title="Cancel"><Ban className="w-3.5 h-3.5" aria-hidden="true" /></button>
                    )}
                    {po.billId && <span className="text-[var(--muted)]">Billed</span>}
                    <button type="button" onClick={() => setPreviewPO(po)} className="p-1 text-[var(--muted)]" aria-label={`PDF of ${po.poNumber}`} title="Preview / download PDF"><Printer className="w-3.5 h-3.5" aria-hidden="true" /></button>
                    {canEdit && canDeleteOrder(po) && (
                      <button type="button" onClick={() => deletePO(po)} className="p-1 text-[var(--muted)] hover:text-[var(--neg)]" aria-label={`Delete ${po.poNumber}`} title="Delete"><Trash2 className="w-3.5 h-3.5" aria-hidden="true" /></button>
                    )}
                  </td>
                </tr>
                {openOrders.has(po.id) && (
                  <tr>
                    <td colSpan={7} className="px-4 pb-4 bg-[var(--panel)]">
                      <OrderLines po={po} canEdit={canEdit && canChangeOrder(po)} suggestions={itemSuggestions} onSave={saveOrder} />
                      <AttachmentsPanel target={{ collection: 'purchaseOrders', id: po.id, label: `Purchase order ${po.poNumber}` }} workspaceId={po.workspaceId} className="mt-3 border-t border-[var(--line)] pt-3" />
                    </td>
                  </tr>
                )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'match' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {([['Fully matched', matchSummary.matchedCount], ['Price / quantity differences', matchSummary.varianceCount], ['Awaiting delivery', matchSummary.unreceivedCount], ['Awaiting the vendor\'s bill', matchSummary.missingBillCount]] as [string, number][]).map(([label, n]) => (
              <div key={label} className="p-4 bg-[var(--surface)] rounded-lg border border-[var(--line)]">
                <div className="text-xs font-semibold text-[var(--muted)] uppercase">{label}</div>
                <div className="text-xl font-mono font-bold mt-1">{n}</div>
              </div>
            ))}
          </div>
          <div className="bg-[var(--surface)] border border-[var(--line)] rounded-lg overflow-x-auto">
            <table className="w-full text-left text-xs">
              <caption className="sr-only">3-way match</caption>
              <thead className="border-b border-[var(--line)] text-[var(--muted)] font-semibold uppercase tracking-wider">
                <tr>
                  <th scope="col" className="py-3 px-4">Order</th><th scope="col" className="py-3 px-4 text-right">Ordered</th>
                  <th scope="col" className="py-3 px-4 text-right">Received</th><th scope="col" className="py-3 px-4 text-right">Billed</th>
                  <th scope="col" className="py-3 px-4 text-center">Result</th><th scope="col" className="py-3 px-4">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {matchSummary.results.map(res => (
                  <tr key={res.poId}>
                    <td className="py-3 px-4 font-mono font-bold">{res.poNumber}</td>
                    <td className="py-3 px-4 text-right font-mono">{formatCurrency(res.poAmountCents)}</td>
                    <td className="py-3 px-4 text-right font-mono">{formatCurrency(res.receiptAmountCents)}</td>
                    <td className="py-3 px-4 text-right font-mono">{res.billAmountCents > 0 ? formatCurrency(res.billAmountCents) : '—'}</td>
                    <td className="py-3 px-4 text-center"><span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${statusClass(res.status)}`}>{res.status.replace('_', ' ')}</span></td>
                    <td className="py-3 px-4 text-[11px]">
                      {res.discrepancies.length > 0
                        ? <ul className="space-y-0.5 text-[var(--neg)]">{res.discrepancies.map(d => <li key={d}>• {d}</li>)}</ul>
                        : <span className="text-[var(--pos)] inline-flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" /> Order, receipt and bill agree</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'receipts' && (
        <div className="bg-[var(--surface)] border border-[var(--line)] rounded-lg overflow-x-auto">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">Goods received</caption>
            <thead className="border-b border-[var(--line)] text-[var(--muted)] font-semibold uppercase tracking-wider">
              <tr>
                <th scope="col" className="py-3 px-4">Receipt</th><th scope="col" className="py-3 px-4">Order</th><th scope="col" className="py-3 px-4">Vendor</th>
                <th scope="col" className="py-3 px-4">Date</th><th scope="col" className="py-3 px-4">Items</th><th scope="col" className="py-3 px-4 text-center">Condition</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {goodsReceipts.length === 0 && <tr><td colSpan={6} className="py-8 px-4 text-center text-[var(--muted)]">Nothing received yet.</td></tr>}
              {goodsReceipts.map(gr => (
                <tr key={gr.id}>
                  <td className="py-3 px-4 font-mono font-bold">{gr.receiptNumber}</td>
                  <td className="py-3 px-4 font-mono">{gr.poNumber}</td>
                  <td className="py-3 px-4">{gr.vendorName}</td>
                  <td className="py-3 px-4 font-mono">{formatDate(gr.receivedDate)}</td>
                  <td className="py-3 px-4">{gr.items.map(i => [
                    `${i.description} (${i.quantityReceived})`,
                    ...(i.lotNumber ? [`lot ${i.lotNumber}${i.lotExpiryDate ? `, expires ${i.lotExpiryDate}` : ''}`] : []),
                    ...((i.serialNumbers || []).length ? [`serials: ${(i.serialNumbers || []).join(', ')}`] : []),
                  ].join(' · ')).join(', ')}</td>
                  <td className="py-3 px-4 text-center">{gr.items[0]?.condition || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isCreatingPO && (
        <div {...newPoDialogProps} aria-labelledby={`${ids}-new`} className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-[var(--surface)] rounded-xl shadow-xl max-w-xl w-full border border-[var(--line)]">
            <div className="p-4 border-b border-[var(--line)] flex items-center justify-between">
              <h2 id={`${ids}-new`} className="text-sm font-bold">New purchase order</h2>
              <button type="button" onClick={() => setIsCreatingPO(false)} className="p-1.5 text-[var(--muted)]" aria-label="Close"><X className="w-4 h-4" aria-hidden="true" /></button>
            </div>
            <div className="p-5 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor={`${ids}-vendor`} className="block font-semibold mb-1">Vendor</label>
                  <select id={`${ids}-vendor`} value={poVendorId} onChange={e => setPoVendorId(e.target.value)} className={inputClass}>
                    <option value="">Choose a vendor…</option>
                    {vendorChoices.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                  {vendors.length === 0 && <p className="mt-1 text-[var(--muted)]">Add the vendor in Purchases first.</p>}
                </div>
                <div>
                  <label htmlFor={`${ids}-expected`} className="block font-semibold mb-1">Expected delivery</label>
                  <input id={`${ids}-expected`} type="date" value={poExpectedDate} onChange={e => setPoExpectedDate(e.target.value)} className={inputClass} />
                </div>
              </div>
              <fieldset className="space-y-2">
                <legend className="font-semibold">Items</legend>
                {lastOrder && linesEmpty && (
                  <button type="button" onClick={() => setPoItems(lastOrder.lines.map(l => ({ ...l, key: crypto.randomUUID() })))}
                    className="flex items-center gap-1 font-semibold text-[var(--text)] underline-offset-2 hover:underline">
                    <Copy className="w-3.5 h-3.5" aria-hidden="true" /> Same as last order ({lastOrder.poNumber}, {lastOrder.lines.length} line{lastOrder.lines.length === 1 ? '' : 's'})
                  </button>
                )}
                {poItems.map((line, n) => (
                  <div key={line.key} className="grid grid-cols-6 gap-2">
                    {stockItems.length > 0 && (
                      <select aria-label={`Item ${n + 1} stock item`} value={line.itemId}
                        onChange={e => {
                          const stock = stockItems.find(it => it.id === e.target.value);
                          setPoItems(lines => lines.map(l => (l.key === line.key ? {
                            ...l, itemId: e.target.value,
                            ...(stock && !l.desc.trim() ? { desc: stock.name } : {}),
                            ...(stock && !l.unitPrice && stock.unitCostCents ? { unitPrice: (stock.unitCostCents / 100).toFixed(2) } : {}),
                          } : l)));
                        }}
                        className={`${inputClass} col-span-6`}>
                        <option value="">Not a stock item</option>
                        {stockItems.map(it => <option key={it.id} value={it.id}>{it.name}</option>)}
                      </select>
                    )}
                    <input aria-label={`Item ${n + 1} description`} placeholder="Description" value={line.desc} onChange={e => setLine(line.key, 'desc', e.target.value)} className={`${inputClass} col-span-3`} />
                    <input aria-label={`Item ${n + 1} quantity`} type="number" min="0" step="any" value={line.qty} onChange={e => setLine(line.key, 'qty', e.target.value)} className={`${inputClass} col-span-1 text-center`} />
                    <input aria-label={`Item ${n + 1} unit price`} type="number" min="0" step="0.01" placeholder="Unit price" value={line.unitPrice} onChange={e => setLine(line.key, 'unitPrice', e.target.value)} className={`${inputClass} col-span-2 text-right font-mono`} />
                  </div>
                ))}
              </fieldset>
              <button type="button" onClick={() => setPoItems(lines => [...lines, newLine()])} className="font-semibold flex items-center gap-1"><Plus className="w-3.5 h-3.5" aria-hidden="true" /> Add item</button>
              <div className="pt-3 flex items-center justify-end gap-2">
                <button type="button" onClick={() => setIsCreatingPO(false)} className="px-4 py-2 font-semibold border border-[var(--line)] rounded-lg">Cancel</button>
                <button type="button" disabled={saving} onClick={handleSavePO} className="px-4 py-2 font-semibold bg-[var(--brass)] text-[var(--ink)] rounded-lg flex items-center gap-1.5 disabled:opacity-50">
                  <Check className="w-3.5 h-3.5" aria-hidden="true" /> {asRequest ? 'Send for approval' : 'Save purchase order'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {receivingPO && (
        <div {...receiveDialogProps} aria-labelledby={`${ids}-receive`} className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-[var(--surface)] rounded-xl shadow-xl max-w-md w-full border border-[var(--line)]">
            <div className="p-4 border-b border-[var(--line)] flex items-center justify-between">
              <h2 id={`${ids}-receive`} className="text-sm font-bold">Goods received for {receivingPO.poNumber}</h2>
              <button type="button" onClick={() => setReceivingPO(null)} className="p-1.5 text-[var(--muted)]" aria-label="Close"><X className="w-4 h-4" aria-hidden="true" /></button>
            </div>
            <div className="p-5 space-y-4 text-xs">
              <div>
                <label htmlFor={`${ids}-condition`} className="block font-semibold mb-1">Condition</label>
                <select id={`${ids}-condition`} value={receivedCondition} onChange={e => setReceivedCondition(e.target.value as typeof receivedCondition)} className={inputClass}>
                  <option value="good">Good</option>
                  <option value="damaged">Damaged (flag a difference)</option>
                  <option value="rejected">Rejected (not counted as received)</option>
                </select>
              </div>
              <fieldset className="space-y-2">
                <legend className="font-semibold">Quantities delivered now</legend>
                {receivingPO.items.map(item => {
                  const problem = item.itemId ? receivedLineProblem(item.id) : null;
                  return (
                    <div key={item.id} className="p-2 rounded-lg border border-[var(--line)] space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <label htmlFor={`${ids}-q-${item.id}`}>{item.description} <span className="text-[var(--muted)]">({item.receivedQuantity || 0} of {item.quantity} so far)</span></label>
                        <input id={`${ids}-q-${item.id}`} type="number" min="0" step="any" value={receivedQuantities[item.id] ?? 0}
                          onChange={e => setReceivedQuantities({ ...receivedQuantities, [item.id]: Number(e.target.value) || 0 })}
                          className="w-20 p-1 bg-[var(--panel)] border border-[var(--line)] rounded-md text-center" />
                      </div>
                      {item.itemId && (
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <label className="flex flex-col gap-1">Serial numbers
                            <input value={receivedSerials[item.id] || ''} placeholder="Separated by commas" dir="auto"
                              aria-label={`Serial numbers for ${item.description}`}
                              onChange={e => setReceivedSerials({ ...receivedSerials, [item.id]: e.target.value })}
                              className="p-1 bg-[var(--panel)] border border-[var(--line)] rounded-md" />
                          </label>
                          <label className="flex flex-col gap-1">Lot
                            <input value={receivedLots[item.id] || ''} placeholder="Lot or batch" dir="auto"
                              aria-label={`Lot for ${item.description}`}
                              onChange={e => setReceivedLots({ ...receivedLots, [item.id]: e.target.value })}
                              className="p-1 bg-[var(--panel)] border border-[var(--line)] rounded-md" />
                          </label>
                          <label className="flex flex-col gap-1">Lot expires
                            <input type="date" value={receivedExpiry[item.id] || ''}
                              aria-label={`Lot expiry for ${item.description}`}
                              onChange={e => setReceivedExpiry({ ...receivedExpiry, [item.id]: e.target.value })}
                              className="p-1 bg-[var(--panel)] border border-[var(--line)] rounded-md" />
                          </label>
                        </div>
                      )}
                      {item.itemId && (
                        <p className="text-[var(--muted)]">Serials, lot and expiry are recorded for traceability; they change no stock, cost or posting.</p>
                      )}
                      {problem && <p role="alert" className="text-amber-700">{problem}</p>}
                    </div>
                  );
                })}
              </fieldset>
              <div className="pt-3 flex items-center justify-end gap-2">
                <button type="button" onClick={() => setReceivingPO(null)} className="px-4 py-2 font-semibold border border-[var(--line)] rounded-lg">Cancel</button>
                <button type="button" disabled={saving || receivingPO.items.some(item => item.itemId && receivedLineProblem(item.id))} onClick={handleSaveGoodsReceipt} className="px-4 py-2 font-semibold bg-[var(--brass)] text-[var(--ink)] rounded-lg flex items-center gap-1.5 disabled:opacity-50">
                  <Check className="w-3.5 h-3.5" aria-hidden="true" /> Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <BillModal
        isOpen={!!billingPO}
        onClose={() => setBillingPO(null)}
        onSave={handleBillSaved}
        vendors={vendors}
        accounts={accounts}
        initialBill={billFromOrder}
      />
      {previewPO && pdfWorkspaceId && (
        <PdfPreviewModal isOpen onClose={() => setPreviewPO(null)} title={`Purchase order ${previewPO.poNumber}`}
          documentType="purchaseOrder" documentId={previewPO.id} workspaceId={pdfWorkspaceId} filename={`purchase_order_${previewPO.poNumber}.pdf`} />
      )}
    </div>
  );
};

/** An order's lines, editable in place while nothing was received or billed (I-22). */
function OrderLines({ po, canEdit, suggestions, onSave }: {
  po: PurchaseOrder;
  canEdit: boolean;
  suggestions: string[];
  onSave: (po: PurchaseOrder, changes: Partial<PurchaseOrder>, message: string) => Promise<unknown>;
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
    await onSave(po, addOrderItem(po, { id: crypto.randomUUID(), description: desc.trim(), quantity, unitPriceCents, receivedQuantity: 0 }), 'Line added');
    setDesc(''); setQty('1'); setPrice('');
  };
  const cell = 'py-1.5 px-2';
  return (
    <table className="w-full text-left text-xs mt-2">
      <caption className="sr-only">Lines of {po.poNumber}</caption>
      <thead className="text-[var(--muted)]">
        <tr>
          <th scope="col" className={cell}>Item</th><th scope="col" className={`${cell} text-right`}>Quantity</th>
          <th scope="col" className={`${cell} text-right`}>Unit price</th><th scope="col" className={`${cell} text-right`}>Received</th>
          <th scope="col" className={`${cell} text-right`}>Total</th><th scope="col" className={cell}><span className="sr-only">Remove</span></th>
        </tr>
      </thead>
      <tbody>
        {po.items.map(item => (
          <tr key={item.id}>
            <td className={cell}>
              <InlineEdit value={item.description} label={`Item on ${po.poNumber}`} canEdit={canEdit} suggestions={suggestions}
                validate={x => (String(x).trim() ? null : 'Describe the item')}
                onSave={x => onSave(po, changeOrderItem(po, item.id, { description: String(x) }), 'Line saved')} />
            </td>
            <td className={`${cell} text-right font-mono`}>
              <InlineEdit kind="number" value={item.quantity} label={`Quantity of ${item.description}`} canEdit={canEdit} validate={positive}
                onSave={x => onSave(po, changeOrderItem(po, item.id, { quantity: Number(x) }), 'Quantity saved')} />
            </td>
            <td className={`${cell} text-right font-mono`}>
              <InlineEdit kind="money" value={item.unitPriceCents} display={formatCurrency(item.unitPriceCents, po.currency)} label={`Unit price of ${item.description}`} canEdit={canEdit} validate={positive}
                onSave={x => onSave(po, changeOrderItem(po, item.id, { unitPriceCents: Number(x) }), 'Price saved')} />
            </td>
            <td className={`${cell} text-right font-mono`}>{item.receivedQuantity || 0}</td>
            <td className={`${cell} text-right font-mono font-bold`}>{formatCurrency(item.totalCents, po.currency)}</td>
            <td className={`${cell} text-right`}>
              {canEdit && po.items.length > 1 && (
                <button type="button" onClick={() => onSave(po, removeOrderItem(po, item.id), 'Line removed')} className="p-1 text-[var(--muted)] hover:text-[var(--neg)]"
                  aria-label={`Remove ${item.description}`}><X className="w-3.5 h-3.5" aria-hidden="true" /></button>
              )}
            </td>
          </tr>
        ))}
        {canEdit && (
          <tr onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void add(); } }}>
            <td className={cell}>
              <input aria-label={`New line on ${po.poNumber}`} placeholder="Add a line…" value={desc} onChange={e => setDesc(e.target.value)} list={`${ids}-items`}
                className="w-full p-1 bg-[var(--surface)] border border-[var(--line)] rounded-md" />
              <datalist id={`${ids}-items`}>{suggestions.map(x => <option key={x} value={x} />)}</datalist>
            </td>
            <td className={cell}>
              <input aria-label={`Quantity of the new line on ${po.poNumber}`} type="number" min="0" step="any" value={qty} onChange={e => setQty(e.target.value)}
                className="w-full p-1 bg-[var(--surface)] border border-[var(--line)] rounded-md text-right" />
            </td>
            <td className={cell}>
              <input aria-label={`Unit price of the new line on ${po.poNumber}`} type="number" min="0" step="0.01" placeholder="0.00" value={price} onChange={e => setPrice(e.target.value)}
                className="w-full p-1 bg-[var(--surface)] border border-[var(--line)] rounded-md text-right font-mono" />
            </td>
            <td colSpan={3} className={`${cell} text-[var(--muted)]`}>Enter adds the line</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

export default PurchaseOrdersView;
