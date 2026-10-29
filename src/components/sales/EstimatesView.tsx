import { RecordInlineField } from '../ui/RecordInlineField';
import { EstimateSignLink, EstimateSignedNote } from './EstimateSignLink';
import { dueMilestones } from '../../lib/milestones';
import React, { useState } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { formatCurrency, formatDate, getLocalDateISO } from '../../lib/utils';
import { Plus, ArrowRight, FileText, Eye, Download, Paperclip } from 'lucide-react';
import { collection, addDoc, doc, updateDoc } from '../../lib/db/firestore';
import { db, getIdToken } from '../../firebase';
import { nextDocumentNumber } from '../../services/documentNumbers';
import { toast } from 'sonner';
import PdfPreviewModal from '../ui/PdfPreviewModal';
import { downloadDocumentPdf } from '../../services/documentDownloads';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { LoadingState } from '../ui/LoadingState';
import { EmptyState } from '../ui/EmptyState';
import { Labelled } from '../ui/Labelled';
import { useEntityOperations } from '../../hooks/useEntityOperations';
import { convertEstimateToInvoice } from '../../lib/estimateConverter';
import { estimateDeposits } from '../../lib/advancePayments';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import AttachmentsPanel from '../common/AttachmentsPanel';
import EstimateDepositDialog from './EstimateDepositDialog';
import OrderInvoiceDialog from './OrderInvoiceDialog';
import OrderDeliveryDialog from './OrderDeliveryDialog';
import { goodsLeaveWith } from '../../lib/deliveries';
import { EstimateLinesEditor } from './EstimateLinesEditor';
import { blankEstimateLine, estimateLinesProblem, type EstimateLineDraft, toEstimateLines } from '../../lib/estimateLines';
import { type OrderPart, type OrderStage, hasItemLines, isOrder, orderPartInvoice, orderProgress, orderStage, partCents, partLabel, resolvePart } from '../../lib/salesOrders';
import type { Estimate } from '../../types';

type EstimateRow = Estimate & { currency?: string; description?: string };
const FILTERS: Array<{ id: 'all' | 'quotes' | 'orders' | 'done'; label: string; stages: OrderStage[] | null }> = [
  { id: 'all', label: 'All', stages: null },
  { id: 'quotes', label: 'Quotes', stages: ['quote'] },
  { id: 'orders', label: 'Orders to invoice', stages: ['order', 'partly invoiced'] },
  { id: 'done', label: 'Invoiced or closed', stages: ['invoiced', 'declined', 'expired'] },
];
const STAGE_STYLE: Record<OrderStage, string> = {
  quote: 'bg-amber-500/10 text-amber-600',
  order: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
  'partly invoiced': 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
  invoiced: 'bg-emerald-500/10 text-emerald-600',
  declined: 'bg-slate-500/10 text-[var(--muted)]',
  expired: 'bg-slate-500/10 text-[var(--muted)]',
};

