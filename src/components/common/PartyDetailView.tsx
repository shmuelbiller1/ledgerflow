import { useMemo } from 'react';
import { DollarSign, FileText } from 'lucide-react';
import { PARTY_SIDES, type PartySide } from '../../config/partySides';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { daysOverdue, outstandingBaseCents, partyStats } from '../../lib/aging';
import { calculateAmountDue } from '../../lib/documentMath';
import { offeredSteps } from '../../hooks/useCommand';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { roleMayRun } from '../../lib/paletteRoleFilter';
import { COMMAND_MANIFEST } from '../../lib/commands.generated';
import { isArchivedParty } from '../../lib/contacts';
import { useUIStore } from '../../stores/useUIStore';
import { RecordPage, type RecordMetric } from './RecordPage';
import { EmptyState } from '../ui/EmptyState';
import { LoadingState } from '../ui/LoadingState';
import { ScreenDataNotice } from '../ui/ScreenDataNotice';
import { useScreenDataHealth } from '../../hooks/useScreenDataHealth';
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
  /** Open the existing invoice/bill form, prefilled with this party. */
  onNewDocument?: (party: Customer | Vendor) => void;
}

/**
 * The one customer/vendor detail implementation (A-211). Both sides deliberately share the same
 * balance, overdue, document and payment rules; PARTY_SIDES supplies only their wording and direction.
 */
export function PartyDetailView({ partyId, side, onBack, onNewDocument }: PartyDetailViewProps) {
  const config = PARTY_SIDES[side];
  const language = useUIStore(s => s.language);
  const role = useCurrentRole();
  const parties = useLedgerStore(s => side === 'customer' ? s.customers : s.vendors);
  const invoices = useLedgerStore(s => s.invoices);
  const bills = useLedgerStore(s => s.bills);
  const payments = useLedgerStore(s => s.payments);
  const baseCurrency = useAuthStore(s => s.getCurrentWorkspace()?.currency) || 'USD';
  // Literal keys keep the collection-loading guard able to audit this shared, two-sided screen.
  const { loading } = useLedgerCollections('bills', 'customers', 'invoices', 'payments', 'vendors');
  const dataHealth = useScreenDataHealth(['bills', 'customers', 'invoices', 'payments', 'vendors']);
  const partyKey = side === 'customer' ? 'customers' : 'vendors';
  const dataNotice = <ScreenDataNotice failedKeys={dataHealth.failedKeys} message={dataHealth.message}
    onRetry={dataHealth.retry} what={`this ${config.partySingular.toLowerCase()}`} />;

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

  // A deep link can arrive before the on-demand contact list: distinguish loading, a failed
  // collection (with a working retry), and an actually absent record.
  if (!party && dataHealth.failedKeys.includes(partyKey)) {
    return <div className="p-4 sm:p-6 space-y-4">{dataNotice}<EmptyState title={`${config.partySingular} unavailable`}
      description="The contact list could not be loaded yet." actionLabel={`Back to ${config.partyPlural}`} onAction={onBack} /></div>;
  }
  if (loading && !party && dataHealth.loadingKeys.includes(partyKey)) {
    return <div className="p-4 sm:p-6"><LoadingState what={config.partySingular.toLowerCase()} /></div>;
  }
  if (!party) {
    return <div className="p-4 sm:p-6"><EmptyState title={`${config.partySingular} not found`} description="This record may have been deleted or belongs to another workspace." actionLabel={`Back to ${config.partyPlural}`} onAction={onBack} /></div>;
  }

  // A party is an ongoing relationship, not a document with a terminal 'Paid' state. The shared
  // page supplies the shell; only documents get a linear RecordStep[] path. The next document is
  // offered by the profile command's manifest, not by a label kept in this view.
  const nextCommand = side === 'customer' ? 'invoice.create' : 'bill.create';
  const next = offeredSteps(side === 'customer' ? 'customer.update' : 'vendor.update')
    .find(step => step.command === nextCommand);
  const target = COMMAND_MANIFEST.find(command => command.name === nextCommand);
  const nextStepAction = onNewDocument && next && !isArchivedParty(party) && roleMayRun(target?.roles, role)
    ? { label: next.label, onClick: () => onNewDocument(party) }
    : undefined;
  const metrics: RecordMetric[] = [
    { id: 'outstanding', label: config.detail.outstandingLabel, value: formatCurrency(stats.outstandingCents, baseCurrency) },
    { id: 'overdue', label: config.detail.overdueLabel, value: formatCurrency(stats.overdueCents, baseCurrency), tone: stats.overdueCents > 0 ? 'danger' : 'default' },
    { id: 'lifetime', label: config.detail.lifetimeLabel, value: formatCurrency(stats.lifetimeCents, baseCurrency), tone: side === 'customer' ? 'positive' : 'default' },
    { id: 'payments', label: config.detail.paymentsLabel, value: formatCurrency(stats.paymentsCents, baseCurrency), tone: 'positive' },
  ];

  return (
    <RecordPage
      backLabel={`Back to ${config.partyPlural}`}
      onBack={onBack}
      focusKey={`${side}:${partyId}`}
      dir={language === 'he' ? 'rtl' : 'ltr'}
      lang={language}
      title={party.name}
      subtitle={<>{party.email || 'No email'} | {party.phone || 'No phone'}{side === 'vendor' ? ` | ${(party as Vendor).category || 'Standard Vendor Category'}` : ''}</>}
      metrics={metrics}
      nextStepAction={nextStepAction}
      banner={dataNotice}
      related={
        <>
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <h2 className="font-bold text-slate-900 dark:text-white flex items-center gap-2 text-sm">
              <FileText className="w-4 h-4 text-indigo-600 dark:text-indigo-400" aria-hidden="true" />
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
              <DollarSign className="w-4 h-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
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
        </>
      }
      attachments={<AttachmentsPanel target={{ collection: side === 'customer' ? 'customers' : 'vendors', id: partyId, label: party.name }} />}
    >
      {side === 'customer' ? <CustomerTaxCertificatesButton /> : <VendorTaxRecordsButton />}
      <PartyProfilePanel side={side} party={party} />
      <PartyLinkPanel side={side} partyId={partyId} />
      <UnappliedPayments side={side} partyId={partyId} />
      {side === 'customer' && <CustomerPortalLink customer={party as Customer} />}
    </RecordPage>
  );
}
