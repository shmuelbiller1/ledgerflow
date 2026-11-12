import { useEffect, useMemo, useRef } from 'react';
import { ArrowLeft, DollarSign, FileText, User } from 'lucide-react';
import { PARTY_SIDES, type PartySide } from '../../config/partySides';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { daysOverdue, outstandingBaseCents, partyStats } from '../../lib/aging';
import { calculateAmountDue } from '../../lib/documentMath';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import type { Bill, Customer, Invoice, Vendor } from '../../types';
import CustomerTaxCertificatesButton from '../sales/CustomerTaxCertificatesButton';
import CustomerPortalLink from '../sales/CustomerPortalLink';
import VendorTaxRecordsButton from '../purchases/VendorTaxRecordsButton';
import AttachmentsPanel from './AttachmentsPanel';
import PartyProfilePanel from './PartyProfilePanel';
import PartyLinkPanel from './PartyLinkPanel';
import UnappliedPayments from './UnappliedPayments';

export interface PartyDetailViewProps {
  partyId: string;
  side: PartySide;
  onBack: () => void;
}

const ACCENT_STYLES = {
  indigo: {
    back: 'text-indigo-600 dark:text-indigo-400',
    missingBack: 'text-indigo-600',
    avatar: 'bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400',
    documentIcon: 'text-indigo-500',
  },
  emerald: {
    back: 'text-emerald-600 dark:text-emerald-400',
    missingBack: 'text-emerald-600',
    avatar: 'bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400',
    documentIcon: 'text-emerald-500',
  },
} as const;

function StatCard({ label, value, valueClassName, currency }: { label: string; value: number; valueClassName: string; currency: string }) {
  return (
    <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800">
      <span className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-wider block">{label}</span>
      <span className={`text-xl font-mono font-black tracking-tight block mt-1 ${valueClassName}`}>
        {formatCurrency(value, currency)}
      </span>
    </div>
  );
}

/**
 * The one customer/vendor detail implementation (A-211). Both sides deliberately share the same
 * balance, overdue, document and payment rules; PARTY_SIDES supplies only their wording and direction.
 */
