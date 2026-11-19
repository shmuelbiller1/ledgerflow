import { useNewRecord } from '../../hooks/useNewRecord';
import { PartyDetailButton } from '../common/PartyDetailButton';
import { PageHeader } from '../ui/PageHeader';
import { useDetailReturnFocus } from '../../hooks/useDetailReturnFocus';
import React, { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Customer, Invoice } from '../../types';
import { Plus, AlertCircle, Activity, ShieldCheck, TrendingUp } from 'lucide-react';
import { parseLocalDate, cn, formatCurrency, getLocalDateISO } from '../../lib/utils';
import { isOpenInvoice } from '../../lib/txFilters';
import { calculateAmountDue } from '../../lib/documentMath';
import { csvMoney, csvMoneyIn } from '../../lib/csvExport';
import { motion } from 'motion/react';
import InvoiceModal from './InvoiceModal';
import { useRecordFocus, recordElementId } from '../../hooks/useRecordFocus';
import { EmptyState } from '../ui/EmptyState';
import { LoadingState } from '../ui/LoadingState';
import { TanStackDataGrid } from '../ui/TanStackDataGrid';
import CustomerModal from './CustomerModal';
import TagFilter from '../common/TagFilter';
import { allTags, hasTag, isArchivedParty, matchPartyByName } from '../../lib/contacts';
import PartyRowActions, { ArchivedBadge, ShowArchivedToggle } from '../common/PartyRowActions';
import EmailStatementsButton from './EmailStatementsButton';
import DocumentTotalsFoot from '../ui/DocumentTotalsFoot';
import WriteOffModal from './WriteOffModal';
import SpreadDialog from '../common/SpreadDialog';
import { undoSpreadRequest } from '../../services/spreadActions';
import { recordReceiptPayment } from '../../services/receiptActions';
import { attachFiles, attachSummary } from '../../services/attachmentActions';
import OpeningDocumentsDialog from '../common/OpeningDocumentsDialog';
import type { ReceiptPayment } from './InvoiceModal';
import InvoiceEmailDialog from './InvoiceEmailDialog';
import PdfPreviewModal from '../ui/PdfPreviewModal';
import { downloadDocumentPdf } from '../../services/documentDownloads';
import { ensureInvoiceDimensionNodes } from '../../lib/dimensionNodeActions';
import ReceivePaymentModal from './ReceivePaymentModal';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useUIStore } from '../../stores/useUIStore';
import { translateScreenString } from '../../lib/i18n/screenTranslations';
import { clearFreeInvoice, readFreeInvoice } from '../../lib/freeInvoice';
import { computeCustomerBalanceSummary, toBaseCents } from '../../server/reports/partyReports';
import { useEntityOperations } from '../../hooks/useEntityOperations';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import InlineEdit from '../ui/InlineEdit';
import InlineAdd from '../ui/InlineAdd';
import DocumentBulkBar from '../ui/DocumentBulkBar';
import { calculateNextOccurrence } from '../../lib/recurringEngine';
import CustomerRecordPage from './CustomerRecordPage';
import InvoiceRecordPage from './InvoiceRecordPage';
import { showSavedToast } from '../common/NextStepToast';
import { invoiceSavedSteps } from '../../lib/nextSteps';
import { approvalDecision, isApproverRole } from '../../lib/invoiceApproval';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { useScreenDataHealth } from '../../hooks/useScreenDataHealth';
import { ScreenDataNotice } from '../ui/ScreenDataNotice';
import { inBackground } from '../../lib/inBackground';
import { buildCustomerColumns, buildInvoiceColumns } from './salesColumns';
import { runCommand } from '../../lib/runCommand';

/** EU-I3: the maker's "Bill to" becomes an existing customer of that name, or a new one the form creates on save. */
function withCustomer(draft: Partial<Invoice>, customers: Customer[]): Partial<Invoice> {
  // the shared resolver: an exact name wins, a loose match counts only when it is the only one
  const { party, ambiguous } = matchPartyByName(customers, (draft.customerName || '').trim());
  if (party) return { ...draft, customerId: party.id, customerName: party.name };
  // two customers fit the name: leave the choice to the person instead of guessing one
  if (ambiguous) return { ...draft, customerId: undefined };
  return { ...draft, customerId: `new-${crypto.randomUUID()}` };
}

