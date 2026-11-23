import { BRAND } from '../../config/brand';
import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Building2 } from 'lucide-react';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { customerOpenQuotes, type CustomerQuoteItem } from '../../lib/customerQuotes';
import type { Estimate } from '../../types';
import { runCommand } from '../../lib/runCommand';
import { RowTable } from '../ui/RowTable';

/**
 * Customer portal (K-27, A-49 / A-175, G-16): what a customer sees at `/c/<token>`: their invoices
 * from this business, summary totals, what is still due on each, "View and pay" for each one's own
 * page, and their open estimates and proposals with the Y-20 signing link (`/e/<signToken>`).
 */
interface PortalInvoice {
  number: string;
  date: string;
  dueDate: string;
  totalCents: number;
  dueCents: number;
  currency: string;
  status: 'open' | 'overdue' | 'paid';
  payPath: string;
}

interface PortalData {
  business: string;
  customer: string;
  customerId?: string;
  currency: string;
  owedCents: number;
  invoices: PortalInvoice[];
  estimates?: Estimate[];
  quotes?: Array<CustomerQuoteItem & { signToken?: string }>;
  /** EU-I2: the business left "Sent with …" on (the default) */
  poweredBy?: boolean;
}

type InvoiceFilter = 'all' | 'due' | 'paid';

const STATUS = { open: 'Open', overdue: 'Overdue', paid: 'Paid' } as const;
const QUOTE_STATE = { open: 'Open', expired: 'Expired', signed: 'Signed', closed: 'Closed' } as const;

