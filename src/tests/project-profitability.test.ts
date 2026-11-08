/**
 * A-13 (CB-08) profitability by project, with hand-worked numbers.
 * Alpha: invoice 1 line 1 = 1,000.00 (2 × widget; no posted cost yet, so the estimate is 2 × 20.00);
 *        invoice 3 = 300.00 at rate 1.10 → 330.00 base; the posted cost of invoice 1 line 1 is 38.00
 *        (not the estimate); a bill's office expense 200.00 in April; a February bill is out of range.
 * Unassigned: invoice 1 line 2 = 500.00 with no cost; an unlabelled expense of 10.00.
 * The cost entry made from invoice 1 is counted once, as invoice cost, never again as an expense.
 */
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeProjectProfitability } from '../lib/projectProfitability';
import { profitabilityLines } from '../lib/profitabilityLines';
import type { ChartAccount, DimensionNode, Invoice, Transaction } from '../types';
import { makeChartAccount, makeInvoice, makeTransaction } from './fixtures';

const accounts: ChartAccount[] = [
  makeChartAccount({ id: 'rev', name: 'Sales', type: 'income', category: 'Revenue', code: '4000' }),
  makeChartAccount({ id: 'cogs', name: 'Cost of goods sold', type: 'cost_of_goods', category: 'COGS', code: '5000' }),
  makeChartAccount({ id: 'exp', name: 'Office expenses', type: 'expense', category: 'Operating Expenses', code: '6000' }),
  makeChartAccount({ id: 'ap', name: 'Accounts payable', type: 'liability', category: 'Payables', code: '2000' }),
];

const invoices: Invoice[] = [
  makeInvoice({
    id: 'inv1', status: 'sent', date: '2026-03-10', exchangeRate: 1,
    items: [
      { id: 'l1', itemId: 'widget', description: 'Widget', quantity: 2, rateCents: 50000, amountCents: 100000, accountId: 'rev', dimensions: { project: 'Alpha' } },
      { id: 'l2', description: 'Consulting', quantity: 1, rateCents: 50000, amountCents: 50000, accountId: 'rev' },
    ],
  }),
  makeInvoice({ id: 'inv2', status: 'draft', date: '2026-03-11', items: [{ id: 'd1', description: 'Draft', quantity: 1, rateCents: 99900, amountCents: 99900, accountId: 'rev', dimensions: { project: 'Alpha' } }] }),
  makeInvoice({
    id: 'inv3', status: 'paid', date: '2026-05-01', exchangeRate: 1.1,
    items: [{ id: 'l3', description: 'Service', quantity: 1, rateCents: 30000, amountCents: 30000, accountId: 'rev', dimensions: { project: 'Alpha' } }],
  }),
];

const transactions: Transaction[] = [
  // the cost of goods sold posted for invoice 1 line 1 (38.00, not the 40.00 estimate)
  makeTransaction({ id: 'cogs1', date: '2026-03-10', metadata: { cogsForInvoiceId: 'inv1', cogsForLineId: 'l1' }, lines: [{ accountId: 'cogs', amountCents: 3800 }, { accountId: 'inv', amountCents: -3800 }] }),
  // a bill: 200.00 of office expense for Alpha, payable
  makeTransaction({ id: 'bill1', date: '2026-04-01', lines: [{ accountId: 'exp', amountCents: 20000, dimensions: { project: 'Alpha' } }, { accountId: 'ap', amountCents: -20000 }] }),
  // out of range (February)
  makeTransaction({ id: 'feb', date: '2026-02-01', lines: [{ accountId: 'exp', amountCents: 77700, dimensions: { project: 'Alpha' } }, { accountId: 'ap', amountCents: -77700 }] }),
  // an unlabelled expense of 10.00
  makeTransaction({ id: 'misc', date: '2026-04-02', lines: [{ accountId: 'exp', amountCents: 1000 }, { accountId: 'ap', amountCents: -1000 }] }),
];

