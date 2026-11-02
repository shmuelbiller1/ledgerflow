import { currencyDigits, minorToMajor, minorUnitRate } from '../../lib/currencyMinorUnits';
import { useDialog } from '../../hooks/useDialog';
import { operationIdFor } from '../../lib/serverAction';
import React, { useRef, useState, useMemo } from 'react';
import { X, DollarSign, Sparkles } from 'lucide-react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { isUndepositedFundsAccount } from '../../lib/accountUtils';
import { paymentModeAccountId } from '../../lib/accountDefaults';
import { useAuthStore } from '../../stores/useAuthStore';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { toast } from 'sonner';
import { calculateAmountDue } from '../../lib/documentMath';
import { describeError } from '../../lib/errorRemedies';
import { savedInOtherWorkspace, workspaceChangedSince } from '../../lib/saveWorkspace';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { useSuggestedRate } from '../../hooks/useSuggestedRate';
import { usePageSyncedState } from '../../hooks/usePageSyncedState';
import WithholdingField, { type Withholding } from '../purchases/WithholdingField';

const cn = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(' ');

interface ReceivePaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultDirection?: 'received' | 'made';
  defaultContactId?: string;
  defaultDocumentId?: string;
}

export default function ReceivePaymentModal({
  isOpen,
  onClose,
  defaultDirection = 'received',
  defaultContactId = '',
  defaultDocumentId = ''
}: ReceivePaymentModalProps) {
  const user = useAuthStore(s => s.user);
  const currentWorkspaceId = useAuthStore(s => s.currentWorkspaceId);

  const customers = useLedgerStore(s => s.customers);
  const vendors = useLedgerStore(s => s.vendors);
  const invoices = useLedgerStore(s => s.invoices);
  const bills = useLedgerStore(s => s.bills);
  const accounts = useLedgerStore(s => s.accounts);
  useLedgerCollections('bills', 'customers', 'invoices', 'vendors');

  // #114: the same payment retried after a lost reply is recorded once (server idempotency)
  const paymentOps = useRef(new Map<string, string>());
  const defaultsKey = JSON.stringify([defaultDirection, defaultContactId, isOpen]);
  const [direction, setDirection] = usePageSyncedState<'received' | 'made'>(defaultsKey, defaultDirection, defaultDirection);
  const [contactId, setContactId] = usePageSyncedState(defaultsKey, defaultContactId, defaultContactId);
  const [date, setDate] = useState<string>(getLocalDateISO());
  const [amountDollars, setAmountDollars] = useState<string>('');
  const [method, setMethod] = useState<'cash' | 'check' | 'bank_transfer' | 'card' | 'other'>('bank_transfer');
  const [reference, setReference] = useState<string>('');
  const [depositAccountId, setDepositAccountId] = useState<string>('');
  const [allocationsMap, setAllocationsMap] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const homeCurrency = useAuthStore(s => s.getCurrentWorkspace()?.currency) || 'USD';
  // L-192: the rate on the payment day for a foreign document (what really reached the bank)
  const [dayRate, setDayRate] = useState<number | null>(null);
  // BM-06: where the day's rate came from, sent with the payment
  const [dayRateSource, setDayRateSource] = useState<'typed' | 'last-used' | 'live' | 'books-on-date'>('typed');
  const [withholding, setWithholding] = useState<Withholding | null>(null); // IL-5
  const [rateTyped, setRateTyped] = useState(false);

  // Filter bank/cash accounts
  const cashAccounts = useMemo(() => {
    // Bank/cash accounts, plus Undeposited Funds (received now, taken to the bank later with "Make deposit")
    return (accounts || []).filter(a => 
      a.type === 'asset' && 
      (a.category === 'Cash' || a.category === 'Bank' || a.name.toLowerCase().includes('bank') || a.name.toLowerCase().includes('cash') || a.name.toLowerCase().includes('checking') || isUndepositedFundsAccount(a))
    );
  }, [accounts]);

  // CA-28: until the person picks an account, the one set for this payment method (Settings → Defaults)
  const accountMappings = useAuthStore(s => s.getCurrentWorkspace()?.defaultAccountMappings);
  const selectedDepositAccountId = depositAccountId || paymentModeAccountId(method, cashAccounts, accountMappings);

  // Filter target open documents
  // oldest first, so a payment settles the oldest invoices/bills first (the store lists newest first)
  const openDocs = useMemo(() => {
    const oldestFirst = <T extends { date: string; number: string }>(list: T[]) =>
      [...list].sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number));
    if (direction === 'received') {
      // what the server accepts: issued (not draft or void) and still owed (calculateAmountDue)
      return oldestFirst((invoices || []).filter(inv => {
        if (contactId && inv.customerId !== contactId) return false;
        return calculateAmountDue(inv) > 0 && inv.status !== 'void' && inv.status !== 'draft' && inv.status !== 'rejected';
      }).map(inv => ({
        id: inv.id,
        number: inv.number || inv.id,
        date: inv.date || '',
        totalCents: inv.amountCents || 0,
        paidCents: inv.amountPaidCents || 0,
        remainingCents: calculateAmountDue(inv),
        currency: (inv.currency || homeCurrency).toUpperCase(),
        rate: inv.exchangeRate && inv.exchangeRate > 0 ? inv.exchangeRate : 1,
        type: 'invoice' as const
      })));
    } else {
      return oldestFirst((bills || []).filter(b => {
        if (contactId && b.vendorId !== contactId) return false;
        return calculateAmountDue(b) > 0 && b.status !== 'void' && b.status !== 'draft';
      }).map(b => ({
        id: b.id,
        number: b.number || b.id,
        date: b.date || b.dueDate || '',
        totalCents: b.amountCents || 0,
        paidCents: b.amountPaidCents || 0,
        remainingCents: calculateAmountDue(b),
        currency: (b.currency || homeCurrency).toUpperCase(),
        rate: b.exchangeRate && b.exchangeRate > 0 ? b.exchangeRate : 1,
        type: 'bill' as const
      })));
    }
  }, [direction, contactId, invoices, bills, homeCurrency]);

  // Pre-fill the requested document once for each document list/default combination.
  const [prefillSource, setPrefillSource] = useState<{ documentId: string; documents: typeof openDocs } | null>(null);
  if (defaultDocumentId && (prefillSource?.documentId !== defaultDocumentId || prefillSource.documents !== openDocs)) {
    setPrefillSource({ documentId: defaultDocumentId, documents: openDocs });
    const target = openDocs.find(d => d.id === defaultDocumentId);
    if (target) {
      const own = currencyDigits(target.currency);
      setAmountDollars(minorToMajor(target.remainingCents, target.currency).toFixed(own));
      setAllocationsMap({ [defaultDocumentId]: minorToMajor(target.remainingCents, target.currency).toFixed(own) });
    }
  }

  // the currency of what is being paid: the documents chosen (one payment is one currency)
  const payDoc = openDocs.find(d => Number.parseFloat(allocationsMap[d.id] || '') > 0) || openDocs.find(d => d.id === defaultDocumentId);
  const payCurrency = payDoc?.currency || homeCurrency;
  // BM-04: amounts typed in the payment's currency, in its own decimals (whole yen, three-decimal dinars)
  const digits = currencyDigits(payCurrency);
  const toMinor = (text: string) => { const p = Number.parseFloat(text); return Number.isNaN(p) || p <= 0 ? 0 : Math.round(p * 10 ** digits); };
  const paymentAmountCents = toMinor(amountDollars);
  const totalAllocatedCents = Object.values(allocationsMap).reduce((sum, val) => sum + toMinor(val), 0);

  const unappliedCents = Math.max(0, paymentAmountCents - totalAllocatedCents);

  const isForeign = payCurrency !== homeCurrency;
  const rateNote = useSuggestedRate({
    currency: payCurrency, homeCurrency, enabled: isForeign && !rateTyped,
    docs: [...(invoices || []), ...(bills || [])], onRate: (rate, from) => { setDayRate(rate); setDayRateSource(from.source); }, date,
  });
  const bookedCents = payDoc ? Math.round(paymentAmountCents * minorUnitRate(payDoc.rate, payCurrency, homeCurrency)) : 0;
  const arrivedCents = dayRate ? Math.round(paymentAmountCents * minorUnitRate(dayRate, payCurrency, homeCurrency)) : bookedCents;
  const fxCents = (direction === 'received' ? 1 : -1) * (arrivedCents - bookedCents);

  const handleAutoAllocate = () => {
    let remainingToDistribute = paymentAmountCents;
    const nextMap: Record<string, string> = {};

    for (const docItem of openDocs) {
      if (remainingToDistribute <= 0) break;
      const alloc = Math.min(docItem.remainingCents, remainingToDistribute);
      nextMap[docItem.id] = minorToMajor(alloc, payCurrency).toFixed(digits);
      remainingToDistribute -= alloc;
    }

    setAllocationsMap(nextMap);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentWorkspaceId || !user) {
      toast.error('Workspace or user context missing');
      return;
    }
    if (paymentAmountCents <= 0) {
      toast.error('Payment amount must be greater than zero');
      return;
    }
    if (!selectedDepositAccountId) {
      toast.error('Please select a Bank / Cash Account');
      return;
    }
    if (!contactId) {
      toast.error(`Please select a ${direction === 'received' ? 'Customer' : 'Vendor'}`);
      return;
    }

    setIsSubmitting(true);
    try {
      const contactObj = direction === 'received' 
        ? customers.find(c => c.id === contactId) 
        : vendors.find(v => v.id === contactId);

      const contactName = contactObj?.name || 'Contact';

      // Allocations array
      const allocations: { documentId: string; documentType: 'invoice' | 'bill'; amountCents: number }[] = [];
      Object.entries(allocationsMap).forEach(([docId, valStr]) => {
        const p = Number.parseFloat(valStr);
        const cents = Number.isNaN(p) || p <= 0 ? 0 : Math.round(p * 10 ** digits);
        if (cents > 0) {
          allocations.push({
            documentId: docId,
            documentType: direction === 'received' ? 'invoice' : 'bill',
            amountCents: cents
          });
        }
      });

      const token = await user?.getIdToken();
      const contactType = direction === 'received' ? 'customer' : 'vendor';
      const memo = '';

      const paymentBody = JSON.stringify({
          workspaceId: currentWorkspaceId,
          paymentDate: date,
          amountCents: paymentAmountCents,
          paymentMethod: method,
          referenceNumber: reference || '',
          memo: memo || '',
          customerId: contactType === 'customer' ? contactId : undefined,
          vendorId: contactType === 'vendor' ? contactId : undefined,
          entityName: contactName,
          cashAccountId: selectedDepositAccountId,
          ...(isForeign && dayRate ? { paymentExchangeRate: dayRate, paymentRateSource: dayRateSource } : {}),
          ...(direction === 'made' && withholding ? { withheldCents: withholding.withheldCents, withholdingRatePercent: withholding.ratePercent, ...(withholding.certificate ? { withholdingCertificate: withholding.certificate } : {}) } : {}),
          allocations: allocations.map(a => ({
            documentId: a.documentId,
            documentType: a.documentType,
            amountCents: a.amountCents
          }))
        });
      const operationId = operationIdFor(paymentOps.current, paymentBody);
      const res = await fetch('/api/v1/payments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-operation-id': operationId,
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: paymentBody
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({ message: 'Payment processing failed' }));
        throw new Error(errJson.message || 'Payment processing failed');
      }

      // PREV-5: another workspace was opened while the payment was on its way: say where it went
      if (workspaceChangedSince(currentWorkspaceId)) toast.info(savedInOtherWorkspace(`The payment of ${formatCurrency(paymentAmountCents, payCurrency)}`, currentWorkspaceId));
      else toast.success(`Payment of ${formatCurrency(paymentAmountCents, payCurrency)} recorded successfully!`);
      onClose();
    } catch (err) {
      console.error('Failed to post payment:', err);
      const described = describeError(err, 'create');
      toast.error(`Payment not recorded: ${described.title.charAt(0).toLowerCase()}${described.title.slice(1)}`, { description: described.remedy });
    } finally {
      setIsSubmitting(false);
    }
  };

  const { dialogProps, titleId } = useDialog(onClose, isOpen);
  if (!isOpen) return null;

  return (
    <div {...dialogProps} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xl max-w-3xl w-full border border-slate-200 dark:border-slate-800 overflow-hidden my-8">
        <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <DollarSign className="w-5 h-5" />
            </div>
            <div>
              <h2 id={titleId} className="text-lg font-bold text-slate-900 dark:text-white">
                {direction === 'received' ? 'Receive Customer Payment' : 'Pay Vendor Bill'}
              </h2>
              <p className="text-xs text-[var(--muted)] dark:text-slate-400">
                Record payment and apply to open balances across documents
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="text-[var(--muted)] hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Direction toggle */}
          <div className="grid grid-cols-2 gap-3 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
            <button
              type="button"
              onClick={() => {
                setDirection('received');
                setContactId('');
                setAllocationsMap({});
              }}
              className={cn(
                'py-2 text-sm font-semibold rounded-md transition-colors',
                direction === 'received'
                  ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              )}
            >
              Receive Customer Payment
            </button>
            <button
              type="button"
              onClick={() => {
                setDirection('made');
                setContactId('');
                setAllocationsMap({});
              }}
              className={cn(
                'py-2 text-sm font-semibold rounded-md transition-colors',
                direction === 'made'
                  ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              )}
            >
              Pay Vendor Bill
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Contact selection */}
            <div>
              <label htmlFor="pay-contact" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                {direction === 'received' ? 'Customer' : 'Vendor'} *
              </label>
              <select
                id="pay-contact"
                value={contactId}
                onChange={e => {
                  setContactId(e.target.value);
                  setAllocationsMap({});
                }}
                required
                className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
              >
                <option value="">Select {direction === 'received' ? 'Customer' : 'Vendor'}...</option>
                {direction === 'received' ? (
                  customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)
                ) : (
                  vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)
                )}
              </select>
            </div>

            {/* Total Payment Amount */}
            <div>
              <label htmlFor="pay-amount" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Payment Amount ({payCurrency}) *
              </label>
              <input
                id="pay-amount"
                type="number"
                step="0.01"
                min="0.01"
                placeholder="0.00"
                value={amountDollars}
                onChange={e => setAmountDollars(e.target.value)}
                required
                className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white font-mono"
              />
            </div>

            {isForeign && (
              <div>
                <label htmlFor="pay-day-rate" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {homeCurrency} for 1 {payCurrency} on the payment day
                </label>
                <input id="pay-day-rate" type="number" step="0.000001" min="0" placeholder={String(payDoc?.rate || '')}
                  value={dayRate ?? ''} onChange={e => { setRateTyped(true); setDayRateSource('typed'); const n = Number.parseFloat(e.target.value); setDayRate(Number.isFinite(n) && n > 0 ? n : null); }}
                  className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white font-mono" />
                <p className="mt-1 text-[11px] text-[var(--muted)]" role="status">
                  {dayRate
                    ? `${direction === 'received' ? 'Arrives as' : 'Leaves as'} ${formatCurrency(arrivedCents, homeCurrency)}; ${fxCents === 0 ? 'no exchange difference' : `exchange ${fxCents > 0 ? 'gain' : 'loss'} ${formatCurrency(Math.abs(fxCents), homeCurrency)}`} against the document's rate (${payDoc?.rate})`
                    : `Without it, the payment is booked at the document's rate (${payDoc?.rate})`}
                  {rateNote ? ` · ${rateNote}` : ''}
                </p>
              </div>
            )}

            {/* Date */}
            <div>
              <label htmlFor="pay-date" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Payment Date *
              </label>
              <input
                id="pay-date"
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                required
                className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
              />
            </div>

            {/* Deposit Account */}
            <div>
              <label htmlFor="pay-deposit-acc" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                {direction === 'received' ? 'Deposit to Account' : 'Paid from Account'} *
              </label>
              <select
                id="pay-deposit-acc"
                value={selectedDepositAccountId}
                onChange={e => setDepositAccountId(e.target.value)}
                required
                className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
              >
                {cashAccounts.map(a => (
                  <option key={a.id} value={a.id}>{a.code ? `${a.code} - ${a.name}` : a.name}</option>
                ))}
              </select>
            </div>

            {/* Payment Method */}
            <div>
              <label htmlFor="pay-method" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Payment Method
              </label>
              <select
                id="pay-method"
                value={method}
                onChange={e => setMethod(e.target.value as unknown as React.SetStateAction<"cash" | "check" | "bank_transfer" | "card" | "other">)}
                className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
              >
                <option value="bank_transfer">Bank Transfer / Wire</option>
                <option value="check">Check</option>
                <option value="card">Credit / Debit Card</option>
                <option value="cash">Cash</option>
                <option value="other">Other</option>
              </select>
            </div>

            {/* Reference */}
            <div>
              <label htmlFor="pay-reference" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Reference / Check #
              </label>
              <input
                id="pay-reference"
                type="text"
                placeholder="e.g. CHK-90412"
                value={reference}
                onChange={e => setReference(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
              />
            </div>
          </div>

          {/* Document Allocation Table */}
          <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
            <div className="flex items-center justify-between p-3 bg-slate-100 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                Apply to Open {direction === 'received' ? 'Invoices' : 'Bills'} ({openDocs.length})
              </span>
              <button
                type="button"
                onClick={handleAutoAllocate}
                disabled={paymentAmountCents <= 0 || openDocs.length === 0}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Apply to oldest first
              </button>
            </div>

            {openDocs.length === 0 ? (
              <div className="p-6 text-center text-xs text-[var(--muted)] dark:text-slate-400">
                {contactId ? `No open ${direction === 'received' ? 'invoices' : 'bills'} found for this contact.` : `Select a ${direction === 'received' ? 'customer' : 'vendor'} to view open documents.`}
              </div>
            ) : (
              <div className="max-h-60 overflow-y-auto divide-y divide-slate-200 dark:divide-slate-800">
                {openDocs.map(docItem => (
                  <div key={docItem.id} className="grid grid-cols-12 gap-2 p-3 items-center text-xs hover:bg-slate-50 dark:hover:bg-slate-800/30">
                    <div className="col-span-3 font-medium text-slate-900 dark:text-white">
                      #{docItem.number}
                    </div>
                    <div className="col-span-3 text-[var(--muted)]">
                      {docItem.date}
                    </div>
                    <div className="col-span-3 font-mono text-slate-700 dark:text-slate-300">
                      Remaining: {formatCurrency(docItem.remainingCents, docItem.currency)}
                    </div>
                    <div className="col-span-3">
                      <input
                        id={`alloc-${docItem.id}`}
                        aria-label={`Allocation amount for document ${docItem.number}`}
                        type="number"
                        step="0.01"
                        min="0"
                        max={minorToMajor(docItem.remainingCents, docItem.currency).toFixed(currencyDigits(docItem.currency))}
                        placeholder="0.00"
                        value={allocationsMap[docItem.id] || ''}
                        onChange={e => {
                          const val = e.target.value;
                          setAllocationsMap(prev => ({ ...prev, [docItem.id]: val }));
                        }}
                        className="w-full px-2 py-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-md font-mono text-right text-slate-900 dark:text-white"
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {direction === 'made' && !isForeign && contactId && (
            <WithholdingField vendor={vendors.find(v => v.id === contactId)} date={date} bills={bills || []} currency={payCurrency}
              allocations={Object.fromEntries(Object.entries(allocationsMap).map(([k, v]) => [k, toMinor(v)]))} onChange={setWithholding} />
          )}

          {/* Payment Summary Footer */}
          <div className="flex flex-wrap items-center justify-between p-3 bg-slate-50 dark:bg-slate-800/40 rounded-lg border border-slate-200 dark:border-slate-800 text-xs gap-4">
            <div>
              <span className="text-[var(--muted)]">Total Payment:</span>{' '}
              <strong className="font-mono text-slate-900 dark:text-white">{formatCurrency(paymentAmountCents, payCurrency)}</strong>
            </div>
            <div>
              <span className="text-[var(--muted)]">Total Applied:</span>{' '}
              <strong className="font-mono text-slate-900 dark:text-white">{formatCurrency(totalAllocatedCents, payCurrency)}</strong>
            </div>
            <div>
              <span className="text-[var(--muted)]">Unapplied Balance:</span>{' '}
              <strong className={cn("font-mono", unappliedCents > 0 ? "text-amber-600 dark:text-amber-400 font-bold" : "text-slate-900 dark:text-white")}>
                {formatCurrency(unappliedCents, payCurrency)}
              </strong>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors disabled:opacity-50 inline-flex items-center gap-2"
            >
              {isSubmitting ? 'Posting Payment...' : 'Record & Post Payment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
