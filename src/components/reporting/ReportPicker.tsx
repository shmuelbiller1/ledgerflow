import React, { useState } from 'react';
import { REPORT_TABS_REGISTRY } from '../../config/registry';
import { useUIStore } from '../../stores/useUIStore';

type GroupId = 'Statements' | 'Sales' | 'Purchases' | 'Stock' | 'Tax' | 'Banking' | 'Analysis';
const GROUP_ORDER: GroupId[] = ['Statements', 'Sales', 'Purchases', 'Stock', 'Tax', 'Banking', 'Analysis'];
const REPORT_GROUP: Record<string, GroupId> = {
  pnl: 'Statements',
  'balance-sheet': 'Statements',
  'balance-sheet-by-label': 'Statements',
  'cash-flow': 'Statements',
  'general-ledger': 'Statements',
  'party-linked-trial-balance': 'Statements',
  'journal-sheet': 'Statements',
  'account-balances-as-of': 'Statements',
  'group-summary': 'Statements',
  'by-label': 'Statements',
  cashflow: 'Statements',
  'deferred-revenue-waterfall': 'Statements',
  'open-advances': 'Statements',

  'sales-trends': 'Sales',
  'sales-payment-summary': 'Sales',
  'sales-by-item': 'Sales',
  'sales-by-territory': 'Sales',
  'gross-profit-by-customer': 'Sales',
  'gross-margin-by-item-group': 'Sales',
  'profitability-by': 'Sales',
  'transactions-by-customer': 'Sales',
  'customer-period-summary': 'Sales',
  'customer-balance-summary': 'Sales',
  'contact-balance-summary': 'Sales',
  'customer-cohorts': 'Sales',
  'customer-lifetime-value': 'Sales',
  'customer-quotes': 'Sales',
  'quote-versions': 'Sales',
  'customer-item-codes': 'Sales',
  'shipping-methods': 'Sales',
  'sales-tax-holidays': 'Tax',
  'purchase-trends': 'Purchases',
  'purchase-price-variance': 'Purchases',
  'vendor-quotes-compare': 'Purchases',
  'bill-retention': 'Purchases',
  'vendor-scorecard': 'Purchases',
  'vendor-price-history': 'Purchases',
  'three-way-match': 'Purchases',
  'transactions-by-vendor': 'Purchases',
  'supplier-period-summary': 'Purchases',
  'vendor-balance-summary': 'Purchases',
  'transactions-by-reference': 'Purchases',
  'payment-period-by-invoice-date': 'Purchases',

  'inventory-valuation': 'Stock',
  'inventory-details': 'Stock',
  'stock-aging': 'Stock',
  'slow-moving-stock': 'Stock',
  'inactive-items': 'Stock',
  'item-register': 'Stock',
  'one-sided-transfers': 'Stock',
  'expiring-lots': 'Stock',
  'stock-transfers': 'Stock',
  'kit-assembly': 'Stock',
  'work-orders': 'Stock',
  'aged-inventory-by-lot': 'Stock',
  'stock-value-by-location-lot': 'Stock',
  'landed-cost-preview': 'Stock',
  'cycle-count': 'Stock',
  'reorder-suggestions': 'Stock',
  'backorders': 'Stock',
  'blanket-orders': 'Stock',
  depreciation: 'Stock',
  'depreciation-ledger': 'Stock',
  'goods-not-billed': 'Stock',
  'bank-clearance': 'Banking',
  'asset-register': 'Stock',
  'stock-sources-uses': 'Stock',
  'bank-related-stock': 'Stock',

  'us-filing-calendar': 'Tax',
  'israeli-document-types': 'Tax',
  'us-1099-preview': 'Tax',
  'entity-filings': 'Tax',
  'tax-code-suggestions': 'Tax',
  'us-nexus-watch': 'Tax',
  'israel-advance-tax': 'Tax',
  'israel-self-employment-ni': 'Tax',
  'mileage-rates': 'Tax',
  'tax-liability': 'Tax',
  'vendor-withholding': 'Tax',
  'customer-tax-certificates': 'Tax',
  'vendor-tax-records': 'Tax',
  'discount-mismatch': 'Tax',
  'registration-threshold-watch': 'Tax',
  'use-tax-review': 'Tax',
  'purchases-from-abroad': 'Tax',
  'golden-tax-fixtures': 'Tax',
  'us-quarter-journey': 'Tax',
  'il-month-journey': 'Tax',
  'il-annual-party-summary': 'Tax',
  'tax-liability-by-entity': 'Tax',
  'form-856': 'Tax',
  'vendor-1099-readiness': 'Tax',

  'bank-holidays': 'Banking',
  'banking-validation': 'Banking',
  'exchange-rates-used': 'Banking',
  'bank-holidays-and-due-dates': 'Banking',

  'financial-ratios': 'Analysis',
  'delivery-notes': 'Analysis',
  'milestone-billing': 'Analysis',
  commission: 'Analysis',
  commissions: 'Analysis',
  'dunning-letters': 'Analysis',
  'duplicate-bill-review': 'Analysis',
  'duplicate-contact-review': 'Analysis',
  'document-number-gaps': 'Analysis',
  'cash-forecast-13-week': 'Analysis',
  'customer-credit-limits': 'Analysis',
  'record-notes': 'Analysis',
  'serial-lot-lookup': 'Analysis',
  'import-acceptance': 'Analysis',
  'budget-actual': 'Analysis',
  'expense-by-category': 'Analysis',
  'expense-by-employee': 'Analysis',
  'expense-policy-check': 'Analysis',
  'expense-receipt-checklist': 'Analysis',
  'inventory-turnover': 'Analysis',
  'data-quality-checks': 'Analysis',
  'sample-year-benchmark': 'Analysis',
  'accountant-queue': 'Analysis',
  'monthly-averages': 'Analysis',
  'income-by-source': 'Analysis',
  'record-retention-review': 'Analysis',
};

