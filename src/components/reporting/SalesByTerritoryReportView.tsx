import React, { useMemo, useState } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { DEFAULT_WORKSPACE_DIMENSIONS } from '../../lib/dimensionUtils';
import { salesByTerritory, salesByTerritoryCsvRows, SALES_BY_TERRITORY_CSV_HEADERS, type SalesByTerritoryReport } from '../../lib/salesByTerritory';
import { normalizeSearchText } from '../../lib/textNormalization';
import { validCustomReportPeriod } from '../../lib/reportCustomPeriod';
import { formatCurrency } from '../../lib/utils';
import { downloadCsv } from '../../lib/csvExport';
import ReportTableScroll from './ReportTableScroll';
import type { DimensionDefinition } from '../../types';
import { useReportText, fill } from './useReportText';

const field = 'min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]';

function locationDefinition(dimensions: DimensionDefinition[] | undefined): DimensionDefinition {
  const configured = dimensions?.find(dimension => dimension.id === 'location') ||
    dimensions?.find(dimension => normalizeSearchText(dimension.name || dimension.label) === 'location');
  return configured || DEFAULT_WORKSPACE_DIMENSIONS.find(dimension => dimension.id === 'location')!;
}

/** A-142: issued invoice item amounts grouped by their stored Location label. */
export default function SalesByTerritoryReportView({ startDate = '', endDate = '' }: { startDate?: string; endDate?: string }) {
  const invoices = useLedgerStore(state => state.invoices);
  const dimensionNodes = useLedgerStore(state => state.dimensionNodes);
  const truncated = useLedgerStore(state => state.truncatedCollections);
  const failed = useDataNeedsStore(state => state.failed);
  const workspaceId = useAuthStore(state => state.currentWorkspaceId);
  const workspace = useAuthStore(state => state.getCurrentWorkspace());
  const { loading } = useLedgerCollections('invoices');
  const dimension = locationDefinition(workspace?.dimensions);
  const validPeriod = (!startDate && !endDate) || validCustomReportPeriod({ startDate: startDate || endDate, endDate: endDate || startDate });

  const report = useMemo(() => {
    if (!validPeriod) return null;
    return salesByTerritory({
      invoices: invoices.filter(invoice => !workspaceId || invoice.workspaceId === workspaceId),
      locationDimensionId: dimension.id,
      dimensionNodes,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      homeCurrency: workspace?.currency || 'USD',
    });
  }, [invoices, dimensionNodes, workspaceId, workspace?.currency, dimension.id, startDate, endDate, validPeriod]);

  const partial = Boolean(truncated.invoices || failed.invoices);
  return <SalesByTerritoryPanel report={report} from={startDate} to={endDate} locationLabel={dimension.name || dimension.label || 'Location'}
    currency={workspace?.currency || 'USD'} loading={loading} partial={partial} validPeriod={validPeriod} />;
}

