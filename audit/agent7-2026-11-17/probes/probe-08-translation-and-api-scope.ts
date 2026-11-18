/**
 * Agent #7 Probe 08 (2026-11-16) — A7N-10 (group translation in JPY/KWD) and A7S-01 (API-key scope)
 *
 * Runs the real code, not a copy of it:
 *  - `translate()` from src/server/reports/groupReport.ts, with a yen member's figures translated into a
 *    dollar report. The rate is quoted for major units, so ¥1,000,000 at 0.0067 is $6,700.00 = 670,000
 *    cents. Multiplying the member's whole yen by the rate gives 6,700 "cents" = $67.00, a hundred times
 *    too small; that is what the report showed before patch 08.
 *  - `requiredApiKeyScope()` from src/server/auth/apiAuthenticate.ts, for every period command. The
 *    enumerated list (close|closesteps|depreciation|relock|reopen|signoff|unlock) left yearclose,
 *    balancesrebuild, fxrevaluation and fxrevaluationundo on `write:transactions`, so a transaction
 *    integration could lock a year or restate the books.
 *
 * Run: npx tsx audit/agent7-2026-11-16/probes/probe-08-translation-and-api-scope.ts
 * (no database needed: both are pure functions)
 */
import assert from 'node:assert/strict';
import { translate } from '../../../src/server/reports/groupReport';
import { requiredApiKeyScope } from '../../../src/server/auth/apiAuthenticate';

const figures = {
  income: 1_000_000, cogs: 0, grossProfit: 1_000_000, expense: 0, netIncome: 1_000_000,
  totalAssets: 1_000_000, totalLiabilities: 0, totalEquity: 1_000_000,
  equityAccounts: 0, earlierProfit: 0,
};
const rates = { closing: 0.0067, average: 0.0067, historical: 0.0067 };

// A7N-10: ¥1,000,000 of net income is $6,700.00 = 670,000 USD cents.
const yenIntoDollars = translate(figures, rates, 'JPY', 'USD');
console.log('A7N-10 yen member, $ report:', JSON.stringify(yenIntoDollars));
assert.equal(yenIntoDollars.netIncome, 670_000, '¥1,000,000 at 0.0067 is 670,000 cents ($6,700.00)');
assert.equal(yenIntoDollars.totalAssets, 670_000);

// the same currency needs no digits change: $1,000,000 at 1.0 stays 1,000,000 cents
const dollarsIntoDollars = translate(figures, { closing: 1, average: 1, historical: 1 }, 'USD', 'USD');
assert.equal(dollarsIntoDollars.netIncome, 1_000_000);

// KWD has three decimals: KWD 1,000.000 (1,000,000 fils) at 3.25 is $3,250.00 = 325,000 cents
const kwdFigures = { ...figures, income: 1_000_000, grossProfit: 1_000_000, netIncome: 1_000_000, totalAssets: 1_000_000, totalEquity: 1_000_000 };
const kwdIntoDollars = translate(kwdFigures, { closing: 3.25, average: 3.25, historical: 3.25 }, 'KWD', 'USD');
console.log('A7N-10 KWD member, $ report:', JSON.stringify(kwdIntoDollars));
assert.equal(kwdIntoDollars.netIncome, 325_000, 'KWD 1,000.000 at 3.25 is $3,250.00 = 325,000 cents');

// A7S-01: every period command is a workspace-scope operation, not a transaction write
const periodCommands = [
  'period.close', 'period.closesteps', 'period.depreciation', 'period.fxrevaluation',
  'period.fxrevaluationundo', 'period.balancesrebuild', 'period.relock', 'period.reopen',
  'period.signoff', 'period.unlock', 'period.yearclose',
];
const scopes = periodCommands.map(name => ({ name, scope: requiredApiKeyScope('POST', `/api/v1/workspaces/ws1/commands/${name}`) }));
console.log('A7S-01 period command scopes:', JSON.stringify(scopes));
for (const { name, scope } of scopes) {
  assert.equal(scope, 'write:workspaces', `${name} must need write:workspaces, not ${scope}`);
}
// and the neighbouring mappings still hold
assert.equal(requiredApiKeyScope('POST', '/api/v1/workspaces/ws1/commands/invoice.create'), 'write:transactions');
assert.equal(requiredApiKeyScope('POST', '/api/v1/workspaces/ws1/commands/autorule.create'), 'write:rules');
assert.equal(requiredApiKeyScope('GET', '/api/v1/workspaces/ws1/transactions'), 'read:transactions');
console.log('probe 08: all assertions held');
