import { displayDimensionName } from '../../lib/dimensionUtils';
import { useEffect, useState } from 'react';
import { GroupedRowTable } from '../ui/RowTable';
import type { BandCell, BandRow } from '../../lib/tableBands';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { LABEL_ROLES, labelRole } from '../../lib/labelRoles';
import { runCommand } from '../../lib/runCommand';
import { useReportText, fill } from './useReportText';

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
  const reportText = useReportText();
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
      const body = await runCommand<Partial<Report>>({ path: `/api/v1/reports/balance-sheet-by-label?${key}` }) ?? {};
      if (!body.sheet || !Array.isArray(body.rows)) throw new Error('The report could not be made');
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
  const money = (cents: number): BandCell => ({ className: "text-right font-mono py-1 px-2", content: cents ? formatCurrency(cents, currency) : '' });
  const total = (label: string, own: number, rest: number): BandRow => (
    { className: "font-semibold border-b border-[var(--line)]", cells: [{ scope: 'row', className: "text-left py-1", content: label }, money(own), money(rest)] }
  );

  return (
    <section aria-labelledby="bs-by-label-title" className="space-y-4">
      <h2 id="bs-by-label-title" className="text-lg font-bold text-[var(--text)]">{reportText('r.balance-sheet-by-label', 'Balance sheet by label')}</h2>
      {dimensions.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">{reportText('r.no-labels-yet-add-one-property-project-location', 'No labels yet: add one (Property, Project, Location…) in Settings → Labels, and put it on lines.')}</p>
      ) : (
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label className="flex flex-col gap-1 text-[var(--muted)]">{reportText('r.label', 'Label')}
            <select value={dimensionId} onChange={e => setPickedDimension(e.target.value)} className={field}>
              {dimensions.map(d => <option key={d.id} value={d.id}>{displayDimensionName(d)}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[var(--muted)]">{reportText('r.value', 'Value')}
            {values.length > 0
              ? <select value={value} onChange={e => setPicked({ dimensionId, value: e.target.value })} className={field}>{values.map(n => <option key={n.id} value={n.id}>{n.description || n.id}</option>)}</select>
              : <input value={value} onChange={e => setPicked({ dimensionId, value: e.target.value.trim() })} placeholder={reportText('r.the-value-s-code', 'The value\'s code')} className={field} />}
          </label>
          <label className="flex flex-col gap-1 text-[var(--muted)]">{reportText('r.as-of-2', 'As of')}<input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className={field} /></label>
        </div>
      )}
      {key && !shown && <p className="text-sm text-[var(--muted)]">{reportText('r.loading', 'Loading…')}</p>}
      {shown?.error && <p role="alert" className="text-sm text-rose-600">{shown.error}</p>}
      {report && (
        <div className="overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3" data-testid="label-balance-sheet">
          <GroupedRowTable
            caption={<>{dimensionName} <bdi>{valueName}</bdi> {reportText('r.on-2', 'on')} {endDate}{reportText('r.from-posted-lines-with-that-value-lines-with-no', ', from posted lines with that value; lines with no')} {dimensionName} {reportText('r.and-opening-balances-are-shown-apart-not-shared', 'and opening balances are shown apart, not shared out.')}</>}
            captionClassName="text-left text-xs text-[var(--muted)] pb-1"
            tableClassName="w-full text-sm"
            head={[{ className: "border-b border-[var(--line)] text-[var(--muted)]", cells: [
              { scope: 'col', className: "text-left font-semibold py-2", content: reportText('r.account', 'Account') },
              { scope: 'col', className: "text-right font-semibold py-2 px-2", content: <bdi>{valueName}</bdi> },
              { scope: 'col', className: "text-right font-semibold py-2 px-2", content: reportText('r.not-labelled', 'Not labelled') },
            ] }]}
            groups={SECTIONS.map(([kind, title, part]) => ({
              key: kind,
              rows: [
                { cells: [{ scope: 'rowgroup', colSpan: 3, className: "text-left text-xs font-semibold uppercase tracking-wide text-[var(--muted)] pt-3", content: title }] },
                ...report.rows.filter(r => r.type === kind).map(r => ({ key: r.id, className: "border-b border-[var(--line)]/50", cells: [
                  { scope: 'row', className: "text-left font-normal py-1", content: <>{r.code ? <span className="font-mono text-xs text-[var(--muted)]">{r.code} </span> : null}<bdi>{r.name}</bdi></> },
                  money(report.sheet[part][r.id] || 0),
                  money(report.notLabelled.sheet[part][r.id] || 0),
                ] })),
                kind === 'equity' && { key: 'profit-to-date', className: "border-b border-[var(--line)]/50", cells: [
                  { scope: 'row', className: "text-left font-normal py-1", content: reportText('r.profit-to-date', 'Profit to date') },
                  money(report.sheet.netIncome),
                  money(report.notLabelled.sheet.netIncome),
                ] },
                kind === 'asset' && total('Total assets', report.sheet.totalAssets, report.notLabelled.sheet.totalAssets),
              ],
            }))}
            foot={[total('Total liabilities and equity', report.sheet.totalClaims, report.notLabelled.sheet.totalClaims)]}
          />
          {report.sheet.isBalanced
            ? <p className="mt-1 text-xs text-[var(--muted)]">{reportText('r.assets-liabilities-equity-for', 'Assets = liabilities + equity for')} <bdi>{valueName}</bdi>.</p>
            : role === 'self-balancing'
              ? <p role="alert" className="mt-1 text-xs text-rose-600">{reportText('r.this-sheet-does-not-balance-by', 'This sheet does not balance by')} {formatCurrency(report.sheet.totalAssets - report.sheet.totalClaims, currency)}{reportText('r.and-3', ', and')} {dimensionName} {reportText('r.is-self-balancing-some-entries-label-one-side-wi', 'is self-balancing: some entries label one side with')} <bdi>{valueName}</bdi> {reportText('r.and-not-the-other-they-are-listed-in-data-health', 'and not the other (they are listed in Data Health).')}</p>
              : <p role="status" className="mt-1 text-xs text-amber-700 dark:text-amber-400">{reportText('r.this-sheet-does-not-balance-by', 'This sheet does not balance by')} {formatCurrency(report.sheet.totalAssets - report.sheet.totalClaims, currency)}{reportText('r.some-entries-label-one-side-with', ': some entries label one side with')} <bdi>{valueName}</bdi> {reportText('r.and-not-the-other', 'and not the other.')} {fill(reportText('r.dimension-is-role', '{dimension} is {role}'), { dimension: dimensionName, role: LABEL_ROLES[role].name.toLowerCase() })}{reportText('r.so-that-is-allowed-make-it-self-balancing-in-set', ', so that is allowed; make it self-balancing in Settings → Labels to have it checked.')}</p>}
          {(report.notLabelled.lines > 0 || report.notLabelled.openings > 0) && (
            <p className="text-xs text-[var(--muted)]">{report.notLabelled.lines} {reportText('r.lines-with-no', 'lines with no')} {dimensionName} {reportText('r.and', 'and')} {report.notLabelled.openings} {reportText('r.opening-balances-are-in-not-labelled', 'opening balances are in “Not labelled”.')}</p>
          )}
        </div>
      )}
    </section>
  );
}
