/**
 * A-206: measures report execution speed across AI #3's heaviest reports on the 12-month
 * small-business fixture (`A-148`), ranking them from heaviest to lightest and verifying that
 * every report completes under the 1,000 ms budget (`REPORT_BUDGET_MS`).
 *
 * Pure and read-only: operates strictly on a `SampleBusinessYearFixture` without touching workspace state.
 */
import { cashForecast13Week } from './cashForecast13Week';
import { findDuplicateContactCandidates } from './contactDuplicateReview';
import { evaluateDataQuality } from './dataQualityChecks';
import { documentNumberGaps } from './documentNumberGaps';
import { findDuplicateBills } from './duplicateBills';
import { verifyGoldenFixtures } from './goldenTaxFixtures';
import { verifyGoldenYearFixtures } from './goldenYearFixtures';
import { retentionReview, type RetentionSourceRecord } from './retentionReview';
import { salesByTerritory } from './salesByTerritory';
import { getSampleBusinessYear, type SampleBusinessYearFixture } from './sampleBusinessYear';
import { duplicateSerials, lotRows, serialsForItem, type SerializedLine } from './serialNumbers';
import { itemDetails } from './stockMoves';
import { transferPairs } from './stockTransfers';
import { valuationByLocation, valuationByLots } from './stockValuation';
import { vendor1099Readiness, type ReadinessVendor } from './vendor1099Readiness';

export const REPORT_BUDGET_MS = 1_000;

export interface BenchmarkedReportRow {
  reportId: string;
  label: string;
  durationMs: number;
  rowsProduced: number;
  withinBudget: boolean;
  isTopFiveHeaviest: boolean;
}

export interface SampleYearBenchmarkResult {
  budgetMs: number;
  scale: number;
  totalDurationMs: number;
  allWithinBudget: boolean;
  topFiveHeaviest: BenchmarkedReportRow[];
  reports: BenchmarkedReportRow[];
}

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

