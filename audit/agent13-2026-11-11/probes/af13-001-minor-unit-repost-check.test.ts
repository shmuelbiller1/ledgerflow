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
 * The repost check multiplied by `doc.exchangeRate` alone.
 *
 * Expected from an independent calculation for a ¥100,000 invoice at 0.0067 USD/JPY:
 *   ¥100,000 × 0.0067 USD = USD 670.00 = 67,000 US cents.
 * The durable regression for this defect is `src/tests/close-checklist-statuses.test.ts`; this
 * probe is the before/after demonstration against the real posting service.
 * Run: NODE_ENV=test npx tsx --test audit/agent13-2026-11-11/probes/af13-001-minor-unit-repost-check.test.ts
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { findPostingMismatches } from '../../../src/lib/postingCheck';
import {
  jpyInvoice, postJpyInvoice, startPostingHarness, type PostingHarness,
} from '../../../src/tests/helpers/postingHarness';

describe('AF13-001 repost check vs the real posting path for a 0-decimal document currency', () => {
  let harness: PostingHarness;
  before(async () => { harness = await startPostingHarness(); });
  after(() => harness.restore());

  test('¥100,000 at 0.0067 posts 67,000 cents, and the repost check no longer expects 670', async () => {
    const accrual = await postJpyInvoice(harness);
    assert.equal(harness.byAccount(accrual).ar, 67_000,
      'the server posts ¥100,000 × 0.67 (USD cents per yen) = 67,000 US cents');

    const issues = findPostingMismatches({
      invoices: [jpyInvoice()],
      bills: [],
      transactions: [accrual],
      baseCurrency: 'USD',
    });

    // BEFORE the AF13-001 fix (2026-11-11) this probe failed with:
    //   [['inv-jpy', 'amount', 670, 67_000]]  — a ledger entry that is exactly right, reported wrong.
    // AFTER the fix the checklist agrees with the posting path:
    assert.deepEqual(issues, []);
  });
});
