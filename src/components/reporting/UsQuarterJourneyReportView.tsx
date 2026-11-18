import React, { useEffect, useMemo, useState } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useUIStore } from '../../stores/useUIStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import {
  US_QUARTER_JOURNEY_CSV_HEADERS, usQuarterJourney, usQuarterJourneyCsvRows, usQuarterOf, usQuarterProblem,
  type UsQuarter,
} from '../../lib/usQuarterJourney';
import type { ReadinessPayment, ReadinessVendor } from '../../lib/vendor1099Readiness';
import { downloadCsv } from '../../lib/csvExport';
import { monthCloseState } from '../../lib/periodLock';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import ReportTableScroll from './ReportTableScroll';
import { JourneyNotices, JourneySteps } from './JourneySteps';
import { stepStatusLabel } from './journeyStatus';
import { runCommand, type CommandBody } from '../../lib/runCommand';
import { RowTable } from '../ui/RowTable';
import { useReportText, fill } from './useReportText';

/** Code names, form numbers, paths and identifiers shown as-is: they are not words to translate (EU-G1). */
const CODE_NAMES = { c0: '2026-Q3' } as const;



const field = 'min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]';
const QUARTER_TEXT = /^\d{4}-Q[1-4]$/;
const STATUS_LABEL = stepStatusLabel('quarter');

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
        const data = await runCommand<CommandBody>({ path: `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/tax-returns` }) ?? {};
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
  const reportText = useReportText();
  const goToPage = useUIStore(state => state.goToPage);
  const problem = usQuarterProblem(quarterText, getLocalDateISO());

  return <section aria-label={reportText('r.us-quarter-journey', 'US quarter journey')} className="p-4 space-y-4 min-w-0">
    <h2>{reportText('r.us-quarter-journey', 'US quarter journey')}</h2>
    <p className="text-sm text-[var(--muted)]">
      {reportText('r.one-path-for-a-us-quarter-sales-tax-by-state-the', 'One path for a US quarter: sales tax by state, the return screens, the 1099 preview and closing the quarter’s months. Each figure is the one the screen it names shows, so nothing is recalculated here. Read-only: nothing files, posts, pays or closes anything. The state assigns the filing frequency, the sourcing rules and the deadline, and this screen knows neither a holiday, a marketplace facilitator, a local return nor a transaction-count nexus test — the planning due date moves off a weekend only.')}
    </p>

    <div className="flex flex-wrap items-end gap-3" data-print-hide>
      <label className="flex flex-col gap-1 text-sm">{reportText('r.quarter', 'Quarter')}
        <input aria-label={reportText('r.quarter', 'Quarter')} className={field} value={quarterText} onChange={event => onQuarterChange(event.target.value)} placeholder={CODE_NAMES.c0} />
      </label>
      <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]" disabled={!journey || loading}
        onClick={() => journey && downloadCsv(`us-quarter-journey-${journey.quarter}`, US_QUARTER_JOURNEY_CSV_HEADERS, usQuarterJourneyCsvRows(journey))}>{reportText('r.export-csv', 'Export CSV')}</button>
    </div>

    <JourneyNotices problem={problem} loading={loading} partial={partial} problems={journey?.problems}
      loadingText="Loading the quarter&rsquo;s documents and the returns recorded for it…" />

    {journey && <p className="text-sm">
      <b>{journey.quarter}</b> ({journey.startDate} {reportText('r.to-2', 'to')} {journey.endDate}) · {journey.done} {reportText('r.of', 'of')} {journey.steps.length} {reportText('r.steps-done', 'steps done')}
      {journey.readyToClose
        ? ` ${reportText('r.quarter-work-complete', '· the quarter’s recorded work is complete.')}`
        : journey.nextStep ? ` ${fill(reportText('r.next-0', '· next: {0}.'), { 0: journey.steps.find(s => s.id === journey.nextStep)?.title ?? '' })}` : ''}
    </p>}

    {journey && <JourneySteps steps={journey.steps} currency={currency} formatCurrency={formatCurrency} statusLabel={STATUS_LABEL}
      afterFigures={step => step.returns.length > 0 ? <StateReturnTable returns={step.returns} currency={currency} /> : null}
      openScreen={step => <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)] text-sm"
        onClick={() => goToPage({ tab: step.tab, sub: step.screen })}>{reportText('r.open', 'Open')} {step.screenLabel}</button>} />}
  </section>;
}

function StateReturnTable({ returns, currency }: { returns: UsQuarter['steps'][number]['returns']; currency: string }) {
  const reportText = useReportText();
  return <ReportTableScroll>
    <RowTable
      rowClassName="border-b border-[var(--line)]/50"
      caption={(<>{reportText('r.the-state-returns-of-the-quarter-as-the-return-s', 'The state returns of the quarter, as the return screen computes them')}</>)}
      rows={returns}
      rowKey={r => r.registration}
      captionClassName="text-left font-semibold text-[var(--text)] pb-1"
      tableClassName="w-full text-sm"
      headRowClassName="border-b border-[var(--line)] text-xs text-[var(--muted)]"
      bodyClassName=""
      columns={[
        { header: reportText('r.permit', 'Permit'), className: "text-left font-normal py-1 px-2", headClassName: "text-left py-1 px-2", cell: (r) => (<>{r.state} {r.permitNumber}<div className="text-xs text-[var(--muted)]">{r.stateName}</div></>) },
        { header: reportText('r.documents-heading', 'Documents'), className: "py-1 px-2 tabular-nums", headClassName: "text-left py-1 px-2", cell: (r) => r.documentCount },
        { header: reportText('r.gross', 'Gross'), className: "py-1 px-2 tabular-nums whitespace-nowrap", headClassName: "text-left py-1 px-2", cell: (r) => formatCurrency(r.grossSalesCents, currency) },
        { header: reportText('r.exempt', 'Exempt'), className: "py-1 px-2 tabular-nums whitespace-nowrap", headClassName: "text-left py-1 px-2", cell: (r) => formatCurrency(r.exemptSalesCents, currency) },
        { header: reportText('r.taxable', 'Taxable'), className: "py-1 px-2 tabular-nums whitespace-nowrap", headClassName: "text-left py-1 px-2", cell: (r) => formatCurrency(r.taxableSalesCents, currency) },
        { header: reportText('r.tax-collected', 'Tax collected'), className: "py-1 px-2 tabular-nums whitespace-nowrap", headClassName: "text-left py-1 px-2", cell: (r) => formatCurrency(r.taxCollectedCents, currency) },
        { header: reportText('r.by-jurisdiction', 'By jurisdiction'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (r) => r.byJurisdiction.map(part => `${part.name} ${formatCurrency(part.taxCents, currency)}`).join(', ') || '—' },
        { header: reportText('r.planning-due-date', 'Planning due date'), className: "py-1 px-2 whitespace-nowrap", headClassName: "text-left py-1 px-2", cell: (r) => (<>{r.dueDate || reportText('r.not-in-the-planning-calendar', 'not in the planning calendar')}{r.dueNote ? <div className="text-xs text-[var(--muted)]">{r.dueNote}</div> : null}</>) },
        { header: reportText('r.recorded-as-filed', 'Recorded as filed'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (r) => r.filed ? 'Yes' : r.recordedForDates ? 'Period record only (not per state)' : 'Not recorded here' },
      ]}
    />
  </ReportTableScroll>;
}
