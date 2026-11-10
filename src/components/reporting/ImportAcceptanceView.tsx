import React, { useEffect, useMemo, useState } from 'react';
import { getIdToken } from '../../firebase';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { compareImport, readSourceTrialBalance, type LedgerRow, type SourceTrialBalance } from '../../lib/importAcceptance';
import ReportEmptyState from './ReportEmptyState';

import { BRAND_NAME } from '../../config/brand';
const field = 'px-2 py-1.5 border border-[var(--line)] rounded bg-[var(--panel)] text-[var(--text)]';

/**
 * Import acceptance (AU-4): after moving books in from QuickBooks or a CSV file, upload the old system's trial
 * balance for the move date; LedgerFlow's trial balance on that date is set against it account by account, with
 * the trial balance, A/R, A/P, cash and tax payable totals, and every difference named (src/lib/importAcceptance.ts).
 * Read only: LedgerFlow's figures come from the server's trial balance report; nothing is changed.
 */
export default function ImportAcceptanceView() {
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
      const res = await fetch(`/api/v1/reports/trial-balance?${key}`, { headers: { Authorization: `Bearer ${await getIdToken()}` } });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !Array.isArray(body.accounts)) throw new Error(body.message || body.error || 'The trial balance could not be read');
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
      <h2 id="import-acceptance-title" className="text-lg font-bold text-[var(--text)]">Import acceptance</h2>
      <p className="text-sm text-[var(--muted)]">Upload the old system's trial balance for the date the books moved (QuickBooks: Reports → Trial Balance → Export to CSV). Each account and the main totals are set against {BRAND_NAME}'s on the same date.</p>
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1 text-[var(--muted)]">Source trial balance (CSV)
          <input type="file" accept=".csv,text/csv" onChange={e => { void readFile(e.target.files?.[0]); }} className="text-[var(--text)]" />
        </label>
        <label className="flex flex-col gap-1 text-[var(--muted)]">As of<input type="date" value={asOf} onChange={e => setAsOf(e.target.value)} className={field} /></label>
      </div>
      {source && source.data.lines.length === 0 && <p role="alert" className="text-sm text-rose-600">{source.data.problems[0] || 'The file has no account lines'}</p>}
      {key && !shown && <p className="text-sm text-[var(--muted)]">Loading…</p>}
      {shown?.error && <p role="alert" className="text-sm text-rose-600">{shown.error}</p>}
      {!source && !key && <ReportEmptyState title="No source trial balance yet"
        description="Export a trial balance CSV from the old system for the move date, choose that date here, then upload the file. The comparison is read-only and does not change the books." />}
      {acceptance && source && source.data.lines.length > 0 && (
        <div className="space-y-3" data-testid="import-acceptance">
          <p role="status" className={`text-sm font-semibold ${acceptance.accepted ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}`}>
            {acceptance.accepted
              ? `Accepted: every account in ${source.name} agrees with ${BRAND_NAME} on ${asOf}.`
              : `Not accepted yet: ${acceptance.differences.length} account${acceptance.differences.length === 1 ? '' : 's'} differ${acceptance.differences.length === 1 ? 's' : ''}${acceptance.problems.length ? `, and the file has ${acceptance.problems.length} problem${acceptance.problems.length === 1 ? '' : 's'}` : ''}.`}
          </p>
          {acceptance.problems.map(p => <p key={p} className="text-xs text-amber-700 dark:text-amber-400">{p}</p>)}
          <div className="overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3">
            <table className="w-full text-sm">
              <caption className="text-left font-semibold text-[var(--text)] pb-1">Totals on {asOf}</caption>
              <thead><tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
                <th scope="col" className="text-left font-semibold py-1">Total</th><th scope="col" className="text-right font-semibold py-1">Source</th>
                <th scope="col" className="text-right font-semibold py-1">{BRAND_NAME}</th><th scope="col" className="text-right font-semibold py-1">Difference</th>
              </tr></thead>
              <tbody>{acceptance.checks.map(c => (
                <tr key={c.key} className="border-b border-[var(--line)]/50">
                  <th scope="row" className="text-left font-normal py-1">{c.label}</th>
                  <td className="text-right font-mono py-1">{money(c.sourceCents)}</td><td className="text-right font-mono py-1">{money(c.ledgerCents)}</td>
                  <td className={`text-right font-mono py-1 ${c.differenceCents ? 'text-rose-600' : ''}`}>{c.differenceCents ? money(c.differenceCents) : 'agrees'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {acceptance.differences.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3">
              <table className="w-full text-sm">
                <caption className="text-left font-semibold text-[var(--text)] pb-1">Accounts that differ (balances as debits; credits are negative). {acceptance.agreeing} agree.</caption>
                <thead><tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
                  <th scope="col" className="text-left font-semibold py-1">Account</th><th scope="col" className="text-left font-semibold py-1">Why</th>
                  <th scope="col" className="text-right font-semibold py-1">Source</th><th scope="col" className="text-right font-semibold py-1">{BRAND_NAME}</th>
                  <th scope="col" className="text-right font-semibold py-1">Difference</th>
                </tr></thead>
                <tbody>{acceptance.differences.map(d => (
                  <tr key={d.label} className="border-b border-[var(--line)]/50">
                    <th scope="row" className="text-left font-normal py-1"><bdi>{d.label}</bdi></th><td className="py-1">{d.why}</td>
                    <td className="text-right font-mono py-1">{money(d.sourceCents)}</td><td className="text-right font-mono py-1">{money(d.ledgerCents)}</td>
                    <td className="text-right font-mono py-1 text-rose-600">{money(d.differenceCents)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
