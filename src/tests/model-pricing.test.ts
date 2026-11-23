/** AI model prices as dated rows (strategic review, 11 Oct): Gemini 2.5 Flash at $0.30 / $2.50 per million tokens. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { callCostCents, priceOn } from '../lib/ai/modelPricing';

test('a call is priced from the dated row; an unknown model is not guessed', () => {
  assert.equal(priceOn('gemini-2.5-flash', '2026-10-11')?.inputUsdPerMillion, 0.3);
  // 1M in + 1M out = $0.30 + $2.50 = 280 cents
  assert.equal(callCostCents('gemini-2.5-flash', '2026-10-11', 1_000_000, 1_000_000), 280);
  assert.equal(callCostCents('gemini-2.5-flash', '2026-10-11', 1000, 500), 0.155);
  assert.equal(callCostCents('some-new-model', '2026-10-11', 1000, 1000), undefined);
});

test('Luna and Terra standard rates include cached input from 23 November 2026', () => {
  assert.equal(callCostCents('gpt-6-luna', '2026-11-22', 1, 1), undefined);
  assert.equal(callCostCents('gpt-6-luna', '2026-11-23', 1_000_000, 1_000_000, 500_000), 55.5);
  assert.equal(callCostCents('gpt-6.1-terra', '2026-11-23', 1_000_000, 1_000_000, 500_000), 552.5);
});
