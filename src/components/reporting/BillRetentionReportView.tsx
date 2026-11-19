import { useReportDates } from './useReportDates';
import ReportSchedule from './ReportSchedule';
/**
 * A-127: Projects — retention (holdback) tracking on milestone bills (report + tracking editor).
 */
import React, { useMemo, useState } from 'react';
import { CheckCircle2, Download, Plus, Scale } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { useEntityOperations } from '../../hooks/useEntityOperations';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { downloadCsv } from '../../lib/csvExport';
import { formatCurrency, getLocalDateISO, readAmountCents } from '../../lib/utils';
import {
  BILL_RETENTION_CSV_HEADERS,
  billRetentionCsvRows,
  computeBillRetentionReport,
  retentionInputProblem,
} from '../../lib/billRetention';
import { useReportText, fill } from './useReportText';

/** Code names, form numbers, paths and identifiers shown as-is: they are not words to translate (EU-G1). */
const CODE_NAMES = { c0: 'Tower Phase 2' } as const;

const field = 'w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white';

export default function BillRetentionReportView() {
  const dates = useReportDates();
  const reportText = useReportText();
  const bills = useLedgerStore(s => s.bills);
  const projects = useLedgerStore(s => s.projects);
  const dimensionNodes = useLedgerStore(s => s.dimensionNodes);
  const { loading } = useLedgerCollections('bills', 'projects');
  const workspaceCurrency = useAuthStore(s => s.getCurrentWorkspace()?.currency) || 'USD';
  const canWrite = useCurrentRole() !== 'viewer';
  const { updateEntity } = useEntityOperations();

  const [asOfDate, setAsOfDate] = useState(() => getLocalDateISO());
  const [billId, setBillId] = useState('');
  const [heldInput, setHeldInput] = useState('');
  const [releaseDate, setReleaseDate] = useState('');
  const [projectLabel, setProjectLabel] = useState('');
  const [notes, setNotes] = useState('');

  const eligibleBills = useMemo(
    () => (bills || []).filter(b => !['draft', 'void', 'cancelled', 'rejected'].includes(String(b.status))),
    [bills],
  );

  const report = useMemo(
    () => computeBillRetentionReport(bills || [], asOfDate, workspaceCurrency, dimensionNodes, projects),
    [bills, asOfDate, workspaceCurrency, dimensionNodes, projects],
  );

  const handleSaveRetention = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetBill = eligibleBills.find(b => b.id === billId);
    if (!targetBill) {
      toast.error('Choose an issued bill first.');
      return;
    }
    const heldCents = readAmountCents(heldInput);
    if (heldCents === null) {
      toast.error('Enter the amount held back, for example 500.00');
      return;
    }
    const problem = retentionInputProblem({
      billAmountCents: targetBill.amountCents || 0,
      heldCents,
      releaseDate: releaseDate || undefined,
    });
    if (problem) {
      toast.error(problem);
      return;
    }
    await updateEntity('bills', targetBill.id, {
      metadata: {
        ...(targetBill.metadata || {}),
        retention: {
          heldCents,
          ...(releaseDate ? { releaseDate } : {}),
          ...(projectLabel.trim() ? { project: projectLabel.trim() } : {}),
          ...(notes.trim() ? { notes: notes.trim().slice(0, 240) } : {}),
        },
      },
    });
    setHeldInput('');
    setNotes('');
  };

  const handleMarkReleased = async (targetBillId: string) => {
    const targetBill = (bills || []).find(b => b.id === targetBillId);
    if (!targetBill) return;
    const prev = (targetBill.metadata?.retention as Record<string, unknown> | undefined) || {};
    await updateEntity('bills', targetBill.id, {
      metadata: {
        ...(targetBill.metadata || {}),
        retention: { ...prev, releasedAt: asOfDate },
      },
    });
  };

  if (loading) {
    return <p className="p-6 text-sm text-slate-600 dark:text-slate-400">{reportText('r.loading-milestone-bill-retention', 'Loading milestone bill retention…')}</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
            <Scale className="w-6 h-6 text-indigo-600" aria-hidden="true" />
            {reportText('r.retention-holdbacks-on-milestone-bills', 'Retention (Holdbacks) on Milestone Bills')}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            {reportText('r.tracks-contractual-retention-held-back-on-suppli', 'Tracks contractual retention held back on supplier and subcontractor milestone bills, grouped strictly per currency. Tracking metadata only — never alters posted bill totals or ledger balances.')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => downloadCsv(`bill-retention-${asOfDate}.csv`, BILL_RETENTION_CSV_HEADERS, billRetentionCsvRows(report.rows))}
          className="min-h-11 px-4 py-2 text-sm font-semibold rounded-lg border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-2"
        >
          <Download className="w-4 h-4" aria-hidden="true" /> {reportText('r.export-csv', 'Export CSV')}
        </button>
      </div>

      <div className="max-w-xs">
        <label htmlFor="ret-as-of" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
          {reportText('r.as-of-date-release-due-check', 'As of date (release due check)')}
        </label>
        <input id="ret-as-of" type="date" value={asOfDate} onChange={e => setAsOfDate(e.target.value)} className={field} />
      </div>

      {report.totalsByCurrency.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {report.totalsByCurrency.map(tot => (
            <div key={tot.currency} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-1">
              <div className="text-xs font-bold uppercase tracking-wider text-[var(--muted)]">{tot.currency} {reportText('r.holdbacks', 'holdbacks')}</div>
              <div className="text-lg font-bold tabular-nums text-slate-900 dark:text-white">
                {formatCurrency(tot.heldOpenCents, tot.currency)} <span className="text-xs font-normal text-[var(--muted)]">{reportText('r.open-held', 'open held')}</span>
              </div>
              <div className="text-xs tabular-nums text-amber-700 dark:text-amber-300">
                {reportText('r.past-release-date', 'Past release date:')} {formatCurrency(tot.pastDueCents, tot.currency)} {reportText('r.released', '· Released:')} {formatCurrency(tot.releasedCents, tot.currency)}
              </div>
            </div>
          ))}
        </div>
      )}

      {canWrite && (
        <form onSubmit={handleSaveRetention} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">{reportText('r.record-retention-holdback-on-an-issued-bill', 'Record retention holdback on an issued bill')}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <label htmlFor="ret-bill" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">{reportText('r.issued-bill', 'Issued bill')}</label>
              <select id="ret-bill" value={billId} onChange={e => setBillId(e.target.value)} className={field}>
                <option value="">{reportText('r.select-bill', 'Select bill…')}</option>
                {eligibleBills.map(b => (
                  <option key={b.id} value={b.id}>
                    {b.number || b.id} — {b.vendorName} ({formatCurrency(b.amountCents || 0, b.currency || workspaceCurrency)})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="ret-held" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">{reportText('r.held-back-amount', 'Held back amount')}</label>
              <input id="ret-held" type="text" inputMode="decimal" placeholder="500.00" value={heldInput} onChange={e => setHeldInput(e.target.value)} className={field} />
            </div>
            <div>
              <label htmlFor="ret-due" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">{reportText('r.release-due-date', 'Release due date')}</label>
              <input id="ret-due" type="date" value={releaseDate} onChange={e => setReleaseDate(e.target.value)} className={field} />
            </div>
            <div>
              <label htmlFor="ret-proj" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">{reportText('r.project-optional', 'Project (optional)')}</label>
              <input
                id="ret-proj"
                list="ret-project-list"
                type="text"
                placeholder={CODE_NAMES.c0}
                value={projectLabel}
                onChange={e => setProjectLabel(e.target.value)}
                className={field}
              />
              <datalist id="ret-project-list">
                {(projects || []).map(p => <option key={p.id} value={p.name} />)}
              </datalist>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex-1 min-w-[200px]">
              <label htmlFor="ret-notes" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">{reportText('r.milestone-release-condition', 'Milestone / release condition')}</label>
              <input id="ret-notes" type="text" maxLength={240} placeholder={reportText('r.10-held-until-final-inspection-certificate', '10% held until final inspection certificate')} value={notes} onChange={e => setNotes(e.target.value)} className={field} />
            </div>
            <button type="submit" className="min-h-11 px-4 py-2 text-sm font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white inline-flex items-center gap-1.5">
              <Plus className="w-4 h-4" aria-hidden="true" /> {reportText('r.save-holdback', 'Save holdback')}
            </button>
          </div>
        </form>
      )}

      {report.rows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center">
          <p className="text-sm font-semibold text-slate-900 dark:text-white">{reportText('r.no-retention-holdbacks-recorded', 'No retention holdbacks recorded')}</p>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
            {reportText('r.attach-a-holdback-amount-and-release-date-to-any', 'Attach a holdback amount and release date to any issued milestone bill above to track upcoming and past-due releases per project and currency.')}
          </p>
        </div>
      ) : (
        <div className="min-w-0 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <ReportSchedule
            caption={reportText('r.milestone-bill-retention-schedule', 'Milestone bill retention schedule')}
            captionClassName="sr-only"
            headRowClassName="border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-600 dark:text-slate-400"
            bodyClassName="divide-y divide-slate-200 dark:divide-slate-800"
            rows={report.rows} rowKey={r => r.billId}
            columns={[
              { header: reportText('r.bill-2', 'Bill'), className: 'font-medium text-slate-900 dark:text-white', cell: r => <>{r.billNumber}
                    <div className="text-xs text-[var(--muted)]">{dates.dateText(r.billDate)}</div></> },
              { header: reportText('r.vendor-project', 'Vendor / Project'), className: 'text-slate-800 dark:text-slate-200', cell: r => <>{r.vendorName}
                    <div className="text-xs text-[var(--muted)]">{r.project}</div></> },
              { header: reportText('r.gross-bill', 'Gross bill'), align: 'right', className: 'tabular-nums', cell: r => formatCurrency(r.grossBillCents, r.currency) },
              { header: reportText('r.held-back', 'Held back'), align: 'right', className: 'tabular-nums font-semibold text-slate-900 dark:text-white', cell: r => formatCurrency(r.heldCents, r.currency) },
              { header: reportText('r.before-release', 'Before release'), align: 'right', className: 'tabular-nums text-slate-600 dark:text-slate-400', cell: r => formatCurrency(r.netPayableBeforeReleaseCents, r.currency) },
              { header: reportText('r.release-due', 'Release due'), className: 'tabular-nums', cell: r => r.releaseDate ? dates.dateText(r.releaseDate) : reportText('r.unscheduled', 'Unscheduled') },
              { header: reportText('r.status', 'Status'), cell: r => <span className={`inline-block px-2 py-0.5 text-xs font-semibold rounded ${
                      r.state === 'past-due'
                        ? 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300'
                        : r.state === 'released'
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                          : 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200'
                    }`}>
                      {r.state === 'past-due' ? reportText('r.due-for-release', 'Due for release') : r.state === 'released' ? fill(reportText('r.released-0', 'Released ({0})'), { 0: dates.dateText(r.releasedAt) }) : r.state}
                    </span> },
              canWrite ? { header: reportText('r.actions', 'Actions'), align: 'right', cell: r => r.state !== 'released' && (
                        <button
                          type="button"
                          onClick={() => handleMarkReleased(r.billId)}
                          className="min-h-11 px-3 py-1.5 text-xs font-semibold rounded-lg border border-emerald-300 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 inline-flex items-center gap-1"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" /> {reportText('r.mark-released', 'Mark released')}
                        </button>
                      ) } : false,
            ]} />
        </div>
      )}
    </div>
  );
}
