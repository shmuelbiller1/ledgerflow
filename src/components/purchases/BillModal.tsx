import { useDialog } from '../../hooks/useDialog';
import { useSuggestedRate } from '../../hooks/useSuggestedRate';
import { documentCurrencies } from '../../lib/exchangeRates';
import { latestDocumentFor } from '../../lib/repeatDocument';
import { isArchivedParty } from '../../lib/contacts';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { X, Save, CreditCard, Sparkles } from 'lucide-react';
import { motion } from 'motion/react';
import { Bill, Vendor, ChartAccount } from '../../types';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { applyRule, suggestRule } from '../../lib/allocationRules';
import { billItemProblem } from '../../lib/billStock';
import { useAuthStore } from '../../stores/useAuthStore';
import { getIdToken } from '../../firebase';
import AsyncButton from '../ui/AsyncButton';
import { evaluateApprovalRequirement } from '../../lib/approvalWorkflow';
import { addComment } from '../../lib/commentService';
import { documentTotals, taxCodeFromRate, TAX_TREATMENTS } from '../../lib/taxCodes';
import { formatCurrency, getLocalDateISO, safeConfirm } from '../../lib/utils';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import AttachmentsPanel from '../common/AttachmentsPanel';
import DocumentLineEditor, { type BillEditorLine } from '../common/DocumentLineEditor';
import { attachmentProblem } from '../../lib/attachments';

/** What the dialog saves: the bill, and for a new one whether it repeats (BE-08; never stored on the bill). */
export type BillDraft = Partial<Bill> & { recurringInterval?: 'weekly' | 'monthly' | 'quarterly' | 'yearly'; attachmentFiles?: File[] };

interface BillModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (bill: BillDraft) => void;
  vendors: Vendor[];
  accounts: ChartAccount[];
  /** Pre-filled bill, e.g. from a purchase order (BE-11). */
  initialBill?: Partial<Bill>;
}

/** A bill line as the dialog edits it: everything it carries (labels, J-08 stock item and units, BA-03 landed cost). */
const copyLine = (s: NonNullable<Bill['splits']>[number], keepOrder = true) => ({
  id: crypto.randomUUID(), amountCents: s.amountCents, accountId: s.accountId || '', description: s.description || '',
  ...(s.dimensions ? { dimensions: { ...s.dimensions } } : {}),
  ...(s.itemId ? { itemId: s.itemId, ...(s.quantity !== undefined ? { quantity: s.quantity } : {}) } : {}),
  ...(s.landedCost ? { landedCost: true } : {}),
  // CB-17: the order line it bills stays with the bill (not with a copy for a new bill)
  ...(keepOrder && s.orderLine !== undefined ? { orderLine: s.orderLine, ...(s.orderQuantity !== undefined ? { orderQuantity: s.orderQuantity } : {}) } : {}),
});

