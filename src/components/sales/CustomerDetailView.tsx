import React, { useMemo } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { daysOverdue, outstandingBaseCents, partyStats } from '../../lib/aging';
import { calculateAmountDue } from '../../lib/documentMath';
import { ArrowLeft, DollarSign, FileText, User } from 'lucide-react';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import PartyProfilePanel from '../common/PartyProfilePanel';
import UnappliedPayments from '../common/UnappliedPayments';
import AttachmentsPanel from '../common/AttachmentsPanel';
import CustomerPortalLink from './CustomerPortalLink';
import CustomerTaxCertificatesButton from './CustomerTaxCertificatesButton';

interface CustomerDetailViewProps {
  customerId: string;
  onBack: () => void;
}

export default function CustomerDetailView({ customerId, onBack }: CustomerDetailViewProps) {
  const customers = useLedgerStore(s => s.customers);
  const invoices = useLedgerStore(s => s.invoices);
  const payments = useLedgerStore(s => s.payments);
  useLedgerCollections('customers', 'invoices', 'payments');

  const customer = useMemo(() => customers.find(c => c.id === customerId), [customers, customerId]);

  const customerInvoices = useMemo(() => {
    return invoices.filter(inv => inv.customerId === customerId);
  }, [invoices, customerId]);

  const customerPayments = useMemo(() => {
    return payments.filter(p => p.contactId === customerId && p.direction === 'received' && p.status !== 'void');
  }, [payments, customerId]);

  // still owed, overdue, lifetime and payments in the base currency (src/lib/aging.ts, tested)
  const today = getLocalDateISO();
  const stats = useMemo(() => {
    const t = partyStats(customerInvoices, customerPayments, 'customer', today);
    return { outstanding: t.outstandingCents, overdue: t.overdueCents, lifetimeSales: t.lifetimeCents, totalPayments: t.paymentsCents };
  }, [customerInvoices, customerPayments, today]);

  if (!customer) {
    return (
      <div className="p-6">
        <p className="text-[var(--muted)]">Customer not found.</p>
        <button onClick={onBack} className="mt-4 text-indigo-600 font-semibold hover:underline flex items-center gap-1">
          <ArrowLeft className="w-4 h-4" /> Go Back
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back Button and Header */}
      <div>
        <button 
          onClick={onBack} 
          className="text-sm text-indigo-600 dark:text-indigo-400 font-bold hover:underline flex items-center gap-1 mb-4"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Customers
        </button>
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-indigo-100 dark:bg-indigo-950 rounded-full flex items-center justify-center text-indigo-600 dark:text-indigo-400">
            <User className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
              {customer.name}
            </h1>
            <p className="text-sm text-[var(--muted)] dark:text-slate-400">
              {customer.email || 'No email'} | {customer.phone || 'No phone'}
            </p>
          </div>
        </div>
      </div>

      <CustomerTaxCertificatesButton />
      <PartyProfilePanel side="customer" party={customer} />
      <UnappliedPayments side="customer" partyId={customerId} />
      <AttachmentsPanel target={{ collection: 'customers', id: customerId, label: customer.name }} className="p-4 rounded-xl border border-[var(--line)] bg-[var(--surface)]" />
      <CustomerPortalLink customer={customer} />

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800">
          <span className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-wider block">Outstanding Balance</span>
          <span className="text-xl font-mono font-black text-slate-900 dark:text-white tracking-tight block mt-1">
            {formatCurrency(stats.outstanding)}
          </span>
        </div>
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800">
          <span className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-wider block">Overdue Amount</span>
          <span className="text-xl font-mono font-black text-rose-600 dark:text-rose-400 tracking-tight block mt-1">
            {formatCurrency(stats.overdue)}
          </span>
        </div>
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800">
          <span className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-wider block">Lifetime Sales</span>
          <span className="text-xl font-mono font-black text-emerald-600 dark:text-emerald-400 tracking-tight block mt-1">
            {formatCurrency(stats.lifetimeSales)}
          </span>
        </div>
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800">
          <span className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-wider block">Total Received Payments</span>
          <span className="text-xl font-mono font-black text-indigo-600 dark:text-indigo-400 tracking-tight block mt-1">
            {formatCurrency(stats.totalPayments)}
          </span>
        </div>
      </div>

      {/* Lists Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Invoices List */}
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <h2 className="font-bold text-slate-900 dark:text-white flex items-center gap-2 text-sm">
              <FileText className="w-4 h-4 text-indigo-500" />
              Invoices ({customerInvoices.length})
            </h2>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 overflow-y-auto max-h-[380px]">
            {customerInvoices.map(inv => {
              const isOverdue = outstandingBaseCents(inv, 'customer') > 0 && daysOverdue(inv, today) > 0;
              const outstanding = outstandingBaseCents(inv, 'customer') > 0 ? calculateAmountDue(inv) : 0; // in the document's currency
              return (
                <div key={inv.id} className="p-4 hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-900 dark:text-white text-sm">
                        #{inv.number || inv.id.slice(0, 8).toUpperCase()}
                      </span>
                      <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${
                        inv.status === 'paid'
                          ? 'bg-emerald-100 text-emerald-800'
                          : isOverdue
                          ? 'bg-rose-100 text-rose-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}>
                        {inv.status || 'Pending'}
                      </span>
                    </div>
                    <div className="text-xs text-[var(--muted)] dark:text-slate-400 mt-1">
                      Date: {inv.date?.slice(0, 10)} | Due: {inv.dueDate?.slice(0, 10) || 'N/A'}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono font-bold text-slate-900 dark:text-white text-sm">
                      {formatCurrency(inv.amountCents || 0, inv.currency)}
                    </div>
                    <div className="text-xs text-[var(--muted)] mt-0.5">
                      Open: {formatCurrency(outstanding, inv.currency)}
                    </div>
                  </div>
                </div>
              );
            })}
            {customerInvoices.length === 0 && (
              <div className="p-8 text-center text-[var(--muted)] dark:text-slate-400">
                No invoices recorded for this customer yet.
              </div>
            )}
          </div>
        </div>

        {/* Payments List */}
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800">
            <h2 className="font-bold text-slate-900 dark:text-white flex items-center gap-2 text-sm">
              <DollarSign className="w-4 h-4 text-emerald-500" />
              Payments Received ({customerPayments.length})
            </h2>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 overflow-y-auto max-h-[380px]">
            {customerPayments.map(p => (
              <div key={p.id} className="p-4 hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors flex items-center justify-between">
                <div>
                  <div className="font-semibold text-slate-900 dark:text-white text-sm">
                    {p.reference ? `Ref: ${p.reference}` : `Payment ${p.id.slice(0, 8).toUpperCase()}`}
                  </div>
                  <div className="text-xs text-[var(--muted)] dark:text-slate-400 mt-1">
                    Date: {p.date?.slice(0, 10)} | Method: {p.method.replace('_', ' ')}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono font-bold text-emerald-600 dark:text-emerald-400 text-sm">
                    +{formatCurrency(p.amountCents || 0, p.currency)}
                  </div>
                </div>
              </div>
            ))}
            {customerPayments.length === 0 && (
              <div className="p-8 text-center text-[var(--muted)] dark:text-slate-400">
                No payments received from this customer yet.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
