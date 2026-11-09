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
import { byCodeUnit } from '../../lib/codeUnitOrder';

const th = 'font-semibold py-1 px-2';

export default function Form856ReportView() {
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
  const summary = useMemo(() => form856Summary(rows), [rows]);
  const notes = useMemo(() => form856Notes(rows), [rows]);
  const money = (cents: number) => formatCurrency(cents, baseCurrency);

  return (
    <section aria-labelledby="form-856-title" className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="form-856-title" className="text-lg font-bold text-[var(--text)]">Withholding Report (Form 856)</h2>
          <p className="text-sm text-[var(--muted)]">
            Tax withheld at source from payments to vendors, per vendor, for one tax year. Read-only: the figures come from the recorded payments, and nothing is filed here.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <label htmlFor="form-856-year" className="text-xs font-semibold text-[var(--muted)]">Year</label>
          <select id="form-856-year" value={year} onChange={e => setYear(e.target.value)}
            className="px-3 py-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] text-sm">
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>

        </div>
      </div>

      <div className="space-y-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 text-sm" aria-label="Form 856 review worksheet">
        <p className="font-semibold">Review worksheet only — not an official Form 856 filing file</p>
        <p className="text-[var(--muted)]">The CSV contains sensitive vendor details. The browser payment list may omit older records; even an available download is not proof of complete annual history or accepted filing format. Check source payments and totals independently with an accountant.</p>
        {sourceBlockers.length > 0 && (
          <ul className="list-disc ps-5 text-[var(--muted)]" aria-label="Worksheet download blockers">
            {[...new Set(sourceBlockers)].map(message => <li key={message}>{message}</li>)}
          </ul>
        )}
        {sourceBlockers.length === 0 && worksheet.notices.length > 0 && (
          <ul className="list-disc ps-5 text-[var(--muted)]" aria-label="Worksheet review notes">
            {worksheet.notices.map(message => <li key={message}>{message}</li>)}
          </ul>
        )}
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" checked={acknowledgedScope === scopeKey}
            onChange={event => setAcknowledgedScope(event.target.checked ? scopeKey : '')}
            disabled={sourceBlockers.length > 0 || !worksheet.canDownloadForReview} />
          I understand this is a review of recorded payments, not a complete or filing-ready return.
        </label>
        <button type="button" disabled={!canDownloadWorksheet}
          onClick={() => {
            if (!canDownloadWorksheet) return;
            downloadCsv(`form-856-review-${year}.csv`, [...worksheet.headers], worksheet.rows);
          }}
          className="min-h-11 rounded-xl border border-[var(--line)] px-4 py-2 text-sm font-semibold disabled:opacity-40">
          Download review worksheet CSV
        </button>
      </div>

      {loading && <p className="text-sm text-[var(--muted)]">Loading…</p>}

      {rows.length === 0 && !loading && (
        <p className="text-sm text-[var(--muted)]">No vendor payment in {year} has tax withheld at source.</p>
      )}

      {rows.length > 0 && (
        <>
          <dl className="flex flex-wrap gap-x-8 gap-y-1 text-sm">
            <div className="flex gap-2"><dt className="text-[var(--muted)]">Vendors</dt><dd className="font-mono">{summary.vendors}</dd></div>
            <div className="flex gap-2"><dt className="text-[var(--muted)]">Payments</dt><dd className="font-mono">{summary.payments}</dd></div>
            <div className="flex gap-2"><dt className="text-[var(--muted)]">Paid</dt><dd className="font-mono">{money(summary.paidCents)}</dd></div>
            <div className="flex gap-2"><dt className="text-[var(--muted)]">Withheld</dt><dd className="font-mono">{money(summary.withheldCents)}</dd></div>
          </dl>
          <ul className="list-disc ps-6 text-sm text-[var(--muted)]">
            {notes.map(note => <li key={note}>{note}</li>)}
          </ul>
          <div className="overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3">
            <table className="w-full text-sm">
              <caption className="text-left font-semibold text-[var(--text)] pb-1">Per vendor ({rows.length})</caption>
              <thead>
                <tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
                  <th scope="col" className={`text-left ${th}`}>Vendor</th>
                  <th scope="col" className={`text-left ${th}`}>Tax id</th>
                  <th scope="col" className={`text-right ${th}`}>Payments</th>
                  <th scope="col" className={`text-right ${th}`}>Paid</th>
                  <th scope="col" className={`text-right ${th}`}>Base</th>
                  <th scope="col" className={`text-right ${th}`}>Withheld</th>
                  <th scope="col" className={`text-right ${th}`}>Rate</th>
                  <th scope="col" className={`text-left ${th}`}>Certificates</th>
                  <th scope="col" className={`text-left ${th}`}>Months</th>
                  <th scope="col" className={`text-right ${th}`}>Missing</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.contactId} className="border-b border-[var(--line)]/50">
                    <th scope="row" className="text-left font-normal py-1 px-2"><bdi>{row.name}</bdi></th>
                    <td className="py-1 px-2 font-mono">{row.taxId || '—'}</td>
                    <td className="text-right font-mono py-1 px-2">{row.payments}</td>
                    <td className="text-right font-mono py-1 px-2">{money(row.paidCents)}</td>
                    <td className="text-right font-mono py-1 px-2">{money(row.baseCents)}</td>
                    <td className="text-right font-mono py-1 px-2">{money(row.withheldCents)}</td>
                    <td className="text-right font-mono py-1 px-2">{row.effectiveRatePercent}%</td>
                    <td className="py-1 px-2"><bdi>{row.certificates.join(', ') || '—'}</bdi></td>
                    <td className="py-1 px-2 font-mono">{row.months.join(', ')}</td>
                    <td className="text-right font-mono py-1 px-2">{row.missingCertificates || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