describe('profitability by project', () => {
  const rows = computeProjectProfitability({ invoices, transactions, accounts, items: [{ id: 'widget', unitCostCents: 2000 }], startDate: '2026-03-01', endDate: '2026-05-31' });
  const alpha = rows.find(r => r.project === 'Alpha');
  const none = rows.find(r => r.project === 'Unassigned');

  test('Alpha: revenue in base currency, posted cost of the invoice line, and labelled expenses', () => {
    assert.ok(alpha);
    assert.equal(alpha.revenueCents, 100000 + 33000); // 1,000.00 + 300.00 × 1.10
    assert.equal(alpha.invoiceCostCents, 3800); // posted, not the 40.00 estimate
    assert.equal(alpha.expenseCents, 20000); // the February bill and the cached invoice cost are not counted again
    assert.equal(alpha.costCents, 23800);
    assert.equal(alpha.marginCents, 109200);
    assert.equal(alpha.marginPct, 82.11); // 109,200 / 133,000 = 82.105…%
    assert.equal(alpha.costIsEstimate, false);
  });

  test('Unassigned: lines with no project label, and the unlabelled expense', () => {
    assert.ok(none);
    assert.equal(none.revenueCents, 50000);
    assert.equal(none.expenseCents, 1000);
    assert.equal(none.marginCents, 49000);
    assert.equal(none.marginPct, 98);
  });

  test('the Unassigned row is listed last, and the columns add up to the total of the period', () => {
    assert.equal(rows[rows.length - 1].project, 'Unassigned');
    const revenue = rows.reduce((s, r) => s + r.revenueCents, 0);
    const cost = rows.reduce((s, r) => s + r.costCents, 0);
    assert.equal(revenue, 183000);
    assert.equal(cost, 24800);
  });

  test('an estimate is used and flagged when no cost is posted yet', () => {
    const est = computeProjectProfitability({
      invoices: [makeInvoice({ id: 'x', status: 'sent', date: '2026-03-10', items: [{ id: 'q', itemId: 'widget', description: 'W', quantity: 2, rateCents: 1000, amountCents: 2000, accountId: 'rev', dimensions: { project: 'Beta' } }] })],
      transactions: [], accounts, items: [{ id: 'widget', unitCostCents: 300 }],
    });
    assert.equal(est[0].project, 'Beta');
    assert.equal(est[0].invoiceCostCents, 600);
    assert.equal(est[0].costIsEstimate, true);
    assert.equal(est[0].marginPct, 70);
  });

  test('no revenue means an undefined margin percentage', () => {
    const only = computeProjectProfitability({ invoices: [], transactions: [makeTransaction({ id: 'e', date: '2026-03-01', lines: [{ accountId: 'exp', amountCents: 500, dimensions: { project: 'Gamma' } }, { accountId: 'ap', amountCents: -500 }] })], accounts });
    assert.equal(only[0].marginPct, null);
    assert.equal(only[0].marginCents, -500);
  });

  test('resolves canonical project dimension node IDs alongside free-text names and preserves budget overrun math', () => {
    const dimensionNodes: DimensionNode[] = [
      { id: 'P1', dimensionId: 'project', description: 'Alpha', aliases: ['Legacy Alpha'], status: 'active' },
    ];
    const mixedInvoices: Invoice[] = [
      makeInvoice({
        id: 'inv-raw', status: 'sent', date: '2026-03-10',
        items: [{ id: 'l-raw', itemId: 'widget', description: 'W1', quantity: 1, rateCents: 10000, amountCents: 10000, accountId: 'rev', unitCostCents: 6000, dimensions: { project: 'Alpha' } }],
      }),
      makeInvoice({
        id: 'inv-node', status: 'sent', date: '2026-03-12',
        items: [{ id: 'l-node', itemId: 'widget', description: 'W2', quantity: 1, rateCents: 10000, amountCents: 10000, accountId: 'rev', unitCostCents: 6000, dimensions: { project: 'P1' } }],
      }),
    ];
    const lines = profitabilityLines('project', {
      customers: [],
      invoices: mixedInvoices,
      items: [{ id: 'widget', name: 'Widget', sku: 'W', quantityOnHand: 0, unitCostCents: 6000, unitPriceCents: 10000 } as never],
      transactions: [
        makeTransaction({
          id: 'tx-proj-id', date: '2026-03-15',
          lines: [{ accountId: 'exp', amountCents: 500, project: 'proj_alpha' }, { accountId: 'ap', amountCents: -500 }],
        }),
      ],
      accounts,
      projects: [{ id: 'proj_alpha', name: 'Alpha', budgetCents: 10000, status: 'active' }],
      dimensionNodes,
      startDate: '2026-03-01',
      endDate: '2026-03-31',
    });
    assert.equal(lines.length, 1);
    assert.equal(lines[0].label, 'Alpha');
    assert.equal(lines[0].revenueCents, 20000);
    assert.equal(lines[0].costCents, 12500);
    assert.equal(lines[0].budgetCents, 10000);
    assert.equal(lines[0].budgetRemainingCents, -2500);
    assert.equal(lines[0].budgetUsedPct, 125);
  });
});
