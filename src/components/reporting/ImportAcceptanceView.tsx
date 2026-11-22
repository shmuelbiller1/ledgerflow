import React, { useEffect, useMemo, useState } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { compareImport, readSourceTrialBalance, type LedgerRow, type SourceTrialBalance } from '../../lib/importAcceptance';
import ReportEmptyState from './ReportEmptyState';

import { BRAND_NAME } from '../../config/brand';
import { runCommand } from '../../lib/runCommand';
import { RowTable } from '../ui/RowTable';
import { useReportText, fill } from './useReportText';
const field = 'px-2 py-1.5 border border-[var(--line)] rounded bg-[var(--panel)] text-[var(--text)]';

/**
 * Import acceptance (AU-4): after moving books in from QuickBooks or a CSV file, upload the old system's trial
 * balance for the move date; LedgerFlow's trial balance on that date is set against it account by account, with
 * the trial balance, A/R, A/P, cash and tax payable totals, and every difference named (src/lib/importAcceptance.ts).
 * Read only: LedgerFlow's figures come from the server's trial balance report; nothing is changed.
 */
export default function ImportAcceptanceView() {
  const reportText = useReportText();
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const accounts = useLedgerStore(s => s.accounts);
  const [asOf, setAsOf] = useState(getLocalDateISO());
  const [source, setSource] = useState<{ name: string; data: SourceTrialBalance } | null>(null);
  const [result, setResult] = useState<{ key: string; rows?: LedgerRow[]; error?: string } | null>(null);
  const currency = workspace?.currency || 'USD';
  const key = workspace && source && /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? new URLSearchParams({ workspaceId: workspace.id, asOfDate: asOf }).toString() : '';

  useEffect(() => {
    if (!key) return;
    let live = true;
    (async () => {
      const body = await runCommand<{ accounts?: LedgerRow[] }>({ path: `/api/v1/reports/trial-balance?${key}` }) ?? {};
      if (!Array.isArray(body.accounts)) throw new Error('The trial balance could not be read');
      return body.accounts as LedgerRow[];
    })().then(rows => { if (live) setResult({ key, rows }); }).catch(err => { if (live) setResult({ key, error: err instanceof Error ? err.message : String(err) }); });
    return () => { live = false; };
  }, [key]);
  const shown = result && result.key === key ? result : null;
  const acceptance = useMemo(() => (source && shown?.rows ? compareImport(source.data, accounts, shown.rows, workspace?.defaultAccountMappings) : null), [source, shown, accounts, workspace?.defaultAccountMappings]);
  const money = (cents: number | null) => (cents === null ? '—' : formatCurrency(cents, currency));

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    setSource({ name: file.name, data: readSourceTrialBalance(text) });
  };

  return (
    <section aria-labelledby="import-acceptance-title" className="space-y-4">
      <h2 id="import-acceptance-title" className="text-lg font-bold text-[var(--text)]">{reportText('r.import-acceptance', 'Import acceptance')}</h2>
      <p className="text-sm text-[var(--muted)]">{reportText('r.upload-the-old-system-s-trial-balance-for-the-da', 'Upload the old system\'s trial balance for the date the books moved (QuickBooks: Reports → Trial Balance → Export to CSV). Each account and the main totals are set against')} {BRAND_NAME}{reportText('r.s-on-the-same-date', '\'s on the same date.')}</p>
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1 text-[var(--muted)]">{reportText('r.source-trial-balance-csv', 'Source trial balance (CSV)')}
          <input type="file" accept=".csv,text/csv" onChange={e => { void readFile(e.target.files?.[0]); }} className="text-[var(--text)]" />
        </label>
        <label className="flex flex-col gap-1 text-[var(--muted)]">{reportText('r.as-of-2', 'As of')}<input type="date" value={asOf} onChange={e => setAsOf(e.target.value)} className={field} /></label>
      </div>
      {source && source.data.lines.length === 0 && <p role="alert" className="text-sm text-rose-600">{source.data.problems[0] || reportText('r.the-file-has-no-account-lines', 'The file has no account lines')}</p>}
      {key && !shown && <p className="text-sm text-[var(--muted)]">{reportText('r.loading', 'Loading…')}</p>}
      {shown?.error && <p role="alert" className="text-sm text-rose-600">{shown.error}</p>}
      {!source && !key && <ReportEmptyState title={reportText('r.no-source-trial-balance-yet', 'No source trial balance yet')}
        description={reportText('r.export-a-trial-balance-csv-from-the-old-system-f', 'Export a trial balance CSV from the old system for the move date, choose that date here, then upload the file. The comparison is read-only and does not change the books.')} />}
      {acceptance && source && source.data.lines.length > 0 && (
        <div className="space-y-3" data-testid="import-acceptance">
          <p role="status" className={`text-sm font-semibold ${acceptance.accepted ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}`}>
            {acceptance.accepted
              ? fill(reportText('r.accepted-every-account-in-0-agrees-with-1-on-2', 'Accepted: every account in {0} agrees with {1} on {2}.'), { 0: source.name, 1: BRAND_NAME, 2: asOf })
              : `${acceptance.differences.length === 1 ? fill(reportText('r.not-accepted-one', 'Not accepted yet: {0} account differs'), { 0: acceptance.differences.length }) : fill(reportText('r.not-accepted-many', 'Not accepted yet: {0} accounts differ'), { 0: acceptance.differences.length })}${acceptance.problems.length ? (acceptance.problems.length === 1 ? fill(reportText('r.file-problem-one', ', and the file has {0} problem'), { 0: acceptance.problems.length }) : fill(reportText('r.file-problem-many', ', and the file has {0} problems'), { 0: acceptance.problems.length })) : ''}.`}
          </p>
          {acceptance.problems.map(p => <p key={p} className="text-xs text-amber-700 dark:text-amber-400">{p}</p>)}
          <div className="overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3">
            <RowTable
caption={<>{reportText('r.totals-on', 'Totals on')} {asOf}</>}
captionClassName={"text-left font-semibold text-[var(--text)] pb-1"}
tableClassName={"w-full text-sm"}
headRowClassName={''}
headerRowClassName={"border-b border-[var(--line)] text-xs text-[var(--muted)]"}
bodyClassName={''}
rows={acceptance.checks}
rowKey={c => c.key}
rowHeaderClassName={''}
rowClassName={"border-b border-[var(--line)]/50"}
columns={[
{ header: reportText('r.total', 'Total'), headClassName: "text-left font-semibold py-1", className: "text-left font-normal py-1", cell: c => (c.label) },
{ header: reportText('r.source', 'Source'), headClassName: "text-right font-semibold py-1", className: "text-right font-mono py-1", cell: c => (money(c.sourceCents)) },
{ header: BRAND_NAME, headClassName: "text-right font-semibold py-1", className: "text-right font-mono py-1", cell: c => (money(c.ledgerCents)) },
{ header: reportText('r.col-difference', 'Difference'), headClassName: "text-right font-semibold py-1", cellProps: c => ({ "className": `text-right font-mono py-1 ${c.differenceCents ? 'text-rose-600' : ''}` }), cell: c => (c.differenceCents ? money(c.differenceCents) : reportText('r.agrees', 'agrees')) }
]}
/>
          </div>
          {acceptance.differences.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3">
              <RowTable
                rowClassName="border-b border-[var(--line)]/50"
                caption={(<>{reportText('r.accounts-that-differ-balances-as-debits-credits', 'Accounts that differ (balances as debits; credits are negative).')} {acceptance.agreeing} {reportText('r.agree', 'agree.')}</>)}
                rows={acceptance.differences}
                rowKey={d => d.label}
                captionClassName="text-left font-semibold text-[var(--text)] pb-1"
                tableClassName="w-full text-sm"
                headRowClassName="border-b border-[var(--line)] text-xs text-[var(--muted)]"
                bodyClassName=""
                columns={[
                  { header: reportText('r.account', 'Account'), className: "text-left font-normal py-1", headClassName: "text-left font-semibold py-1", cell: (d) => <bdi>{d.label}</bdi> },
                  { header: reportText('r.why', 'Why'), className: "py-1", headClassName: "text-left font-semibold py-1", cell: (d) => d.why },
                  { header: reportText('r.source', 'Source'), align: 'right', className: "font-mono py-1", headClassName: "font-semibold py-1", cell: (d) => money(d.sourceCents) },
                  { header: BRAND_NAME, align: 'right', className: "font-mono py-1", headClassName: "font-semibold py-1", cell: (d) => money(d.ledgerCents) },
                  { header: reportText('r.col-difference', 'Difference'), align: 'right', className: "font-mono py-1 text-rose-600", headClassName: "font-semibold py-1", cell: (d) => money(d.differenceCents) },
                ]}
              />
            </div>
          )}
        </div>
      )}
    </section>
  );
}
