import { useListText } from '../../lib/i18n/useListText';
import { RowTable } from '../ui/RowTable';
import { TanStackDataGrid } from '../ui/TanStackDataGrid';
import { useDialog } from '../../hooks/useDialog';
import { PageHeader } from '../ui/PageHeader';
import { useScreenDataHealth } from '../../hooks/useScreenDataHealth';
import { ScreenDataNotice } from '../ui/ScreenDataNotice';
import { EmptyState } from '../ui/EmptyState';
import { LoadingState } from '../ui/LoadingState';
import React, { useId, useMemo, useState } from 'react';
import { ShoppingCart, Plus, ShieldCheck, X, Check, CheckCircle2, FileText, Ban, Printer, Trash2, ChevronRight, ChevronDown, Copy, AlertTriangle, RotateCw } from 'lucide-react';
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
import { awaitingApproval, billLinesFromOrder, canChangeOrder, canDeleteOrder, canMoveDelivery, lastOrderLines, nextPoNumber, orderDecision, orderDecisionProblem, poOrderNeedsApproval, vendorsByOrders } from '../../lib/purchaseOrders';
import { normalizePoApproval } from '../../lib/invoiceApproval';
import { suggestionsFrom } from '../../lib/inlineEdit';
import { isArchivedParty } from '../../lib/contacts';
import { formatCurrency, formatDate, formatTzDate } from '../../lib/utils';
import BillModal from './BillModal';
import AttachmentsPanel from '../common/AttachmentsPanel';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { inBackground } from '../../lib/inBackground';
import PurchaseOrderLines from './PurchaseOrderLines';

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
  const listText = useListText();
  const bills = useLedgerStore(s => (s.bills || []) as Bill[]);
  const vendors = useLedgerStore(s => (s.vendors || []) as Vendor[]);
  const accounts = useLedgerStore(s => s.accounts || []);
  // the vendors and stock this screen reads load on demand, so their loading state is shown (I-05)
  const { loading } = useLedgerCollections('bills', 'inventory', 'vendors');
  const dataHealth = useScreenDataHealth(['bills', 'inventory', 'vendors']);
  // a failed collection is explained by the notice above and must not keep the order table on a skeleton
  const collectionsLoading = loading && dataHealth.failedKeys.length === 0;
  // J-08: an order line can be a stock item; the bill made from the order brings its units in
  const stockItems = (useLedgerStore(s => s.inventory) || []).filter(i => i.itemType !== 'service');
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const role = useCurrentRole();
  const canEdit = role === 'owner' || role === 'accountant' || role === 'bookkeeper';
  const myUid = useAuthStore(s => s.user?.uid) || '';
  const [declining, setDeclining] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState('');
  const { addEntity, updateEntity, deleteEntity } = useEntityOperations();
  // the orders have their own live query, so their failure is reported on its own: an unreadable
  // order list must never read as "no purchase orders yet" (A-272)
  const { data: purchaseOrders, loading: ordersLoading, error: ordersError, refetch: refetchOrders } = useCollection<PurchaseOrder>('purchaseOrders', { orderByField: 'createdAt', orderDirection: 'desc', limit: 500 });
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
    inBackground(deleteEntity('purchaseOrders', po.id, `${po.poNumber} deleted`));
  };

  const decideOrder = (po: PurchaseOrder, approve: boolean, reason?: string) =>
    updateEntity('purchaseOrders', po.id, { ...orderDecision(approve, myUid, new Date().toISOString(), reason), updatedAt: new Date().toISOString() },
      approve ? `${po.poNumber} approved` : `${po.poNumber} declined`);

  const cancelPO = (po: PurchaseOrder) => {
    if (!window.confirm(`Cancel purchase order ${po.poNumber}?`)) return;
    inBackground(updateEntity('purchaseOrders', po.id, { status: 'cancelled' }, `${po.poNumber} cancelled`));
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
    <div className="space-y-6 w-full min-w-0 max-w-6xl mx-auto p-4 sm:p-6 text-[var(--text)]" id="purchase-orders-view">
      <ScreenDataNotice failedKeys={dataHealth.failedKeys} message={dataHealth.message} onRetry={dataHealth.retry} what="this screen" />
      <PageHeader className="border-b border-[var(--line)] pb-5" icon={<ShoppingCart className="w-6 h-6" aria-hidden="true" />} title="Purchase orders"
        description={<>Order from a vendor, record what arrives, then turn the order into a bill. The 3-way match compares all three.
          {poRule.enabled && poRule.thresholdCents > 0 ? ` Orders above ${formatCurrency(poRule.thresholdCents, workspace?.currency)} require approval before receiving or billing.` : ''}</>}>
        {canEdit && (
          <button type="button" onClick={() => setIsCreatingPO(true)} id="create-po-btn"
            className="px-4 py-2 text-xs font-semibold bg-[var(--brass)] text-[var(--ink)] rounded-lg flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" aria-hidden="true" /> New purchase order
          </button>
        )}
      </PageHeader>

      <div className="flex gap-1 p-1 rounded-lg w-fit max-w-full overflow-x-auto bg-[var(--panel)] border border-[var(--line)]" role="tablist" aria-label="Purchase orders">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={activeTab === id} onClick={() => setActiveTab(id)}
            className={`px-4 py-1.5 text-xs font-semibold rounded-md ${activeTab === id ? 'bg-[var(--surface)] text-[var(--text)]' : 'text-[var(--muted)]'}`}>
            {id === 'match' && <ShieldCheck className="w-3.5 h-3.5 inline mr-1" aria-hidden="true" />}{label}
          </button>
        ))}
      </div>

      {activeTab === 'pos' && (
        // A-276: a scrollable region a keyboard can reach (axe scrollable-region-focusable)
        <div className="bg-[var(--surface)] border border-[var(--line)] rounded-lg overflow-x-auto" role="region" aria-label="Purchase orders table" tabIndex={0}>{/* NOSONAR: S6845 — tabIndex on scrollable region is the intentional axe scrollable-region-focusable pattern */}
          {(collectionsLoading || ordersLoading) && <LoadingState what="purchase orders" />}
          {!collectionsLoading && !ordersLoading && ordersError && (<div role="status" data-orders-notice className="flex flex-col gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 sm:flex-row sm:items-start">
                    <AlertTriangle size={18} className="mt-0.5 shrink-0 text-[var(--neg)]" aria-hidden="true" />
                    <div className="min-w-0 flex-1 text-sm">
                      <p className="font-semibold text-[var(--text)]">Couldn't load the purchase orders.</p>
                      <p className="mt-1 text-xs text-[var(--muted)]">{ordersError.message} Orders that already exist are not shown below. Try again.</p>
                    </div>
                    <button type="button" onClick={() => refetchOrders()} className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-[var(--line)] px-4 text-xs font-bold text-[var(--text)] hover:bg-[var(--panel)]">
                      <RotateCw size={14} aria-hidden="true" /> Try again
                    </button>
                  </div>)}
          {!collectionsLoading && !ordersLoading && !ordersError && purchaseOrders.length === 0 && (<EmptyState
                    title="No purchase orders yet"
                    description="A purchase order tells a vendor what to send before anything is billed; what arrives is recorded against it and the 3-way match compares order, receipt and bill."
                    actionLabel={canEdit ? 'New purchase order' : undefined}
                    onAction={canEdit ? () => setIsCreatingPO(true) : undefined}
                  />)}
          {purchaseOrders.length > 0 && (<TanStackDataGrid
            data={purchaseOrders}
            getRowId={(po) => po.id}
            caption={listText('Purchase orders')}
            columnScope="purchase-orders"
            columnLabel={listText('Purchase orders')}
            rowHeaderColumn="number"
            hidePaginationOnSinglePage

            renderDetail={(po) =>
              openOrders.has(po.id) ? (
                <div className="px-4 pb-4 bg-[var(--panel)]">
                  <>
                    <PurchaseOrderLines po={po} canEdit={canEdit && canChangeOrder(po)} suggestions={itemSuggestions} onSave={saveOrder} />
                    <AttachmentsPanel
                      target={{ collection: 'purchaseOrders', id: po.id, label: `Purchase order ${po.poNumber}` }}
                      workspaceId={po.workspaceId}
                      className="mt-3 border-t border-[var(--line)] pt-3"
                    />
                  </>
                </div>
              ) : null
            }
            columns={[
              {
                id: 'number', header: listText('Number'), accessorFn: (po) => po.poNumber,
                cell: ({ row: { original: po } }) => (
                  <div className="font-mono font-bold">
                    <button
                      type="button"
                      onClick={() => toggleOrder(po.id)}
                      aria-expanded={openOrders.has(po.id)}
                      aria-label={`Lines of ${po.poNumber}`}
                      className="inline-flex items-center gap-1"
                    >
                      {openOrders.has(po.id) ? <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" /> : <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />}
                      {po.poNumber}
                    </button>
                  </div>
                ),
              },
              {
                id: 'vendor', header: listText('Vendor'), accessorFn: (po) => po.vendorName,
                cell: ({ row: { original: po } }) => (
                  <InlineEdit
                    kind="select"
                    value={po.vendorId}
                    display={po.vendorName}
                    label={`Vendor of ${po.poNumber}`}
                    options={vendorChoices.map((v) => ({ value: v.id, label: v.name }))}
                    canEdit={canEdit && canChangeOrder(po)}
                    onSave={(x) => {
                      const v = vendors.find((vendor) => vendor.id === x);
                      return v ? saveOrder(po, { vendorId: v.id, vendorName: v.name }, 'Vendor changed') : undefined;
                    }}
                  />
                ),
              },
              {
                id: 'issued', header: listText('Issued'), accessorFn: (po) => po.issueDate,
                cell: ({ row: { original: po } }) => <div className="font-mono">{formatDate(po.issueDate)}</div>,
              },
              {
                id: 'expected', header: listText('Expected'), accessorFn: (po) => po.expectedDeliveryDate,
                cell: ({ row: { original: po } }) => (
                  <div className="font-mono">
                    <InlineEdit
                      kind="date"
                      value={po.expectedDeliveryDate?.slice(0, 10)}
                      display={po.expectedDeliveryDate ? formatDate(po.expectedDeliveryDate) : undefined}
                      label={`Expected delivery of ${po.poNumber}`}
                      placeholder="Add date"
                      canEdit={canEdit && canMoveDelivery(po)}
                      validate={(x) => (po.issueDate && String(x) < po.issueDate.slice(0, 10) ? "Delivery can't be before the order date" : null)}
                      onSave={(x) => saveOrder(po, { expectedDeliveryDate: String(x) }, 'Expected delivery saved')}
                    />
                  </div>
                ),
              },
              {
                id: 'total', header: listText('Amount'), accessorFn: (po) => po.totalAmountCents,
                cell: ({ row: { original: po } }) => <div className="text-right font-mono font-bold">{formatCurrency(po.totalAmountCents, po.currency)}</div>,
              },
              {
                id: 'status', header: listText('Status'), accessorFn: (po) => po.status,
                cell: ({ row: { original: po } }) => (
                  <div className="text-center">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${statusClass(po.status)}`}>{po.status.replace('_', ' ')}</span>
                  </div>
                ),
              },
              {
                id: 'actions',
                header: listText('Actions'),
                cell: ({ row: { original: po } }) => (
                  <div className="text-right whitespace-nowrap space-x-2">
                    <>
                      {awaitingApproval(po) &&
                        (() => {
                          const problem = orderDecisionProblem(po, role, myUid);
                          if (problem) return <span className="text-[var(--muted)]">{problem === 'Not waiting for approval' ? '' : problem}</span>;
                          if (declining === po.id)
                            return (
                              <span className="inline-flex items-center gap-2">
                                <label htmlFor={`decline-${po.id}`} className="sr-only">
                                  Why is it declined?
                                </label>
                                <input
                                  id={`decline-${po.id}`}
                                  value={declineReason}
                                  onChange={(e) => setDeclineReason(e.target.value)}
                                  placeholder="Why? (optional)"
                                  className="px-2 py-1 border border-[var(--line)] rounded bg-[var(--panel)]"
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    void decideOrder(po, false, declineReason.trim() || undefined);
                                    setDeclining(null);
                                    setDeclineReason('');
                                  }}
                                  className="font-semibold text-[var(--neg)]"
                                >
                                  Decline
                                </button>
                                <button type="button" onClick={() => setDeclining(null)} className="text-[var(--muted)]">
                                  Cancel
                                </button>
                              </span>
                            );
                          return (
                            <>
                              <button
                                type="button"
                                onClick={() => void decideOrder(po, true)}
                                aria-label={`Approve ${po.poNumber}`}
                                className="px-2.5 py-1 font-semibold bg-[var(--pos)] text-white rounded-md"
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeclining(po.id)}
                                aria-label={`Decline ${po.poNumber}`}
                                className="px-2.5 py-1 font-semibold border border-[var(--line)] rounded-md"
                              >
                                Decline
                              </button>
                            </>
                          );
                        })()}
                      {canEdit && !awaitingApproval(po) && !['received', 'billed', 'cancelled', 'closed'].includes(po.status) && (
                        <button type="button" onClick={() => openReceive(po)} className="px-2.5 py-1 font-semibold border border-[var(--line)] rounded-md">
                          Receive goods
                        </button>
                      )}
                      {canEdit && !awaitingApproval(po) && !po.billId && po.status !== 'cancelled' && (
                        <button
                          type="button"
                          onClick={() => setBillingPO(po)}
                          className="px-2.5 py-1 font-semibold bg-[var(--brass)] text-[var(--ink)] rounded-md inline-flex items-center gap-1"
                        >
                          <FileText className="w-3 h-3" aria-hidden="true" /> Create bill
                        </button>
                      )}
                      {canEdit && !po.billId && po.status !== 'cancelled' && (
                        <button type="button" onClick={() => cancelPO(po)} className="p-1 text-[var(--muted)]" aria-label={`Cancel ${po.poNumber}`} title="Cancel">
                          <Ban className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                      )}
                      {po.billId && <span className="text-[var(--muted)]">Billed</span>}
                      <button
                        type="button"
                        onClick={() => setPreviewPO(po)}
                        className="p-1 text-[var(--muted)]"
                        aria-label={`PDF of ${po.poNumber}`}
                        title="Preview / download PDF"
                      >
                        <Printer className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                      {canEdit && canDeleteOrder(po) && (
                        <button
                          type="button"
                          onClick={() => deletePO(po)}
                          className="p-1 text-[var(--muted)] hover:text-[var(--neg)]"
                          aria-label={`Delete ${po.poNumber}`}
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                      )}
                    </>
                  </div>
                ),
              },
            ]}
          />)}
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
          <div className="bg-[var(--surface)] border border-[var(--line)] rounded-lg overflow-x-auto" role="region" aria-label="3-way match table" tabIndex={0}>{/* NOSONAR: S6845 — tabIndex on scrollable region is the intentional axe scrollable-region-focusable pattern */}
            <RowTable
              rowHeaderColumn={false}
              caption={(<>3-way match</>)}
              rows={matchSummary.results}
              rowKey={res => res.poId}
              tableClassName="w-full text-left text-xs"
              headRowClassName="border-b border-[var(--line)] text-[var(--muted)] font-semibold uppercase tracking-wider"
              columns={[
                { header: "Order", className: "py-3 px-4 font-mono font-bold", headClassName: "py-3 px-4", cell: (res) => res.poNumber },
                { header: "Ordered", align: 'right', className: "py-3 px-4 font-mono", headClassName: "py-3 px-4", cell: (res) => formatCurrency(res.poAmountCents) },
                { header: "Received", align: 'right', className: "py-3 px-4 font-mono", headClassName: "py-3 px-4", cell: (res) => formatCurrency(res.receiptAmountCents) },
                { header: "Billed", align: 'right', className: "py-3 px-4 font-mono", headClassName: "py-3 px-4", cell: (res) => res.billAmountCents > 0 ? formatCurrency(res.billAmountCents) : '—' },
                { header: "Result", className: "py-3 px-4 text-center", headClassName: "py-3 px-4 text-center", cell: (res) => <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${statusClass(res.status)}`}>{res.status.replace('_', ' ')}</span> },
                { header: "Notes", className: "py-3 px-4 text-[11px]", headClassName: "py-3 px-4", cell: (res) => res.discrepancies.length > 0
                        ? <ul className="space-y-0.5 text-[var(--neg)]">{res.discrepancies.map(d => <li key={d}>• {d}</li>)}</ul>
                        : <span className="text-[var(--pos)] inline-flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" /> Order, receipt and bill agree</span> },
              ]}
            />
          </div>
        </div>
      )}

      {activeTab === 'receipts' && (
        <div className="bg-[var(--surface)] border border-[var(--line)] rounded-lg overflow-x-auto" role="region" aria-label="Goods received table" tabIndex={0}>{/* NOSONAR: S6845 — tabIndex on scrollable region is the intentional axe scrollable-region-focusable pattern */}
          <TanStackDataGrid
            data={goodsReceipts}
            getRowId={(gr) => gr.id}
            emptyState={
              <EmptyState
                title="Nothing received yet"
                description="Recording what arrived against an order (with its delivery note and quantities) is what the 3-way match and the stock ledger read."
                actionLabel={canEdit && purchaseOrders.length > 0 ? 'Record what arrived' : undefined}
                onAction={canEdit && purchaseOrders.length > 0 ? () => setActiveTab('pos') : undefined}
              />
            }
            caption={listText('Goods received')}
            columnScope="purchase-orders-receipts"
            columnLabel={listText('Goods received')}
            rowHeaderColumn="receipt"
            hidePaginationOnSinglePage

            columns={[
              {
                id: 'receipt', header: listText('Receipt'), accessorFn: (gr) => gr.receiptNumber,
                cell: ({ row: { original: gr } }) => <div className="font-mono font-bold">{gr.receiptNumber}</div>,
              },
              { id: 'order', header: listText('Order'), accessorFn: (gr) => gr.poNumber, cell: ({ row: { original: gr } }) => <div className="font-mono">{gr.poNumber}</div> },
              { id: 'vendor', header: listText('Vendor'), accessorFn: (gr) => gr.vendorName, cell: ({ row: { original: gr } }) => gr.vendorName },
              {
                id: 'date', header: listText('Date'), accessorFn: (gr) => gr.receivedDate,
                cell: ({ row: { original: gr } }) => <div className="font-mono">{formatDate(gr.receivedDate)}</div>,
              },
              {
                id: 'items', header: listText('Items'), accessorFn: (gr) => gr.items.map((i) => i.description).join(', '),
                cell: ({ row: { original: gr } }) =>
                  gr.items
                    .map((i) =>
                      [
                        `${i.description} (${i.quantityReceived})`,
                        ...(i.lotNumber ? [`lot ${i.lotNumber}${i.lotExpiryDate ? `, expires ${i.lotExpiryDate}` : ''}`] : []),
                        ...((i.serialNumbers || []).length ? [`serials: ${(i.serialNumbers || []).join(', ')}`] : []),
                      ].join(' · '),
                    )
                    .join(', '),
              },
              {
                id: 'status', header: listText('Condition'), accessorFn: (gr) => gr.items[0]?.condition,
                cell: ({ row: { original: gr } }) => <div className="text-center">{gr.items[0]?.condition || '—'}</div>,
              },
            ]}
          />
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

export default PurchaseOrdersView;
