import { useDialog } from '../../hooks/useDialog';
import React, { useState } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { CreditNote, VendorCredit } from '../../types';
import CreditActionDialog from './CreditActionDialog';
import ApplyCreditsButton from './ApplyCreditsButton';
import type { CreditActionTarget } from './CreditActionDialog';
import { EmptyState } from '../ui/EmptyState';
import { Money } from '../ui/Money';
import { Plus, Users, Building2, RotateCcw, Eye, Download, Paperclip } from 'lucide-react';
import { getLocalDateISO } from '../../lib/utils';
import { toast } from 'sonner';
import PdfPreviewModal from '../ui/PdfPreviewModal';
import { downloadDocumentPdf } from '../../services/documentDownloads';
import { useEntityOperations } from '../../hooks/useEntityOperations';
import { creditTaxFrom } from '../../lib/taxCodes';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { LoadingState } from '../ui/LoadingState';
import { Labelled } from '../ui/Labelled';
import InlineEdit from '../ui/InlineEdit';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { nextDocumentNumber } from '../../services/documentNumbers';
import { suggestionsFrom } from '../../lib/inlineEdit';
import { creditDateEditable, duplicateNumber } from '../../lib/creditEdits';
import { returnableLines, returnProblem } from '../../lib/salesReturns';
import ReturnedGoodsFields from './ReturnedGoodsFields';
import VendorReturnFields from './VendorReturnFields';
import AttachmentsPanel from '../common/AttachmentsPanel';
import { returnableBillLines, vendorReturnLines, vendorReturnProblem } from '../../lib/vendorReturns';