export function SalesByTerritoryPanel({ report, from = '', to = '', locationLabel = 'Location', currency = 'USD', loading = false, partial = false, validPeriod = true }: {
  report: SalesByTerritoryReport | null;
  from?: string;
  to?: string;
  locationLabel?: string;
  currency?: string;
  loading?: boolean;
  partial?: boolean;
  validPeriod?: boolean;
}) {
  const reportText = useReportText();
  const [search, setSearch] = useState('');
  const query = normalizeSearchText(search.trim());
  const rows = (report?.rows || []).filter(row => !query || normalizeSearchText(`${row.locationName} ${row.locationValue || ''}`).includes(query));
  const displayedTotal = rows.reduce((sum, row) => sum + row.salesCents, 0);

  return <section aria-label={reportText('r.sales-by-territory', 'Sales by territory')} className="p-4 space-y-4 min-w-0">
    <h2>{reportText('r.sales-by-territory', 'Sales by territory')}</h2>
    <p className="text-sm text-[var(--muted)]">
      {reportText('r.issued-invoice-item-amounts-are-grouped-by-the-i', 'Issued invoice item amounts are grouped by the invoice line\'s')} {locationLabel} {reportText('r.dimension-the-report-follows-sales-by-item-draft', 'dimension. The report follows Sales by Item: drafts, voided, cancelled, rejected and opening-balance invoices are excluded, and each line uses its invoice\'s stored exchange rate to the workspace base currency. These are line amounts (not invoice-level totals or a separately allocated document-wide tax amount); an unlabelled line stays in Unassigned.')}
    </p>

    <div className="flex flex-wrap items-end gap-3" data-print-hide>
      <label className="flex flex-col gap-1 text-sm">{reportText('r.find-a', 'Find a')} {locationLabel.toLowerCase()}
        <input aria-label={reportText('r.find-a-territory', 'Find a territory')} className={field} value={search} onChange={event => setSearch(event.target.value)} placeholder={reportText('r.search-locations', 'Search locations')} />
      </label>
      <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]" disabled={!rows.length || loading || partial || !validPeriod}
        onClick={() => report && downloadCsv('sales-by-territory', SALES_BY_TERRITORY_CSV_HEADERS, salesByTerritoryCsvRows(rows))}>{reportText('r.export-csv', 'Export CSV')}</button>
    </div>

    {!validPeriod && <p role="alert">{reportText('r.choose-a-valid-report-period', 'Choose a valid report period.')}</p>}
    {loading && <p role="status">{reportText('r.loading-issued-invoices', 'Loading issued invoices…')}</p>}
    {partial && <p role="alert">{reportText('r.the-loaded-invoice-history-is-capped-or-failed-s', 'The loaded invoice history is capped or failed. Some issued invoices may be missing and CSV is unavailable until the history is complete.')}</p>}
    <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
      <p><b>{reportText('r.sales-shown', 'Sales shown:')}</b> {formatCurrency(displayedTotal, currency)} ({currency})</p>
      <p><b>{reportText('r.issued-invoices-in-the-full-report', 'Issued invoices in the full report:')}</b> {report?.invoiceCount || 0}</p>
    </div>

    <ReportTableScroll>
      <table className="w-full text-sm">
        <caption>{reportText('r.issued-invoice-line-sales-by', 'Issued invoice line sales by')} {locationLabel}{from || to ? ` ${fill(reportText('r.from-0-to-1', 'from {0} to {1}'), { 0: from || 'any date', 1: to || 'any date' })}` : ''}{reportText('r.amounts-in', '; amounts in $')}{currency} {reportText('r.base-minor-units', 'base minor units')}</caption>
        <thead><tr>
          {[reportText('r.territory', 'Territory'), reportText('r.stored-label-value', 'Stored label value'), reportText('r.invoices-2', 'Invoices'), reportText('r.invoice-lines', 'Invoice lines'), fill(reportText('r.sales-0', 'Sales ({0})'), { 0: currency })].map(head => <th key={head} scope="col" className="text-left py-1 px-2">{head}</th>)}
        </tr></thead>
        <tbody>
          {rows.map(row => <tr key={row.key} className="border-b border-[var(--line)]/50">
            <th scope="row" className="text-left font-normal py-1 px-2"><bdi>{row.locationName}</bdi></th>
            <td className="py-1 px-2"><bdi>{row.locationValue || '—'}</bdi></td>
            <td className="py-1 px-2">{row.invoiceCount}</td>
            <td className="py-1 px-2">{row.lineCount}</td>
            <td className="py-1 px-2 text-right tabular-nums">{formatCurrency(row.salesCents, currency)}</td>
          </tr>)}
        </tbody>
      </table>
      {validPeriod && !loading && !rows.length && <p className="text-sm text-[var(--muted)]">{reportText('r.no-issued-invoice-item-line-is-recorded-in-this', 'No issued invoice item line is recorded in this period.')}</p>}
    </ReportTableScroll>
  </section>;
}
