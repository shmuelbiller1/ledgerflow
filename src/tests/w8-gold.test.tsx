/**
 * W8-GOLD (RELEASE_GATE W8, "Verified"): a US quarter end to end against a real database, figures by hand. The tax on
 * each invoice is the invoice screen's own answer (the state table and the items' tax categories, CON-1: `usInvoiceTax`
 * → `taxChoiceFor` → `documentTotals`); invoices and bills are posted by the app's own posting code, the bills are paid
 * by the Payment run's request code (`paymentPlan`, `recordPayments`), the tax profiles go through their route, and the
 * return is previewed and filed through the tax-return routes. Sales tax by state, the use-tax review, the 1099 preview
 * (its screen), the vendor readiness and the quarter journey are read by the code the screens use.
 * The test runs when LF_TEST_DATABASE_URL is set.
 *
 * Worked figures (cents). Lone Star Outfitters LLC, Austin TX, USD; sales-tax permits in TX, CA and NY (all three
 * supported states, state rates only: no local rows are loaded). Quarter 2026-Q3 (2026-07-01 .. 2026-09-30).
 *   item          category    state rates: TX 6.25%, CA 7.25%, NY 4%; Texas groceries 0% (the reduced-rate item)
 *   INV-101 07-08 Austin Trading (TX)  20 lanterns × 10,000 = 200,000 × 6.25% = 12,500 → total 212,500
 *   INV-102 08-12 Austin Trading (TX)  40 trail mix × 1,000 =  40,000 groceries 0% = 0 → total 40,000 (exempt code)
 *   INV-103 08-20 Bay Outfitters (CA)  15 tents × 10,000 = 150,000 × 7.25% = 10,875 → total 160,875
 *   INV-104 09-15 Hudson Camping (NY)   8 lanterns × 10,000 =  80,000 × 4% = 3,200 → total 83,200
 *   INV-105 10-02 Austin Trading (TX)   1 lantern 10,000 × 6.25% = 625 (Q4: in no Q3 figure)
 *   Sales tax by state, Q3:  state  gross    exempt  taxable  tax     documents  due (planning calendar)
 *                            CA    150,000      0   150,000  10,875   1          31 Oct is a Saturday → 2026-11-02
 *                            NY     80,000      0    80,000   3,200   1          2026-10-20
 *                            TX    240,000  40,000  200,000  12,500   2          2026-10-20
 *                            all   470,000  40,000  430,000  26,575 = the Sales Tax Payable account on 2026-09-30
 *   Tax summary (Tax return boxes, Q3): 1 tax on sales 26,575; 2 reverse charge 0; 3 due 26,575; 4 reclaimable 0;
 *     5 net 26,575; 6 sales excl. tax 430,000 + 40,000 = 470,000; 7 purchases 0 (the bills carry no tax code: out of
 *     scope, 580,000); 8 zero-rated 0; 9 exempt 40,000; 8 documents. Tax by rate: CA 7.25% 150,000 / 10,875,
 *     NY 4% 80,000 / 3,200, TX 6.25% 200,000 / 12,500.
 * Purchases (no sales tax charged on any of them):
 *   UT-1 08-05 Peak Gear Wholesale (OR, not a 1099 vendor): 2 display racks × 60,000 = 120,000 (general goods)
 *        + 60 trail mix × 500 = 30,000 (groceries) = 150,000
 *   RD-1 07-10 Rivera Design (1099, TIN 12-3456789) 150,000; RD-2 09-01 Rivera Design 100,000 (design services)
 *   KP-1 08-18 Kim Photography (1099) 180,000 (product photos)
 *   Use tax review, TX, Q3: UT-1 taxable 120,000 × 6.25% = 7,500; exempt 30,000 (groceries);
 *     RD-1 150,000 + RD-2 100,000 + KP-1 180,000 = 430,000 of service lines with no item: for a person, never estimated.
 *     Estimated use tax 7,500.
 *   Paid: RD-1 07-20 150,000; KP-1 08-25 180,000; UT-1 08-30 150,000; RD-2 09-10 100,000.
 *   1099 preview 2026 (NEC box 1a, threshold 200,000 from 2026): Rivera 150,000 + 100,000 = 250,000 ≥ 200,000 → one
 *     form, TIN ****6789; Kim 180,000 < 200,000 → excluded (1); Peak is not a 1099 vendor → not on the preview.
 *     1096 NEC: 1 form, 250,000; 1096 MISC: 0 forms, 0.
 *   Quarter journey: the three returns recorded as filed once the Q3 return is filed; use tax 7,500 with 430,000 to
 *     review; one vendor over the 1099 threshold; INV-102 needs no exemption certificate (groceries are exempt in
 *     Texas by the state's own table, not by the buyer's certificate); 3 months still open.
 * Two fixes this test found (W8-GOLD): "Sales Tax Payable" was read as Accounts Payable (any liability named
 * "…payable"), so a bill and its payment could post to two different accounts depending on chart order; and the
 * journey asked for a certificate behind a sale exempt by its product.
 */
