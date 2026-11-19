import React, { useState } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { useServerAssetRegister } from '../../hooks/useServerAssetRegister';
import { validCustomReportPeriod } from '../../lib/reportCustomPeriod';
import { csvMoney, downloadCsv } from '../../lib/csvExport';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import ReportTableScroll from './ReportTableScroll';
import { RowTable } from '../ui/RowTable';
import { useReportText } from './useReportText';

export default function AssetRegisterReportView({ endDate }: { endDate?: string }) {
  const reportText = useReportText();
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
  return <section aria-label={reportText('r.fixed-asset-register-report', 'Fixed asset register report')} className="p-4 min-w-0 space-y-4">
    <h2 className="text-lg font-semibold">{reportText('r.fixed-asset-register-as-of-date', 'Fixed asset register as of date')}</h2>
    <p className="text-sm text-[var(--muted)]">{reportText('r.read-only-view-of-assets-acquired-and-not-dispos', 'Read-only view of assets acquired and not disposed by the chosen date. Depreciation uses posted, non-reversed monthly runs plus any brought-in depreciation. Category is the asset\'s saved asset-account name. Nothing is posted.')}</p>
    <div className="flex flex-wrap items-end gap-3" data-print-hide><label>{reportText('r.as-of-2', 'As of')} <input aria-label={reportText('r.asset-register-as-of-date', 'Asset register as of date')} type="date" className="min-h-11 border rounded px-3 bg-[var(--panel)]" value={date} onChange={e => setChosen(e.target.value)} /></label><button type="button" className="min-h-11 border rounded px-3" disabled={!report || partial} onClick={csv}>{reportText('r.export-csv', 'Export CSV')}</button></div>
    {!valid && <p role="alert">{reportText('r.choose-a-valid-date', 'Choose a valid date.')}</p>}
    {loading && <p role="status">{reportText('r.loading-asset-history', 'Loading asset history…')}</p>}
    {report?.source === 'server' && <p role="status" data-testid="asset-register-source">{reportText('r.every-asset-and-depreciation-run-was-read-from-t', 'Every asset and depreciation run was read from the server.')}</p>}
    {partial && <p role="alert" data-testid="asset-register-partial">{reportText('r.loaded-asset-or-transaction-history-is-incomplet', 'Loaded asset or transaction history is incomplete. Figures are provisional; CSV is disabled.')}</p>}
    {!!report?.historicalChanges && <p role="alert">{report.historicalChanges} {reportText('r.asset-s-were-changed-after-the-chosen-date-their', 'asset(s) were changed after the chosen date. Their current cost/account details may not represent that earlier date; verify historical records before using this report.')}</p>}
    {report && <><ReportTableScroll><RowTable
      caption={(<>{reportText('r.asset-register-through', 'Asset register through')} {date}</>)}
      rows={report.rows}
      rowKey={r => r.id}
      captionClassName=""
      tableClassName="w-full text-sm"
      headRowClassName=""
      bodyClassName=""
      columns={[
        { header: reportText('r.category-asset', 'Category / asset'), className: "text-left", headClassName: "", cell: (r) => <bdi>{r.category} — {r.name}</bdi> },
        { header: reportText('r.tag', 'Tag'), headClassName: "", cell: (r) => r.tag },
        { header: reportText('r.purchase-date', 'Purchase date'), headClassName: "", cell: (r) => r.purchaseDate },
        { header: reportText('r.cost', 'Cost'), className: "text-right", headClassName: "", cell: (r) => money(r.costCents) },
        { header: reportText('r.depreciation', 'Depreciation'), className: "text-right", headClassName: "", cell: (r) => money(r.depreciationCents) },
        { header: reportText('r.book-value', 'Book value'), className: "text-right", headClassName: "", cell: (r) => money(r.bookValueCents) },
      ]}
    /></ReportTableScroll>
    <ReportTableScroll><RowTable
      caption={(<>{reportText('r.category-totals-as-of', 'Category totals as of')} {date}</>)}
      rows={report.categories}
      rowKey={g => g.category}
      captionClassName=""
      tableClassName="w-full text-sm"
      headRowClassName=""
      bodyClassName=""
      footer={<tr><th scope="row" className="text-left">{reportText('r.total', 'Total')}</th><td>{report.totals.count}</td><td>{money(report.totals.costCents)}</td><td>{money(report.totals.depreciationCents)}</td><td>{money(report.totals.bookValueCents)}</td></tr>}
      columns={[
        { header: reportText('r.category', 'Category'), className: "text-left", headClassName: "", cell: (g) => <bdi>{g.category}</bdi> },
        { header: reportText('r.assets', 'Assets'), headClassName: "", cell: (g) => g.count },
        { header: reportText('r.cost', 'Cost'), headClassName: "", cell: (g) => money(g.costCents) },
        { header: reportText('r.depreciation', 'Depreciation'), headClassName: "", cell: (g) => money(g.depreciationCents) },
        { header: reportText('r.book-value', 'Book value'), headClassName: "", cell: (g) => money(g.bookValueCents) },
      ]}
    /></ReportTableScroll>
    {report.rows.length === 0 && <p>{reportText('r.no-assets-acquired-and-held-through-this-date', 'No assets acquired and held through this date.')}</p>}</>}
  </section>;
}
