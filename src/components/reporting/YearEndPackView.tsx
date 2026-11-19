/**
 * R-6: the year-end pack — the one page an accountant asks for at the end of a year.
 *
 * It shows, for the chosen year, the profit and loss, the balance sheet, the trial balance, A/R and
 * A/P aging at the year end, the fixed assets held and the closing checklist — each with its
 * headline figures, a link to the full report, and all of it on one printed page.
 *
 * The figures come from `src/lib/yearEndPack.ts`, which calls the same report code the linked
 * screens call, so the pack cannot disagree with them. Nothing here posts, closes or files.
 *
 * Honesty (R-8, and the rule that a short figure must not read as the whole ledger): the pack is
 * worked out from what this browser has loaded, so it says which lists are capped, and the checks
 * row says whether the trial balance and the books balance in this data rather than assuming it.
 */
import { useMemo, useState } from 'react';
import { Printer } from 'lucide-react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import type { LedgerKey } from '../../lib/ledgerCollections';
import { buildYearEndPack, type YearEndSection } from '../../lib/yearEndPack';
import { getLocalDateISO } from '../../lib/utils';
import { formatCurrency } from '../../lib/moneyFormat';
import CloseReportLink from '../ledger/CloseReportLink';
import { CappedCollectionsNote } from '../common/LoadedEntriesOnlyNote';
import ReportEmptyState from './ReportEmptyState';
import { fill, useReportText } from './useReportText';

