/**
 * A-148: deterministic 12-month small-business fixture generator for performance tests and
 * read-only report verification (`2026-01-01` through `2026-12-31` by default).
 *
 * Guarantees:
 * - Pure and deterministic: seeded integer generator, zero `Math.random()` or wall-clock calls.
 * - Double-entry sound: every posted transaction has integer-cent lines whose signed sum is 0.
 * - Stock-history sound: every stock item's recorded `stockMoves` sum cleanly to `quantityAtHand`.
 * - Fixture only: nothing here touches workspace persistence or posts real documents.
 */
import type {
  BankStatementLine, Bill, Budget, ChartAccount, CreditNote, Customer, DimensionDefinition,
  Estimate, FixedAsset, InventoryItem, Invoice, Payment, Project, PurchaseOrder,
  RecurringTransaction, Transaction, Vendor, VendorCredit, Workspace,
} from '../types';
import { itemDetails, stockHistoryProblem, type ItemDetails, type StockMove } from './stockMoves';
import { isPostable, lineAmount } from './txFilters';

export interface SampleBusinessYearOptions {
  year?: number;
  workspaceId?: string;
  scale?: number;
}

export interface SampleBusinessYearFixture {
  year: number;
  asOfDate: string;
  startDate: string;
  endDate: string;
  workspace: Workspace;
  accounts: ChartAccount[];
  dimensions: DimensionDefinition[];
  projects: Project[];
  budgets: Budget[];
  customers: Customer[];
  vendors: Vendor[];
  inventory: InventoryItem[];
  invoices: Invoice[];
  creditNotes: CreditNote[];
  estimates: Estimate[];
  bills: Bill[];
  vendorCredits: VendorCredit[];
  purchaseOrders: PurchaseOrder[];
  payments: Payment[];
  stockMoves: StockMove[];
  inventoryDetails: ItemDetails[];
  transactions: Transaction[];
  bankLines: BankStatementLine[];
  reconciliations: Array<{
    id: string;
    workspaceId: string;
    accountId: string;
    statementDate: string;
    statementBalanceCents: number;
    reconciledIds: string[];
    status: 'completed';
  }>;
  assets: FixedAsset[];
  recurring: RecurringTransaction[];
}

export interface SampleBusinessMonthSummary {
  month: string;
  invoices: number;
  bills: number;
  purchaseOrders: number;
  payments: number;
  stockMoves: number;
  transactions: number;
  invoicedCents: number;
  billedCents: number;
}

export interface SampleBusinessVerification {
  ok: boolean;
  failures: string[];
  monthsCovered: number;
  balancedTransactions: number;
  totalLines: number;
}

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const US_STATES = ['TX', 'CA', 'NY', 'FL', 'WA', 'IL', 'CO', 'MA'];
const TERRITORIES = ['North America East', 'North America West', 'Israel Central', 'EMEA Direct'];
const LOCATIONS = ['Tel Aviv', 'Haifa', 'Newark'];
const DEPARTMENTS = ['Sales', 'Operations', 'General & Admin'];

const pad2 = (n: number) => String(n).padStart(2, '0');
const padN = (n: number, width: number) => String(n).padStart(width, '0');
const dateYmd = (year: number, m: number, d: number) =>
  `${year}-${pad2(m + 1)}-${pad2(Math.max(1, Math.min(MONTH_DAYS[m] || 28, d)))}`;

