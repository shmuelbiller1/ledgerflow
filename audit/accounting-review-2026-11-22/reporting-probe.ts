// Read-only synthetic probes. Observed values printed; see REPORTING-REVIEW.md.
import { buildAccountantPack } from '../../src/lib/accountantExportPack';
import { computePartyAging } from '../../src/lib/aging';
import { agingTable, profitAndLossTable, reportCsv } from '../../src/lib/scheduledReports';
import { computeProfitAndLoss } from '../../src/server/reports/computeReports';
import type { AccountantPackInput } from '../../src/lib/accountantExportPack';
import type { ChartAccount, Invoice, Transaction } from '../../src/types';

const period = { key: 'M:2026-01', startDate: '2026-01-01', endDate: '2026-01-31', label: '2026-01' };
const accounts = [
  { id: 'sales', name: 'Sales', type: 'revenue' },
  { id: 'cogs', name: 'Cost of goods sold', type: 'cost_of_goods', category: 'COGS' },
  { id: 'rent', name: 'Rent', type: 'expense' },
  { id: 'cash', name: 'Cash', type: 'asset' },
] as ChartAccount[];
const tx = { id: 'pl', date: '2026-01-10', status: 'completed', lines: [
  { accountId: 'cash', amountCents: 100000 }, { accountId: 'sales', amountCents: -100000 },
  { accountId: 'cogs', amountCents: 30000 }, { accountId: 'rent', amountCents: 20000 }, { accountId: 'cash', amountCents: -50000 },
] } as Transaction;
const pl = computeProfitAndLoss(accounts, [tx], period.startDate, period.endDate);
console.log('Underlying P&L cents:', JSON.stringify({ income: pl.income.total, cogs: pl.cogs.total, expenses: pl.expense.total, net: pl.netIncome }));
console.log('Scheduled P&L table:', JSON.stringify(profitAndLossTable(pl, period).rows));

// The record reflects a payment on 10 February, AFTER the 31 January report date.
// The helper receives no payment history, just today's state.
const invoice = { id: 'i1', customerId: 'c1', date: '2026-01-01', dueDate: '2026-01-31', status: 'paid', amountCents: 10000, amountPaidCents: 10000, currency: 'USD' } as Invoice;
const rows = computePartyAging([{ id: 'c1', name: 'Acme' }], [invoice], 'customer', '2026-01-31', 'USD');
console.log('Historical aging of now-paid invoice:', JSON.stringify(agingTable(rows, [{ key: 'current', label: 'Current' }], period)));
const future = { ...invoice, id: 'future', date: '2026-02-10', dueDate: '2026-02-28', status: 'sent', amountPaidCents: 0 } as Invoice;
console.log('Past-date aging with a future invoice:', JSON.stringify(computePartyAging([{ id: 'c1', name: 'Acme' }], [future], 'customer', '2026-01-31', 'USD')));

const jpyInput = {
  workspaceName: 'JPY books', currency: 'JPY', startDate: '2026-01-01', endDate: '2026-12-31', asOfDate: '2026-12-31', generatedAt: '2026-12-31',
  accounts: [{ id: 'cash', name: 'Cash', type: 'asset' }, { id: 'capital', name: 'Capital', type: 'equity' }],
  transactions: [{ id: 't', date: '2026-06-01', status: 'completed', lines: [{ accountId: 'cash', amountCents: 100 }, { accountId: 'capital', amountCents: -100 }] }],
  invoices: [], bills: [], customers: [], vendors: [],
} as unknown as AccountantPackInput;
const pack = buildAccountantPack(jpyInput);
console.log('Accountant pack JPY trial balance:', JSON.stringify(pack.sections.find(s => s.key === 'trial-balance')?.rows));
const kwd = buildAccountantPack({ ...jpyInput, currency: 'KWD' });
console.log('Accountant pack KWD trial balance:', JSON.stringify(kwd.sections.find(s => s.key === 'trial-balance')?.rows));
console.log('Scheduled CSV for 100 JPY minor units:', JSON.stringify(reportCsv({ title: 'Example', headers: ['Account', 'Amount'], rows: [{ cells: ['Cash', 100] }] })));
