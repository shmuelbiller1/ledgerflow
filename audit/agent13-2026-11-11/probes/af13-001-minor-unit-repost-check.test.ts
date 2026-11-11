/**
 * Agent #13 probe, AF13-001, 2026-11-11.
 *
 * Question: does the month-end close "Invoices and bills match the ledger" check
 * (`src/lib/postingCheck.ts` via `src/lib/closeChecklist.ts`) agree with the entry the
 * server really posts for a document whose currency has a different number of minor
 * units than the books' currency (JPY: 0 digits, books in USD: 2 digits)?
 *
 * The real posting path converts document minor units to book minor units
 * (`documentMinorRate` → `minorUnitRate` = rate × 10^(digits(base) − digits(document))).
 * The repost check multiplies by `doc.exchangeRate` only.
 *
 * Expected from an independent calculation for a ¥100,000 invoice at 0.0067 USD/JPY:
 *   ¥100,000 × 0.0067 USD = USD 670.00 = 67,000 US cents.
 * Run: NODE_ENV=test npx tsx --test audit/agent13-2026-11-11/probes/af13-001-minor-unit-repost-check.test.ts
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { lineAmount } from '../../../src/lib/txFilters';
import { makeChartAccount, makeInvoice } from '../../../src/tests/fixtures';
import { findPostingMismatches } from '../../../src/lib/postingCheck';
import type { Transaction, Workspace } from '../../../src/types';

type Posted = Transaction & { metadata?: Record<string, unknown> };

describe('AF13-001 repost check vs the real posting path for a 0-decimal document currency', () => {
  const sent: Posted[][] = [];
  const realFetch = globalThis.fetch;
  let LedgerPostService: typeof import('../../../src/services/LedgerPostService').LedgerPostService;

  before(async () => {
    globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
      sent.push(JSON.parse(String(init?.body || '{}')).transactions || []);
      return new Response(JSON.stringify({ status: 'ok' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    ({ LedgerPostService } = await import('../../../src/services/LedgerPostService'));
  });
  after(() => { globalThis.fetch = realFetch; });

  const context = () => ({
    lockDate: null,
    transactions: [],
    inventory: [],
    workspaces: [{ id: 'w1', uid: 'u1', name: 'W', currency: 'USD' } as Workspace],
    accounts: [
      makeChartAccount({ id: 'ar', name: 'Accounts Receivable', type: 'asset', category: 'Receivables' }),
      makeChartAccount({ id: 'ap', name: 'Accounts Payable', type: 'liability', category: 'Payables' }),
      makeChartAccount({ id: 'cash', name: 'Checking', type: 'asset', category: 'Cash' }),
      makeChartAccount({ id: 'rev', name: 'Sales', type: 'income', category: 'Revenue' }),
      makeChartAccount({ id: 'exp', name: 'Supplies', type: 'expense' }),
    ],
  });
  const byAccount = (tx: Posted) => Object.fromEntries(tx.lines.map(l => [l.accountId, lineAmount(l, tx)]));

  test('¥100,000 invoice at 0.0067 posts 67,000 cents, but the repost check expects 670', async () => {
    sent.length = 0;
    await LedgerPostService.postInvoiceLedger('inv-jpy', {
      number: 'INV-JPY-1', customerId: 'c1', customerName: 'Tokyo Customer',
      date: '2026-03-10', dueDate: '2026-04-10',
      amountCents: 100_000, currency: 'JPY', exchangeRate: 0.0067, status: 'sent',
    }, 'w1', 'u1', undefined, context());

    const accrual = sent[0][0];
    const postedAr = byAccount(accrual).ar;
    assert.equal(postedAr, 67_000, 'the server posts ¥100,000 × 0.67 (USD cents per yen) = 67,000 US cents');

    const issues = findPostingMismatches({
      invoices: [makeInvoice({ id: 'inv-jpy', number: 'INV-JPY-1', amountCents: 100_000, currency: 'JPY', exchangeRate: 0.0067, status: 'sent', dueDate: '2026-04-10' })],
      bills: [],
      transactions: [accrual],
      baseCurrency: 'USD',
    });

    // BEFORE the AF13-001 fix (2026-11-11) this probe passed with the defect:
    //   [['inv-jpy', 'amount', 670, 67_000]]  — a ledger entry that is exactly right, reported wrong.
    // AFTER the fix the checklist agrees with the posting path:
    assert.deepEqual(issues, []);
  });
});
