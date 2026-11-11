import React, { useMemo, useState } from 'react';
import { usePagedRows } from '../../hooks/usePagedRows';
import { ShowMoreRows } from '../common/ShowMoreRows';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { formatCurrency, parseLocalDate, cn, formatDate } from '../../lib/utils';

import { DollarSign, Search, Eye, Download, Printer } from 'lucide-react';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import PdfPreviewModal from '../ui/PdfPreviewModal';
import { downloadDocumentPdf } from '../../services/documentDownloads';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { LoadingState } from '../ui/LoadingState';
import { ScreenDataNotice } from '../ui/ScreenDataNotice';
import { useScreenDataHealth } from '../../hooks/useScreenDataHealth';
import ListColumnChooser from '../ui/ListColumnChooser';

function withOccurrenceKeys<T>(items: T[], keyForItem: (item: T) => string) {
  const occurrences = new Map<string, number>();
  return items.map(item => {
    const contentKey = keyForItem(item);
    const occurrence = occurrences.get(contentKey) ?? 0;
    occurrences.set(contentKey, occurrence + 1);
    return { item, key: JSON.stringify([contentKey, occurrence]) };
  });
}

export default function PaymentsView() {
  const role = useCurrentRole();
  // cheques (BE-13) are printed by the people who can pay bills
  const canPrintCheques = role === 'owner' || role === 'accountant' || role === 'bookkeeper';
  const payments = useLedgerStore(s => s.payments);
  useLedgerStore(s => s.customers);
  useLedgerStore(s => s.vendors);
  const invoices = useLedgerStore(s => s.invoices);
  const bills = useLedgerStore(s => s.bills);
  const { loading } = useLedgerCollections('bills', 'customers', 'invoices', 'payments', 'vendors');
  const dataHealth = useScreenDataHealth(['bills', 'customers', 'invoices', 'payments', 'vendors']);
  // the paid document's number (the id's second half was shown: 'undefined' for most ids)
  // #642: the numbers are looked up from a map built once, not by searching every invoice and bill per allocation
  const numbers = useMemo(() => ({
    bill: new Map((bills || []).map(d => [d.id, d.number] as const)),
    invoice: new Map((invoices || []).map(d => [d.id, d.number] as const)),
  }), [bills, invoices]);
  const documentLabel = (alloc: { documentId: string; documentType: string }) =>
    (alloc.documentType === 'bill' ? numbers.bill : numbers.invoice).get(alloc.documentId) || `#${alloc.documentId.slice(0, 8)}`;
  const currentWorkspaceId = useAuthStore(s => s.currentWorkspaceId);
  const [previewPayment, setPreviewPayment] = useState<import("../../types").Payment | null>(null);
  
  const [searchTerm, setSearchTerm] = useState('');

  const filteredPayments = useMemo(() => {
    const term = searchTerm.toLowerCase();
    // #642: each date is parsed once, not twice per comparison (a parse builds a time-zone formatter)
    return payments.filter(p => !term || `${p.contactName || p.contactId} ${p.method} ${p.reference || ''}`.toLowerCase().includes(term))
      .map(p => ({ p, t: parseLocalDate(p.date).getTime() }))
      .sort((a, b) => b.t - a.t)
      .map(x => x.p);
  }, [payments, searchTerm]);
  // #642: a year of payments draws its first page at once (printing draws them all)
  const paged = usePagedRows(filteredPayments, searchTerm);

  return (
    // A-276: w-full min-w-0, so the 800 px table scrolls inside its box on a phone instead of
    // blowing this flex item out to its content width and clipping off the edge
    <div className="w-full min-w-0 p-8 max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500">
      <ScreenDataNotice failedKeys={dataHealth.failedKeys} message={dataHealth.message} onRetry={dataHealth.retry} what="this register" />
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
        <div>
          <h1 className="text-4xl font-black tracking-tighter text-[var(--text)]">Payments Register</h1>
          <p className="text-[var(--muted)] mt-2 font-medium">Global ledger of settled capital flows</p>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-4 mb-8">
        <div className="relative flex-1 group">
          <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
            <Search aria-hidden="true" size={18} className="text-[var(--muted)] group-focus-within:text-indigo-500 transition-colors" />
          </div>
          <input aria-label="Search payments by entity, method, or reference"
            type="text"
            placeholder="Search payments by entity, method, or reference..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-12 pr-4 py-4 bg-[var(--surface)] border border-[var(--line)] rounded-[24px] focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all text-[var(--text)] font-medium placeholder:text-slate-400 shadow-sm"
          />
        </div>
      </div>

      <div className="ledger-card p-1 rounded-[32px] overflow-hidden">
        <div className="overflow-x-auto" data-list-columns="payments-register">
          <ListColumnChooser scope="payments-register" label="Payments"
            columns={['Date', 'Entity', 'Method & Ref', 'Amount', 'Allocations', 'Actions']} />
          <table className="w-full border-collapse min-w-[800px]">
            <caption className="sr-only">Payments Register</caption>
            <thead>
              <tr className="text-left border-b border-[var(--line)]/50">
                <th scope="col" className="p-4 md:p-8 text-[10px] font-black text-[var(--muted)] uppercase tracking-[0.2em] whitespace-nowrap">Date</th>
                <th scope="col" className="p-4 md:p-8 text-[10px] font-black text-[var(--muted)] uppercase tracking-[0.2em] whitespace-nowrap">Entity</th>
                <th scope="col" className="p-4 md:p-8 text-[10px] font-black text-[var(--muted)] uppercase tracking-[0.2em] whitespace-nowrap">Method & Ref</th>
                <th scope="col" className="p-4 md:p-8 text-[10px] font-black text-[var(--muted)] uppercase tracking-[0.2em] whitespace-nowrap text-right">Amount</th>
                <th scope="col" className="p-4 md:p-8 text-[10px] font-black text-[var(--muted)] uppercase tracking-[0.2em] whitespace-nowrap">Allocations</th>
                <th scope="col" className="p-4 md:p-8 text-[10px] font-black text-[var(--muted)] uppercase tracking-[0.2em] whitespace-nowrap text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ledger-line/30">
              {paged.visible.map(payment => (
                <tr key={payment.id} className="group hover:bg-[var(--ink)]/30 transition-all">
                  <td className="p-4 md:p-8 font-mono font-bold text-[var(--muted)] group-hover:text-[var(--text)] transition-colors">
                    {formatDate(payment.date)}
                  </td>
                  <td className="p-4 md:p-8">
                    <div className="flex flex-col">
                      <span className="font-black text-[var(--text)] text-base tracking-tight">{payment.contactName || payment.contactId}</span>
                      <span className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest mt-1">
                        {payment.direction === 'received' ? 'Customer' : payment.direction === 'made' ? 'Vendor' : 'Entity'}
                      </span>
                    </div>
                  </td>
                  <td className="p-4 md:p-8">
                    <div className="flex flex-col">
                      <span className="font-bold text-[var(--text)] capitalize">{payment.method}</span>
                      {payment.reference && (
                        <span className="text-[10px] font-mono text-[var(--muted)] mt-1">{payment.reference}</span>
                      )}
                    </div>
                  </td>
                  <td className="p-4 md:p-8 text-right font-black font-mono text-[var(--text)] text-lg tracking-tighter tabular-nums">
                    <span className={cn(
                      payment.direction === 'received' ? "text-emerald-500" : "text-rose-500"
                    )}>
                      {payment.direction === 'received' ? '+' : '-'}{formatCurrency(payment.amountCents || 0, payment.currency)}
                    </span>
                  </td>
                  <td className="p-4 md:p-8">
                    <div className="flex flex-col gap-1">
                      {payment.allocations && withOccurrenceKeys(payment.allocations, alloc => JSON.stringify([alloc.documentType, alloc.documentId, alloc.amountCents])).map(({ item: alloc, key }) => (
                        <span key={key} className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest bg-[var(--surface)] px-2 py-1 rounded-md border border-[var(--line)]">
                          {alloc.documentType}: {documentLabel(alloc)} ({formatCurrency(alloc.amountCents, payment.currency)})
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="p-4 md:p-8 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button aria-label="Preview PDF Receipt"
                        onClick={() => setPreviewPayment(payment)}
                        className="p-2 text-[var(--muted)] hover:text-indigo-600 hover:bg-[var(--surface)] rounded-xl border border-transparent hover:border-[var(--line)] transition-all"
                        title="Preview PDF Receipt"
                      >
                        <Eye aria-hidden="true" size={16} />
                      </button>
                      <button aria-label="Download PDF Receipt"
                        onClick={() => downloadDocumentPdf('payment', payment.id, currentWorkspaceId || 'default', `receipt_${payment.number || payment.id}.pdf`)}
                        className="p-2 text-[var(--muted)] hover:text-indigo-600 hover:bg-[var(--surface)] rounded-xl border border-transparent hover:border-[var(--line)] transition-all"
                        title="Download PDF Receipt"
                      >
                        <Download aria-hidden="true" size={16} />
                      </button>
                      {canPrintCheques && payment.direction === 'made' && payment.status !== 'void' && (
                        <button type="button" aria-label={`Print cheque for ${payment.contactName || 'the vendor'}`}
                          onClick={() => downloadDocumentPdf('cheque', payment.id, currentWorkspaceId || 'default', `cheque_${payment.reference || payment.number || payment.id}.pdf`)}
                          className="p-2 text-[var(--muted)] hover:text-indigo-600 hover:bg-[var(--surface)] rounded-xl border border-transparent hover:border-[var(--line)] transition-all"
                          title="Print cheque (US Letter, cheque on top)">
                          <Printer aria-hidden="true" size={16} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filteredPayments.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-24 text-center relative overflow-hidden">
                    <div className="absolute technical-grid inset-0 opacity-5 pointer-events-none" />
                    {loading ? <LoadingState what="payments" /> : (
                    <div className="relative z-10 flex flex-col items-center gap-4">
                      <div className="w-20 h-20 bg-slate-200/20 rounded-[32px] flex items-center justify-center text-slate-500/30">
                        <DollarSign aria-hidden="true" size={40} />
                      </div>
                      <p className="text-base font-black text-[var(--muted)] uppercase tracking-[0.3em]">No payments recorded</p>
                    </div>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <ShowMoreRows shown={paged.visible.length} total={paged.total} noun="payments" onMore={paged.more} onAll={paged.all} />
        </div>
      </div>

      {previewPayment && (
        <PdfPreviewModal
          isOpen={!!previewPayment}
          onClose={() => setPreviewPayment(null)}
          title={`Payment Receipt ${previewPayment.number || previewPayment.id}`}
          documentType="payment"
          documentId={previewPayment.id}
          workspaceId={currentWorkspaceId || 'default'}
          filename={`receipt_${previewPayment.number || previewPayment.id}.pdf`}
        />
      )}
    </div>
  );
}