export default function CustomerPortalPage() {
  const token = window.location.pathname.split('/')[2] || '';
  const [data, setData] = useState<PortalData | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<InvoiceFilter>('all');

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        // a customer's link: no session token, by design
        const body = await runCommand<PortalData>({ path: `/api/v1/invoices/public/portal/${encodeURIComponent(token)}`, token: null });
        if (!live) return;
        setData(body);
      } catch (err) {
        if (live) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => { live = false; };
  }, [token]);

  const quoteRows: Array<CustomerQuoteItem & { signToken?: string }> = useMemo(() => {
    if (!data) return [];
    if (data.quotes) return data.quotes;
    if (data.estimates && data.customerId) {
      return customerOpenQuotes(data.estimates, data.customerId, getLocalDateISO()).map(q => {
        const est = data.estimates?.find(e => e.id === q.estimateId);
        return { ...q, ...(est?.signToken ? { signToken: est.signToken } : {}) };
      });
    }
    return [];
  }, [data]);

  const filteredInvoices = useMemo(() => {
    if (!data) return [];
    if (filter === 'due') return data.invoices.filter(inv => inv.status !== 'paid');
    if (filter === 'paid') return data.invoices.filter(inv => inv.status === 'paid');
    return data.invoices;
  }, [data, filter]);

  const totalBilledCents = useMemo(
    () => (data ? data.invoices.reduce((sum, inv) => sum + inv.totalCents, 0) : 0),
    [data],
  );
  const totalPaidCents = useMemo(
    () => (data ? data.invoices.reduce((sum, inv) => sum + Math.max(0, inv.totalCents - inv.dueCents), 0) : 0),
    [data],
  );

  return (
    <main className="min-h-screen bg-[var(--ink)] text-[var(--text)] p-4 md:p-10">
      <div className="max-w-3xl mx-auto space-y-6">
        {error ? (
          <div role="alert" className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" aria-hidden="true" />
            <div>
              <h1 className="text-lg font-bold">Your invoices</h1>
              <p className="text-sm text-[var(--muted)] mt-1">{error}</p>
            </div>
          </div>
        ) : !data ? (
          <p role="status" className="text-sm text-[var(--muted)]">Loading your invoices…</p>
        ) : (
          <>
            <header className="space-y-1">
              <p className="text-sm text-[var(--muted)] flex items-center gap-2"><Building2 className="w-4 h-4" aria-hidden="true" /> <bdi>{data.business}</bdi></p>
              <h1 className="text-2xl font-bold">Invoices for <bdi>{data.customer}</bdi></h1>
              <p className="text-sm">
                {data.owedCents > 0 ? <>Still to pay: <strong>{formatCurrency(data.owedCents, data.currency)}</strong></> : 'Nothing to pay at the moment. Thank you.'}
              </p>
            </header>

            <section aria-label="Account summary" className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
                <div className="text-xs text-[var(--muted)]">Still to pay</div>
                <div className="text-lg font-bold tabular-nums mt-1">{formatCurrency(data.owedCents, data.currency)}</div>
              </div>
              <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
                <div className="text-xs text-[var(--muted)]">Paid (last 12 months)</div>
                <div className="text-lg font-bold tabular-nums mt-1">{formatCurrency(totalPaidCents, data.currency)}</div>
              </div>
              <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
                <div className="text-xs text-[var(--muted)]">Total billed</div>
                <div className="text-lg font-bold tabular-nums mt-1">{formatCurrency(totalBilledCents, data.currency)}</div>
              </div>
            </section>

            {data.invoices.length > 0 && (
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter invoices">
                {([
                  ['all', `All (${data.invoices.length})`],
                  ['due', `To pay (${data.invoices.filter(i => i.status !== 'paid').length})`],
                  ['paid', `Paid (${data.invoices.filter(i => i.status === 'paid').length})`],
                ] as const).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setFilter(key)}
                    aria-pressed={filter === key}
                    className={`min-h-11 px-3 rounded-lg text-xs font-semibold border ${
                      filter === key
                        ? 'bg-[var(--text)] text-[var(--bg)] border-[var(--text)]'
                        : 'bg-[var(--surface)] text-[var(--text)] border-[var(--line)]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}

            {filteredInvoices.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">No invoices match this filter.</p>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-[var(--line)] bg-[var(--surface)]" role="region" aria-label="Your invoices" tabIndex={0}>{/* NOSONAR: S6845 — tabIndex on scrollable region is the intentional axe scrollable-region-focusable pattern */}
                <RowTable
caption={<>Invoices from {data.business} for {data.customer}</>}
captionClassName={"sr-only"}
tableClassName={"w-full text-sm"}
headRowClassName={''}
headerRowClassName={"text-left text-xs text-[var(--muted)]"}
bodyClassName={''}
rows={filteredInvoices}
rowKey={inv => `${inv.number}-${inv.date}`}
rowHeaderClassName={'font-normal text-start'}
rowClassName={"border-t border-[var(--line)]"}
columns={[
{ header: "Invoice", headClassName: "p-3", className: "p-3 font-semibold", cell: inv => (<bdi>{inv.number}</bdi>) },
{ header: "Date", headClassName: "p-3", className: "p-3 tabular-nums", cell: inv => (inv.date) },
{ header: "Due", headClassName: "p-3", className: "p-3 tabular-nums", cell: inv => (inv.dueDate) },
{ header: "Total", headClassName: "p-3 text-right", className: "p-3 text-right tabular-nums", cell: inv => (formatCurrency(inv.totalCents, inv.currency)) },
{ header: "Still due", headClassName: "p-3 text-right", className: "p-3 text-right tabular-nums", cell: inv => (formatCurrency(inv.dueCents, inv.currency)) },
{ header: "Status", headClassName: "p-3", cellProps: inv => ({ "className": `p-3 ${inv.status === 'overdue' ? 'text-rose-600 font-semibold' : inv.status === 'paid' ? 'text-[var(--muted)]' : ''}` }), cell: inv => (STATUS[inv.status]) },
{ header: <span className="sr-only">Open</span>, headClassName: "p-3", className: "p-3", cell: inv => (inv.payPath && (
                            <a href={inv.payPath} className="font-semibold text-indigo-600 dark:text-indigo-400 hover:underline whitespace-nowrap">
                              {inv.status === 'paid' ? 'View' : 'View and pay'}<span className="sr-only"> invoice {inv.number}</span>
                            </a>
                          )) }
]}
/>
              </div>
            )}
            <p className="text-xs text-[var(--muted)]">Paid invoices from the last 12 months are shown. Questions about an invoice? Reply to the email it came with.</p>
            {quoteRows.length > 0 && (
              <section aria-label="Quotes and proposals" className="space-y-2 pt-2">
                <h2 className="text-lg font-bold">Estimates &amp; proposals</h2>
                <div className="overflow-x-auto rounded-2xl border border-[var(--line)] bg-[var(--surface)]">
                  <RowTable
                    rowHeaderColumn={false}
                    rowClassName="border-t border-[var(--line)]"
                    caption={(<>Quotes and proposals for {data.customer}</>)}
                    rows={quoteRows}
                    rowKey={q => q.estimateId}
                    tableClassName="w-full text-sm"
                    headRowClassName="text-left text-xs text-[var(--muted)]"
                    bodyClassName=""
                    columns={[
                      { header: "Quote", className: "p-3 font-semibold", headClassName: "p-3", cell: (q) => (<><bdi>{q.number}</bdi>{q.versionLabel ? <div className="text-xs font-normal text-[var(--muted)]"><bdi>{q.versionLabel} — the latest is shown</bdi></div> : null}</>) },
                      { header: "Title", className: "p-3", headClassName: "p-3", cell: (q) => <bdi>{q.title}</bdi> },
                      { header: "Valid until", className: "p-3 tabular-nums", headClassName: "p-3", cell: (q) => q.expiryDate || '—' },
                      { header: "Amount", align: 'right', className: "p-3 tabular-nums", headClassName: "p-3", cell: (q) => formatCurrency(q.amountCents, q.currency || data.currency) },
                      { header: "Status", className: "p-3", headClassName: "p-3", cell: (q) => QUOTE_STATE[q.state] },
                      { header: <span className="sr-only">Accept</span>, className: "p-3", headClassName: "p-3", cell: (q) => q.canAccept && q.signToken && (
                              <a href={`/e/${encodeURIComponent(q.signToken)}`} className="font-semibold text-indigo-600 dark:text-indigo-400 hover:underline whitespace-nowrap">
                                Review and accept<span className="sr-only"> quote {q.number}</span>
                              </a>
                            ) },
                    ]}
                  />
                </div>
              </section>
            )}
          </>
        )}
        {data && data.poweredBy !== false && (
          <p className="pt-6 text-center text-xs text-[var(--muted)]">Sent with <a href={`https://${BRAND.domain}`} target="_blank" rel="noopener noreferrer" className="underline">{BRAND.name}</a></p>
        )}
      </div>
    </main>
  );
}
