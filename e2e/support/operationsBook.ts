import { workspaceId, item, customer, vendor } from './comparisonReportFixture';
import { book, dbRows } from './nextScheduleBook';

const common = { workspaceId, uid: 'journey-user' };
const account = (id: string, name: string, type: string, category: string) => ({ ...common, id, code: id, name, type, category });
const bank = account('bank', 'Petty cash קופה', 'asset', 'Cash'),
  expense = account('cost', 'Parts expense', 'expense', 'Operating Expenses');
const accounts = [...book.accounts, bank, expense];
export const employee = {
  ...common,
  id: 'emp',
  name: 'Noa נועה',
  role: 'Technician',
  state: 'CA',
  workerType: 'employee',
  salaryCents: 6000000,
  payFrequency: 'Monthly',
  status: 'Active',
  filingStatus: 'Single',
};
export const run = {
  ...common,
  id: 'run',
  date: '2026-02-20',
  status: 'processed',
  totalAmountCents: 505000,
  employeeCount: 1,
  employees: [{ employeeId: employee.id, name: employee.name, grossCents: 500000, netCents: 435000, withheldCents: 65000 }],
};
const sale = {
  ...book.invoices[0],
  amountCents: 11800,
  taxAmountCents: 1800,
  items: [{ ...book.invoices[0].items[0], serialNumbers: ['SN-17'] }],
};
const line = { id: 'part-line', description: item, itemId: 'part', quantity: 8, unitPriceCents: 2500, amountCents: 20000 };
export const order = {
  ...book.estimates[0],
  orderedAt: '2026-02-02',
  currency: 'USD',
  lines: [line],
  metadata: {
    quoteVersions: [
      {
        at: '2026-02-01T12:00:00Z',
        by: 'rep',
        byName: 'Avi אבי',
        snapshot: {
          amountCents: 15000,
          status: 'sent',
          expiryDate: '2026-03-31',
          lines: [{ ...line, quantity: 6, amountCents: 15000 }],
        },
      },
    ],
  },
};
export const orders = [
  {
    ...dbRows.purchaseOrders[0],
    status: 'ordered',
    issueDate: '2026-02-01',
    currency: 'USD',
    totalAmountCents: 4500,
    items: [
      { id: 'poi', itemId: 'part', description: item, quantity: 6, unitPriceCents: 750, totalCents: 4500, receivedQuantity: 4 },
    ],
    receipts: [
      {
        ...dbRows.purchaseOrders[0].receipts[0],
        id: 'gr',
        poNumber: 'PO-12',
        items: [
          {
            poItemId: 'poi',
            description: item,
            quantityReceived: 4,
            unitPriceCents: 750,
            condition: 'good',
            serialNumbers: ['SN-17'],
          },
        ],
      },
    ],
    blanket: { validUntil: '2026-03-31', capCents: 6000 },
  },
  {
    ...common,
    id: 'po2',
    poNumber: 'PO-24',
    status: 'sent',
    vendorId: 'v',
    vendorName: vendor,
    issueDate: '2026-02-03',
    currency: 'USD',
    totalAmountCents: 2500,
    items: [{ ...line, quantity: 1, totalCents: 2500, receivedQuantity: 0 }],
    receipts: [],
  },
];
const movement = {
  ...book.transactions[0],
  id: 'cash',
  type: 'expense',
  reference: 'PC-3',
  description: 'Valve purchase',
  totalAmountCents: 750,
  lines: [
    { accountId: 'bank', amountCents: -750 },
    { accountId: 'cost', amountCents: 750 },
  ],
};
const spread = {
  ...book.transactions[0],
  id: 'spread',
  totalAmountCents: 1500,
  description: 'February earned share',
  metadata: { type: 'revenue-recognition', spreadOfInvoiceId: 'inv', scheduled: true },
  lines: [],
};
const claim = {
  ...book.bills[0],
  id: 'claim',
  number: 'CL-8',
  amountCents: 750,
  amountPaidCents: 0,
  splits: [{ accountId: 'cost', amountCents: 750 }],
  metadata: { expenseClaim: { state: 'approved', submittedByName: employee.name } },
};
const notes = [
  {
    ...common,
    id: 'note',
    entityType: 'customer',
    entityId: 'c',
    body: 'Check delivery window',
    authorUid: 'rep',
    authorName: 'Avi אבי',
    createdAt: '2026-02-08T13:00:00Z',
  },
];
const shipping = {
  ...common,
  id: 'ship',
  name: 'Local ground',
  sku: 'SHIP',
  itemType: 'service',
  unitPriceCents: 1495,
  unitCostCents: 0,
  quantityAtHand: 0,
  metadata: { shippingMethod: { carrier: 'UPS', zone: 'Local', currency: 'USD', freeAboveCents: 10000, minDays: 2, maxDays: 4 } },
};
export const ledger = {
  ...book,
  accounts,
  transactions: [{ ...book.transactions[0], description: 'Invoice INV-17' }, movement, spread],
  employees: [employee],
  payRuns: [run],
  estimates: [order],
  invoices: [sale],
  bills: [...book.bills, claim],
  inventory: [
    ...book.inventory,
    shipping,
    { ...common, id: 'unpriced', name: 'Spare washer', sku: 'W-2', itemType: 'product', quantityAtHand: 0 },
  ],
  vendors: [{ ...book.vendors[0], is1099Vendor: true, address: '', metadata: { is1099: true, taxPlace: { country: 'US' } } }],
  customers: [{ ...book.customers[0], metadata: { ...book.customers[0].metadata, recordNotes: notes } }],
  payments: [
    ...book.payments,
    { ...book.payments[1], id: 'p1099', direction: 'outgoing', amountCents: 250000 },
    { ...book.payments[0], id: 'advance', number: 'PAY-3', unappliedCents: 1200, amountCents: 2500 },
  ],
  loans: [
    {
      ...common,
      id: 'loan1',
      lender: 'North Bank',
      principalCents: 120000,
      annualRate: 0.12,
      termMonths: 3,
      startDate: '2026-01-31',
      firstPaymentDate: '2026-02-28',
      liabilityAccountId: 'loan',
      interestAccountId: 'cost',
      bankAccountId: 'bank',
      currency: 'USD',
      reference: 'LOAN-3',
      payments: [],
    },
  ],
};
export const database = { ...dbRows, purchaseOrders: orders };
export const workspace = {
  id: workspaceId,
  name: 'Journey Books',
  currency: 'USD',
  openingBalanceDate: '2026-02-28',
  dimensions: [
    { id: 'branch', name: 'Branch', values: ['East'], requiredOn: { accountIds: ['cost'], since: '2026-01-01', refuse: true } },
  ],
  taxProfiles: {
    books: {
      name: 'Journey Books',
      place: { country: 'IL' },
      registrations: [{ kind: 'vat', number: '514000001', place: { country: 'IL' }, filing: 'monthly', validFrom: '2026-01-01' }],
    },
  },
};
export const openItem = {
  line: 2,
  contactId: 'c',
  contactName: customer,
  number: 'OPEN-3',
  date: '2026-01-10',
  dueDate: '2026-02-15',
  openCents: 1250,
};