export default function CreditNotesView() {
  const [activeTab, setActiveTab] = useState<'customer' | 'vendor'>('customer');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [filesFor, setFilesFor] = useState<{ workspaceId: string; key: string } | null>(null);
  const currentWorkspaceId = useAuthStore(s => s.currentWorkspaceId);
  const filesWorkspaceId = currentWorkspaceId || '';
  const filesOpen = (key: string) => filesFor?.workspaceId === filesWorkspaceId && filesFor.key === key;
  const toggleFiles = (key: string) => setFilesFor(current =>
    current?.workspaceId === filesWorkspaceId && current.key === key ? null : { workspaceId: filesWorkspaceId, key },
  );
  const [previewCreditNote, setPreviewCreditNote] = useState<((CreditNote | VendorCredit) & { pdfKind?: 'vendorCredit' }) | null>(null);

  const customers = useLedgerStore(s => s.customers);
  const vendors = useLedgerStore(s => s.vendors);
  const creditNotes = useLedgerStore(s => s.creditNotes || []);
  const vendorCredits = useLedgerStore(s => s.vendorCredits || []);
  const invoices = useLedgerStore(s => s.invoices || []);
  const transactions = useLedgerStore(s => s.transactions || []);
  const bills = useLedgerStore(s => s.bills || []);
  const { loading } = useLedgerCollections('bills', 'creditNotes', 'customers', 'invoices', 'vendorCredits', 'vendors');
  const workspaceCurrency = useAuthStore(s => s.getCurrentWorkspace()?.currency) || 'USD';

  const { addEntity, updateEntity } = useEntityOperations();
  const role = useCurrentRole();
  const canEdit = role === 'owner' || role === 'accountant' || role === 'bookkeeper';
  const reasonSuggestions = suggestionsFrom([...creditNotes, ...vendorCredits], c => c.reason);
  // the next number of the series, from the server (they were random 4-digit numbers that could repeat)
  const allocate = async (type: 'creditNote' | 'vendorCredit') => {
    try {
      return await nextDocumentNumber(currentWorkspaceId || '', type);
    } catch (err) {
      toast.error('Not saved: no document number', { description: err instanceof Error ? err.message : String(err) });
      return null;
    }
  };
  const [creditAction, setCreditAction] = useState<CreditActionTarget | null>(null);
  const usable = (c: CreditNote | VendorCredit) => (c.status === 'open' || c.status === 'partially_applied') && (c.remainingCents ?? c.amountCents) > 0;

  // Form State
  const [customerId, setCustomerId] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [invoiceId, setInvoiceId] = useState('');
  // BF-06: how many of each stock line of the credited invoice came back
  const [returned, setReturned] = useState<Record<string, string>>({});
  const [billId, setBillId] = useState('');
  // BF-07: units sent back per line of the credited bill
  const [sentBack, setSentBack] = useState<Record<number, string>>({});
  const [amountStr, setAmountStr] = useState('');
  const [reason, setReason] = useState('');
  const [dateStr, setDateStr] = useState(getLocalDateISO(new Date()));
  const [saving, setSaving] = useState(false);
  // one save at a time (a double click made two credit notes)
  const once = (save: (e: React.FormEvent) => Promise<void>) => async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try { await save(e); } catch { /* already reported; the form stays open */ } finally { setSaving(false); }
  };

  const handleCreateCustomerCreditNote = async (e: React.FormEvent) => {
    e.preventDefault();
    const amountCents = Math.round(Number.parseFloat(amountStr || '0') * 100);
    if (!customerId) {
      toast.error('Please select a customer');
      return;
    }
    if (Number.isNaN(amountCents) || amountCents <= 0) {
      toast.error('Please enter a valid positive amount');
      return;
    }

    const number = await allocate('creditNote');
    if (!number) return;
    const customer = customers.find(c => c.id === customerId);
    // A credit for an invoice is in its currency and reverses its share of the tax (L-118)
    const invoice = invoiceId ? invoices.find(i => i.id === invoiceId) : undefined;
    const lines = invoice ? returnableLines(invoice, transactions) : [];
    const returnedGoods = lines.flatMap(l => (Number(returned[l.invoiceLineId]) > 0 ? [{ invoiceLineId: l.invoiceLineId, itemId: l.itemId, quantity: Number(returned[l.invoiceLineId]) }] : []));
    const problem = returnProblem(returnedGoods, lines);
    if (problem) {
      toast.error(problem);
      return;
    }
    const newCreditNote: Partial<CreditNote> = {
      customerId,
      customerName: customer?.name || 'Customer',
      number,
      invoiceId: invoiceId || undefined,
      amountCents,
      remainingCents: amountCents,
      date: dateStr,
      reason: reason || 'Customer Refund / Return Credit',
      status: 'open',
      currency: invoice?.currency || workspaceCurrency,
      ...(invoice?.exchangeRate ? { exchangeRate: invoice.exchangeRate } : {}),
      ...(invoice ? creditTaxFrom(amountCents, invoice) : {}),
      ...(returnedGoods.length > 0 ? { returnedGoods } : {}),
    };

    await addEntity('creditNotes', newCreditNote, `Credit Note ${newCreditNote.number} issued successfully!`);
    resetForm();
  };

  const handleCreateVendorCredit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amountCents = Math.round(Number.parseFloat(amountStr || '0') * 100);
    if (!vendorId) {
      toast.error('Please select a vendor');
      return;
    }
    if (Number.isNaN(amountCents) || amountCents <= 0) {
      toast.error('Please enter a valid positive amount');
      return;
    }

    const bill = billId ? bills.find(b => b.id === billId) : undefined;
    const returnable = bill ? returnableBillLines(bill, vendorCredits) : [];
    const returnedGoods = vendorReturnLines(returnable, Object.fromEntries(Object.entries(sentBack).map(([k, v]) => [Number(k), Number(v) || 0])));
    const goodsProblem = returnedGoods.length ? vendorReturnProblem(returnable, returnedGoods, amountCents, bill ? creditTaxFrom(amountCents, bill).taxAmountCents || 0 : 0) : null;
    if (goodsProblem) {
      toast.error(goodsProblem);
      return;
    }
    const number = await allocate('vendorCredit');
    if (!number) return;
    const vendor = vendors.find(v => v.id === vendorId);
    const newVendorCredit: Partial<VendorCredit> = {
      vendorId,
      vendorName: vendor?.name || 'Vendor',
      number,
      billId: billId || undefined,
      amountCents,
      remainingCents: amountCents,
      date: dateStr,
      reason: reason || 'Vendor Rebate / Supplier Credit',
      status: 'open',
      currency: bill?.currency || workspaceCurrency,
      ...(bill?.exchangeRate ? { exchangeRate: bill.exchangeRate } : {}),
      ...(bill ? creditTaxFrom(amountCents, bill) : {}),
      ...(returnedGoods.length ? { returnedGoods } : {}),
    };

    await addEntity('vendorCredits', newVendorCredit, `Vendor Credit ${newVendorCredit.number} logged successfully!`);
    resetForm();
  };

  const resetForm = () => {
    setCustomerId('');
    setVendorId('');
    setInvoiceId('');
    setReturned({});
    setBillId('');
    setSentBack({});
    setAmountStr('');
    setReason('');
    setShowCreateModal(false);
  };

  const { dialogProps, titleId } = useDialog(() => setShowCreateModal(false), showCreateModal);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <RotateCcw className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
            Credit Notes & Vendor Credits
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            Issue customer refunds and record supplier rebates without corrupting A/R and A/P aging buckets.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ApplyCreditsButton kind={activeTab} />
          {canEdit && <button type="button"
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white font-medium text-sm rounded-lg hover:bg-indigo-700 transition shadow-sm"
          >
            <Plus className="w-4 h-4" />
            {activeTab === 'customer' ? 'New Credit Note' : 'New Vendor Credit'}
          </button>}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-800">
        <button
          onClick={() => setActiveTab('customer')}
          className={`flex items-center gap-2 py-3 px-4 font-medium text-sm border-b-2 transition ${
            activeTab === 'customer'
              ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 dark:border-indigo-400'
              : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400'
          }`}
        >
          <Users className="w-4 h-4" />
          Customer Credit Notes (A/R)
          <span className="ml-1 px-2 py-0.5 text-xs bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 rounded-full font-semibold">
            {creditNotes.length}
          </span>
        </button>
        <button
          onClick={() => setActiveTab('vendor')}
          className={`flex items-center gap-2 py-3 px-4 font-medium text-sm border-b-2 transition ${
            activeTab === 'vendor'
              ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 dark:border-indigo-400'
              : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400'
          }`}
        >
          <Building2 className="w-4 h-4" />
          Vendor Credits (A/P)
          <span className="ml-1 px-2 py-0.5 text-xs bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 rounded-full font-semibold">
            {vendorCredits.length}
          </span>
        </button>
      </div>

      {/* Main List */}
      {activeTab === 'customer' ? (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden shadow-sm">
          {loading ? <LoadingState what="credit notes" /> : creditNotes.length === 0 ? (
            <EmptyState
              title="No Customer Credit Notes"
              description="Issue credit notes for refunds or overbilling adjustments."
              actionLabel="New Credit Note"
              onAction={() => setShowCreateModal(true)}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Credit notes</caption>
                <thead className="bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 uppercase text-xs">
                  <tr>
                    <th scope="col" className="p-3">Number</th>
                    <th scope="col" className="p-3">Customer</th>
                    <th scope="col" className="p-3">Date</th>
                    <th scope="col" className="p-3">Reason</th>
                    <th scope="col" className="p-3 text-right">Amount</th>
                    <th scope="col" className="p-3 text-right">Remaining Credit</th>
                    <th scope="col" className="p-3 text-center">Status</th>
                    <th scope="col" className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                  {creditNotes.map(cn => {
                    const attachmentKey = `creditNotes:${cn.id}`;
                    const label = `Credit note ${cn.number || cn.id}`;
                    return (
                      <React.Fragment key={attachmentKey}>
                    <tr className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                      <td className="p-3 font-mono font-medium text-indigo-600 dark:text-indigo-400">
                        <InlineEdit value={cn.number} label={`Number of credit note ${cn.number || ''}`.trim()} canEdit={canEdit}
                          validate={x => duplicateNumber(creditNotes, cn.id, String(x))}
                          onSave={x => updateEntity('creditNotes', cn.id, { number: String(x) }, 'Credit note number saved')} />
                      </td>
                      <td className="p-3 font-medium text-gray-900 dark:text-white">{cn.customerName}</td>
                      <td className="p-3 text-gray-600 dark:text-gray-400">
                        <InlineEdit kind="date" value={cn.date?.slice(0, 10)} label={`Date of credit note ${cn.number}`} canEdit={canEdit && creditDateEditable(cn)}
                          onSave={x => updateEntity('creditNotes', cn.id, { date: String(x) }, 'Date saved')} />
                      </td>
                      <td className="p-3 text-gray-600 dark:text-gray-400">
                        <InlineEdit value={cn.reason} label={`Reason for credit note ${cn.number}`} placeholder="Add a reason" canEdit={canEdit} suggestions={reasonSuggestions}
                          onSave={x => updateEntity('creditNotes', cn.id, { reason: String(x) }, 'Reason saved')} />
                      </td>
                      <td className="p-3 text-right font-semibold text-gray-900 dark:text-white"><Money cents={cn.amountCents} currency={cn.currency} colored /></td>
                      <td className="p-3 text-right font-medium text-indigo-600 dark:text-indigo-400"><Money cents={cn.remainingCents} currency={cn.currency} colored /></td>
                      <td className="p-3 text-center">
                        <span className="px-2 py-1 text-xs rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 font-semibold">
                          {cn.status.toUpperCase()}
                        </span>
                      </td>
                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button type="button" aria-expanded={filesOpen(attachmentKey)} aria-label={`Manage files for credit note ${cn.number || ''}`.trim()}
                            onClick={() => toggleFiles(attachmentKey)}
                            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-gray-500 hover:text-indigo-600 focus-visible:outline focus-visible:outline-2" title="Files">
                            <Paperclip className="w-4 h-4" aria-hidden="true" />
                          </button>
                          {usable(cn) && (
                            <>
                              <button type="button" onClick={() => setCreditAction({ kind: 'customer', mode: 'apply', id: cn.id, number: cn.number, partyId: cn.customerId, partyName: cn.customerName, remainingCents: cn.remainingCents, currency: cn.currency })} className="rounded-md border border-[var(--line)] px-2 py-1 text-xs font-bold hover:border-[var(--brass-line)]">Apply</button>
                              <button type="button" onClick={() => setCreditAction({ kind: 'customer', mode: 'refund', id: cn.id, number: cn.number, partyId: cn.customerId, partyName: cn.customerName, remainingCents: cn.remainingCents, currency: cn.currency })} className="rounded-md border border-[var(--line)] px-2 py-1 text-xs font-bold hover:border-[var(--brass-line)]">Refund</button>
                            </>
                          )}
                          <button type="button" aria-label={`Preview PDF of credit note ${cn.number || ''}`.trim()}
                            onClick={() => setPreviewCreditNote(cn)}
                            className="p-1.5 text-gray-500 hover:text-indigo-600 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors"
                            title="Preview PDF"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button type="button" aria-label={`Download PDF of credit note ${cn.number || ''}`.trim()}
                            onClick={() => downloadDocumentPdf('creditNote', cn.id, currentWorkspaceId || 'default', `credit_note_${cn.number || cn.id}.pdf`)}
                            className="p-1.5 text-gray-500 hover:text-indigo-600 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors"
                            title="Download PDF"
                          >
                            <Download className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {filesOpen(attachmentKey) && <tr><td colSpan={8} className="bg-[var(--surface)] p-3">
                      <AttachmentsPanel target={{ collection: 'creditNotes', id: cn.id, label }} />
                    </td></tr>}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden shadow-sm">
          {loading ? <LoadingState what="vendor credits" /> : vendorCredits.length === 0 ? (
            <EmptyState
              title="No Vendor Credits"
              description="Record rebates, returned goods, or price adjustments from suppliers."
              actionLabel="New Vendor Credit"
              onAction={() => setShowCreateModal(true)}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Vendor credits</caption>
                <thead className="bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 uppercase text-xs">
                  <tr>
                    <th scope="col" className="p-3">Number</th>
                    <th scope="col" className="p-3">Vendor</th>
                    <th scope="col" className="p-3">Date</th>
                    <th scope="col" className="p-3">Reason</th>
                    <th scope="col" className="p-3 text-right">Amount</th>
                    <th scope="col" className="p-3 text-right">Remaining Credit</th>
                    <th scope="col" className="p-3 text-center">Status</th>
                    <th scope="col" className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                  {vendorCredits.map(vc => {
                    const attachmentKey = `vendorCredits:${vc.id}`;
                    const label = `Vendor credit ${vc.number || vc.id}`;
                    return (
                      <React.Fragment key={attachmentKey}>
                    <tr className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                      <td className="p-3 font-mono font-medium text-emerald-600 dark:text-emerald-400">
                        <InlineEdit value={vc.number} label={`Number of vendor credit ${vc.number || ''}`.trim()} canEdit={canEdit}
                          validate={x => duplicateNumber(vendorCredits, vc.id, String(x))}
                          onSave={x => updateEntity('vendorCredits', vc.id, { number: String(x) }, 'Vendor credit number saved')} />
                      </td>
                      <td className="p-3 font-medium text-gray-900 dark:text-white">{vc.vendorName}</td>
                      <td className="p-3 text-gray-600 dark:text-gray-400">
                        <InlineEdit kind="date" value={vc.date?.slice(0, 10)} label={`Date of vendor credit ${vc.number}`} canEdit={canEdit && creditDateEditable(vc)}
                          onSave={x => updateEntity('vendorCredits', vc.id, { date: String(x) }, 'Date saved')} />
                      </td>
                      <td className="p-3 text-gray-600 dark:text-gray-400">
                        <InlineEdit value={vc.reason} label={`Reason for vendor credit ${vc.number}`} placeholder="Add a reason" canEdit={canEdit} suggestions={reasonSuggestions}
                          onSave={x => updateEntity('vendorCredits', vc.id, { reason: String(x) }, 'Reason saved')} />
                      </td>
                      <td className="p-3 text-right font-semibold text-gray-900 dark:text-white"><Money cents={vc.amountCents} currency={vc.currency} colored /></td>
                      <td className="p-3 text-right font-medium text-emerald-600 dark:text-emerald-400"><Money cents={vc.remainingCents} currency={vc.currency} colored /></td>
                      <td className="p-3 text-center">
                        <span className="px-2 py-1 text-xs rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 font-semibold">
                          {vc.status.toUpperCase()}
                        </span>
                      </td>
                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button type="button" aria-expanded={filesOpen(attachmentKey)} aria-label={`Manage files for vendor credit ${vc.number || ''}`.trim()}
                            onClick={() => toggleFiles(attachmentKey)}
                            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-gray-500 hover:text-indigo-600 focus-visible:outline focus-visible:outline-2" title="Files">
                            <Paperclip className="w-4 h-4" aria-hidden="true" />
                          </button>
                          {usable(vc) && (<>
                            <button type="button" onClick={() => setCreditAction({ kind: 'vendor', mode: 'apply', id: vc.id, number: vc.number, partyId: vc.vendorId, partyName: vc.vendorName, remainingCents: vc.remainingCents, currency: vc.currency })} className="rounded-md border border-[var(--line)] px-2 py-1 text-xs font-bold hover:border-[var(--brass-line)]">Apply</button>
                            <button type="button" onClick={() => setCreditAction({ kind: 'vendor', mode: 'refund', id: vc.id, number: vc.number, partyId: vc.vendorId, partyName: vc.vendorName, remainingCents: vc.remainingCents, currency: vc.currency })} className="rounded-md border border-[var(--line)] px-2 py-1 text-xs font-bold hover:border-[var(--brass-line)]">Refund</button>
                          </>)}
                          <button type="button" onClick={() => setPreviewCreditNote({ ...vc, pdfKind: 'vendorCredit' })} aria-label={`PDF of vendor credit ${vc.number || ''}`.trim()} className="rounded-md border border-[var(--line)] px-2 py-1 text-xs font-bold hover:border-[var(--brass-line)]">PDF</button>
                        </div>
                      </td>
                    </tr>
                    {filesOpen(attachmentKey) && <tr><td colSpan={8} className="bg-[var(--surface)] p-3">
                      <AttachmentsPanel target={{ collection: 'vendorCredits', id: vc.id, label }} />
                    </td></tr>}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {creditAction && <CreditActionDialog target={creditAction} onClose={() => setCreditAction(null)} />}

      {/* Create Modal */}
      {showCreateModal && (
        <div {...dialogProps} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6 w-full max-w-lg shadow-xl space-y-4">
            <h2 id={titleId} className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <RotateCcw className="w-5 h-5 text-indigo-600" />
              {activeTab === 'customer' ? 'Issue Customer Credit Note' : 'Record Vendor Credit'}
            </h2>

            <form onSubmit={once(activeTab === 'customer' ? handleCreateCustomerCreditNote : handleCreateVendorCredit)} className="space-y-4">
              {activeTab === 'customer' ? (
                <div>
                  <Labelled labelClassName="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1" label="Select Customer">
                    <select
                      value={customerId}
                      onChange={(e) => setCustomerId(e.target.value)}
                      required
                      className="w-full p-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white"
                    >
                      <option value="">-- Choose Customer --</option>
                      {customers.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </Labelled>
                  {/* BF-06: the invoice the credit is for, and the goods that came back from it */}
                  {customerId && (
                    <div className="mt-3 space-y-3">
                      <Labelled labelClassName="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1" label="For invoice (optional)">
                        <select value={invoiceId} onChange={(e) => { setInvoiceId(e.target.value); setReturned({}); }}
                          className="w-full p-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white">
                          <option value="">-- Not for one invoice --</option>
                          {invoices.filter(i => i.customerId === customerId && !['draft', 'void', 'cancelled'].includes(String(i.status))).map(i => (
                            <option key={i.id} value={i.id}>{i.number || i.id} · {i.date}</option>
                          ))}
                        </select>
                      </Labelled>
                      {invoiceId && (() => {
                        const invoice = invoices.find(i => i.id === invoiceId);
                        return invoice ? (
                          <ReturnedGoodsFields lines={returnableLines(invoice, transactions)} value={returned} onChange={setReturned}
                            currency={invoice.currency || workspaceCurrency} onUsePrice={cents => setAmountStr((cents / 100).toFixed(2))} />
                        ) : null;
                      })()}
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <Labelled labelClassName="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1" label="Select Vendor">
                    <select
                      value={vendorId}
                      onChange={(e) => { setVendorId(e.target.value); setBillId(''); setSentBack({}); }}
                      required
                      className="w-full p-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white"
                    >
                      <option value="">-- Choose Vendor --</option>
                      {vendors.map(v => (
                        <option key={v.id} value={v.id}>{v.name}</option>
                      ))}
                    </select>
                  </Labelled>
                  {vendorId && (
                    <Labelled labelClassName="block text-sm font-medium text-gray-700 dark:text-gray-300 mt-3 mb-1" label="Credited bill (optional)">
                      <select value={billId} onChange={e => { setBillId(e.target.value); setSentBack({}); }}
                        className="w-full p-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white">
                        <option value="">None</option>
                        {bills.filter(b => b.vendorId === vendorId && !['void', 'draft', 'cancelled', 'rejected'].includes(String(b.status))).map(b => (
                          <option key={b.id} value={b.id}>{b.number || b.id} · {b.date || ''}</option>
                        ))}
                      </select>
                    </Labelled>
                  )}
                  {billId && (() => {
                    const bill = bills.find(b => b.id === billId);
                    return bill ? (
                      <div className="mt-3">
                        <VendorReturnFields lines={returnableBillLines(bill, vendorCredits)} value={sentBack} onChange={setSentBack}
                          currency={bill.currency || workspaceCurrency} onUseCost={cents => setAmountStr((cents / 100).toFixed(2))} />
                      </div>
                    ) : null;
                  })()}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Labelled labelClassName="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1" label={`Amount (${workspaceCurrency})`}>
                    <input
                      type="number"
                      step="0.01"
                      value={amountStr}
                      onChange={(e) => setAmountStr(e.target.value)}
                      placeholder="0.00"
                      required
                      className="w-full p-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white"
                    />
                  </Labelled>
                </div>
                <div>
                  <Labelled labelClassName="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1" label="Date">
                    <input
                      type="date"
                      value={dateStr}
                      onChange={(e) => setDateStr(e.target.value)}
                      required
                      className="w-full p-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white"
                    />
                  </Labelled>
                </div>
              </div>

              <div>
                <Labelled labelClassName="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1" label="Reason / Description">
                  <input
                    type="text"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder={activeTab === 'customer' ? 'e.g. Returned merchandise / price adjustment' : 'e.g. Volume discount rebate'}
                    className="w-full p-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white"
                  />
                </Labelled>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit" disabled={saving}
                  className="px-4 py-2 bg-indigo-600 text-white font-medium text-sm rounded-lg hover:bg-indigo-700 transition disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save & Post'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {previewCreditNote && (
        <PdfPreviewModal
          isOpen={!!previewCreditNote}
          onClose={() => setPreviewCreditNote(null)}
          title={`${previewCreditNote.pdfKind === 'vendorCredit' ? 'Vendor Credit' : 'Credit Note'} ${previewCreditNote.number || previewCreditNote.id}`}
          documentType={previewCreditNote.pdfKind === 'vendorCredit' ? 'vendorCredit' : 'creditNote'}
          documentId={previewCreditNote.id}
          workspaceId={currentWorkspaceId || 'default'}
          filename={`${previewCreditNote.pdfKind === 'vendorCredit' ? 'vendor_credit' : 'credit_note'}_${previewCreditNote.number || previewCreditNote.id}.pdf`}
        />
      )}
    </div>
  );
}
