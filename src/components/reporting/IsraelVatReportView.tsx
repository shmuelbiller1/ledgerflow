import { RowTable } from '../ui/RowTable';
import React, { useMemo, useState } from 'react';
import { Printer, Download, Receipt } from 'lucide-react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useUIStore } from '../../stores/useUIStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { isCollectionCapped, type LedgerKey } from '../../lib/ledgerCollections';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { useScreenDataHealth } from '../../hooks/useScreenDataHealth';
import { usePageSyncedState } from '../../hooks/usePageSyncedState';
import { formatCurrency, getLocalDateISO, workspaceYearMonth } from '../../lib/utils';
import { downloadCsv } from '../../lib/csvExport';
import { printElementById } from '../../lib/printRoot';
import { belongsTo, israelVatReturn, type IlVatDocument, type IlVatReturn } from '../../lib/tax/ilVatReturn';
import { COUNTED_PURCHASES } from '../../lib/taxCodes';
import { withEquipment } from '../../lib/tax/ilVatEquipment';
import { ilVatRegistrations } from '../../lib/israelMonthJourney';
import { ilVatReportCsvHeaders, ilVatReportCsvRows } from '../../lib/ilVatReportCsv';
import ReportTableScroll from './ReportTableScroll';
import { ScreenDataNotice } from '../ui/ScreenDataNotice';
import { useReportText } from './useReportText';

const IL_VAT_COLLECTIONS = ['invoices', 'bills', 'creditNotes', 'vendorCredits', 'accounts'] as const;

const field = 'min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]';
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
/** The ledger's home currency when a workspace has none saved (AGENTS.md §5). */
const WORKSPACE_CURRENCY_FALLBACK = 'USD';
/** A standalone panel render has no workspace to read; its contract is an ILS return. */
const PANEL_CURRENCY_FALLBACK = 'ILS';

/** Only this workspace's rows; a row with no workspace id is a fixture or a shared record. */
const inWorkspace = <T extends { workspaceId?: string }>(rows: T[] | undefined, workspaceId?: string | null) =>
  (rows || []).filter(row => !workspaceId || !row.workspaceId || row.workspaceId === workspaceId);

/**
 * Mixed bills that the chosen return really counts: the same counted-purchase status, period and
 * VAT registration that `computeTaxReturn` uses. A mixed bill from another period or dealer must
 * not produce a notice on this return. Keeps the whole list for vendor-credit classification.
 */
function countedMixedBills(
  mixed: readonly unknown[],
  input: {
    profiles: Parameters<typeof belongsTo>[1];
    order: string[];
    registration: string;
    startDate: string;
    endDate: string;
  },
): number {
  return mixed.filter(bill => {
    const doc = bill as IlVatDocument;
    const day = String(doc.date || doc.issueDate || '').slice(0, 10);
    return COUNTED_PURCHASES.has(String(doc.status))
      && day >= input.startDate && day <= input.endDate
      && belongsTo(doc, input.profiles, input.order, input.registration);
  }).length;
}

interface IsraelVatReportViewProps {
  startDate?: string;
  endDate?: string;
  /** Reports already supplies the page h1; an embedded view supplies h2 */
  embedded?: boolean;
}

/**
 * C-40 (PLAN IL-3): Israel periodic VAT report screen and print (Form 836 / דו״ח תקופתי למע״מ).
 * Read-only summary of the period's sales (taxable, zero-rated, exempt), output VAT,
 * input VAT on fixed assets (equipment) vs other inputs, and the net amount to pay or reclaim.
 * Computed directly via `israelVatReturn` in `src/lib/tax/ilVatReturn.ts`.
 * Figures are the workspace's base currency, not a converted ILS filing amount.
 * Nothing is filed, posted, or paid from this screen.
 */
