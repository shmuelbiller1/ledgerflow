import { customer, item, vendor, workspaceId } from './comparisonReportFixture';

// One February book shared by the 25 production components, in home minor units.
const common = { workspaceId, uid: 'journey-user', createdAt: '2026-01-01' };
const location = 'East מזרח';
const customers = [{ ...common, id: 'c', name: customer, metadata: { creditLimitCents: 7000, taxPlace: { country: 'US', state: 'TX' }, taxExemption: { number: 'RES-17', expires: '2026-02-15', type: 'resale' } } }];
const vendors = [{ ...common, id: 'v', name: vendor, metadata: { taxPlace: { country: 'IL' }, withholding: { number: 'W-12', ratePercent: 3, expires: '2026-02-15' } } }];
const inventory = [{ ...common, id: 'part', name: item, sku: 'V-7', itemType: 'product', quantityAtHand: 5, unitCostCents: 750, standardCostCents: 650, unitPriceCents: 2500, reorderPoint: 9, unitsPerPackage: 2, measurementUnit: 'each', metadata: { customerItemCodes: [{ customerId: 'c', customerCode: 'BUY-3', customerDescription: 'Valve insert' }] } },
  { ...common, id: 'kit', name: 'Pump kit ערכה', sku: 'K-2', quantityAtHand: 0, itemType: 'product', assembleOnDemand: true, bundleParts: [{ itemId: 'part', quantity: 2 }] }];
const invoices = [{ ...common, id: 'inv', number: 'INV-17', customerId: 'c', customerName: customer, date: '2026-02-03', dueDate: '2026-02-12', status: 'sent', amountCents: 10000, amountPaidCents: 2000, currency: 'USD', taxCodeId: 'standard', taxVersion: 2, taxAmountCents: 0,
  items: [{ id: 'l', itemId: 'part', description: item, quantity: 4, rateCents: 2500, amountCents: 10000, accountId: 'rev', dimensions: { location: 'east' }, lotNumber: 'LOT-א' }] }];
const bills = [{ ...common, id: 'bill', number: 'B-12', vendorId: 'v', vendorName: vendor, date: '2026-02-02', dueDate: '2026-02-25', status: 'approved', amountCents: 4500, currency: 'USD',
  splits: [{ id: 'split', itemId: 'part', description: item, quantity: 6, amountCents: 4500, accountId: 'stock' }], metadata: { retention: { heldCents: 500, releaseDate: '2026-02-24', project: 'Pier רציף' } } }];
const payments = [{ ...common, id: 'received', direction: 'received', contactId: 'c', contactName: customer, date: '2026-02-10', paymentDate: '2026-02-10', amountCents: 2000, currency: 'USD', method: 'bank_transfer', status: 'posted', allocations: [{ documentId: 'inv', documentType: 'invoice', amountCents: 2000 }] },
  { ...common, id: 'made', direction: 'made', contactId: 'v', contactName: vendor, date: '2026-02-11', amountCents: 1500, withheldCents: 150, withholdingCertificate: 'W-12', currency: 'USD', status: 'posted', allocations: [] }];
const accounts = [{ ...common, id: 'ar', code: '1100', name: 'Receivables', type: 'asset', category: 'Receivables' }, { ...common, id: 'rev', code: '4000', name: 'Sales', type: 'revenue', category: 'Revenue' }];
const transactions = [{ ...common, id: 'posting', date: '2026-02-03', type: 'income', status: 'completed', totalAmountCents: 10000, metadata: { invoiceId: 'inv' }, lines: accounts.map((a, i) => ({ accountId: a.id, accountName: a.name, category: a.category, amountCents: i ? -10000 : 10000, debitCents: i ? 0 : 10000, creditCents: i ? 10000 : 0 })) }];
const estimates = [{ ...common, id: 'order', number: 'SO-5', customerId: 'c', customerName: customer, date: '2026-02-01', status: 'accepted', amountCents: 20000, milestones: [{ label: 'Deposit', percent: 25, invoicedAt: '2026-02-02' }, { label: 'Delivery', percent: 50, due: '2026-02-25' }] }];
export const book = { customers, vendors, invoices, bills, payments, inventory, accounts, transactions, estimates };
export const stockPlaces = [{ ...common, id: 'east', dimensionId: 'location', description: location, status: 'active' }];
export const reps = [{ id: 'rep', name: 'Avi אבי', commissionPercent: 5, customerIds: ['c'] }];
const receipt = { receiptNumber: 'GR-12', receivedDate: '2026-02-02', vendorName: vendor, items: [{ poItemId: 'poi', quantityReceived: 6, unitPriceCents: 750, lotNumber: 'LOT-א', lotExpiryDate: '2027-06-30' }] };
const purchaseOrders = [{ ...common, id: 'po', poNumber: 'PO-12', vendorId: 'v', vendorName: vendor, status: 'received', items: [{ id: 'poi', itemId: 'part', description: item, quantity: 6 }], receipts: [receipt] }];
const movement = (id: string, date: string, quantity: number, quantityBefore: number, locationId: string) => ({ ...common, id, key: id, seq: id, writtenOn: date, date, locationId, itemId: 'part', itemName: item, kind: quantity > 0 ? 'purchase' : 'sale', quantity, quantityBefore, quantityAfter: quantityBefore + quantity, unitCostCents: 750, valueCents: quantity * 750 });
const stockMoves = [movement('m1', '2026-02-02', 3, 0, ''), movement('m2', '2026-02-04', 3, 3, 'east'), movement('m3', '2026-02-10', -1, 6, 'east')];
export const history = [{ itemId: 'part', itemName: item, opening: { quantity: 0, valueCents: 0 }, moves: stockMoves, closing: { quantity: 5, valueCents: 3750 }, received: 6, issued: 1 }];
export const dbRows = { stockMoves, purchaseOrders, customers, vendors, payments };