import './helpers/dom';
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { postBillLedger } from '../services/ledgerPost/billPosting';
import { postInvoiceLedger } from '../services/ledgerPost/invoicePosting';
import type { LedgerPostContext } from '../services/ledgerPost/postingKit';
import { paymentPlan } from '../lib/bulkDocuments';
import { resolveAccountRole } from '../lib/accountUtils';
import { recordPayments } from '../services/bulkDocumentActions';
import { resolveSellerProfile, type TaxPlace, type TaxProfiles } from '../lib/tax/profile';
import { ruleRateTable } from '../lib/tax/ruleRateTable';
import { taxChoiceFor } from '../lib/tax/resolveLineTax';
import { lineTaxCategory, usInvoiceTax } from '../lib/tax/usInvoiceTax';
import { documentTotals, effectiveRate, taxCodeFromRate } from '../lib/taxCodes';
import { usSalesTaxReturn } from '../lib/tax/usSalesTaxReturn';
import { taxByRate, type TaxableDocument } from '../lib/taxReturnDocs';
import { reviewUseTax } from '../lib/tax/usUseTax';
import { vendor1099Readiness } from '../lib/vendor1099Readiness';
import { usQuarterJourney, usQuarterPermits } from '../lib/usQuarterJourney';
import Us1099PreviewReportView from '../components/reporting/Us1099PreviewReportView';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useDataNeedsStore } from '../stores/useDataNeedsStore';
import type { Bill, ChartAccount, InventoryItem, Transaction, Workspace } from '../types';
// the browser's posting host (stores + upload), as LedgerPostService registers it in the app (L-94)
import '../services/ledgerPost/postingKit';

const url = process.env.LF_TEST_DATABASE_URL;
const Q3 = { startDate: '2026-07-01', endDate: '2026-09-30' };

const PROFILES: TaxProfiles = {
  books: { name: 'Lone Star Outfitters LLC', place: { country: 'US', state: 'TX', city: 'Austin' }, registrations: [
    { kind: 'sales_tax', number: 'TX-32000', place: { country: 'US', state: 'TX' }, filing: 'quarterly' },
    { kind: 'sales_tax', number: 'CA-10001', place: { country: 'US', state: 'CA' }, filing: 'quarterly' },
    { kind: 'sales_tax', number: 'NY-20002', place: { country: 'US', state: 'NY' }, filing: 'quarterly' },
  ] },
};
/** The workspace's sales tax codes (Settings → Tax rates), as the invoice screen reads them. */
const SALES_CODES = [
  { id: 'tx', name: 'Texas sales tax', type: 'Sales', components: [{ name: 'Texas state sales tax', rate: 6.25 }] },
  { id: 'ca', name: 'California sales tax', type: 'Sales', components: [{ name: 'California state sales tax', rate: 7.25 }] },
  { id: 'ny', name: 'New York sales tax', type: 'Sales', components: [{ name: 'New York state sales tax', rate: 4 }] },
  { id: 'exempt', name: 'Exempt', type: 'Sales', treatment: 'exempt' as const, components: [] },
].map(taxCodeFromRate);