/** Accounts receivable workspace screen for customer invoices, receipts, payments, and credit notes. */
export default function Sales() {
  const language = useUIStore(s => s.language);
  const openRecord = useUIStore(s => s.openRecord);
  const clearFocusRecord = useUIStore(s => s.clearFocusRecord);
  const salesText = useCallback((key: string, fallback: string) => translateScreenString('sales', key, language, fallback), [language]);
  const user = useAuthStore(s => s.user);
  const invoices = useLedgerStore(s => s.invoices);
  const customers = useLedgerStore(s => s.customers);
  const accounts = useLedgerStore(s => s.accounts);
  const payments = useLedgerStore(s => s.payments);
  const creditNotes = useLedgerStore(s => s.creditNotes);
  const currentWorkspaceId = useAuthStore(s => s.currentWorkspaceId);
  const homeCurrency = useAuthStore(s => s.getCurrentWorkspace()?.currency) || 'USD';
  const approvalSettings = useAuthStore(s => s.getCurrentWorkspace()?.invoiceApproval);
  const canDecideApproval = isApproverRole(useCurrentRole());

  const { loading } = useLedgerCollections('creditNotes', 'customers', 'invoices', 'payments');
  const dataHealth = useScreenDataHealth(['creditNotes', 'customers', 'invoices', 'payments', 'accounts']);
  const { addEntity, updateEntity } = useEntityOperations();
  const canEditContacts = useCurrentRole() !== 'viewer';

  const [spreadingInvoice, setSpreadingInvoice] = useState<Invoice | null>(null);
  const [pickedInvoices, setPickedInvoices] = useState<Set<string>>(() => new Set());
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const detailOpenerId = useDetailReturnFocus(selectedCustomerId);

  const [activeSubTab, setActiveSubTab] = useState<'invoices' | 'customers'>('invoices');
  // EU-I3: a draft from the free maker opens in the sample company or in the signed-in workspace that stashed it
  const sampleSession = useAuthStore(st => st.isGuest && !st.user);
  const signedInUid = useAuthStore(st => st.user?.uid);
  const workspaceIdNow = useAuthStore(st => st.currentWorkspaceId);
  const currentFreeSessionKey = `${sampleSession}:${signedInUid || ''}:${workspaceIdNow || ''}`;
  const [freeDraftSessionKey, setFreeDraftSessionKey] = useState(currentFreeSessionKey);
  const [freeDraftDismissed, setFreeDraftDismissed] = useState(false);
  const [freeDraft, setFreeDraft] = useState<Partial<Invoice> | null>(() => (
    typeof window === 'undefined' || (!sampleSession && !signedInUid)
      ? null
      : readFreeInvoice(window.localStorage, { sample: sampleSession, uid: signedInUid, workspaceId: workspaceIdNow || undefined })
  ));
  const [isInvoiceModalOpen, setIsInvoiceModalOpen] = useState(Boolean(freeDraft));
  const [openingOpen, setOpeningOpen] = useState(false);
  const [receiptMode, setReceiptMode] = useState(false);
  const [newInvoiceFor, setNewInvoiceFor] = useState<Partial<Invoice> | undefined>(() => (freeDraft ? withCustomer(freeDraft, customers) : undefined));
  if (currentFreeSessionKey !== freeDraftSessionKey) {
    setFreeDraftSessionKey(currentFreeSessionKey);
    if (!freeDraft && !freeDraftDismissed && typeof window !== 'undefined' && (sampleSession || (signedInUid && workspaceIdNow))) {
      const loaded = readFreeInvoice(window.localStorage, { sample: sampleSession, uid: signedInUid, workspaceId: workspaceIdNow || undefined });
      if (loaded) {
        setFreeDraft(loaded);
        setNewInvoiceFor(withCustomer(loaded, customers));
        setIsInvoiceModalOpen(true);
      }
    }
  }
  // A free-maker draft whose customer was only typed ('new-…') takes the real customer once the list
  // has it. The result is written back into state once, so the modal's initial invoice keeps one
  // reference and a later customers update never refills the form over the person's edits.
  if (newInvoiceFor?.metadata?.source === 'free-invoice-maker' && typeof newInvoiceFor.customerId === 'string'
    && newInvoiceFor.customerId.startsWith('new-') && customers.length > 0) {
    const resolved = withCustomer(newInvoiceFor, customers);
    if (typeof resolved.customerId === 'string' && !resolved.customerId.startsWith('new-')) {
      setNewInvoiceFor({ ...newInvoiceFor, customerId: resolved.customerId, customerName: resolved.customerName });
    }
  }
  const modalInitialInvoice = newInvoiceFor;
  // the stored copy stays until the draft is saved or deliberately closed, so a reload keeps it
  const finishFreeDraft = () => {
    setFreeDraftDismissed(true);
    if (freeDraft) clearFreeInvoice(window.localStorage);
  };
  const [isCustomerModalOpen, setIsCustomerModalOpen] = useState(false);
  const [customerTag, setCustomerTag] = useState<string | null>(null);
  const [showArchivedCustomers, setShowArchivedCustomers] = useState(false);
  const [paymentDocumentId, setPaymentDocumentId] = useState<string | null>(null);
  const [paymentContactId, setPaymentContactId] = useState<string | null>(null);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isWriteOffOpen, setIsWriteOffOpen] = useState(false);
  const [selectedInvoiceForWriteOff, setSelectedInvoiceForWriteOff] = useState<Invoice | null>(null);
  const [previewPdfInvoice, setPreviewPdfInvoice] = useState<Invoice | null>(null);
  const [emailInvoice, setEmailInvoice] = useState<Invoice | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [customerSearchTerm, setCustomerSearchTerm] = useState('');

  const customerBalances = useMemo(() => {
    const map: Record<string, number> = {};
    for (const row of computeCustomerBalanceSummary(customers || [], invoices || [], payments || [], creditNotes || [], undefined, undefined, undefined, homeCurrency)) {
      map[row.customerId] = row.balanceCents;
    }
    return map;
  }, [customers, invoices, payments, creditNotes, homeCurrency]);

  const customerTags = useMemo(() => allTags(customers), [customers]);
  const archivedCustomers = useMemo(() => customers.filter(isArchivedParty).length, [customers]);
  const shownCustomers = useMemo(() => customers.filter(c => hasTag(c, customerTag) && (showArchivedCustomers || !isArchivedParty(c))), [customers, customerTag, showArchivedCustomers]);

  const openPaymentForInvoice = useCallback((inv: Invoice) => {
    if (inv.customerId) {
      setPaymentContactId(inv.customerId);
      setPaymentDocumentId(inv.id);
      setIsPaymentModalOpen(true);
    } else {
      toast.error('Invoice is missing a customer.');
    }
  }, []);

  const onAddInvoice = useCallback(async (input: Partial<Invoice> & { receiptPayment?: ReceiptPayment; attachmentFiles?: File[] }) => {
    const { receiptPayment, attachmentFiles, ...rest } = input;
    let data = rest;
    if (typeof data.customerId === 'string' && data.customerId.startsWith('new-')) {
      const name = String(data.customerName || '').trim();
      if (!name) {
        toast.error("Pick a customer or type a new customer's name.");
        throw new Error('No customer name');
      }
      // a customer of that name may already exist (typed with other capitals or spaces, or added a moment ago):
      // use it instead of refusing the invoice; several near-identical names: ask, never add another
      const { party: existing, ambiguous } = matchPartyByName(useLedgerStore.getState().customers, name);
      if (ambiguous) {
        toast.error(`More than one customer is called "${name}" in different capitals. Pick the customer from the list.`);
        throw new Error('Ambiguous customer name');
      }
      if (existing) {
        data = { ...data, customerId: existing.id, customerName: existing.name };
      } else {
        const created = await addEntity('customers', { name, status: 'active' }, `Customer "${name}" added`);
        if (!created) throw new Error('Customer not saved');
        data = { ...data, customerId: created.id };
      }
    }
    // the box keeps what was typed ("acme "); the invoice is saved with the customer's own name
    if (typeof data.customerId === 'string' && !data.customerId.startsWith('new-')) {
      const chosen = useLedgerStore.getState().customers.find(c => c.id === data.customerId);
      if (chosen?.name) data = { ...data, customerName: chosen.name };
    }
    try { data = await ensureInvoiceDimensionNodes(data); }
    catch (err) { toast.error(err instanceof Error && err.message ? err.message : 'Could not save dimension label.'); throw err; }
    let res;
    if (data.id) {
      const { id, ...updates } = data;
      res = await updateEntity('invoices', id, updates);
    } else {
      res = await addEntity('invoices', data);
      if (!res) throw new Error('Invoice not saved');
      const savedInvoice = { ...data, id: res.id } as Invoice;
      if (res && receiptPayment) {
        // A sale receipt pays the invoice as part of the same save, and `recordReceiptPayment` announces that
        // result itself ("saved and paid", or "saved as an open invoice … record it with Receive payment"). An
        // offer here would repeat it — and, drawn before the payment landed, would offer to take a payment that is
        // already being taken. So the receipt owns the voice, and the offer waits for a save that is only a save.
        await recordReceiptPayment(currentWorkspaceId || '', savedInvoice, receiptPayment);
      } else {
        // the save ends with what to do next, in the manifest's words: send a draft, take the payment, start another
        showSavedToast({
          message: `Invoice ${data.number || res.id} saved`,
          what: 'The invoice',
          workspaceId: currentWorkspaceId,
          steps: invoiceSavedSteps(savedInvoice),
          run: action => {
            if (action === 'send') setEmailInvoice(savedInvoice);
            else if (action === 'payment') openPaymentForInvoice(savedInvoice);
            else setIsInvoiceModalOpen(true);
          },
        });
      }
      const uid = useAuthStore.getState().user?.uid;
      if (res && uid && Array.isArray(attachmentFiles) && attachmentFiles.length) {
        const { ok, message } = attachSummary(await attachFiles(currentWorkspaceId || '', uid, { collection: 'invoices', id: res.id, label: `Invoice ${data.number || ''}`.trim() }, attachmentFiles));
        if (ok) toast.success(message); else toast.error(message);
      }
    }

    if (data.type === 'recurring') {
      const startDateStr = data.date || getLocalDateISO();
      const anchorDay = Number(startDateStr.split('-')[2]) || 1;
      const nextOcc = calculateNextOccurrence(startDateStr, data.recurringInterval || 'monthly', anchorDay);
      const {
        id: _id, number: _number, status: _status, date: _date, dueDate, amountPaidCents: _paid, depositCents: _deposit,
        paymentToken: _token, metadata: _metadata, type: _type, recurringInterval: _interval, createdAt: _created,
        updatedAt: _updated, ...invoiceFields
      } = data;
      const dueDays = dueDate && startDateStr ? Math.max(0, Math.round((Date.parse(`${String(dueDate).slice(0, 10)}T00:00:00Z`) - Date.parse(`${startDateStr.slice(0, 10)}T00:00:00Z`)) / 86400000)) : 30;
      await addEntity('recurring', {
        description: `Recurring Invoice: ${data.customerName || 'Customer'} - ${data.number || 'Standard'}`,
        amountCents: data.amountCents || 0,
        frequency: data.recurringInterval || 'monthly',
        nextOccurrence: nextOcc,
        anchorDay,
        isActive: true,
        status: 'active',
        type: 'invoice',
        payee: data.customerName || '',
        invoiceTemplate: { ...invoiceFields, dueDays },
        template: {
          description: `Invoice: ${data.customerName || 'Customer'}`,
          amountCents: data.amountCents || 0,
          customerId: data.customerId,
          tags: ['recurring', 'invoice', ...(data.tags || [])],
        },
      }, 'Recurring schedule registered');
    }
    return res;
  }, [addEntity, updateEntity, currentWorkspaceId, openPaymentForInvoice]);

  const onAddCustomer = (data: Partial<Customer>) => {
    if (data.id) {
      const { id, ...updates } = data;
      return updateEntity('customers', id, updates);
    }
    return addEntity('customers', data);
  };

  useNewRecord('invoice', canEditContacts, () => {
    setActiveSubTab('invoices'); setSelectedCustomerId(null); setNewInvoiceFor(undefined); setReceiptMode(false); setIsInvoiceModalOpen(true);
  });
  useNewRecord('customer', canEditContacts, () => {
    setActiveSubTab('customers'); setSelectedCustomerId(null); setIsCustomerModalOpen(true);
  });

  const focusedInvoiceId = useRecordFocus('invoice', {
    ready: invoices.length > 0,
    onFocus: () => { setActiveSubTab('invoices'); setSelectedCustomerId(null); setSearchTerm(''); },
  });
  const invoiceOpenerId = useDetailReturnFocus(focusedInvoiceId);

  const reverseWriteOff = useCallback(async (inv: Invoice) => {
    if (!currentWorkspaceId) return;
    try {
      // the write-off reversal answers with the invoice; the screen shows its own success line
      await runCommand({ path: `/api/v1/workspaces/${encodeURIComponent(currentWorkspaceId)}/invoices/${encodeURIComponent(inv.id)}/write-off/reverse`, method: 'POST', body: { reason: 'Customer paid after all' } });
      toast.success(`Write-off reversed: ${formatCurrency(inv.writtenOffCents || 0)} is due again. Record the payment now.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The write-off could not be reversed');
    }
  }, [currentWorkspaceId]);

  const agingBuckets = useMemo(() => {
    const owedInBase = (i: Invoice) => toBaseCents(calculateAmountDue(i), i.exchangeRate, i.currency, homeCurrency);
    const now = new Date();
    return {
      overdue: invoices.filter(i => isOpenInvoice(i) && (i.status === 'overdue' || parseLocalDate(i.dueDate) < now)).reduce((sum, i) => sum + owedInBase(i), 0),
      dueSoon: invoices.filter(i => {
        const dueDate = parseLocalDate(i.dueDate);
        const diff = (dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
        return isOpenInvoice(i) && (i.status === 'sent' || i.status === 'pending') && diff >= 0 && diff <= 30;
      }).reduce((sum, i) => sum + owedInBase(i), 0),
      total: invoices.filter(isOpenInvoice).reduce((sum, i) => sum + owedInBase(i), 0),
    };
  }, [invoices, homeCurrency]);

  const filteredInvoices = useMemo(() => {
    const term = searchTerm.toLowerCase();
    if (!term) return invoices;
    return invoices.filter((i: Invoice) => {
      const customer = customers?.find(c => c.id === i.customerId);
      const searchStr = `${i.customerName || ''} ${i.number || ''} ${i.metadata ? JSON.stringify(i.metadata) : ''} ${i.tags?.join(' ') || ''} ${customer?.tags?.join(' ') || ''} ${customer?.metadata ? JSON.stringify(customer.metadata) : ''}`.toLowerCase();
      return searchStr.includes(term);
    });
  }, [invoices, customers, searchTerm]);

  const filteredCustomers = useMemo(() => {
    const term = customerSearchTerm.trim().toLowerCase();
    if (!term) return shownCustomers;
    return shownCustomers.filter(c => `${c.name || ''} ${c.email || ''} ${c.phone || ''}`.toLowerCase().includes(term));
  }, [shownCustomers, customerSearchTerm]);

  const decideApproval = useCallback((inv: Invoice, decision: 'approved' | 'rejected') => {
    let note: string | undefined;
    if (decision === 'rejected') {
      const asked = window.prompt(`What should be changed on invoice ${inv.number || ''}? (optional)`);
      if (asked === null) return;
      note = asked;
    }
    inBackground(updateEntity('invoices', inv.id, {
      approval: approvalDecision(approvalSettings, decision, { uid: user?.uid, note }),
    }, decision === 'approved' ? 'Approved — the invoice can be emailed now.' : 'Sent back for changes.'));
  }, [approvalSettings, updateEntity, user?.uid]);

  const voidInvoice = useCallback(async (inv: Invoice) => {
    if (inv.revenueSchedule && !(await undoSpreadRequest('invoice', currentWorkspaceId || '', inv.id))) return;
    inBackground(onAddInvoice({ id: inv.id, status: 'void' }));
  }, [currentWorkspaceId, onAddInvoice]);

  const invoiceColumns = useMemo(() => buildInvoiceColumns({
    salesText,
    canEditContacts,
    payments,
    currentWorkspaceId,
    approvalSettings,
    homeCurrency,
    canDecideApproval,
    openRecord,
    invoiceOpenerId,
    updateEntity,
    onEditInvoice: inv => { setNewInvoiceFor(inv); setIsInvoiceModalOpen(true); },
    onDuplicateInvoice: draft => { setNewInvoiceFor(draft); setIsInvoiceModalOpen(true); },
    onOpenPayment: openPaymentForInvoice,
    onSpreadInvoice: inv => setSpreadingInvoice(inv),
    onReverseWriteOff: inv => { void reverseWriteOff(inv); },
    onWriteOffInvoice: inv => { setSelectedInvoiceForWriteOff(inv); setIsWriteOffOpen(true); },
    onEmailInvoice: inv => setEmailInvoice(inv),
    onPreviewPdf: inv => setPreviewPdfInvoice(inv),
    onDecideApproval: decideApproval,
    onVoidInvoice: voidInvoice,
  }), [
    salesText, canEditContacts, payments, currentWorkspaceId, approvalSettings, homeCurrency,
    canDecideApproval, openRecord, invoiceOpenerId, updateEntity, openPaymentForInvoice, reverseWriteOff, decideApproval, voidInvoice,
  ]);

  const customerColumns = useMemo(() => buildCustomerColumns({
    salesText,
    canEditContacts,
    customerBalances,
    detailOpenerId,
    updateEntity,
    onSelectCustomer: setSelectedCustomerId,
    onEnterInvoice: cust => { setNewInvoiceFor({ customerId: cust.id, customerName: cust.name }); setIsInvoiceModalOpen(true); },
  }), [salesText, canEditContacts, customerBalances, detailOpenerId, updateEntity]);

  const modals = (
    <>
      {openingOpen && <OpeningDocumentsDialog side="customer" onClose={() => setOpeningOpen(false)} />}
      {isInvoiceModalOpen && (
        <InvoiceModal key={`${newInvoiceFor?.id || 'new'}${receiptMode ? '-receipt' : ''}`} isOpen={isInvoiceModalOpen} receipt={receiptMode}
          onClose={() => { finishFreeDraft(); setIsInvoiceModalOpen(false); setNewInvoiceFor(undefined); setReceiptMode(false); }}
          onSave={async (inv) => { await onAddInvoice(inv); finishFreeDraft(); setIsInvoiceModalOpen(false); setNewInvoiceFor(undefined); setReceiptMode(false); }}
          customers={customers} accounts={accounts} initialInvoice={modalInitialInvoice} />
      )}
      <CustomerModal isOpen={isCustomerModalOpen} onClose={() => setIsCustomerModalOpen(false)}
        onSave={async (cust) => {
          const saved = await onAddCustomer(cust);
          if (!saved) return false;
          setIsCustomerModalOpen(false);
          return true;
        }} />
      {isPaymentModalOpen && paymentDocumentId && paymentContactId && (
        <ReceivePaymentModal isOpen={isPaymentModalOpen} onClose={() => setIsPaymentModalOpen(false)}
          defaultDirection="received" defaultDocumentId={paymentDocumentId} defaultContactId={paymentContactId} />
      )}
      {emailInvoice && <InvoiceEmailDialog invoice={emailInvoice} onClose={() => setEmailInvoice(null)} />}
      {spreadingInvoice && <SpreadDialog kind="invoice" document={spreadingInvoice} onClose={() => setSpreadingInvoice(null)} />}
      {isWriteOffOpen && selectedInvoiceForWriteOff && (
        <WriteOffModal isOpen={isWriteOffOpen} onClose={() => { setIsWriteOffOpen(false); setSelectedInvoiceForWriteOff(null); }} invoice={selectedInvoiceForWriteOff} />
      )}
      {previewPdfInvoice && (
        <PdfPreviewModal isOpen={!!previewPdfInvoice} onClose={() => setPreviewPdfInvoice(null)}
          title={`Invoice ${previewPdfInvoice.number || previewPdfInvoice.id}`} documentType="invoice"
          documentId={previewPdfInvoice.id} workspaceId={currentWorkspaceId || 'default'}
          filename={`invoice_${previewPdfInvoice.number || previewPdfInvoice.id}.pdf`} />
      )}
    </>
  );

  if (selectedCustomerId) {
    return (
      <>
        <CustomerRecordPage customerId={selectedCustomerId} onBack={() => setSelectedCustomerId(null)}
          onNewInvoice={customer => {
            setSelectedCustomerId(null);
            setNewInvoiceFor({ customerId: customer.id, customerName: customer.name });
            setIsInvoiceModalOpen(true);
          }} />
        {modals}
      </>
    );
  }

  if (focusedInvoiceId) {
    return (
      <>
        <InvoiceRecordPage
          invoiceId={focusedInvoiceId}
          onBack={() => clearFocusRecord()}
          onEdit={inv => { setNewInvoiceFor(inv); setIsInvoiceModalOpen(true); }}
          onSendEmail={inv => setEmailInvoice(inv)}
          onReceivePayment={openPaymentForInvoice}
          onPreviewPdf={inv => setPreviewPdfInvoice(inv)}
          onDownloadPdf={inv => downloadDocumentPdf('invoice', inv.id, currentWorkspaceId || 'default', `invoice_${inv.number || inv.id}.pdf`)}
          onVoid={inv => void voidInvoice(inv)}
          onOpenCustomer={customerId => { clearFocusRecord(); setSelectedCustomerId(customerId); }}
        />
        {modals}
      </>
    );
  }

  return (
    <div dir={language === 'he' ? 'rtl' : 'ltr'} lang={language} className="w-full space-y-6 p-4 sm:p-6 lg:p-8">
      <ScreenDataNotice failedKeys={dataHealth.failedKeys} message={dataHealth.message} onRetry={dataHealth.retry} what="this screen" />
      {loading && (invoices.length > 0 || customers.length > 0) && (
        <p role="status" className="text-xs text-[var(--muted)] px-1">{salesText('status.refreshing', 'Refreshing this screen…')}</p>
      )}

      <PageHeader icon={<TrendingUp className="w-6 h-6 text-emerald-500" aria-hidden="true" />} title={salesText('title', 'Sales')}
        description={salesText('description', 'Invoices you send and the money customers owe you.')}>
        <div className="flex items-center bg-[var(--surface)]/80 p-1 rounded-xl border border-[var(--line)] shadow-inner backdrop-blur-sm">
          <button
            type="button"
            onClick={() => setActiveSubTab('invoices')}
            aria-pressed={activeSubTab === 'invoices'}
            className={cn(
              'px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer',
              activeSubTab === 'invoices'
                ? 'bg-[var(--elevated)] text-[var(--text)] border border-[var(--line)] font-bold shadow-2xs'
                : 'text-[var(--muted)] hover:text-[var(--text)]',
            )}
          >
            {salesText('tab.invoices', 'Invoices')}
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab('customers')}
            aria-pressed={activeSubTab === 'customers'}
            className={cn(
              'px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer',
              activeSubTab === 'customers'
                ? 'bg-[var(--elevated)] text-[var(--text)] border border-[var(--line)] font-bold shadow-2xs'
                : 'text-[var(--muted)] hover:text-[var(--text)]',
            )}
          >
            {salesText('tab.customers', 'Customers')}
          </button>
        </div>
        {activeSubTab === 'invoices' && canEditContacts && (
          <button
            type="button"
            onClick={() => { setReceiptMode(true); setIsInvoiceModalOpen(true); }}
            title="A sale paid on the spot: the invoice and its payment in one step"
            className="flex items-center gap-1.5 px-4 py-2 border border-[var(--line)] text-[var(--text)] rounded-xl text-xs font-bold hover:bg-[var(--ink)] transition-all cursor-pointer"
          >
            <Plus aria-hidden="true" size={15} />
            {salesText('action.saleReceipt', 'Sale receipt')}
          </button>
        )}
        {activeSubTab === 'invoices' && canEditContacts && (
          <button
            type="button"
            onClick={() => setOpeningOpen(true)}
            title="The invoices still unpaid when you started: paste them from a spreadsheet"
            className="px-3 py-2 text-[var(--muted)] rounded-xl text-xs font-semibold hover:text-[var(--text)] hover:underline"
          >
            {salesText('action.openingInvoices', 'Opening invoices')}
          </button>
        )}
        <button
          type="button"
          onClick={() => (activeSubTab === 'invoices' ? setIsInvoiceModalOpen(true) : setIsCustomerModalOpen(true))}
          className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-[var(--brass)] via-[#e5be6b] to-[var(--brass)] text-black rounded-xl text-xs font-bold hover:opacity-95 transition-all shadow-md hover:shadow-lg cursor-pointer active:scale-95"
        >
          <Plus aria-hidden="true" size={15} />
          {activeSubTab === 'invoices' ? salesText('action.addInvoice', 'Add Invoice') : salesText('action.addCustomer', 'Add Customer')}
        </button>
      </PageHeader>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <motion.div
          initial={{ y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-5 bg-[var(--panel)] rounded-2xl border border-[var(--line)] shadow-sm relative overflow-hidden"
        >
          <p className={cn('text-[10px] font-mono uppercase tracking-widest font-semibold mb-3', agingBuckets.overdue > 0 ? 'text-rose-700 dark:text-rose-300' : 'text-[var(--muted)]')}>
            {salesText('summary.overdue', 'Overdue')}
          </p>
          <p className={cn('text-2xl sm:text-3xl font-mono font-bold tracking-tight tabular-nums', agingBuckets.overdue > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-[var(--muted)]')}>
            {formatCurrency(agingBuckets.overdue)}
          </p>
          <div className="mt-3 flex items-center gap-2 text-xs font-mono text-[var(--muted)]">
            <AlertCircle aria-hidden="true" size={12} />
            {salesText('summary.pastDue', 'Past the due date')}
          </div>
        </motion.div>

        <motion.div
          initial={{ y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="p-5 bg-[var(--panel)] rounded-2xl border border-[var(--line)] shadow-sm relative overflow-hidden"
        >
          <p className={cn('text-[10px] font-mono uppercase tracking-widest font-semibold mb-3', agingBuckets.dueSoon > 0 ? 'text-amber-700 dark:text-amber-300' : 'text-[var(--muted)]')}>
            {salesText('summary.dueSoon', 'Due in the next 30 days')}
          </p>
          <p className={cn('text-2xl sm:text-3xl font-mono font-bold tracking-tight tabular-nums', agingBuckets.dueSoon > 0 ? 'text-amber-700 dark:text-amber-300' : 'text-[var(--muted)]')}>
            {formatCurrency(agingBuckets.dueSoon)}
          </p>
          <div className="mt-3 flex items-center gap-2 text-xs font-mono text-[var(--muted)]">
            <Activity aria-hidden="true" size={12} />
            {salesText('summary.notDue', 'Not yet due')}
          </div>
        </motion.div>

        <motion.div
          initial={{ y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="p-5 bg-[var(--panel)] rounded-2xl border border-[var(--line)] shadow-sm relative overflow-hidden"
        >
          <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] font-semibold mb-3">
            {salesText('summary.totalOwed', 'Total owed to you')}
          </p>
          <p className="text-2xl sm:text-3xl font-mono font-bold text-[var(--text)] tracking-tight tabular-nums">
            {formatCurrency(agingBuckets.total)}
          </p>
          <div className="mt-3 flex items-center gap-2 text-xs font-mono text-[var(--muted)]">
            <ShieldCheck aria-hidden="true" size={12} className="text-[var(--brass)]" />
            {salesText('summary.unpaid', 'Unpaid invoices, all customers')}
          </div>
        </motion.div>
      </div>

      {activeSubTab === 'invoices' && (
        <div className="ledger-card p-3 sm:p-4 rounded-[32px] overflow-hidden">
          <TanStackDataGrid
            dir={language === 'he' ? 'rtl' : 'ltr'}
            caption={salesText('tab.invoices', 'Invoices')}
            data={filteredInvoices}
            columns={invoiceColumns}
            totalCount={invoices.length}
            loading={loading}
            loadingWhat="invoices"
            loadingState={<LoadingState what="invoices" />}
            searchValue={searchTerm}
            onSearchChange={setSearchTerm}
            manualFilter
            searchPlaceholder={salesText('search.invoices', 'Search invoices by customer or number...')}
            pageSize={100}
            hidePaginationOnSinglePage
            showSavedViews
            columnScope="sales-invoices"
            columnLabel="Invoices"
            columnNames={[
              salesText('table.selection', 'Selection'),
              salesText('table.number', 'Number'),
              salesText('table.customer', 'Customer'),
              salesText('table.date', 'Date'),
              salesText('table.due', 'Due'),
              salesText('table.amount', 'Amount'),
              salesText('table.state', 'State'),
              salesText('table.actions', 'Actions'),
            ]}
            selectable
            selectedIds={pickedInvoices}
            onSelectionChange={setPickedInvoices}
            selectAllLabel={salesText('table.selectAll', 'Select all invoices shown')}
            selectRowLabel={inv => `Select invoice ${inv.number || ''}`.trim()}
            bulkActions={currentWorkspaceId ? (
              <DocumentBulkBar
                type="invoice"
                noun="invoice"
                ids={[...pickedInvoices].filter(id => filteredInvoices.some(i => i.id === id))}
                documents={filteredInvoices.filter(i => pickedInvoices.has(i.id))}
                workspaceId={currentWorkspaceId}
                onClear={() => setPickedInvoices(new Set())}
              />
            ) : undefined}
            exportConfig={{
              filename: 'invoices.csv',
              label: salesText('action.exportCsv', 'Export CSV'),
              headers: ['Number', 'Customer', 'Date', 'Due Date', 'Status', 'Currency', 'Amount', 'Still Due'],
              mapRow: inv => {
                // each row's money is written with its own currency's decimals, so JPY/KWD re-import exactly (Gitar on #925)
                const cur = inv.currency || homeCurrency;
                const money = csvMoneyIn(cur);
                return [inv.number || '', inv.customerName || '', inv.date || '', inv.dueDate || '', inv.status, cur, money(inv.amountCents), money(calculateAmountDue(inv))];
              },
            }}
            mobileLayout="table"
            getRowProps={inv => ({
              id: recordElementId('invoice', inv.id),
              'data-record-id': inv.id,
              className: cn('group', focusedInvoiceId === inv.id && 'ring-2 ring-inset ring-[var(--brass)]'),
            })}
            footerContent={<DocumentTotalsFoot docs={filteredInvoices} homeCurrency={homeCurrency} colSpan={8} noun="invoice" />}
            emptyState={(
              <EmptyState
                title={salesText('empty.noInvoices', 'No invoices yet')}
                description={salesText('empty.createFirstInvoice', 'Create your first invoice to bill a customer.')}
                actionLabel={salesText('empty.createInvoice', 'Create invoice')}
                onAction={() => setIsInvoiceModalOpen(true)}
              />
            )}
            filteredEmptyState={(
              <EmptyState
                title={salesText('empty.noInvoiceMatches', 'No invoices match your search')}
                description={salesText('empty.tryAnotherSearch', 'Try another name or number.')}
              />
            )}
          />
        </div>
      )}

      {activeSubTab === 'customers' && (
        <div className="ledger-card p-3 sm:p-4 rounded-[32px] overflow-hidden space-y-4">
          {customers.length > 0 && (
            <div className="space-y-2">
              <TagFilter tags={customerTags} value={customerTag} onChange={setCustomerTag} label="Show customers with the tag" />
              <div className="flex flex-wrap items-center gap-2">
                <EmailStatementsButton className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-[var(--line)] text-xs font-semibold text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-50" />
                <ShowArchivedToggle count={archivedCustomers} on={showArchivedCustomers} onChange={setShowArchivedCustomers} noun="customer" />
              </div>
            </div>
          )}
          {canEditContacts && (
            <InlineAdd
              label="New customer name"
              placeholder="Add a customer: type a name and press Enter"
              existing={customers.map(c => c.name)}
              onAdd={name => addEntity('customers', { name, status: 'active' }, `Customer "${name}" added`)}
            />
          )}
          <TanStackDataGrid
            dir={language === 'he' ? 'rtl' : 'ltr'}
            caption={salesText('tab.customers', 'Customers')}
            data={filteredCustomers}
            columns={customerColumns}
            totalCount={customers.length}
            loading={loading}
            loadingWhat="customers"
            loadingState={<LoadingState what="customers" />}
            searchValue={customerSearchTerm}
            onSearchChange={setCustomerSearchTerm}
            manualFilter
            searchPlaceholder={salesText('search.customers', 'Search customers by name or email...')}
            pageSize={50}
            hidePaginationOnSinglePage
            columnScope="sales-customers"
            columnLabel="Customers"
            columnNames={[
              salesText('customer.table.profile', 'Customer Profile'),
              salesText('customer.table.contact', 'Contact'),
              salesText('customer.table.receivable', 'Net Receivable'),
              salesText('table.actions', 'Actions'),
            ]}
            exportConfig={{
              filename: 'customers.csv',
              label: salesText('action.exportCsv', 'Export CSV'),
              headers: ['Customer', 'Email', 'Phone', 'Net Receivable'],
              mapRow: c => [c.name, c.email || '', c.phone || '', csvMoney(customerBalances[c.id] ?? 0)],
            }}
            mobileLayout="cards"
            renderCard={cust => (
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <InlineEdit
                      value={cust.name}
                      label={`Name of ${cust.name}`}
                      canEdit={canEditContacts}
                      validate={v => (String(v) ? null : 'A customer needs a name')}
                      onSave={v => updateEntity('customers', cust.id, { name: v }, 'Name saved')}
                      className="font-bold text-[var(--text)] text-base"
                    />
                    <ArchivedBadge party={cust} />
                    <p className="text-xs text-[var(--muted)] truncate">{cust.email || cust.phone || '—'}</p>
                  </div>
                  <span className="font-mono font-bold text-sm tabular-nums text-[var(--text)] shrink-0">
                    {formatCurrency(customerBalances[cust.id] ?? 0)}
                  </span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[var(--line)]">
                  <PartyDetailButton id={detailOpenerId(cust.id)} side="customer" name={cust.name} onOpen={() => setSelectedCustomerId(cust.id)} />
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setNewInvoiceFor({ customerId: cust.id, customerName: cust.name });
                        setIsInvoiceModalOpen(true);
                      }}
                      className="inline-flex items-center justify-center min-h-11 min-w-11 p-2 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 rounded"
                      title="Enter Invoice"
                      aria-label={`Enter invoice for ${cust.name}`}
                    >
                      <Plus aria-hidden="true" size={16} />
                    </button>
                    {canEditContacts && <PartyRowActions side="customer" party={cust} />}
                  </div>
                </div>
              </div>
            )}
            getRowProps={() => ({ className: 'group' })}
            emptyState={(
              <EmptyState
                title={salesText('empty.noCustomers', 'No customers yet')}
                description={salesText('empty.addCustomerFirst', 'Add a customer before creating their first invoice.')}
                actionLabel={salesText('empty.addFirstCustomer', 'Add first customer')}
                onAction={() => setIsCustomerModalOpen(true)}
              />
            )}
            filteredEmptyState={(
              <EmptyState
                title={salesText('empty.noCustomerMatches', 'No customers match these filters')}
                description={salesText('empty.changeCustomerFilters', 'Choose another tag or show archived customers.')}
              />
            )}
          />
        </div>
      )}

      {modals}
    </div>
  );
}