export default function BillModal({ isOpen, onClose, onSave, vendors = [], accounts = [], initialBill }: BillModalProps) {
  // Ensure we have arrays even if props were passed as null
  // archived contacts aren't offered for new documents; one already on this document stays (I-22)
  const safeVendors = (Array.isArray(vendors) ? vendors : []).filter(c => !isArchivedParty(c) || c.id === initialBill?.vendorId);
  const safeAccounts = Array.isArray(accounts) ? accounts.filter(a => a?.type === 'expense' || a?.type === 'cost_of_goods' || a?.type === 'asset') : [];
  
  const storeBills = useLedgerStore(s => s.bills) || [];
  const storeTransactions = useLedgerStore(s => s.transactions) || [];
  useLedgerCollections('bills');
  const [autofillNotice, setAutofillNotice] = useState<string | null>(null);

  const [bill, setBill] = useState<Partial<Bill>>(() => ({
    number: `BILL-${Date.now().toString().slice(-6)}`,
    date: format(new Date(), 'yyyy-MM-dd'),
    dueDate: format(new Date(), 'yyyy-MM-dd'),
    status: 'pending',
    amountCents: 0
  }));

  const editingExisting = Boolean(initialBill?.id);
  const [repeat, setRepeat] = useState<'' | 'weekly' | 'monthly' | 'quarterly' | 'yearly'>('');
  useEffect(() => {
    // an existing bill keeps its number; only a new one gets the next number in the series
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
            body: JSON.stringify({ type: 'bill' })
          });
          if (res.ok) {
            const data = await res.json();
            if (data.number) {
              setBill(prev => ({ ...prev, number: data.number }));
            }
          }
        } catch (e) {
          console.error('Failed to fetch next bill number', e);
        }
      };
      void fetchNextNumber();
    }
  }, [isOpen, editingExisting]);

  const [splits, setSplits] = useState<BillEditorLine[]>([
    { id: crypto.randomUUID(), amountCents: 0, accountId: '', description: '' }
  ]);

  const [memo, setMemo] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  // labels stay above their field and a refusal shows under the field that caused it (D-87, as D-86)
  const formRef = useRef<HTMLFormElement>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fieldError = (id: string) => fieldErrors[id]
    ? <p id={`${id}-error`} role="alert" className="text-xs text-rose-600 dark:text-rose-400 mt-1">{fieldErrors[id]}</p>
    : null;
  const showFieldError = (id: string, message: string) => {
    setFieldErrors(prev => ({ ...prev, [id]: message }));
    document.getElementById(id)?.focus();
  };

  const [filledFrom, setFilledFrom] = useState<Partial<Bill> | undefined>(undefined);
  if (isOpen && initialBill && initialBill !== filledFrom) {
    // copy the pre-filled bill into the form once per opening (adjusting state during render)
    setFilledFrom(initialBill);
    const { splits: initialSplits, ...fields } = initialBill;
    setBill(prev => ({ ...prev, ...fields }));
    if (initialSplits?.length) setSplits(initialSplits.map(s => copyLine(s)));
  }

  const total = splits.reduce((sum, split) => sum + split.amountCents, 0);

  // Tax: a purchase tax code (Settings → Tax); reverse charge means the vendor charges none
  const taxRates = useLedgerStore(s => s.taxRates || []);
  const workspaceCurrency = useAuthStore(s => s.getCurrentWorkspace()?.currency) || 'USD';
  // Q-05: a saved split rule whose text the vendor or a line contains is suggested, with why; applying it
  // only changes the lines here (each line split by the rule's shares, in whole cents)
  const allocationRules = useAuthStore(s => s.getCurrentWorkspace()?.allocationRules);
  useLedgerCollections('inventory');
  // BF-01: services are not bought into stock
  const stockItems = (useLedgerStore(s => s.inventory) || []).filter(i => i.itemType !== 'service');
  const [ruleApplied, setRuleApplied] = useState('');
  const suggested = suggestRule(allocationRules, { vendorName: bill.vendorName, description: splits.map(sp => sp.description).join(' ') });
  const canSplit = Boolean(suggested && suggested.rule.id !== ruleApplied && splits.some(sp => sp.amountCents));
  const purchaseCodes = useMemo(() => taxRates.filter(r => r.type === 'Sales' && r.appliesTo !== 'sales').map(taxCodeFromRate), [taxRates]);
  const taxCode = purchaseCodes.find(c => c.id === bill.taxCodeId) || null;
  const pricesIncludeTax = bill.pricesIncludeTax ?? true;
  const totals = documentTotals(total, 0, taxCode, pricesIncludeTax);
  const billCurrency = bill.currency || workspaceCurrency;
  // I-23: a new bill for a vendor can copy the lines of their latest bill (amounts included)
  const lastForVendor = !editingExisting && bill.vendorId
    ? latestDocumentFor(storeBills, b => b.vendorId === bill.vendorId, b => b.splits) : null;
  // (picking the vendor may already fill the first line's account and description, not its amount)
  const splitsEmpty = splits.every(sp => !sp.amountCents);
  const repeatLast = () => {
    if (!lastForVendor?.splits) return;
    setSplits(lastForVendor.splits.map(s => copyLine(s, false)));
    setBill(prev => ({
      ...prev,
      ...(lastForVendor.taxCodeId ? { taxCodeId: lastForVendor.taxCodeId } : {}),
      ...(lastForVendor.pricesIncludeTax !== undefined ? { pricesIncludeTax: lastForVendor.pricesIncludeTax } : {}),
    }));
  };
  // the rate fills itself in for another currency until the person types one (BA-06, I-23)
  const [rateTyped, setRateTyped] = useState(false);
  const rateNote = useSuggestedRate({
    currency: billCurrency, homeCurrency: workspaceCurrency, enabled: !editingExisting && !rateTyped, docs: storeBills, date: bill.date,
    // BM-06: where the rate came from, kept with the bill
    onRate: (rate, from) => setBill(prev => ({ ...prev, exchangeRate: rate, metadata: { ...prev.metadata, rateUsed: { rate, ...from } } })),
  });
  const money = (cents: number) => formatCurrency(cents, billCurrency);

  const handleVendorSelect = (vendorId: string) => {
    const vend = safeVendors.find(v => v.id === vendorId);
    // a new bill starts in the vendor's currency (Y-22); an existing one keeps its own
    setBill(prev => {
      const vendorCurrency = vend && !editingExisting ? (vend.currency || workspaceCurrency) : null;
      const currencyChange = vendorCurrency && vendorCurrency !== (prev.currency || workspaceCurrency) ? { currency: vendorCurrency, exchangeRate: 1 } : {};
      return { ...prev, vendorId, vendorName: vend?.name, ...currencyChange };
    });
    setAutofillNotice(null);

    if (!vendorId) return;

    // Look for last used account for this vendor from previous bills
    let foundAccountId = '';
    let foundDesc = '';

    const prevBill = storeBills.find(b => b.vendorId === vendorId && b.splits && b.splits.length > 0 && b.splits[0].accountId);
    if (prevBill && prevBill.splits?.[0]?.accountId) {
      foundAccountId = prevBill.splits[0].accountId;
      foundDesc = prevBill.splits[0].description || '';
    } else {
      // Look in transaction history
      const prevTx = storeTransactions.find(t =>
        ((('vendorId' in t && t.vendorId === vendorId) || t.metadata?.vendorId === vendorId) || (vend && t.description?.toLowerCase().includes(vend.name.toLowerCase()))) &&
        t.lines && t.lines.length > 0
      );
      if (prevTx && prevTx.lines) {
        const matchingLine = prevTx.lines.find(l => accounts.some(a => a.id === l.accountId && (a.type === 'expense' || a.type === 'cost_of_goods'))) || prevTx.lines[0];
        if (matchingLine) {
          foundAccountId = matchingLine.accountId;
          foundDesc = prevTx.description || '';
        }
      }
    }

    if (foundAccountId) {
      const targetAcc = accounts.find(a => a.id === foundAccountId);
      setSplits(prev => {
        const next = [...prev];
        if (next.length > 0) {
          next[0] = {
            ...next[0],
            accountId: foundAccountId,
            description: next[0].description || foundDesc || `${vend?.name || 'Vendor'} expense`
          };
        }
        return next;
      });
      if (targetAcc) {
        setAutofillNotice(`Auto-filled account: ${targetAcc.name}`);
        toast.info(`⚡ Auto-filled account "${targetAcc.name}" from previous ${vend?.name || 'vendor'} history.`);
      }
    }
  };

  const handleAction = async (e: React.FormEvent, actionStatus: Bill['status']) => {
    e.preventDefault();
    if (isSubmitting) return;
    // the browser's own required-field messages show under the field that caused them
    if (!formRef.current?.reportValidity()) return;
    if (!bill.vendorId) {
      showFieldError('bill-vendor', 'Please select a vendor');
      return;
    }
    // a stock line needs its units and what they cost before it can post (J-08); the refusal
    // appears under the field it is about (the units, or the line's amount)
    const stockProblemLine = splits.findIndex(sp => billItemProblem(sp));
    if (stockProblemLine >= 0) {
      const problem = String(billItemProblem(splits[stockProblemLine]));
      showFieldError(/cost/i.test(problem) ? `bill-split-amount-${stockProblemLine}` : `bill-split-units-${stockProblemLine}`, problem);
      return;
    }

    const wsId = useAuthStore.getState().currentWorkspaceId || 'default';
    const userEmail = useAuthStore.getState().user?.email || 'user';
    const approval = evaluateApprovalRequirement(
      { ...bill, amountCents: total } as Bill,
      'bill',
      { id: 'rule_1', workspaceId: wsId, entityType: 'bill', thresholdCents: 500000, approverRoles: ['owner', 'accountant'], autoApproveBelowThreshold: true }
    );

    let finalStatus = actionStatus;
    if (approval.requiresApproval && actionStatus === 'approved') {
      finalStatus = 'pending';
      toast.info('Bill amount exceeds threshold ($5,000). Submitted for management approval.');
      addComment({
        workspaceId: wsId,
        entityType: 'bill',
        entityId: bill.number || 'bill_new',
        authorEmail: userEmail,
        comment: 'Bill held for dual approval threshold.'
      });
    }

    setIsSubmitting(true);
    try {
      await onSave({
        ...bill,
        ...(repeat ? { recurringInterval: repeat } : {}),
        currency: billCurrency,
        exchangeRate: billCurrency === workspaceCurrency ? 1 : (bill.exchangeRate || 1),
        status: finalStatus,
        // the total owed (tax included) and the tax, explicitly (taxCodes.ts)
        amountCents: totals.amountCents,
        lineSumCents: totals.subtotalCents,
        taxAmountCents: totals.taxCents,
        taxInclusive: true,
        taxVersion: 2,
        pricesIncludeTax,
        taxCodeId: taxCode?.id,
        taxTreatment: taxCode?.treatment,
        taxBreakdown: totals.components,
        selfAssessedTaxCents: totals.selfAssessedCents || undefined,
        splits,
        metadata: {
          ...(bill.metadata || {}),
          memo,
        },
        // files picked for a new bill are kept with it once it has an id (Purchases.tsx)
        ...(attachments.length > 0 && !bill.id ? { attachmentFiles: attachments } : {}),
      });
      return true;
    } catch (err) {
      // PREV-5: the save already said why it failed (its own message); the dialog stays open with
      // the draft, and the caller is told it was not saved
      console.warn('Bill not saved:', err);
      return false;
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => handleAction(e, bill.status || 'pending');

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
    if (!dirty || safeConfirm('Discard your changes to this bill?')) onClose();
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
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-zinc-900 text-white rounded-[32px] flex items-center justify-center shadow-xl shadow-zinc-900/20">
              <CreditCard size={24} />
            </div>
            <div>
              <h2 id={titleId} className="text-2xl font-black text-[var(--text)] tracking-tight">{editingExisting ? `Edit bill ${bill.number || ''}`.trim() : 'Record New Bill'}</h2>
              <p className="text-xs text-zinc-500 font-bold uppercase tracking-widest">Purchases & Payables</p>
            </div>
          </div>
          <button aria-label="Close" title="Close" onClick={requestClose} className="min-h-11 min-w-11 flex items-center justify-center p-2 hover:bg-[var(--elevated)] rounded-full transition-colors text-[var(--muted)]"><X size={24} /></button>
        </div>

        <form ref={formRef} onSubmit={handleSubmit} onInvalid={e => {
          const field = e.target as unknown as HTMLInputElement;
          if (field.id) setFieldErrors(prev => ({ ...prev, [field.id]: field.validationMessage }));
        }} onChange={e => {
          setDirty(true);
          const field = e.target as unknown as HTMLInputElement;
          // typing in a field clears its refusal; a stock line clears with its units or amount
          const keys = field.id ? [field.id, field.id.replace(/^bill-split-(units|amount)-(\d+)$/, 'bill-split-units-$2')] : [];
          setFieldErrors(prev => {
            if (!keys.some(k => prev[k])) return prev;
            const next = { ...prev };
            for (const k of keys) delete next[k];
            return next;
          });
        }} className="flex-1 min-h-0 overflow-y-auto p-4 md:p-8 space-y-8 custom-scrollbar">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label htmlFor="bill-vendor" className="micro-label">Vendor</label>
                {autofillNotice && (
                  <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full flex items-center gap-1 border border-amber-200">
                    <Sparkles size={10} /> Auto-filled
                  </span>
                )}
              </div>
              <select 
                id="bill-vendor"
                required
                aria-invalid={Boolean(fieldErrors['bill-vendor'])}
                aria-describedby={fieldErrors['bill-vendor'] ? 'bill-vendor-error' : undefined}
                value={bill.vendorId || ''}
                onChange={(e) => handleVendorSelect(e.target.value)}
                className="w-full min-h-11 px-5 py-3.5 bg-[var(--ink)] border border-[var(--line)] rounded-[32px] focus:ring-2 focus:ring-zinc-900 outline-none font-bold"
              >
                <option value="">Select Vendor</option>
                {safeVendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>{fieldError('bill-vendor')}
            </div>
            <div className="space-y-2">
              <label htmlFor="bill-number" className="micro-label">Bill Number</label>
              <input 
                id="bill-number"
                type="text"
                required
                aria-invalid={Boolean(fieldErrors['bill-number'])}
                aria-describedby={fieldErrors['bill-number'] ? 'bill-number-error' : undefined}
                value={bill.number}
                onChange={(e) => setBill({ ...bill, number: e.target.value })}
                className="w-full min-h-11 px-5 py-3.5 bg-[var(--ink)] border border-[var(--line)] rounded-[32px] focus:ring-2 focus:ring-zinc-900 outline-none font-mono font-bold"
              />{fieldError('bill-number')}
            </div>
            <div className="space-y-2">
              <label htmlFor="bill-status" className="micro-label">Status</label>
              <select 
                id="bill-status"
                aria-invalid={Boolean(fieldErrors['bill-status'])}
                aria-describedby={fieldErrors['bill-status'] ? 'bill-status-error' : undefined}
                value={bill.status}
                onChange={(e) => setBill({ ...bill, status: e.target.value as Bill['status'] })}
                className="w-full min-h-11 px-5 py-3.5 bg-[var(--ink)] border border-[var(--line)] rounded-[32px] focus:ring-2 focus:ring-zinc-900 outline-none font-bold"
              >
                <option value="pending">Pending</option>
                <option value="unpaid">Unpaid</option>
                <option value="paid">Paid</option>
                <option value="overdue">Overdue</option>
              </select>{fieldError('bill-status')}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-2">
              <label htmlFor="bill-date" className="micro-label">Bill Date</label>
              <input 
                id="bill-date"
                type="date"
                required
                aria-invalid={Boolean(fieldErrors['bill-date'])}
                aria-describedby={fieldErrors['bill-date'] ? 'bill-date-error' : undefined}
                value={bill.date}
                onChange={(e) => setBill({ ...bill, date: e.target.value })}
                className="w-full min-h-11 px-5 py-3.5 bg-[var(--ink)] border border-[var(--line)] rounded-[32px] focus:ring-2 focus:ring-zinc-900 outline-none font-bold"
              />{fieldError('bill-date')}
            </div>
            <div className="space-y-2">
              <label htmlFor="bill-due-date" className="micro-label">Due Date</label>
              <input 
                id="bill-due-date"
                type="date"
                required
                aria-invalid={Boolean(fieldErrors['bill-due-date'])}
                aria-describedby={fieldErrors['bill-due-date'] ? 'bill-due-date-error' : undefined}
                value={bill.dueDate}
                onChange={(e) => setBill({ ...bill, dueDate: e.target.value })}
                className="w-full min-h-11 px-5 py-3.5 bg-[var(--ink)] border border-[var(--line)] rounded-[32px] focus:ring-2 focus:ring-zinc-900 outline-none font-bold"
              />{fieldError('bill-due-date')}
            </div>
          </div>

          {!editingExisting && (
            <div className="space-y-2 max-w-xs">
              <label htmlFor="bill-repeat" className="micro-label">Repeat</label>
              {/* BE-08: a draft copy of this bill is made on each date, to check and save */}
              <select id="bill-repeat" value={repeat} onChange={e => setRepeat(e.target.value as typeof repeat)}
                className="w-full px-5 py-3.5 bg-[var(--ink)] border border-[var(--line)] rounded-[32px] focus:ring-2 focus:ring-zinc-900 outline-none font-bold">
                <option value="">Doesn't repeat</option>
                <option value="weekly">Every week</option>
                <option value="monthly">Every month</option>
                <option value="quarterly">Every quarter</option>
                <option value="yearly">Every year</option>
              </select>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-2">
              <label htmlFor="bill-currency" className="micro-label">Currency</label>
              <select id="bill-currency" value={billCurrency}
                onChange={(e) => setBill({ ...bill, currency: e.target.value, exchangeRate: e.target.value === workspaceCurrency ? 1 : bill.exchangeRate })}
                className="w-full px-5 py-3.5 bg-[var(--ink)] border border-[var(--line)] rounded-[32px] outline-none font-bold">
                {documentCurrencies(workspaceCurrency, billCurrency, [...storeBills, ...safeVendors]).map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            {billCurrency !== workspaceCurrency && (
              <div className="space-y-2">
                <label htmlFor="bill-exchange-rate" className="micro-label">1 {billCurrency} = ? {workspaceCurrency}</label>
                <input id="bill-exchange-rate" type="number" step="0.0001" min="0.0001" value={bill.exchangeRate || 1}
                  onChange={(e) => { setRateTyped(true); const rate = parseFloat(e.target.value || '1'); setBill({ ...bill, exchangeRate: rate, metadata: { ...bill.metadata, rateUsed: { rate, date: bill.date || getLocalDateISO(), source: 'typed' } } }); }}
                  className="w-full px-5 py-3.5 bg-[var(--ink)] border border-[var(--line)] rounded-[32px] outline-none font-bold" />
                {rateNote && <p role="status" className="text-[11px] text-[var(--muted)] px-2">{rateNote}</p>}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-2">
              <label htmlFor="bill-tax-code" className="micro-label">Tax</label>
              <select id="bill-tax-code" value={bill.taxCodeId || ''} onChange={(e) => setBill({ ...bill, taxCodeId: e.target.value || undefined })}
                className="w-full px-5 py-3.5 bg-[var(--ink)] border border-[var(--line)] rounded-[32px] outline-none font-bold">
                <option value="">No tax</option>
                {purchaseCodes.map(c => <option key={c.id} value={c.id}>{c.name}{c.treatment !== 'standard' ? ` (${TAX_TREATMENTS[c.treatment]})` : ''}</option>)}
              </select>
              {purchaseCodes.length === 0 && <p className="text-[11px] text-[var(--muted)]">Add tax codes in Taxes.</p>}
            </div>
            <div className="space-y-2 flex flex-col justify-end pb-3">
              <label htmlFor="bill-prices-include-tax" className="flex items-center gap-2 cursor-pointer">
                <input id="bill-prices-include-tax" type="checkbox" checked={pricesIncludeTax} onChange={e => setBill({ ...bill, pricesIncludeTax: e.target.checked })} className="w-5 h-5 rounded" />
                <span className="text-sm font-bold text-[var(--text)]">Amounts include tax (as on the vendor's bill)</span>
              </label>
            </div>
          </div>

          <div className="space-y-4">
            {canSplit && suggested && (
              <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--line)] px-3 py-2 text-xs text-[var(--text)]">
                <span>Split rule suggested: {suggested.why} ({suggested.rule.shares.map(sh => `${sh.percent}%`).join(' / ')}).</span>
                <button type="button" onClick={() => { setSplits(applyRule(suggested.rule, splits.filter(sp => sp.amountCents), () => crypto.randomUUID())); setRuleApplied(suggested.rule.id); }}
                  className="rounded-lg border border-[var(--line)] px-2.5 py-1 font-semibold hover:border-[var(--brass-line)]">
                  Apply {suggested.rule.name}
                </button>
              </div>
            )}
            <DocumentLineEditor
              side="bill"
              lines={splits}
              onChange={setSplits}
              createLine={() => ({ id: crypto.randomUUID(), amountCents: 0, accountId: '', description: '' })}
              accounts={safeAccounts}
              currency={billCurrency}
              workspaceCurrency={workspaceCurrency}
              exchangeRate={bill.exchangeRate}
              documentId={bill.id}
              date={bill.date || ''}
              inventoryItems={stockItems}
              fieldErrors={fieldErrors}
              repeatAction={lastForVendor && splitsEmpty ? (
                <button type="button" onClick={repeatLast}
                  className="ml-auto mr-2 px-3 py-2 rounded-xl text-[10px] font-semibold uppercase tracking-wider border border-[var(--line)] text-[var(--text)] hover:border-[var(--brass-line)]">
                  Same as last bill ({lastForVendor.splits?.length} line{lastForVendor.splits?.length === 1 ? '' : 's'})
                </button>
              ) : undefined}
            />
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 border-t border-[var(--line)] pt-8 mt-8">
            <div className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="bill-memo" className="micro-label">Internal Memo</label>
                <textarea 
                  id="bill-memo"
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  placeholder="Notes about this bill..."
                  className="w-full px-4 py-3 bg-[var(--ink)] border border-[var(--line)] rounded-xl focus:ring-2 focus:ring-zinc-900 outline-none resize-none h-24"
                />
              </div>
            </div>
            <div className="space-y-4">
              {bill.id ? (
                <AttachmentsPanel target={{ collection: 'bills', id: bill.id, label: `Bill ${bill.number || ''}`.trim() }} />
              ) : (
                <div className="space-y-2">
                  <label htmlFor="bill-file-upload" className="micro-label">Files and receipts</label>
                  <label htmlFor="bill-file-upload" className="cursor-pointer flex items-center justify-center w-full px-4 py-3 bg-[var(--ink)] border-2 border-dashed border-zinc-300 rounded-xl hover:bg-zinc-100 transition-colors">
                    <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Select files</span>
                    <input id="bill-file-upload" type="file" multiple className="hidden" onChange={handleFileUpload} />
                  </label>
                  {attachments.length > 0 && (
                    <ul className="flex flex-wrap gap-2 mt-2" aria-label="Files to keep with the bill">
                      {attachments.map(f => (
                        <li key={`${f.name}-${f.size}-${f.lastModified}`} className="flex items-center gap-1 px-2 py-1 bg-zinc-100 text-zinc-600 text-xs rounded-lg">
                          <bdi>{f.name}</bdi>
                          <button type="button" onClick={() => setAttachments(prev => prev.filter(x => x !== f))} aria-label={`Don't attach ${f.name}`} className="text-zinc-400 hover:text-rose-600"><X size={12} aria-hidden="true" /></button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {attachments.length > 0 && <p className="text-[10px] text-[var(--muted)]">Kept with the bill when you save it.</p>}
                </div>
              )}
            </div>
          </div>
        </form>

        <div id="bill-save-footer" className="shrink-0 p-3 md:p-6 border-t border-[var(--line)] bg-[var(--ink)]/50 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex flex-col w-full sm:w-auto min-w-0">
            <dl className="text-xs text-[var(--muted)] grid grid-cols-[auto_auto] gap-x-4 mb-1 tabular-nums" aria-label="Bill totals">
              <dt>Lines</dt><dd className="text-right font-mono">{money(totals.subtotalCents)}</dd>
              {totals.components.map(c => <React.Fragment key={c.name}><dt>{c.name} {c.rate}%{totals.selfAssessedCents ? ' (reverse charge: you account for it)' : pricesIncludeTax ? ' (included)' : ''}</dt><dd className="text-right font-mono">{money(c.taxCents)}</dd></React.Fragment>)}
            </dl>
            <span className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest">Total Bill Amount</span>
            <span className="text-2xl sm:text-3xl font-black text-[var(--text)] font-mono tabular-nums">
              {money(totals.amountCents)}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center justify-end gap-2 w-full sm:w-auto">
            <button 
              type="button"
              onClick={requestClose}
              className="min-h-11 px-4 sm:px-6 py-3 bg-[var(--surface)] border border-[var(--line)] text-[var(--text)] rounded-[32px] font-medium uppercase tracking-wider text-[10px] hover:bg-[var(--ink)] transition-all"
             aria-label="Cancel">
              Cancel
            </button>
            <AsyncButton 
              type="button"
              disabled={isSubmitting}
              onClick={(e) => handleAction(e, 'draft')}
              loadingText="Saving..."
              className="min-h-11 px-4 sm:px-6 py-3 bg-[var(--surface)] border border-[var(--line)] text-[var(--text)] rounded-[32px] font-medium uppercase tracking-wider text-[10px] hover:bg-[var(--elevated)] transition-all flex items-center justify-center gap-2"
            >
              Save Draft
            </AsyncButton>
            <AsyncButton 
              type="submit"
              disabled={isSubmitting}
              onClick={(e) => handleAction(e, 'pending')}
              loadingText="Saving..."
              className="min-h-11 px-4 sm:px-6 py-3 bg-zinc-900 text-white rounded-[32px] font-medium uppercase tracking-wider text-[10px] hover:bg-zinc-800 transition-all shadow-lg flex items-center justify-center gap-2"
            >
              <Save size={16} />
              Save & Close
            </AsyncButton>
            <AsyncButton 
              type="button"
              disabled={isSubmitting}
              onClick={(e) => handleAction(e, 'approved')}
              loadingText="Approving..."
              className="min-h-11 px-4 sm:px-6 py-3 bg-transparent border border-emerald-600 text-emerald-700 dark:text-emerald-400 rounded-[32px] font-medium uppercase tracking-wider text-[10px] hover:bg-emerald-600/10 transition-all flex items-center justify-center gap-2"
            >
              Approve Bill
            </AsyncButton>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
