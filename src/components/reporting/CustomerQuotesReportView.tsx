/**
 * A-49 / A-175, A-35, A-18: Customer quotes, one-page proposals and recurring estimate schedules.
 * - Lists open, signed and expired estimates and proposals per customer (customerOpenQuotes,
 *   acceptQuoteProblem) with the Y-20 signing link (/e/<signToken>) used on the customer portal.
 * - Builds and previews a one-page proposal with cover letter, sections and optional items
 *   (proposalFromEstimate, proposalTotals, proposalProblem, proposalText).
 * - Previews recurring estimate schedules and draft quotes due (recurringEstimateSchedule,
 *   estimateDraftsDue, ESTIMATE_FREQUENCIES).
 */
import React, { useMemo, useState } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { useEntityOperations } from '../../hooks/useEntityOperations';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import {
  acceptQuoteProblem,
  customerOpenQuotes,
  type CustomerQuoteItem,
} from '../../lib/customerQuotes';
import {
  proposalFromEstimate,
  proposalProblem,
  proposalText,
  proposalTotals,
  type Proposal,
} from '../../lib/proposals';
import {
  ESTIMATE_FREQUENCIES,
  estimateDraftsDue,
  estimateValidityDays,
  recurringEstimateProblem,
  recurringEstimateSchedule,
} from '../../lib/recurringEstimates';
import { downloadCsv } from '../../lib/csvExport';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import type { Customer, Estimate, RecurringTransaction } from '../../types';
import ReportTableScroll from './ReportTableScroll';

export default function CustomerQuotesReportView() {
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const userId = useAuthStore(s => s.user?.uid);
  return <CustomerQuotesContent key={JSON.stringify([userId, workspaceId])} />;
}

