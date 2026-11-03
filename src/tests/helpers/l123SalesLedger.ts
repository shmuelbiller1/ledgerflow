/**
 * The hand-worked sales ledger of the L-123 step 4 sales reports (4b sales by item, 4i profitability); the figures are
 * worked in src/tests/l123-step4b-sales-by-item.test.tsx. Year Y = this year; amounts in cents. I1 and I3 are Acme's,
 * I2 is Beta's, I4 (a draft) has no customer.
 */
import { workspaceYearMonth } from '../../lib/utils';
import type { ChartAccount, Customer, InventoryItem, Invoice, Transaction } from '../../types';

export const Y = workspaceYearMonth().year;
export const from = `${Y}-01-01`, to = `${Y}-12-31`;
export const chart = (ws: string): ChartAccount[] => [
  { id: `${ws}_cogs`, workspaceId: ws, uid: 'owner-1', code: '5000', name: 'Cost of Goods Sold', type: 'expense', category: 'COGS' } as ChartAccount,
  { id: `${ws}_inv`, workspaceId: ws, uid: 'owner-1', code: '1300', name: 'Inventory', type: 'asset', category: 'Inventory' } as ChartAccount,
];
export const stock = (ws: string): InventoryItem[] => [
  { id: `${ws}_W`, workspaceId: ws, uid: 'owner-1', name: 'Widget', sku: 'W-1', unitCostCents: 300 } as InventoryItem,
  { id: `${ws}_G`, workspaceId: ws, uid: 'owner-1', name: 'Gadget', sku: 'G-1', unitCostCents: 500 } as InventoryItem,
];
const invoice = (ws: string, n: number, date: string, status: string, item: string, quantity: number, amountCents: number) => ({
  id: `${ws}_I${n}`, workspaceId: ws, uid: 'owner-1', number: `I${n}`, date, status, exchangeRate: 1,
  ...(n === 2 ? { customerId: `${ws}_beta` } : n === 4 ? {} : { customerId: `${ws}_acme` }),
  items: [{ id: 'l1', itemId: `${ws}_${item}`, description: item, quantity, amountCents }],
}) as unknown as Invoice;
export const invoices = (ws: string): Invoice[] => [
  invoice(ws, 1, `${Y}-01-10`, 'sent', 'W', 2, 2000),
  invoice(ws, 2, `${Y}-02-05`, 'paid', 'G', 1, 1500),
  invoice(ws, 3, `${Y}-03-01`, 'sent', 'W', 1, 1000),
  invoice(ws, 4, `${Y}-03-20`, 'draft', 'W', 5, 5000),
];
export const cogsTx = (ws: string, id: string, date: string, cents: number, metadata: Record<string, unknown>) => ({
  id: `${ws}_${id}`, workspaceId: ws, uid: 'owner-1', date, description: id, totalAmountCents: Math.abs(cents), currency: 'USD', status: 'completed', type: 'journal',
  metadata, lines: [{ accountId: `${ws}_cogs`, amountCents: cents }, { accountId: `${ws}_inv`, amountCents: -cents }],
}) as unknown as Transaction;
export const entries = (ws: string): Transaction[] => [
  cogsTx(ws, 'C1', `${Y}-01-10`, 700, { cogsForInvoiceId: `${ws}_I1`, cogsForLineId: 'l1' }),
  cogsTx(ws, 'C3', `${Y}-03-01`, 400, { cogsForInvoiceId: `${ws}_I3`, cogsForLineId: 'l1' }),
  cogsTx(ws, 'C3R', `${Y}-03-05`, -400, { isReversal: true, reversesTxId: `${ws}_C3` }),
];
export const clients = (ws: string): Customer[] => [
  { id: `${ws}_acme`, workspaceId: ws, uid: 'owner-1', name: 'Acme' } as Customer,
  { id: `${ws}_beta`, workspaceId: ws, uid: 'owner-1', name: 'Beta' } as Customer,
];
