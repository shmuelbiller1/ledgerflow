import { useDialog } from '../../hooks/useDialog';
import { useSuggestedRate } from '../../hooks/useSuggestedRate';
import { documentCurrencies } from '../../lib/exchangeRates';
import { latestDocumentFor } from '../../lib/repeatDocument';
import { calculateDueDate, isFixedTerm, termsForCustomer } from '../../lib/paymentTerms';
import { isArchivedParty } from '../../lib/contacts';
import { TruthEngine } from '../../modules/integrity/TruthEngine';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { isIncomeAccount, isUndepositedFundsAccount, resolveAccountRole } from '../../lib/accountUtils';
import { X, Save, Download, Eye } from 'lucide-react';
import { motion } from 'motion/react';
import { Invoice, Customer, ChartAccount } from '../../types';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { getIdToken } from '../../firebase';
import AsyncButton from '../ui/AsyncButton';
import PdfPreviewModal from '../ui/PdfPreviewModal';
import { downloadDocumentPdf } from '../../services/documentDownloads';
import { amountStep, formatCurrency, getLocalDateISO, minorToMajor, safeConfirm } from '../../lib/utils';
import TaxExemptionNotice from './TaxExemptionNotice'; import { taxChoiceFor } from '../../lib/tax/resolveLineTax'; import { lineTaxCategory, saleDestinationSnapshot } from '../../lib/tax/usInvoiceTax'; import CreditLimitRefusalPanel from './CreditLimitRefusalPanel'; import { reportCreditLimitRefusal } from '../../lib/creditLimitPrompt';
import { customRateCode, documentTotals, effectiveRate, taxCodeFromRate, TAX_TREATMENTS } from '../../lib/taxCodes';
import { depositAppliedCents } from '../../lib/documentMath';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import AttachmentsPanel from '../common/AttachmentsPanel';
import DocumentLineEditor, { type InvoiceEditorLine } from '../common/DocumentLineEditor';
import { attachmentProblem } from '../../lib/attachments';

interface InvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** `attachmentFiles`: files picked for a new invoice, kept with it once it is saved (K-07) */
  onSave: (invoice: Partial<Invoice> & { attachmentFiles?: File[] }) => void;
  customers: Customer[];
  accounts: ChartAccount[];
  initialInvoice?: Partial<Invoice>;
  /** A sale receipt (K-03): paid on the spot; saved as an issued invoice with its payment recorded at once. */
  receipt?: boolean;
}

/** What a sale receipt adds to the saved invoice: where the money went and how (not stored on the invoice). */
export interface ReceiptPayment { cashAccountId: string; method: string }

function createInvoiceFormState(initialInvoice?: Partial<Invoice>): Partial<Invoice> {
  const today = format(new Date(), 'yyyy-MM-dd');
  return {
    number: `INV-${Date.now().toString().slice(-6)}`,
    date: today,
    status: 'pending',
    amountCents: 0,
    ...initialInvoice,
    // Older records may predate dueDate. Match aging's fallback instead of blocking an unrelated edit.
    dueDate: initialInvoice?.dueDate || initialInvoice?.date || today,
  };
}

