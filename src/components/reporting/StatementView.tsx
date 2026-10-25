import { usePageSyncedState } from '../../hooks/usePageSyncedState';
import React, { useState, useMemo } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { formatCurrency, getLocalDateISO, workspaceYearMonth } from '../../lib/utils';
import { computeStatement } from '../../server/reports/computeReports';
import { FileText, Printer, Eye, Download } from 'lucide-react';
import PdfPreviewModal, { downloadDocumentPdf } from '../ui/PdfPreviewModal';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import type { Bill, CreditNote, Invoice, Payment, VendorCredit } from '../../types';
import { Labelled } from '../ui/Labelled';
import { resolveStatementScope } from '../../lib/statementScope';
import {
  UNLABELLED_ENTITY,
  entityLabelOf,
  entityOptions,
  entityStatementNote,
  scopeStatementDocuments,
} from '../../lib/statementByEntity';

interface StatementViewProps {
  startDate?: string;
  endDate?: string;
  /** Reports already supplies the page h1; a standalone statement supplies its own. */
  embedded?: boolean;
}

export default function StatementView({ startDate: pageStartDate, endDate: pageEndDate, embedded = false }: StatementViewProps = {}) {
  const Heading = embedded ? 'h2' : 'h1';
  const currentWorkspaceId = useAuthStore(s => s.currentWorkspaceId);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const customers = useLedgerStore(s => s.customers);
  const vendors = useLedgerStore(s => s.vendors);
  const invoices = useLedgerStore(s => s.invoices);
  const bills = useLedgerStore(s => s.bills);
  const payments = useLedgerStore(s => s.payments);
  const creditNotes = useLedgerStore(s => s.creditNotes);
  const vendorCredits = useLedgerStore(s => s.vendorCredits);
  useLedgerCollections('bills', 'creditNotes', 'customers', 'invoices', 'payments', 'vendorCredits', 'vendors');

  const [type, setType] = useState<'customer' | 'vendor'>('customer');
  /** A-72: which entity label the statement is for ('' = the whole account). */
  const [entity, setEntity] = useState<string>('');
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const entityDimensionId = workspace?.dimensions?.find(d => d.isWorld)?.id || 'world';
  const [contactId, setContactId] = useState<string>('');
  const [startDate, setStartDate] = usePageSyncedState(JSON.stringify([pageStartDate, pageEndDate]), pageStartDate || undefined, `${workspaceYearMonth().year}-01-01`);
  const [endDate, setEndDate] = usePageSyncedState(JSON.stringify([pageStartDate, pageEndDate]), pageEndDate || undefined, getLocalDateISO());
  // Follow the Reports page period when it gives one
  // AUD-01: the period the server JSON and the PDF use too — an empty field is the default, a backwards one is refused
  const resolved = resolveStatementScope({ startDate, endDate }, getLocalDateISO());
  const scope = 'scope' in resolved ? resolved.scope : null;

  // Default to first contact
  const selectedContact = useMemo(() => {
    if (type === 'customer') {
      return customers.find(c => c.id === contactId) || customers[0] || null;
    } else {
      return vendors.find(v => v.id === contactId) || vendors[0] || null;
    }
  }, [type, contactId, customers, vendors]);

  const scopeStart = scope?.startDate;
  const scopeEnd = scope?.endDate;
  // A-72: this contact's own documents, then the chosen entity label: the statement rows come from
  // the same computeStatement, so opening balance and running balance stay one implementation.
  const contactDocuments = useMemo((): {
    invoices: Invoice[];
    bills: Bill[];
    credits: Array<CreditNote | VendorCredit>;
    payments: Payment[];
  } => {
    const contactId = selectedContact?.id || '';
    return {
      invoices: invoices.filter(inv => inv.customerId === contactId),
      bills: bills.filter(bill => bill.vendorId === contactId),
      credits: type === 'customer'
        ? creditNotes.filter(cn => cn.customerId === contactId)
        : vendorCredits.filter(vc => vc.vendorId === contactId),
      payments: payments.filter(pay => pay.contactId === contactId),
    };
  }, [selectedContact?.id, invoices, bills, creditNotes, vendorCredits, payments, type]);

  /** The labels this contact's documents actually use, plus documents that carry none. */
  const entityChoices = useMemo(() => {
    const docs = [...contactDocuments.invoices, ...contactDocuments.bills, ...contactDocuments.credits];
    const labels = entityOptions(docs, entityDimensionId);
    // a credit that credits no document and carries no label is an unlabelled document too
    const hasUnlabelled = docs.some(doc => !entityLabelOf(doc, entityDimensionId));
    return [...labels, ...(hasUnlabelled ? [UNLABELLED_ENTITY] : [])];
  }, [contactDocuments, entityDimensionId]);

  // A label that the newly chosen contact does not use falls back to the whole account, so a stale
  // choice can never show one contact's figures under another's name.
  const activeEntity = entity && entityChoices.includes(entity) ? entity : '';

  const scoped = useMemo(
    () => scopeStatementDocuments(contactDocuments, activeEntity, entityDimensionId, {
      // a credit note carries no labels of its own: it belongs to the invoice or bill it credits
      creditSourceId: credit => {
        const record = credit as unknown as { invoiceId?: string; billId?: string };
        return record.invoiceId || record.billId;
      },
    }),
    [contactDocuments, activeEntity, entityDimensionId],
  );

  const statementData = useMemo(() => {
    if (!selectedContact || !scopeStart || !scopeEnd) return null;
    return computeStatement(
      selectedContact,
      scoped.invoices,
      scoped.bills,
      scoped.payments,
      scopeStart,
      scopeEnd,
      type,
      scoped.credits
    );
  }, [selectedContact, scoped, scopeStart, scopeEnd, type]);

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      {/* Header Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4 print:hidden">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400">
            <FileText className="w-6 h-6" />
          </div>
          <div>
            <Heading className="text-xl font-bold text-slate-900 dark:text-white">Account Statement</Heading>
            <p className="text-xs text-[var(--muted)] dark:text-slate-400">
              Customer and Vendor itemized account balance & transaction statements
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {selectedContact && scope && (
            <>
              {/* A-72: the server PDF is the whole account, so it is off while one entity is chosen */}
              <button
                onClick={() => setIsPreviewOpen(true)}
                disabled={Boolean(activeEntity)}
                title={activeEntity ? 'The PDF covers the whole account; choose All entities to use it' : undefined}
                className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 rounded-lg transition-colors border border-indigo-200 dark:border-indigo-800 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Eye className="w-4 h-4" />
                Preview PDF
              </button>
              <button
                onClick={() => downloadDocumentPdf('statement', selectedContact.id, currentWorkspaceId || 'default', `statement_${selectedContact.name || selectedContact.id}.pdf`, scope)}
                disabled={Boolean(activeEntity)}
                title={activeEntity ? 'The PDF covers the whole account; choose All entities to use it' : undefined}
                className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Download className="w-4 h-4" />
                Download PDF
              </button>
            </>
          )}
          <button
            onClick={handlePrint}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-100 text-white dark:text-slate-900 rounded-lg transition-colors"
          >
            <Printer className="w-4 h-4" />
            Print Statement
          </button>
        </div>
      </div>

      {/* Filter Options */}
      <div className="flex flex-wrap items-center gap-4 p-4 bg-slate-50 dark:bg-slate-900/60 rounded-xl border border-slate-200 dark:border-slate-800 print:hidden">
        <div className="flex items-center gap-1 p-1 bg-slate-200 dark:bg-slate-800 rounded-lg">
          <button
            type="button"
            onClick={() => {
              setType('customer');
              setContactId('');
            }}
            className={`px-3 py-1 text-xs font-semibold rounded-md ${type === 'customer' ? 'bg-white dark:bg-slate-900 text-purple-600 dark:text-purple-400 shadow-xs' : 'text-slate-600 dark:text-slate-400'}`}
          >
            Customer Statement
          </button>
          <button
            type="button"
            onClick={() => {
              setType('vendor');
              setContactId('');
            }}
            className={`px-3 py-1 text-xs font-semibold rounded-md ${type === 'vendor' ? 'bg-white dark:bg-slate-900 text-purple-600 dark:text-purple-400 shadow-xs' : 'text-slate-600 dark:text-slate-400'}`}
          >
            Vendor Statement
          </button>
        </div>

        <div>
          <Labelled labelClassName="block text-[10px] font-bold text-[var(--muted)] uppercase mb-1" label={<>Select {type === 'customer' ? 'Customer' : 'Vendor'}</>}>
            <select
              value={selectedContact?.id || ''}
              onChange={e => setContactId(e.target.value)}
              className="px-3 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white min-w-[200px]"
            >
              {type === 'customer' ? (
                customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)
              ) : (
                vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)
              )}
            </select>
          </Labelled>
        </div>

        {entityChoices.length > 0 && (
          <div>
            {/* A-72: one entity label of this contact's documents, or the whole account */}
            <Labelled labelClassName="block text-[10px] font-bold text-[var(--muted)] uppercase mb-1" label="Entity label">
              <select
                value={activeEntity}
                onChange={e => setEntity(e.target.value)}
                aria-describedby="statement-entity-note"
                aria-label="Entity label for this statement"
                className="px-3 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white min-w-[160px]"
              >
                <option value="">All entities (whole account)</option>
                {entityChoices.map(choice => (
                  <option key={choice} value={choice}>{choice}</option>
                ))}
              </select>
            </Labelled>
          </div>
        )}

        <div>
          <Labelled labelClassName="block text-[10px] font-bold text-[var(--muted)] uppercase mb-1" label="From">
            <input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              className="px-3 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
            />
          </Labelled>
        </div>

        <div>
          <Labelled labelClassName="block text-[10px] font-bold text-[var(--muted)] uppercase mb-1" label="To">
            <input
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
              className="px-3 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
            />
          </Labelled>
        </div>
      </div>

      {'error' in resolved && <p role="status" className="text-xs text-amber-700 dark:text-amber-400 print:hidden">{resolved.error}.</p>}

      {activeEntity && !('error' in resolved) && (
        <p id="statement-entity-note" data-testid="statement-entity-note" className="text-xs text-[var(--muted)] border border-[var(--line)] rounded-lg p-3 print:hidden">
          {entityStatementNote({
            entity: activeEntity,
            paymentsWithoutScope: scoped.paymentsWithoutScope,
            paymentsWithoutScopeCents: scoped.paymentsWithoutScopeCents,
            formattedMissing: scoped.paymentsWithoutScopeCents ? formatCurrency(scoped.paymentsWithoutScopeCents) : undefined,
            allocatedElsewhereCents: scoped.allocatedElsewhereCents,
            formattedElsewhere: scoped.allocatedElsewhereCents ? formatCurrency(scoped.allocatedElsewhereCents) : undefined,
            unappliedCents: scoped.unappliedCents,
            formattedUnapplied: scoped.unappliedCents ? formatCurrency(scoped.unappliedCents) : undefined,
            mixedLabelDocuments: scoped.mixedLabelDocuments,
          })}
        </p>
      )}

      {/* Printable Statement Canvas */}
      {'error' in resolved ? null : !statementData || !selectedContact ? (
        <div className="p-12 text-center text-sm text-[var(--muted)]">
          Please select a {type === 'customer' ? 'customer' : 'vendor'} to view statement.
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-8 space-y-8 shadow-sm">
          {/* Statement Header Card */}
          <div className="flex justify-between items-start border-b border-slate-200 dark:border-slate-800 pb-6">
            <div>
              <h2 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">STATEMENT OF ACCOUNT</h2>
              <p className="text-xs text-[var(--muted)] mt-1">Period: {statementData.startDate} to {statementData.endDate}</p>
              {activeEntity && (
                <p className="text-xs text-[var(--muted)] mt-1">
                  Entity: {activeEntity} — this statement covers this entity only, not the whole account.
                </p>
              )}
            </div>
            <div className="text-right text-xs space-y-1">
              <div className="font-bold text-slate-900 dark:text-white">{selectedContact.name}</div>
              {selectedContact.email && <div className="text-[var(--muted)]">{selectedContact.email}</div>}
            </div>
          </div>

          {/* Statement Overview Cards */}
          <div className="grid grid-cols-3 gap-4">
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800">
              <span className="text-xs text-[var(--muted)] uppercase font-semibold">Opening Balance</span>
              <div className="text-lg font-bold font-mono text-slate-900 dark:text-white mt-1">
                {formatCurrency(statementData.openingBalanceCents)}
              </div>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800">
              <span className="text-xs text-[var(--muted)] uppercase font-semibold">Total Period Billed</span>
              <div className="text-lg font-bold font-mono text-indigo-600 dark:text-indigo-400 mt-1">
                {formatCurrency(statementData.entries.reduce((sum, e) => sum + (e.debitCents || 0), 0))}
              </div>
            </div>

            <div className="p-4 rounded-xl bg-purple-500/10 border border-purple-500/20">
              <span className="text-xs text-purple-600 dark:text-purple-400 uppercase font-bold">Ending Outstanding Balance</span>
              <div className="text-xl font-bold font-mono text-purple-700 dark:text-purple-300 mt-1">
                {formatCurrency(statementData.endingBalanceCents)}
              </div>
            </div>
          </div>

          {/* Activity Table */}
          <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
            <table className="w-full text-left text-xs">
              <caption className="sr-only">Account statement</caption>
              <thead>
                <tr className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 uppercase text-[10px] font-bold">
                  <th scope="col" className="py-3 px-4">Date</th>
                  <th scope="col" className="py-3 px-4">Transaction Type</th>
                  <th scope="col" className="py-3 px-4">Reference / #</th>
                  <th scope="col" className="py-3 px-4 text-right">Amount Billed</th>
                  <th scope="col" className="py-3 px-4 text-right">Amount Paid</th>
                  <th scope="col" className="py-3 px-4 text-right">Running Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-mono">
                <tr className="bg-slate-50/50 dark:bg-slate-900/30 font-semibold">
                  <td className="py-2.5 px-4 text-[var(--muted)]">{statementData.startDate}</td>
                  <td className="py-2.5 px-4 font-sans italic text-[var(--muted)]" colSpan={4}>Opening Balance Brought Forward</td>
                  <td className="py-2.5 px-4 text-right font-bold text-slate-900 dark:text-white">
                    {formatCurrency(statementData.openingBalanceCents)}
                  </td>
                </tr>

                {statementData.entries.map(entry => (
                  <tr key={JSON.stringify([entry.type, entry.id])} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                    <td className="py-2.5 px-4 text-slate-600 dark:text-slate-400">{entry.date}</td>
                    <td className="py-2.5 px-4 font-sans font-medium text-slate-900 dark:text-white">{entry.type}</td>
                    <td className="py-2.5 px-4 text-[var(--muted)]">#{entry.reference}</td>
                    <td className="py-2.5 px-4 text-right text-slate-900 dark:text-white">
                      {entry.debitCents > 0 ? formatCurrency(entry.debitCents) : '-'}
                    </td>
                    <td className="py-2.5 px-4 text-right text-emerald-700 dark:text-emerald-400">
                      {entry.creditCents > 0 ? formatCurrency(entry.creditCents) : '-'}
                    </td>
                    <td className="py-2.5 px-4 text-right font-bold text-slate-900 dark:text-white">
                      {formatCurrency(entry.runningBalanceCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {isPreviewOpen && selectedContact && scope && (
        <PdfPreviewModal
          isOpen={isPreviewOpen}
          onClose={() => setIsPreviewOpen(false)}
          title={`Account Statement - ${selectedContact.name || selectedContact.id}`}
          documentType="statement"
          documentId={selectedContact.id}
          workspaceId={currentWorkspaceId || 'default'}
          filename={`statement_${selectedContact.name || selectedContact.id}.pdf`}
          period={scope}
        />
      )}
    </div>
  );
}
