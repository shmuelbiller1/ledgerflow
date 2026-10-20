import React, { useEffect, useMemo, useState } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useUIStore } from '../../stores/useUIStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import {
  IL_MONTH_JOURNEY_CSV_HEADERS, israelMonthJourney, ilMonthJourneyCsvRows, israelMonthOf, israelMonthProblem,
  ilPcn874Preview, ilReturnForDealer, type IlJourneyDocument, type IlJourneyParty, type IlMonthStepStatus, type IsraelMonth,
} from '../../lib/israelMonthJourney';
import { downloadCsv } from '../../lib/csvExport';
import { monthCloseState } from '../../lib/periodLock';
import { getIdToken } from '../../firebase';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import ReportTableScroll from './ReportTableScroll';

const field = 'min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]';
const MONTH_TEXT = /^\d{4}-\d{2}$/;
const STATUS_LABEL: Record<IlMonthStepStatus, string> = {
  done: 'Done from the recorded data',
  attention: 'Needs attention',
  'not-applicable': 'Does not apply to this month',
};
const STATUS_TONE: Record<IlMonthStepStatus, string> = {
  done: 'text-[var(--pos)]',
  attention: 'text-amber-700 dark:text-amber-400',
  'not-applicable': 'text-[var(--muted)]',
};

/** Only this workspace's rows; a row with no workspace id is a fixture or a shared record. */
const inWorkspace = <T extends { workspaceId?: string }>(rows: T[] | undefined, workspaceId?: string | null) =>
  (rows || []).filter(row => !workspaceId || !row.workspaceId || row.workspaceId === workspaceId);

/** The month before a date, written 2026-09: the month a business files just after it ends. */
const previousMonthOf = (date: string) => {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
};

/**
 * A-152 (P2-3): the Israeli month journey. Read-only: it shows what the recorded data says for one
 * month — the VAT registration, the allocation numbers the month's business invoices need, the
 * periodic VAT report figures, the historical PCN874 draft and closing the month — and opens the
 * screen that does each step. Nothing here files, posts, pays or closes anything.
 */