function createPrng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildSampleBusinessYear(options: SampleBusinessYearOptions = {}): SampleBusinessYearFixture {
  const year = options.year ?? 2026;
  const wsId = options.workspaceId ?? 'ws-sample-12m';
  const scale = Math.max(1, Math.min(5, Math.floor(options.scale ?? 1)));
  const rand = createPrng(20261021 ^ year ^ (scale * 7919));
  const pickInt = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));

  const startDate = `${year}-01-01`;
  const endDate = `${year}-12-31`;
  const asOfDate = endDate;

  const dimensions: DimensionDefinition[] = [
    {
      id: 'location',
      name: 'Location',
      values: LOCATIONS,
      requiredOn: {
        accountIds: ['acc-freight', 'acc-rent', 'acc-utilities', 'acc-payroll', 'acc-depreciation'],
        since: `${year}-01-01`,
        refuse: true,
      },
    } as unknown as DimensionDefinition,
    { id: 'department', name: 'Department', values: DEPARTMENTS } as unknown as DimensionDefinition,
  ];

  const workspace: Workspace = {
    id: wsId,
    uid: 'owner-sample',
    name: 'Harbor & Olive Supply Co. (12-Month Fixture)',
    businessType: 'retail',
    createdAt: `${year}-01-01T00:00:00Z`,
    currency: 'USD',
    fiscalYearStartMonth: 1,
    members: ['owner-sample', 'acct-sample'],
    roles: { 'acct-sample': 'accountant' },
    dimensions,
    taxProfiles: {
      books: {
        name: 'Harbor & Olive Supply Co.',
        place: { country: 'US', state: 'TX' },
        registrations: [
          { kind: 'sales_tax', number: '32099887766', place: { country: 'US', state: 'TX' }, filing: 'quarterly' },
          { kind: 'vat', number: '514887766', place: { country: 'IL' }, filing: 'bimonthly' },
        ],
      },
    },
  } as unknown as Workspace;

  const accountDefs: Array<[string, string, string, ChartAccount['type']]> = [
    ['acc-bank-main', '1000', 'Operating Checking', 'asset'],
    ['acc-bank-savings', '1010', 'Reserve Savings', 'asset'],
    ['acc-ar', '1100', 'Accounts Receivable', 'asset'],
    ['acc-inventory', '1200', 'Inventory Asset', 'asset'],
    ['acc-prepaid', '1300', 'Vendor Advances & Prepaid', 'asset'],
    ['acc-equipment', '1500', 'Warehouse & Office Equipment', 'asset'],
    ['acc-accum-dep', '1550', 'Accumulated Depreciation', 'asset'],
    ['acc-ap', '2000', 'Accounts Payable', 'liability'],
    ['acc-tax-payable', '2100', 'Sales Tax & Output VAT Payable', 'liability'],
    ['acc-withholding', '2150', 'Supplier Withholding Payable', 'liability'],
    ['acc-deferred-rev', '2200', 'Deferred Subscription Revenue', 'liability'],
    ['acc-equity', '3000', 'Owner Capital & Retained Earnings', 'equity'],
    ['acc-sales-goods', '4000', 'Product Sales Revenue', 'revenue'],
    ['acc-sales-service', '4100', 'Installation & Support Revenue', 'revenue'],
    ['acc-cogs', '5000', 'Cost of Goods Sold', 'expense'],
    ['acc-freight', '5100', 'Inbound Freight & Duty', 'expense'],
    ['acc-rent', '6000', 'Warehouse & Office Rent', 'expense'],
    ['acc-payroll', '6100', 'Payroll & Benefits', 'expense'],
    ['acc-utilities', '6200', 'Utilities, Cloud & Telecom', 'expense'],
    ['acc-depreciation', '6300', 'Depreciation Expense', 'expense'],
  ];

  const accounts: ChartAccount[] = accountDefs.map(([id, code, name, type]) => ({
    id, uid: 'owner-sample', workspaceId: wsId, code, name, type, currency: 'USD', balanceCents: 0, isActive: true,
  } as unknown as ChartAccount));
  const accountById = new Map(accounts.map(a => [a.id, a]));

  const projectNames = [
    'Port Cold-Chain Retrofit', 'Austin Roastery Rollout', 'Haifa Lab Automation',
    'Brooklyn Flagship Fit-Out', 'Tel Aviv Hotel Group SLA', 'Annual Preventive Maintenance',
  ];
  const projects: Project[] = projectNames.map((name, idx) => ({
    id: `proj-${idx + 1}`, uid: 'owner-sample', workspaceId: wsId, name,
    type: 'fixed', dimensions: {}, createdAt: `${year}-01-01T00:00:00Z`,
    status: 'active', budgetCents: (idx + 2) * 1_800_000, currency: 'USD',
  } as unknown as Project));

  const budgets: Budget[] = [
    'acc-sales-goods', 'acc-sales-service', 'acc-cogs', 'acc-freight', 'acc-rent', 'acc-payroll', 'acc-utilities',
  ].map((accountId, idx) => {
    const monthly: Record<string, number> = {};
    for (let m = 0; m < 12; m++) monthly[`${year}-${pad2(m + 1)}`] = (idx < 2 ? 4_500_000 : 1_250_000) + m * 65_000;
    return {
      id: `bud-${idx + 1}`, workspaceId: wsId, name: `${accountById.get(accountId)?.name || accountId} ${year}`,
      accountId, year, amountCents: Object.values(monthly).reduce((s, v) => s + v, 0), monthlyAmounts: monthly, currency: 'USD',
    } as unknown as Budget;
  });

  const customers: Customer[] = Array.from({ length: 36 }, (_, idx) => {
    const isIl = idx % 5 === 4;
    const state = US_STATES[idx % US_STATES.length];
    const missingTax = idx === 4 || idx === 11;
    const missingAddress = idx === 11 || idx === 19;
    const taxNum = missingTax ? '' : isIl ? `51500${padN(idx + 100, 4)}` : `74-200${padN(idx + 100, 4)}`;
    return {
      id: `cust-${padN(idx + 1, 3)}`, workspaceId: wsId,
      name: isIl ? `Carmel Hospitality ${idx + 1} Ltd` : `Beacon Market Group ${idx + 1}`,
      email: `ap${idx + 1}@client${idx + 1}.example.com`, phone: `+1-555-01${pad2(idx + 10)}`,
      address: missingAddress ? '' : isIl ? `${10 + idx} HaNamal St, Tel Aviv` : `${100 + idx * 7} Congress Ave, ${state} 78701`,
      currency: 'USD', creditLimitCents: 2_500_000 + (idx % 6) * 750_000, taxId: taxNum,
      metadata: {
        territory: TERRITORIES[idx % TERRITORIES.length],
        taxPlace: isIl ? { country: 'IL' } : { country: 'US', state },
        vatNumber: taxNum, taxExempt: idx % 9 === 3,
      },
    } as unknown as Customer;
  });

  const vendors: Vendor[] = Array.from({ length: 24 }, (_, idx) => {
    const isIl = idx % 6 === 5;
    const is1099 = idx % 4 === 1;
    const missingTax = idx === 1 || idx === 11;
    const missingAddress = idx === 5 || idx === 11;
    const taxNum = missingTax ? '' : isIl ? `51620${padN(idx + 200, 4)}` : `75-880${padN(idx + 200, 4)}`;
    return {
      id: `vend-${padN(idx + 1, 3)}`, workspaceId: wsId,
      name: isIl ? `Galilee Precision Parts ${idx + 1}` : `Atlas Industrial Supply ${idx + 1}`,
      email: `billing${idx + 1}@vendor${idx + 1}.example.com`, phone: `+1-555-02${pad2(idx + 10)}`,
      address: missingAddress ? '' : isIl ? `${20 + idx} Histadrut Blvd, Haifa` : `${400 + idx * 11} Industrial Pkwy, TX 75201`,
      currency: 'USD', is1099Vendor: is1099, taxId: taxNum,
      metadata: {
        is1099, taxPlace: isIl ? { country: 'IL' } : { country: 'US', state: 'TX' }, vatNumber: taxNum,
        withholding: isIl ? { ratePercent: 5, number: `WH-2026-${idx + 1}`, expires: `${year}-12-31` } : undefined,
      },
    } as unknown as Vendor;
  });

  const inventory: InventoryItem[] = [];
  for (let i = 0; i < 42; i++) {
    const isService = i >= 36;
    const unitCostCents = isService ? 0 : i === 34 ? 0 : 1_800 + (i % 12) * 650;
    const unitPriceCents = i === 35 || i === 41
      ? 0
      : isService ? 12_500 + (i - 36) * 3_500 : Math.round((1_800 + (i % 12) * 650) * 1.65);
    inventory.push({
      id: `item-${padN(i + 1, 3)}`, workspaceId: wsId,
      sku: isService ? `SRV-${padN(i - 35, 3)}` : `SKU-${padN(i + 1, 3)}`,
      name: isService ? `Field Calibration Service ${i - 35}` : `Precision Valve & Sensor ${i + 1}`,
      category: isService ? 'Services' : i < 12 ? 'Serialised Hardware' : i < 24 ? 'Batch Consumables' : 'Fittings & Spares',
      itemType: isService ? 'service' : 'stock',
      unitCostCents, unitPriceCents, quantityAtHand: 0,
      reorderPoint: isService ? 0 : 18 + (i % 5) * 6,
      preferredVendorId: vendors[i % 12].id, currency: 'USD',
    } as unknown as InventoryItem);
  }
  for (let k = 0; k < 6; k++) {
    inventory.push({
      id: `kit-${padN(k + 1, 2)}`, workspaceId: wsId, sku: `KIT-${padN(k + 1, 2)}`,
      name: `Complete Maintenance Kit ${k + 1}`, category: 'Kits & Bundles', itemType: 'stock',
      unitCostCents: 0, unitPriceCents: 0, quantityAtHand: 0, currency: 'USD',
      bundleParts: [{ itemId: inventory[k * 2].id, quantity: 2 }, { itemId: inventory[12 + k * 2].id, quantity: 3 }],
    } as unknown as InventoryItem);
  }
  const itemById = new Map(inventory.map(it => [it.id, it]));

  const invoices: Invoice[] = [];
  const creditNotes: CreditNote[] = [];
  const estimates: Estimate[] = [];
  const bills: Bill[] = [];
  const vendorCredits: VendorCredit[] = [];
  const purchaseOrders: PurchaseOrder[] = [];
  const payments: Payment[] = [];
  const stockMoves: StockMove[] = [];
  const transactions: Transaction[] = [];
  const bankLines: BankStatementLine[] = [];
  const reconciliations: SampleBusinessYearFixture['reconciliations'] = [];

  const runningItemQty = new Map<string, number>();
  let runningBankCents = 25_000_000;
  let txSeq = 1;
  let moveSeq = 1;
  let bankSeq = 1;

  const addBalancedEntry = (
    date: string,
    description: string,
    lines: Array<{ accountId: string; amountCents: number; dimensions?: Record<string, string>; category?: string }>,
    extra: Partial<Transaction> = {},
  ): Transaction => {
    const id = extra.id || `tx-${year}-${padN(txSeq++, 5)}`;
    const debitCents = lines.reduce((s, l) => (l.amountCents > 0 ? s + l.amountCents : s), 0);
    const tx: Transaction = {
      id, workspaceId: wsId, uid: 'owner-sample', date, description, status: 'posted',
      currency: 'USD', totalAmountCents: debitCents,
      lines: lines.map((l, idx) => {
        const acct = accountById.get(l.accountId);
        if (acct) acct.balanceCents = (acct.balanceCents || 0) + l.amountCents;
        return {
          id: `${id}-L${idx + 1}`, accountId: l.accountId, accountName: acct?.name || l.accountId,
          amountCents: l.amountCents, debitCents: l.amountCents > 0 ? l.amountCents : 0,
          creditCents: l.amountCents < 0 ? -l.amountCents : 0,
          category: l.category || acct?.name || 'General', dimensions: l.dimensions,
        };
      }),
      ...extra,
    } as Transaction;
    transactions.push(tx);
    return tx;
  };

  const addMove = (input: {
    itemId: string; date: string; kind: StockMove['kind']; quantity: number; unitCostCents: number;
    locationId?: string; transactionId?: string; documentType?: StockMove['documentType'];
    documentId?: string; vendorId?: string; customerId?: string; purpose?: string;
  }): StockMove => {
    const seqNum = moveSeq++;
    const before = runningItemQty.get(input.itemId) || 0;
    const after = before + input.quantity;
    runningItemQty.set(input.itemId, after);
    const item = itemById.get(input.itemId);
    const full: StockMove = {
      id: `sm-${year}-${padN(seqNum, 5)}`, workspaceId: wsId, itemId: input.itemId, itemName: item?.name || input.itemId,
      date: input.date, kind: input.kind, quantity: input.quantity, quantityBefore: before, quantityAfter: after,
      unitCostCents: input.unitCostCents, valueCents: input.quantity * input.unitCostCents,
      seq: padN(seqNum, 8), locationId: input.locationId, transactionId: input.transactionId,
      documentType: input.documentType, documentId: input.documentId, vendorId: input.vendorId,
      customerId: input.customerId, purpose: input.purpose, uid: 'owner-sample', createdAt: `${input.date}T12:00:00Z`,
    };
    stockMoves.push(full);
    return full;
  };

  addBalancedEntry(`${year}-01-01`, 'Opening capital & cash reserve', [
    { accountId: 'acc-bank-main', amountCents: runningBankCents },
    { accountId: 'acc-bank-savings', amountCents: 12_000_000 },
    { accountId: 'acc-equipment', amountCents: 8_400_000 },
    { accountId: 'acc-equity', amountCents: -(runningBankCents + 12_000_000 + 8_400_000) },
  ]);

  let openingStockValueCents = 0;
  for (let i = 0; i < 36; i++) {
    const item = inventory[i];
    const openQty = 60 + (i % 6) * 15;
    const unitCost = item.unitCostCents || 2_000;
    openingStockValueCents += openQty * unitCost;
    addMove({
      itemId: item.id, date: `${year}-01-02`, kind: 'opening', quantity: openQty, unitCostCents: unitCost,
      locationId: LOCATIONS[i % LOCATIONS.length], purpose: `Opening warehouse balance ${year}`,
    });
  }
  addBalancedEntry(`${year}-01-02`, 'Opening warehouse inventory balance', [
    { accountId: 'acc-inventory', amountCents: openingStockValueCents },
    { accountId: 'acc-equity', amountCents: -openingStockValueCents },
  ]);

  const poPerMonth = 8 * scale;
  const billsPerMonth = 18 * scale;
  const invPerMonth = 30 * scale;
  const quotesPerMonth = 5 * scale;

  for (let m = 0; m < 12; m++) {
    const monthKey = `${year}-${pad2(m + 1)}`;
    const monthBankIds: string[] = [];
    const monthPOs: PurchaseOrder[] = [];

    for (let p = 0; p < poPerMonth; p++) {
      const seq = m * poPerMonth + p + 1;
      const vendor = vendors[(m * 3 + p) % 12];
      const itemA = inventory[(m * 3 + p) % 34];
      const itemB = inventory[(m * 3 + p + 9) % 34];
      const orderedQtyA = 14 + (p % 4) * 4;
      const receivedQtyA = p === poPerMonth - 1 ? orderedQtyA - 4 : orderedQtyA;
      const orderedQtyB = 10 + (p % 3) * 5;
      const receivedQtyB = orderedQtyB;
      const issueDate = dateYmd(year, m, 2 + p * 2);
      const recvDate = dateYmd(year, m, 6 + p * 2);
      const loc = LOCATIONS[(m + p) % LOCATIONS.length];
      const expiryDate = dateYmd(m + 3 >= 12 ? year + 1 : year, (m + 3) % 12, 20);
      const lotA = `LOT-${year}${pad2(m + 1)}-${padN(seq, 3)}A`;
      const lotB = `LOT-${year}${pad2(m + 1)}-${padN(seq, 3)}B`;
      const serialsA = Array.from({ length: Math.min(3, receivedQtyA) }, (_, s) => `SN-${year}-${padN(seq, 4)}-${s + 1}`);
      const lineTotalA = orderedQtyA * itemA.unitCostCents;
      const lineTotalB = orderedQtyB * itemB.unitCostCents;
      const totalCents = lineTotalA + lineTotalB;
      const recvVal = receivedQtyA * itemA.unitCostCents + receivedQtyB * itemB.unitCostCents;

      const poTx = addBalancedEntry(recvDate, `Goods receipt PO-${year}-${padN(seq, 4)}`, [
        { accountId: 'acc-inventory', amountCents: recvVal },
        { accountId: 'acc-ap', amountCents: -recvVal },
      ]);
      addMove({ itemId: itemA.id, date: recvDate, kind: 'purchase', quantity: receivedQtyA, unitCostCents: itemA.unitCostCents, locationId: loc, transactionId: poTx.id, vendorId: vendor.id, purpose: `PO-${year}-${padN(seq, 4)}` });
      addMove({ itemId: itemB.id, date: recvDate, kind: 'purchase', quantity: receivedQtyB, unitCostCents: itemB.unitCostCents, locationId: loc, transactionId: poTx.id, vendorId: vendor.id, purpose: `PO-${year}-${padN(seq, 4)}` });

      const po: PurchaseOrder = {
        id: `po-${year}-${padN(seq, 4)}`, workspaceId: wsId, poNumber: `PO-${year}-${padN(seq, 4)}`,
        vendorId: vendor.id, vendorName: vendor.name, issueDate, expectedDate: recvDate,
        status: receivedQtyA < orderedQtyA ? 'partially_received' : 'received',
        currency: 'USD', subtotalCents: totalCents, taxAmountCents: 0, totalCents,
        isBlanket: p === 0, blanketTotalCents: p === 0 ? totalCents * 4 : undefined,
        validFrom: p === 0 ? `${year}-01-01` : undefined, validUntil: p === 0 ? `${year}-12-31` : undefined,
        items: [
          { id: `pol-${seq}-1`, itemId: itemA.id, description: itemA.name, quantity: orderedQtyA, receivedQuantity: receivedQtyA, unitPriceCents: itemA.unitCostCents, totalCents: lineTotalA },
          { id: `pol-${seq}-2`, itemId: itemB.id, description: itemB.name, quantity: orderedQtyB, receivedQuantity: receivedQtyB, unitPriceCents: itemB.unitCostCents, totalCents: lineTotalB },
        ],
        receipts: [{
          id: `rcpt-${seq}`, receiptNumber: `GRN-${year}-${padN(seq, 4)}`, receivedDate: recvDate, location: loc,
          items: [
            { poItemId: `pol-${seq}-1`, itemId: itemA.id, description: itemA.name, quantityReceived: receivedQtyA, unitCostCents: itemA.unitCostCents, lotNumber: lotA, expiryDate, serialNumbers: serialsA, locationId: loc },
            { poItemId: `pol-${seq}-2`, itemId: itemB.id, description: itemB.name, quantityReceived: receivedQtyB, unitCostCents: itemB.unitCostCents, lotNumber: lotB, expiryDate, locationId: loc },
          ],
        }],
      } as unknown as PurchaseOrder;
      purchaseOrders.push(po);
      monthPOs.push(po);
    }

    for (let t = 0; t < 2 * scale; t++) {
      const xferItem = inventory[(m * 2 + t) % 24];
      const xferDate = dateYmd(year, m, 11 + t * 5);
      const xferRef = `XFER-${year}${pad2(m + 1)}-${t + 1}`;
      addMove({ itemId: xferItem.id, date: xferDate, kind: 'transfer-out', quantity: -4, unitCostCents: xferItem.unitCostCents, locationId: LOCATIONS[(m + t) % LOCATIONS.length], purpose: xferRef });
      addMove({ itemId: xferItem.id, date: xferDate, kind: 'transfer-in', quantity: 4, unitCostCents: xferItem.unitCostCents, locationId: LOCATIONS[(m + t + 1) % LOCATIONS.length], purpose: xferRef });
    }

    for (let b = 0; b < billsPerMonth; b++) {
      const seq = m * billsPerMonth + b + 1;
      const vendor = vendors[(m * 5 + b) % vendors.length];
      const linkedPo = b < monthPOs.length - 1 ? monthPOs[b] : undefined;
      const billDate = dateYmd(year, m, 5 + (b % 22));
      const dueDate = dateYmd(year, Math.min(11, m + 1), 5 + (b % 20));
      const expAccount = b % 3 === 0 ? 'acc-freight' : b % 3 === 1 ? 'acc-utilities' : 'acc-rent';
      const omitRequiredLabel = m === 10 && b < 2;
      const locDim = omitRequiredLabel ? undefined : { location: LOCATIONS[(m + b) % LOCATIONS.length], department: DEPARTMENTS[b % DEPARTMENTS.length] };
      const poBaseCost = linkedPo ? (linkedPo.items[0].unitPriceCents || 0) : 0;
      const qty = linkedPo ? linkedPo.items[0].quantity : 1;
      const unitRate = linkedPo ? poBaseCost + (b % 3 === 1 ? 75 : 0) : 45_000 + pickInt(0, 8) * 7_500;
      const netCents = qty * unitRate;
      const isIlVendor = String((vendor.metadata as { taxPlace?: { country?: string } } | undefined)?.taxPlace?.country || '') === 'IL';
      const taxCents = isIlVendor ? Math.round(netCents * 0.18) : 0;
      const grossCents = netCents + taxCents;
      const withheldCents = isIlVendor ? Math.round(netCents * 0.05) : 0;
      const paid = m < 10 || b % 3 !== 0;

      const debitLines: Array<{ accountId: string; amountCents: number; dimensions?: Record<string, string> }> = [
        { accountId: linkedPo ? 'acc-inventory' : expAccount, amountCents: netCents, dimensions: linkedPo ? undefined : locDim },
      ];
      if (taxCents > 0) debitLines.push({ accountId: 'acc-tax-payable', amountCents: taxCents });
      debitLines.push({ accountId: 'acc-ap', amountCents: -grossCents });
      const billTx = addBalancedEntry(billDate, `Supplier bill BILL-${year}-${padN(seq, 4)}`, debitLines, { projectId: projects[(m + b) % projects.length].id });

      const bill: Bill = {
        id: `bill-${year}-${padN(seq, 4)}`, workspaceId: wsId, number: `BILL-${year}-${padN(seq, 4)}`,
        vendorId: vendor.id, vendorName: vendor.name, date: billDate, dueDate, status: paid ? 'paid' : 'open',
        currency: 'USD', subtotalCents: netCents, taxAmountCents: taxCents, amountCents: grossCents,
        amountPaidCents: paid ? grossCents : 0, purchaseOrderId: linkedPo?.id, withholdingAmountCents: withheldCents,
        ledgerTransactionId: billTx.id, notes: b % 6 === 0 ? `Checked against delivery docket ${seq}` : undefined,
        items: [{
          id: `bl-${seq}-1`, itemId: linkedPo ? linkedPo.items[0].itemId : undefined,
          description: linkedPo ? linkedPo.items[0].description : `${accountById.get(expAccount)?.name} — ${monthKey}`,
          quantity: qty, rateCents: unitRate, unitPriceCents: unitRate, amountCents: netCents,
          accountId: linkedPo ? 'acc-inventory' : expAccount,
        }],
      } as unknown as Bill;
      bills.push(bill);

      if (paid) {
        const payDate = dateYmd(year, m, Math.min(28, 12 + (b % 16)));
        const cashOut = grossCents - withheldCents;
        const payLines: Array<{ accountId: string; amountCents: number }> = [
          { accountId: 'acc-ap', amountCents: grossCents },
          { accountId: 'acc-bank-main', amountCents: -cashOut },
        ];
        if (withheldCents > 0) payLines.push({ accountId: 'acc-withholding', amountCents: -withheldCents });
        const payTx = addBalancedEntry(payDate, `Supplier payment ${bill.number}`, payLines);
        runningBankCents -= cashOut;
        payments.push({
          id: `pay-out-${year}-${padN(seq, 4)}`, workspaceId: wsId, number: `PAY-OUT-${padN(seq, 4)}`,
          contactId: vendor.id, contactName: vendor.name, billId: bill.id, direction: 'made',
          method: b % 2 === 0 ? 'ach' : 'wire', status: 'posted', date: payDate, paymentDate: payDate,
          currency: 'USD', amountCents: cashOut, withholdingAmountCents: withheldCents, ledgerTransactionId: payTx.id,
        } as unknown as Payment);
        bankLines.push({
          id: `bl-${year}-${padN(bankSeq++, 5)}`, workspaceId: wsId, accountId: 'acc-bank-main',
          date: payDate, description: `Wire/ACH ${vendor.name}`, amountCents: -cashOut, currency: 'USD',
          status: m < 11 ? 'matched' : 'pending', matchedTransactionId: m < 11 ? payTx.id : undefined,
        } as unknown as BankStatementLine);
        if (m < 11) monthBankIds.push(payTx.id);
      }
    }

    for (let q = 0; q < quotesPerMonth; q++) {
      const seq = m * quotesPerMonth + q + 1;
      const customer = customers[(m * 3 + q) % customers.length];
      const item = inventory[(m * 2 + q) % 34];
      const qDate = dateYmd(year, m, 3 + q * 4);
      const qTotal = 6 * item.unitPriceCents;
      estimates.push({
        id: `est-${year}-${padN(seq, 4)}`, workspaceId: wsId, number: `EST-${year}-${padN(seq, 4)}`,
        customerId: customer.id, customerName: customer.name, date: qDate,
        expiryDate: dateYmd(year, Math.min(11, m + 1), 25),
        status: q % 3 === 0 ? 'accepted' : q % 3 === 1 ? 'sent' : 'expired',
        currency: 'USD', subtotalCents: qTotal, taxAmountCents: 0, amountCents: qTotal,
        items: [{ id: `estl-${seq}-1`, itemId: item.id, description: item.name, quantity: 6, rateCents: item.unitPriceCents, amountCents: qTotal, accountId: 'acc-sales-goods' }],
      } as unknown as Estimate);
    }

    for (let invIdx = 0; invIdx < invPerMonth; invIdx++) {
      const seq = m * invPerMonth + invIdx + 1;
      const customer = customers[(m * 7 + invIdx) % customers.length];
      const stockItem = inventory[(m * 5 + invIdx) % 34];
      const serviceItem = inventory[36 + ((m + invIdx) % 5)];
      const qtyStock = 2 + (invIdx % 3);
      const qtyService = 1 + (invIdx % 2);
      const invDate = dateYmd(year, m, 2 + (invIdx % 26));
      const dueDate = dateYmd(year, Math.min(11, m + 1), 2 + (invIdx % 25));
      const custMeta = customer.metadata as { taxPlace?: { country?: string; state?: string }; taxExempt?: boolean };
      const isIlBuyer = custMeta.taxPlace?.country === 'IL';
      const isExempt = Boolean(custMeta.taxExempt);

      const lineStockNet = qtyStock * stockItem.unitPriceCents;
      const lineServiceNet = qtyService * serviceItem.unitPriceCents;
      const subtotalCents = lineStockNet + lineServiceNet;
      const taxRate = isExempt ? 0 : isIlBuyer ? 0.18 : custMeta.taxPlace?.state === 'TX' ? 0.0625 : 0;
      const taxCents = Math.round(subtotalCents * taxRate);
      const grossCents = subtotalCents + taxCents;
      const cogsCents = qtyStock * stockItem.unitCostCents;
      const paid = m < 9 || invIdx % 4 !== 0;

      const invLines: Array<{ accountId: string; amountCents: number }> = [
        { accountId: 'acc-ar', amountCents: grossCents },
        { accountId: 'acc-sales-goods', amountCents: -lineStockNet },
        { accountId: 'acc-sales-service', amountCents: -lineServiceNet },
      ];
      if (taxCents > 0) invLines.push({ accountId: 'acc-tax-payable', amountCents: -taxCents });
      if (cogsCents > 0) invLines.push({ accountId: 'acc-cogs', amountCents: cogsCents }, { accountId: 'acc-inventory', amountCents: -cogsCents });

      const invTx = addBalancedEntry(invDate, `Sales invoice INV-${year}-${padN(seq, 4)}`, invLines, { projectId: projects[(m + invIdx) % projects.length].id });
      const saleLoc = LOCATIONS[(m + invIdx) % LOCATIONS.length];
      addMove({
        itemId: stockItem.id, date: invDate, kind: 'sale', quantity: -qtyStock, unitCostCents: stockItem.unitCostCents,
        locationId: saleLoc, transactionId: invTx.id, documentType: 'invoice', documentId: `inv-${year}-${padN(seq, 4)}`,
        customerId: customer.id, purpose: `INV-${year}-${padN(seq, 4)}`,
      });

      const poRef = ((seq - 1) % (poPerMonth * 12)) + 1;
      const invoice: Invoice = {
        id: `inv-${year}-${padN(seq, 4)}`, workspaceId: wsId, number: `INV-${year}-${padN(seq, 4)}`,
        customerId: customer.id, customerName: customer.name, date: invDate, dueDate,
        status: paid ? 'paid' : m < 10 ? 'overdue' : 'sent',
        currency: 'USD', exchangeRate: isIlBuyer ? 3.65 : 1, taxVersion: 2,
        taxTreatment: isExempt ? 'exempt' : taxCents > 0 ? 'standard' : 'zero_rated',
        subtotalCents, taxAmountCents: taxCents, amountCents: grossCents, amountPaidCents: paid ? grossCents : 0,
        ledgerTransactionId: invTx.id, notes: invIdx % 10 === 0 ? `Priority shipment ref #${seq}` : undefined,
        metadata: { taxPlace: custMeta.taxPlace },
        items: [
          {
            id: `invl-${seq}-1`, itemId: stockItem.id, description: stockItem.name, quantity: qtyStock,
            rateCents: stockItem.unitPriceCents, unitPriceCents: stockItem.unitPriceCents, amountCents: lineStockNet,
            accountId: 'acc-sales-goods',
            serialNumbers: invIdx % 4 === 0 ? [`SN-${year}-${padN(poRef, 4)}-1`] : undefined,
            lotNumber: `LOT-${year}${pad2(m + 1)}-${padN(((seq - 1) % poPerMonth) + m * poPerMonth + 1, 3)}A`,
            dimensions: { location: saleLoc },
          },
          {
            id: `invl-${seq}-2`, itemId: serviceItem.id, description: serviceItem.name, quantity: qtyService,
            rateCents: serviceItem.unitPriceCents, unitPriceCents: serviceItem.unitPriceCents, amountCents: lineServiceNet,
            accountId: 'acc-sales-service', dimensions: { location: saleLoc },
          },
        ],
      } as unknown as Invoice;
      invoices.push(invoice);

      if (paid) {
        const rcptDate = dateYmd(year, m, Math.min(28, 9 + (invIdx % 19)));
        const rcptTx = addBalancedEntry(rcptDate, `Customer payment ${invoice.number}`, [
          { accountId: 'acc-bank-main', amountCents: grossCents },
          { accountId: 'acc-ar', amountCents: -grossCents },
        ]);
        runningBankCents += grossCents;
        payments.push({
          id: `pay-in-${year}-${padN(seq, 4)}`, workspaceId: wsId, number: `PAY-IN-${padN(seq, 4)}`,
          contactId: customer.id, contactName: customer.name, invoiceId: invoice.id, direction: 'received',
          method: invIdx % 3 === 0 ? 'card' : invIdx % 3 === 1 ? 'ach' : 'wire', status: 'posted',
          date: rcptDate, paymentDate: rcptDate, currency: 'USD', amountCents: grossCents, ledgerTransactionId: rcptTx.id,
        } as unknown as Payment);
        bankLines.push({
          id: `bl-${year}-${padN(bankSeq++, 5)}`, workspaceId: wsId, accountId: 'acc-bank-main',
          date: rcptDate, description: `Deposit ${customer.name}`, amountCents: grossCents, currency: 'USD',
          status: m < 11 ? 'matched' : 'pending', matchedTransactionId: m < 11 ? rcptTx.id : undefined,
        } as unknown as BankStatementLine);
        if (m < 11) monthBankIds.push(rcptTx.id);
      }

      if (invIdx < 2) {
        const cnSeq = m * 2 + invIdx + 1;
        const creditAmount = stockItem.unitPriceCents;
        creditNotes.push({
          id: `cn-${year}-${padN(cnSeq, 3)}`, workspaceId: wsId, number: `CN-${year}-${padN(cnSeq, 3)}`,
          invoiceId: invoice.id, customerId: customer.id, customerName: customer.name,
          date: dateYmd(year, m, 24), status: 'issued', currency: 'USD',
          subtotalCents: creditAmount, taxAmountCents: 0, amountCents: creditAmount, reason: 'Damaged outer carton allowance',
          items: [{ id: `cnl-${cnSeq}-1`, itemId: stockItem.id, description: stockItem.name, quantity: 1, rateCents: creditAmount, amountCents: creditAmount, accountId: 'acc-sales-goods' }],
        } as unknown as CreditNote);
      }
    }

    const monthEnd = dateYmd(year, m, 28);
    const payrollCents = 2_850_000;
    const payrollTx = addBalancedEntry(monthEnd, `Monthly payroll ${monthKey}`, [
      { accountId: 'acc-payroll', amountCents: payrollCents, dimensions: { location: LOCATIONS[m % LOCATIONS.length], department: 'Operations' } },
      { accountId: 'acc-bank-main', amountCents: -payrollCents },
    ]);
    runningBankCents -= payrollCents;
    if (m < 11) monthBankIds.push(payrollTx.id);

    addBalancedEntry(monthEnd, `Monthly equipment depreciation ${monthKey}`, [
      { accountId: 'acc-depreciation', amountCents: 140_000, dimensions: { location: 'Tel Aviv', department: 'Operations' } },
      { accountId: 'acc-accum-dep', amountCents: -140_000 },
    ]);

    vendorCredits.push({
      id: `vc-${year}-${pad2(m + 1)}`, workspaceId: wsId, number: `VC-${year}-${pad2(m + 1)}`,
      vendorId: vendors[m % 12].id, vendorName: vendors[m % 12].name, date: monthEnd,
      status: 'open', currency: 'USD', amountCents: 18_500, reason: 'Volume rebate credit',
    } as unknown as VendorCredit);

    if (m < 11) {
      reconciliations.push({
        id: `rec-${year}-${pad2(m + 1)}`, workspaceId: wsId, accountId: 'acc-bank-main',
        statementDate: dateYmd(year, m, MONTH_DAYS[m]), statementBalanceCents: runningBankCents,
        reconciledIds: monthBankIds, status: 'completed',
      });
    }
  }

  for (const item of inventory) {
    if (runningItemQty.has(item.id)) item.quantityAtHand = runningItemQty.get(item.id) || 0;
  }

  const assets: FixedAsset[] = [
    { id: 'asset-forklift-1', workspaceId: wsId, name: 'Electric Reach Forklift', assetTag: 'FA-2026-001', purchaseDate: `${year}-01-05`, purchaseCostCents: 4_800_000, salvageValueCents: 600_000, usefulLifeMonths: 60, depreciationMethod: 'straight_line', status: 'active' } as unknown as FixedAsset,
    { id: 'asset-bench-2', workspaceId: wsId, name: 'Optical Calibration Bench', assetTag: 'FA-2026-002', purchaseDate: `${year}-02-10`, purchaseCostCents: 3_600_000, salvageValueCents: 0, usefulLifeMonths: 48, depreciationMethod: 'straight_line', status: 'active' } as unknown as FixedAsset,
  ];
  const recurring: RecurringTransaction[] = [
    { id: 'rec-rent-monthly', workspaceId: wsId, description: 'Monthly warehouse lease', amountCents: 420_000, currency: 'USD', frequency: 'monthly', nextRunDate: `${year + 1}-01-01`, active: true } as unknown as RecurringTransaction,
    { id: 'rec-sla-retainer', workspaceId: wsId, description: 'Hospitality SLA maintenance retainer', amountCents: 185_000, currency: 'USD', frequency: 'monthly', nextRunDate: `${year + 1}-01-05`, active: true } as unknown as RecurringTransaction,
  ];

  return {
    year, asOfDate, startDate, endDate, workspace, accounts, dimensions, projects, budgets,
    customers, vendors, inventory, invoices, creditNotes, estimates, bills, vendorCredits,
    purchaseOrders, payments, stockMoves, inventoryDetails: itemDetails(stockMoves, startDate, endDate),
    transactions, bankLines, reconciliations, assets, recurring,
  };
}

