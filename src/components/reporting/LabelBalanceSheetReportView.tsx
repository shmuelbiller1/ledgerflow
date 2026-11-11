import { displayDimensionName } from '../../lib/dimensionUtils';
import React, { useEffect, useState } from 'react';
import { getIdToken } from '../../firebase';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { LABEL_ROLES, labelRole } from '../../lib/labelRoles';

type Kind = 'asset' | 'liability' | 'equity';
interface Sheet { assets: Record<string, number>; liabilities: Record<string, number>; equity: Record<string, number>; totalAssets: number; totalLiabilities: number; totalEquity: number; netIncome: number; totalClaims: number; isBalanced: boolean }
interface Report { sheet: Sheet; notLabelled: { lines: number; openings: number; sheet: Sheet }; rows: Array<{ id: string; name: string; code?: string; type: Kind }> }
const SECTIONS: Array<[Kind, string, 'assets' | 'liabilities' | 'equity']> = [['asset', 'Assets', 'assets'], ['liability', 'Liabilities', 'liabilities'], ['equity', 'Equity', 'equity']];
const field = 'px-2 py-1.5 border border-[var(--line)] rounded bg-[var(--panel)] text-[var(--text)]';

/**
 * Balance sheet by label (W5-BS): choose a label (Property, Project, Location…), one of its values and a date; the
 * assets, liabilities, equity and profit to date of the posted lines that carry that value. Lines with no value for
 * the label, and opening balances, are shown in their own column and never shared out, so a value whose sheet does
 * not balance says so. Read by the server from the full history (src/server/reports/byLabel.ts).
 */
