import React, { useMemo } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { daysOverdue, outstandingBaseCents, partyStats } from '../../lib/aging';
import { calculateAmountDue } from '../../lib/documentMath';
import { ArrowLeft, DollarSign, FileText, User } from 'lucide-react';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import VendorTaxRecordsButton from './VendorTaxRecordsButton';
import PartyProfilePanel from '../common/PartyProfilePanel';
import UnappliedPayments from '../common/UnappliedPayments';
import AttachmentsPanel from '../common/AttachmentsPanel';

interface VendorDetailViewProps {
  vendorId: string;
  onBack: () => void;
}

export default function VendorDetailView({ vendorId, onBack }: VendorDetailViewProps) {
  const vendors = useLedgerStore(s => s.vendors);
  const bills = useLedgerStore(s => s.bills);
  const payments = useLedgerStore(s => s.payments);
  useLedgerCollections('bills', 'payments', 'vendors');

  const vendor = useMemo(() => vendors.find(v => v.id === vendorId), [vendors, vendorId]);

  const vendorBills = useMemo(() => {
    return bills.filter(b => b.vendorId === vendorId);
  }, [bills, vendorId]);

  const vendorPayments = useMemo(() => {
    return payments.filter(p => p.contactId === vendorId && p.direction === 'made' && p.status !== 'void');
  }, [payments, vendorId]);

  // still owed, overdue, lifetime and payments in the base currency (src/lib/aging.ts, tested)
  const today = getLocalDateISO();
  const stats = useMemo(() => {
    const t = partyStats(vendorBills, vendorPayments, 'vendor', today);
    return { outstanding: t.outstandingCents, overdue: t.overdueCents, lifetimePurchases: t.lifetimeCents, totalPayments: t.paymentsCents };
  }, [vendorBills, vendorPayments, today]);

  if (!vendor) {
    return (
      <div className="p-6">
        <p className="text-[var(--muted)]">Vendor not found.</p>
        <button onClick={onBack} className="mt-4 text-emerald-600 font-semibold hover:underline flex items-center gap-1">
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
          className="text-sm text-emerald-600 dark:text-emerald-400 font-bold hover:underline flex items-center gap-1 mb-4"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Vendors
        </button>
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-950 rounded-full flex items-center justify-center text-emerald-600 dark:text-emerald-400">
            <User className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
              {vendor.name}
            </h1>
            <p className="text-sm text-[var(--muted)] dark:text-slate-400">
              {vendor.email || 'No email'} | {vendor.phone || 'No phone'} | {vendor.category || 'Standard Vendor Category'}
            </p>
          </div>
        </div>
      </div>

      <VendorTaxRecordsButton />
      <PartyProfilePanel side="vendor" party={vendor} />
      <UnappliedPayments side="vendor" partyId={vendorId} />
      <AttachmentsPanel target={{ collection: 'vendors', id: vendorId, label: vendor.name }} className="p-4 rounded-xl border border-[var(--line)] bg-[var(--surface)]" />

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800">
          <span className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-wider block">Outstanding Payable</span>
          <span className="text-xl font-mono font-black text-slate-900 dark:text-white tracking-tight block mt-1">
            {formatCurrency(stats.outstanding)}
          </span>
        </div>
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800">
          <span className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-wider block">Overdue Balance</span>
          <span className="text-xl font-mono font-black text-rose-600 dark:text-rose-400 tracking-tight block mt-1">
            {formatCurrency(stats.overdue)}
          </span>
        </div>
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800">
          <span className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-wider block">Lifetime Purchases</span>
          <span className="text-xl font-mono font-black text-amber-600 dark:text-amber-500 tracking-tight block mt-1">
            {formatCurrency(stats.lifetimePurchases)}
          </span>
        </div>
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800">
          <span className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-wider block">Total Disbursements</span>
          <span className="text-xl font-mono font-black text-emerald-600 dark:text-emerald-400 tracking-tight block mt-1">
            {formatCurrency(stats.totalPayments)}
          </span>
        </div>
      </div>

      {/* Lists Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Bills List */}
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800">
            <h2 className="font-bold text-slate-900 dark:text-white flex items-center gap-2 text-sm">
              <FileText className="w-4 h-4 text-emerald-500" />
              Bills ({vendorBills.length})
            </h2>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 overflow-y-auto max-h-[380px]">
            {vendorBills.map(b => {
              const isOverdue = outstandingBaseCents(b, 'vendor') > 0 && daysOverdue(b, today) > 0;
              const outstanding = outstandingBaseCents(b, 'vendor') > 0 ? calculateAmountDue(b) : 0; // in the document's currency
              return (
                <div key={b.id} className="p-4 hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-900 dark:text-white text-sm">
                        #{b.number || b.id.slice(0, 8).toUpperCase()}
                      </span>
                      <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${
                        b.status === 'paid'
                          ? 'bg-emerald-100 text-emerald-800'
                          : isOverdue
                          ? 'bg-rose-100 text-rose-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}>
                        {b.status || 'Pending'}
                      </span>
                    </div>
                    <div className="text-xs text-[var(--muted)] dark:text-slate-400 mt-1">
                      Date: {b.date?.slice(0, 10)} | Due: {b.dueDate?.slice(0, 10) || 'N/A'}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono font-bold text-slate-900 dark:text-white text-sm">
                      {formatCurrency(b.amountCents || 0, b.currency)}
                    </div>
                    <div className="text-xs text-[var(--muted)] mt-0.5">
                      Open: {formatCurrency(outstanding, b.currency)}
                    </div>
                  </div>
                </div>
              );
            })}
            {vendorBills.length === 0 && (
              <div className="p-8 text-center text-[var(--muted)] dark:text-slate-400">
                No bills recorded for this vendor yet.
              </div>
            )}
          </div>
        </div>

        {/* Payments List */}
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800">
            <h2 className="font-bold text-slate-900 dark:text-white flex items-center gap-2 text-sm">
              <DollarSign className="w-4 h-4 text-emerald-500" />
              Payments Made ({vendorPayments.length})
            </h2>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 overflow-y-auto max-h-[380px]">
            {vendorPayments.map(p => (
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
                    -{formatCurrency(p.amountCents || 0, p.currency)}
                  </div>
                </div>
              </div>
            ))}
            {vendorPayments.length === 0 && (
              <div className="p-8 text-center text-[var(--muted)] dark:text-slate-400">
                No payments made to this vendor yet.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
