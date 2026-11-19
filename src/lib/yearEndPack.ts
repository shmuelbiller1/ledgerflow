/**
 * R-6: the year-end pack — one screen and one PDF for the year an accountant asks about.
 *
 * It gathers the figures that already exist, by calling the same report code the screens call:
 * `computeProfitAndLoss`, `computeBalanceSheet` and `computeTrialBalance`
 * (`src/server/reports/computeReports.ts`), `computePartyAging` (`src/lib/aging.ts`) for A/R and A/P
 * at the year end, the fixed-asset register from the asset list, and the month-end checklist
 * (`src/lib/closeChecklist.ts`) for the year's closing month.
 *
 * What it deliberately does not do:
 * - **No second formula.** Every figure is a report's own figure; this module adds nothing up that a
 *   screen would add differently. The checks it returns (does the trial balance balance, do the
 *   books balance) are the report code's own answers, carried through.
 * - **No posting and no filing.** Read-only: nothing here writes, closes or files anything.
 * - **No claim of completeness.** A caller passes what it has; the screen says when the lists it
 *   read are capped in this browser (R-8), so a short year cannot look like a whole one.
 *
 * Figures carry a stable `key`, not English words: the screen turns each key into the reader's
 * language (the translation guard covers it), and a test keeps the keys and the pack in step.
 */
import type { Bill, ChartAccount, CreditNote, Customer, FixedAsset, Invoice, Transaction, Vendor, VendorCredit } from '../types';
import { computeBalanceSheet, computeProfitAndLoss, computeTrialBalance } from '../server/reports/computeReports';
import { computePartyAging, type PartyAgingRow } from './aging';
import { buildCloseChecklist, type CloseItem } from './closeChecklist';
import { isPostable, isTransactionInDateRange } from './txFilters';

export type YearEndSectionId = 'profit-and-loss' | 'balance-sheet' | 'trial-balance' | 'receivables' | 'payables' | 'fixed-assets' | 'closing';

/** One figure on the pack: a stable key and cents. `count` is used for "N accounts" style lines. */
export interface YearEndFigure {
  key: string;
  cents?: number;
  count?: number;
  /** emphasised on the page: a natural subtotal or total */
  strong?: boolean;
}

export interface YearEndSection {
  id: YearEndSectionId;
  /** the Reports registry id that opens the detailed report, when one exists */
  reportId?: string;
  figures: YearEndFigure[];
}

export interface YearEndChecks {
  /** debits = credits at the year end, from the trial balance's own answer */
  trialBalanceBalanced: boolean;
  /** assets = liabilities + equity + retained earnings, from the balance sheet's own answer */
  booksBalanced: boolean;
  /** assets − claims, in cents (0 when they balance) */
  differenceCents: number;
  /** accounts the sheet could not place in the chart (their lines are left out of the sheet) */
  orphanedLines: number;
}

export interface YearEndPack {
  year: number;
  startDate: string;
  endDate: string;
  currency: string;
  sections: YearEndSection[];
  checks: YearEndChecks;
  /** the year's closing month, which the checklist covers (YYYY-MM) */
  closingMonth: string;
  /** the checklist's items for that month, as the close screen holds them */
  closeItems: CloseItem[];
  /** posted entries dated in the year (the pack's own "is there anything here" test) */
  entriesInYear: number;
}

export interface YearEndPackInput {
  year: number;
  currency: string;
  accounts: ChartAccount[];
  transactions: Transaction[];
  customers?: Customer[];
  vendors?: Vendor[];
  invoices?: Invoice[];
  bills?: Bill[];
  creditNotes?: CreditNote[];
  vendorCredits?: VendorCredit[];
  assets?: FixedAsset[];
  bankLines?: Array<{ date?: string; status?: string; matchedTransactionId?: string | null }>;
  journalEntries?: Array<{ date?: string; status?: string; deletedAt?: unknown }>;
}

/** The first and last day of a calendar year, as stored dates. */
export function yearBounds(year: number): { startDate: string; endDate: string; closingMonth: string } {
  const y = String(Math.trunc(year)).padStart(4, '0');
  return { startDate: `${y}-01-01`, endDate: `${y}-12-31`, closingMonth: `${y}-12` };
}

/** The five aging buckets added up, as one figure each — the row an accountant reads first. */
function agingFigures(rows: PartyAgingRow[]): YearEndFigure[] {
  const totals = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 };
  let total = 0;
  let parties = 0;
  for (const row of rows) {
    if (!row.total) continue;
    parties += 1;
    total += row.total;
    for (const key of Object.keys(totals) as Array<keyof typeof totals>) totals[key] += row.buckets[key] || 0;
  }
  return [
    { key: 'aging-total', cents: total, strong: true },
    { key: 'aging-current', cents: totals.current },
    { key: 'aging-1-30', cents: totals.d1_30 },
    { key: 'aging-31-60', cents: totals.d31_60 },
    { key: 'aging-61-90', cents: totals.d61_90 },
    { key: 'aging-90-plus', cents: totals.d90plus },
    { key: 'aging-parties', count: parties },
  ];
}

/** Active fixed assets at the year end: what they cost, what has been depreciated, what is left. */
function fixedAssetFigures(assets: FixedAsset[], asOf: string): YearEndFigure[] {
  // held at the year end: bought by then and not yet disposed of then (Gitar on #927). Cost and
  // depreciation are the asset's recorded figures as they stand today; the section says so.
  const live = assets.filter(asset => asset.status !== 'in_progress'
    && (!asset.purchaseDate || asset.purchaseDate.slice(0, 10) <= asOf)
    && (asset.disposedOn ? asset.disposedOn.slice(0, 10) > asOf : asset.status !== 'disposed'));
  const cost = live.reduce((sum, asset) => sum + (asset.purchasePriceCents || 0), 0);
  const depreciated = live.reduce((sum, asset) => sum + (asset.accumulatedDepreciationCents || 0), 0);
  return [
    { key: 'assets-count', count: live.length },
    { key: 'assets-cost', cents: cost },
    { key: 'assets-accumulated', cents: depreciated },
    { key: 'assets-net-book', cents: cost - depreciated, strong: true },
  ];
}

