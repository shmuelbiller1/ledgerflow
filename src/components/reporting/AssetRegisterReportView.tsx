import React, { useState } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { useServerAssetRegister } from '../../hooks/useServerAssetRegister';
import { validCustomReportPeriod } from '../../lib/reportCustomPeriod';
import { csvMoney, downloadCsv } from '../../lib/csvExport';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import ReportTableScroll from './ReportTableScroll';

export default function AssetRegisterReportView({ endDate }: { endDate?: string }) {
  const [chosen, setChosen] = useState<string | null>(null);
  const date = chosen ?? (endDate || getLocalDateISO());
  const failed = useDataNeedsStore(s => s.failed);
  const currency = useAuthStore(s => s.getCurrentWorkspace()?.currency);
  const { loading } = useLedgerCollections('assets', 'transactions', 'accounts');
  const valid = validCustomReportPeriod({ startDate: date, endDate: date });
  const report = useServerAssetRegister(date, valid && !loading);
  // the server's register reads every asset and run; only a failed load leaves it short
  const partial = report?.source === 'loaded-incomplete' || (['assets', 'transactions', 'accounts'] as const).some(key => failed[key]);
  const money = (cents: number) => formatCurrency(cents, currency);
  const csv = () => { if (!report || partial) return; downloadCsv(`asset_register_${date}.csv`,
    ['Category', 'Tag', 'Asset', 'Purchase date', 'Status', 'Cost', 'Depreciation to date', 'Book value'],
    report.rows.map(r => [r.category, r.tag, r.name, r.purchaseDate, r.status, csvMoney(r.costCents), csvMoney(r.depreciationCents), csvMoney(r.bookValueCents)])); };
  return <section aria-label="Fixed asset register report" className="p-4 min-w-0 space-y-4">
    <h2 className="text-lg font-semibold">Fixed asset register as of date</h2>
    <p className="text-sm text-[var(--muted)]">Read-only view of assets acquired and not disposed by the chosen date. Depreciation uses posted, non-reversed monthly runs plus any brought-in depreciation. Category is the asset's saved asset-account name. Nothing is posted.</p>
    <div className="flex flex-wrap items-end gap-3" data-print-hide><label>As of <input aria-label="Asset register as of date" type="date" className="min-h-11 border rounded px-3 bg-[var(--panel)]" value={date} onChange={e => setChosen(e.target.value)} /></label><button type="button" className="min-h-11 border rounded px-3" disabled={!report || partial} onClick={csv}>Export CSV</button></div>
    {!valid && <p role="alert">Choose a valid date.</p>}
    {loading && <p role="status">Loading asset history…</p>}
    {report?.source === 'server' && <p role="status" data-testid="asset-register-source">Every asset and depreciation run was read from the server.</p>}
    {partial && <p role="alert" data-testid="asset-register-partial">Loaded asset or transaction history is incomplete. Figures are provisional; CSV is disabled.</p>}
    {!!report?.historicalChanges && <p role="alert">{report.historicalChanges} asset(s) were changed after the chosen date. Their current cost/account details may not represent that earlier date; verify historical records before using this report.</p>}
    {report && <><ReportTableScroll><table className="w-full text-sm"><caption>Asset register through {date}</caption><thead><tr><th scope="col">Category / asset</th><th scope="col">Tag</th><th scope="col">Purchase date</th><th scope="col">Cost</th><th scope="col">Depreciation</th><th scope="col">Book value</th></tr></thead><tbody>{report.rows.map(r => <tr key={r.id}><th scope="row" className="text-left"><bdi>{r.category} — {r.name}</bdi></th><td>{r.tag}</td><td>{r.purchaseDate}</td><td className="text-right">{money(r.costCents)}</td><td className="text-right">{money(r.depreciationCents)}</td><td className="text-right">{money(r.bookValueCents)}</td></tr>)}</tbody></table></ReportTableScroll>
    <ReportTableScroll><table className="w-full text-sm"><caption>Category totals as of {date}</caption><thead><tr><th scope="col">Category</th><th scope="col">Assets</th><th scope="col">Cost</th><th scope="col">Depreciation</th><th scope="col">Book value</th></tr></thead><tbody>{report.categories.map(g => <tr key={g.category}><th scope="row" className="text-left"><bdi>{g.category}</bdi></th><td>{g.count}</td><td>{money(g.costCents)}</td><td>{money(g.depreciationCents)}</td><td>{money(g.bookValueCents)}</td></tr>)}</tbody><tfoot><tr><th scope="row" className="text-left">Total</th><td>{report.totals.count}</td><td>{money(report.totals.costCents)}</td><td>{money(report.totals.depreciationCents)}</td><td>{money(report.totals.bookValueCents)}</td></tr></tfoot></table></ReportTableScroll>
    {report.rows.length === 0 && <p>No assets acquired and held through this date.</p>}</>}
  </section>;
}