export function PartyDetailView({ partyId, side, onBack }: PartyDetailViewProps) {
  const config = PARTY_SIDES[side];
  const accent = ACCENT_STYLES[config.detail.accent];
  const parties = useLedgerStore(s => side === 'customer' ? s.customers : s.vendors);
  const invoices = useLedgerStore(s => s.invoices);
  const bills = useLedgerStore(s => s.bills);
  const payments = useLedgerStore(s => s.payments);
  const baseCurrency = useAuthStore(s => s.getCurrentWorkspace()?.currency) || 'USD';
  // Literal keys keep the collection-loading guard able to audit this shared, two-sided screen.
  useLedgerCollections('bills', 'customers', 'invoices', 'payments', 'vendors');

  const party = useMemo(() => parties.find(p => p.id === partyId), [parties, partyId]);
  const documents = useMemo<Array<Invoice | Bill>>(() => {
    if (side === 'customer') return invoices.filter(invoice => invoice.customerId === partyId);
    return bills.filter(bill => bill.vendorId === partyId);
  }, [bills, invoices, partyId, side]);
  const partyPayments = useMemo(() => payments.filter(payment =>
    payment.contactId === partyId &&
    payment.direction === config.paymentDirection &&
    payment.status !== 'void'
  ), [config.paymentDirection, partyId, payments]);

  // Still owed, overdue, lifetime and payments are in the base currency (src/lib/aging.ts).
  const today = getLocalDateISO();
  const stats = useMemo(
    () => partyStats(documents, partyPayments, side, today, baseCurrency),
    [documents, partyPayments, side, today, baseCurrency],
  );

  const backRef = useRef<HTMLButtonElement>(null);
  const partyExists = !!party;
  useEffect(() => { backRef.current?.focus(); }, [partyId, side, partyExists]);

  if (!party) {
    return (
      <div className="p-6">
        <p className="text-[var(--muted)]">{config.partySingular} not found.</p>
        <button ref={backRef} onClick={onBack} className={`mt-4 ${accent.missingBack} font-semibold hover:underline flex items-center gap-1`}>
          <ArrowLeft className="w-4 h-4" /> Go Back
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <button
          ref={backRef}
          onClick={onBack}
          className={`text-sm ${accent.back} font-bold hover:underline flex items-center gap-1 mb-4`}
        >
          <ArrowLeft className="w-4 h-4" /> Back to {config.partyPlural}
        </button>
        <div className="flex items-center gap-3">
          <div className={`w-12 h-12 rounded-full flex items-center justify-center ${accent.avatar}`}>
            <User className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">{party.name}</h1>
            <p className="text-sm text-[var(--muted)] dark:text-slate-400">
              {party.email || 'No email'} | {party.phone || 'No phone'}
              {side === 'vendor' ? ` | ${(party as Vendor).category || 'Standard Vendor Category'}` : ''}
            </p>
          </div>
        </div>
      </div>

      {side === 'customer' ? <CustomerTaxCertificatesButton /> : <VendorTaxRecordsButton />}
      <PartyProfilePanel side={side} party={party} />
      <PartyLinkPanel side={side} partyId={partyId} />
      <UnappliedPayments side={side} partyId={partyId} />
      <AttachmentsPanel
        target={{ collection: side === 'customer' ? 'customers' : 'vendors', id: partyId, label: party.name }}
        className="p-4 rounded-xl border border-[var(--line)] bg-[var(--surface)]"
      />
      {side === 'customer' && <CustomerPortalLink customer={party as Customer} />}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard currency={baseCurrency} label={config.detail.outstandingLabel} value={stats.outstandingCents} valueClassName="text-slate-900 dark:text-white" />
        <StatCard currency={baseCurrency} label={config.detail.overdueLabel} value={stats.overdueCents} valueClassName="text-rose-600 dark:text-rose-400" />
        <StatCard
          currency={baseCurrency}
          label={config.detail.lifetimeLabel}
          value={stats.lifetimeCents}
          valueClassName={side === 'customer' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-500'}
        />
        <StatCard
          currency={baseCurrency}
          label={config.detail.paymentsLabel}
          value={stats.paymentsCents}
          valueClassName={side === 'customer' ? 'text-indigo-600 dark:text-indigo-400' : 'text-emerald-600 dark:text-emerald-400'}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <h2 className="font-bold text-slate-900 dark:text-white flex items-center gap-2 text-sm">
              <FileText className={`w-4 h-4 ${accent.documentIcon}`} />
              {config.documentPlural} ({documents.length})
            </h2>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 overflow-y-auto max-h-[380px]">
            {documents.map(document => {
              const isOverdue = outstandingBaseCents(document, side, baseCurrency) > 0 && daysOverdue(document, today) > 0;
              // calculateAmountDue is in the document's own currency; the cards above use base currency.
              const outstanding = outstandingBaseCents(document, side, baseCurrency) > 0 ? calculateAmountDue(document) : 0;
              return (
                <div key={document.id} className="p-4 hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-900 dark:text-white text-sm">
                        #{document.number || document.id.slice(0, 8).toUpperCase()}
                      </span>
                      <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${
                        document.status === 'paid'
                          ? 'bg-emerald-100 text-emerald-800'
                          : isOverdue
                            ? 'bg-rose-100 text-rose-800'
                            : 'bg-amber-100 text-amber-800'
                      }`}>
                        {document.status || 'Pending'}
                      </span>
                    </div>
                    <div className="text-xs text-[var(--muted)] dark:text-slate-400 mt-1">
                      Date: {document.date?.slice(0, 10)} | Due: {document.dueDate?.slice(0, 10) || 'N/A'}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono font-bold text-slate-900 dark:text-white text-sm">
                      {formatCurrency(document.amountCents || 0, document.currency)}
                    </div>
                    <div className="text-xs text-[var(--muted)] mt-0.5">
                      Open: {formatCurrency(outstanding, document.currency)}
                    </div>
                  </div>
                </div>
              );
            })}
            {documents.length === 0 && (
              <div className="p-8 text-center text-[var(--muted)] dark:text-slate-400">{config.detail.emptyDocuments}</div>
            )}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800">
            <h2 className="font-bold text-slate-900 dark:text-white flex items-center gap-2 text-sm">
              <DollarSign className="w-4 h-4 text-emerald-500" />
              {config.detail.paymentsHeading} ({partyPayments.length})
            </h2>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 overflow-y-auto max-h-[380px]">
            {partyPayments.map(payment => (
              <div key={payment.id} className="p-4 hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors flex items-center justify-between">
                <div>
                  <div className="font-semibold text-slate-900 dark:text-white text-sm">
                    {payment.reference ? `Ref: ${payment.reference}` : `Payment ${payment.id.slice(0, 8).toUpperCase()}`}
                  </div>
                  <div className="text-xs text-[var(--muted)] dark:text-slate-400 mt-1">
                    Date: {payment.date?.slice(0, 10)} | Method: {payment.method.replace('_', ' ')}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono font-bold text-emerald-600 dark:text-emerald-400 text-sm">
                    {config.detail.paymentSign}{formatCurrency(payment.amountCents || 0, payment.currency)}
                  </div>
                </div>
              </div>
            ))}
            {partyPayments.length === 0 && (
              <div className="p-8 text-center text-[var(--muted)] dark:text-slate-400">{config.detail.emptyPayments}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
