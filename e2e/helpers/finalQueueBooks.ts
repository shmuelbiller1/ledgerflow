import type { Page } from '@playwright/test';
import { buildSampleBusinessYear } from '../../src/lib/sampleBusinessYear';
import type { AutoRule, TaxRate } from '../../src/model/ledger';

/**
 * The final raw-table batch's own books: the deterministic 12-month sample year
 * (`src/lib/sampleBusinessYear.ts`, the same generator the benchmark report uses) installed as the
 * guest sample company, plus the few collections that generator does not build — journal entries,
 * tax rates and automation rules — so the journal, tax and rules screens have rows to show.
 *
 * Every figure a test asserts on comes from this deterministic book, so the same assertions run
 * unchanged against the base commit for the before/after evidence.
 */

const uid = 'usr-sample';

const taxRates: TaxRate[] = [
  {
    id: 'tax-rate-sales-8', uid, workspaceId: 'guest', name: 'Sales tax 8%', rate: 0.08, type: 'Sales',
    appliesTo: 'sales', jurisdiction: 'NY', createdAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'tax-rate-use-5', uid, workspaceId: 'guest', name: 'Use tax 5%', rate: 0.05, type: 'Sales',
    appliesTo: 'purchases', jurisdiction: 'NY', createdAt: '2026-01-01T00:00:00Z',
  },
];

const autoRules: AutoRule[] = [
  {
    id: 'rule-warehouse-lease', uid, workspaceId: 'guest', name: 'Warehouse lease is rent', isActive: true,
    condition: { descriptionContains: 'warehouse lease', minAmountCents: 100000 },
    action: { targetTransactionKind: 'expense', flagForReview: false },
  },
  {
    id: 'rule-atlas-review', uid, workspaceId: 'guest', name: 'Atlas purchases over $500 wait for a person', isActive: true,
    condition: { vendor: 'Atlas Industrial Supply', minAmountCents: 50000 },
    action: { flagForReview: true },
  },
];

/** Loads the final-batch books into the guest sample company (same mechanism as installSmallSample). */
export async function installFinalQueueBooks(page: Page) {
  const books = buildSampleBusinessYear({ workspaceId: 'guest', year: 2026, scale: 1 });
  const table = (rows: Array<{ id: string }>) => Object.fromEntries(rows.map(row => [row.id, row]));
  // the Ledger screen's journal lists postable transactions of type 'journal' (Ledger.tsx maps
  // tx.type to the entry kind), so the worked adjusting entry travels as a transaction
  const journalTransaction = {
    id: 'tx-je-2026-001', uid, workspaceId: 'guest', date: '2026-02-10', type: 'journal', reference: 'FEB-ADJ',
    description: 'February depreciation (straight line, 60 months)', status: 'posted', currency: 'USD', totalAmountCents: 70_000,
    lines: [
      { id: 'tx-je-2026-001-L1', accountId: 'acc-depreciation', accountName: 'Depreciation Expense', amountCents: 70_000, debitCents: 70_000, creditCents: 0 },
      { id: 'tx-je-2026-001-L2', accountId: 'acc-forklift', accountName: 'Warehouse & Office Equipment', amountCents: -70_000, debitCents: 0, creditCents: 70_000 },
    ],
  };
  const tables: Record<string, Record<string, unknown>> = {
    workspaces: {
      guest: { ...books.workspace, id: 'guest', uid, name: 'Harbor & Olive Supply Co.' },
      // a second book, so the practice screen ("All my books") has a book to list
      'client-books': { id: 'client-books', uid: 'usr_demo', name: 'Beacon Retail Client Books', currency: 'USD', fiscalYearStartMonth: 1, createdAt: '2026-01-01T00:00:00Z' },
    },
    chartAccounts: table(books.accounts),
    transactions: { ...table(books.transactions), [journalTransaction.id]: journalTransaction },
    customers: table(books.customers),
    vendors: table(books.vendors),
    invoices: table(books.invoices),
    creditNotes: table(books.creditNotes),
    estimates: table(books.estimates),
    bills: table(books.bills),
    vendorCredits: table(books.vendorCredits),
    payments: table(books.payments),
    inventory: table(books.inventory),
    budgets: table(books.budgets),
    projects: table(books.projects),
    bankLines: table(books.bankLines),
    // the register reads purchasePriceCents/usefulLifeYears; the generator writes the same
    // figures under purchaseCostCents/usefulLifeMonths (its cast hides the gap), so adapt here
    assets: table(books.assets.map(asset => { const a = asset as unknown as { purchaseCostCents: number; usefulLifeMonths: number }; return { ...asset, purchasePriceCents: a.purchaseCostCents, usefulLifeYears: a.usefulLifeMonths / 12, accumulatedDepreciationCents: 0, depreciatedThrough: null }; })),
    recurring: table(books.recurring),
    reconciliations: table(books.reconciliations ?? []),
    dimensionNodes: table(books.dimensions.flatMap(dimension =>
      dimension.values.map(value => ({ id: value.toLowerCase().replace(/[^a-z]+/g, '-'), dimensionId: dimension.id, description: value, status: 'active' })))),
    taxRates: table(taxRates as unknown as Array<{ id: string }>),
    autoRules: table(autoRules as unknown as Array<{ id: string }>),
  };
  await page.addInitScript(data => {
    // Preserve real local writes over reload; each Playwright test starts with fresh tab storage.
    if (!sessionStorage.getItem('ledgerflow_sample_company_v1')) sessionStorage.setItem('ledgerflow_sample_company_v1', JSON.stringify(data));
  }, tables);
  return books;
}