export default function IsraelVatReportView({ startDate: pageStartDate, endDate: pageEndDate, embedded = false }: IsraelVatReportViewProps = {}) {
  const invoices = useLedgerStore(state => state.invoices);
  const creditNotes = useLedgerStore(state => state.creditNotes);
  const bills = useLedgerStore(state => state.bills);
  const vendorCredits = useLedgerStore(state => state.vendorCredits);
  const accounts = useLedgerStore(state => state.accounts);
  const truncated = useLedgerStore(state => state.truncatedCollections);
  const failed = useDataNeedsStore(state => state.failed);
  const workspace = useAuthStore(state => state.getCurrentWorkspace());
  const workspaceId = useAuthStore(state => state.currentWorkspaceId);
  const currency = workspace?.currency || WORKSPACE_CURRENCY_FALLBACK;

  // The equipment split reads the chart of accounts, so that list must be ready too.
  const { loading } = useLedgerCollections('invoices', 'bills', 'creditNotes', 'vendorCredits', 'accounts');
  const dataHealth = useScreenDataHealth(IL_VAT_COLLECTIONS);
  const setActiveTab = useUIStore(state => state.setActiveTab);

  // Default period: current fiscal year start or month start to today
  const [startDate, setStartDate] = usePageSyncedState(
    pageStartDate || '',
    pageStartDate,
    () => `${workspaceYearMonth().year}-01-01`
  );
  const [endDate, setEndDate] = usePageSyncedState(pageEndDate || '', pageEndDate, getLocalDateISO);

  const registrationOrder = useMemo(
    () => [workspace?.dimensions?.find(d => d.isWorld)?.id || 'world'],
    [workspace?.dimensions]
  );

  // Israeli VAT registrations in force for this workspace and period end
  const registrations = useMemo(() => {
    return ilVatRegistrations(workspace?.taxProfiles, endDate || getLocalDateISO());
  }, [workspace?.taxProfiles, endDate]);

  const [selectedReg, setSelectedReg] = useState<string>('');
  // A stale selection (period or workspace changed) is never used: no fabricated registration.
  const activeReg = registrations.find(r => r.registration === selectedReg)?.registration
    ?? registrations[0]?.registration
    ?? '';

  // Mark fixed-asset equipment bills and vendor credits
  const { bills: equipmentBills, vendorCredits: equipmentVendorCredits, mixed } = useMemo(() => {
    const wsBills = inWorkspace(bills, workspaceId);
    const wsVendorCredits = inWorkspace(vendorCredits, workspaceId);
    return withEquipment(wsBills, wsVendorCredits, accounts);
  }, [bills, vendorCredits, accounts, workspaceId]);

  const report = useMemo(() => {
    if (!activeReg || !DATE_REGEX.test(startDate) || !DATE_REGEX.test(endDate) || startDate > endDate) return null;
    return israelVatReturn({
      registration: activeReg,
      profiles: workspace?.taxProfiles,
      order: registrationOrder,
      invoices: inWorkspace(invoices, workspaceId) as unknown as IlVatDocument[],
      creditNotes: inWorkspace(creditNotes, workspaceId) as unknown as IlVatDocument[],
      bills: equipmentBills as unknown as IlVatDocument[],
      vendorCredits: equipmentVendorCredits as unknown as IlVatDocument[],
      startDate,
      endDate,
      baseCurrency: currency,
    });
  }, [activeReg, workspace?.taxProfiles, registrationOrder, invoices, creditNotes, equipmentBills, equipmentVendorCredits, workspaceId, startDate, endDate, currency]);

  const mixedBillsCount = useMemo(() => activeReg ? countedMixedBills(mixed, {
    profiles: workspace?.taxProfiles,
    order: registrationOrder,
    registration: activeReg,
    startDate,
    endDate,
  }) : 0, [mixed, activeReg, workspace?.taxProfiles, registrationOrder, startDate, endDate]);

  const partial = Boolean(
    truncated.invoices || truncated.bills || truncated.creditNotes || truncated.vendorCredits || isCollectionCapped(truncated, 'accounts') ||
    failed.invoices || failed.bills || failed.creditNotes || failed.vendorCredits || failed.accounts
  );

  return <IsraelVatReportPanel
    report={report}
    registrations={registrations}
    activeReg={activeReg}
    onRegistrationChange={setSelectedReg}
    startDate={startDate}
    onStartDateChange={setStartDate}
    endDate={endDate}
    onEndDateChange={setEndDate}
    loading={loading}
    partial={partial}
    failedKeys={dataHealth.failedKeys}
    failureMessage={dataHealth.message}
    onRetryFailed={dataHealth.retry}
    onOpenSettings={() => setActiveTab('settings')}
    onOpenInvoices={() => setActiveTab('sales')}
    missingRegistration={registrations.length === 0}
    currency={currency}
    mixedBillsCount={mixedBillsCount}
    embedded={embedded}
  />;
}

