import React, { useMemo, useState } from 'react';
import { Printer, Download, Receipt } from 'lucide-react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { usePageSyncedState } from '../../hooks/usePageSyncedState';
import { formatCurrency, getLocalDateISO, workspaceYearMonth } from '../../lib/utils';
import { downloadCsv } from '../../lib/csvExport';
import { israelVatReturn, type IlVatDocument, type IlVatReturn } from '../../lib/tax/ilVatReturn';
import { withEquipment } from '../../lib/tax/ilVatEquipment';
import { ilVatRegistrations } from '../../lib/israelMonthJourney';
import { IL_VAT_REPORT_CSV_HEADERS, ilVatReportCsvRows } from '../../lib/ilVatReportCsv';
import ReportTableScroll from './ReportTableScroll';

const field = 'min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]';
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/** Only this workspace's rows; a row with no workspace id is a fixture or a shared record. */
const inWorkspace = <T extends { workspaceId?: string }>(rows: T[] | undefined, workspaceId?: string | null) =>
  (rows || []).filter(row => !workspaceId || !row.workspaceId || row.workspaceId === workspaceId);

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

  const { loading } = useLedgerCollections('invoices', 'bills', 'creditNotes', 'vendorCredits');

  // Default period: current fiscal year start or month start to today
  const [startDate, setStartDate] = usePageSyncedState(
    pageStartDate || '',
    pageStartDate,
    () => `${workspaceYearMonth().year}-01-01`
  );
  const [endDate, setEndDate] = usePageSyncedState(pageEndDate || '', pageEndDate, getLocalDateISO);

  // Israeli VAT registrations in force for this workspace
  const registrations = useMemo(() => {
    return ilVatRegistrations(workspace?.taxProfiles, endDate || getLocalDateISO());
  }, [workspace?.taxProfiles, endDate]);

  const [selectedReg, setSelectedReg] = useState<string>('');
  const activeReg = selectedReg || registrations[0]?.registration || 'vat:IL:default';

  // Mark fixed-asset equipment bills and vendor credits
  const { bills: equipmentBills, vendorCredits: equipmentVendorCredits, mixed } = useMemo(() => {
    const wsBills = inWorkspace(bills, workspaceId);
    const wsVendorCredits = inWorkspace(vendorCredits, workspaceId);
    return withEquipment(wsBills, wsVendorCredits, accounts);
  }, [bills, vendorCredits, accounts, workspaceId]);

  const report = useMemo(() => {
    if (!DATE_REGEX.test(startDate) || !DATE_REGEX.test(endDate) || startDate > endDate) return null;
    return israelVatReturn({
      registration: activeReg,
      profiles: workspace?.taxProfiles,
      order: [workspace?.dimensions?.find(d => d.isWorld)?.id || 'world'],
      invoices: inWorkspace(invoices, workspaceId) as unknown as IlVatDocument[],
      creditNotes: inWorkspace(creditNotes, workspaceId) as unknown as IlVatDocument[],
      bills: equipmentBills as unknown as IlVatDocument[],
      vendorCredits: equipmentVendorCredits as unknown as IlVatDocument[],
      startDate,
      endDate,
    });
  }, [activeReg, workspace?.taxProfiles, workspace?.dimensions, invoices, creditNotes, equipmentBills, equipmentVendorCredits, workspaceId, startDate, endDate]);

  const partial = Boolean(
    truncated.invoices || truncated.bills || truncated.creditNotes || truncated.vendorCredits ||
    failed.invoices || failed.bills || failed.creditNotes || failed.vendorCredits
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
    mixedBillsCount={mixed.length}
    embedded={embedded}
  />;
}

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
  mixedBillsCount?: number;
  embedded?: boolean;
}) {
  const Heading = embedded ? 'h2' : 'h1';
  const currency = 'ILS';
  const dealerNumber = activeReg.split(':').pop() || activeReg;

  const validDates = DATE_REGEX.test(startDate) && DATE_REGEX.test(endDate) && startDate <= endDate;

  return (
    <section aria-label="Israel VAT Report" className="p-4 space-y-4 min-w-0 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-[var(--line)] pb-4">
        <div className="flex items-center gap-3">
          <Receipt className="w-6 h-6 text-[var(--brass)]" aria-hidden="true" />
          <div>
            <Heading className="text-xl font-bold">
              Israel VAT Report · <span dir="rtl">דוח מע״מ תקופתי (טופס 836)</span>
            </Heading>
            <p className="text-xs text-[var(--muted)]">
              Periodic VAT return figures for Israeli dealers (sales, inputs, equipment inputs, to pay / reclaim). Read-only calculation for planning and review.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2" data-print-hide>
          <button
            type="button"
            onClick={() => window.print()}
            className="min-h-11 px-3 py-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface)] hover:bg-[var(--panel)] text-sm flex items-center gap-2"
          >
            <Printer size={16} aria-hidden="true" />
            <span>Print</span>
          </button>
          <button
            type="button"
            disabled={!report || loading || partial}
            onClick={() => {
              if (report) {
                downloadCsv(`israel-vat-report-${report.startDate}-to-${report.endDate}.csv`, IL_VAT_REPORT_CSV_HEADERS, ilVatReportCsvRows(report));
              }
            }}
            className="min-h-11 px-3 py-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface)] hover:bg-[var(--panel)] text-sm flex items-center gap-2 disabled:opacity-50"
          >
            <Download size={16} aria-hidden="true" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3 p-4 rounded-xl border border-[var(--line)] bg-[var(--surface)]" data-print-hide>
        {registrations.length > 1 && (
          <label className="flex flex-col gap-1 text-xs font-semibold">
            <span>VAT Registration (עוסק מורשה)</span>
            <select
              aria-label="VAT Registration"
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
          <span>From (מתאריך)</span>
          <input
            type="date"
            aria-label="Start date"
            className={field}
            value={startDate}
            onChange={e => onStartDateChange(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold">
          <span>To (עד תאריך)</span>
          <input
            type="date"
            aria-label="End date"
            className={field}
            value={endDate}
            onChange={e => onEndDateChange(e.target.value)}
          />
        </label>
      </div>

      {loading && <p role="status" className="text-sm">Loading documents and VAT registrations…</p>}
      {partial && <p role="alert" className="text-sm text-amber-700 dark:text-amber-400">A loaded list is capped or failed, so the figures below are provisional until all records are loaded.</p>}
      {!validDates && <p role="alert" className="text-sm text-rose-600">Please enter a valid date range (YYYY-MM-DD) with start date before or equal to end date.</p>}

      {mixedBillsCount > 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-400 p-2 rounded border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/20">
          Note: {mixedBillsCount} bill(s) mix equipment and operating expense accounts. Per Israeli reporting guidelines, mixed bills are reported under other input VAT rather than being split by assumption.
        </p>
      )}

      {report && (
        <div className="space-y-4">
          <div className="text-sm text-[var(--muted)] flex flex-wrap gap-x-6 gap-y-1">
            <span>Dealer number: <b>{dealerNumber}</b></span>
            <span>Period: <b>{report.startDate}</b> to <b>{report.endDate}</b></span>
            <span>Documents evaluated: <b>{report.documentCount}</b></span>
          </div>

          <ReportTableScroll>
            <table className="w-full text-sm">
              <caption className="text-left font-semibold text-[var(--text)] pb-2">
                Periodic VAT Return Summary (ריכוז דוח תקופתי למע״מ - טופס 836)
              </caption>
              <thead>
                <tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
                  <th scope="col" className="text-left py-2 px-3">Field (שדה)</th>
                  <th scope="col" className="text-left py-2 px-3">Hebrew Description (תיאור)</th>
                  <th scope="col" className="text-right py-2 px-3">Amount (סכום)</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-[var(--line)]/50">
                  <th scope="row" className="text-left font-normal py-2 px-3">
                    Taxable sales (excluding VAT)
                  </th>
                  <td className="py-2 px-3 text-[var(--muted)]" dir="rtl">עסקאות חייבות במס (ללא מע״מ)</td>
                  <td className="py-2 px-3 text-right font-mono tabular-nums font-medium">
                    {formatCurrency(report.taxableSalesCents, currency)}
                  </td>
                </tr>
                <tr className="border-b border-[var(--line)]/50 bg-[var(--surface)]/40">
                  <th scope="row" className="text-left font-semibold py-2 px-3">
                    Output VAT
                  </th>
                  <td className="py-2 px-3 text-[var(--muted)] font-semibold" dir="rtl">מע״מ עסקאות</td>
                  <td className="py-2 px-3 text-right font-mono tabular-nums font-bold">
                    {formatCurrency(report.outputVatCents, currency)}
                  </td>
                </tr>
                <tr className="border-b border-[var(--line)]/50">
                  <th scope="row" className="text-left font-normal py-2 px-3">
                    Zero-rated sales
                  </th>
                  <td className="py-2 px-3 text-[var(--muted)]" dir="rtl">עסקאות בשיעור אפס (יצוא וכד׳)</td>
                  <td className="py-2 px-3 text-right font-mono tabular-nums">
                    {formatCurrency(report.zeroRatedSalesCents, currency)}
                  </td>
                </tr>
                <tr className="border-b border-[var(--line)]/50">
                  <th scope="row" className="text-left font-normal py-2 px-3">
                    Exempt sales
                  </th>
                  <td className="py-2 px-3 text-[var(--muted)]" dir="rtl">עסקאות פטורות</td>
                  <td className="py-2 px-3 text-right font-mono tabular-nums">
                    {formatCurrency(report.exemptSalesCents, currency)}
                  </td>
                </tr>
                <tr className="border-b border-[var(--line)]/50">
                  <th scope="row" className="text-left font-normal py-2 px-3">
                    Input VAT on fixed assets (equipment)
                  </th>
                  <td className="py-2 px-3 text-[var(--muted)]" dir="rtl">מס תשומות על ציוד (נכסים קבועים)</td>
                  <td className="py-2 px-3 text-right font-mono tabular-nums">
                    {formatCurrency(report.fixedAssetInputVatCents, currency)}
                  </td>
                </tr>
                <tr className="border-b border-[var(--line)]/50">
                  <th scope="row" className="text-left font-normal py-2 px-3">
                    Input VAT on other purchases
                  </th>
                  <td className="py-2 px-3 text-[var(--muted)]" dir="rtl">מס תשומות אחרות (הוצאות שוטפות)</td>
                  <td className="py-2 px-3 text-right font-mono tabular-nums">
                    {formatCurrency(report.otherInputVatCents, currency)}
                  </td>
                </tr>
                <tr className="border-t-2 border-[var(--line)] bg-[var(--panel)]">
                  <th scope="row" className="text-left font-bold py-3 px-3">
                    {report.toPayCents >= 0 ? 'Total VAT to pay' : 'Total VAT to reclaim'}
                  </th>
                  <td className="py-3 px-3 text-[var(--muted)] font-bold" dir="rtl">
                    {report.toPayCents >= 0 ? 'סך הכל לתשלום' : 'סך הכל להחזר'}
                  </td>
                  <td className={`py-3 px-3 text-right font-mono tabular-nums font-extrabold text-base ${report.toPayCents >= 0 ? 'text-[var(--text)]' : 'text-[var(--pos)]'}`}>
                    {formatCurrency(Math.abs(report.toPayCents), currency)}
                    {report.toPayCents < 0 && <span className="text-xs font-normal ml-1">(reclaim / להחזר)</span>}
                  </td>
                </tr>
              </tbody>
            </table>
          </ReportTableScroll>

          <div className="p-3 rounded-lg border border-[var(--line)] bg-[var(--surface)] text-xs text-[var(--muted)] space-y-1">
            <p>
              <b>Important notice:</b> This report is for calculation, management review, and reconciliation purposes only.
              It does not file a tax return, make a tax payment, or communicate with the Israel Tax Authority.
            </p>
            <p>
              Statutory filing requires submission via the Israel Tax Authority portal (שע״מ / Gov.il) or certified electronic reporting.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
