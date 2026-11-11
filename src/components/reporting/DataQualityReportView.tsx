import React, { useMemo, useState } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useUIStore } from '../../stores/useUIStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import {
  DATA_QUALITY_CSV_HEADERS,
  dataQualityCsvRows,
  evaluateDataQuality,
  type DataQualityReport,
} from '../../lib/dataQualityChecks';
import { formatCurrency, workspaceYearMonth } from '../../lib/utils';
import { downloadCsv } from '../../lib/csvExport';
import ReportTableScroll from './ReportTableScroll';

type FilterScope = 'all' | 'labels' | 'filings' | 'items';

const controlClass = 'min-h-11 rounded border border-[var(--line)] bg-[var(--panel)] px-3 text-sm text-[var(--text)]';

/**
 * A-194 / A-196 / A-197: unified Data Quality report covering required-label gaps on posted entries,
 * customers/vendors missing tax IDs or addresses needed for active filings, and catalogue items missing
 * unit cost or selling price. Read-only; tax IDs are always masked and never sent anywhere.
 */
export default function DataQualityReportView() {
  const transactions = useLedgerStore(s => s.transactions);
  const accounts = useLedgerStore(s => s.accounts);
  const customers = useLedgerStore(s => s.customers);
  const vendors = useLedgerStore(s => s.vendors);
  const invoices = useLedgerStore(s => s.invoices);
  const bills = useLedgerStore(s => s.bills);
  const payments = useLedgerStore(s => s.payments);
  const inventory = useLedgerStore(s => s.inventory);
  const truncated = useLedgerStore(s => s.truncatedCollections);
  const failed = useDataNeedsStore(s => s.failed);
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const { loading } = useLedgerCollections('customers', 'vendors', 'invoices', 'bills', 'payments', 'inventory');

  const defaultYear = workspaceYearMonth().year;
  const [taxYear, setTaxYear] = useState<number>(defaultYear);
  const [scope, setScope] = useState<FilterScope>('all');
  const [search, setSearch] = useState('');

  const homeCurrency = workspace?.currency || 'USD';
  const workspaceCountry = workspace?.taxProfiles?.books?.place?.country;

  const report = useMemo(() => evaluateDataQuality({
    transactions: transactions || [],
    accounts: accounts || [],
    dimensions: workspace?.dimensions,
    customers: customers || [],
    vendors: vendors || [],
    invoices: invoices || [],
    bills: bills || [],
    payments: payments || [],
    inventory: inventory || [],
    taxYear,
    homeCurrency,
    workspaceCountry,
  }), [transactions, accounts, workspace?.dimensions, customers, vendors, invoices, bills, payments, inventory, taxYear, homeCurrency, workspaceCountry]);

  const partial = Boolean(
    truncated.customers || truncated.vendors || truncated.invoices || truncated.bills || truncated.payments || truncated.inventory ||
    failed.customers || failed.vendors || failed.invoices || failed.bills || failed.payments || failed.inventory,
  );

  return (
    <DataQualityReportPanel
      report={report}
      taxYear={taxYear}
      onTaxYearChange={setTaxYear}
      scope={scope}
      onScopeChange={setScope}
      search={search}
      onSearchChange={setSearch}
      loading={loading}
      partial={partial}
    />
  );
}