let cachedDefaultYear: SampleBusinessYearFixture | null = null;

export function getSampleBusinessYear(): SampleBusinessYearFixture {
  if (!cachedDefaultYear) cachedDefaultYear = buildSampleBusinessYear();
  return cachedDefaultYear;
}

export function summarizeSampleBusinessYear(fixture: SampleBusinessYearFixture): SampleBusinessMonthSummary[] {
  const byMonth = new Map<string, SampleBusinessMonthSummary>();
  for (let m = 0; m < 12; m++) {
    byMonth.set(`${fixture.year}-${pad2(m + 1)}`, {
      month: `${fixture.year}-${pad2(m + 1)}`, invoices: 0, bills: 0, purchaseOrders: 0,
      payments: 0, stockMoves: 0, transactions: 0, invoicedCents: 0, billedCents: 0,
    });
  }
  for (const inv of fixture.invoices) {
    const row = byMonth.get((inv.date || '').slice(0, 7));
    if (row) { row.invoices += 1; row.invoicedCents += inv.amountCents || 0; }
  }
  for (const bill of fixture.bills) {
    const row = byMonth.get((bill.date || '').slice(0, 7));
    if (row) { row.bills += 1; row.billedCents += bill.amountCents || 0; }
  }
  for (const po of fixture.purchaseOrders) {
    const row = byMonth.get(po.issueDate.slice(0, 7));
    if (row) row.purchaseOrders += 1;
  }
  for (const pay of fixture.payments) {
    const row = byMonth.get((pay.date || '').slice(0, 7));
    if (row) row.payments += 1;
  }
  for (const move of fixture.stockMoves) {
    const row = byMonth.get(move.date.slice(0, 7));
    if (row) row.stockMoves += 1;
  }
  for (const tx of fixture.transactions) {
    const row = byMonth.get(tx.date.slice(0, 7));
    if (row) row.transactions += 1;
  }
  return [...byMonth.values()];
}