describe('W8 with worked figures', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `ws_w8_${crypto.randomBytes(4).toString('hex')}`;
  const OWNER = 'owner-1';
  const id = (s: string) => `${ws}_${s}`;
  let server: Server;
  let base = '';
  let db: import('../server/db/pgFirestore').Firestore;
  const realFetch = globalThis.fetch;
  const acct: Record<string, ChartAccount> = {};
  const workspace = { id: ws, uid: OWNER, name: 'Lone Star Outfitters', currency: 'USD' } as Workspace;
  const send = async (method: string, path: string, body?: unknown) => {
    const res = await realFetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', 'x-test-uid': OWNER }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: res.status, body: await res.json().catch(() => ({})) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const all = async <T,>(collection: string) => (await db.collection(collection).where('workspaceId', '==', ws).get()).docs.map(d => ({ ...d.data(), id: d.id }) as T);
  const items = () => all<InventoryItem>('inventory');
  const context = async (): Promise<LedgerPostContext> => ({
    accounts: Object.values(acct), lockDate: null, uid: OWNER, inventory: await items(),
    transactions: await all<Transaction>('transactions'), workspaces: [workspace],
  });
  const balance = async (code: string, asOf: string) => (await all<Transaction>('transactions'))
    .filter(t => ['completed', 'approved', 'posted'].includes(String(t.status)) && String(t.date) <= asOf)
    .flatMap(t => t.lines || []).filter(l => l.accountId === acct[code].id).reduce((s, l) => s + l.amountCents, 0);

  /** An invoice saved as the invoice screen saves it, with the tax its CON-1 suggestion gives for these lines. */
  const invoice = async (key: string, number: string, customerId: string, date: string, lines: Array<[item: string, quantity: number, rateCents: number]>) => {
    const stock = await items();
    const customer = (await db.collection('customers').doc(customerId).get()).data() as { name: string; metadata: { taxPlace: TaxPlace } };
    const rows = lines.map(([item, quantity, rateCents], i) => ({ id: `l${i}`, itemId: id(item), description: stock.find(s => s.id === id(item))!.name, quantity, rateCents, amountCents: quantity * rateCents, accountId: acct['4000'].id }));
    const answer = usInvoiceTax({
      seller: resolveSellerProfile(PROFILES, {}, ['world']), buyer: customer.metadata.taxPlace, date,
      lineCategories: rows.map(r => lineTaxCategory(r, stock as never)), fallback: ruleRateTable(),
    });
    assert.equal(answer?.kind, 'rate', `${number}: one rate for the invoice`);
    if (answer?.kind !== 'rate') return null;
    const code = SALES_CODES.find(c => c.id === taxChoiceFor(answer.rate, SALES_CODES, effectiveRate).taxCodeId)!;
    const totals = documentTotals(rows.reduce((s, r) => s + r.amountCents, 0), 0, code, false);
    const data = {
      id: id(key), workspaceId: ws, uid: OWNER, number, customerId, customerName: customer.name, date, dueDate: date, status: 'sent' as const,
      currency: 'USD', amountCents: totals.amountCents, amountPaidCents: 0, lineSumCents: totals.subtotalCents, discountCents: 0,
      taxAmountCents: totals.taxCents, taxInclusive: true, taxVersion: 2, pricesIncludeTax: false, taxCodeId: code.id, taxTreatment: code.treatment,
      taxBreakdown: totals.components, taxRate: Math.round(effectiveRate(code.components) * 100000) / 1000, items: rows,
      metadata: { taxPlace: customer.metadata.taxPlace },
    };
    await postInvoiceLedger(data.id, data as never, ws, OWNER, { collection: 'invoices', docId: data.id, action: 'create', data }, await context());
    return { answer, code: code.id, totals: [totals.netCents, totals.taxCents, totals.amountCents] };
  };
  const bill = async (key: string, number: string, vendorId: string, date: string, splits: Array<{ amountCents: number; item?: string; quantity?: number; description: string }>) => {
    const vendorName = ((await db.collection('vendors').doc(vendorId).get()).data() as { name: string }).name;
    const data = {
      id: id(key), workspaceId: ws, uid: OWNER, number, billNumber: number, vendorId, vendorName, date, dueDate: date, status: 'approved' as const, currency: 'USD',
      amountCents: splits.reduce((s, l) => s + l.amountCents, 0), amountPaidCents: 0,
      splits: splits.map(l => ({ amountCents: l.amountCents, description: l.description, ...(l.item ? { itemId: id(l.item), quantity: l.quantity, accountId: acct['1300'].id } : { accountId: acct['6000'].id }) })),
    };
    await postBillLedger(data.id, data as never, ws, OWNER, { collection: 'bills', docId: data.id, action: 'create', data }, await context());
  };
  const pay = async (billKey: string, date: string) => {
    const due = (await all<Bill>('bills')).filter(b => b.id === id(billKey));
    const { payments } = paymentPlan(due as never, 'bill', 'USD');
    const result = await recordPayments(payments, { workspaceId: ws, side: 'bill', cashAccountId: acct['1000'].id, date, method: 'ach' });
    assert.deepEqual([result.done.length, result.failed.map(f => f.message)], [1, []]);
  };
  const salesDocs = async () => (await all<TaxableDocument & { customerId?: string }>('invoices'));
  const customers = () => all<{ id: string; metadata?: unknown }>('customers');

  before(async () => {
    process.env.DATABASE_URL = url;
    const express = (await import('express')).default;
    const { workspaceRouter } = await import('../server/routes/workspaceRoutes');
    const { transactionRouter } = await import('../server/routes/transactionRoutes');
    const { reportRouter } = await import('../server/routes/reportRoutes');
    const { inventoryRouter } = await import('../server/routes/inventoryRoutes');
    const { paymentRouter } = await import('../server/routes/paymentRoutes');
    const { getDb } = await import('../server/db/firestore');
    db = getDb();
    await db.collection('workspaces').doc(ws).set({ uid: OWNER, name: workspace.name, currency: 'USD', timezone: 'UTC', members: [OWNER] });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as unknown as { user: { uid: string; email: string } }).user = { uid: String(req.header('x-test-uid')), email: 'owner@lonestar.test' }; next(); });
    app.use('/api/v1/workspaces', workspaceRouter);
    app.use('/api/v1/transactions', transactionRouter);
    app.use('/api/v1/documents', (await import('../server/routes/documentPostRoutes')).documentPostRouter);
    app.use('/api/v1/reports', reportRouter);
    app.use('/api/v1/inventory', inventoryRouter);
    app.use('/api/v1/payments', paymentRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const target = String(input);
      if (!target.startsWith('/')) return realFetch(input, init);
      return realFetch(`${base}${target}`, { ...init, headers: { ...(init?.headers as Record<string, string> || {}), 'x-test-uid': OWNER } });
    }) as typeof fetch;
    const accounts = await send('POST', `/api/v1/workspaces/${ws}/import-records`, { kind: 'accounts', rows: [
      { name: 'Checking', code: '1000', type: 'Bank' },
      { name: 'Accounts Receivable', code: '1100', type: 'Accounts receivable' },
      { name: 'Inventory', code: '1300', type: 'Inventory' },
      { name: 'Accounts Payable', code: '2000', type: 'Accounts payable' },
      { name: 'Sales Tax Payable', code: '2200', type: 'Other current liability' },
      { name: 'Sales', code: '4000', type: 'Income' },
      { name: 'Cost of goods sold', code: '5000', type: 'Cost of goods sold' },
      { name: 'Contract services', code: '6000', type: 'Expense' },
    ] });
    assert.equal(accounts.status, 200, JSON.stringify(accounts.body));
    for (const a of await all<ChartAccount>('chartAccounts')) acct[String(a.code)] = a;
    assert.equal(acct['2200']?.type, 'liability');
    const profiles = await send('PUT', `/api/v1/workspaces/${ws}/tax-profiles`, { profiles: PROFILES });
    assert.equal(profiles.status, 200, JSON.stringify(profiles.body));
    const stock = (key: string, name: string, productTaxCategory: string, quantityAtHand: number, unitCostCents: number, unitPriceCents: number) =>
      db.collection('inventory').doc(id(key)).set({ workspaceId: ws, uid: OWNER, name, sku: key.toUpperCase(), itemType: 'stock', productTaxCategory, quantityAtHand, unitCostCents, unitPriceCents, reorderPoint: 0 });
    await stock('lantern', 'Camp lantern', 'general', 100, 4_000, 10_000);
    await stock('tent', 'Two-person tent', 'general', 50, 5_000, 10_000);
    await stock('trailmix', 'Trail mix', 'groceries', 100, 500, 1_000);
    await stock('rack', 'Display rack', 'general', 0, 0, 0);
    const party = (collection: 'customers' | 'vendors', key: string, data: Record<string, unknown>) => db.collection(collection).doc(id(key)).set({ workspaceId: ws, uid: OWNER, ...data });
    await party('customers', 'austin', { name: 'Austin Trading', metadata: { taxPlace: { country: 'US', state: 'TX', city: 'Austin' } } });
    await party('customers', 'bay', { name: 'Bay Outfitters', metadata: { taxPlace: { country: 'US', state: 'CA', city: 'Los Angeles' } } });
    await party('customers', 'hudson', { name: 'Hudson Camping', metadata: { taxPlace: { country: 'US', state: 'NY', city: 'Albany' } } });
    await party('vendors', 'peak', { name: 'Peak Gear Wholesale', is1099: false, metadata: { taxPlace: { country: 'US', state: 'OR' } } });
    await party('vendors', 'rivera', { name: 'Rivera Design', is1099: true, address: '12 Congress Ave, Austin TX', metadata: { taxId: '12-3456789', taxPlace: { country: 'US', state: 'TX' } } });
    await party('vendors', 'kim', { name: 'Kim Photography', is1099: true, metadata: { taxPlace: { country: 'US', state: 'TX' } } });
  });

  after(async () => {
    cleanup();
    globalThis.fetch = realFetch;
    server?.close();
    for (const table of ['transactions', 'invoices', 'bills', 'payments', 'inventory', 'stockMoves', 'customers', 'vendors', 'chartAccounts', 'taxReturns', 'auditLogs', 'idempotencyKeys', 'workspaces']) {
      await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]).catch(() => {});
    }
    const { getSupabase } = await import('../lib/db/client');
    getSupabase().realtime.disconnect();
    await getSupabase().auth.dispose();
    await db.terminate();
  });

  test('the invoice screen\'s answer per sale: TX 6.25%, Texas groceries 0% (exempt code), CA 7.25%, NY 4%', async () => {
    const rows = [
      await invoice('inv101', 'INV-101', id('austin'), '2026-07-08', [['lantern', 20, 10_000]]),
      await invoice('inv102', 'INV-102', id('austin'), '2026-08-12', [['trailmix', 40, 1_000]]),
      await invoice('inv103', 'INV-103', id('bay'), '2026-08-20', [['tent', 15, 10_000]]),
      await invoice('inv104', 'INV-104', id('hudson'), '2026-09-15', [['lantern', 8, 10_000]]),
      await invoice('inv105', 'INV-105', id('austin'), '2026-10-02', [['lantern', 1, 10_000]]),
    ];
    assert.deepEqual(rows.map(r => r && r.answer.kind === 'rate' && [r.answer.state, r.answer.rate, r.answer.verified, r.answer.localIncluded, r.code, ...r.totals]), [
      ['TX', 0.0625, true, false, 'tx', 200_000, 12_500, 212_500],
      ['TX', 0, true, false, 'exempt', 40_000, 0, 40_000],
      ['CA', 0.0725, true, false, 'ca', 150_000, 10_875, 160_875],
      ['NY', 0.04, true, false, 'ny', 80_000, 3_200, 83_200],
      ['TX', 0.0625, true, false, 'tx', 10_000, 625, 10_625],
    ]);
    assert.equal(await balance('2200', '2026-09-30'), -26_575, 'Sales Tax Payable owes 12,500 + 10,875 + 3,200');
    assert.equal(await balance('2200', '2026-10-31'), -27_200, '+ 625 in October');
  });

  test('purchases with no sales tax are posted and paid: Rivera 250,000, Kim 180,000, Peak 150,000', async () => {
    await bill('rd1', 'RD-1', id('rivera'), '2026-07-10', [{ amountCents: 150_000, description: 'Catalogue design' }]);
    await bill('ut1', 'UT-1', id('peak'), '2026-08-05', [
      { amountCents: 120_000, item: 'rack', quantity: 2, description: 'Display racks' },
      { amountCents: 30_000, item: 'trailmix', quantity: 60, description: 'Trail mix' },
    ]);
    await bill('kp1', 'KP-1', id('kim'), '2026-08-18', [{ amountCents: 180_000, description: 'Product photos' }]);
    await bill('rd2', 'RD-2', id('rivera'), '2026-09-01', [{ amountCents: 100_000, description: 'Store signage design' }]);
    await pay('rd1', '2026-07-20');
    await pay('kp1', '2026-08-25');
    await pay('ut1', '2026-08-30');
    await pay('rd2', '2026-09-10');
    const bills = Object.fromEntries((await all<Bill>('bills')).map(b => [b.number, [b.status, b.amountPaidCents]]));
    assert.deepEqual(bills, { 'RD-1': ['paid', 150_000], 'UT-1': ['paid', 150_000], 'KP-1': ['paid', 180_000], 'RD-2': ['paid', 100_000] });
    const made = (await all<{ contactId: string; amountCents: number; direction: string; status: string }>('payments')).filter(p => p.direction === 'made');
    assert.deepEqual(made.map(p => [p.contactId, p.amountCents, p.status]).sort(), [
      [id('kim'), 180_000, 'posted'], [id('peak'), 150_000, 'posted'], [id('rivera'), 100_000, 'posted'], [id('rivera'), 150_000, 'posted'],
    ]);
    assert.equal(await balance('2000', '2026-09-30'), 0, 'every bill is paid');
    // the bills and their payments both use Accounts Payable (2000), never Sales Tax Payable (a tax liability)
    assert.deepEqual([resolveAccountRole(acct['2000']), resolveAccountRole(acct['2200'])], ['ap', 'liability']);
    assert.equal(await balance('2200', '2026-09-30'), -26_575, 'Sales Tax Payable still holds only the tax collected');
  });

  test('sales tax by state for Q3: CA 150,000 / 10,875; NY 80,000 / 3,200; TX 240,000 gross, 40,000 exempt, 12,500', async () => {
    const permits = usQuarterPermits(PROFILES, Q3.endDate);
    assert.deepEqual(permits.map(p => [p.state, p.permitNumber]), [['CA', 'CA-10001'], ['NY', 'NY-20002'], ['TX', 'TX-32000']]);
    const [invoices, buyers] = [await salesDocs(), await customers()];
    const byState = permits.map(p => usSalesTaxReturn({ registration: p.registration, profiles: PROFILES, order: ['world'], invoices, customers: buyers, ...Q3 }));
    assert.deepEqual(byState.map(r => [r.state, r.grossSalesCents, r.exemptSalesCents, r.taxableSalesCents, r.taxCollectedCents, r.documentCount, r.byJurisdiction.map(j => [j.name, j.taxCents])]), [
      ['CA', 150_000, 0, 150_000, 10_875, 1, [['California state sales tax', 10_875]]],
      ['NY', 80_000, 0, 80_000, 3_200, 1, [['New York state sales tax', 3_200]]],
      ['TX', 240_000, 40_000, 200_000, 12_500, 2, [['Texas state sales tax', 12_500]]],
    ]);
    assert.equal(byState.reduce((s, r) => s + r.taxCollectedCents, 0), 26_575, '= the Sales Tax Payable account on 2026-09-30');
  });

  test('the tax summary for Q3 (Tax return route): box 1 = 5 = 26,575; box 6 470,000; box 9 40,000; tax by rate per state', async () => {
    const preview = await send('GET', `/api/v1/workspaces/${ws}/tax-returns/preview?startDate=${Q3.startDate}&endDate=${Q3.endDate}`);
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    const r = preview.body.return;
    assert.deepEqual(r.boxes.map((b: { key: string; cents: number }) => [b.key, b.cents]), [
      ['1', 26_575], ['2', 0], ['3', 26_575], ['4', 0], ['5', 26_575], ['6', 470_000], ['7', 0], ['8', 0], ['9', 40_000],
    ]);
    assert.deepEqual([r.sales.standard, r.sales.exempt, r.purchases.out_of_scope, r.documentCount], [
      { netCents: 430_000, taxCents: 26_575 }, { netCents: 40_000, taxCents: 0 }, { netCents: 580_000, taxCents: 0 }, 8,
    ]);
    const rates = taxByRate({ invoices: await salesDocs(), bills: await all<TaxableDocument>('bills'), ...Q3 });
    assert.deepEqual(rates.map(x => [x.name, x.rate, x.salesNetCents, x.salesTaxCents, x.purchasesTaxCents, x.netTaxCents]), [
      ['California state sales tax', 7.25, 150_000, 10_875, 0, 10_875],
      ['New York state sales tax', 4, 80_000, 3_200, 0, 3_200],
      ['Texas state sales tax', 6.25, 200_000, 12_500, 0, 12_500],
    ]);
    // F-08: with three US state permits, each state's return is filed per permit registration
    for (const permit of usQuarterPermits(PROFILES, Q3.endDate)) {
      const filed = await send('POST', `/api/v1/workspaces/${ws}/tax-returns`, {
        ...Q3,
        registration: permit.registration,
        reference: `2026-Q3-${permit.state}`,
      });
      assert.equal(filed.status, 200, JSON.stringify(filed.body));
      assert.equal(filed.body.return.kind, 'sales_tax');
      assert.equal(filed.body.return.jurisdiction, permit.state);
    }
  });

  test('use tax, TX, Q3: UT-1 taxable 120,000 → 7,500, groceries 30,000 exempt; 430,000 of service lines left for a person', async () => {
    const review = reviewUseTax({ bills: await all<Bill>('bills') as never, items: await items(), state: 'TX', from: Q3.startDate, to: Q3.endDate, workspaceId: ws, homeCurrency: 'USD' });
    assert.equal(review.problem, undefined);
    assert.deepEqual(review.rows.map(r => [r.billNumber, r.taxableCents, r.exemptCents, r.unclearCents, r.rate, r.estimatedUseTaxCents]), [
      ['RD-2', 0, 0, 100_000, 0.0625, 0], ['KP-1', 0, 0, 180_000, 0.0625, 0], ['UT-1', 120_000, 30_000, 0, 0.0625, 7_500], ['RD-1', 0, 0, 150_000, 0.0625, 0],
    ]);
    assert.deepEqual(review.totals, { taxableCents: 120_000, unclearCents: 430_000, estimatedUseTaxCents: 7_500 });
    assert.deepEqual(review.skipped, { taxCharged: 0, otherCurrency: 0, undated: 0, notRecorded: 0 });
  });

  test('the 1099 preview screen for 2026: one NEC form for Rivera Design, 250,000, ****6789; Kim excluded; 1096 total 250,000', async () => {
    useAuthStore.setState({ isGuest: false, user: { uid: OWNER } as never, currentWorkspaceId: ws, workspaces: [workspace] });
    useLedgerStore.setState({ vendors: await all('vendors') as never, payments: await all('payments') as never, truncatedCollections: {} as never } as never);
    useDataNeedsStore.setState({ loaded: { vendors: true, payments: true } as never, failed: {} as never, loadedWorkspaceId: ws } as never);
    render(<Us1099PreviewReportView />);
    fireEvent.change(screen.getByLabelText('Tax year'), { target: { value: '2026' } });
    const text = document.body.textContent || '';
    assert.match(text, /1 form\(s\) at or above \$2,000\.00 · 1 excluded/);
    assert.match(text, /1096 1099-NEC: 1 form\(s\), total \$2,500\.00 in 2026/);
    assert.match(text, /1096 1099-MISC: 0 form\(s\), total \$0\.00 in 2026/);
    const rows = [...screen.getByRole('table').querySelectorAll('tbody tr')].map(tr => [...tr.querySelectorAll('th,td')].map(c => c.textContent?.trim()));
    assert.deepEqual(rows.map(r => [r[0], r[1], r[2], r[3], r[4]]), [[`Rivera Design${id('rivera')}`, '1099-NEC · 1a', '$2,500.00', '$2,000.00', '****6789']]);
    cleanup();
    // the readiness report reads the same threshold: Rivera over it; Peak (not marked) is flagged, never hidden
    const readiness = vendor1099Readiness({ vendors: await all('vendors') as never, payments: await all('payments') as never, taxYear: 2026, homeCurrency: 'USD' });
    assert.equal(readiness.thresholdCents, 200_000);
    assert.deepEqual(readiness.rows.map(r => [r.vendor, r.paidCents, r.overThreshold]).sort(), [['Kim Photography', 180_000, false], ['Peak Gear Wholesale', 150_000, false], ['Rivera Design', 250_000, true]]);
    assert.equal(readiness.unmarkedWithPayments, 1);
  });

  test('the quarter journey agrees: three state returns filed, due dates, use tax 7,500, one vendor over the 1099 threshold', async () => {
    const filed = await send('GET', `/api/v1/workspaces/${ws}/tax-returns`);
    const journey = usQuarterJourney({
      quarter: '2026-Q3', today: '2026-10-21', currency: 'USD', profiles: PROFILES, order: ['world'],
      customers: await customers(), invoices: await salesDocs(), bills: await all('bills') as never, items: await items(),
      vendors: await all('vendors') as never, payments: await all('payments') as never, useTaxState: 'TX',
      filedPeriods: filed.body.returns.map((x: { startDate: string; endDate: string; registration?: string; kind?: 'vat' | 'sales_tax' }) => ({
        startDate: x.startDate,
        endDate: x.endDate,
        ...(x.registration ? { registration: x.registration } : {}),
        ...(x.kind ? { kind: x.kind } : {}),
      })),
    });
    const step = (stepId: string) => journey.steps.find(s => s.id === stepId)!;
    assert.deepEqual(step('state-returns').returns.map(r => [r.state, r.grossSalesCents, r.exemptSalesCents, r.taxableSalesCents, r.taxCollectedCents, r.dueDate, r.filed, r.nexusThresholdCents, r.nexusSalesReached]), [
      ['CA', 150_000, 0, 150_000, 10_875, '2026-11-02', true, 50_000_000, false],
      ['NY', 80_000, 0, 80_000, 3_200, '2026-10-20', true, 50_000_000, false],
      ['TX', 240_000, 40_000, 200_000, 12_500, '2026-10-20', true, 50_000_000, false],
    ]);
    assert.equal(step('state-returns').status, 'done');
    assert.deepEqual(step('use-tax').figures.map(f => [f.label, f.cents]), [['Estimated use tax', 7_500], ['Base to review', 430_000]]);
    assert.deepEqual(step('form-1099').figures.map(f => [f.label, f.cents ?? f.count]), [['Threshold', 200_000], ['Vendors over threshold', 1]]);
    assert.deepEqual(step('certificates').figures.map(f => [f.label, f.count]), [], 'groceries are exempt by the state table: no certificate is needed');
    assert.deepEqual(step('close').figures.map(f => [f.label, f.count]), [['Months still open', 3], ['Returns not recorded as filed', 0]]);
  });
});
