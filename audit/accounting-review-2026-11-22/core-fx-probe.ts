// Synthetic FX investigation; no database writes. Pass NODE_ENV=test and SYSTEM_SALT.
import { TransactionValidator } from '../../src/kernel/validation/TransactionValidator';
import { LedgerEngine } from '../../src/kernel/ledger/LedgerEngine';
import { lineAmount } from '../../src/lib/txFilters';
import { computeBalanceSheet, computeProfitAndLoss } from '../../src/server/reports/computeReports';
import type { ChartAccount } from '../../src/types';

const accounts = [
  { id: 'cash', name: 'Cash', type: 'asset', workspaceId: 'w' },
  { id: 'sales', name: 'Sales', type: 'revenue', workspaceId: 'w' },
] as ChartAccount[];
const context = {
  workspaceId: 'w', user: { uid: 'u' }, wsData: { currency: 'USD' }, db: {} as never,
  accountsMap: new Map(accounts.map(a => [a.id, { workspaceId: 'w', name: a.name }])),
};

for (const hasLineRate of [false, true]) {
  const rate = hasLineRate ? { exchangeRate: 0.0067 } : {};
  const result = await TransactionValidator.validateAndPrepare({
    id: 'fx-test', date: '2026-07-01', currency: 'JPY', exchangeRate: 0.0067,
    status: 'completed', type: 'actual',
    lines: [{ accountId: 'cash', amountCents: 1_000_000, ...rate }, { accountId: 'sales', amountCents: -1_000_000, ...rate }],
  }, context);
  const balances = LedgerEngine.computeDimensionalBalances(accounts, [result]);
  const pl = computeProfitAndLoss(accounts, [result], '2026-07-01', '2026-07-31');
  const bs = computeBalanceSheet(accounts, [result], '2026-07-31');
  console.log(JSON.stringify({ case: hasLineRate ? 'line rates supplied' : 'header rate only',
    lineRates: result.lines.map(l => l.exchangeRate), baseAmounts: result.lines.map(l => l.baseAmountCents ?? null),
    reportedLineAmounts: result.lines.map(l => lineAmount(l, result)), total: result.totalAmountCents,
    serverPLIncome: pl.income.total, serverAssets: bs.totalAssets,
    clientComputedCash: balances.get('cash')?.total,
  }));
}