export default function IsraelMonthJourneyReportView() {
  const invoices = useLedgerStore(state => state.invoices);
  const creditNotes = useLedgerStore(state => state.creditNotes);
  const bills = useLedgerStore(state => state.bills);
  const vendorCredits = useLedgerStore(state => state.vendorCredits);
  const customers = useLedgerStore(state => state.customers);
  const vendors = useLedgerStore(state => state.vendors);
  const truncated = useLedgerStore(state => state.truncatedCollections);
  const failed = useDataNeedsStore(state => state.failed);
  const workspace = useAuthStore(state => state.getCurrentWorkspace());
  const workspaceId = useAuthStore(state => state.currentWorkspaceId);
  const { loading } = useLedgerCollections('invoices', 'creditNotes', 'bills', 'vendorCredits', 'customers', 'vendors');
  const [monthText, setMonthText] = useState(() => previousMonthOf(getLocalDateISO()));
  const [typedDealerId, setTypedDealerId] = useState<string | null>(null);
  // the returns the server has recorded for this workspace, so "recorded as filed" is a fact, not a guess
  const [filedPeriods, setFiledPeriods] = useState<Array<{ startDate: string; endDate: string }> | null>(null);
  const currency = workspace?.currency || 'ILS';
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
        setFiledPeriods(((data.returns || []) as Array<{ startDate?: string; endDate?: string }>)
          .filter(r => typeof r.startDate === 'string' && typeof r.endDate === 'string')
          .map(r => ({ startDate: r.startDate!, endDate: r.endDate! })));
      } catch { if (!cancelled) setFiledPeriods([]); }
    };
    void load();
    return () => { cancelled = true; };
  }, [workspaceId]);
  const partial = Boolean(truncated.invoices || truncated.bills || truncated.creditNotes
    || failed.invoices || failed.bills || failed.creditNotes || failed.customers || failed.vendors);

  const journey = useMemo(() => {
    if (!MONTH_TEXT.test(monthText) || !filedPeriods) return null;
    const month = israelMonthOf(monthText)?.month || monthText;
    return israelMonthJourney({
      month,
      today: getLocalDateISO(),
      currency,
      profiles: workspace?.taxProfiles,
      order: [workspace?.dimensions?.find(d => d.isWorld)?.id || 'world'],
      filedPeriods,
      periods: [{ month, state: monthCloseState(month, workspace) }],
      customers: inWorkspace(customers, workspaceId) as IlJourneyParty[],
      vendors: inWorkspace(vendors, workspaceId) as IlJourneyParty[],
      invoices: inWorkspace(invoices, workspaceId) as IlJourneyDocument[],
      creditNotes: inWorkspace(creditNotes, workspaceId) as IlJourneyDocument[],
      bills: inWorkspace(bills, workspaceId) as IlJourneyDocument[],
      vendorCredits: inWorkspace(vendorCredits, workspaceId) as IlJourneyDocument[],
    });
  }, [monthText, currency, workspace, customers, vendors, workspaceId, invoices, creditNotes, bills, vendorCredits, filedPeriods]);

  const suggestedDealerId = useMemo(() => {
    const registration = journey?.steps.find(s => s.id === 'vat-report')?.returns[0]?.registration || '';
    return (registration.split(':').pop() || '').replace(/\D/g, '').slice(0, 9);
  }, [journey]);
  const dealerId = typedDealerId ?? suggestedDealerId;

  const preview = useMemo(() => {
    if (!MONTH_TEXT.test(monthText)) return null;
    const month = israelMonthOf(monthText)?.month || monthText;
    // CON-4: the draft covers the report period of the registration whose dealer number is typed
    const returns = journey?.steps.find(s => s.id === 'vat-report')?.returns || [];
    const own = ilReturnForDealer(returns, dealerId);
    const period = own ? { startMonth: own.startMonth, endMonth: own.endMonth } : journey?.pcn874Period || { startMonth: month, endMonth: month };
    return ilPcn874Preview({
      month: period.startMonth,
      endMonth: period.endMonth,
      ...(own ? { registration: own.registration, profiles: workspace?.taxProfiles, order: [workspace?.dimensions?.find(d => d.isWorld)?.id || 'world'] } : {}),
      generatedOn: getLocalDateISO(),
      currency,
      dealerId,
      customers: inWorkspace(customers, workspaceId) as IlJourneyParty[],
      vendors: inWorkspace(vendors, workspaceId) as IlJourneyParty[],
      invoices: inWorkspace(invoices, workspaceId) as IlJourneyDocument[],
      creditNotes: inWorkspace(creditNotes, workspaceId) as IlJourneyDocument[],
      bills: inWorkspace(bills, workspaceId) as IlJourneyDocument[],
      vendorCredits: inWorkspace(vendorCredits, workspaceId) as IlJourneyDocument[],
      returns: own ? [own] : returns,
    });
  }, [monthText, currency, dealerId, journey, workspace, customers, vendors, workspaceId, invoices, creditNotes, bills, vendorCredits]);

  return <IsraelMonthJourneyPanel
    journey={journey}
    preview={preview}
    currency={currency}
    monthText={monthText}
    onMonthChange={setMonthText}
    dealerId={dealerId}
    onDealerIdChange={setTypedDealerId}
    loading={loading || !filedPeriods}
    partial={partial}
  />;
}