export default function YearEndPackView({ selectedYear }: { selectedYear?: number }) {
  const reportText = useReportText();
  // The guard requires a literal key and fallback per call, so the words are listed here rather than
  // looked up from a table — and the pack's own test proves this list covers every figure it emits.
  const figureWords: Record<string, string> = {
    'pl-income': reportText('r.ye-income', 'Income'),
    'pl-cogs': reportText('r.ye-cost-of-goods', 'Cost of goods'),
    'pl-gross-profit': reportText('r.ye-gross-profit', 'Gross profit'),
    'pl-expenses': reportText('r.ye-expenses', 'Expenses'),
    'pl-net-profit': reportText('r.ye-net-profit', 'Net profit for the year'),
    'bs-assets': reportText('r.ye-total-assets', 'Total assets'),
    'bs-liabilities': reportText('r.ye-total-liabilities', 'Total liabilities'),
    'bs-equity': reportText('r.ye-equity-accounts', 'Equity accounts'),
    'bs-retained': reportText('r.ye-retained-earnings', 'Profit of the year (retained earnings)'),
    'bs-claims': reportText('r.ye-total-claims', 'Liabilities and equity'),
    'tb-debits': reportText('r.ye-debits', 'Debits'),
    'tb-credits': reportText('r.ye-credits', 'Credits'),
    'tb-difference': reportText('r.ye-difference', 'Difference'),
    'tb-accounts': reportText('r.ye-accounts-with-a-balance', 'accounts with a balance'),
    'aging-total': reportText('r.ye-aging-total', 'Total outstanding'),
    'aging-current': reportText('r.ye-aging-current', 'Not late yet'),
    'aging-1-30': reportText('r.ye-aging-1-30', '1 to 30 days late'),
    'aging-31-60': reportText('r.ye-aging-31-60', '31 to 60 days late'),
    'aging-61-90': reportText('r.ye-aging-61-90', '61 to 90 days late'),
    'aging-90-plus': reportText('r.ye-aging-90-plus', 'More than 90 days late'),
    'aging-parties': reportText('r.ye-aging-parties', 'customers or vendors owing something'),
    'assets-count': reportText('r.ye-asset-count', 'assets still held'),
    'assets-cost': reportText('r.ye-asset-cost', 'Cost'),
    'assets-accumulated': reportText('r.ye-asset-accumulated', 'Depreciation recorded'),
    'assets-net-book': reportText('r.ye-asset-net-book', 'Book value'),
    'close-done': reportText('r.ye-close-done', 'checks done'),
    'close-attention': reportText('r.ye-close-attention', 'checks needing a look'),
    'close-blocker': reportText('r.ye-close-blocker', 'checks that block the close'),
  };
  const sectionWords: Record<string, string> = {
    'profit-and-loss': reportText('r.ye-section-profit-and-loss', 'Profit and loss for the year'),
    'balance-sheet': reportText('r.ye-section-balance-sheet', 'Balance sheet at the year end'),
    'trial-balance': reportText('r.ye-section-trial-balance', 'Trial balance at the year end'),
    receivables: reportText('r.ye-section-receivables', 'Owed by customers at the year end'),
    payables: reportText('r.ye-section-payables', 'Owed to vendors at the year end'),
    'fixed-assets': reportText('r.ye-section-fixed-assets', 'Fixed assets held at the year end'),
    closing: reportText('r.ye-section-closing', 'Closing the last month of the year'),
  };
  const reportWords: Record<string, string> = {
    pnl: reportText('r.ye-open-pnl', 'Open the profit and loss'),
    'balance-sheet': reportText('r.ye-open-balance-sheet', 'Open the balance sheet'),
    'trial-balance': reportText('r.ye-open-trial-balance', 'Open the trial balance'),
    'ar-aging': reportText('r.ye-open-ar-aging', 'Open A/R aging'),
    'ap-aging': reportText('r.ye-open-ap-aging', 'Open A/P aging'),
    'asset-register': reportText('r.ye-open-asset-register', 'Open the asset register'),
    'month-end-close': reportText('r.ye-open-close', 'Open month-end close'),
  };
  const workspaceCurrency = useAuthStore(s => s.getCurrentWorkspace()?.currency) || 'USD';

  const accounts = useLedgerStore(s => s.accounts);
  const transactions = useLedgerStore(s => s.transactions);
  const customers = useLedgerStore(s => s.customers);
  const vendors = useLedgerStore(s => s.vendors);
  const invoices = useLedgerStore(s => s.invoices);
  const bills = useLedgerStore(s => s.bills);
  const creditNotes = useLedgerStore(s => s.creditNotes);
  const vendorCredits = useLedgerStore(s => s.vendorCredits);
  const assets = useLedgerStore(s => s.assets);
  const bankLines = useLedgerStore(s => s.bankLines);
  const truncatedCollections = useLedgerStore(s => s.truncatedCollections);

  // the pack reads these lists, so ask for them explicitly instead of assuming the screen above loaded them
  useLedgerCollections('transactions', 'accounts', 'invoices', 'bills', 'assets', 'customers', 'vendors', 'creditNotes', 'vendorCredits');

  const thisYear = Number(getLocalDateISO().slice(0, 4)) || new Date().getFullYear();
  const [year, setYear] = useState<number>(() => Number(selectedYear) || thisYear);

  const pack = useMemo(() => buildYearEndPack({
    year,
    currency: workspaceCurrency,
    accounts,
    transactions,
    customers,
    vendors,
    invoices,
    bills,
    creditNotes,
    vendorCredits,
    assets,
    bankLines,
  }), [year, workspaceCurrency, accounts, transactions, customers, vendors, invoices, bills, creditNotes, vendorCredits, assets, bankLines]);

  // the lists this pack reads, filtered to those the browser capped (the note names only what is missing)
  const readLists: readonly LedgerKey[] = ['transactions', 'accounts', 'invoices', 'bills', 'assets', 'customers', 'vendors', 'creditNotes', 'vendorCredits'];
  const cappedKeys = readLists.filter(key => Boolean(truncatedCollections?.[key]));
  // R-8: "nothing loaded" and "nothing posted this year" are different things to the reader, and
  // opening balances can give a year figures without a single entry in it, so the two are told apart.
  const nothingLoaded = (transactions || []).length === 0;
  const nothingPosted = pack.entriesInYear === 0;

  const money = (cents: number | undefined) => formatCurrency(cents || 0, pack.currency);

  const section = (entry: YearEndSection) => {
    const title = sectionWords[entry.id] || reportText('r.ye-section', 'Section');
    return (
      <section key={entry.id} data-year-end-section={entry.id} className="rounded-xl border border-[var(--border)] p-4 break-inside-avoid">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-semibold">{title}</h3>
          {entry.reportId && reportWords[entry.reportId]
            ? <span data-print-hide><CloseReportLink report={entry.reportId} label={reportWords[entry.reportId]} endDate={entry.id === 'profit-and-loss' ? undefined : pack.endDate} /></span>
            : null}
        </div>
        <dl className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
          {entry.figures.map(figure => (
            <div key={figure.key} data-year-end-figure={figure.key} className={`flex justify-between gap-3 border-b border-dashed border-[var(--border)] py-1 ${figure.strong ? 'font-semibold' : ''}`}>
              <dt className="text-[var(--muted)]">{figureWords[figure.key] || reportText('r.ye-unknown-figure', 'Figure')}</dt>
              <dd className="tabular-nums">{figure.count !== undefined ? figure.count : money(figure.cents)}</dd>
            </div>
          ))}
        </dl>
      </section>
    );
  };

  const balanced = pack.checks.trialBalanceBalanced && pack.checks.booksBalanced;
  const checksText = balanced
    ? reportText('r.ye-checks-good', 'The trial balance balances and the books balance at the year end, so this pack can be handed over.')
    : fill(
        reportText('r.ye-checks-bad', 'These figures do not balance at the year end, so this pack is not ready to hand over: the trial balance {tb}, the books {books}. Open the report named below for each.'),
        {
          tb: pack.checks.trialBalanceBalanced ? reportText('r.ye-balances', 'balances') : reportText('r.ye-does-not-balance', 'does not balance'),
          books: pack.checks.booksBalanced ? reportText('r.ye-balances', 'balances') : reportText('r.ye-does-not-balance', 'does not balance'),
        },
      );

  return (
    <div className="space-y-4" data-print-root data-year-end-pack>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{reportText('r.year-end-pack', 'Year-end pack')}</h2>
          <p className="text-sm text-[var(--muted)]">
            {reportText('r.ye-subtitle', 'One page for the year: profit and loss, balance sheet, trial balance, what customers and vendors owe, fixed assets and the closing checklist.')}
          </p>
        </div>
        <div data-print-hide className="flex flex-wrap items-center gap-2">
          <label className="text-sm">
            <span className="mr-1">{reportText('r.ye-year', 'Year')}</span>
            <input
              type="number"
              data-year-end-year
              value={year}
              min={1900}
              max={2200}
              onChange={event => {
                const next = Number(event.target.value);
                if (Number.isFinite(next) && next >= 1900 && next <= 2200) setYear(Math.trunc(next));
              }}
              className="w-24 min-h-11 rounded-lg border border-[var(--border)] bg-transparent px-2 py-1"
              aria-label={reportText('r.ye-year-of-the-pack', 'Year the pack covers')}
            />
          </label>
          <button
            type="button"
            onClick={() => window.print()}
            className="min-h-11 inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-3 text-sm font-semibold"
          >
            <Printer aria-hidden="true" size={13} /> {reportText('r.ye-print', 'Print or save as PDF')}
          </button>
        </div>
      </div>

      <p data-year-end-checks role={balanced ? undefined : 'alert'} className={`rounded-lg border px-3 py-2 text-sm ${balanced ? 'border-[var(--border)]' : 'border-red-400'}`}>
        {checksText}
      </p>

      <CappedCollectionsNote testId="year-end-capped" keys={cappedKeys} what={reportText('r.ye-this-pack', 'this year-end pack')} />

      {nothingPosted
        ? (nothingLoaded
            ? <ReportEmptyState
                title={reportText('r.no-entries-loaded-yet', 'No entries loaded yet')}
                description={reportText('r.ye-empty-nothing-loaded', 'This pack reads the entries in this browser: import or record an entry and it appears here.')}
              />
            : <ReportEmptyState
                title={reportText('r.ye-empty-title', 'Nothing posted in this year yet')}
                description={reportText('r.ye-empty-detail', 'Choose another year, or post an entry: the pack fills in as the year is booked.')}
              />)
        : null}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {pack.sections.map(section)}
      </div>

      <p className="text-xs text-[var(--muted)]">
        {fill(reportText('r.ye-provenance', 'Worked out in this browser from the entries, documents and assets loaded here, as of {date}. It posts, closes and files nothing.'), { date: pack.endDate })}
      </p>
    </div>
  );
}