/**
 * Presentational panel for one Israel VAT return. `currency` is the workspace's base currency:
 * the figures are home-currency cents from `israelVatReturn`, so a non-ILS workspace gets a clear
 * non-filing notice and its CSV amount column is labeled with that currency, never "NIS".
 * A missing registration is a configuration state, not a zero-liability return.
 */
export function IsraelVatReportPanel({
  report,
  registrations,
  activeReg,
  onRegistrationChange,
  startDate,
  onStartDateChange,
  endDate,
  onEndDateChange,
  loading = false,
  partial = false,
  failedKeys = [],
  failureMessage,
  onRetryFailed,
  onOpenSettings,
  onOpenInvoices,
  missingRegistration = false,
  currency = PANEL_CURRENCY_FALLBACK,
  mixedBillsCount = 0,
  embedded = false,
}: {
  report: IlVatReturn | null;
  registrations: Array<{ registration: string; number: string; from: string; filing?: string }>;
  activeReg: string;
  onRegistrationChange: (value: string) => void;
  startDate: string;
  onStartDateChange: (value: string) => void;
  endDate: string;
  onEndDateChange: (value: string) => void;
  loading?: boolean;
  partial?: boolean;
  failedKeys?: readonly LedgerKey[];
  failureMessage?: string;
  onRetryFailed?: () => void;
  onOpenSettings?: () => void;
  onOpenInvoices?: () => void;
  missingRegistration?: boolean;
  currency?: string;
  mixedBillsCount?: number;
  embedded?: boolean;
}) {
  const reportText = useReportText();
  const Heading = embedded ? 'h2' : 'h1';
  const dealerNumber = activeReg.split(':').pop() || activeReg;
  const csvHeaders = ilVatReportCsvHeaders(currency);
  const renderMoney = (cents: number) => (
    <bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatCurrency(cents, currency)}</bdi>
  );

  const validDates = DATE_REGEX.test(startDate) && DATE_REGEX.test(endDate) && startDate <= endDate;

  return (
    <section aria-label={reportText('r.israel-vat-report', 'Israel VAT Report')} className="p-4 space-y-4 min-w-0 max-w-5xl mx-auto">
      {/* H-7: print the VAT return without the application shell. */}
      <div id="israel-vat-return" data-print-root={embedded ? undefined : ''} className="space-y-4">
      <div data-print-hide className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-[var(--line)] pb-4">
        <div className="flex items-center gap-3">
          <Receipt className="w-6 h-6 text-[var(--brass)]" aria-hidden="true" />
          <div>
            <Heading className="text-xl font-bold">
              {reportText('r.israel-vat-report-2', 'Israel VAT Report ·')} <span dir="rtl">{reportText('r.836', 'דוח מע״מ תקופתי (טופס 836)')}</span>
            </Heading>
            <p className="text-xs text-[var(--muted)]">
              {reportText('r.periodic-vat-return-figures-for-israeli-dealers', 'Periodic VAT return figures for Israeli dealers (sales, inputs, equipment inputs, to pay / reclaim). Read-only calculation for planning and review.')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2" data-print-hide>
          <button
            type="button"
            onClick={() => embedded ? window.print() : printElementById('israel-vat-return')}
            className="min-h-11 px-3 py-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface)] hover:bg-[var(--panel)] text-sm flex items-center gap-2"
          >
            <Printer size={16} aria-hidden="true" />
            <span>{reportText('r.print', 'Print')}</span>
          </button>
          <button
            type="button"
            disabled={!report || loading || partial || failedKeys.length > 0 || missingRegistration}
            onClick={() => {
              if (report) {
                downloadCsv(`israel-vat-report-${report.startDate}-to-${report.endDate}.csv`, csvHeaders, ilVatReportCsvRows(report));
              }
            }}
            className="min-h-11 px-3 py-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface)] hover:bg-[var(--panel)] text-sm flex items-center gap-2 disabled:opacity-50"
          >
            <Download size={16} aria-hidden="true" />
            <span>{reportText('r.export-csv', 'Export CSV')}</span>
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3 p-4 rounded-xl border border-[var(--line)] bg-[var(--surface)]" data-print-hide>
        {registrations.length > 1 && (
          <label className="flex flex-col gap-1 text-xs font-semibold">
            <span>{reportText('r.vat-registration', 'VAT Registration (עוסק מורשה)')}</span>
            <select
              aria-label={reportText('r.vat-registration-2', 'VAT Registration')}
              className={field}
              value={activeReg}
              onChange={e => onRegistrationChange(e.target.value)}
            >
              {registrations.map(r => (
                <option key={r.registration} value={r.registration}>
                  {r.number} ({r.from})
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1 text-xs font-semibold">
          <span>{reportText('r.from-2', 'From (מתאריך)')}</span>
          <input
            type="date"
            aria-label={reportText('r.start-date', 'Start date')}
            className={field}
            value={startDate}
            onChange={e => onStartDateChange(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold">
          <span>{reportText('r.to-3', 'To (עד תאריך)')}</span>
          <input
            type="date"
            aria-label={reportText('r.end-date', 'End date')}
            className={field}
            value={endDate}
            onChange={e => onEndDateChange(e.target.value)}
          />
        </label>
      </div>

      {failedKeys.length > 0 && onRetryFailed && (
        <div data-print-hide>
          <ScreenDataNotice
            failedKeys={failedKeys}
            message={failureMessage}
            onRetry={onRetryFailed}
            what={reportText('r.this-vat-report', 'this VAT report')}
          />
        </div>
      )}
      {loading && <p role="status" className="text-sm">{reportText('r.loading-documents-and-vat-registrations', 'Loading documents and VAT registrations…')}</p>}
      {partial && <p role="alert" className="text-sm text-amber-700 dark:text-amber-400">{reportText('r.a-loaded-list-is-capped-or-failed-so-the-figures', 'A loaded list is capped or failed, so the figures below are provisional until all records are loaded.')}</p>}
      {missingRegistration && (
        <div className="space-y-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
          <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">
            {reportText('r.no-israeli-vat-registration-is-configured-for-th', 'No Israeli VAT registration is configured for this period. Add one in Settings → Tax profiles before preparing a VAT report; figures cannot be calculated without a registration.')}
          </p>
          {onOpenSettings && (
            <div data-print-hide>
              <button
                type="button"
                onClick={onOpenSettings}
                className="inline-flex min-h-11 items-center rounded-lg border border-[var(--line)] bg-[var(--panel)] px-4 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--elevated)]"
              >
                {reportText('r.open-settings', 'Open Settings')}
              </button>
            </div>
          )}
        </div>
      )}
      {currency !== 'ILS' && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {reportText('r.figures-are-in-the-workspace-s-base-currency', 'Figures are in the workspace\'s base currency (')}{currency}{reportText('r.an-israeli-vat-return-is-filed-in-ils-this-scree', '). An Israeli VAT return is filed in ILS; this screen does not convert currencies or file a return.')}
        </p>
      )}
      {!validDates && <p role="alert" className="text-sm text-rose-600">{reportText('r.please-enter-a-valid-date-range-yyyy-mm-dd-with', 'Please enter a valid date range (YYYY-MM-DD) with start date before or equal to end date.')}</p>}

      {mixedBillsCount > 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-400 p-2 rounded border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/20">
          {reportText('r.note-2', 'Note:')} {mixedBillsCount} {reportText('r.bill-s-mix-equipment-and-operating-expense-accou', 'bill(s) mix equipment and operating expense accounts. Per Israeli reporting guidelines, mixed bills are reported under other input VAT rather than being split by assumption.')}
        </p>
      )}

      {report && (
        <div className="space-y-4">
          <div className="text-sm text-[var(--muted)] flex flex-wrap gap-x-6 gap-y-1">
            <span>{reportText('r.dealer-number', 'Dealer number:')} <b><bdi>{dealerNumber}</bdi></b></span>
            <span>{reportText('r.period-2', 'Period:')} <b><bdi>{report.startDate}</bdi></b> {reportText('r.to-2', 'to')} <b><bdi>{report.endDate}</bdi></b></span>
            <span>{reportText('r.documents-evaluated', 'Documents evaluated:')} <b>{report.documentCount}</b></span>
            <span>{reportText('r.currency', 'Currency:')} <b><bdi>{currency}</bdi></b></span>
          </div>

          {!loading && !partial && failedKeys.length === 0 && report.documentCount === 0 && (
            <div
              data-testid="il-vat-empty-period"
              data-print-hide
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 text-xs"
            >
              <p className="text-[var(--muted)]">
                <strong className="text-[var(--text)]">{reportText('r.no-counted-vat-documents-in-this-period', 'No counted VAT documents in this period.')}</strong>{' '}
                {reportText('r.choose-another-date-range-or-issue-an-invoice-or-2', 'Choose another date range, or issue an invoice or record a supplier bill under this registration to populate the return.')}
              </p>
              {onOpenInvoices && (
                <button
                  type="button"
                  onClick={onOpenInvoices}
                  className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg border border-[var(--line)] bg-[var(--panel)] px-4 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--elevated)]"
                >
                  {reportText('r.open-invoices', 'Open Invoices')}
                </button>
              )}
            </div>
          )}

          <ReportTableScroll allowDisplayedExport={false}>
            <RowTable
              caption={reportText('r.periodic-vat-return-summary-836', 'Periodic VAT Return Summary (ריכוז דוח תקופתי למע״מ - טופס 836)')}
              captionClassName="text-start font-semibold text-[var(--text)] pb-2"
              tableClassName="w-full text-sm"
              headRowClassName="border-b border-[var(--line)] text-xs text-[var(--muted)]"
              bodyClassName=""
              rowClassName={(row) => row.rowStyle}
              rows={[
                {
                  id: 'taxable',
                  label: reportText('r.taxable-sales-excluding-vat', 'Taxable sales (excluding VAT)'),
                  hebrew: reportText('r.x', 'עסקאות חייבות במס (ללא מע״מ)'),
                  amount: renderMoney(report.taxableSalesCents),
                  rowStyle: 'border-b border-[var(--line)]/50',
                  labelStyle: 'text-start font-normal py-2 px-3',
                  hebrewStyle: 'py-2 px-3 text-[var(--muted)]',
                  amountStyle: 'py-2 px-3 text-right font-mono tabular-nums font-medium',
                },
                {
                  id: 'output',
                  label: reportText('r.output-vat', 'Output VAT'),
                  hebrew: reportText('r.x-2', 'מע״מ עסקאות'),
                  amount: renderMoney(report.outputVatCents),
                  rowStyle: 'border-b border-[var(--line)]/50 bg-[var(--surface)]/40',
                  labelStyle: 'text-start font-semibold py-2 px-3',
                  hebrewStyle: 'py-2 px-3 text-[var(--muted)] font-semibold',
                  amountStyle: 'py-2 px-3 text-right font-mono tabular-nums font-bold',
                },
                {
                  id: 'zero',
                  label: reportText('r.zero-rated-sales', 'Zero-rated sales'),
                  hebrew: reportText('r.x-3', 'עסקאות בשיעור אפס (יצוא וכד׳)'),
                  amount: renderMoney(report.zeroRatedSalesCents),
                  rowStyle: 'border-b border-[var(--line)]/50',
                  labelStyle: 'text-start font-normal py-2 px-3',
                  hebrewStyle: 'py-2 px-3 text-[var(--muted)]',
                  amountStyle: 'py-2 px-3 text-right font-mono tabular-nums',
                },
                {
                  id: 'exempt',
                  label: reportText('r.exempt-sales', 'Exempt sales'),
                  hebrew: reportText('r.x-4', 'עסקאות פטורות'),
                  amount: renderMoney(report.exemptSalesCents),
                  rowStyle: 'border-b border-[var(--line)]/50',
                  labelStyle: 'text-start font-normal py-2 px-3',
                  hebrewStyle: 'py-2 px-3 text-[var(--muted)]',
                  amountStyle: 'py-2 px-3 text-right font-mono tabular-nums',
                },
                {
                  id: 'equipment',
                  label: reportText('r.input-vat-on-fixed-assets-equipment', 'Input VAT on fixed assets (equipment)'),
                  hebrew: reportText('r.x-5', 'מס תשומות על ציוד (נכסים קבועים)'),
                  amount: renderMoney(report.fixedAssetInputVatCents),
                  rowStyle: 'border-b border-[var(--line)]/50',
                  labelStyle: 'text-start font-normal py-2 px-3',
                  hebrewStyle: 'py-2 px-3 text-[var(--muted)]',
                  amountStyle: 'py-2 px-3 text-right font-mono tabular-nums',
                },
                {
                  id: 'purchases',
                  label: reportText('r.input-vat-on-other-purchases', 'Input VAT on other purchases'),
                  hebrew: reportText('r.x-6', 'מס תשומות אחרות (הוצאות שוטפות)'),
                  amount: renderMoney(report.otherInputVatCents),
                  rowStyle: 'border-b border-[var(--line)]/50',
                  labelStyle: 'text-start font-normal py-2 px-3',
                  hebrewStyle: 'py-2 px-3 text-[var(--muted)]',
                  amountStyle: 'py-2 px-3 text-right font-mono tabular-nums',
                },
                {
                  id: 'total',
                  label: report.toPayCents >= 0 ? reportText('r.total-vat-to-pay', 'Total VAT to pay') : reportText('r.total-vat-to-reclaim', 'Total VAT to reclaim'),
                  hebrew: report.toPayCents >= 0 ? 'סך הכל לתשלום' : 'סך הכל להחזר',
                  amount: (
                    <>
                      {renderMoney(Math.abs(report.toPayCents))}
                      {report.toPayCents < 0 && <span className="text-xs font-normal ms-1">{reportText('r.reclaim-2', '(reclaim / להחזר)')}</span>}
                    </>
                  ),
                  rowStyle: 'border-t-2 border-[var(--line)] bg-[var(--panel)]',
                  labelStyle: 'text-start font-bold py-3 px-3',
                  hebrewStyle: 'py-3 px-3 text-[var(--muted)] font-bold',
                  amountStyle: `py-3 px-3 text-right font-mono tabular-nums font-extrabold text-base ${report.toPayCents >= 0 ? 'text-[var(--text)]' : 'text-[var(--pos)]'}`,
                },
              ]}
              rowKey={(row) => row.id}
              columns={[
                {
                  header: reportText('r.field', 'Field (שדה)'),
                  headClassName: 'text-start py-2 px-3',
                  cellProps: (row) => ({ className: row.labelStyle }),
                  cell: (row) => row.label,
                },
                {
                  header: reportText('r.hebrew-description', 'Hebrew Description (תיאור)'),
                  headClassName: 'text-start py-2 px-3',
                  cellProps: (row) => ({ className: row.hebrewStyle, dir: 'rtl' }),
                  cell: (row) => row.hebrew,
                },
                {
                  header: reportText('r.amount-2', 'Amount (סכום)'),
                  headClassName: 'text-right py-2 px-3',
                  cellProps: (row) => ({ className: row.amountStyle }),
                  cell: (row) => row.amount,
                },
              ]}
            />
          </ReportTableScroll>

          <div className="p-3 rounded-lg border border-[var(--line)] bg-[var(--surface)] text-xs text-[var(--muted)] space-y-1">
            <p>
              <b>{reportText('r.important-notice', 'Important notice:')}</b> {reportText('r.this-report-is-for-calculation-management-review', 'This report is for calculation, management review, and reconciliation purposes only. It does not file a tax return, make a tax payment, or communicate with the Israel Tax Authority.')}
            </p>
            <p>
              {reportText('r.statutory-filing-requires-submission-via-the-isr', 'Statutory filing requires submission via the Israel Tax Authority portal (שע״מ / Gov.il) or certified electronic reporting.')}
            </p>
          </div>
        </div>
      )}
      </div>
    </section>
  );
}