export function DataQualityReportPanel({
  report,
  taxYear,
  onTaxYearChange,
  scope,
  onScopeChange,
  search,
  onSearchChange,
  loading = false,
  partial = false,
}: {
  report: DataQualityReport;
  taxYear: number;
  onTaxYearChange: (year: number) => void;
  scope: FilterScope;
  onScopeChange: (scope: FilterScope) => void;
  search: string;
  onSearchChange: (q: string) => void;
  loading?: boolean;
  partial?: boolean;
}) {
  const openRecord = useUIStore(s => s.openRecord);
  const setActiveTab = useUIStore(s => s.setActiveTab);
  const needle = search.trim().toLowerCase();

  const labelRows = useMemo(() => report.missingLabelEntries.filter(r =>
    !needle || r.description.toLowerCase().includes(needle) || r.summary.toLowerCase().includes(needle) || r.date.includes(needle),
  ), [report.missingLabelEntries, needle]);

  const filingRows = useMemo(() => report.missingFilingParties.filter(r =>
    !needle || r.name.toLowerCase().includes(needle) || r.country.toLowerCase().includes(needle) || r.filingReasons.some(x => x.toLowerCase().includes(needle)),
  ), [report.missingFilingParties, needle]);

  const itemRows = useMemo(() => report.missingItemPricing.filter(r =>
    !needle || r.name.toLowerCase().includes(needle) || r.sku.toLowerCase().includes(needle) || r.reason.toLowerCase().includes(needle),
  ), [report.missingItemPricing, needle]);

  const totalCount = report.missingLabelEntries.length + report.missingFilingParties.length + report.missingItemPricing.length;
  const filteredReport: DataQualityReport = useMemo(() => ({
    ...report,
    missingLabelEntries: scope === 'all' || scope === 'labels' ? labelRows : [],
    missingFilingParties: scope === 'all' || scope === 'filings' ? filingRows : [],
    missingItemPricing: scope === 'all' || scope === 'items' ? itemRows : [],
  }), [report, scope, labelRows, filingRows, itemRows]);

  const filteredTotal =
    filteredReport.missingLabelEntries.length +
    filteredReport.missingFilingParties.length +
    filteredReport.missingItemPricing.length;

  return (
    <section aria-label="Data quality checks" className="p-4 space-y-6 min-w-0 text-[var(--text)]">
      <div className="space-y-1">
        <h2 className="text-xl font-bold">Data quality checks</h2>
        <p className="text-sm text-[var(--muted)]">
          Checks posted entries missing required labels, active customers and suppliers missing a tax ID or postal address
          needed for {report.taxYear} filings, and catalogue items missing unit cost or selling price. Read-only check:
          recorded tax IDs are shown masked only, never verified against a tax authority, and nothing here alters your books.
        </p>
      </div>

      {loading && <p role="status" className="text-sm">Loading workspace records…</p>}
      {partial && (
        <p role="alert" className="text-sm text-[var(--brass)]">
          One or more loaded collections are capped or incomplete. Findings and CSV exports are provisional until all records load.
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" role="status">
        <div className="p-3 rounded-lg border border-[var(--line)] bg-[var(--surface)]">
          <p className="text-xs text-[var(--muted)]">Entries missing required labels</p>
          <p className="text-2xl font-bold tabular-nums">{report.missingLabelEntries.length}</p>
          <p className="text-xs text-[var(--muted)]">{report.activeLabelRules.length} active label rule(s)</p>
        </div>
        <div className="p-3 rounded-lg border border-[var(--line)] bg-[var(--surface)]">
          <p className="text-xs text-[var(--muted)]">Contacts missing filing details</p>
          <p className="text-2xl font-bold tabular-nums">{report.missingFilingParties.length}</p>
          <p className="text-xs text-[var(--muted)]">Tax year {report.taxYear}</p>
        </div>
        <div className="p-3 rounded-lg border border-[var(--line)] bg-[var(--surface)]">
          <p className="text-xs text-[var(--muted)]">Items missing cost or price</p>
          <p className="text-2xl font-bold tabular-nums">{report.missingItemPricing.length}</p>
          <p className="text-xs text-[var(--muted)]">Bundles excluded; services price-only</p>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3" data-print-hide>
        <label className="flex flex-col gap-1 text-sm">
          Check group
          <select aria-label="Check group" className={controlClass} value={scope} onChange={e => onScopeChange(e.target.value as FilterScope)}>
            <option value="all">All checks ({totalCount})</option>
            <option value="labels">Entries missing required labels ({report.missingLabelEntries.length})</option>
            <option value="filings">Contacts missing tax ID or address ({report.missingFilingParties.length})</option>
            <option value="items">Items missing cost or price ({report.missingItemPricing.length})</option>
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Filing year
          <input
            aria-label="Filing year"
            type="number"
            min={2020}
            max={2099}
            className={controlClass}
            value={taxYear}
            onChange={e => {
              const y = Number(e.target.value);
              if (Number.isInteger(y) && y >= 2020 && y <= 2099) onTaxYearChange(y);
            }}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Filter findings
          <input
            aria-label="Filter findings"
            type="search"
            placeholder="Name, account, SKU…"
            className={controlClass}
            value={search}
            onChange={e => onSearchChange(e.target.value)}
          />
        </label>

        <button
          type="button"
          className="min-h-11 px-4 rounded border border-[var(--line)] text-sm font-medium disabled:opacity-50"
          disabled={loading || partial || filteredTotal === 0}
          onClick={() => downloadCsv(`data-quality-${report.taxYear}`, DATA_QUALITY_CSV_HEADERS, dataQualityCsvRows(filteredReport))}
        >
          Export CSV
        </button>
      </div>

      {(scope === 'all' || scope === 'labels') && (
        <div className="space-y-2">
          <h3 className="font-semibold text-sm">Entries missing required labels ({labelRows.length})</h3>
          {report.activeLabelRules.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">
              No required-label rules are configured yet. Mark a label required on account types under Settings → Labels.
            </p>
          ) : labelRows.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">Every posted entry meets all active required-label rules.</p>
          ) : (
            <ReportTableScroll>
              <table className="w-full text-sm">
                <caption className="sr-only">Posted entries missing required labels</caption>
                <thead>
                  <tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
                    {['Date', 'Entry', 'Missing label and account', 'Rule kind', 'Amount', 'Action'].map(h => (
                      <th key={h} scope="col" className="text-left py-2 px-2">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {labelRows.map(row => (
                    <tr key={row.transactionId} className="border-b border-[var(--line)]/50">
                      <td className="py-2 px-2 tabular-nums whitespace-nowrap">{row.date}</td>
                      <th scope="row" className="text-left font-normal py-2 px-2"><bdi>{row.description}</bdi></th>
                      <td className="py-2 px-2"><bdi>{row.summary}</bdi></td>
                      <td className="py-2 px-2">{row.severity === 'medium' ? 'Refuses save when missing' : 'Warns when missing'}</td>
                      <td className="py-2 px-2 tabular-nums whitespace-nowrap">{formatCurrency(row.totalAmountCents, row.currency)}</td>
                      <td className="py-2 px-2">
                        <button type="button" className="min-h-11 px-3 underline text-left" onClick={() => openRecord(row.record)}>
                          Open entry
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ReportTableScroll>
          )}
        </div>
      )}

      {(scope === 'all' || scope === 'filings') && (
        <div className="space-y-2">
          <h3 className="font-semibold text-sm">Customers and vendors missing filing tax IDs or addresses ({filingRows.length})</h3>
          {filingRows.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No active {report.taxYear} customer or supplier filing details are missing.</p>
          ) : (
            <ReportTableScroll>
              <table className="w-full text-sm">
                <caption className="sr-only">Customers and vendors missing tax IDs or postal addresses needed for filings</caption>
                <thead>
                  <tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
                    {['Contact', 'Kind', 'Country', 'Tax ID (masked)', 'Address', 'Missing', 'Why needed', 'Activity', 'Action'].map(h => (
                      <th key={h} scope="col" className="text-left py-2 px-2">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filingRows.map(row => (
                    <tr key={row.id} className="border-b border-[var(--line)]/50 align-top">
                      <th scope="row" className="text-left font-normal py-2 px-2"><bdi>{row.name}</bdi></th>
                      <td className="py-2 px-2">{row.kind === 'vendor' ? 'Vendor' : 'Customer'}</td>
                      <td className="py-2 px-2">{row.country}</td>
                      <td className="py-2 px-2 font-mono">{row.maskedTaxId}</td>
                      <td className="py-2 px-2">{row.hasAddress ? 'Recorded' : 'Missing'}</td>
                      <td className="py-2 px-2">{row.missingFields.map(f => (f === 'taxId' ? 'Tax ID' : 'Address')).join(', ')}</td>
                      <td className="py-2 px-2">{row.filingReasons.join('; ')}</td>
                      <td className="py-2 px-2 tabular-nums whitespace-nowrap">{formatCurrency(row.activityAmountCents, row.currency)}</td>
                      <td className="py-2 px-2">
                        <button
                          type="button"
                          className="min-h-11 px-3 underline text-left"
                          onClick={() => row.record ? openRecord(row.record) : setActiveTab(row.kind === 'vendor' ? 'purchases' : 'sales')}
                        >
                          Open
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ReportTableScroll>
          )}
        </div>
      )}

      {(scope === 'all' || scope === 'items') && (
        <div className="space-y-2">
          <h3 className="font-semibold text-sm">Items missing unit cost or selling price ({itemRows.length})</h3>
          {itemRows.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">Every active stock and service item has its expected pricing recorded.</p>
          ) : (
            <ReportTableScroll>
              <table className="w-full text-sm">
                <caption className="sr-only">Catalogue items missing unit cost or selling price</caption>
                <thead>
                  <tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
                    {['Item', 'SKU', 'Type', 'Unit cost', 'Selling price', 'Missing', 'Effect on books', 'Action'].map(h => (
                      <th key={h} scope="col" className="text-left py-2 px-2">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {itemRows.map(row => (
                    <tr key={row.itemId} className="border-b border-[var(--line)]/50 align-top">
                      <th scope="row" className="text-left font-normal py-2 px-2"><bdi>{row.name}</bdi></th>
                      <td className="py-2 px-2 font-mono">{row.sku || '—'}</td>
                      <td className="py-2 px-2">{row.itemType === 'service' ? 'Service' : 'Stock'}</td>
                      <td className="py-2 px-2 tabular-nums whitespace-nowrap">
                        {row.itemType === 'service' ? 'Not used' : formatCurrency(row.unitCostCents, report.homeCurrency)}
                      </td>
                      <td className="py-2 px-2 tabular-nums whitespace-nowrap">{formatCurrency(row.unitPriceCents, report.homeCurrency)}</td>
                      <td className="py-2 px-2">{row.missingFields.map(f => (f === 'cost' ? 'Unit cost' : 'Selling price')).join(', ')}</td>
                      <td className="py-2 px-2">{row.reason}</td>
                      <td className="py-2 px-2">
                        <button type="button" className="min-h-11 px-3 underline text-left" onClick={() => openRecord(row.record)}>
                          Open item
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ReportTableScroll>
          )}
        </div>
      )}
    </section>
  );
}