export function verifySampleBusinessYear(fixture: SampleBusinessYearFixture): SampleBusinessVerification {
  const failures: string[] = [];
  const accountIds = new Set(fixture.accounts.map(a => a.id));
  const activeMonths = summarizeSampleBusinessYear(fixture).filter(m => m.invoices > 0 && m.bills > 0 && m.transactions > 0);
  if (activeMonths.length !== 12) failures.push(`Expected 12 active months, found ${activeMonths.length}.`);

  let balancedTransactions = 0;
  let totalLines = 0;
  for (const tx of fixture.transactions) {
    if (!isPostable(tx)) continue;
    const sum = (tx.lines || []).reduce((acc, line) => acc + lineAmount(line, tx), 0);
    totalLines += (tx.lines || []).length;
    if (sum !== 0) failures.push(`Unbalanced transaction ${tx.id}: sum=${sum}`);
    else balancedTransactions += 1;
    for (const line of tx.lines || []) {
      if (!accountIds.has(line.accountId)) failures.push(`Transaction ${tx.id} references unknown account ${line.accountId}`);
    }
  }

  const movesByItem = new Map<string, StockMove[]>();
  for (const m of fixture.stockMoves) {
    const list = movesByItem.get(m.itemId);
    if (list) list.push(m);
    else movesByItem.set(m.itemId, [m]);
  }
  for (const item of fixture.inventory) {
    if (!movesByItem.has(item.id)) continue;
    const problem = stockHistoryProblem(item, movesByItem.get(item.id) || []);
    if (problem) failures.push(`Stock history drift on ${item.id}: ${problem}`);
  }

  return { ok: failures.length === 0, failures, monthsCovered: activeMonths.length, balancedTransactions, totalLines };
}