function CustomerQuotesContent() {
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const homeCurrency = (workspace?.currency || 'USD').toUpperCase();
  const truncated = useLedgerStore(s => s.truncatedCollections);
  const failed = useDataNeedsStore(s => s.failed);
  const { loading } = useLedgerCollections('estimates', 'customers', 'recurring');

  const estimates = useLedgerStore(s => s.estimates) as Estimate[];
  const customers = useLedgerStore(s => s.customers) as Customer[];
  const recurring = useLedgerStore(s => s.recurring) as Array<RecurringTransaction & { sourceEstimateId?: string }>;

  const [today, setToday] = useState<string>(() => getLocalDateISO());
  const [quoteState, setQuoteState] = useState('all');
  const [customerFilter, setCustomerFilter] = useState<string>('__all__');
  const [selectedEstId, setSelectedEstId] = useState<string>('');
  const [proposalTitle, setProposalTitle] = useState<string>('');
  const [coverLetter, setCoverLetter] = useState<string>('');
  const [optionalPositions, setOptionalPositions] = useState<Record<number, boolean>>({});
  const [frequency, setFrequency] = useState<RecurringTransaction['frequency']>('monthly');

  const wsCustomers = useMemo(
    () => (customers || []).filter(c => !workspaceId || !c.workspaceId || c.workspaceId === workspaceId),
    [customers, workspaceId],
  );
  const wsEstimates = useMemo(
    () => (estimates || []).filter(e => !workspaceId || !e.workspaceId || e.workspaceId === workspaceId),
    [estimates, workspaceId],
  );
  const estimatesById = useMemo(() => new Map(wsEstimates.map(e => [e.id, e])), [wsEstimates]);

  const selectedEstimate = useMemo(
    () => wsEstimates.find(e => e.id === selectedEstId) || wsEstimates[0],
    [wsEstimates, selectedEstId],
  );

  const activeProposal = useMemo<Proposal | null>(() => {
    if (!selectedEstimate) return null;
    const base = proposalFromEstimate(selectedEstimate);
    const title = proposalTitle.trim() || base.title;
    const sections = base.sections.map(sec => ({
      ...sec,
      items: sec.items.map((item, idx) => ({
        ...item,
        optional: Boolean(optionalPositions[idx]),
      })),
    }));
    return {
      ...base,
      title,
      coverLetter,
      sections,
    };
  }, [selectedEstimate, proposalTitle, coverLetter, optionalPositions]);

  const proposalsMap = useMemo(() => {
    const out: Record<string, Pick<Proposal, 'title'>> = {};
    if (selectedEstimate && activeProposal && proposalTitle.trim()) {
      out[selectedEstimate.id] = { title: activeProposal.title };
    }
    return out;
  }, [selectedEstimate, activeProposal, proposalTitle]);

  const allQuoteRows = useMemo<Array<CustomerQuoteItem & { customerName: string; signToken?: string; problem: string | null }>>(() => {
    const customerIds = customerFilter === '__all__'
      ? Array.from(new Set(wsEstimates.map(e => e.customerId).filter(Boolean)))
      : [customerFilter];
    const rows: Array<CustomerQuoteItem & { customerName: string; signToken?: string; problem: string | null }> = [];
    for (const cid of customerIds) {
      const customerName = wsCustomers.find(c => c.id === cid)?.name || wsEstimates.find(e => e.customerId === cid)?.customerName || cid;
      for (const row of customerOpenQuotes(wsEstimates, cid, today, proposalsMap)) {
        const est = estimatesById.get(row.estimateId);
        rows.push({
          ...row,
          customerName,
          ...(est?.signToken ? { signToken: est.signToken } : {}),
          problem: acceptQuoteProblem(row, { name: customerName, agree: true }),
        });
      }
    }
    return rows;
  }, [wsEstimates, wsCustomers, customerFilter, today, proposalsMap, estimatesById]);

  const quoteRows = allQuoteRows.filter(row => quoteState === 'all' || row.state === quoteState);

  const propTotals = useMemo(
    () => (activeProposal ? proposalTotals(activeProposal.sections) : null),
    [activeProposal],
  );
  const propProblem = useMemo(
    () => (activeProposal ? proposalProblem(activeProposal) : null),
    [activeProposal],
  );
  const propPageText = useMemo(
    () => (activeProposal ? proposalText(activeProposal, homeCurrency) : ''),
    [activeProposal, homeCurrency],
  );

  const recurringInfo = useMemo(() => {
    if (!selectedEstimate) return null;
    const problem = recurringEstimateProblem({ frequency, customerId: selectedEstimate.customerId });
    if (problem) return { problem, nextOccurrence: '', drafts: [], validityDays: 0 };
    const schedule = recurringEstimateSchedule(selectedEstimate, frequency, today);
    const validityDays = estimateValidityDays(selectedEstimate);
    const drafts = estimateDraftsDue(
      [{
        id: selectedEstimate.id,
        isActive: schedule.isActive,
        nextOccurrence: schedule.nextOccurrence,
        frequency: schedule.frequency,
        anchorDay: schedule.anchorDay,
        status: 'active',
      }],
      today,
    );
    return { problem: null, nextOccurrence: schedule.nextOccurrence, drafts, validityDays };
  }, [selectedEstimate, frequency, today]);
  const { addEntity } = useEntityOperations();
  const role = useCurrentRole();
  const canRepeat = role === 'owner' || role === 'accountant' || role === 'bookkeeper';
  const [repeating, setRepeating] = useState(false);
  // CC-04: saves the schedule; the daily job makes a draft estimate (next number) on each date
  // one schedule per estimate: an estimate already repeating is not set up again
  const alreadyRepeating = Boolean(selectedEstimate && (recurring || []).some(r => r.sourceEstimateId === selectedEstimate.id && r.isActive !== false && r.status !== 'completed'));
  // until the full list of schedules is here, absence does not prove there is none
  const schedulesUnknown = loading || Boolean(truncated.recurring || failed.recurring);
  const repeat = (): void => {
    if (!selectedEstimate || repeating || alreadyRepeating || schedulesUnknown || recurringEstimateProblem({ frequency, customerId: selectedEstimate.customerId })) return;
    setRepeating(true);
    // the saved schedule starts from the real date; the assessment date only drives the preview
    void addEntity('recurring', recurringEstimateSchedule(selectedEstimate, frequency, getLocalDateISO()), `Estimate ${selectedEstimate.number} will repeat ${frequency}`)
      .finally(() => setRepeating(false));
  };

  const partial = Boolean(
    truncated.estimates || truncated.customers || failed.estimates || failed.customers,
  );

  const exportCsv = () => {
    downloadCsv(
      `customer-quotes-${today}.csv`,
      ['Quote #', 'Kind', 'Title', 'Customer', 'Date', 'Expiry Date', 'Amount', 'Currency', 'State', 'Portal Accept Link'],
      quoteRows.map(r => [
        r.number,
        r.kind,
        r.title,
        r.customerName,
        r.date,
        r.expiryDate || '',
        (r.amountCents / 100).toFixed(2),
        (r.currency || homeCurrency).toUpperCase(),
        r.state,
        r.signToken ? `/e/${r.signToken}` : '',
      ]),
    );
  };

  return (
    <section aria-label="Customer quotes and proposals" className="p-4 space-y-5 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2>Customer quotes, proposals &amp; recurring estimates</h2>
          <p className="text-sm text-[var(--muted)]">
            Open estimates and one-page proposals by customer with their portal signing link (<code>/e/&lt;token&gt;</code>),
            optional proposal items, and recurring estimate schedules.
          </p>
        </div>
        <button
          type="button"
          onClick={exportCsv}
          disabled={quoteRows.length === 0}
          className="min-h-11 px-3 py-1.5 rounded border text-sm disabled:opacity-50"
        >
          Download CSV
        </button>
      </div>

      {loading && <p role="status" className="text-sm text-[var(--muted)]">Loading estimates and customers…</p>}
      {partial && (
        <p role="alert" className="text-sm text-amber-700">
          Estimates or customers are only partly loaded; quotes outside the loaded list are not shown.
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3" data-print-hide>
        <label className="flex flex-col gap-1 text-sm">Quote state
          <select aria-label="Quote state" value={quoteState} onChange={event => setQuoteState(event.target.value)}
            className="min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]">
            <option value="all">All states</option><option value="open">Open</option><option value="expired">Expired</option><option value="signed">Signed</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Customer
          <select
            aria-label="Filter by customer"
            value={customerFilter}
            onChange={e => setCustomerFilter(e.target.value)}
            className="min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]"
          >
            <option value="__all__">All customers</option>
            {wsCustomers.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Assessment date
          <input
            aria-label="Assessment date"
            type="date"
            value={today}
            onChange={e => setToday(e.target.value)}
            className="min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]"
          />
        </label>
      </div>

      {quoteRows.length === 0 && !loading ? (
        <p className="text-sm text-[var(--muted)]">No open or signed customer quotes match the selected filter.</p>
      ) : (
        <ReportTableScroll>
          <table className="w-full min-w-[1100px] text-sm border-collapse">
            <caption className="sr-only">Customer quotes and proposals as of {today}</caption>
            <thead>
              <tr className="border-b text-left">
                <th scope="col" className="py-2 pr-3">Quote #</th>
                <th scope="col" className="py-2 pr-3">Kind</th>
                <th scope="col" className="py-2 pr-3">Title</th>
                <th scope="col" className="py-2 pr-3">Customer</th>
                <th scope="col" className="py-2 pr-3">Date</th>
                <th scope="col" className="py-2 pr-3">Valid Until</th>
                <th scope="col" className="py-2 pr-3 text-right">Amount</th>
                <th scope="col" className="py-2 pr-3">State</th>
                <th scope="col" className="py-2">Portal Accept Link</th>
                <th scope="col" className="py-2">Follow-up</th>
              </tr>
            </thead>
            <tbody>
              {quoteRows.map(r => {
                const cur = (r.currency || homeCurrency).toUpperCase();
                return (
                  <tr key={r.estimateId} className="border-b">
                    <td className="py-2 pr-3 font-mono">{r.number}</td>
                    <td className="py-2 pr-3 capitalize">{r.kind}</td>
                    <td className="py-2 pr-3"><bdi>{r.title}</bdi></td>
                    <td className="py-2 pr-3"><bdi>{r.customerName}</bdi></td>
                    <td className="py-2 pr-3 tabular-nums">{r.date}</td>
                    <td className="py-2 pr-3 tabular-nums">{r.expiryDate || '—'}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatCurrency(r.amountCents, cur)}</td>
                    <td className="py-2 pr-3 capitalize">{r.state}</td>
                    <td className="py-2 text-xs">
                      {r.canAccept && r.signToken ? (
                        <a
                          href={`/e/${encodeURIComponent(r.signToken)}`}
                          className="text-indigo-600 dark:text-indigo-400 hover:underline font-mono"
                        >
                          /e/{r.signToken}
                        </a>
                      ) : (
                        <span className="text-[var(--muted)]">{r.problem || 'Send estimate to generate signing link'}</span>
                      )}
                    </td>
                    <td className="py-2 align-top min-w-72">{(r.state === 'open' || r.state === 'expired') ? <details>
                      <summary className="min-h-11 cursor-pointer">Follow-up draft</summary>
                      <p className="text-sm text-[var(--muted)]">Select and copy this draft, then review it before sending through your usual channel. Nothing is sent or saved here.</p>
                      <label className="block">Draft for <bdi>{r.number}</bdi>
                        <textarea aria-label={`Follow-up draft for ${r.number}`} dir="auto" readOnly rows={6}
                          onFocus={event => event.currentTarget.select()}
                          className="block min-h-11 w-64 max-w-full border rounded p-2 bg-[var(--panel)] text-[var(--text)]"
                          value={`Hello ${r.customerName},\n\nFollowing up on quote ${r.number}.${r.state === 'expired' ? ` Its recorded validity ended${r.expiryDate ? ` on ${r.expiryDate}` : ''}; please contact us for an updated quote before accepting.` : r.expiryDate ? ` Its recorded validity runs through ${r.expiryDate}.` : ''}\n\nWould you like to discuss next steps?`} />
                      </label>
                    </details> : 'No follow-up draft for this state'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ReportTableScroll>
      )}

      {selectedEstimate && activeProposal && propTotals && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-2 border-t border-[var(--line)]">
          <div className="border border-[var(--line)] rounded p-4 space-y-3 bg-[var(--panel)]">
            <h3 className="font-semibold text-base">One-page proposal builder ({selectedEstimate.number})</h3>
            <div className="flex flex-wrap gap-3">
              <label className="flex flex-col gap-1 text-sm">
                Estimate
                <select
                  aria-label="Proposal estimate"
                  value={selectedEstimate.id}
                  onChange={e => {
                    setSelectedEstId(e.target.value);
                    setOptionalPositions({});
                  }}
                  className="min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]"
                >
                  {wsEstimates.map(e => (
                    <option key={e.id} value={e.id}>{e.number} · {e.customerName}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm flex-1 min-w-[14rem]">
                Proposal title
                <input
                  aria-label="Proposal title"
                  type="text"
                  dir="auto"
                  value={proposalTitle}
                  placeholder={activeProposal.title}
                  onChange={e => setProposalTitle(e.target.value)}
                  className="min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]"
                />
              </label>
            </div>
            <label className="flex flex-col gap-1 text-sm">
              Cover letter
              <textarea
                aria-label="Proposal cover letter"
                rows={2}
                dir="auto"
                value={coverLetter}
                onChange={e => setCoverLetter(e.target.value)}
                placeholder="Scope summary and introduction for the customer"
                className="border rounded p-2 bg-[var(--panel)] text-[var(--text)]"
              />
            </label>
            <div className="space-y-1 text-sm">
              <div className="font-medium">Line items (tick optional add-ons):</div>
              {activeProposal.sections[0]?.items.map((item, pos) => (
                <label key={`${selectedEstimate.id}:${item.description}:${item.unitPriceCents}`} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    aria-label={`Optional item ${item.description}`}
                    checked={Boolean(optionalPositions[pos])}
                    onChange={e => setOptionalPositions(prev => ({ ...prev, [pos]: e.target.checked }))}
                  />
                  <span><bdi>{item.description}</bdi> ({item.quantity} × {formatCurrency(item.unitPriceCents, homeCurrency)})</span>
                </label>
              ))}
            </div>
            {propProblem && <p role="alert" className="text-sm text-amber-700">{propProblem}</p>}
            <p className="text-sm text-[var(--muted)]">
              Required total: <strong>{formatCurrency(propTotals.requiredCents, homeCurrency)}</strong>
              {propTotals.optionalItems > 0 && (
                <> · Optional add-ons: <strong>{formatCurrency(propTotals.optionalCents, homeCurrency)}</strong> (with optionals: {formatCurrency(propTotals.withOptionalsCents, homeCurrency)})</>
              )}
            </p>
            <pre aria-label="One-page proposal text" className="text-xs p-3 rounded border bg-[var(--surface)] whitespace-pre-wrap overflow-x-auto">
              {propPageText}
            </pre>
          </div>

          {recurringInfo && (
            <div className="border border-[var(--line)] rounded p-4 space-y-3 bg-[var(--panel)]">
              <h3 className="font-semibold text-base">Recurring estimate schedule ({selectedEstimate.number})</h3>
              <p className="text-xs text-[var(--muted)]">
                Each repeat is a new draft estimate with the next number, made by the daily job on its date; nothing is sent. Shown: drafts due on or before {today} (validity window: {recurringInfo.validityDays} days).
              </p>
              <div className="flex flex-wrap gap-3">
                <label className="flex flex-col gap-1 text-sm">
                  Frequency
                  <select
                    aria-label="Recurring frequency"
                    value={frequency}
                    onChange={e => setFrequency(e.target.value as RecurringTransaction['frequency'])}
                    className="min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]"
                  >
                    {ESTIMATE_FREQUENCIES.map(f => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                </label>
                {canRepeat && (
                  <button type="button" onClick={repeat} disabled={repeating || alreadyRepeating || schedulesUnknown || Boolean(recurringInfo.problem)} aria-busy={repeating}
                    className="self-end min-h-11 px-3 rounded border text-sm disabled:opacity-50">
                    {alreadyRepeating ? 'Already repeating' : 'Repeat this estimate'}
                  </button>
                )}
              </div>
              {recurringInfo.problem ? (
                <p role="alert" className="text-sm text-amber-700">{recurringInfo.problem}</p>
              ) : (
                <div className="space-y-2 text-sm">
                  <div>
                    First draft if set to repeat today:{' '}
                    <strong>{recurringInfo.nextOccurrence || 'None'}</strong>
                  </div>
                  <div>
                    Draft quotes due now: <strong>{recurringInfo.drafts.length}</strong>
                    {recurringInfo.drafts.length > 0 && (
                      <span className="text-[var(--muted)]">
                        {' '}({recurringInfo.drafts.map(d => `${d.dueDate} → next ${d.nextOccurrence}`).join('; ')})
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