/**
 * The pack for one year. Pure: same inputs, same figures, no reading of a store.
 */
export function buildYearEndPack(input: YearEndPackInput): YearEndPack {
  const { startDate, endDate, closingMonth } = yearBounds(input.year);
  const accounts = input.accounts || [];
  const transactions = input.transactions || [];
  const invoices = input.invoices || [];
  const bills = input.bills || [];

  const pl = computeProfitAndLoss(accounts, transactions, startDate, endDate);
  const sheet = computeBalanceSheet(accounts, transactions, endDate);
  const trial = computeTrialBalance(accounts, transactions, endDate);
  // only documents dated by the year end; what is still owed on them is as recorded today (the sections say so)
  const byYearEnd = <T extends { date?: string }>(docs: T[]) => docs.filter(doc => !doc.date || doc.date.slice(0, 10) <= endDate);
  const receivables = computePartyAging(input.customers || [], byYearEnd(invoices), 'customer', endDate, input.currency);
  const payables = computePartyAging(input.vendors || [], byYearEnd(bills), 'vendor', endDate, input.currency);
  const closeItems = buildCloseChecklist({
    month: closingMonth,
    baseCurrency: input.currency,
    transactions,
    bankLines: input.bankLines || [],
    invoices,
    bills,
    creditNotes: input.creditNotes || [],
    vendorCredits: input.vendorCredits || [],
    journalEntries: input.journalEntries || [],
    assets: input.assets || [],
  });
  const closeCounts = closeItems.reduce((counts, item) => {
    counts[item.status] += 1;
    return counts;
  }, { done: 0, attention: 0, blocker: 0 });

  const accountsWithBalance = trial.accounts.filter(account => account.debit !== 0 || account.credit !== 0).length;

  return {
    year: input.year,
    startDate,
    endDate,
    currency: input.currency,
    closingMonth,
    closeItems,
    entriesInYear: transactions.filter(entry => isPostable(entry) && isTransactionInDateRange(entry, startDate, endDate)).length,
    sections: [
      {
        id: 'profit-and-loss',
        reportId: 'pnl',
        figures: [
          { key: 'pl-income', cents: pl.income.total },
          { key: 'pl-cogs', cents: pl.cogs.total },
          { key: 'pl-gross-profit', cents: pl.grossProfit, strong: true },
          { key: 'pl-expenses', cents: pl.expense.total },
          { key: 'pl-net-profit', cents: pl.netIncome, strong: true },
        ],
      },
      {
        id: 'balance-sheet',
        reportId: 'balance-sheet',
        figures: [
          { key: 'bs-assets', cents: sheet.totalAssets, strong: true },
          { key: 'bs-liabilities', cents: sheet.totalLiabilities },
          { key: 'bs-equity', cents: sheet.totalEquity },
          { key: 'bs-retained', cents: sheet.netIncome },
          { key: 'bs-claims', cents: sheet.totalClaims, strong: true },
        ],
      },
      {
        id: 'trial-balance',
        reportId: 'trial-balance',
        figures: [
          { key: 'tb-debits', cents: trial.totalDebit },
          { key: 'tb-credits', cents: trial.totalCredit },
          { key: 'tb-difference', cents: trial.totalDebit - trial.totalCredit, strong: true },
          { key: 'tb-accounts', count: accountsWithBalance },
        ],
      },
      {
        id: 'receivables',
        reportId: 'ar-aging',
        figures: agingFigures(receivables),
      },
      {
        id: 'payables',
        reportId: 'ap-aging',
        figures: agingFigures(payables),
      },
      {
        id: 'fixed-assets',
        reportId: 'asset-register',
        figures: fixedAssetFigures(input.assets || [], endDate),
      },
      {
        id: 'closing',
        reportId: 'month-end-close',
        figures: [
          { key: 'close-done', count: closeCounts.done },
          { key: 'close-attention', count: closeCounts.attention },
          { key: 'close-blocker', count: closeCounts.blocker, strong: closeCounts.blocker > 0 },
        ],
      },
    ],
    checks: {
      trialBalanceBalanced: trial.isBalanced,
      booksBalanced: sheet.isBalanced,
      differenceCents: sheet.totalAssets - sheet.totalClaims,
      orphanedLines: (sheet.orphanedLines || []).length,
    },
  };
}

/**
 * Every figure key the pack can produce, so a test can prove the screen has words for each one and
 * a new figure cannot arrive without a translation.
 */
export const YEAR_END_FIGURE_KEYS: readonly string[] = [
  'pl-income', 'pl-cogs', 'pl-gross-profit', 'pl-expenses', 'pl-net-profit',
  'bs-assets', 'bs-liabilities', 'bs-equity', 'bs-retained', 'bs-claims',
  'tb-debits', 'tb-credits', 'tb-difference', 'tb-accounts',
  'aging-total', 'aging-current', 'aging-1-30', 'aging-31-60', 'aging-61-90', 'aging-90-plus', 'aging-parties',
  'assets-count', 'assets-cost', 'assets-accumulated', 'assets-net-book',
  'close-done', 'close-attention', 'close-blocker',
];
