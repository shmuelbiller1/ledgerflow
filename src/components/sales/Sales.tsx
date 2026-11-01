import React, { useState, useMemo } from 'react';
import { toast } from 'sonner';
import { Customer, Invoice } from '../../types';
import { Plus, Users, Download, Mail, Clock, AlertCircle, Activity, ShieldCheck, TrendingUp, Trash2, DollarSign, Eye, Ban, Undo2, Bell, BellOff, Pencil } from 'lucide-react';
import { parseLocalDate, cn, formatCurrency, getLocalDateISO, safeConfirm, formatDate } from '../../lib/utils';
import { getIdToken } from '../../firebase';
import { isOpenInvoice } from '../../lib/txFilters';
import { calculateAmountDue } from '../../lib/documentMath';
import { differenceInDays } from 'date-fns';
import { motion } from 'motion/react';

import InvoiceModal from './InvoiceModal';
import { useRecordFocus, recordElementId } from '../../hooks/useRecordFocus';
import { EmptyState } from '../ui/EmptyState';
import ListColumnChooser from '../ui/ListColumnChooser';
import CustomerModal from './CustomerModal';
import TagFilter from '../common/TagFilter';
import { allTags, hasTag, isArchivedParty } from '../../lib/contacts';
import PartyRowActions, { ArchivedBadge, ShowArchivedToggle } from '../common/PartyRowActions';
import EmailStatementsButton from './EmailStatementsButton';
import DocumentTotalsFoot from '../ui/DocumentTotalsFoot';
import WriteOffModal from './WriteOffModal';
import SpreadDialog from '../common/SpreadDialog';
import { spreadProgress } from '../../lib/prepaidSchedule';
import { undoSpreadRequest } from '../../services/spreadActions';
import { estimateDeposits } from '../../lib/advancePayments';
import { applyEstimateDeposits } from '../../services/depositActions';
import { recordReceiptPayment } from '../../services/receiptActions';
import { attachFiles, attachSummary } from '../../services/attachmentActions';
import OpeningDocumentsDialog from '../common/OpeningDocumentsDialog';
import type { ReceiptPayment } from './InvoiceModal';
import InvoiceEmailDialog from './InvoiceEmailDialog';
import PdfPreviewModal from '../ui/PdfPreviewModal';
import { downloadDocumentPdf } from '../../services/documentDownloads';
import ReceivePaymentModal from './ReceivePaymentModal';

import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { computeCustomerBalanceSummary, toBaseCents } from '../../server/reports/partyReports';
import { useEntityOperations } from '../../hooks/useEntityOperations';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import InlineEdit from '../ui/InlineEdit';
import InlineAdd from '../ui/InlineAdd';
import DocumentBulkBar from '../ui/DocumentBulkBar';
import { calculateNextOccurrence } from '../../lib/recurringEngine';

import CustomerDetailView from './CustomerDetailView';
import InvoiceApprovalFlag from './InvoiceApprovalFlag';
import { StageChip } from '../collaboration/StageChip';
import { approvalDecision, isApproverRole } from '../../lib/invoiceApproval';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { LoadingState } from '../ui/LoadingState';
import { useScreenDataHealth } from '../../hooks/useScreenDataHealth';
import { ScreenDataNotice } from '../ui/ScreenDataNotice';
import { inBackground } from '../../lib/inBackground';