export default function InvoiceModal({ isOpen, onClose, onSave, customers = [], accounts = [], initialInvoice, receipt = false }: InvoiceModalProps) {
  // Ensure we have arrays even if props were passed as null
  // archived contacts aren't offered for new documents; one already on this document stays (I-22)
  const safeCustomers = (Array.isArray(customers) ? customers : []).filter(c => !isArchivedParty(c) || c.id === initialInvoice?.customerId);
  const safeAccounts = Array.isArray(accounts) ? accounts.filter(a => isIncomeAccount(a)) : [];
  const currentWorkspaceId = useAuthStore(s => s.currentWorkspaceId);
  const workspaceCurrency = useAuthStore(s => s.getCurrentWorkspace()?.currency) || 'USD';
  const inventoryItems = useLedgerStore(s => s.inventory || []);
  const { loading: inventoryLoading } = useLedgerCollections('inventory', 'invoices'); const inventoryCapped = useLedgerStore(s => Boolean(s.truncatedCollections?.inventory));
  const pastInvoices = useLedgerStore(s => s.invoices);
  const [showPdfPreview, setShowPdfPreview] = useState(false);
  // a sale receipt goes into a bank account or Undeposited Funds (then "Make deposit" takes it to the bank)
  const chartAccounts = useLedgerStore(s => s.accounts);
  const paidIntoChoices = useMemo(() => (chartAccounts || []).filter(a => !a.isArchived && (resolveAccountRole(a) === 'cash' || isUndepositedFundsAccount(a))), [chartAccounts]);
  const [receiptAccountId, setReceiptAccountId] = useState('');
  const [receiptMethod, setReceiptMethod] = useState('card');
  const paidIntoId = receiptAccountId || (paidIntoChoices.find(isUndepositedFundsAccount) || paidIntoChoices[0])?.id || '';

  const [invoice, setInvoice] = useState<Partial<Invoice>>(() => createInvoiceFormState(initialInvoice));

  const [items, setItems] = useState<InvoiceEditorLine[]>([
    { id: crypto.randomUUID(), description: '', quantity: 1, rateCents: 0, amountCents: 0, accountId: '' }
  ]);

  const [filledFrom, setFilledFrom] = useState<Partial<Invoice> | undefined>(undefined);
  if (isOpen && initialInvoice && initialInvoice !== filledFrom) {
    // Copy a changed pre-filled invoice once per opening (adjusting state during render).
    setFilledFrom(initialInvoice);
    // Replace an existing invoice without leaking the previous record's optional fields.
    setInvoice(prev => (initialInvoice.id ? createInvoiceFormState(initialInvoice) : { ...prev, ...initialInvoice }));
    if (initialInvoice.items && initialInvoice.items.length > 0) {
      setItems(initialInvoice.items);
    }
  }

  const editingExisting = Boolean(initialInvoice?.id);
  useEffect(() => {
    // a new invoice gets the next number; an existing one keeps its own
    if (isOpen && !editingExisting) {
      const fetchNextNumber = async () => {
        try {
          const wsId = useAuthStore.getState().currentWorkspaceId;
          if (!wsId) return;
          const token = await getIdToken().catch(() => '');
          const res = await fetch(`/api/v1/workspaces/${wsId}/next-number`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { 'Authorization': `Bearer ${token}` } : {})
            },
            body: JSON.stringify({ type: 'invoice' })
          });
          if (res.ok) {
            const data = await res.json();
            if (data.number) {
              setInvoice(prev => ({ ...prev, number: data.number }));
            }
          }
        } catch (e) {
          console.error('Failed to fetch next invoice number', e);
        }
      };
      void fetchNextNumber();
    }
  }, [isOpen, editingExisting]);

  // an edited invoice keeps its memo, terms and email text (they were saved in metadata)
  const savedText = (key: string) => {
    const v = (initialInvoice?.metadata as Record<string, unknown> | undefined)?.[key];
    return typeof v === 'string' ? v : '';
  };
  const [memo, setMemo] = useState(() => savedText('memo'));
  const [terms, setTerms] = useState(() => savedText('terms'));
  const [emailSubject, setEmailSubject] = useState(() => savedText('emailSubject'));
  const [emailBody] = useState(() => savedText('emailBody'));
  const formRef = useRef<HTMLFormElement>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const fieldError = (id: string) => fieldErrors[id]
    ? <p id={`${id}-error`} role="alert" className="text-xs text-rose-600 dark:text-rose-400 mt-1">{fieldErrors[id]}</p>
    : null;
  const showFieldError = (id: string, message: string) => {
    setFieldErrors(prev => ({ ...prev, [id]: message }));
    document.getElementById(id)?.focus();
  };
  const [isSubmitting, setIsSubmitting] = useState(false); const lastStatus = useRef<Invoice['status']>('pending'); // EG-5: the status a credit-limit override resends
  const [attachments, setAttachments] = useState<File[]>([]);
  const total = items.reduce((sum, item) => sum + item.amountCents, 0);
  // Tax: a saved tax code (Settings → Tax), or a custom rate typed here (older invoices)
  const taxRates = useLedgerStore(s => s.taxRates || []);
  const salesCodes = useMemo(() => taxRates.filter(r => r.type === 'Sales' && r.appliesTo !== 'purchases').map(taxCodeFromRate), [taxRates]);
  const taxChoice = invoice.taxCodeId || (Number(invoice.taxRate) > 0 ? 'custom' : '');
  const taxCode = taxChoice === 'custom' ? customRateCode(Number(invoice.taxRate) || 0) : salesCodes.find(c => c.id === taxChoice) || null;
  const pricesIncludeTax = invoice.pricesIncludeTax ?? (invoice.taxVersion === 2 ? false : Boolean(invoice.taxInclusive));
  const totals = documentTotals(total, invoice.discountCents || 0, taxCode, pricesIncludeTax);
  const depositCents = depositAppliedCents({ amountCents: totals.amountCents, depositCents: invoice.depositCents });
  const currency = invoice.currency || workspaceCurrency;
  // the rate fills itself in for another currency until the person types one (BA-06, I-23)
  const [rateTyped, setRateTyped] = useState(false);
  const rateNote = useSuggestedRate({
    currency, homeCurrency: workspaceCurrency, enabled: !editingExisting && !rateTyped, docs: pastInvoices, date: invoice.date,
    onRate: (rate, from) => setInvoice(prev => ({ ...prev, exchangeRate: rate, metadata: { ...prev.metadata, rateUsed: { rate, ...from } } })), // BM-06: where it came from
  });
  // I-23: a new invoice for a customer can copy the lines of their latest invoice
  const lastForCustomer = !editingExisting && invoice.customerId
    ? latestDocumentFor(pastInvoices, d => d.customerId === invoice.customerId, d => d.items) : null;
  const linesEmpty = items.every(i => !i.description.trim() && !i.amountCents && !i.itemId);
  const repeatLast = () => {
    if (!lastForCustomer?.items) return;
    setItems(lastForCustomer.items.map(i => ({ ...i, id: crypto.randomUUID() })));
    setInvoice(prev => ({
      ...prev,
      ...(lastForCustomer.taxCodeId ? { taxCodeId: lastForCustomer.taxCodeId } : {}),
      ...(lastForCustomer.pricesIncludeTax !== undefined ? { pricesIncludeTax: lastForCustomer.pricesIncludeTax } : {}),
      ...(lastForCustomer.discountCents ? { discountCents: lastForCustomer.discountCents } : {}),
    }));
    setDirty(true);
  };
  const currencyChoices = useMemo(() => documentCurrencies(workspaceCurrency, currency, [...pastInvoices, ...safeCustomers]), [workspaceCurrency, currency, pastInvoices, safeCustomers]);
  const money = (cents: number) => formatCurrency(cents, currency);

  const handleAction = async (e: React.FormEvent | null, actionStatus: Invoice['status'], creditLimitOverride?: { reason: string }) => {
    e?.preventDefault();
    if (isSubmitting) return;
    if (!formRef.current?.reportValidity()) return;
    if (!invoice.customerId) {
      showFieldError('inv-customer', 'Please select a customer');
      return;
    }
    if ((invoice.depositCents || 0) > totals.amountCents) {
      showFieldError('inv-deposit', "The deposit can't be more than the invoice total");
      return;
    }
    if (receipt && !paidIntoId) {
      showFieldError('inv-paid-into', 'Add a bank account (or Undeposited Funds) to the chart first: a sale receipt needs somewhere the money went');
      return;
    }
    
    setIsSubmitting(true); lastStatus.current = actionStatus; reportCreditLimitRefusal(null);
    try {
      await onSave({
        ...invoice,
        status: actionStatus, ...(creditLimitOverride ? { creditLimitOverride } : {}), // EG-5: sent beside the document (postingKit)
        ...(receipt ? { paymentTerms: 'due_on_receipt', dueDate: invoice.date, receiptPayment: { cashAccountId: paidIntoId, method: receiptMethod } as ReceiptPayment } : {}),
        currency,
        // the total owed (after the discount, tax included) and the tax, explicitly (taxCodes.ts)
        amountCents: totals.amountCents,
        lineSumCents: totals.subtotalCents,
        discountCents: totals.discountCents,
        taxAmountCents: totals.taxCents,
        taxInclusive: true,
        taxVersion: 2,
        pricesIncludeTax,
        taxCodeId: taxCode?.id,
        taxTreatment: taxCode?.treatment,
        taxBreakdown: totals.components,
        taxRate: taxCode ? Math.round(effectiveRate(taxCode.components) * 100000) / 1000 : 0,
        items,
        metadata: {
          ...(invoice.metadata || {}),
          ...(receipt ? { saleReceipt: true } : {}),
          memo,
          terms,
          emailSubject,
          emailBody,
          ...saleDestinationSnapshot({ status: actionStatus, customerId: invoice.customerId, initial: initialInvoice, customers: safeCustomers }), // #255: where the sale went, kept
        },
        // files picked for a new invoice are kept with it once it has an id (Sales.tsx)
        ...(attachments.length > 0 && !invoice.id ? { attachmentFiles: attachments } : {}),
      });
      return true;
    } catch (err) { console.warn('Invoice not saved (PREV-5: the save said why; the draft stays open):', err); return false; }
    finally { setIsSubmitting(false); }
  };

  const handleSubmit = (e: React.FormEvent) => handleAction(e, invoice.status || 'pending');

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files || []);
    e.target.value = '';
    const refused = picked.map(f => attachmentProblem(f)).filter(Boolean);
    if (refused.length) toast.error(refused.join('; '));
    setAttachments(prev => [...prev, ...picked.filter(f => !attachmentProblem(f))]);
  };

  // I-07: closing with unsaved edits asks first
  const [dirty, setDirty] = useState(false);
  const requestClose = () => {
    if (!dirty || safeConfirm('Discard your changes to this invoice?')) onClose();
  };

  const { dialogProps, titleId } = useDialog(requestClose, isOpen);
  if (!isOpen) return null;

  return (
    <div {...dialogProps} className="fixed inset-0 z-[600] flex items-center justify-center p-2 sm:p-4">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={requestClose}
        className="absolute inset-0 bg-zinc-900/40 backdrop-blur-sm"
      />
      
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="relative w-full max-w-4xl bg-[var(--surface)] rounded-2xl sm:rounded-[32px] shadow-2xl border border-[var(--line)] overflow-hidden flex flex-col max-h-[96dvh] sm:max-h-[90dvh]"
      >
        <div className="p-4 md:p-8 border-b border-[var(--line)] flex items-center justify-between bg-[var(--ink)]/50">
          <div>
            <h2 id={titleId} className="text-2xl font-black text-[var(--text)] tracking-tight">{receipt ? 'New sale receipt' : editingExisting ? `Edit invoice ${invoice.number || ''}`.trim() : 'New invoice'}</h2>
            <p className="text-xs text-zinc-500 font-bold uppercase tracking-widest">Sales & Receivables</p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => window.print()} className="min-h-11 min-w-11 flex items-center justify-center p-2 hover:bg-[var(--elevated)] rounded-full transition-colors text-zinc-400" title="Print invoice" aria-label="Print invoice">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
            </button>
            <button title="Close" aria-label="Close" onClick={requestClose} className="min-h-11 min-w-11 flex items-center justify-center p-2 hover:bg-[var(--elevated)] rounded-full transition-colors text-zinc-400"><X size={24} /></button>
          </div>
        </div>

        <form ref={formRef} onSubmit={handleSubmit} onInvalid={e => {
          const field = e.target as unknown as HTMLInputElement;
          if (field.id) setFieldErrors(prev => ({ ...prev, [field.id]: field.validationMessage }));
        }} onChange={e => {
          setDirty(true);
          const field = e.target as unknown as HTMLInputElement;
          if (field.id) setFieldErrors(prev => ({ ...prev, [field.id]: '' }));
        }} className="flex-1 min-h-0 overflow-y-auto p-4 md:p-8 space-y-8 custom-scrollbar">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="space-y-2">
              <label htmlFor="inv-customer" className="micro-label">Customer</label>
              <div className="relative">
                <input id="inv-customer" aria-invalid={Boolean(fieldErrors["inv-customer"])} aria-describedby={fieldErrors["inv-customer"] ? 'inv-customer-error' : undefined}
                  required
                  list="invoice-customer-list"
                  value={invoice.customerName || invoice.customerId || ''}
                  onChange={(e) => {
                    const cust = safeCustomers.find(c => c.name === e.target.value || c.id === e.target.value);
                    // a new invoice starts in the customer's currency (Y-22); an existing one keeps its own
                    const custCurrency = cust && !editingExisting ? (cust.currency || workspaceCurrency) : null;
                    const currencyChange = custCurrency && custCurrency !== currency ? { currency: custCurrency, exchangeRate: 1 } : {};
                    // a new invoice takes the customer's usual terms, and the due date follows (I-23)
                    const terms = !editingExisting ? termsForCustomer(cust as { id: string; paymentTerms?: string } | undefined, pastInvoices) : null;
                    const termsChange = terms ? { paymentTerms: terms, dueDate: calculateDueDate(invoice.date || '', terms) } : {};
                    setInvoice({ ...invoice, customerId: cust ? cust.id : `new-${crypto.randomUUID()}`, customerName: cust ? cust.name : e.target.value, ...currencyChange, ...termsChange });
                  }}
                  placeholder="Type or select customer"
                  className="w-full px-5 py-3 bg-[var(--ink)] border border-[var(--line)] rounded-[32px] focus:ring-2 focus:ring-zinc-900 outline-none font-bold"
                />{fieldError("inv-customer")}
                <datalist id="invoice-customer-list">
                  {safeCustomers.map(c => <option key={c.id} value={c.name} />)}
                </datalist>
              </div>
            </div>
            <div className="space-y-2">
              <label htmlFor="inv-number" className="micro-label">Invoice Number</label>
              <input id="inv-number" aria-invalid={Boolean(fieldErrors["inv-number"])} aria-describedby={fieldErrors["inv-number"] ? 'inv-number-error' : undefined}
                type="text"
                required
                value={invoice.number}
                onChange={(e) => setInvoice({ ...invoice, number: e.target.value })}
                className="w-full px-5 py-3 bg-[var(--ink)] border border-[var(--line)] rounded-[32px] focus:ring-2 focus:ring-zinc-900 outline-none font-mono font-bold"
              />{fieldError("inv-number")}
            </div>
            <div className="space-y-2">
              <label htmlFor="inv-status" className="micro-label">Status</label>
              <select id="inv-status" aria-invalid={Boolean(fieldErrors["inv-status"])} aria-describedby={fieldErrors["inv-status"] ? 'inv-status-error' : undefined}
                value={invoice.status}
                onChange={(e) => setInvoice({ ...invoice, status: e.target.value as Invoice['status'] })}
                className="w-full px-5 py-3 bg-[var(--ink)] border border-[var(--line)] rounded-[32px] focus:ring-2 focus:ring-zinc-900 outline-none font-bold"
              >
                <option value="pending">Pending</option>
                <option value="sent">Sent</option>
                <option value="paid">Paid</option>
                <option value="overdue">Overdue</option>
              </select>{fieldError("inv-status")}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="space-y-2">
              <label htmlFor="inv-type" className="micro-label">Invoice Type</label>
              <select id="inv-type" aria-invalid={Boolean(fieldErrors["inv-type"])} aria-describedby={fieldErrors["inv-type"] ? 'inv-type-error' : undefined}
                value={invoice.type || 'standard'}
                onChange={(e) => setInvoice({ ...invoice, type: e.target.value as NonNullable<Invoice['type']> })}
                className="w-full px-5 py-3 bg-[var(--ink)] border border-[var(--line)] rounded-[32px] focus:ring-2 focus:ring-zinc-900 outline-none font-bold"
              >
                <option value="standard">Standard</option>
                <option value="recurring">Recurring</option>
                <option value="progress">Progress</option>
              </select>{fieldError("inv-type")}
            </div>
            
            <div className="space-y-2">
              <label htmlFor="inv-payment-terms" className="micro-label">Payment Terms</label>
              <select id="inv-payment-terms" aria-invalid={Boolean(fieldErrors["inv-payment-terms"])} aria-describedby={fieldErrors["inv-payment-terms"] ? 'inv-payment-terms-error' : undefined}
                value={invoice.paymentTerms || 'due_on_receipt'}
                // the due date follows the terms (it stayed on the invoice date before; L-186)
                onChange={(e) => setInvoice({ ...invoice, paymentTerms: e.target.value, ...(isFixedTerm(e.target.value) ? { dueDate: calculateDueDate(invoice.date || '', e.target.value) } : {}) })}
                className="w-full px-5 py-3 bg-[var(--ink)] border border-[var(--line)] rounded-[32px] focus:ring-2 focus:ring-zinc-900 outline-none font-bold"
              >
                <option value="due_on_receipt">Due on Receipt</option>
                <option value="net_15">Net 15</option>
                <option value="net_30">Net 30</option>
                <option value="net_60">Net 60</option>
              </select>{fieldError("inv-payment-terms")}
            </div>

            {invoice.type === 'recurring' && (
               <div className="space-y-2">
                 <label htmlFor="inv-recurring-interval" className="micro-label">Recurring Interval</label>
                 <select id="inv-recurring-interval" aria-invalid={Boolean(fieldErrors["inv-recurring-interval"])} aria-describedby={fieldErrors["inv-recurring-interval"] ? 'inv-recurring-interval-error' : undefined}
                   value={invoice.recurringInterval || 'monthly'}
                   onChange={(e) => setInvoice({ ...invoice, recurringInterval: e.target.value as NonNullable<Invoice['recurringInterval']> })}
                   className="w-full px-5 py-3 bg-[var(--ink)] border border-[var(--line)] rounded-[32px] focus:ring-2 focus:ring-zinc-900 outline-none font-bold"
                 >
                   <option value="weekly">Weekly</option>
                   <option value="monthly">Monthly</option>
                   <option value="yearly">Yearly</option>
                 </select>{fieldError("inv-recurring-interval")}
               </div>
            )}

            {invoice.type === 'progress' && (
               <div className="space-y-2">
                 <label htmlFor="inv-progress-pct" className="micro-label">Progress Percentage (%)</label>
                 <input id="inv-progress-pct" aria-invalid={Boolean(fieldErrors["inv-progress-pct"])} aria-describedby={fieldErrors["inv-progress-pct"] ? 'inv-progress-pct-error' : undefined}
                   type="number"
                   min="0"
                   max="100"
                   value={invoice.progressPercentage || 0}
                   onChange={(e) => setInvoice({ ...invoice, progressPercentage: Number.parseInt(e.target.value, 10) })}
                   className="w-full px-5 py-3 bg-[var(--ink)] border border-[var(--line)] rounded-[32px] focus:ring-2 focus:ring-zinc-900 outline-none font-bold"
                 />{fieldError("inv-progress-pct")}
               </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-2">
              <label htmlFor="inv-date" className="micro-label">Invoice Date</label>
              <input id="inv-date" aria-invalid={Boolean(fieldErrors["inv-date"])} aria-describedby={fieldErrors["inv-date"] ? 'inv-date-error' : undefined}
                type="date"
                required
                value={invoice.date}
                onChange={(e) => setInvoice({ ...invoice, date: e.target.value, ...(isFixedTerm(invoice.paymentTerms) && e.target.value ? { dueDate: calculateDueDate(e.target.value, invoice.paymentTerms) } : {}) })}
                className="w-full px-5 py-3 bg-[var(--ink)] border border-[var(--line)] rounded-[32px] focus:ring-2 focus:ring-zinc-900 outline-none font-bold"
              />{fieldError("inv-date")}
            </div>
            <div className="space-y-2">
              <label htmlFor="inv-due-date" className="micro-label">Due Date</label>
              <input id="inv-due-date" aria-invalid={Boolean(fieldErrors["inv-due-date"])} aria-describedby={fieldErrors["inv-due-date"] ? 'inv-due-date-error' : undefined}
                type="date"
                required
                value={invoice.dueDate}
                onChange={(e) => setInvoice({ ...invoice, dueDate: e.target.value })}
                className="w-full px-5 py-3 bg-[var(--ink)] border border-[var(--line)] rounded-[32px] focus:ring-2 focus:ring-zinc-900 outline-none font-bold"
              />{fieldError("inv-due-date")}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
             <div className="space-y-2">
               <label htmlFor="inv-discount" className="micro-label">Discount ({currency})</label>
               <input id="inv-discount" aria-invalid={Boolean(fieldErrors["inv-discount"])} aria-describedby={fieldErrors["inv-discount"] ? 'inv-discount-error' : undefined}
                 type="number" step={amountStep(currency)} min="0" value={minorToMajor(invoice.discountCents || 0, currency)}
                 onChange={(e) => setInvoice({ ...invoice, discountCents: TruthEngine.parseAmountToCents(e.target.value || '0', currency) })}
                 className="w-full px-4 py-3 bg-[var(--ink)] border border-[var(--line)] rounded-xl focus:ring-2 focus:ring-zinc-900 outline-none font-mono"
               />{fieldError("inv-discount")}
             </div>
             <div className="space-y-2">
               <label htmlFor="inv-deposit" className="micro-label">Deposit ({currency})</label>
               <input id="inv-deposit" aria-invalid={Boolean(fieldErrors["inv-deposit"])} aria-describedby={fieldErrors["inv-deposit"] ? "inv-deposit-help inv-deposit-error" : "inv-deposit-help"}
                 type="number" step={amountStep(currency)} min="0" value={minorToMajor(invoice.depositCents || 0, currency)}
                 onChange={(e) => setInvoice({ ...invoice, depositCents: TruthEngine.parseAmountToCents(e.target.value || '0', currency) })}
                 className="w-full px-4 py-3 bg-[var(--ink)] border border-[var(--line)] rounded-xl focus:ring-2 focus:ring-zinc-900 outline-none font-mono"
               />{fieldError("inv-deposit")}
               <p id="inv-deposit-help" className="text-[11px] text-[var(--muted)]">Paid in advance (booked to Customer Deposits). Tax stays on the full total; the deposit lowers the amount due.</p>
             </div>
             <div className="space-y-2">
               <label htmlFor="inv-retainage" className="micro-label">Retainage ({currency})</label>
               <input id="inv-retainage" aria-invalid={Boolean(fieldErrors["inv-retainage"])} aria-describedby={fieldErrors["inv-retainage"] ? 'inv-retainage-error' : undefined}
                 type="number" step={amountStep(currency)} min="0" value={minorToMajor(invoice.retainageCents || 0, currency)}
                 onChange={(e) => setInvoice({ ...invoice, retainageCents: TruthEngine.parseAmountToCents(e.target.value || '0', currency) })}
                 className="w-full px-4 py-3 bg-[var(--ink)] border border-[var(--line)] rounded-xl focus:ring-2 focus:ring-zinc-900 outline-none font-mono"
               />{fieldError("inv-retainage")}
             </div>
             <div className="space-y-2">
                 <label htmlFor="inv-milestone" className="micro-label">Milestone / Proj.</label>
                 <input id="inv-milestone" aria-invalid={Boolean(fieldErrors["inv-milestone"])} aria-describedby={fieldErrors["inv-milestone"] ? 'inv-milestone-error' : undefined}
                   type="text" value={invoice.milestone || ''}
                   onChange={(e) => setInvoice({ ...invoice, milestone: e.target.value })}
                   className="w-full px-4 py-3 bg-[var(--ink)] border border-[var(--line)] rounded-xl focus:ring-2 focus:ring-zinc-900 outline-none font-bold"
                 />{fieldError("inv-milestone")}
             </div>
             <div className="space-y-2">
                 <label htmlFor="inv-tax-code" className="micro-label">Tax</label>
                 <select id="inv-tax-code" aria-invalid={Boolean(fieldErrors["inv-tax-code"])} aria-describedby={fieldErrors["inv-tax-code"] ? 'inv-tax-code-error' : undefined}
                   value={taxChoice}
                   onChange={(e) => setInvoice({ ...invoice, taxCodeId: e.target.value === 'custom' || e.target.value === '' ? undefined : e.target.value, taxRate: e.target.value === 'custom' ? (invoice.taxRate || 0) : 0 })}
                   className="w-full px-4 py-3 bg-[var(--ink)] border border-[var(--line)] rounded-xl focus:ring-2 focus:ring-zinc-900 outline-none font-bold"
                 >
                   <option value="">No tax</option>
                   {salesCodes.map(c => <option key={c.id} value={c.id}>{c.name}{c.treatment !== 'standard' ? ` (${TAX_TREATMENTS[c.treatment]})` : ''}</option>)}
                   <option value="custom">Other rate…</option>
                 </select>{fieldError("inv-tax-code")}
                 {taxChoice === 'custom' && (
                   <input id="inv-custom-tax-rate" aria-invalid={Boolean(fieldErrors['inv-custom-tax-rate'])} aria-describedby={fieldErrors['inv-custom-tax-rate'] ? 'inv-custom-tax-rate-error' : undefined}
                     aria-label="Tax rate (%)"
                     type="number" step="0.001" min="0" max="100" value={invoice.taxRate || 0}
                     onChange={(e) => setInvoice({ ...invoice, taxRate: Number.parseFloat(e.target.value || '0') })}
                     className="w-full min-h-11 px-3 py-2 bg-[var(--ink)] border border-[var(--line)] rounded-xl outline-none font-mono"
                   />
                 )}
                 {fieldError('inv-custom-tax-rate')}
                 {salesCodes.length === 0 && <p className="text-[11px] text-[var(--muted)]">Add tax codes in Taxes.</p>}
                 <TaxExemptionNotice customer={safeCustomers.find(c => c.id === invoice.customerId)} date={invoice.date || ''} charging={totals.taxCents > 0} onNoTax={() => setInvoice({ ...invoice, taxCodeId: salesCodes.find(c => c.treatment === 'exempt')?.id, taxRate: 0 })} lineLabels={items[0]?.dimensions} lineCategories={items.filter(i => i.itemId || i.description.trim() || i.amountCents).map(i => lineTaxCategory(i, inventoryItems, !inventoryLoading && !inventoryCapped))} currentRate={taxCode ? effectiveRate(taxCode.components) : 0} currentTreatment={taxCode?.treatment} salesTreatments={salesCodes.map(c => c.treatment)} onUseRate={(rate, treatment) => { const choice = taxChoiceFor(rate, salesCodes, effectiveRate, treatment); setInvoice({ ...invoice, taxCodeId: choice.taxCodeId, taxRate: choice.taxRate }); }} allocation={{ netCents: totals.netCents, taxCents: totals.taxCents, currency, exchangeRate: invoice.exchangeRate, value: String(invoice.metadata?.ilAllocationNumber || ''), onChange: v => setInvoice({ ...invoice, metadata: { ...invoice.metadata, ilAllocationNumber: v || undefined } }) }} />
             </div>
             <div className="space-y-2 flex flex-col justify-end pb-3">
               <label htmlFor="inv-tax-inclusive" className="flex items-center gap-2 cursor-pointer">
                 <input id="inv-tax-inclusive" aria-invalid={Boolean(fieldErrors["inv-tax-inclusive"])} aria-describedby={fieldErrors["inv-tax-inclusive"] ? 'inv-tax-inclusive-error' : undefined} type="checkbox" checked={pricesIncludeTax} onChange={e => setInvoice({ ...invoice, pricesIncludeTax: e.target.checked })} className="w-5 h-5 rounded border-zinc-300 text-[var(--text)] focus:ring-zinc-900" />{fieldError("inv-tax-inclusive")}
                 <span className="text-sm font-bold text-[var(--text)]">Prices include tax</span>
               </label>
             </div>
             <div className="space-y-2">
                 <label htmlFor="inv-currency" className="micro-label">Currency</label>
                 <select id="inv-currency" aria-invalid={Boolean(fieldErrors["inv-currency"])} aria-describedby={fieldErrors["inv-currency"] ? 'inv-currency-error' : undefined}
                   value={currency}
                   onChange={(e) => setInvoice({ ...invoice, currency: e.target.value, exchangeRate: e.target.value === workspaceCurrency ? 1 : invoice.exchangeRate })}
                   className="w-full px-4 py-3 bg-[var(--ink)] border border-[var(--line)] rounded-xl focus:ring-2 focus:ring-zinc-900 outline-none font-bold"
                 >
                   {currencyChoices.map(c => <option key={c} value={c}>{c}</option>)}
                 </select>{fieldError("inv-currency")}
             </div>
             <div className="space-y-2">
                 <label htmlFor="inv-exchange-rate" className="micro-label">Exchange Rate</label>
                 <input id="inv-exchange-rate" aria-invalid={Boolean(fieldErrors["inv-exchange-rate"])} aria-describedby={fieldErrors["inv-exchange-rate"] ? 'inv-exchange-rate-error' : undefined}
                   type="number" step="0.0001" min="0.0001" value={invoice.exchangeRate || 1}
                   onChange={(e) => { setRateTyped(true); const rate = Number.parseFloat(e.target.value || '1'); setInvoice({ ...invoice, exchangeRate: rate, metadata: { ...invoice.metadata, rateUsed: { rate, date: invoice.date || getLocalDateISO(), source: 'typed' } } }); }}
                   className="w-full px-4 py-3 bg-[var(--ink)] border border-[var(--line)] rounded-xl focus:ring-2 focus:ring-zinc-900 outline-none font-mono"
                 />{fieldError("inv-exchange-rate")}
                 {rateNote && <p role="status" className="text-[11px] text-[var(--muted)] px-2">{rateNote}</p>}
             </div>
          </div>

          <div className="space-y-4">
            <DocumentLineEditor
              side="invoice"
              lines={items}
              onChange={setItems}
              createLine={() => ({ id: crypto.randomUUID(), description: '', quantity: 1, rateCents: 0, amountCents: 0, accountId: '' })}
              accounts={safeAccounts}
              currency={currency}
              date={invoice.date || ''}
              inventoryItems={inventoryItems}
              fieldErrors={fieldErrors}
              customerId={invoice.customerId}
              taxCodeIds={salesCodes.map(code => code.id)}
              onTaxCodeFill={taxCodeId => setInvoice(prev => ({ ...prev, taxCodeId, taxRate: 0 }))}
              repeatAction={lastForCustomer && linesEmpty ? (
                <button type="button" onClick={repeatLast}
                  className="ml-auto mr-2 px-3 py-2 rounded-xl text-[10px] font-semibold uppercase tracking-wider border border-[var(--line)] text-[var(--text)] hover:border-[var(--brass-line)]">
                  Same as last time ({lastForCustomer.number || 'last invoice'}, {lastForCustomer.items?.length} line{lastForCustomer.items?.length === 1 ? '' : 's'})
                </button>
              ) : undefined}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 border-t border-[var(--line)] pt-8 mt-8">
            <div className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="inv-memo" className="micro-label">Customer Memo</label>
                <textarea 
                  id="inv-memo"
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  placeholder="Message to customer..."
                  className="w-full px-4 py-3 bg-[var(--ink)] border border-[var(--line)] rounded-xl focus:ring-2 focus:ring-zinc-900 outline-none resize-none h-24"
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="inv-terms" className="micro-label">Terms & Conditions</label>
                <textarea 
                  id="inv-terms"
                  value={terms}
                  onChange={(e) => setTerms(e.target.value)}
                  placeholder="Standard terms..."
                  className="w-full px-4 py-3 bg-[var(--ink)] border border-[var(--line)] rounded-xl focus:ring-2 focus:ring-zinc-900 outline-none resize-none h-24 text-xs"
                />
              </div>
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="inv-email-subject" className="micro-label">Email Subject</label>
                <input id="inv-email-subject" aria-invalid={Boolean(fieldErrors["inv-email-subject"])} aria-describedby={fieldErrors["inv-email-subject"] ? 'inv-email-subject-error' : undefined}
                  type="text"
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                  placeholder="Invoice from us"
                  className="w-full px-4 py-3 bg-[var(--ink)] border border-[var(--line)] rounded-xl focus:ring-2 focus:ring-zinc-900 outline-none"
                />{fieldError("inv-email-subject")}
              </div>
              {invoice.id ? (
                <AttachmentsPanel target={{ collection: 'invoices', id: invoice.id, label: `Invoice ${invoice.number || ''}`.trim() }} />
              ) : (
                <div className="space-y-2">
                  <label htmlFor="inv-attachments" className="micro-label">Files</label>
                  <label htmlFor="inv-attachments" className="cursor-pointer flex items-center justify-center w-full px-4 py-3 bg-[var(--ink)] border-2 border-dashed border-zinc-300 rounded-xl hover:bg-zinc-100 transition-colors">
                    <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Select files</span>
                    <input id="inv-attachments" aria-invalid={Boolean(fieldErrors["inv-attachments"])} aria-describedby={fieldErrors["inv-attachments"] ? 'inv-attachments-error' : undefined} type="file" multiple className="hidden" onChange={handleFileUpload} />{fieldError("inv-attachments")}
                  </label>
                  {attachments.length > 0 && (
                    <ul className="flex flex-wrap gap-2 mt-2" aria-label="Files to keep with the invoice">
                      {attachments.map(f => (
                        <li key={`${f.name}-${f.size}-${f.lastModified}`} className="flex items-center gap-1 px-2 py-1 bg-zinc-100 text-zinc-600 text-xs rounded-lg">
                          <bdi>{f.name}</bdi>
                          <button type="button" onClick={() => setAttachments(prev => prev.filter(x => x !== f))} aria-label={`Don't attach ${f.name}`} className="text-zinc-400 hover:text-rose-600"><X size={12} aria-hidden="true" /></button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {attachments.length > 0 && <p className="text-[10px] text-[var(--muted)]">Kept with the invoice when you save it.</p>}
                </div>
              )}
            </div>
          </div>
        </form>
        <div className="px-3 md:px-6"><CreditLimitRefusalPanel busy={isSubmitting} onIssueAnyway={reason => handleAction(null, lastStatus.current, { reason })} /></div>
        <div className="shrink-0 p-3 md:p-6 border-t border-[var(--line)] bg-[var(--ink)]/50 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex flex-col w-full sm:w-auto">
            <dl className="text-xs text-[var(--muted)] grid grid-cols-[auto_auto] gap-x-4 mb-1 tabular-nums" aria-label="Invoice totals">
              <dt>Subtotal</dt><dd className="text-right font-mono">{money(totals.subtotalCents)}</dd>
              {totals.discountCents > 0 && <><dt>Discount</dt><dd className="text-right font-mono">−{money(totals.discountCents)}</dd></>}
              {totals.components.map(c => <React.Fragment key={c.name}><dt>{c.name} {c.rate}%{pricesIncludeTax ? ' (included)' : ''}</dt><dd className="text-right font-mono">{money(c.taxCents)}</dd></React.Fragment>)}
              {taxCode && taxCode.treatment !== 'standard' && <><dt>Tax</dt><dd className="text-right">{TAX_TREATMENTS[taxCode.treatment]}</dd></>}
              {depositCents > 0 && <><dt>Total</dt><dd className="text-right font-mono">{money(totals.amountCents)}</dd><dt>Deposit received</dt><dd className="text-right font-mono">−{money(depositCents)}</dd></>}
            </dl>
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">{depositCents > 0 ? 'Amount due' : 'Total'}</span>
            <span className="text-2xl font-bold tabular-nums text-[var(--text)] font-mono">
              {money(totals.amountCents - depositCents)}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center justify-end gap-2 w-full sm:w-auto">
            {invoice.id && (
              <>
                <button 
                  type="button"
                  onClick={() => setShowPdfPreview(true)}
                  className="px-4 py-3 bg-[var(--surface)] border border-[var(--line)] text-zinc-700 dark:text-zinc-300 rounded-[32px] font-medium text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all flex items-center gap-1.5"
                >
                  <Eye size={14} />
                  Preview PDF
                </button>
                <button 
                  type="button"
                  onClick={() => downloadDocumentPdf('invoice', invoice.id!, currentWorkspaceId || 'default', `invoice_${invoice.number || invoice.id}.pdf`)}
                  className="px-4 py-3 bg-[var(--surface)] border border-[var(--line)] text-indigo-600 dark:text-indigo-400 rounded-[32px] font-medium text-xs hover:bg-indigo-50 dark:hover:bg-indigo-950/40 transition-all flex items-center gap-1.5"
                >
                  <Download size={14} />
                  Download PDF
                </button>
              </>
            )}
            <button 
              type="button"
              onClick={requestClose}
              className="px-6 py-3 bg-[var(--surface)] border border-[var(--line)] text-[var(--text)] rounded-[32px] font-medium text-xs hover:bg-[var(--ink)] transition-all"
             aria-label="Cancel">
              Cancel
            </button>
            {receipt ? (
              <>
                <label className="flex flex-col items-start gap-2 text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
                  Paid into
                  <select id="inv-paid-into" aria-invalid={Boolean(fieldErrors['inv-paid-into'])} aria-describedby={fieldErrors['inv-paid-into'] ? 'inv-paid-into-error' : undefined} aria-label="Paid into" value={paidIntoId} onChange={e => setReceiptAccountId(e.target.value)}
                    className="px-3 py-2 bg-[var(--ink)] border border-[var(--line)] rounded-xl text-xs font-medium normal-case text-[var(--text)]">
                    {paidIntoChoices.length === 0 && <option value="">No bank account in the chart</option>}
                    {paidIntoChoices.map(a => <option key={a.id} value={a.id}>{a.code ? `${a.code} – ` : ''}{a.name}</option>)}
                  </select>
                </label>
                {fieldError('inv-paid-into')}
                <label className="flex flex-col items-start gap-2 text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
                  Method
                  <select aria-label="Payment method" value={receiptMethod} onChange={e => setReceiptMethod(e.target.value)}
                    className="px-3 py-2 bg-[var(--ink)] border border-[var(--line)] rounded-xl text-xs font-medium normal-case text-[var(--text)]">
                    <option value="card">Card</option>
                    <option value="cash">Cash</option>
                    <option value="bank_transfer">Bank transfer</option>
                    <option value="check">Check</option>
                    <option value="other">Other</option>
                  </select>
                </label>
                <AsyncButton disabled={isSubmitting}
                  type="button"
                  onClick={(e) => handleAction(e, 'sent')}
                  loadingText="Saving..."
                  icon={<Save size={16} />}
                  className="px-6 py-3 bg-emerald-600 text-white rounded-[32px] font-medium text-xs hover:bg-emerald-700 transition-all shadow-lg flex items-center gap-2"
                >
                  Save receipt
                </AsyncButton>
              </>
            ) : (
              <>
              <AsyncButton disabled={isSubmitting}
                type="button"
                onClick={(e) => handleAction(e, 'draft')}
                loadingText="Saving..."
                className="px-6 py-3 bg-[var(--surface)] border border-[var(--line)] text-[var(--text)] rounded-[32px] font-medium text-xs hover:bg-zinc-200 transition-all flex items-center gap-2"
              >
                Save Draft
              </AsyncButton>
              <AsyncButton disabled={isSubmitting}
                type="submit"
                onClick={(e) => handleAction(e, 'pending')}
                loadingText="Saving..."
                icon={<Save size={16} />}
                className="px-6 py-3 bg-zinc-900 text-white rounded-[32px] font-medium text-xs hover:bg-zinc-800 transition-all shadow-lg flex items-center gap-2"
              >
                Save & Close
              </AsyncButton>
              <AsyncButton disabled={isSubmitting}
                type="button"
                onClick={(e) => handleAction(e, 'sent')}
                loadingText="Sending..."
                className="px-6 py-3 bg-[var(--surface)] border border-[var(--line)] text-[var(--text)] rounded-[32px] font-medium text-xs hover:bg-blue-600 transition-all  flex items-center gap-2"
              >
                Send Invoice
              </AsyncButton>
              </>
            )}
          </div>
        </div>
      </motion.div>

      {showPdfPreview && invoice.id && (
        <PdfPreviewModal
          isOpen={showPdfPreview}
          onClose={() => setShowPdfPreview(false)}
          title={`Invoice ${invoice.number || invoice.id}`}
          documentType="invoice"
          documentId={invoice.id}
          workspaceId={currentWorkspaceId || 'default'}
          filename={`invoice_${invoice.number || invoice.id}.pdf`}
        />
      )}
    </div>
  );
}