/** Download plain text (the fixed-width PCN874 draft) without a server round trip. */
function downloadText(name: string, text: string) {
  if (typeof URL === 'undefined' || typeof document === 'undefined') return;
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function IsraelMonthJourneyPanel({ journey, preview, currency = 'ILS', monthText, onMonthChange, dealerId, onDealerIdChange, loading = false, partial = false }: {
  journey: IsraelMonth | null;
  preview: ReturnType<typeof ilPcn874Preview> | null;
  currency?: string;
  monthText: string;
  onMonthChange: (value: string) => void;
  dealerId: string;
  onDealerIdChange: (value: string) => void;
  loading?: boolean;
  partial?: boolean;
}) {
  const goToPage = useUIStore(state => state.goToPage);
  const problem = israelMonthProblem(monthText, getLocalDateISO());

  return <section aria-label="Israel month journey" className="p-4 space-y-4 min-w-0">
    <h2>Israel month journey</h2>
    <p className="text-sm text-[var(--muted)]">
      One path for an Israeli VAT month: the registration, the allocation numbers on business
      invoices, the periodic VAT report (form 836 figures), the historical PCN874 draft and closing
      the month. Each money figure is the one the screen it names shows, so nothing is recalculated
      here. Read-only: nothing files, posts, pays or closes anything. The Tax Authority assigns the
      frequency and the deadline, and the PCN874 draft uses a historical Appendix A layout that is
      not verified for current filing.
    </p>

    <div className="flex flex-wrap items-end gap-3" data-print-hide>
      <label className="flex flex-col gap-1 text-sm">Month
        <input aria-label="Month" className={field} value={monthText} onChange={event => onMonthChange(event.target.value)} placeholder="2026-09" />
      </label>
      <label className="flex flex-col gap-1 text-sm">Dealer number (9 digits)
        <input aria-label="Dealer number (9 digits)" inputMode="numeric" maxLength={9} className={field} value={dealerId}
          onChange={event => onDealerIdChange(event.target.value.replace(/\D/g, '').slice(0, 9))} placeholder="514000000" />
      </label>
      <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]" disabled={!journey || loading}
        onClick={() => journey && downloadCsv(`israel-month-journey-${journey.month}`, IL_MONTH_JOURNEY_CSV_HEADERS, ilMonthJourneyCsvRows(journey))}>Export CSV</button>
      <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]" disabled={!preview?.draft}
        onClick={() => preview?.draft && downloadText(`pcn874-${preview.startMonth === preview.endMonth ? preview.startMonth : `${preview.startMonth}-to-${preview.endMonth}`}-draft.txt`, preview.draft.text)}>Download PCN874 draft</button>
    </div>

    {problem && <p role="alert">{problem}</p>}
    {loading && <p role="status">Loading the month&rsquo;s documents and the returns recorded for it…</p>}
    {partial && <p role="alert">A loaded list is capped or failed, so the totals below are provisional until it is complete.</p>}
    {journey?.problems.map(item => <p key={item} role="alert">{item}</p>)}

    {journey && <p className="text-sm">
      <b>{journey.month}</b> ({journey.startDate} to {journey.endDate}) · {journey.done} of {journey.steps.length} steps done
      {journey.readyToClose
        ? ' · the month’s recorded work is complete here.'
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
        {step.returns.length > 0 && <VatReturnTable returns={step.returns} currency={currency} />}
        {step.allocation.length > 0 && <AllocationTable cases={step.allocation} currency={currency} />}
        {step.id === 'pcn874'
          ? <p className="text-sm text-[var(--muted)]">The draft, every document that cannot be written and the comparison with the report are below.</p>
          : <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)] text-sm"
            onClick={() => goToPage({ tab: step.tab, sub: step.screen })}>Open {step.screenLabel}</button>}
      </li>)}
    </ol>}

    {preview && <section aria-labelledby="pcn874-preview" className="rounded border border-[var(--line)] p-3 space-y-2">
      <h3 id="pcn874-preview" className="font-semibold text-sm">PCN874 historical draft</h3>
      <p className="text-sm text-[var(--muted)]">
        The fixed-width Appendix A layout, built from the documents of {preview.startMonth === preview.endMonth ? preview.startMonth : `the bimonthly report ${preview.startMonth} to ${preview.endMonth} (the header carries its first month, not verified for the current layout)`} in shekels: {preview.rows.length} row(s).
        It is <b>not filing-ready</b>: the layout dates to 2010, and current validation, document
        classification, allocation-number rules and Tax Authority acceptance must be verified
        independently. Nothing is submitted from this screen.
      </p>
      {preview.problem && <p role="status" className="text-sm text-amber-700 dark:text-amber-400">{preview.problem}</p>}
      {preview.unmapped.length > 0 && <ReportTableScroll>
        <table className="w-full text-sm">
          <caption className="text-left font-semibold text-[var(--text)] pb-1">Documents that cannot be written in this historical layout</caption>
          <thead><tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
            {['Document', 'Kind', 'Number', 'Why it cannot be written'].map(head => <th key={head} scope="col" className="text-left py-1 px-2">{head}</th>)}
          </tr></thead>
          <tbody>
            {preview.unmapped.map(row => <tr key={`${row.kind}:${row.documentId}`} className="border-b border-[var(--line)]/50">
              <th scope="row" className="text-left font-normal py-1 px-2">{row.documentId}</th>
              <td className="py-1 px-2">{row.kind}</td>
              <td className="py-1 px-2">{row.number || '—'}</td>
              <td className="py-1 px-2">{row.reason}</td>
            </tr>)}
          </tbody>
        </table>
      </ReportTableScroll>}
      {preview.comparison.some(row => row.differenceNis !== 0) && <>
        <p className="text-sm">The draft’s whole-shekel totals differ from the VAT report; the difference is shown, never smoothed away. Per-document rounding to whole shekels can explain one shekel per row.</p>
        <ReportTableScroll>
          <table className="w-full text-sm">
            <caption className="text-left font-semibold text-[var(--text)] pb-1">The draft beside the VAT report</caption>
            <thead><tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
              {['Figure', 'Draft (NIS)', 'VAT report (NIS)', 'Difference (NIS)'].map(head => <th key={head} scope="col" className="text-left py-1 px-2">{head}</th>)}
            </tr></thead>
            <tbody>
              {preview.comparison.map(row => <tr key={row.label} className="border-b border-[var(--line)]/50">
                <th scope="row" className="text-left font-normal py-1 px-2">{row.label}</th>
                <td className="py-1 px-2 tabular-nums">{row.draftNis.toLocaleString('en-US')}</td>
                <td className="py-1 px-2 tabular-nums">{row.returnNis.toLocaleString('en-US')}</td>
                <td className="py-1 px-2 tabular-nums">{row.differenceNis.toLocaleString('en-US')}</td>
              </tr>)}
            </tbody>
          </table>
        </ReportTableScroll>
      </>}
      {preview.draft && <p className="text-sm">
        Header {preview.draft.header.length} characters, {preview.draft.transactions.length} transaction row(s) of 60, closing {preview.draft.closing.length}. Downloading saves the text; it does not file it.
      </p>}
    </section>}
  </section>;
}