export default function Sales() {
  const user = useAuthStore(s => s.user);
  const invoices = useLedgerStore(s => s.invoices);
  const customers = useLedgerStore(s => s.customers);
  const accounts = useLedgerStore(s => s.accounts);
  const { loading } = useLedgerCollections('creditNotes', 'customers', 'invoices', 'payments');
  // A-235: one shared notice when what this screen needs could not be loaded, with "Try again"
  const dataHealth = useScreenDataHealth(['creditNotes', 'customers', 'invoices', 'payments', 'accounts']);
  const { addEntity, updateEntity } = useEntityOperations();
  const canEditContacts = useCurrentRole() !== 'viewer';
  const [spreadingInvoice, setSpreadingInvoice] = useState<Invoice | null>(null);
  const [pickedInvoices, setPickedInvoices] = useState<Set<string>>(() => new Set());

  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);

  // What each customer owes: the same calculation as the Customer Balance Summary report (open
  // invoices less payments and credits, base currency). It used to add unpaid invoice totals, then
  // receivable postings whose text mentioned the name, and fell back to a stored balance.
  const payments = useLedgerStore(s => s.payments);
  const creditNotes = useLedgerStore(s => s.creditNotes);
  const customerBalances = useMemo(() => {
    const map: Record<string, number> = {};
    for (const row of computeCustomerBalanceSummary(customers || [], invoices || [], payments || [], creditNotes || [])) {
      map[row.customerId] = row.balanceCents;
    }
    return map;
  }, [customers, invoices, payments, creditNotes]);
  const onAddInvoice = async (input: Partial<Invoice> & { receiptPayment?: ReceiptPayment; attachmentFiles?: File[] }) => {
    // a sale receipt (K-03) carries where its money went; that is a payment, not part of the invoice
    // files picked for a new invoice (K-07) are kept with it once it has an id
    const { receiptPayment, attachmentFiles, ...rest } = input;
    let data = rest;
    // A customer typed in the invoice that isn't on the list yet is added first, so the invoice
    // belongs to a real customer (statements, balances, emails)
    if (typeof data.customerId === 'string' && data.customerId.startsWith('new-')) {
      const name = String(data.customerName || '').trim();
      if (!name) { toast.error('Pick a customer or type a new customer\'s name.'); return; }
      const created = await addEntity('customers', { name, status: 'active' }, `Customer "${name}" added`);
      if (!created) return;
      data = { ...data, customerId: created.id };
    }
    let res;
    if (data.id) { 
      const { id, ...updates } = data; 
      res = await updateEntity('invoices', id, updates); 
    } else {
      res = await addEntity('invoices', data); 
      if (res && receiptPayment) await recordReceiptPayment(currentWorkspaceId || '', { ...data, id: res.id }, receiptPayment);
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
      // The daily job copies this invoice as a draft on each date (recurringService.ts)
      const { id: _id, number: _number, status: _status, date: _date, dueDate, amountPaidCents: _paid, depositCents: _deposit, paymentToken: _token,
        metadata: _metadata, type: _type, recurringInterval: _interval, createdAt: _created, updatedAt: _updated, ...invoiceFields } = data;
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
          tags: ['recurring', 'invoice', ...(data.tags || [])]
        }
      }, 'Recurring schedule registered');
    }
    return res;
  };
  const onAddCustomer = (data: Partial<Customer>) => { if (data.id) { const { id, ...updates } = data; return updateEntity('customers', id, updates); } return addEntity('customers', data); };
  // opens on the invoice list ('pipeline' was the default but nothing draws it: the page was blank)
  const [activeSubTab, setActiveSubTab] = useState<'invoices' | 'customers'>('invoices');
  const [isInvoiceModalOpen, setIsInvoiceModalOpen] = useState(false);
  const [openingOpen, setOpeningOpen] = useState(false);
  const [receiptMode, setReceiptMode] = useState(false);
  const [newInvoiceFor, setNewInvoiceFor] = useState<Partial<Invoice> | undefined>(undefined);
  const [isCustomerModalOpen, setIsCustomerModalOpen] = useState(false);
  const [customerTag, setCustomerTag] = useState<string | null>(null);
  const customerTags = useMemo(() => allTags(customers), [customers]);
  const [showArchivedCustomers, setShowArchivedCustomers] = useState(false);
  const archivedCustomers = useMemo(() => customers.filter(isArchivedParty).length, [customers]);
  const shownCustomers = useMemo(() => customers.filter(c => hasTag(c, customerTag) && (showArchivedCustomers || !isArchivedParty(c))), [customers, customerTag, showArchivedCustomers]);
  const [paymentDocumentId, setPaymentDocumentId] = useState<string | null>(null);
  const [paymentContactId, setPaymentContactId] = useState<string | null>(null);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isWriteOffOpen, setIsWriteOffOpen] = useState(false);
  const [selectedInvoiceForWriteOff, setSelectedInvoiceForWriteOff] = useState<Invoice | null>(null);
  const [previewPdfInvoice, setPreviewPdfInvoice] = useState<Invoice | null>(null);
  const [emailInvoice, setEmailInvoice] = useState<Invoice | null>(null);
  const currentWorkspaceId = useAuthStore(s => s.currentWorkspaceId);
  const homeCurrency = useAuthStore(s => s.getCurrentWorkspace()?.currency) || 'USD';
  // BE-04: the approval rule of this workspace, and whether the signed-in person may sign off.
  const approvalSettings = useAuthStore(s => s.getCurrentWorkspace()?.invoiceApproval);
  const canDecideApproval = isApproverRole(useCurrentRole());
  const [searchTerm, setSearchTerm] = useState('');
  // A record link (#sales/invoice/<id>, e.g. from Data Health) shows and highlights the invoice
  const focusedInvoiceId = useRecordFocus('invoice', { ready: invoices.length > 0, onFocus: () => { setActiveSubTab('invoices'); setSearchTerm(''); } });

  // The customer paid after all: reverse the bad debt write-off (server, badDebtService.ts); the
  // invoice is open again for the payment.
  const reverseWriteOff = async (inv: Invoice) => {
    if (!currentWorkspaceId) return;
    try {
      const res = await fetch(`/api/v1/workspaces/${encodeURIComponent(currentWorkspaceId)}/invoices/${encodeURIComponent(inv.id)}/write-off/reverse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getIdToken()}` },
        body: JSON.stringify({ reason: 'Customer paid after all' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'The write-off could not be reversed');
      toast.success(`Write-off reversed: ${formatCurrency(inv.writtenOffCents || 0)} is due again. Record the payment now.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The write-off could not be reversed');
    }
  };

  // what is still owed on an invoice (after deposit, payments, credits), in the base currency
  const owedInBase = (i: Invoice) => toBaseCents(calculateAmountDue(i), i.exchangeRate);
  const agingBuckets = useMemo(() => {
    const now = new Date();
    return {
      overdue: invoices.filter(i => isOpenInvoice(i) && (i.status === 'overdue' || parseLocalDate(i.dueDate) < now)).reduce((sum, i) => sum + owedInBase(i), 0),
      dueSoon: invoices.filter(i => {
        const dueDate = parseLocalDate(i.dueDate);
        const diff = (dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
        return isOpenInvoice(i) && (i.status === 'sent' || i.status === 'pending') && diff >= 0 && diff <= 30;
      }).reduce((sum, i) => sum + owedInBase(i), 0),
      total: invoices.filter(isOpenInvoice).reduce((sum, i) => sum + owedInBase(i), 0)
    };
  }, [invoices]);

  const filteredInvoices = useMemo(() => {
    return invoices.filter((i: Invoice) => {
      const term = searchTerm.toLowerCase();
      if (!term) return true;
      const customer = customers?.find(c => c.id === i.customerId);
      const searchStr = `${i.customerName || ''} ${i.number || ''} ${i.metadata ? JSON.stringify(i.metadata) : ''} ${i.tags?.join(' ') || ''} ${customer?.tags?.join(' ') || ''} ${customer?.metadata ? JSON.stringify(customer.metadata) : ''}`.toLowerCase();
      return searchStr.includes(term);
    });
  }, [invoices, customers, searchTerm]);

  const [invoiceLimit, setInvoiceLimit] = useState(100);
  const visibleInvoices = useMemo(() => {
    if (filteredInvoices.length <= invoiceLimit) return filteredInvoices;
    const sliced = filteredInvoices.slice(0, invoiceLimit);
    if (focusedInvoiceId && !sliced.some(i => i.id === focusedInvoiceId)) {
      const focused = filteredInvoices.find(i => i.id === focusedInvoiceId);
      if (focused) sliced.push(focused);
    }
    return sliced;
  }, [filteredInvoices, invoiceLimit, focusedInvoiceId]);

  /**
   * Sign an invoice off or send it back (BE-04). This is the only place a decision is made from the
   * list, so it writes the record itself rather than going through the stamping a save does: a save
   * of an invoice that is already out must never change somebody's approval.
   */
  const decideApproval = (inv: Invoice, decision: 'approved' | 'rejected') => {
    let note: string | undefined;
    if (decision === 'rejected') {
      const asked = window.prompt(`What should be changed on invoice ${inv.number || ''}? (optional)`);
      if (asked === null) return; // the person backed out of the dialog; nothing is recorded
      note = asked;
    }
    inBackground(updateEntity('invoices', inv.id, {
      approval: approvalDecision(approvalSettings, decision, { uid: user?.uid, note }),
    }, decision === 'approved' ? 'Approved — the invoice can be emailed now.' : 'Sent back for changes.'));
  };

  const getStatusColor = (status: Invoice['status']) => {
    switch (status) {
      case 'paid': return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'sent': 
      case 'pending':
        return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'overdue': return 'bg-rose-50 text-rose-700 border-rose-200';
      case 'void': return 'bg-zinc-100 text-zinc-500 border-zinc-200 line-through';
      default: return 'bg-[var(--ink)] text-zinc-650 border-[var(--line)]';
    }
  };

  if (selectedCustomerId) {
    return <CustomerDetailView customerId={selectedCustomerId} onBack={() => setSelectedCustomerId(null)} />;
  }

  return (
    <div className="space-y-8 pb-12">
      <ScreenDataNotice failedKeys={dataHealth.failedKeys} message={dataHealth.message} onRetry={dataHealth.retry} what="this screen" />
      {/* stale-while-revalidate: a retry keeps the on-screen rows, and says the refresh is in flight (CodeRabbit #440) */}
      {loading && (invoices.length > 0 || customers.length > 0) && (
        <p role="status" className="text-xs text-[var(--muted)] px-1">Refreshing this screen…</p>
      )}
      {/* Rule Header with brand gold backdrop */}
      <div className="relative overflow-hidden bg-gradient-to-r from-[var(--brass-soft)] via-[var(--surface)]/40 to-[var(--panel)] p-6 rounded-2xl border border-[var(--brass-line)]/50 shadow-sm">
        <div className="absolute -top-16 -left-16 w-56 h-56 bg-[var(--brass)] opacity-10 rounded-full blur-3xl hidden md:block pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[var(--brass-soft)] border border-[var(--brass-line)]/60 text-[10px] font-mono text-[var(--brass)] font-semibold mb-2 shadow-xs">
              <TrendingUp size={12} />
              SALES & ACCOUNTS RECEIVABLE
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-[var(--text)] tracking-tight">Invoicing & Customer Accounts</h1>
            <p className="text-xs text-[var(--muted)] font-medium mt-1">Manage receivables, recurring billing, and client credit balances.</p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <div className="flex items-center bg-[var(--surface)]/80 p-1 rounded-xl border border-[var(--line)] shadow-inner backdrop-blur-sm">

              <button 
                onClick={() => setActiveSubTab('invoices')}
                className={cn(
                  "px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer",
                  activeSubTab === 'invoices' 
                    ? "bg-gradient-to-r from-[var(--brass)] via-[#e5be6b] to-[var(--brass)] text-black font-bold shadow-sm" 
                    : "text-[var(--muted)] hover:text-[var(--text)]"
                )}
              >
                Invoices & AP
              </button>
              <button 
                onClick={() => setActiveSubTab('customers')}
                className={cn(
                  "px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer",
                  activeSubTab === 'customers' 
                    ? "bg-gradient-to-r from-[var(--brass)] via-[#e5be6b] to-[var(--brass)] text-black font-bold shadow-sm" 
                    : "text-[var(--muted)] hover:text-[var(--text)]"
                )}
              >
                Customers & Clients
              </button>
            </div>
            {activeSubTab === 'invoices' && canEditContacts && (
              <button type="button"
                onClick={() => { setReceiptMode(true); setIsInvoiceModalOpen(true); }}
                title="A sale paid on the spot: the invoice and its payment in one step"
                className="flex items-center gap-1.5 px-4 py-2 border border-[var(--line)] text-[var(--text)] rounded-xl text-xs font-bold hover:bg-[var(--ink)] transition-all cursor-pointer"
              >
                <Plus size={15} />
                Sale receipt
              </button>
            )}
            {activeSubTab === 'invoices' && canEditContacts && (
              <button type="button" onClick={() => setOpeningOpen(true)}
                title="The invoices still unpaid when you started: paste them from a spreadsheet"
                className="px-3 py-2 text-[var(--muted)] rounded-xl text-xs font-semibold hover:text-[var(--text)] hover:underline">
                Opening invoices
              </button>
            )}
            <button 
              onClick={() => activeSubTab === 'invoices' ? setIsInvoiceModalOpen(true) : setIsCustomerModalOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-[var(--brass)] via-[#e5be6b] to-[var(--brass)] text-black rounded-xl text-xs font-bold hover:opacity-95 transition-all shadow-md hover:shadow-lg cursor-pointer active:scale-95"
            >
              <Plus size={15} />
              {activeSubTab === 'invoices' ? 'Add Invoice' : 'Add Customer'}
            </button>
          </div>
        </div>
      </div>

      {/* Psychological Header: Aging Buckets */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        <motion.div 
          initial={{ y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-5 bg-[var(--panel)] rounded-2xl border border-[var(--line)] shadow-sm relative overflow-hidden group"
        >
          <div className="absolute technical-grid inset-0 opacity-5 pointer-events-none" />
          <p className="text-[10px] font-mono uppercase tracking-widest text-rose-500 dark:text-[#ff495a] font-semibold mb-3 relative z-10">Critical Overdue</p>
          <p className="text-2xl sm:text-3xl font-mono font-bold text-rose-600 tracking-tight relative z-10 tabular-nums">{formatCurrency(agingBuckets.overdue)}</p>
          <div className="mt-3 flex items-center gap-2 text-xs font-mono text-[var(--muted)] relative z-10">
             <AlertCircle size={12} />
             Immediate Disbursement Priority
          </div>
        </motion.div>
        
        <motion.div 
          initial={{ y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="p-5 bg-[var(--panel)] rounded-2xl border border-[var(--line)] shadow-sm relative overflow-hidden group"
        >
          <div className="absolute technical-grid inset-0 opacity-5 pointer-events-none" />
          <p className="text-[10px] font-mono uppercase tracking-widest text-amber-500 font-semibold mb-3 relative z-10">Short-Term (30d)</p>
          <p className="text-2xl sm:text-3xl font-mono font-bold text-amber-600 tracking-tight relative z-10 tabular-nums">{formatCurrency(agingBuckets.dueSoon)}</p>
          <div className="mt-3 flex items-center gap-2 text-xs font-mono text-[var(--muted)] relative z-10">
             <Activity size={12} />
             Operational Inflow Expected
          </div>
        </motion.div>

        <motion.div 
          initial={{ y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="p-5 bg-[var(--panel)] rounded-2xl border border-[var(--line)] shadow-sm relative overflow-hidden group"
        >
          <div className="absolute technical-grid inset-0 opacity-5 pointer-events-none" />
          <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] font-semibold mb-3 relative z-10">Mid-Term (30-60d)</p>
          <p className="text-2xl sm:text-3xl font-mono font-bold text-[var(--text)] tracking-tight relative z-10 tabular-nums">{formatCurrency(0 /* N/A for sales */)}</p>
          <div className="mt-3 flex items-center gap-2 text-xs font-mono text-[var(--muted)] relative z-10">
             <Clock size={12} />
             Liquidity Forecast Cluster
          </div>
        </motion.div>

        <motion.div 
          initial={{ y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="p-5 bg-[var(--panel)] rounded-2xl border border-[var(--brass-line)] shadow-sm relative overflow-hidden group bg-gradient-to-b from-[var(--brass-soft)] to-[var(--panel)]"
        >
          <div className="absolute technical-grid inset-0 opacity-5 pointer-events-none" />
          <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] font-semibold mb-3 relative z-10">Total Accounts Receivable</p>
          <p className="text-2xl sm:text-3xl font-mono font-bold text-[var(--text)] tracking-tight relative z-10 tabular-nums">{formatCurrency(agingBuckets.total)}</p>
          <div className="mt-3 flex items-center gap-2 text-xs font-mono text-[var(--muted)] relative z-10">
             <ShieldCheck size={12} className="text-[var(--brass)]" />
             Unpaid invoices, all customers
          </div>
        </motion.div>
      </div>

      {activeSubTab === 'invoices' && (
        <div className="ledger-card p-1 rounded-[32px] overflow-hidden">
          {currentWorkspaceId && (
            <DocumentBulkBar type="invoice" noun="invoice" ids={[...pickedInvoices].filter(id => filteredInvoices.some(i => i.id === id))}
              documents={filteredInvoices.filter(i => pickedInvoices.has(i.id))}
              workspaceId={currentWorkspaceId} onClear={() => setPickedInvoices(new Set())} />
          )}
          {/* the header and the totals stay in view while the list scrolls (I-14) */}
          <div className="overflow-auto max-h-[70vh]" data-list-columns="sales-invoices">
            <ListColumnChooser scope="sales-invoices" label="Invoices"
              columns={['Selection', 'Number', 'Customer', 'Date', 'Due', 'Amount', 'State', 'Actions']} />
            <table className="w-full border-collapse min-w-[700px]">
              <caption className="sr-only">Invoices</caption>
              <thead className="sticky top-0 z-10 bg-[var(--surface)]">
                <tr className="text-left border-b border-[var(--line)]/50">
                  <th scope="col" className="pl-4 md:pl-8 w-8">
                    <input type="checkbox" aria-label="Select all invoices shown"
                      checked={visibleInvoices.length > 0 && visibleInvoices.every(i => pickedInvoices.has(i.id))}
                      onChange={e => setPickedInvoices(e.target.checked ? new Set(visibleInvoices.map(i => i.id)) : new Set())} />
                  </th>
                  <th scope="col" className="p-4 md:p-8 text-[10px] font-black text-[var(--muted)] uppercase tracking-[0.2em] whitespace-nowrap">Number</th>
                  <th scope="col" className="p-4 md:p-8 text-[10px] font-black text-[var(--muted)] uppercase tracking-[0.2em] whitespace-nowrap">Customer</th>
                  <th scope="col" className="p-4 md:p-8 text-[10px] font-black text-[var(--muted)] uppercase tracking-[0.2em] whitespace-nowrap">Date</th>
                  <th scope="col" className="p-4 md:p-8 text-[10px] font-black text-[var(--muted)] uppercase tracking-[0.2em] whitespace-nowrap">Due</th>
                  <th scope="col" className="p-4 md:p-8 text-[10px] font-black text-[var(--muted)] uppercase tracking-[0.2em] text-right">Amount</th>
                  <th scope="col" className="p-4 md:p-8 text-[10px] font-black text-[var(--muted)] uppercase tracking-[0.2em] text-center">State</th>
                  <th scope="col" className="p-4 md:p-8 w-10"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ledger-line/30">
                {visibleInvoices.map((inv) => (
                  <tr key={inv.id} id={recordElementId('invoice', inv.id)} aria-current={focusedInvoiceId === inv.id ? 'true' : undefined}
                    className={cn("group hover:bg-[var(--ink)]/30 transition-all", focusedInvoiceId === inv.id && "ring-2 ring-inset ring-[var(--brass)]")}>
                    <td className="pl-4 md:pl-8">
                      <input type="checkbox" aria-label={`Select invoice ${inv.number || ''}`.trim()} checked={pickedInvoices.has(inv.id)}
                        onChange={() => setPickedInvoices(prev => { const next = new Set(prev); if (next.has(inv.id)) next.delete(inv.id); else next.add(inv.id); return next; })} />
                    </td>
                    <td className="p-4 md:p-8 font-mono font-bold text-[var(--muted)] group-hover:text-[var(--text)] transition-colors">{inv.number}</td>
                    <td className="p-4 md:p-8">
                       <div className="flex flex-col">
                          <span className="font-black text-[var(--text)] text-base tracking-tight">{inv.customerName}</span>
                       </div>
                    </td>
                    <td className="p-4 md:p-8">
                       <InlineEdit kind="date" value={inv.date?.slice(0, 10)} display={inv.date ? formatDate(inv.date) : 'N/A'}
                         label={`Date of invoice ${inv.number || ''}`.trim()} canEdit={canEditContacts && inv.status === 'draft'}
                         onSave={v => updateEntity('invoices', inv.id, { date: String(v) }, 'Date saved')} className="font-bold text-[var(--text)]" />
                    </td>
                    <td className="p-4 md:p-8">
                      <div className="flex flex-col">
                        <InlineEdit kind="date" value={inv.dueDate?.slice(0, 10)} display={inv.dueDate ? formatDate(inv.dueDate) : 'N/A'}
                          label={`Due date of invoice ${inv.number || ''}`.trim()} canEdit={canEditContacts && !['paid', 'void', 'written_off'].includes(String(inv.status))}
                          validate={v => inv.date && String(v) < inv.date.slice(0, 10) ? 'The due date is before the invoice date' : null}
                          onSave={v => updateEntity('invoices', inv.id, { dueDate: String(v) }, 'Due date saved')}
                          className={cn("font-bold text-[var(--text)]", inv.status === 'overdue' && "text-rose-600")} />
                        {inv.status === 'pending' && (
                          <span className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest mt-1 opacity-50">
                            {differenceInDays(parseLocalDate(inv.dueDate), new Date())} T-Days Left
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-4 md:p-8 text-right font-black font-mono text-[var(--text)] text-lg tracking-tighter tabular-nums">
                      {formatCurrency(inv.amountCents || 0)}
                    </td>
                    <td className="p-4 md:p-8">
                      <div className="flex justify-center">
                        <span className={cn(
                          "px-4 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-[0.2em] border shadow-sm",
                          getStatusColor(inv.status)
                        )}>
                          {inv.status}
                        </span>
                        {Boolean(inv.metadata?.saleReceipt) && <span className="ml-1 px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-[0.2em] border border-[var(--line)] text-[var(--muted)]">Receipt</span>}
                        {(inv.writtenOffCents || 0) > 0 && (
                          <span className="text-[10px] text-amber-600 font-bold" title={inv.writeOffReason || undefined}>written off {formatCurrency(inv.writtenOffCents || 0)}</span>
                        )}
                      </div>
                      {inv.viewedAt && inv.status !== 'paid' && (
                        <div className="mt-1 text-center text-[10px] text-[var(--muted)]" title={inv.lastViewedAt ? `Last opened ${formatDate(inv.lastViewedAt.slice(0, 10))}${(inv.viewCount || 0) > 1 ? `, ${inv.viewCount} times` : ''}` : undefined}>
                          Opened by the customer {formatDate(inv.viewedAt.slice(0, 10))}
                        </div>
                      )}
                      {inv.revenueSchedule && <div className="mt-1 text-center text-[10px] text-[var(--muted)]">{spreadProgress(inv.revenueSchedule, getLocalDateISO())}</div>}
                      <StageChip kind="invoice" id={inv.id} label={`invoice ${inv.number || ''}`.trim()} />
                      <InvoiceApprovalFlag invoice={inv} settings={approvalSettings} currency={homeCurrency}
                        canDecide={canDecideApproval} onDecide={d => decideApproval(inv, d)} />
                      {inv.metadata?.cogsPending && (
                        <div className="mt-2 flex items-center justify-center gap-2 text-[10px] text-[var(--neg)]">
                          <span title="The cost of the items sold was not recorded: add an Inventory and a Cost of Goods Sold account, then retry.">Cost not recorded</span>
                          <button type="button" onClick={() => updateEntity('invoices', inv.id, {}, 'Invoice re-posted')} className="underline font-bold">Retry</button>
                        </div>
                      )}
                    </td>
                    <td className="p-4 md:p-8">
                      <div className="flex items-center gap-3 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100 transition-all transform translate-x-2 group-hover:translate-x-0 group-focus-within:translate-x-0">
                        {inv.status !== 'void' && (
                          <button
                            type="button"
                            onClick={() => { setNewInvoiceFor(inv); setIsInvoiceModalOpen(true); }}
                            className="p-3 bg-[var(--surface)] border border-[var(--line)] rounded-xl text-[var(--muted)] hover:text-indigo-600 transition-all"
                            title="Edit invoice"
                            aria-label={`Edit invoice ${inv.number || ''}`.trim()}
                          >
                            <Pencil size={16} />
                          </button>
                        )}
                        {inv.status !== 'paid' && (
                          <button 
                            onClick={() => {
                              if (inv.customerId) {
                                setPaymentContactId(inv.customerId);
                                setPaymentDocumentId(inv.id);
                                setIsPaymentModalOpen(true);
                              } else {
                                toast.error('Invoice is missing a customer.');
                              }
                            }}
                            className="p-3 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-500/20"
                            title="Receive Payment"
                          >
                            <DollarSign size={16} />
                          </button>
                        )}
                        {(() => {
                          // BE-05: the estimate's deposit waits until its invoice is issued
                          const estId = inv.metadata?.convertedFromEstimateId as string | undefined;
                          if (!estId) return null;
                          const deposit = estimateDeposits(payments || [], estId);
                          const due = calculateAmountDue(inv);
                          if (!canEditContacts || deposit.unappliedCents <= 0 || due <= 0 || ['draft', 'void', 'rejected', 'cancelled', 'paid'].includes(String(inv.status))) return null;
                          return (
                            <button type="button"
                              onClick={() => void applyEstimateDeposits(currentWorkspaceId || '', inv, deposit.waiting, due)}
                              className="px-3 py-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 rounded-xl hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                              aria-label={`Apply the estimate's deposit to invoice ${inv.number || ''}`.trim()}
                            >
                              Apply deposit {formatCurrency(Math.min(deposit.unappliedCents, due), inv.currency)}
                            </button>
                          );
                        })()}
                        {canEditContacts && !['draft', 'void', 'rejected', 'cancelled'].includes(String(inv.status)) && (inv.revenueSchedule ? (
                          <button type="button"
                            onClick={async () => {
                              if (safeConfirm(`Undo the spread of invoice ${inv.number || ''}? Its monthly entries are voided and the whole income is back in the invoice's month.`)
                                && await undoSpreadRequest('invoice', currentWorkspaceId || '', inv.id)) toast.success('Spread undone');
                            }}
                            className="px-3 py-2 text-xs text-[var(--muted)] hover:text-[var(--text)] rounded-xl"
                            aria-label={`Undo the spread of invoice ${inv.number || ''}`.trim()}
                          >
                            Undo spread
                          </button>
                        ) : (
                          <button type="button"
                            onClick={() => setSpreadingInvoice(inv)}
                            className="px-3 py-2 text-xs text-indigo-700 dark:text-indigo-300 hover:underline rounded-xl"
                            title="Income earned over time (a subscription, a retainer): spread it over the months it covers"
                            aria-label={`Spread invoice ${inv.number || ''} over months`.replace('  ', ' ')}
                          >
                            Spread
                          </button>
                        ))}
                        {(inv.writtenOffCents || 0) > 0 && (
                          <button
                            onClick={() => reverseWriteOff(inv)}
                            className="p-3 bg-[var(--surface)] border border-[var(--line)] rounded-xl text-amber-600 transition-all"
                            title="Customer paid after all: reverse the bad debt write-off"
                            aria-label="Reverse the bad debt write-off"
                          >
                            <Undo2 size={16} />
                          </button>
                        )}
                        {inv.status !== 'draft' && (inv.status === 'overdue' || (inv.status !== 'paid' && inv.status !== 'void' && differenceInDays(new Date(), parseLocalDate(inv.dueDate)) > 0)) && (
                          <button
                            onClick={() => {
                              setSelectedInvoiceForWriteOff(inv);
                              setIsWriteOffOpen(true);
                            }}
                            className="p-3 bg-amber-500 text-white rounded-xl hover:bg-amber-600 transition-all shadow-lg shadow-amber-500/20"
                            title="Write Off Bad Debt"
                          >
                            <Ban size={16} />
                          </button>
                        )}
                        {inv.status !== 'draft' && inv.status !== 'void' && (
                          <button
                            onClick={() => setEmailInvoice(inv)}
                            className="p-3 bg-[var(--surface)] border border-[var(--line)] rounded-xl text-[var(--muted)] hover:text-indigo-600 transition-all"
                            title="Email the invoice or a reminder; see emails sent"
                            aria-label="Email the invoice"
                          >
                            <Mail size={16} />
                          </button>
                        )}
                        <button
                          onClick={() => setPreviewPdfInvoice(inv)}
                          className="p-3 bg-[var(--surface)] border border-[var(--line)] rounded-xl text-[var(--muted)] hover:text-indigo-600 transition-all"
                          title="Preview PDF"
                        >
                          <Eye size={16} />
                        </button>
                        <button
                          onClick={() => downloadDocumentPdf('invoice', inv.id, currentWorkspaceId || 'default', `invoice_${inv.number || inv.id}.pdf`)}
                          className="p-3 bg-[var(--surface)] border border-[var(--line)] rounded-xl text-[var(--muted)] hover:text-indigo-600 transition-all"
                          title="Download PDF"
                        >
                          <Download size={16} />
                        </button>
                        <button 
                          onClick={() => {
                            // a new draft with the same customer and lines: no number (the series gives one), no payments,
                            // write-offs, links or sent/viewed history carried over
                            const { id: _id, uid: _uid, number: _number, status: _status, amountPaidCents: _paid, depositCents: _deposit, settledByRecordsCents: _settled,
                              writtenOffCents: _wo, writeOffTransactionId: _woTx, writeOffReason: _wr, writtenOffAt: _woAt, writeOffReversalTransactionId: _woRev,
                              paymentDate: _pd, paidAt: _pa, posted: _posted, isLocked: _locked, lockedAt: _lockedAt, paymentToken: _token, metadata: _meta,
                              dueDate: _due, ...fields } = inv;
                            setNewInvoiceFor({ ...fields, date: getLocalDateISO(), status: 'draft' });
                            setIsInvoiceModalOpen(true);
                          }}
                          className="p-3 bg-[var(--surface)] border border-[var(--line)] rounded-xl text-[var(--muted)] hover:text-indigo-600 transition-all"
                          title="Duplicate as a new draft"
                          aria-label="Duplicate as a new draft"
                        >
                           <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                        </button>
                        <button 
                          onClick={async () => {
                            const spread = inv.revenueSchedule ? ' Its spread over months is undone too.' : '';
                            if (safeConfirm(`Void invoice ${inv.number || ''} for ${inv.customerName || 'this customer'} (${formatCurrency(inv.amountCents || 0, inv.currency)})? It stays on record as void and its entries are reversed.${spread}`)) {
                              if (inv.revenueSchedule && !(await undoSpreadRequest('invoice', currentWorkspaceId || '', inv.id))) return;
                              inBackground(onAddInvoice({ id: inv.id, status: 'void' }));
                            }
                          }}
                          className="p-3 bg-[var(--surface)] border border-[var(--line)] rounded-xl text-[var(--muted)] hover:text-rose-500 transition-all"
                          title="Void invoice"
                          aria-label="Void invoice"
                        >
                           <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredInvoices.length > visibleInvoices.length && (
                  <tr>
                    <td colSpan={8} className="p-4 text-center">
                      <button
                        type="button"
                        onClick={() => setInvoiceLimit(n => n + 200)}
                        className="min-h-11 px-4 py-2 text-xs font-bold text-[var(--text)] bg-[var(--surface)] border border-[var(--line)] rounded-xl hover:bg-[var(--ink)]/50 transition-all"
                      >
                        Show more invoices ({visibleInvoices.length} of {filteredInvoices.length})
                      </button>
                    </td>
                  </tr>
                )}
                {filteredInvoices.length === 0 && (
                  <tr>
                    <td colSpan={8} className="p-12">
                      {loading ? <LoadingState what="invoices" /> : (
                        <EmptyState
                          title={searchTerm ? 'No invoices match your search' : 'No invoices yet'}
                          description={searchTerm ? 'Try another name or number.' : 'Create your first invoice to bill a customer.'}
                          actionLabel="Create invoice"
                          onAction={() => setIsInvoiceModalOpen(true)}
                        />
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
              <DocumentTotalsFoot docs={filteredInvoices} homeCurrency={homeCurrency} colSpan={8} noun="invoice" />
            </table>
          </div>
        </div>
      )}
      
      {activeSubTab === 'customers' && (
        <div className="ledger-card p-1 rounded-[32px] overflow-hidden">
          <TagFilter tags={customerTags} value={customerTag} onChange={setCustomerTag} label="Show customers with the tag" />
          <div className="flex flex-wrap items-center gap-2 px-4 md:px-8">
            <EmailStatementsButton className="mt-3 inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-[var(--line)] text-xs font-semibold text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-50" />
            <ShowArchivedToggle count={archivedCustomers} on={showArchivedCustomers} onChange={setShowArchivedCustomers} noun="customer" />
          </div>
          <div className="overflow-x-auto" data-list-columns="sales-customers">
            <ListColumnChooser scope="sales-customers" label="Customers"
              columns={['Customer Profile', 'Contact', 'Net Receivable', 'Actions']} />
            {canEditContacts && (
              <InlineAdd className="px-4 md:px-8 pt-4" label="New customer name" placeholder="Add a customer: type a name and press Enter"
                existing={customers.map(c => c.name)} onAdd={name => addEntity('customers', { name, status: 'active' }, `Customer "${name}" added`)} />
            )}
            <table className="w-full border-collapse min-w-[700px]">
              <caption className="sr-only">Customers</caption>
              <thead>
                <tr className="text-left border-b border-[var(--line)]/50">
                  <th scope="col" className="p-4 md:p-8 text-[10px] font-black text-[var(--muted)] uppercase tracking-[0.2em] whitespace-nowrap">Customer Profile</th>
                  <th scope="col" className="p-4 md:p-8 text-[10px] font-black text-[var(--muted)] uppercase tracking-[0.2em] whitespace-nowrap">Contact</th>
                  <th scope="col" className="p-4 md:p-8 text-[10px] font-black text-[var(--muted)] uppercase tracking-[0.2em] whitespace-nowrap text-right">Net Receivable</th>
                  <th scope="col" className="p-4 md:p-8 w-10"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ledger-line/30">
                {shownCustomers.map((cust) => (
                  <tr 
                    key={cust.id} 
                    onClick={() => setSelectedCustomerId(cust.id)}
                    className="group hover:bg-[var(--ink)]/30 transition-all cursor-pointer"
                  >
                    <td className="p-4 md:p-8">
                       <div className="flex items-center gap-5">
                          <div className="w-14 h-14 bg-slate-900 rounded-[32px] flex items-center justify-center text-white font-black text-xl border border-white/10 shadow-2xl">
                             {(cust.name || 'VE').slice(0, 2).toUpperCase()}
                          </div>
                          <div className="flex flex-col">
                            <InlineEdit value={cust.name} label={`Name of ${cust.name}`} canEdit={canEditContacts}
                              validate={v => String(v) ? null : 'A customer needs a name'}
                              onSave={v => updateEntity('customers', cust.id, { name: v }, 'Name saved')}
                              className="font-black text-[var(--text)] text-lg tracking-tight" />
                            <ArchivedBadge party={cust} />
                            <button type="button"
                              onClick={(e) => { e.stopPropagation(); inBackground(updateEntity('customers', cust.id, { noReminders: !cust.noReminders }, cust.noReminders ? `Automatic reminders on for ${cust.name}` : `No automatic reminders for ${cust.name}`)); }}
                              className={`flex items-center gap-1.5 min-h-11 text-[10px] font-bold uppercase tracking-widest mt-1 ${cust.noReminders ? 'text-[var(--muted)]' : 'text-emerald-500'}`}
                              aria-pressed={!cust.noReminders}
                              title="Automatic payment reminders (Settings → Emails & Reminders)">
                               {cust.noReminders ? <BellOff size={10} aria-hidden="true" /> : <Bell size={10} aria-hidden="true" />}
                               {cust.noReminders ? 'No reminders' : 'Reminders on'}
                            </button>
                          </div>
                       </div>
                    </td>
                    <td className="p-4 md:p-8">
                       <div className="flex items-center gap-2 group/email">
                          <Users size={16} className="text-[var(--muted)] opacity-40" />
                          <div className="flex flex-col gap-1 min-w-0">
                            <InlineEdit kind="email" value={cust.email} label={`Email of ${cust.name}`} placeholder="Add email" canEdit={canEditContacts}
                              onSave={v => updateEntity('customers', cust.id, { email: v }, 'Email saved')}
                              className="font-bold text-[var(--text)]" />
                            <InlineEdit kind="tel" value={cust.phone} label={`Phone of ${cust.name}`} placeholder="Add phone" canEdit={canEditContacts}
                              onSave={v => updateEntity('customers', cust.id, { phone: v }, 'Phone saved')}
                              className="text-sm text-[var(--muted)]" />
                          </div>
                       </div>
                    </td>
                    <td className="p-4 md:p-8 text-right font-black font-mono text-[var(--text)] text-xl tracking-tighter tabular-nums">
                      {formatCurrency(customerBalances[cust.id] ?? 0)}
                    </td>
                    <td className="p-4 md:p-8">
                      <div className="flex items-center gap-1 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100 transition-all justify-end">
                        
                        <button onClick={(e)=> {e.stopPropagation(); setNewInvoiceFor({ customerId: cust.id, customerName: cust.name }); setIsInvoiceModalOpen(true); }} className="inline-flex items-center justify-center min-h-11 min-w-11 p-2 text-emerald-500 hover:bg-emerald-50 rounded" title="Enter Invoice"><Plus size={14}/></button>
                        {canEditContacts && <PartyRowActions side="customer" party={cust} />}
                      </div>
                    </td>
                  </tr>
                ))}
                {shownCustomers.length === 0 && (
                  <tr>
                    <td colSpan={4} className="p-6">
                      {loading ? <LoadingState what="customers" /> : (
                        <EmptyState
                          title={customers.length === 0 ? 'No customers yet' : 'No customers match these filters'}
                          description={customers.length === 0 ? 'Add a customer before creating their first invoice.' : 'Choose another tag or show archived customers.'}
                          actionLabel={customers.length === 0 ? 'Add first customer' : undefined}
                          onAction={customers.length === 0 ? () => setIsCustomerModalOpen(true) : undefined}
                        />
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {openingOpen && <OpeningDocumentsDialog side="customer" onClose={() => setOpeningOpen(false)} />}
      {/* mounted per opening, so a new invoice never inherits the last one's fields */}
      {isInvoiceModalOpen && (
        <InvoiceModal key={`${newInvoiceFor?.id || 'new'}${receiptMode ? '-receipt' : ''}`} isOpen={isInvoiceModalOpen} receipt={receiptMode}
          onClose={() => { setIsInvoiceModalOpen(false); setNewInvoiceFor(undefined); setReceiptMode(false); }}
          onSave={async (inv) => { await onAddInvoice(inv); setIsInvoiceModalOpen(false); setNewInvoiceFor(undefined); setReceiptMode(false); }}
          customers={customers} accounts={accounts} initialInvoice={newInvoiceFor} />
      )}
      <CustomerModal isOpen={isCustomerModalOpen} onClose={() => setIsCustomerModalOpen(false)}
        onSave={async (cust) => { await onAddCustomer(cust); setIsCustomerModalOpen(false); }} />
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
    </div>
  );
}

