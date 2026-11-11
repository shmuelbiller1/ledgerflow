import React, { useEffect, useMemo, useState } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useUIStore } from '../../stores/useUIStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import {
  US_QUARTER_JOURNEY_CSV_HEADERS, usQuarterJourney, usQuarterJourneyCsvRows, usQuarterOf, usQuarterProblem,
  type UsQuarter, type UsQuarterStepStatus,
} from '../../lib/usQuarterJourney';
import type { ReadinessPayment, ReadinessVendor } from '../../lib/vendor1099Readiness';
import { downloadCsv } from '../../lib/csvExport';
import { monthCloseState } from '../../lib/periodLock';
import { getIdToken } from '../../firebase';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import ReportTableScroll from './ReportTableScroll';

const field = 'min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]';
const QUARTER_TEXT = /^\d{4}-Q[1-4]$/;
const STATUS_LABEL: Record<UsQuarterStepStatus, string> = {
  done: 'Done from the recorded data',
  attention: 'Needs attention',
  'not-applicable': 'Does not apply to this quarter',
};
const STATUS_TONE: Record<UsQuarterStepStatus, string> = {
  done: 'text-[var(--pos)]',
  attention: 'text-amber-700 dark:text-amber-400',
  'not-applicable': 'text-[var(--muted)]',
};

/** Only this workspace's rows; a row with no workspace id is a fixture or a shared record. */
const inWorkspace = <T extends { workspaceId?: string }>(rows: T[] | undefined, workspaceId?: string | null) =>
  (rows || []).filter(row => !workspaceId || !row.workspaceId || row.workspaceId === workspaceId);

/** The quarter that contains a date, written 2026-Q3. */
const quarterOfDate = (date: string) => {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return `${year}-Q${Math.floor((month - 1) / 3) + 1}`;
};

/**
 * A-153 (P2-4): the US quarter journey. Read-only: it shows what the recorded data says for one
 * quarter — sales tax by state, the return screens, the 1099 preview and closing the months — and
 * opens the screen that does each step. Nothing here files, posts, pays or closes anything.
 */