/** Native disclosure and select retain normal Tab, typing and platform keyboard behaviour. */
export default function ReportPicker({ activeTab, onSelect }: { activeTab: string; onSelect: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const recent = useUIStore(s => s.recentReports);
  const recordRecent = useUIStore(s => s.recordRecentReport);
  const syncStatus = useUIStore(s => s.reportPreferencesStatus);
  const deviceError = useUIStore(s => s.reportPreferencesDeviceError);
  const pins = useUIStore(s => s.pinnedPages);
  const label = (id: string) => REPORT_TABS_REGISTRY.find(r => r.id === id)?.label.en || id;
  const filtered = REPORT_TABS_REGISTRY.filter(r => `${r.label.en} ${r.label.he} ${r.id}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const pinned = pins.filter(p => p.tab === 'reports' && p.sub && REPORT_TABS_REGISTRY.some(r => r.id === p.sub)).map(p => p.sub!);
  const select = (id: string) => {
    if (!REPORT_TABS_REGISTRY.some(r => r.id === id)) return;
    recordRecent(id);
    onSelect(id);
  };
  return <details className="rounded-lg border border-[var(--line)] bg-[var(--surface)] text-[var(--text)] p-2">
    <summary className="min-h-11 flex items-center cursor-pointer focus-visible:outline-2">Choose report: {label(activeTab)}</summary>
    <div className="space-y-3 pt-2">
      <div>
        <label htmlFor="report-picker-search" className="block">Search reports</label>
        <input id="report-picker-search" value={query} onChange={e => setQuery(e.target.value)} type="search" className="block min-h-11 w-full rounded border border-[var(--line)] bg-[var(--panel)] text-[var(--text)] px-3" />
      </div>
      <div>
        <label htmlFor="report-picker-select" className="block">Choose report</label>
        <select id="report-picker-select" value={filtered.some(r => r.id === activeTab) ? activeTab : ''} onChange={e => select(e.target.value)} className="block min-h-11 w-full max-w-full rounded border border-[var(--line)] bg-[var(--panel)] text-[var(--text)] px-2">
          <option value="" disabled>Select a report</option>
          {GROUP_ORDER.map(group => <optgroup key={group} label={group}>
            {filtered.filter(r => (REPORT_GROUP[r.id] || 'Analysis') === group).map(r => <option key={r.id} value={r.id}>{r.label.en}</option>)}
          </optgroup>)}
        </select>
      </div>
      {filtered.length === 0 && <p role="status">No reports match. Clear the search to see all reports.</p>}
      {!query.trim() && [['Pinned reports', pinned], ['Recent reports', recent]].map(([title, ids]) => <section key={title as string} aria-label={title as string}>
        <h2 className="font-semibold">{title}</h2>
        <div className="flex flex-wrap gap-2">{(ids as string[]).length ? (ids as string[]).map(id => <button type="button" key={id} onClick={() => select(id)} className="min-h-11 px-3 border border-[var(--line)] rounded text-start">{label(id)}</button>) : <p className="text-sm">{title === 'Pinned reports' ? 'Use Alt+P to pin the current report.' : 'Reports selected here appear here on this device.'}</p>}</div>
      </section>)}
      {deviceError && <p role="status">The report opened, but this browser could not keep a device copy of your recent reports and pins.</p>}
      <p className="text-sm" role={syncStatus === 'error' ? 'status' : undefined}>
        {syncStatus === 'loading' && 'Your device copy is ready; loading account sync for recent reports and pinned pages…'}
        {syncStatus === 'saving' && 'Saving recent reports and pinned pages to your account…'}
        {syncStatus === 'synced' && 'Recent reports and pinned pages sync to your account for these books.'}
        {syncStatus === 'error' && (deviceError
          ? 'Account sync failed, and this browser could not keep a device copy. Reconnect and try another change.'
          : 'Saved on this device. Account sync failed and will retry after a change or when you reconnect.')}
        {syncStatus === 'device' && 'Recent reports and pinned pages are saved on this device for these books.'}
      </p>
    </div>
  </details>;
}
