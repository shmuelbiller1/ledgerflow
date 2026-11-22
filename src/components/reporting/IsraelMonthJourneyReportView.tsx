import React, { useEffect, useMemo, useState } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useUIStore } from '../../stores/useUIStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import {
  IL_MONTH_JOURNEY_CSV_HEADERS, israelMonthJourney, ilMonthJourneyCsvRows, israelMonthOf, israelMonthProblem,
  ilPcn874Preview, ilReturnForDealer, type IlJourneyDocument, type IlJourneyParty, type IsraelMonth,
} from '../../lib/israelMonthJourney';
import { downloadCsv } from '../../lib/csvExport';
import { monthCloseState, workspaceRole } from '../../lib/periodLock';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import ReportTableScroll from './ReportTableScroll';
import { runCommand } from '../../lib/runCommand';
import { RowTable } from '../ui/RowTable';
import { JourneyNotices, JourneySteps } from './JourneySteps';
import { stepStatusLabel } from './journeyStatus';
import { PCN874_DRAFT_CLOSING_WIDTH, PCN874_DRAFT_HEADER_WIDTH, PCN874_DRAFT_TRANSACTION_WIDTH } from '../../lib/tax/pcn874Draft';
import { useReportText, fill } from './useReportText';
import { FilledChangesCell } from './filedChangesCell';

const field = 'min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]';
const MONTH_TEXT = /^\d{4}-\d{2}$/;

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
  // ISS-160: which bills are equipment comes from the accounts they are posted to
  const accounts = useLedgerStore(state => state.accounts);
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
  const [filedPeriods, setFiledPeriods] = useState<Array<{ startDate: string; endDate: string; registration?: string; boxes?: Array<{ key: string; label: string; cents: number }> }> | null>(null);
  const [filedLoadFailed, setFiledLoadFailed] = useState(false);
  const [filedReload, setFiledReload] = useState(0);
  const currency = workspace?.currency || 'ILS';
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        if (!workspaceId) { if (!cancelled) { setFiledPeriods([]); setFiledLoadFailed(false); } return; }
        // a failure is shown as "filed returns could not be read", which is a flag rather than an exception
        const data = await runCommand<{ returns?: unknown }>({
          path: `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/tax-returns`,
        }).catch(() => null);
        if (cancelled) return;
        if (!data) {
          setFiledLoadFailed(true);
          setFiledPeriods([]);
          return;
        }
        setFiledLoadFailed(false);
        setFiledPeriods(((data.returns || []) as Array<{ startDate?: string; endDate?: string; registration?: string; boxes?: Array<{ key: string; label: string; cents: number }> }>)
          .filter(r => typeof r.startDate === 'string' && typeof r.endDate === 'string')
          .map(r => ({
            startDate: r.startDate!, endDate: r.endDate!,
            ...(typeof r.registration === 'string' ? { registration: r.registration } : {}),
            // T-08: the copy's figures, so the journey can show what changed since filing
            ...(Array.isArray(r.boxes) && r.boxes.length > 0 ? { boxes: r.boxes } : {}),
          })));
      } catch {
        if (!cancelled) {
          setFiledLoadFailed(true);
          setFiledPeriods([]);
        }
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [workspaceId, filedReload]);

  // CON-4b: an owner or accountant records one registration's return as filed (the server keeps a copy of its figures)
  const user = useAuthStore(state => state.user);
  const canFile = Boolean(user && workspace && ['owner', 'accountant'].includes(workspaceRole(workspace as never, user.uid)));
  const recordFiled = async (r: { registration: string; startDate: string; endDate: string }) => {
    const asked = workspaceId;
    await runCommand<{ message?: string }>({
      path: `/api/v1/workspaces/${encodeURIComponent(workspaceId || '')}/tax-returns`,
      method: 'POST',
      body: { startDate: r.startDate, endDate: r.endDate, registration: r.registration },
    });
    if (useAuthStore.getState().currentWorkspaceId === asked) setFiledReload(n => n + 1);
  };
  const partial = Boolean(
    truncated.invoices || truncated.bills || truncated.creditNotes || truncated.vendorCredits
    || truncated.customers || truncated.vendors || truncated.chartAccounts
    || failed.invoices || failed.bills || failed.creditNotes || failed.vendorCredits
    || failed.customers || failed.vendors || failed.accounts || filedLoadFailed,
  );

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
      // T-08: nothing is compared with a filed copy while the document data is incomplete
      partial,
      periods: [{ month, state: monthCloseState(month, workspace) }],
      customers: inWorkspace(customers, workspaceId) as IlJourneyParty[],
      vendors: inWorkspace(vendors, workspaceId) as IlJourneyParty[],
      invoices: inWorkspace(invoices, workspaceId) as IlJourneyDocument[],
      creditNotes: inWorkspace(creditNotes, workspaceId) as IlJourneyDocument[],
      bills: inWorkspace(bills, workspaceId) as IlJourneyDocument[],
      vendorCredits: inWorkspace(vendorCredits, workspaceId) as IlJourneyDocument[],
      accounts,
    });
  }, [monthText, currency, workspace, customers, vendors, workspaceId, invoices, creditNotes, bills, vendorCredits, filedPeriods, accounts, partial]);

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
      ...(!own && returns.length ? { dealerUnknown: true } : {}),
      ...(own?.pending ? { pendingUntil: own.endMonth } : {}),
      generatedOn: getLocalDateISO(),
      currency,
      dealerId,
      customers: inWorkspace(customers, workspaceId) as IlJourneyParty[],
      vendors: inWorkspace(vendors, workspaceId) as IlJourneyParty[],
      invoices: inWorkspace(invoices, workspaceId) as IlJourneyDocument[],
      creditNotes: inWorkspace(creditNotes, workspaceId) as IlJourneyDocument[],
      bills: inWorkspace(bills, workspaceId) as IlJourneyDocument[],
      vendorCredits: inWorkspace(vendorCredits, workspaceId) as IlJourneyDocument[],
      accounts,
      returns: own ? [own] : returns,
    });
  }, [monthText, currency, dealerId, journey, workspace, customers, vendors, workspaceId, invoices, creditNotes, bills, vendorCredits, accounts]);

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
    {...(canFile ? { onRecordFiled: recordFiled } : {})}
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