export default function EstimatesView() {
  const user = useAuthStore(s => s.user);
  const currentWorkspaceId = useAuthStore(s => s.currentWorkspaceId);
  const [filesFor, setFilesFor] = useState<{ workspaceId: string; key: string } | null>(null);
  const filesWorkspaceId = currentWorkspaceId || '';
  const filesOpen = (key: string) => filesFor?.workspaceId === filesWorkspaceId && filesFor.key === key;
  const toggleFiles = (key: string) => setFilesFor(current =>
    current?.workspaceId === filesWorkspaceId && current.key === key ? null : { workspaceId: filesWorkspaceId, key },
  );
  // quotes are in the workspace's currency (they were all saved as USD)
  const workspaceCurrency = useAuthStore(s => s.getCurrentWorkspace()?.currency) || 'USD';
  const { addEntity } = useEntityOperations();

  const estimates = useLedgerStore(s => s.estimates);
  const customers = useLedgerStore(s => s.customers);
  const payments = useLedgerStore(s => s.payments);
  const invoices = useLedgerStore(s => s.invoices);
  const { loading } = useLedgerCollections('customers', 'estimates');
  // only the "Deposit received" line and the orders' progress need payments and invoices: the list doesn't wait for them
  useLedgerCollections('payments', 'invoices');
  const role = useCurrentRole();
  const canTakeDeposit = role === 'owner' || role === 'accountant' || role === 'bookkeeper';
  const canWrite = canTakeDeposit;
  const [depositFor, setDepositFor] = useState<import("../../types").Estimate | null>(null);
  const [invoicing, setInvoicing] = useState<EstimateRow | null>(null);
  // BF-08 step 2: where stock leaves with deliveries, orders of stock items are delivered apart from invoicing
  const deliveriesShip = useAuthStore(s => goodsLeaveWith(s.getCurrentWorkspace()) === 'delivery');
  const [delivering, setDelivering] = useState<EstimateRow | null>(null);
  const [ordering, setOrdering] = useState<string | null>(null);
  const [customerReference, setCustomerReference] = useState('');
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('all');
  const rows = (estimates as EstimateRow[]).map(est => {
    const progress = orderProgress(est, invoices || []);
    return { est, progress, stage: orderStage(est, progress) };
  });
  const shownRows = rows.filter(r => !FILTERS.find(f => f.id === filter)?.stages || FILTERS.find(f => f.id === filter)!.stages!.includes(r.stage));

  const [isCreating, setIsCreating] = useState(false);
  const [customerId, setCustomerId] = useState('');
  const [description, setDescription] = useState('');
  const [amountDollars, setAmountDollars] = useState('');
  // BF-08: a quote can have lines (items, quantities, prices) instead of one amount
  const [lines, setLines] = useState<EstimateLineDraft[]>([]);
  const [expiryDate, setExpiryDate] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [previewEstimate, setPreviewEstimate] = useState<import("../../types").Estimate | null>(null);

  const handleCreateEstimate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentWorkspaceId || !user) return;
    const linesProblem = lines.length > 0 ? estimateLinesProblem(lines) : null;
    if (linesProblem) {
      toast.error(linesProblem);
      return;
    }
    const dollars = parseFloat(amountDollars);
    if (lines.length === 0 && (isNaN(dollars) || dollars <= 0)) {
      toast.error('Please enter a valid amount');
      return;
    }
    if (!customerId) {
      toast.error('Please select a customer');
      return;
    }

    setIsSubmitting(true);
    try {
      const customerObj = customers.find(c => c.id === customerId);
      // the next number of the estimate series; never a random one, which could repeat (L-189)
      let allocatedEstNumber: string;
      try {
        allocatedEstNumber = await nextDocumentNumber(currentWorkspaceId, 'estimate');
      } catch (e) {
        toast.error('Not saved: no estimate number', { description: e instanceof Error ? e.message : String(e) });
        return;
      }

      const estData = {
        uid: user.uid,
        workspaceId: currentWorkspaceId,
        number: allocatedEstNumber,
        customerId,
        customerName: customerObj?.name || 'Customer',
        date: getLocalDateISO(),
        expiryDate: expiryDate || getLocalDateISO(),
        amountCents: lines.length > 0 ? lines.reduce((sum, l) => sum + l.amountCents, 0) : Math.round(dollars * 100),
        ...(lines.length > 0 ? { lines: toEstimateLines(lines) } : {}),
        currency: workspaceCurrency,
        status: 'draft' as const,
        description: description || 'Quote / Estimate',
        createdAt: new Date().toISOString()
      };

      await addDoc(collection(db, 'estimates'), estData);
      toast.success('Estimate created successfully');
      setIsCreating(false);
      setCustomerId('');
      setDescription('');
      setAmountDollars('');
      setLines([]);
    } catch (err) {
      toast.error((err as Error).message || 'Failed to create estimate');
    } finally {
      setIsSubmitting(false);
    }
  };

  // L-163: the invoice goes through the posting path (useEntityOperations), as a draft to review
  // and send, with the estimate's lines; it was written straight to the database as "sent" with
  // no ledger posting (so no receivable or revenue), a dropped totalCents field and no lines.
  /** The next invoice number from the server; no made-up number (a random one could repeat an existing invoice's). */
  const nextInvoiceNumber = async (): Promise<string | undefined> => {
    try {
      const token = await getIdToken().catch(() => '');
      const res = await fetch(`/api/v1/workspaces/${currentWorkspaceId}/next-number`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ type: 'invoice' })
      });
      if (res.ok) return (await res.json()).number;
    } catch (e) {
      console.error('Failed to fetch next invoice number', e);
    }
    toast.error('Could not get the next invoice number. Please try again.');
    return undefined;
  };

  const handleConvertToInvoice = async (est: EstimateRow) => {
    if (!currentWorkspaceId || !user || est.status === 'converted') return;

    try {
      const invoiceNumber = await nextInvoiceNumber();
      if (!invoiceNumber) return;

      // the draft invoice (src/lib/estimateConverter.ts, tested); addEntity sets id, uid and workspace
      const { id: _id, uid: _uid, workspaceId: _workspaceId, ...draft } = convertEstimateToInvoice(est);
      const invData = {
        ...draft,
        number: invoiceNumber,
        currency: est.currency || 'USD',
        metadata: { convertedFromEstimateId: est.id, convertedFromEstimateNumber: est.number || est.id },
      };

      const invRef = await addEntity('invoices', invData);
      if (!invRef) return; // addEntity already showed what went wrong

      await updateDoc(doc(db, 'estimates', est.id), {
        status: 'converted',
        convertedInvoiceId: invRef.id,
        updatedAt: new Date().toISOString()
      });

      const deposit = estimateDeposits(payments || [], est.id);
      toast.success(`Estimate converted to draft invoice ${invoiceNumber}. Review it in Sales, then send it.${deposit.unappliedCents > 0 ? ` Its deposit of ${formatCurrency(deposit.unappliedCents)} is applied with "Apply deposit" once it is sent.` : ''}`);
    } catch (err) {
      toast.error((err as Error).message || 'Failed to convert estimate');
    }
  };

  // K-04: the customer said yes — the estimate becomes a sales order, invoiced in one go or in parts
  const confirmOrder = async (est: EstimateRow) => {
    if (!user) return;
    try {
      await updateDoc(doc(db, 'estimates', est.id), {
        status: 'accepted',
        orderedAt: new Date().toISOString(),
        orderedBy: user.uid,
        ...(customerReference.trim() ? { customerReference: customerReference.trim().slice(0, 100) } : {}),
        updatedAt: new Date().toISOString(),
      });
      setOrdering(null);
      setCustomerReference('');
      toast.success(`Estimate ${est.number || ''} is now an order. "Invoice" bills it in one go or in parts.`);
    } catch (err) {
      toast.error((err as Error).message || 'The order could not be saved');
    }
  };

  const declineEstimate = async (est: EstimateRow) => {
    try {
      await updateDoc(doc(db, 'estimates', est.id), { status: 'declined', updatedAt: new Date().toISOString() });
      toast.success(`Estimate ${est.number || ''} marked declined`);
    } catch (err) {
      toast.error((err as Error).message || 'Could not mark it declined');
    }
  };

  const invoiceOrderPart = async (est: EstimateRow, chosen: OrderPart) => {
    const progress = orderProgress(est, invoices || []);
    const part = resolvePart(chosen, est, progress);
    const cents = partCents(part, progress, est);
    const invoiceNumber = await nextInvoiceNumber();
    if (!invoiceNumber) return;
    const invRef = await addEntity('invoices', {
      ...orderPartInvoice(est, progress, cents, partLabel(part, est, progress), part),
      number: invoiceNumber,
      currency: est.currency || 'USD',
    });
    if (!invRef) return;
    const finished = progress.invoicedCents + cents >= progress.totalCents;
    if (finished) {
      await updateDoc(doc(db, 'estimates', est.id), { status: 'converted', convertedInvoiceId: invRef.id, updatedAt: new Date().toISOString() });
    }
    toast.success(`Draft invoice ${invoiceNumber} for ${formatCurrency(cents)} created${finished ? ': the order is fully invoiced' : `; ${formatCurrency(progress.leftCents - cents)} left on the order`}. Review it in Sales, then send it.`);
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-cyan-500/10 text-cyan-600 dark:text-cyan-400">
            <FileText className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">Estimates & Quotes</h1>
            <p className="text-xs text-[var(--muted)] dark:text-slate-400">
              Create proposals, track client approvals, and convert quotes directly into invoices
            </p>
          </div>
        </div>

        <button
          onClick={() => setIsCreating(true)}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Estimate
        </button>
      </div>

      {/* New Estimate Modal / Form */}
      {isCreating && (
        <form onSubmit={handleCreateEstimate} className="p-6 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-4">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">Create New Quote / Estimate</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Labelled labelClassName="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1" label="Customer *">
                <select
                  value={customerId}
                  onChange={e => setCustomerId(e.target.value)}
                  required
                  className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                >
                  <option value="">Select Customer...</option>
                  {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Labelled>
            </div>
            <div>
              {lines.length === 0 ? (
                <Labelled labelClassName="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1" label={`Amount (${workspaceCurrency === 'USD' ? '$' : workspaceCurrency}) *`}>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    placeholder="0.00"
                    value={amountDollars}
                    onChange={e => setAmountDollars(e.target.value)}
                    required
                    className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white font-mono"
                  />
                </Labelled>
              ) : (
                <p className="text-xs"><span className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Amount</span>
                  <span className="font-mono font-bold">{formatCurrency(lines.reduce((sum, l) => sum + l.amountCents, 0), workspaceCurrency)}</span> from the lines</p>
              )}
            </div>
            <div>
              <Labelled labelClassName="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1" label="Expiration Date">
                <input
                  type="date"
                  value={expiryDate}
                  onChange={e => setExpiryDate(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                />
              </Labelled>
            </div>
          </div>
          <div>
            <Labelled labelClassName="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1" label="Description / Project Scope">
              <input
                type="text"
                placeholder="e.g. Website Design & Custom ERP Development"
                value={description}
                onChange={e => setDescription(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
              />
            </Labelled>
          </div>
          {lines.length > 0 ? (
            <EstimateLinesEditor lines={lines} onChange={setLines} currency={workspaceCurrency} customerId={customerId} />
          ) : (
            <button type="button" onClick={() => setLines([blankEstimateLine(description, amountDollars)])}
              className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">
              Add lines (items, quantities, prices)
            </button>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => { setIsCreating(false); setLines([]); }}
              className="px-3 py-1.5 text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg"
            >
              Save Estimate
            </button>
          </div>
        </form>
      )}

      {estimates.length > 0 && (
        <div role="group" aria-label="Show" className="flex flex-wrap gap-2">
          {FILTERS.map(f => {
            const count = f.stages ? rows.filter(r => f.stages!.includes(r.stage)).length : rows.length;
            return (
              <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}
                className={`px-3 py-1 text-xs font-semibold rounded-full border ${filter === f.id ? 'bg-[var(--text)] text-[var(--surface)] border-transparent' : 'border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]'}`}>
                {f.label} ({count})
              </button>
            );
          })}
        </div>
      )}

      {/* Estimates Table */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-white dark:bg-slate-900 shadow-2xs">
        {loading ? <LoadingState what="estimates" /> : estimates.length === 0 ? (
          <EmptyState
            title="No estimates yet"
            description="An estimate quotes a price before the sale; once accepted it becomes the invoice without retyping."
            actionLabel={canWrite ? 'Add your first estimate' : undefined}
            onAction={canWrite ? () => setIsCreating(true) : undefined}
          />
        ) : (
          <table className="w-full text-left text-xs">
            <caption className="sr-only">Estimates</caption>
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 text-[var(--muted)] font-semibold uppercase text-[10px]">
                <th scope="col" className="py-3 px-4">Estimate #</th>
                <th scope="col" className="py-3 px-4">Customer</th>
                <th scope="col" className="py-3 px-4">Date</th>
                <th scope="col" className="py-3 px-4">Status</th>
                <th scope="col" className="py-3 px-4 text-right">Amount</th>
                <th scope="col" className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {shownRows.length === 0 && (
                <tr><td colSpan={6} className="p-6 text-center text-[var(--muted)]">Nothing here.</td></tr>
              )}
              {shownRows.map(({ est, progress, stage }) => {
                const attachmentKey = `estimates:${est.id}`;
                const label = `Estimate ${est.number || est.id}`;
                return (
                  <React.Fragment key={attachmentKey}>
                <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                  <td className="py-3 px-4 font-mono font-bold text-slate-900 dark:text-white"><RecordInlineField collection="estimates" record={est} field="number" label={`Reference of estimate ${est.number}`} display={`#${est.number}`} canEdit={est.status === 'draft'} /><div><RecordInlineField collection="estimates" record={est} field="notes" kind="textarea" label={`Notes of estimate ${est.number}`} canEdit={est.status === 'draft'} placeholder="Add notes" /></div></td>
                  <td className="py-3 px-4 text-slate-800 dark:text-slate-200 font-medium">{est.customerName}</td>
                  <td className="py-3 px-4 text-[var(--muted)]"><RecordInlineField collection="estimates" record={est} field="date" kind="date" label={`Date of estimate ${est.number}`} canEdit={est.status === 'draft'} /><div>Expires: <RecordInlineField collection="estimates" record={est} field="expiryDate" kind="date" label={`Expiry of estimate ${est.number}`} canEdit={est.status === 'draft'} placeholder="Add expiry" /></div></td>
                  <td className="py-3 px-4">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${STAGE_STYLE[stage]}`}>
                      {stage}
                    </span>
                    {isOrder(est) && (
                      <div className="mt-1 text-[10px] text-[var(--muted)]">
                        {est.customerReference && <div>Customer ref {est.customerReference}</div>}
                        {progress.invoices.length > 0 && <div>Invoiced {formatCurrency(progress.invoicedCents)} ({progress.invoices.map(inv => inv.number || inv.id).join(', ')})</div>}
                        {progress.leftCents > 0 && <div className="font-semibold text-[var(--text)]">{formatCurrency(progress.leftCents)} left to invoice</div>}
                      </div>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right font-mono font-bold text-slate-900 dark:text-white">
                    {formatCurrency(est.amountCents)}
                    {(() => {
                      const deposit = estimateDeposits(payments || [], est.id);
                      return deposit.receivedCents > 0 ? (
                        <div className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                          Deposit received {formatCurrency(deposit.receivedCents)}{deposit.unappliedCents > 0 && est.status === 'converted' ? ' · apply it on the invoice' : ''}
                        </div>
                      ) : null;
                    })()}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button type="button" aria-expanded={filesOpen(attachmentKey)} aria-label={`Manage files for estimate ${est.number || est.id}`}
                        onClick={() => toggleFiles(attachmentKey)} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-slate-500 hover:text-indigo-600 focus-visible:outline focus-visible:outline-2" title="Files">
                        <Paperclip className="w-4 h-4" aria-hidden="true" />
                      </button>
                      <button
                        onClick={() => setPreviewEstimate(est)}
                        className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md transition-colors"
                        title="Preview PDF"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => downloadDocumentPdf('estimate', est.id, currentWorkspaceId || 'default', `estimate_${est.number || est.id}.pdf`)}
                        className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md transition-colors"
                        title="Download PDF"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                      {canTakeDeposit && !['converted', 'declined', 'expired'].includes(est.status) && (
                        <button type="button" onClick={() => setDepositFor(est)}
                          className="px-2.5 py-1 text-xs font-semibold border border-[var(--line)] text-[var(--text)] rounded-md hover:bg-slate-100 dark:hover:bg-slate-800"
                          aria-label={`Take a deposit for estimate ${est.number || ''}`.trim()}>
                          Deposit
                        </button>
                      )}
                      {canWrite && stage === 'quote' && (
                        <>
                          <button type="button" onClick={() => { setOrdering(est.id); setCustomerReference(''); }}
                            className="px-2.5 py-1 text-xs font-semibold border border-indigo-500/40 text-indigo-600 dark:text-indigo-400 rounded-md hover:bg-indigo-500/10"
                            aria-label={`Make estimate ${est.number || est.id} an order`} title="The customer said yes: invoice it in one go or in parts">
                            Order
                          </button>
                          {currentWorkspaceId && <EstimateSignLink workspaceId={currentWorkspaceId} estimate={est} />}
                          <button type="button" onClick={() => void declineEstimate(est)}
                            className="px-2.5 py-1 text-xs text-[var(--muted)] hover:text-[var(--text)] hover:underline"
                            aria-label={`Mark estimate ${est.number || est.id} declined`}>
                            Declined
                          </button>
                        </>
                      )}
                      {deliveriesShip && isOrder(est) && hasItemLines(est) && stage !== 'declined' && (
                        <button type="button" onClick={() => setDelivering(est)}
                          className="px-2.5 py-1 text-xs font-semibold border border-indigo-500/40 text-indigo-600 dark:text-indigo-400 rounded-md hover:bg-indigo-500/10 ml-1"
                          aria-label={`Deliver order ${est.number || ''}`.trim()} title="Goods leaving: stock goes down and their cost is booked">
                          Deliver
                        </button>
                      )}
                      {canWrite && isOrder(est) && progress.leftCents > 0 && stage !== 'declined' && (
                        <button type="button" onClick={() => setInvoicing(est)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-md transition-colors ml-1"
                          aria-label={`Invoice order ${est.number || ''}`.trim()}>
                          <span>Invoice</span>
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      )}
                      {est.status !== 'converted' && !isOrder(est) && stage !== 'declined' && (
                        <button
                          onClick={() => handleConvertToInvoice(est)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-md transition-colors ml-1"
                        >
                          <span>Convert</span>
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    <EstimateSignedNote signature={est.signature} />
                    {dueMilestones(est.milestones, getLocalDateISO()).slice(0, 1).map(m => <p key={m.id} className="mt-1 text-right text-xs font-semibold text-amber-700 dark:text-amber-400">Milestone due: <bdi>{m.label}</bdi> ({m.percent}%), {formatDate(m.due!)}</p>)}
                    {ordering === est.id && (
                      <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
                        <label className="flex items-center gap-1 text-[var(--muted)]">Customer&apos;s reference
                          <input value={customerReference} onChange={e => setCustomerReference(e.target.value)} placeholder="Their PO number (optional)"
                            className="px-2 py-1 border border-[var(--line)] rounded bg-[var(--panel)] text-[var(--text)]" />
                        </label>
                        <button type="button" onClick={() => void confirmOrder(est)} className="px-2.5 py-1 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white font-semibold">Make it an order</button>
                        <button type="button" onClick={() => setOrdering(null)} className="text-[var(--muted)] hover:underline">Cancel</button>
                      </div>
                    )}
                  </td>
                </tr>
                {filesOpen(attachmentKey) && <tr><td colSpan={6} className="bg-[var(--surface)] p-3">
                  <AttachmentsPanel target={{ collection: 'estimates', id: est.id, label }} workspaceId={est.workspaceId} />
                </td></tr>}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {depositFor && <EstimateDepositDialog estimate={depositFor} onClose={() => setDepositFor(null)} />}
      {delivering && <OrderDeliveryDialog order={delivering} canWrite={canWrite} onClose={() => setDelivering(null)} />}
      {invoicing && (
        <OrderInvoiceDialog estimate={invoicing} progress={orderProgress(invoicing, invoices || [])} currency={invoicing.currency || 'USD'}
          onCreate={part => invoiceOrderPart(invoicing, part)} onClose={() => setInvoicing(null)} canWrite={canWrite} />
      )}
      {previewEstimate && (
        <PdfPreviewModal
          isOpen={!!previewEstimate}
          onClose={() => setPreviewEstimate(null)}
          title={`Estimate ${previewEstimate.number || previewEstimate.id}`}
          documentType="estimate"
          documentId={previewEstimate.id}
          workspaceId={currentWorkspaceId || 'default'}
          filename={`estimate_${previewEstimate.number || previewEstimate.id}.pdf`}
        />
      )}
    </div>
  );
}
