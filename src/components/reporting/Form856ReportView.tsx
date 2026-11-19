/**
 * A-23 (PLAN IL-5): the yearly report of tax withheld at source from vendor payments — Israel's
 * Form 856. Per vendor for one tax year: what was paid, the base the rate applied to, what was
 * withheld and the certificate numbers relied on, plus what is still missing. Read-only: nothing
 * here files the form, posts or pays anything (src/lib/tax/form856.ts does the arithmetic).
 */
import { useMemo, useState } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { LEDGER_COLLECTIONS } from '../../lib/ledgerCollections';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { downloadCsv } from '../../lib/csvExport';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { form856Notes, form856Rows, form856Summary, form856Year } from '../../lib/tax/form856';
import { form856ReviewExport, type Form856ReviewPayment } from '../../lib/tax/form856ReviewExport';
import { form856AuthorityCsv, form856AuthorityPayees, ilWithholdingFileNo } from '../../lib/tax/form856AuthorityCsv';
import { byCodeUnit } from '../../lib/codeUnitOrder';
import { RowTable } from '../ui/RowTable';
import { useReportText } from './useReportText';

const th = 'font-semibold py-1 px-2';

export default function Form856ReportView() {
  const reportText = useReportText();
  const { loading } = useLedgerCollections('payments');
  const payments = useLedgerStore(s => s.payments);
  const baseCurrency = useLedgerStore(s => s.baseCurrency) || 'ILS';
  const currentWorkspaceId = useAuthStore(s => s.currentWorkspaceId);
  const isGuest = useAuthStore(s => s.isGuest && !s.user);
  const paymentsLoaded = useDataNeedsStore(s => s.loaded.payments);
  const loadedWorkspaceId = useDataNeedsStore(s => s.loadedWorkspaceId);
  const paymentLoadError = useDataNeedsStore(s => s.failed.payments);
  const [acknowledgedScope, setAcknowledgedScope] = useState('');
  const thisYear = (getLocalDateISO() || new Date().toISOString()).slice(0, 4);
  const [year, setYear] = useState(thisYear);

  // The live browser cache may be capped or still belong to the previous workspace.
  // This report remains a review of recorded data, never a complete annual filing.
  const scopedPayments = useMemo(() => {
    const all = (payments || []) as Array<Form856ReviewPayment & { workspaceId?: string }>;
    return isGuest ? all : all.filter(payment => payment.workspaceId === currentWorkspaceId);
  }, [payments, isGuest, currentWorkspaceId]);
  const years = useMemo(() => {
    const found = new Set<string>([thisYear]);
    for (const payment of scopedPayments) {
      const y = form856Year(payment.date);
      if (y) found.add(y);
    }
    return [...found].sort(byCodeUnit).reverse();
  }, [scopedPayments, thisYear]);

  const rows = useMemo(() => form856Rows(scopedPayments, year), [scopedPayments, year]);
  const worksheet = useMemo(() => form856ReviewExport(scopedPayments, year, baseCurrency), [scopedPayments, year, baseCurrency]);
  // E-17: the authority-order CSV needs the payer's תיק ניכויים. Prefill it from the books-level
  // tax profile when one records an Israeli employer number, and keep any correction per
  // workspace — a typed number is never carried across a workspace switch, and no effect resets
  // state (react-hooks/set-state-in-effect).
  const workspace = useAuthStore(state => state.getCurrentWorkspace());
  const suggestedFileNo = useMemo(() => ilWithholdingFileNo(workspace?.taxProfiles), [workspace]);
  const [fileNoByWorkspace, setFileNoByWorkspace] = useState<Record<string, string>>({});
  const fileNoKey = currentWorkspaceId ?? 'none';
  const fileNoInput = fileNoByWorkspace[fileNoKey] ?? suggestedFileNo;
  const authority = useMemo(() => {
    const mapping = form856AuthorityPayees(scopedPayments, year);
    const csv = form856AuthorityCsv({ withholdingFileNo: fileNoInput, taxYear: year }, mapping.payees);
    return { ...csv, problems: [...mapping.problems, ...csv.problems] };
  }, [scopedPayments, year, fileNoInput]);
  const scopeKey = `${currentWorkspaceId ?? 'none'}:${year}`;
  const sourceBlockers = [
    ...(isGuest ? ['Demo data cannot be exported as a verified yearly record.'] : []),
    ...(!currentWorkspaceId ? ['Choose a workspace before downloading.'] : []),
    ...(loading || !paymentsLoaded || loadedWorkspaceId !== currentWorkspaceId ? ['The payment list has not finished loading for this workspace.'] : []),
    ...(paymentLoadError ? ['The payments read failed; retry the collection load first.'] : []),
    ...((payments || []).length >= LEDGER_COLLECTIONS.payments.cap ? ['The payments list hit its limit; older payments may be missing.'] : []),
    ...(!isGuest && (payments || []).some(payment => payment.workspaceId !== currentWorkspaceId) ? ['The payment cache contains records from a different workspace.'] : []),
    ...worksheet.blockers,
  ];
  const canDownloadWorksheet = worksheet.canDownloadForReview && sourceBlockers.length === 0 && acknowledgedScope === scopeKey;
  const canDownloadAuthority = canDownloadWorksheet && authority.canDownload;
  const authorityIssues = [...new Set([...authority.blockers, ...authority.problems])];
  const summary = useMemo(() => form856Summary(rows), [rows]);
  const notes = useMemo(() => form856Notes(rows), [rows]);
  const money = (cents: number) => formatCurrency(cents, baseCurrency);

  return (
    <section aria-labelledby="form-856-title" className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="form-856-title" className="text-lg font-bold text-[var(--text)]">{reportText('r.withholding-report-form-856', 'Withholding Report (Form 856)')}</h2>
          <p className="text-sm text-[var(--muted)]">
            {reportText('r.tax-withheld-at-source-from-payments-to-vendors', 'Tax withheld at source from payments to vendors, per vendor, for one tax year. Read-only: the figures come from the recorded payments, and nothing is filed here.')}
          </p>
        </div>
        <div className="flex items-end gap-2">
          <label htmlFor="form-856-year" className="text-xs font-semibold text-[var(--muted)]">{reportText('r.year', 'Year')}</label>
          <select id="form-856-year" value={year} onChange={e => setYear(e.target.value)}
            className="px-3 py-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] text-sm">
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>

        </div>
      </div>

      <div className="space-y-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 text-sm" aria-label={reportText('r.form-856-review-worksheet', 'Form 856 review worksheet')}>
        <p className="font-semibold">{reportText('r.review-worksheet-only-not-an-official-form-856-f', 'Review worksheet only — not an official Form 856 filing file')}</p>
        <p className="text-[var(--muted)]">{reportText('r.the-csv-contains-sensitive-vendor-details-the-br', 'The CSV contains sensitive vendor details. The browser payment list may omit older records; even an available download is not proof of complete annual history or accepted filing format. Check source payments and totals independently with an accountant.')}</p>
        {sourceBlockers.length > 0 && (
          <ul className="list-disc ps-5 text-[var(--muted)]" aria-label={reportText('r.worksheet-download-blockers', 'Worksheet download blockers')}>
            {[...new Set(sourceBlockers)].map(message => <li key={message}>{message}</li>)}
          </ul>
        )}
        {sourceBlockers.length === 0 && worksheet.notices.length > 0 && (
          <ul className="list-disc ps-5 text-[var(--muted)]" aria-label={reportText('r.worksheet-review-notes', 'Worksheet review notes')}>
            {worksheet.notices.map(message => <li key={message}>{message}</li>)}
          </ul>
        )}
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" checked={acknowledgedScope === scopeKey}
            onChange={event => setAcknowledgedScope(event.target.checked ? scopeKey : '')}
            disabled={sourceBlockers.length > 0 || !worksheet.canDownloadForReview} />
          {reportText('r.i-understand-this-is-a-review-of-recorded-paymen', 'I understand this is a review of recorded payments, not a complete or filing-ready return.')}
        </label>
        <button type="button" disabled={!canDownloadWorksheet}
          onClick={() => {
            if (!canDownloadWorksheet) return;
            downloadCsv(`form-856-review-${year}.csv`, [...worksheet.headers], worksheet.rows);
          }}
          className="min-h-11 rounded-xl border border-[var(--line)] px-4 py-2 text-sm font-semibold disabled:opacity-40">
          {reportText('r.download-review-worksheet-csv', 'Download review worksheet CSV')}
        </button>

        <div className="space-y-2 border-t border-[var(--line)] pt-3">
          <p className="font-semibold">{reportText('r.authority-order-csv-draft', 'Authority-order CSV (draft)')}</p>
          <p className="text-[var(--muted)]">{reportText('r.the-columns-follow-the-tax-authority-record-60', 'The columns follow the Tax Authority record-60 field order for the 2017–2025 interface: twenty fields, amounts in whole agorot zero-padded to each width. Fields the books do not record are written as zeros or blank. This is a CSV draft, not the 218-byte fixed-width file the authority transmits, and nothing is filed from here.')}</p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label htmlFor="form-856-file-no" className="block text-xs font-semibold text-[var(--muted)]">{reportText('r.withholding-file-number', 'Withholding file number (תיק ניכויים)')}</label>
              <input id="form-856-file-no" inputMode="numeric" maxLength={9} value={fileNoInput}
                onChange={event => setFileNoByWorkspace(previous => ({
                  ...previous,
                  [fileNoKey]: event.target.value.replace(/\D/g, '').slice(0, 9),
                }))}
                aria-describedby="form-856-file-no-hint"
                className="px-3 py-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] text-sm font-mono" />
              <p id="form-856-file-no-hint" className="text-xs text-[var(--muted)]">{reportText('r.nine-digits-as-assigned-by-the-income-tax-off', 'Nine digits, as assigned by the Income Tax office.')}</p>
            </div>
            <button type="button" disabled={!canDownloadAuthority}
              onClick={() => {
                if (!canDownloadAuthority) return;
                downloadCsv(`form-856-authority-${year}.csv`, authority.headers, authority.rows);
              }}
              className="min-h-11 rounded-xl border border-[var(--line)] px-4 py-2 text-sm font-semibold disabled:opacity-40">
              {reportText('r.download-authority-order-csv-draft', 'Download authority-order CSV (draft)')}
            </button>
          </div>
          {sourceBlockers.length === 0 && authorityIssues.length > 0 && (
            <ul className="list-disc ps-5 text-[var(--muted)]" aria-label={reportText('r.authority-csv-issues', 'Authority CSV issues')}>
              {authorityIssues.map(message => <li key={message}>{message}</li>)}
            </ul>
          )}
        </div>
      </div>

      {loading && <p className="text-sm text-[var(--muted)]">{reportText('r.loading', 'Loading…')}</p>}

      {rows.length === 0 && !loading && (
        <p className="text-sm text-[var(--muted)]">{reportText('r.no-vendor-payment-in', 'No vendor payment in')} {year} {reportText('r.has-tax-withheld-at-source', 'has tax withheld at source.')}</p>
      )}

      {rows.length > 0 && (
        <>
          <dl className="flex flex-wrap gap-x-8 gap-y-1 text-sm">
            <div className="flex gap-2"><dt className="text-[var(--muted)]">{reportText('r.vendors-2', 'Vendors')}</dt><dd className="font-mono">{summary.vendors}</dd></div>
            <div className="flex gap-2"><dt className="text-[var(--muted)]">{reportText('r.payments', 'Payments')}</dt><dd className="font-mono">{summary.payments}</dd></div>
            <div className="flex gap-2"><dt className="text-[var(--muted)]">{reportText('r.paid', 'Paid')}</dt><dd className="font-mono">{money(summary.paidCents)}</dd></div>
            <div className="flex gap-2"><dt className="text-[var(--muted)]">{reportText('r.withheld', 'Withheld')}</dt><dd className="font-mono">{money(summary.withheldCents)}</dd></div>
          </dl>
          <ul className="list-disc ps-6 text-sm text-[var(--muted)]">
            {notes.map(note => <li key={note}>{note}</li>)}
          </ul>
          <div className="overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3">
            <RowTable
              rowClassName="border-b border-[var(--line)]/50"
              caption={(<>{reportText('r.per-vendor', 'Per vendor (')}{rows.length})</>)}
              rows={rows}
              rowKey={row => row.contactId}
              captionClassName="text-left font-semibold text-[var(--text)] pb-1"
              tableClassName="w-full text-sm"
              headRowClassName="border-b border-[var(--line)] text-xs text-[var(--muted)]"
              bodyClassName=""
              columns={[
                { header: reportText('r.vendor', 'Vendor'), className: "text-left font-normal py-1 px-2", headClassName: `text-left ${th}`, cell: (row) => <bdi>{row.name}</bdi> },
                { header: reportText('r.tax-id-2', 'Tax id'), className: "py-1 px-2 font-mono", headClassName: `text-left ${th}`, cell: (row) => row.taxId || '—' },
                { header: reportText('r.payments', 'Payments'), align: 'right', className: "font-mono py-1 px-2", headClassName: `text-right ${th}`, cell: (row) => row.payments },
                { header: reportText('r.paid', 'Paid'), align: 'right', className: "font-mono py-1 px-2", headClassName: `text-right ${th}`, cell: (row) => money(row.paidCents) },
                { header: reportText('r.base', 'Base'), align: 'right', className: "font-mono py-1 px-2", headClassName: `text-right ${th}`, cell: (row) => money(row.baseCents) },
                { header: reportText('r.withheld', 'Withheld'), align: 'right', className: "font-mono py-1 px-2", headClassName: `text-right ${th}`, cell: (row) => money(row.withheldCents) },
                { header: reportText('r.rate', 'Rate'), align: 'right', className: "font-mono py-1 px-2", headClassName: `text-right ${th}`, cell: (row) => (<>{row.effectiveRatePercent}%</>) },
                { header: reportText('r.certificates', 'Certificates'), className: "py-1 px-2", headClassName: `text-left ${th}`, cell: (row) => <bdi>{row.certificates.join(', ') || '—'}</bdi> },
                { header: reportText('r.months', 'Months'), className: "py-1 px-2 font-mono", headClassName: `text-left ${th}`, cell: (row) => row.months.join(', ') },
                { header: reportText('r.missing', 'Missing'), align: 'right', className: "font-mono py-1 px-2", headClassName: `text-right ${th}`, cell: (row) => row.missingCertificates || '—' },
              ]}
            />
          </div>
        </>
      )}
    </section>
  );
}