/**
 * E-55: PCN874 validation screen. Verifies the historical fixed-width draft before any download:
 * the transaction/detail record layout (header 131, each detail row 60, closing 10) and the
 * totals/reconciliation check (draft NIS beside the VAT report NIS). Read-only: it never files.
 * The detailed draft, unmapped list and comparison stay in the section below; this view is the
 * step's own check, with its own captions so the two never share an accessible name.
 */
export function PCN874ValidationView({ preview }: { preview: ReturnType<typeof ilPcn874Preview> | null }) {
  const reportText = useReportText();
  if (!preview) return <p className="text-sm text-[var(--muted)]">{reportText('r.no-pcn874-preview-for-this-month', 'No PCN874 preview is available for this month.')}</p>;
  const draft = preview.draft;
  const pass = reportText('r.pass', 'Pass');
  const fail = reportText('r.fail', 'Fail');
  const notBuilt = reportText('r.not-built', 'Not built');
  const noDraftText = reportText('r.no-draft-text-built', 'No draft text built');
  const countCharacters = (count: number) => fill(reportText('r.count-characters', '{count} characters'), { count });
  const check = (name: string, expected: string, actual: string, valid: boolean) => ({
    check: name, expected, actual,
    result: draft ? (valid ? pass : fail) : notBuilt,
  });
  const fixedWidthCheck = (name: string, width: number, actualLength?: number) => check(
    name,
    countCharacters(width),
    actualLength === undefined ? noDraftText : countCharacters(actualLength),
    actualLength === width,
  );
  const transactionsFit = draft?.transactions.every(row => row.length === PCN874_DRAFT_TRANSACTION_WIDTH) ?? false;
  const layoutChecks = [
    fixedWidthCheck(reportText('r.header-record', 'Header record'), PCN874_DRAFT_HEADER_WIDTH, draft?.header.length),
    check(
      reportText('r.transaction-detail-records', 'Transaction/detail records'),
      draft
        ? fill(reportText('r.rows-of-width', '{count} row(s) of {width}'), { count: draft.transactions.length, width: PCN874_DRAFT_TRANSACTION_WIDTH })
        : fill(reportText('r.count-characters-each', '{count} characters each'), { count: PCN874_DRAFT_TRANSACTION_WIDTH }),
      draft
        ? transactionsFit
          ? fill(reportText('r.all-rows-characters', 'All rows {width} characters'), { width: PCN874_DRAFT_TRANSACTION_WIDTH })
          : fill(reportText('r.a-row-is-not-characters', 'A row is not {width} characters'), { width: PCN874_DRAFT_TRANSACTION_WIDTH })
        : noDraftText,
      transactionsFit,
    ),
    fixedWidthCheck(reportText('r.closing-record', 'Closing record'), PCN874_DRAFT_CLOSING_WIDTH, draft?.closing.length),
    {
      check: reportText('r.mapped-documents', 'Mapped documents'),
      expected: reportText('r.every-document-written', 'Every document written'),
      actual: fill(reportText('r.rows-written', '{count} row(s) written'), { count: preview.rows.length }),
      result: preview.unmapped.length === 0 ? pass : fill(reportText('r.count-cannot-be-written', '{count} cannot be written'), { count: preview.unmapped.length }),
    },
  ];
  type LayoutCheck = (typeof layoutChecks)[number];
  type Comparison = (typeof preview.comparison)[number];
  const firstColumn = <T,>(header: string, cell: (row: T) => React.ReactNode) => ({
    header, className: 'text-left font-normal py-1 px-2', headClassName: 'text-left py-1 px-2', cell,
  });
  const dataColumn = <T,>(header: string, cell: (row: T) => React.ReactNode, className = 'py-1 px-2') => ({
    header, className, headClassName: 'text-left py-1 px-2', cell,
  });
  return <div className="space-y-2">
    <h4 className="font-semibold text-sm">{reportText('r.pcn874-validation', 'PCN874 validation')}</h4>
    <p className="text-sm text-[var(--muted)]">
      {fill(reportText('r.historical-appendix-draft-checked', 'The historical Appendix A draft for {period}, checked record by record. It is'), { period: preview.startMonth === preview.endMonth ? preview.startMonth : fill(reportText('r.month-range', '{from} to {to}'), { from: preview.startMonth, to: preview.endMonth }) })}
      {' '}<b>{reportText('r.not-ready-for-filing', 'not ready for filing')}</b>{reportText('r.historical-not-filed-caution', ': the layout dates to 2010 and current validation must be verified independently. Nothing is submitted from this screen.')}
    </p>
    {preview.problem && <p className="text-sm text-amber-700 dark:text-amber-400">{preview.problem}</p>}
    <ReportTableScroll>
      <RowTable
        rowClassName="border-b border-[var(--line)]/50"
        caption={(<>{reportText('r.pcn874-layout-checks', 'PCN874 layout checks')}</>)}
        rows={layoutChecks}
        rowKey={row => row.check}
        captionClassName="text-left font-semibold text-[var(--text)] pb-1"
        tableClassName="w-full text-sm"
        headRowClassName="border-b border-[var(--line)] text-xs text-[var(--muted)]"
        bodyClassName=""
        columns={[
          firstColumn<LayoutCheck>(reportText('r.check', 'Check'), row => row.check),
          dataColumn<LayoutCheck>(reportText('r.expected', 'Expected'), row => row.expected),
          dataColumn<LayoutCheck>(reportText('r.actual', 'Actual'), row => row.actual),
          dataColumn<LayoutCheck>(reportText('r.result', 'Result'), row => row.result),
        ]}
      />
    </ReportTableScroll>
    {preview.unmapped.length > 0 && <ul className="list-disc pl-5 text-sm space-y-1">
      {preview.unmapped.map(row => <li key={`${row.kind}:${row.documentId}`}>
        {row.documentId} ({row.kind}{row.number ? ` ${row.number}` : ''}): {row.reason}
      </li>)}
    </ul>}
    {preview.notRepresented > 0 && <p className="text-sm text-[var(--muted)]">
      {fill(reportText('r.documents-not-represented-in-historical-layout', '{count} exempt, reverse-charge or out-of-scope document(s) are not represented in this layout and are never silently dropped.'), { count: preview.notRepresented })}
    </p>}
    {preview.comparison.length > 0 && <ReportTableScroll>
      <RowTable
        rowClassName="border-b border-[var(--line)]/50"
        caption={(<>{reportText('r.pcn874-totals-reconciliation', 'PCN874 totals reconciliation')}</>)}
        rows={preview.comparison}
        rowKey={row => row.label}
        captionClassName="text-left font-semibold text-[var(--text)] pb-1"
        tableClassName="w-full text-sm"
        headRowClassName="border-b border-[var(--line)] text-xs text-[var(--muted)]"
        bodyClassName=""
        columns={[
          firstColumn<Comparison>(reportText('r.figure', 'Figure'), row => row.label),
          dataColumn<Comparison>(reportText('r.draft-nis', 'Draft (NIS)'), row => row.draftNis.toLocaleString('en-US'), 'py-1 px-2 tabular-nums'),
          dataColumn<Comparison>(reportText('r.vat-report-nis', 'VAT report (NIS)'), row => row.returnNis.toLocaleString('en-US'), 'py-1 px-2 tabular-nums'),
          dataColumn<Comparison>(reportText('r.difference-nis', 'Difference (NIS)'), row => row.differenceNis.toLocaleString('en-US'), 'py-1 px-2 tabular-nums'),
        ]}
      />
    </ReportTableScroll>}
    {preview.comparison.some(row => row.differenceNis !== 0) && <p className="text-sm">
      {reportText('r.whole-shekel-differences-are-never-smoothed-away', 'The draft’s whole-shekel totals differ from the VAT report; the difference is shown, never smoothed away. Per-document rounding to whole shekels can explain one shekel per row.')}
    </p>}
    {draft && <p className="text-sm">
      {fill(reportText('r.draft-widths-download-is-not-filing', 'Header {headerLength} characters, {count} transaction row(s) of {width}, closing {closingLength}. Downloading saves the text; it does not file it.'), { headerLength: draft.header.length, count: draft.transactions.length, width: PCN874_DRAFT_TRANSACTION_WIDTH, closingLength: draft.closing.length })}
    </p>}
  </div>;
}