function VatReturnTable({ returns, currency }: { returns: IsraelMonth['steps'][number]['returns']; currency: string }) {
  return <ReportTableScroll>
    <table className="w-full text-sm">
      <caption className="text-left font-semibold text-[var(--text)] pb-1">The VAT report each registration files for this month (its own monthly or two-month period), as the return screen computes it</caption>
      <thead><tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
        {['Registration', 'Documents', 'Taxable sales', 'Output VAT', 'Zero-rated', 'Input VAT, other', 'Input VAT, equipment', 'To pay / reclaim', 'Due date', 'Recorded as filed'].map(head =>
          <th key={head} scope="col" className="text-left py-1 px-2">{head}</th>)}
      </tr></thead>
      <tbody>
        {returns.map(r => <tr key={r.registration} className="border-b border-[var(--line)]/50">
          <th scope="row" className="text-left font-normal py-1 px-2"><span className="block">{r.registration.split(':').pop()}</span><span className="block text-xs text-[var(--muted)]">{r.startMonth === r.endMonth ? r.startMonth : `${r.startMonth} to ${r.endMonth}`}</span></th>
          <td className="py-1 px-2 tabular-nums">{r.documentCount}</td>
          <td className="py-1 px-2 tabular-nums whitespace-nowrap">{formatCurrency(r.taxableSalesCents, currency)}</td>
          <td className="py-1 px-2 tabular-nums whitespace-nowrap">{formatCurrency(r.outputVatCents, currency)}</td>
          <td className="py-1 px-2 tabular-nums whitespace-nowrap">{formatCurrency(r.zeroRatedSalesCents, currency)}</td>
          <td className="py-1 px-2 tabular-nums whitespace-nowrap">{formatCurrency(r.otherInputVatCents, currency)}</td>
          <td className="py-1 px-2 tabular-nums whitespace-nowrap">{formatCurrency(r.fixedAssetInputVatCents, currency)}</td>
          <td className="py-1 px-2 tabular-nums whitespace-nowrap">{formatCurrency(Math.abs(r.toPayCents), currency)}{r.toPayCents < 0 ? ' (reclaim)' : ''}</td>
          <td className="py-1 px-2 whitespace-nowrap">{r.dueDate || (r.filing ? `${r.filing} report` : 'not stated')}</td>
          <td className="py-1 px-2">{r.filed ? 'Yes' : 'Not recorded here'}</td>
        </tr>)}
      </tbody>
    </table>
  </ReportTableScroll>;
}

function AllocationTable({ cases, currency }: { cases: IsraelMonth['steps'][number]['allocation']; currency: string }) {
  return <ReportTableScroll>
    <table className="w-full text-sm">
      <caption className="text-left font-semibold text-[var(--text)] pb-1">Invoices that need an allocation number</caption>
      <thead><tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
        {['Invoice', 'Customer', 'Date', 'Before VAT', 'Threshold', 'Recorded number', 'What to do'].map(head =>
          <th key={head} scope="col" className="text-left py-1 px-2">{head}</th>)}
      </tr></thead>
      <tbody>
        {cases.map(c => <tr key={c.invoiceId} className="border-b border-[var(--line)]/50">
          <th scope="row" className="text-left font-normal py-1 px-2">{c.number || c.invoiceId}</th>
          <td className="py-1 px-2">{c.customerName || '—'}</td>
          <td className="py-1 px-2 whitespace-nowrap">{c.date}</td>
          <td className="py-1 px-2 tabular-nums whitespace-nowrap">{formatCurrency(c.netCents, currency)}</td>
          <td className="py-1 px-2 tabular-nums whitespace-nowrap">{formatCurrency(c.thresholdCents, currency)}</td>
          <td className="py-1 px-2">{c.recorded || 'none'}</td>
          <td className="py-1 px-2">{c.problem || 'Recorded and 9 digits.'}</td>
        </tr>)}
      </tbody>
    </table>
  </ReportTableScroll>;
}
