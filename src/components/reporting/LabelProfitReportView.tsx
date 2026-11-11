import { displayDimensionName } from '../../lib/dimensionUtils';
import React, { useEffect, useState } from 'react';
import { getIdToken } from '../../firebase';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import DrillDownModal, { type ExplainRequest } from '../layout/DrillDownModal';

type Section = 'income' | 'cogs' | 'expense';
interface Column { value: string; income: number; cogs: number; grossProfit: number; expense: number; netIncome: number; accounts: Record<string, number> }
interface Report { columns: Column[]; total: Omit<Column, 'value'>; rows: Array<{ id: string; name: string; code?: string; section: Section }> }
const SECTION_NAMES: Record<Section, string> = { income: 'Income', cogs: 'Cost of goods sold', expense: 'Expenses' };
const field = 'px-2 py-1.5 border border-[var(--line)] rounded bg-[var(--panel)] text-[var(--text)]';

/**
 * Profit by label (CB-25): choose a label (Property, Project, Location…) and a period; the income,
 * cost of goods sold, expenses and result of each of its values, and of the lines without one, account
 * by account, with the profit and loss total they add back to. Read by the server from the full history
 * (src/server/reports/byLabel.ts); each figure opens the entries behind it.
 */
export default function LabelProfitReportView() {
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const nodes = useLedgerStore(s => s.dimensionNodes);
  const dimensions = workspace?.dimensions || [];
  const [picked, setPicked] = useState('');
  const dimensionId = picked || dimensions[0]?.id || '';
  const [startDate, setStartDate] = useState(`${getLocalDateISO().slice(0, 4)}-01-01`);
  const [endDate, setEndDate] = useState(getLocalDateISO());
  const [result, setResult] = useState<{ key: string; report?: Report; error?: string } | null>(null);
  const [drill, setDrill] = useState<{ name: string; explain: ExplainRequest } | null>(null);
  const currency = workspace?.currency || 'USD';
  const key = workspace && dimensionId && startDate && endDate && startDate <= endDate ? new URLSearchParams({ workspaceId: workspace.id, dimensionId, startDate, endDate }).toString() : '';

  useEffect(() => {
    if (!key) return;
    let live = true;
    (async () => {
      const res = await fetch(`/api/v1/reports/by-label?${key}`, { headers: { Authorization: `Bearer ${await getIdToken()}` } });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !Array.isArray(body.columns)) throw new Error(body.message || body.error || 'The report could not be made');
      return body as Report;
    })().then(report => { if (live) setResult({ key, report }); }).catch(err => { if (live) setResult({ key, error: err instanceof Error ? err.message : String(err) }); });
    return () => { live = false; };
  }, [key]);
  const shown = result && result.key === key ? result : null;
  const report = shown?.report;
  const valueName = (value: string) => {
    const node = (nodes || []).find(n => n.dimensionId === dimensionId && n.id === value);
    return node?.description || value;
  };
  const dimension = dimensions.find(d => d.id === dimensionId);
  const dimensionName = dimension ? displayDimensionName(dimension) : dimensionId;

  /** a figure that opens the entries behind it; income is shown as credits, so its sign is turned */
  const cell = (cents: number, accountIds: string[], value: string | null, name: string, section: Section | null) => (
    <td className="text-right font-mono py-1 px-2">
      {cents === 0 || accountIds.length === 0 ? (cents === 0 ? '' : formatCurrency(cents, currency)) : (
        <button type="button" className="hover:underline" onClick={() => setDrill({
          name, explain: { accountIds, startDate, endDate, expectedCents: cents, sign: section === 'income' ? -1 : 1, ...(value !== null ? { labelFilter: { dimensionId, value }, label: `${dimensionName} ${valueName(value)}, ${startDate} to ${endDate}` } : {}) },
        })}>
          {formatCurrency(cents, currency)}<span className="sr-only"> {name}{value !== null ? ` for ${valueName(value)}` : ' in total'}: open the entries</span>
        </button>
      )}
    </td>
  );
  const idsOf = (section: Section) => (report?.rows || []).filter(r => r.section === section).map(r => r.id);

  return (
    <section aria-labelledby="by-label-title" className="space-y-4">
      <h2 id="by-label-title" className="text-lg font-bold text-[var(--text)]">Profit by label</h2>
      {dimensions.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No labels yet: add one (Property, Project, Location…) in Settings → Labels, and put it on lines.</p>
      ) : (
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label className="flex flex-col gap-1 text-[var(--muted)]">Label
            <select value={dimensionId} onChange={e => setPicked(e.target.value)} className={field}>
              {dimensions.map(d => <option key={d.id} value={d.id}>{displayDimensionName(d)}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[var(--muted)]">From<input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={field} /></label>
          <label className="flex flex-col gap-1 text-[var(--muted)]">To<input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className={field} /></label>
        </div>
      )}
      {startDate > endDate && <p role="status" className="text-xs text-amber-700 dark:text-amber-400">The period starts after it ends.</p>}
      {key && !shown && <p className="text-sm text-[var(--muted)]">Loading…</p>}
      {shown?.error && <p role="alert" className="text-sm text-rose-600">{shown.error}</p>}
      {report && report.columns.length === 0 && <p className="text-sm text-[var(--muted)]">No income or costs in this period.</p>}
      {report && report.columns.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3">
          <table className="w-full text-sm">
            <caption className="text-left text-xs text-[var(--muted)] pb-1">Each value of {dimensionName}, and the lines without one; together they add up to the profit and loss of the period. Posted entries only.</caption>
            <thead>
              <tr className="border-b border-[var(--line)] text-[var(--muted)]">
                <th scope="col" className="text-left font-semibold py-2">Account</th>
                {report.columns.map(c => <th key={c.value} scope="col" className="text-right font-semibold py-2 px-2"><bdi>{valueName(c.value)}</bdi></th>)}
                <th scope="col" className="text-right font-semibold py-2 px-2">Total</th>
              </tr>
            </thead>
            {(Object.keys(SECTION_NAMES) as Section[]).filter(s => report.rows.some(r => r.section === s)).map(section => (
              <tbody key={section}>
                <tr><th scope="rowgroup" colSpan={report.columns.length + 2} className="text-left text-xs font-semibold uppercase tracking-wide text-[var(--muted)] pt-3">{SECTION_NAMES[section]}</th></tr>
                {report.rows.filter(r => r.section === section).map(r => (
                  <tr key={r.id} className="border-b border-[var(--line)]/50">
                    <th scope="row" className="text-left font-normal py-1">{r.code ? <span className="font-mono text-xs text-[var(--muted)]">{r.code} </span> : null}<bdi>{r.name}</bdi></th>
                    {report.columns.map(c => <React.Fragment key={c.value}>{cell(c.accounts[r.id] || 0, [r.id], c.value, r.name, section)}</React.Fragment>)}
                    {cell(report.columns.reduce((s, c) => s + (c.accounts[r.id] || 0), 0), [r.id], null, r.name, section)}
                  </tr>
                ))}
                <tr className="font-semibold border-b border-[var(--line)]">
                  <th scope="row" className="text-left py-1">Total {SECTION_NAMES[section].toLowerCase()}</th>
                  {report.columns.map(c => <React.Fragment key={c.value}>{cell(c[section], idsOf(section), c.value, `Total ${SECTION_NAMES[section].toLowerCase()}`, section)}</React.Fragment>)}
                  {cell(report.total[section], idsOf(section), null, `Total ${SECTION_NAMES[section].toLowerCase()}`, section)}
                </tr>
              </tbody>
            ))}
            <tfoot>
              {([['grossProfit', 'Gross profit'], ['netIncome', 'Net income']] as const).map(([k, label]) => (
                <tr key={k} className="font-semibold">
                  <th scope="row" className="text-left py-1">{label}</th>
                  {report.columns.map(c => <td key={c.value} className="text-right font-mono py-1 px-2">{formatCurrency(c[k], currency)}</td>)}
                  <td className="text-right font-mono py-1 px-2">{formatCurrency(report.total[k], currency)}</td>
                </tr>
              ))}
            </tfoot>
          </table>
        </div>
      )}
      <DrillDownModal key={drill ? drill.name + JSON.stringify(drill.explain) : 'closed'} isOpen={Boolean(drill)} onClose={() => setDrill(null)} accountName={drill?.name || ''} transactions={[]} explain={drill?.explain} formatCurrency={(v: number) => formatCurrency(v, currency)} from="Profit by label" />
    </section>
  );
}