export function IsraelMonthJourneyPanel({ journey, preview, currency = 'ILS', monthText, onMonthChange, dealerId, onDealerIdChange, loading = false, partial = false, onRecordFiled }: {
  /** CON-4b: owners and accountants record one registration's return as filed */
  onRecordFiled?: (r: { registration: string; startDate: string; endDate: string }) => Promise<void>;
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
  const reportText = useReportText();
  const goToPage = useUIStore(state => state.goToPage);
  const problem = israelMonthProblem(monthText, getLocalDateISO());

  return <section aria-label={reportText('r.israel-month-journey', 'Israel month journey')} className="p-4 space-y-4 min-w-0">
    <h2>{reportText('r.israel-month-journey', 'Israel month journey')}</h2>
    <p className="text-sm text-[var(--muted)]">
      {reportText('r.one-path-for-an-israeli-vat-month-the-registrati', 'One path for an Israeli VAT month: the registration, the allocation numbers on business invoices, the periodic VAT report (form 836 figures), the historical PCN874 draft and closing the month. Each money figure is the one the screen it names shows, so nothing is recalculated here. Read-only: nothing files, posts, pays or closes anything. The Tax Authority assigns the frequency and the deadline, and the PCN874 draft uses a historical Appendix A layout that is not verified for current filing.')}
    </p>

    <div className="flex flex-wrap items-end gap-3" data-print-hide>
      <label className="flex flex-col gap-1 text-sm">{reportText('r.month', 'Month')}
        <input aria-label={reportText('r.month', 'Month')} className={field} value={monthText} onChange={event => onMonthChange(event.target.value)} placeholder="2026-09" />
      </label>
      <label className="flex flex-col gap-1 text-sm">{reportText('r.dealer-number-9-digits', 'Dealer number (9 digits)')}
        <input aria-label={reportText('r.dealer-number-9-digits', 'Dealer number (9 digits)')} inputMode="numeric" maxLength={9} className={field} value={dealerId}
          onChange={event => onDealerIdChange(event.target.value.replace(/\D/g, '').slice(0, 9))} placeholder="514000000" />
      </label>
      <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]" disabled={!journey || loading}
        onClick={() => journey && downloadCsv(`israel-month-journey-${journey.month}`, IL_MONTH_JOURNEY_CSV_HEADERS, ilMonthJourneyCsvRows(journey))}>{reportText('r.export-csv', 'Export CSV')}</button>
      <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]" disabled={!preview?.draft}
        onClick={() => preview?.draft && downloadText(`pcn874-${preview.startMonth === preview.endMonth ? preview.startMonth : `${preview.startMonth}-to-${preview.endMonth}`}-draft.txt`, preview.draft.text)}>{reportText('r.download-pcn874-draft', 'Download PCN874 draft')}</button>
    </div>

    <JourneyNotices problem={problem} loading={loading} partial={partial} problems={journey?.problems}
      loadingText="Loading the month&rsquo;s documents and the returns recorded for it…" />

    {journey && <p className="text-sm">
      <b>{journey.month}</b> ({journey.startDate} {reportText('r.to-2', 'to')} {journey.endDate}) · {journey.done} {reportText('r.of', 'of')} {journey.steps.length} {reportText('r.steps-done', 'steps done')}
      {journey.readyToClose
        ? ` ${reportText('r.the-month-s-recorded-work-is-complete-here', '· the month’s recorded work is complete here.')}`
        : journey.nextStep ? ` ${fill(reportText('r.journey-next', '· next: {step}.'), { step: journey.steps.find(s => s.id === journey.nextStep)?.title ?? '' })}` : ''}
    </p>}

    {journey && <JourneySteps steps={journey.steps} currency={currency} formatCurrency={formatCurrency} statusLabel={stepStatusLabel('month', reportText)}
      afterFigures={step => <>
        {step.returns.length > 0 && <VatReturnTable returns={step.returns} currency={currency} onRecordFiled={onRecordFiled} />}
        {step.allocation.length > 0 && <AllocationTable cases={step.allocation} currency={currency} />}
      </>}
      openScreen={step => step.id === 'pcn874'
        ? <PCN874ValidationView preview={preview} />
        : <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)] text-sm"
          onClick={() => goToPage({ tab: step.tab, sub: step.screen })}>{reportText('r.open', 'Open')} {step.screenLabel}</button>} />}

    {preview && <section aria-labelledby="pcn874-preview" className="rounded border border-[var(--line)] p-3 space-y-2">
      <h3 id="pcn874-preview" className="font-semibold text-sm">{reportText('r.pcn874-historical-draft', 'PCN874 historical draft')}</h3>
      <p className="text-sm text-[var(--muted)]">
        {reportText('r.the-fixed-width-appendix-a-layout-built-from-the', 'The fixed-width Appendix A layout, built from the documents of')} {preview.startMonth === preview.endMonth ? preview.startMonth : fill(reportText('r.bimonthly-report-range', 'the bimonthly report {from} to {to} (the header carries its first month, not verified for the current layout)'), { from: preview.startMonth, to: preview.endMonth })} {reportText('r.in-shekels', 'in shekels:')} {preview.rows.length} {reportText('r.row-s-it-is', 'row(s). It is')} <b>{reportText('r.not-filing-ready', 'not filing-ready')}</b>{reportText('r.the-layout-dates-to-2010-and-current-validation', ': the layout dates to 2010, and current validation, document classification, allocation-number rules and Tax Authority acceptance must be verified independently. Nothing is submitted from this screen.')}
      </p>
      {preview.problem && <p role="status" className="text-sm text-amber-700 dark:text-amber-400">{preview.problem}</p>}
      {preview.unmapped.length > 0 && <ReportTableScroll>
        <RowTable
          rowClassName="border-b border-[var(--line)]/50"
          caption={(<>{reportText('r.documents-that-cannot-be-written-in-this-histori', 'Documents that cannot be written in this historical layout')}</>)}
          rows={preview.unmapped}
          rowKey={row => `${row.kind}:${row.documentId}`}
          captionClassName="text-left font-semibold text-[var(--text)] pb-1"
          tableClassName="w-full text-sm"
          headRowClassName="border-b border-[var(--line)] text-xs text-[var(--muted)]"
          bodyClassName=""
          columns={[
            { header: reportText('r.document', 'Document'), className: "text-left font-normal py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => row.documentId },
            { header: reportText('r.kind', 'Kind'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => row.kind },
            { header: reportText('r.number', 'Number'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => row.number || '—' },
            { header: reportText('r.why-it-cannot-be-written', 'Why it cannot be written'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => row.reason },
          ]}
        />
      </ReportTableScroll>}
      {preview.comparison.some(row => row.differenceNis !== 0) && <>
        <p className="text-sm">{reportText('r.the-draft-s-whole-shekel-totals-differ-from-the', 'The draft’s whole-shekel totals differ from the VAT report; the difference is shown, never smoothed away. Per-document rounding to whole shekels can explain one shekel per row.')}</p>
        <ReportTableScroll>
          <RowTable
            rowClassName="border-b border-[var(--line)]/50"
            caption={(<>{reportText('r.the-draft-beside-the-vat-report', 'The draft beside the VAT report')}</>)}
            rows={preview.comparison}
            rowKey={row => row.label}
            captionClassName="text-left font-semibold text-[var(--text)] pb-1"
            tableClassName="w-full text-sm"
            headRowClassName="border-b border-[var(--line)] text-xs text-[var(--muted)]"
            bodyClassName=""
            columns={[
              { header: reportText('r.figure', 'Figure'), className: "text-left font-normal py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => row.label },
              { header: reportText('r.draft-nis', 'Draft (NIS)'), className: "py-1 px-2 tabular-nums", headClassName: "text-left py-1 px-2", cell: (row) => row.draftNis.toLocaleString('en-US') },
              { header: reportText('r.vat-report-nis', 'VAT report (NIS)'), className: "py-1 px-2 tabular-nums", headClassName: "text-left py-1 px-2", cell: (row) => row.returnNis.toLocaleString('en-US') },
              { header: reportText('r.difference-nis', 'Difference (NIS)'), className: "py-1 px-2 tabular-nums", headClassName: "text-left py-1 px-2", cell: (row) => row.differenceNis.toLocaleString('en-US') },
            ]}
          />
        </ReportTableScroll>
      </>}
      {preview.draft && <p className="text-sm">
        {reportText('r.header', 'Header')} {preview.draft.header.length} {reportText('r.characters', 'characters,')} {preview.draft.transactions.length} {reportText('r.transaction-row-s-of-60-closing', 'transaction row(s) of 60, closing')} {preview.draft.closing.length}{reportText('r.downloading-saves-the-text-it-does-not-file-it', '. Downloading saves the text; it does not file it.')}
      </p>}
    </section>}
  </section>;
}

function VatReturnTable({ returns, currency, onRecordFiled }: { returns: IsraelMonth['steps'][number]['returns']; currency: string; onRecordFiled?: (r: { registration: string; startDate: string; endDate: string }) => Promise<void> }) {
  const reportText = useReportText();
  const [saving, setSaving] = useState('');
  const [problem, setProblem] = useState('');
  const record = async (r: IsraelMonth['steps'][number]['returns'][number]) => {
    if (!onRecordFiled || saving) return;
    // CON-4b review: the same question as filing the whole workspace's return (TaxLiabilityView), naming the registration
    if (!window.confirm(`File the return of ${r.registration.split(':').pop()} for ${r.startDate} to ${r.endDate}? A copy is kept and can't be changed.`)) return;
    setSaving(r.registration);
    setProblem('');
    try { await onRecordFiled(r); } catch (err) { setProblem(err instanceof Error ? err.message : String(err)); } finally { setSaving(''); }
  };
  return <ReportTableScroll>
    {problem && <p role="alert" className="text-sm text-[var(--danger)]">{problem}</p>}
    <RowTable
      rowClassName="border-b border-[var(--line)]/50"
      caption={(<>{reportText('r.the-vat-report-each-registration-files-for-this', 'The VAT report each registration files for this month (its own monthly or two-month period), as the return screen computes it')}</>)}
      rows={returns}
      rowKey={r => r.registration}
      captionClassName="text-left font-semibold text-[var(--text)] pb-1"
      tableClassName="w-full text-sm"
      headRowClassName="border-b border-[var(--line)] text-xs text-[var(--muted)]"
      bodyClassName=""
      columns={[
        { header: reportText('r.registration', 'Registration'), className: "text-left font-normal py-1 px-2", headClassName: "text-left py-1 px-2", cell: (r) => (<><span className="block">{r.registration.split(':').pop()}</span><span className="block text-xs text-[var(--muted)]">{r.startMonth === r.endMonth ? r.startMonth : fill(reportText('r.month-range', '{from} to {to}'), { from: r.startMonth, to: r.endMonth })}</span></>) },
        { header: reportText('r.documents-2', 'Documents'), className: "py-1 px-2 tabular-nums", headClassName: "text-left py-1 px-2", cell: (r) => r.documentCount },
        { header: reportText('r.taxable-sales', 'Taxable sales'), className: "py-1 px-2 tabular-nums whitespace-nowrap", headClassName: "text-left py-1 px-2", cell: (r) => formatCurrency(r.taxableSalesCents, currency) },
        { header: reportText('r.output-vat', 'Output VAT'), className: "py-1 px-2 tabular-nums whitespace-nowrap", headClassName: "text-left py-1 px-2", cell: (r) => formatCurrency(r.outputVatCents, currency) },
        { header: reportText('r.zero-rated', 'Zero-rated'), className: "py-1 px-2 tabular-nums whitespace-nowrap", headClassName: "text-left py-1 px-2", cell: (r) => formatCurrency(r.zeroRatedSalesCents, currency) },
        { header: reportText('r.input-vat-other', 'Input VAT, other'), className: "py-1 px-2 tabular-nums whitespace-nowrap", headClassName: "text-left py-1 px-2", cell: (r) => formatCurrency(r.otherInputVatCents, currency) },
        { header: reportText('r.input-vat-equipment', 'Input VAT, equipment'), className: "py-1 px-2 tabular-nums whitespace-nowrap", headClassName: "text-left py-1 px-2", cell: (r) => formatCurrency(r.fixedAssetInputVatCents, currency) },
        { header: reportText('r.to-pay-reclaim', 'To pay / reclaim'), className: "py-1 px-2 tabular-nums whitespace-nowrap", headClassName: "text-left py-1 px-2", cell: (r) => (<>{formatCurrency(Math.abs(r.toPayCents), currency)}{r.toPayCents < 0 ? ` ${reportText('r.reclaim', '(reclaim)')}` : ''}</>) },
        { header: reportText('r.due-date-2', 'Due date'), className: "py-1 px-2 whitespace-nowrap", headClassName: "text-left py-1 px-2", cell: (r) => r.dueDate || (r.filing ? `${r.filing} report` : 'not stated') },
        { header: reportText('r.recorded-as-filed', 'Recorded as filed'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (r) => r.filed ? 'Yes' : onRecordFiled && !r.pending
            ? <button type="button" className="min-h-11 px-3 rounded border border-[var(--line)]" disabled={saving === r.registration}
              onClick={() => { void record(r); }}>{saving === r.registration ? reportText('r.recording', 'Recording…') : fill(reportText('r.record-reg-as-filed', 'Record {registration} as filed'), { registration: r.registration.split(':').pop() ?? '' })}</button>
            : 'Not recorded here' },
        // T-08: the box-by-box differences against the filed copy, or the fact that nothing changed
        { header: reportText('r.since-filed', 'Since filed'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (r) => (<FilledChangesCell changes={r.changes} currency={currency} reportText={reportText} />) },
      ]}
    />
  </ReportTableScroll>;
}

function AllocationTable({ cases, currency }: { cases: IsraelMonth['steps'][number]['allocation']; currency: string }) {
  const reportText = useReportText();
  return <ReportTableScroll>
    <RowTable
      rowClassName="border-b border-[var(--line)]/50"
      caption={(<>{reportText('r.invoices-that-need-an-allocation-number', 'Invoices that need an allocation number')}</>)}
      rows={cases}
      rowKey={c => c.invoiceId}
      captionClassName="text-left font-semibold text-[var(--text)] pb-1"
      tableClassName="w-full text-sm"
      headRowClassName="border-b border-[var(--line)] text-xs text-[var(--muted)]"
      bodyClassName=""
      columns={[
        { header: reportText('r.invoice-2', 'Invoice'), className: "text-left font-normal py-1 px-2", headClassName: "text-left py-1 px-2", cell: (c) => c.number || c.invoiceId },
        { header: reportText('r.customer', 'Customer'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (c) => c.customerName || '—' },
        { header: reportText('r.date-2', 'Date'), className: "py-1 px-2 whitespace-nowrap", headClassName: "text-left py-1 px-2", cell: (c) => c.date },
        { header: reportText('r.before-vat', 'Before VAT'), className: "py-1 px-2 tabular-nums whitespace-nowrap", headClassName: "text-left py-1 px-2", cell: (c) => formatCurrency(c.netCents, currency) },
        { header: reportText('r.threshold', 'Threshold'), className: "py-1 px-2 tabular-nums whitespace-nowrap", headClassName: "text-left py-1 px-2", cell: (c) => formatCurrency(c.thresholdCents, currency) },
        { header: reportText('r.recorded-number', 'Recorded number'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (c) => c.recorded || 'none' },
        { header: reportText('r.what-to-do', 'What to do'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (c) => c.problem || 'Recorded and 9 digits.' },
      ]}
    />
  </ReportTableScroll>;
}