export default function LabelBalanceSheetReportView() {
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const nodes = useLedgerStore(s => s.dimensionNodes || []);
  const dimensions = workspace?.dimensions || [];
  const [pickedDimension, setPickedDimension] = useState('');
  const dimensionId = pickedDimension || dimensions[0]?.id || '';
  const values = nodes.filter(n => n.dimensionId === dimensionId);
  const [picked, setPicked] = useState<{ dimensionId: string; value: string } | null>(null);
  const value = picked && picked.dimensionId === dimensionId ? picked.value : values[0]?.id || '';
  const [endDate, setEndDate] = useState(getLocalDateISO());
  const [result, setResult] = useState<{ key: string; report?: Report; error?: string } | null>(null);
  const currency = workspace?.currency || 'USD';
  const key = workspace && dimensionId && value && endDate ? new URLSearchParams({ workspaceId: workspace.id, dimensionId, value, endDate }).toString() : '';

  useEffect(() => {
    if (!key) return;
    let live = true;
    (async () => {
      const res = await fetch(`/api/v1/reports/balance-sheet-by-label?${key}`, { headers: { Authorization: `Bearer ${await getIdToken()}` } });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.sheet || !Array.isArray(body.rows)) throw new Error(body.message || body.error || 'The report could not be made');
      return body as Report;
    })().then(report => { if (live) setResult({ key, report }); }).catch(err => { if (live) setResult({ key, error: err instanceof Error ? err.message : String(err) }); });
    return () => { live = false; };
  }, [key]);
  const shown = result && result.key === key ? result : null;
  const report = shown?.report;
  const dimension = dimensions.find(d => d.id === dimensionId);
  const dimensionName = dimension ? displayDimensionName(dimension) : dimensionId;
  // DIM-3: only a self-balancing label is expected to balance for each value
  const role = labelRole(dimension || {});
  const valueName = values.find(n => n.id === value)?.description || value;
  const money = (cents: number) => <td className="text-right font-mono py-1 px-2">{cents ? formatCurrency(cents, currency) : ''}</td>;
  const total = (label: string, own: number, rest: number) => (
    <tr className="font-semibold border-b border-[var(--line)]"><th scope="row" className="text-left py-1">{label}</th>{money(own)}{money(rest)}</tr>
  );

  return (
    <section aria-labelledby="bs-by-label-title" className="space-y-4">
      <h2 id="bs-by-label-title" className="text-lg font-bold text-[var(--text)]">Balance sheet by label</h2>
      {dimensions.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No labels yet: add one (Property, Project, Location…) in Settings → Labels, and put it on lines.</p>
      ) : (
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label className="flex flex-col gap-1 text-[var(--muted)]">Label
            <select value={dimensionId} onChange={e => setPickedDimension(e.target.value)} className={field}>
              {dimensions.map(d => <option key={d.id} value={d.id}>{displayDimensionName(d)}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[var(--muted)]">Value
            {values.length > 0
              ? <select value={value} onChange={e => setPicked({ dimensionId, value: e.target.value })} className={field}>{values.map(n => <option key={n.id} value={n.id}>{n.description || n.id}</option>)}</select>
              : <input value={value} onChange={e => setPicked({ dimensionId, value: e.target.value.trim() })} placeholder="The value's code" className={field} />}
          </label>
          <label className="flex flex-col gap-1 text-[var(--muted)]">As of<input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className={field} /></label>
        </div>
      )}
      {key && !shown && <p className="text-sm text-[var(--muted)]">Loading…</p>}
      {shown?.error && <p role="alert" className="text-sm text-rose-600">{shown.error}</p>}
      {report && (
        <div className="overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3" data-testid="label-balance-sheet">
          <table className="w-full text-sm">
            <caption className="text-left text-xs text-[var(--muted)] pb-1">{dimensionName} <bdi>{valueName}</bdi> on {endDate}, from posted lines with that value; lines with no {dimensionName} and opening balances are shown apart, not shared out.</caption>
            <thead>
              <tr className="border-b border-[var(--line)] text-[var(--muted)]">
                <th scope="col" className="text-left font-semibold py-2">Account</th>
                <th scope="col" className="text-right font-semibold py-2 px-2"><bdi>{valueName}</bdi></th>
                <th scope="col" className="text-right font-semibold py-2 px-2">Not labelled</th>
              </tr>
            </thead>
            {SECTIONS.map(([kind, title, part]) => (
              <tbody key={kind}>
                <tr><th scope="rowgroup" colSpan={3} className="text-left text-xs font-semibold uppercase tracking-wide text-[var(--muted)] pt-3">{title}</th></tr>
                {report.rows.filter(r => r.type === kind).map(r => (
                  <tr key={r.id} className="border-b border-[var(--line)]/50">
                    <th scope="row" className="text-left font-normal py-1">{r.code ? <span className="font-mono text-xs text-[var(--muted)]">{r.code} </span> : null}<bdi>{r.name}</bdi></th>
                    {money(report.sheet[part][r.id] || 0)}{money(report.notLabelled.sheet[part][r.id] || 0)}
                  </tr>
                ))}
                {kind === 'equity' && <tr className="border-b border-[var(--line)]/50"><th scope="row" className="text-left font-normal py-1">Profit to date</th>{money(report.sheet.netIncome)}{money(report.notLabelled.sheet.netIncome)}</tr>}
                {kind === 'asset' && total('Total assets', report.sheet.totalAssets, report.notLabelled.sheet.totalAssets)}
              </tbody>
            ))}
            <tfoot>{total('Total liabilities and equity', report.sheet.totalClaims, report.notLabelled.sheet.totalClaims)}</tfoot>
          </table>
          {report.sheet.isBalanced
            ? <p className="mt-1 text-xs text-[var(--muted)]">Assets = liabilities + equity for <bdi>{valueName}</bdi>.</p>
            : role === 'self-balancing'
              ? <p role="alert" className="mt-1 text-xs text-rose-600">This sheet does not balance by {formatCurrency(report.sheet.totalAssets - report.sheet.totalClaims, currency)}, and {dimensionName} is self-balancing: some entries label one side with <bdi>{valueName}</bdi> and not the other (they are listed in Data Health).</p>
              : <p role="status" className="mt-1 text-xs text-amber-700 dark:text-amber-400">This sheet does not balance by {formatCurrency(report.sheet.totalAssets - report.sheet.totalClaims, currency)}: some entries label one side with <bdi>{valueName}</bdi> and not the other. {dimensionName} is {LABEL_ROLES[role].name.toLowerCase()}, so that is allowed; make it self-balancing in Settings → Labels to have it checked.</p>}
          {(report.notLabelled.lines > 0 || report.notLabelled.openings > 0) && (
            <p className="text-xs text-[var(--muted)]">{report.notLabelled.lines} lines with no {dimensionName} and {report.notLabelled.openings} opening balances are in “Not labelled”.</p>
          )}
        </div>
      )}
    </section>
  );
}
