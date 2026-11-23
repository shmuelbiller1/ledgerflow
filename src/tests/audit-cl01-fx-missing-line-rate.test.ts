/**
 * CL-01 / CR-01 / CL-02 regression — a missing line FX rate must stay missing.
 *
 * The audit (PR #1002, CORE-LEDGER-REVIEW / CREDITS-REVIEW) found that
 * `TransactionLineSchema.exchangeRate` carried `.default(1)`, so a foreign
 * entry whose lines omit the rate — the raw `/transactions` route and the
 * credit-refund builder both do — was converted 1:1 by the validator before
 * `settleHomeCurrency` ever ran: ¥1,000,000 at 0.0067 settled to $10,000
 * instead of $6,700, and a full €100 @ 1.20 credit refund left $20 stuck in
 * A/R. The client `LedgerEngine` additionally ignored `baseAmountCents` and
 * the minor-unit digits shift, reporting $67 against the server's $6,700.
 *
 * This test inverts the audit scenario: missing line rates must inherit the
 * entry's header rate everywhere, explicit 1 must still mean "already home",
 * and the client engine must agree with the server statements.
 */
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { TransactionSchema, TransactionLineSchema } from '../schemas';
import { TransactionValidator } from '../kernel/validation/TransactionValidator';
import { LedgerEngine } from '../kernel/ledger/LedgerEngine';
import { lineAmount } from '../lib/txFilters';
import { computeProfitAndLoss, computeBalanceSheet } from '../server/reports/computeReports';
import type { PeriodLockSettings } from '../lib/periodLock';
import type { ChartAccount, Transaction } from '../types';

const accounts = [
  { id: 'cash', name: 'Cash', type: 'asset', workspaceId: 'w' },
  { id: 'sales', name: 'Sales', type: 'revenue', workspaceId: 'w' },
] as ChartAccount[];

const context = {
  workspaceId: 'w',
  user: { uid: 'u' },
  // the validator reads the home currency off wsData with its own cast (PeriodLockSettings
  // carries no currency field of its own)
  wsData: { currency: 'USD' } as PeriodLockSettings,
  db: {} as never,
  accountsMap: new Map(accounts.map(a => [a.id, { workspaceId: 'w', name: a.name }])),
};

describe('CL-01: missing line exchange rates inherit the header rate', () => {
  test('the schema keeps a missing rate missing and explicit 1 explicit', () => {
    const line = TransactionLineSchema.safeParse({ accountId: 'cash', amountCents: 100 });
    assert.ok(line.success);
    assert.equal(line.data.exchangeRate, undefined, 'a missing line rate must not be defaulted to 1');

    const home = TransactionLineSchema.safeParse({ accountId: 'cash', amountCents: 100, exchangeRate: 1 });
    assert.ok(home.success);
    assert.equal(home.data.exchangeRate, 1, 'an explicit 1 still means "already in the books currency"');

    const entry = TransactionSchema.safeParse({
      id: 'fx', uid: 'u', workspaceId: 'w', date: '2026-07-01', currency: 'JPY', exchangeRate: 0.0067,
      status: 'completed', type: 'actual',
      lines: [{ accountId: 'cash', amountCents: 1_000_000 }, { accountId: 'sales', amountCents: -1_000_000 }],
    });
    assert.ok(entry.success);
    for (const l of entry.data.lines) assert.equal(l.exchangeRate, undefined, 'header rate must survive into the parsed lines');
  });

  test('a header-rate-only JPY entry settles to $6,700 (670,000 cents), not $10,000', async () => {
    const result = await TransactionValidator.validateAndPrepare({
      id: 'fx-test', date: '2026-07-01', currency: 'JPY', exchangeRate: 0.0067,
      status: 'completed', type: 'actual',
      lines: [{ accountId: 'cash', amountCents: 1_000_000 }, { accountId: 'sales', amountCents: -1_000_000 }],
    }, context);

    assert.deepEqual(result.lines.map(l => l.exchangeRate), [undefined, undefined],
      'the validator must not inject a 1:1 line rate');
    assert.deepEqual(result.lines.map(l => l.baseAmountCents), [670_000, -670_000],
      '¥1,000,000 at 0.0067 = $6,700 with the minor-unit digits shift');
    assert.equal(result.totalAmountCents, 670_000, 'the entry total follows the settled home amounts');
  });

  test('readers agree: lineAmount, server P&L, server Balance Sheet, client engine', async () => {
    const result = await TransactionValidator.validateAndPrepare({
      id: 'fx-test', date: '2026-07-01', currency: 'JPY', exchangeRate: 0.0067,
      status: 'completed', type: 'actual',
      lines: [{ accountId: 'cash', amountCents: 1_000_000 }, { accountId: 'sales', amountCents: -1_000_000 }],
    }, context);

    assert.equal(lineAmount(result.lines[0], result), 670_000);
    const pl = computeProfitAndLoss(accounts, [result], '2026-07-01', '2026-07-31');
    assert.equal(pl.income.total, 670_000, 'server P&L reports $6,700');
    const bs = computeBalanceSheet(accounts, [result], '2026-07-31');
    assert.equal(bs.totalAssets, 670_000, 'server balance sheet reports $6,700');

    // CL-02: the client engine must read the same settled amount, not rawAmount × rate
    const balances = LedgerEngine.computeDimensionalBalances(accounts, [result] as Transaction[]);
    assert.equal(balances.get('cash')?.total, 670_000, 'client engine agrees with the server (was $67)');
  });

  test('an explicit line rate of 1 is still treated as already-home (no conversion)', async () => {
    const result = await TransactionValidator.validateAndPrepare({
      id: 'home-test', date: '2026-07-01', currency: 'USD', exchangeRate: 0.0067,
      status: 'completed', type: 'actual',
      lines: [{ accountId: 'cash', amountCents: 50_000, exchangeRate: 1 }, { accountId: 'sales', amountCents: -50_000, exchangeRate: 1 }],
    }, context);
    for (const l of result.lines) {
      assert.equal(l.exchangeRate, 1);
      assert.equal(lineAmount(l, result), l.amountCents, 'rate-1 lines read back at their own amount, unconverted');
    }
    assert.equal(result.totalAmountCents, 50_000);
  });

  test('a supplied line rate still wins over the header rate', async () => {
    const result = await TransactionValidator.validateAndPrepare({
      id: 'line-rate-test', date: '2026-07-01', currency: 'JPY', exchangeRate: 0.0067,
      status: 'completed', type: 'actual',
      lines: [{ accountId: 'cash', amountCents: 1_000_000, exchangeRate: 0.007 }, { accountId: 'sales', amountCents: -1_000_000, exchangeRate: 0.007 }],
    }, context);
    assert.deepEqual(result.lines.map(l => l.baseAmountCents), [700_000, -700_000], '¥1M at 0.007 = $7,000');
  });
});