export function runSampleYearReportBenchmark(
  fixture: SampleBusinessYearFixture = getSampleBusinessYear(),
  scale = 1,
): SampleYearBenchmarkResult {
  const specs: Array<{ reportId: string; label: string; run: () => number }> = [
    {
      reportId: 'golden-tax-fixtures',
      label: 'Golden Tax Fixtures (80 cases + 12-month IL/US returns)',
      run: () => {
        const g1 = verifyGoldenFixtures();
        const g2 = verifyGoldenYearFixtures();
        return g1.invoices + g1.bills + g2.failures.length;
      },
    },
    {
      reportId: 'stock-value-by-location-lot',
      label: 'Stock Value by Location & Lot',
      run: () => {
        const history = itemDetails(fixture.stockMoves, fixture.startDate, fixture.endDate);
        const byLoc = valuationByLocation({
          asOf: fixture.asOfDate,
          items: fixture.inventory,
          toToday: history,
        });
        const receipts = fixture.purchaseOrders.flatMap(po =>
          (po.receipts || []).flatMap(r => {
            const receiptNumber = (r as unknown as { receiptNumber?: string }).receiptNumber || po.poNumber;
            const rawLines = (r as unknown as { items?: Array<{ itemId?: string; lotNumber?: string; quantityReceived: number; unitCostCents?: number }> }).items || [];
            return rawLines
              .filter(l => l.lotNumber && l.itemId)
              .map(l => ({
                itemId: l.itemId as string,
                lotNumber: l.lotNumber as string,
                quantity: l.quantityReceived,
                unitPriceCents: l.unitCostCents || 0,
                receiptNumber,
                receivedDate: r.receivedDate,
              }));
          }),
        );
        const sales = fixture.invoices.flatMap(inv =>
          (inv.items || [])
            .filter(l => (l as unknown as { lotNumber?: string }).lotNumber && l.itemId)
            .map(l => ({
              itemId: l.itemId as string,
              lotNumber: (l as unknown as { lotNumber: string }).lotNumber,
              quantity: l.quantity,
              lastDate: inv.date || '',
            })),
        );
        const byLot = valuationByLots(receipts, sales);
        return byLoc.items.length + byLot.rows.length;
      },
    },
    {
      reportId: 'data-quality-checks',
      label: 'Data Quality Checks (Required Labels, Filings, Item Pricing)',
      run: () => {
        const dq = evaluateDataQuality({
          transactions: fixture.transactions,
          accounts: fixture.accounts,
          dimensions: fixture.dimensions,
          customers: fixture.customers,
          vendors: fixture.vendors,
          invoices: fixture.invoices,
          bills: fixture.bills,
          payments: fixture.payments,
          inventory: fixture.inventory,
          taxYear: fixture.year,
          homeCurrency: 'USD',
          workspaceCountry: 'US',
        });
        return dq.missingLabelEntries.length + dq.missingFilingParties.length + dq.missingItemPricing.length;
      },
    },
    {
      reportId: 'serial-lot-lookup',
      label: 'Serial & Lot Lookup (Receipts, Invoices & Duplicate Check)',
      run: () => {
        const docs = [
          ...fixture.invoices.map(inv => ({
            id: inv.number || inv.id,
            type: 'invoice',
            date: inv.date || '',
            lines: (inv.items || []) as unknown as SerializedLine[],
          })),
          ...fixture.purchaseOrders.flatMap(po =>
            (po.receipts || []).map(r => ({
              id: (r as unknown as { receiptNumber?: string }).receiptNumber || po.poNumber,
              type: 'goods receipt',
              date: r.receivedDate || '',
              lines: ((r as unknown as { items?: SerializedLine[] }).items || []),
            })),
          ),
        ];
        let count = duplicateSerials(docs).length;
        for (const item of fixture.inventory.slice(0, 20)) {
          count += serialsForItem(docs, item.id).length + lotRows(docs, item.id).length;
        }
        return count;
      },
    },
    {
      reportId: 'record-retention-review',
      label: 'Record Retention Review (All 12-Month Documents)',
      run: () => {
        const records: RetentionSourceRecord[] = [
          ...fixture.invoices.map(i => ({ collection: 'invoices' as const, id: i.id, number: i.number, date: i.date, status: i.status })),
          ...fixture.bills.map(b => ({ collection: 'bills' as const, id: b.id, number: b.number, date: b.date, status: b.status })),
          ...fixture.creditNotes.map(c => ({ collection: 'creditNotes' as const, id: c.id, number: c.number, date: c.date, status: c.status })),
          ...fixture.vendorCredits.map(v => ({ collection: 'vendorCredits' as const, id: v.id, number: v.number, date: v.date, status: v.status })),
          ...fixture.estimates.map(e => ({ collection: 'estimates' as const, id: e.id, number: e.number, date: e.date, status: e.status })),
          ...fixture.purchaseOrders.map(p => ({ collection: 'purchaseOrders' as const, id: p.id, number: p.poNumber, date: p.issueDate, status: p.status })),
        ];
        return retentionReview({
          asOfDate: fixture.asOfDate,
          records,
          profiles: fixture.workspace.taxProfiles,
        }).rows.length;
      },
    },
    {
      reportId: 'cash-forecast-13-week',
      label: '13-Week Cash Forecast',
      run: () => {
        const forecast = cashForecast13Week({
          asOf: `${fixture.year}-10-01`,
          openingCashCents: 25_000_000,
          homeCurrency: 'USD',
          invoices: fixture.invoices.map(i => ({
            id: i.id,
            label: i.number || i.id,
            expectedDate: i.dueDate || i.date,
            amountCents: i.amountCents,
            paidCents: i.amountPaidCents,
            currency: i.currency,
            status: i.status,
          })),
          bills: fixture.bills.map(b => ({
            id: b.id,
            label: b.number || b.id,
            expectedDate: b.dueDate || b.date,
            amountCents: b.amountCents,
            paidCents: b.amountPaidCents,
            currency: b.currency,
            status: b.status,
          })),
          recurring: [],
        });
        return forecast.weeks.length;
      },
    },
    {
      reportId: 'duplicate-bill-review',
      label: 'Duplicate Bill Review',
      run: () => findDuplicateBills(fixture.bills).pairs.length + fixture.bills.length,
    },
    {
      reportId: 'duplicate-contact-review',
      label: 'Duplicate Contact Review',
      run: () => {
        const contacts = [
          ...fixture.customers.map(c => ({ id: c.id, kind: 'customer' as const, name: c.name, email: c.email, phone: c.phone, metadata: c.metadata })),
          ...fixture.vendors.map(v => ({ id: v.id, kind: 'vendor' as const, name: v.name, email: v.email, phone: v.phone, metadata: v.metadata })),
        ];
        return findDuplicateContactCandidates(contacts).pairs.length + contacts.length;
      },
    },
    {
      reportId: 'document-number-gaps',
      label: 'Document Number Gaps',
      run: () => {
        const docs = [
          ...fixture.invoices.map(i => ({ id: i.id, collection: 'Sales invoices', number: i.number, date: i.date, status: i.status })),
          ...fixture.bills.map(b => ({ id: b.id, collection: 'Purchase bills', number: b.number, date: b.date, status: b.status })),
          ...fixture.creditNotes.map(c => ({ id: c.id, collection: 'Credit notes', number: c.number, date: c.date, status: c.status })),
        ];
        return documentNumberGaps(docs).series.length;
      },
    },
    {
      reportId: 'vendor-1099-readiness',
      label: 'Vendor 1099 Readiness',
      run: () =>
        vendor1099Readiness({
          vendors: fixture.vendors as unknown as ReadinessVendor[],
          payments: fixture.payments,
          taxYear: fixture.year,
          homeCurrency: 'USD',
        }).rows.length,
    },
    {
      reportId: 'sales-by-territory',
      label: 'Sales by Territory',
      run: () =>
        salesByTerritory({
          invoices: fixture.invoices,
          startDate: fixture.startDate,
          endDate: fixture.endDate,
          homeCurrency: 'USD',
        }).rows.length,
    },
    {
      reportId: 'stock-transfers',
      label: 'Stock Transfers Across Locations',
      run: () => transferPairs(fixture.stockMoves).length,
    },
  ];

  const suiteStart = nowMs();
  const measured = specs.map(spec => {
    const start = nowMs();
    const rowsProduced = spec.run();
    const durationMs = Number((nowMs() - start).toFixed(2));
    return {
      reportId: spec.reportId,
      label: spec.label,
      durationMs,
      rowsProduced,
      withinBudget: durationMs < REPORT_BUDGET_MS,
      isTopFiveHeaviest: false,
    };
  });
  const totalDurationMs = Number((nowMs() - suiteStart).toFixed(2));

  measured.sort((a, b) => b.durationMs - a.durationMs || a.reportId.localeCompare(b.reportId));
  measured.forEach((row, index) => {
    row.isTopFiveHeaviest = index < 5;
  });

  return {
    budgetMs: REPORT_BUDGET_MS,
    scale,
    totalDurationMs,
    allWithinBudget: measured.every(r => r.withinBudget),
    topFiveHeaviest: measured.slice(0, 5),
    reports: measured,
  };
}

export const SAMPLE_YEAR_BENCHMARK_CSV_HEADERS = [
  'Rank',
  'Report ID',
  'Report',
  'Top 5 heaviest',
  'Measured (ms)',
  'Budget (ms)',
  'Rows computed',
  'Status',
];

export function sampleYearBenchmarkCsvRows(result: SampleYearBenchmarkResult): string[][] {
  return result.reports.map((row, idx) => [
    String(idx + 1),
    row.reportId,
    row.label,
    row.isTopFiveHeaviest ? 'Yes' : 'No',
    row.durationMs.toFixed(2),
    String(result.budgetMs),
    String(row.rowsProduced),
    row.withinBudget ? 'Under 1,000 ms budget' : 'Over 1,000 ms budget',
  ]);
}