export default function UsQuarterJourneyReportView() {
  const invoices = useLedgerStore(state => state.invoices);
  const creditNotes = useLedgerStore(state => state.creditNotes);
  const bills = useLedgerStore(state => state.bills);
  const customers = useLedgerStore(state => state.customers);
  const vendors = useLedgerStore(state => state.vendors);
  const payments = useLedgerStore(state => state.payments);
  const inventory = useLedgerStore(state => state.inventory);
  const truncated = useLedgerStore(state => state.truncatedCollections);
  const failed = useDataNeedsStore(state => state.failed);
  const workspace = useAuthStore(state => state.getCurrentWorkspace());
  const workspaceId = useAuthStore(state => state.currentWorkspaceId);
  const { loading } = useLedgerCollections('invoices', 'creditNotes', 'bills', 'customers', 'vendors', 'payments', 'inventory');
  const [quarterText, setQuarterText] = useState(() => quarterOfDate(getLocalDateISO()));
  // the returns the server has recorded for this workspace, matched by registration and kind (F-08)
  const [filedPeriods, setFiledPeriods] = useState<Array<{ startDate: string; endDate: string; registration?: string; kind?: 'vat' | 'sales_tax' }> | null>(null);
  const currency = workspace?.currency || 'USD';
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        if (!workspaceId) { if (!cancelled) setFiledPeriods([]); return; }
        const res = await fetch(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/tax-returns`, {
          headers: { Authorization: `Bearer ${await getIdToken()}` },
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        setFiledPeriods(((data.returns || []) as Array<{ startDate?: string; endDate?: string; registration?: string; kind?: 'vat' | 'sales_tax' }>)
          .filter(r => typeof r.startDate === 'string' && typeof r.endDate === 'string')
          .map(r => ({
            startDate: r.startDate!,
            endDate: r.endDate!,
            ...(typeof r.registration === 'string' && r.registration ? { registration: r.registration } : {}),
            ...(r.kind === 'vat' || r.kind === 'sales_tax' ? { kind: r.kind } : {}),
          })));
      } catch { if (!cancelled) setFiledPeriods([]); }
    };
    void load();
    return () => { cancelled = true; };
  }, [workspaceId]);
  const partial = Boolean(truncated.invoices || truncated.bills || truncated.payments || truncated.vendors
    || failed.invoices || failed.bills || failed.payments || failed.vendors);

  const journey = useMemo(() => {
    if (!QUARTER_TEXT.test(quarterText) || !filedPeriods) return null;
    const months = usQuarterOf(quarterText)?.months || [];
    return usQuarterJourney({
      quarter: quarterText,
      today: getLocalDateISO(),
      currency,
      profiles: workspace?.taxProfiles,
      order: [workspace?.dimensions?.find(d => d.isWorld)?.id || 'world'],
      filedPeriods,
      periods: months.map(month => ({ month, state: monthCloseState(month, workspace) })),
      customers: inWorkspace(customers, workspaceId) as Array<{ id: string; metadata?: unknown }>,
      invoices: inWorkspace(invoices, workspaceId) as never,
      creditNotes: inWorkspace(creditNotes, workspaceId) as never,
      bills: inWorkspace(bills, workspaceId) as never,
      items: inWorkspace(inventory, workspaceId) as never,
      vendors: inWorkspace(vendors, workspaceId) as unknown as ReadinessVendor[],
      payments: inWorkspace(payments, workspaceId) as unknown as ReadinessPayment[],
    });
  }, [quarterText, currency, workspace, customers, workspaceId, invoices, creditNotes, bills, inventory, vendors, payments, filedPeriods]);

  return <UsQuarterJourneyPanel
    journey={journey}
    currency={currency}
    quarterText={quarterText}
    onQuarterChange={setQuarterText}
    loading={loading || !filedPeriods}
    partial={partial}
  />;
}

export function UsQuarterJourneyPanel({ journey, currency = 'USD', quarterText, onQuarterChange, loading = false, partial = false }: {
  journey: UsQuarter | null;
  currency?: string;
  quarterText: string;
  onQuarterChange: (value: string) => void;
  loading?: boolean;
  partial?: boolean;
}) {
  const goToPage = useUIStore(state => state.goToPage);
  const problem = usQuarterProblem(quarterText, getLocalDateISO());

  return <section aria-label="US quarter journey" className="p-4 space-y-4 min-w-0">
    <h2>US quarter journey</h2>
    <p className="text-sm text-[var(--muted)]">
      One path for a US quarter: sales tax by state, the return screens, the 1099 preview and closing
      the quarter&rsquo;s months. Each figure is the one the screen it names shows, so nothing is
      recalculated here. Read-only: nothing files, posts, pays or closes anything. The state assigns
      the filing frequency, the sourcing rules and the deadline, and this screen knows neither a
      holiday, a marketplace facilitator, a local return nor a transaction-count nexus test — the
      planning due date moves off a weekend only.
    </p>

    <div className="flex flex-wrap items-end gap-3" data-print-hide>
      <label className="flex flex-col gap-1 text-sm">Quarter
        <input aria-label="Quarter" className={field} value={quarterText} onChange={event => onQuarterChange(event.target.value)} placeholder="2026-Q3" />
      </label>
      <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]" disabled={!journey || loading}
        onClick={() => journey && downloadCsv(`us-quarter-journey-${journey.quarter}`, US_QUARTER_JOURNEY_CSV_HEADERS, usQuarterJourneyCsvRows(journey))}>Export CSV</button>
    </div>

    {problem && <p role="alert">{problem}</p>}
    {loading && <p role="status">Loading the quarter&rsquo;s documents and the returns recorded for it…</p>}
    {partial && <p role="alert">A loaded list is capped or failed, so the totals below are provisional until it is complete.</p>}
    {journey?.problems.map(item => <p key={item} role="alert">{item}</p>)}

    {journey && <p className="text-sm">
      <b>{journey.quarter}</b> ({journey.startDate} to {journey.endDate}) · {journey.done} of {journey.steps.length} steps done
      {journey.readyToClose
        ? ' · the quarter&rsquo;s recorded work is complete.'
        : journey.nextStep ? ` · next: ${journey.steps.find(s => s.id === journey.nextStep)?.title}.` : ''}
    </p>}

    {journey && <ol className="space-y-3">
      {journey.steps.map((step, index) => <li key={step.id} className="rounded border border-[var(--line)] p-3 space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-semibold text-sm">{index + 1}. {step.title}</h3>
          <span className={`text-sm font-medium ${STATUS_TONE[step.status]}`}>{STATUS_LABEL[step.status]}</span>
        </div>
        <p className="text-sm">{step.what}</p>
        <p className="text-sm text-[var(--muted)]">{step.detail}</p>
        {step.figures.length > 0 && <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {step.figures.map(figure => <li key={`${step.id}-${figure.label}`} className="tabular-nums">
            <span className="text-[var(--muted)]">{figure.label}: </span>
            <b>{figure.cents !== undefined ? formatCurrency(figure.cents, currency) : figure.count}</b>
            {figure.note ? <span className="text-[var(--muted)]"> ({figure.note})</span> : null}
          </li>)}
        </ul>}
        {step.returns.length > 0 && <StateReturnTable returns={step.returns} currency={currency} />}
        <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)] text-sm"
          onClick={() => goToPage({ tab: step.tab, sub: step.screen })}>Open {step.screenLabel}</button>
      </li>)}
    </ol>}
  </section>;
}

function StateReturnTable({ returns, currency }: { returns: UsQuarter['steps'][number]['returns']; currency: string }) {
  return <ReportTableScroll>
    <table className="w-full text-sm">
      <caption className="text-left font-semibold text-[var(--text)] pb-1">The state returns of the quarter, as the return screen computes them</caption>
      <thead><tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
        {['Permit', 'Documents', 'Gross', 'Exempt', 'Taxable', 'Tax collected', 'By jurisdiction', 'Planning due date', 'Recorded as filed'].map(head =>
          <th key={head} scope="col" className="text-left py-1 px-2">{head}</th>)}
      </tr></thead>
      <tbody>
        {returns.map(r => <tr key={r.registration} className="border-b border-[var(--line)]/50">
          <th scope="row" className="text-left font-normal py-1 px-2">{r.state} {r.permitNumber}<div className="text-xs text-[var(--muted)]">{r.stateName}</div></th>
          <td className="py-1 px-2 tabular-nums">{r.documentCount}</td>
          <td className="py-1 px-2 tabular-nums whitespace-nowrap">{formatCurrency(r.grossSalesCents, currency)}</td>
          <td className="py-1 px-2 tabular-nums whitespace-nowrap">{formatCurrency(r.exemptSalesCents, currency)}</td>
          <td className="py-1 px-2 tabular-nums whitespace-nowrap">{formatCurrency(r.taxableSalesCents, currency)}</td>
          <td className="py-1 px-2 tabular-nums whitespace-nowrap">{formatCurrency(r.taxCollectedCents, currency)}</td>
          <td className="py-1 px-2">{r.byJurisdiction.map(part => `${part.name} ${formatCurrency(part.taxCents, currency)}`).join(', ') || '—'}</td>
          <td className="py-1 px-2 whitespace-nowrap">{r.dueDate || 'not in the planning calendar'}{r.dueNote ? <div className="text-xs text-[var(--muted)]">{r.dueNote}</div> : null}</td>
          <td className="py-1 px-2">{r.filed ? 'Yes' : r.recordedForDates ? 'Period record only (not per state)' : 'Not recorded here'}</td>
        </tr>)}
      </tbody>
    </table>
  </ReportTableScroll>;
}
