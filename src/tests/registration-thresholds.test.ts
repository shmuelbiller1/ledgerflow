import test from 'node:test';
import assert from 'node:assert/strict';
import { REGISTRATION_THRESHOLDS, REGISTRATION_THRESHOLD_ACTIVITIES } from '../lib/tax/registrationThresholds';
import { registrationThresholdPack } from '../lib/rules/packs/registrationThresholdPack';
import { taxRulePackProblems } from '../lib/rules/packs';
import { composeFacts, type Fact } from '../lib/rules/facts';
import { evaluateRules } from '../lib/rules/rules';
import { registrationThresholdWatch } from '../lib/registrationThresholdWatch';
import { makeChartAccount, makeTransaction } from './fixtures';
import type { DimensionNode, Transaction } from '../types';

const pack = registrationThresholdPack();
const fact = (attribute: Fact['attribute'], value: string): Fact => ({ attribute, value, evidence: { kind: 'declared' } });

function matchingRules(country: string, activity: string, date: string) {
  const composed = composeFacts({
    books: [fact('country', country)],
    labels: { [`activity:${activity}`]: [fact('activity', activity)] },
  }, { activity }, ['activity'], date);
  return evaluateRules(pack.rules, composed, { date, scope: 'entity-period' });
}

const revenue = makeChartAccount({ id: 'sales', workspaceId: 'w', name: 'Sales', type: 'revenue', category: 'Income' });
const expense = makeChartAccount({ id: 'expense', workspaceId: 'w', name: 'Office expense', type: 'expense', category: 'Operating' });
const accounts = [revenue, expense];
const entity = (id: string, description: string): DimensionNode => ({ id, dimensionId: 'world', description });
const activityNode = (id: string, description: string): DimensionNode => ({ id, dimensionId: 'activity', description });
const sale = (id: string, date: string, amountCents: number, dimensions: Record<string, string>, extra: Partial<Transaction> = {}) => makeTransaction({
  id, workspaceId: 'w', date, totalAmountCents: Math.abs(amountCents),
  lines: [{ accountId: 'sales', amountCents, dimensions }],
  ...extra,
});

const israelProfiles = { labels: { 'world:ILCO': { name: 'Israel Co', place: { country: 'IL' } } } };

test('A-39: dated threshold rows preserve their native currencies, jurisdiction scope and official sources', () => {
  assert.equal(pack.id, 'registration-thresholds');
  assert.deepEqual(taxRulePackProblems(), []);
  for (const row of REGISTRATION_THRESHOLDS) {
    assert.match(row.validFrom, /^\d{4}-\d{2}-\d{2}$/);
    if (row.validTo) assert.ok(row.validTo >= row.validFrom, row.id);
    assert.ok(row.thresholdCents > 0, row.id);
    assert.ok(row.source.url.startsWith('https://'), row.id);
    const rule = pack.rules.find(candidate => candidate.id === row.id)!;
    assert.equal(rule.scope, 'entity-period');
    assert.equal(rule.status, 'calculation');
    assert.deepEqual(rule.when.map(condition => condition.attribute), ['country', 'activity']);
  }
  const thresholds = new Map(REGISTRATION_THRESHOLDS.map(row => [row.id, [row.thresholdCents, row.currency, row.validFrom, row.validTo]]));
  assert.deepEqual(thresholds.get('il-osek-patur-2024'), [12_000_000, 'ILS', '2024-01-01', '2024-12-31']);
  assert.deepEqual(thresholds.get('il-osek-patur-2025'), [12_000_000, 'ILS', '2025-01-01', '2025-12-31']);
  assert.deepEqual(thresholds.get('il-osek-patur-2026'), [12_283_300, 'ILS', '2026-01-01', undefined]);
  assert.deepEqual(thresholds.get('uk-vat-registration-2024-04'), [9_000_000, 'GBP', '2024-04-01', undefined]);
  assert.deepEqual(thresholds.get('ca-gst-small-supplier-single-quarter'), [3_000_000, 'CAD', '1991-01-01', undefined]);
  assert.deepEqual(thresholds.get('ca-gst-small-supplier-four-quarters'), [3_000_000, 'CAD', '1991-01-01', undefined]);
  assert.deepEqual(thresholds.get('eu-oss-place-of-supply-2021-07'), [1_000_000, 'EUR', '2021-07-01', undefined]);
  assert.equal(REGISTRATION_THRESHOLDS.find(row => row.id === 'eu-oss-place-of-supply-2021-07')?.countryCodes.length, 27);
  assert.ok(!REGISTRATION_THRESHOLDS.find(row => row.id === 'eu-oss-place-of-supply-2021-07')?.countryCodes.includes('GB'));
  assert.equal(REGISTRATION_THRESHOLD_ACTIVITIES.length, 4);
});

test('registration rules require both country and an explicit activity fact and observe effective dates', () => {
  assert.deepEqual(matchingRules('GB', 'uk_vat_taxable_turnover', '2024-03-31').applied, []);
  assert.deepEqual(matchingRules('GB', 'uk_vat_taxable_turnover', '2024-04-01').applied.map(row => row.rule.id), ['uk-vat-registration-2024-04']);
  assert.deepEqual(matchingRules('FR', 'uk_vat_taxable_turnover', '2026-10-12').applied, []);
  assert.deepEqual(matchingRules('CA', 'ca_gst_taxable_supplies', '2026-10-12').applied.map(row => row.rule.id).sort(), [
    'ca-gst-small-supplier-four-quarters', 'ca-gst-small-supplier-single-quarter',
  ]);
  assert.deepEqual(matchingRules('DE', 'eu_oss_qualifying_b2c_supplies', '2026-10-12').applied.map(row => row.rule.id), ['eu-oss-place-of-supply-2021-07']);
  assert.deepEqual(matchingRules('GB', 'eu_oss_qualifying_b2c_supplies', '2026-10-12').applied, []);
  assert.deepEqual(matchingRules('IL', 'il_osek_patur_turnover', '2025-06-01').applied.map(row => row.rule.id), ['il-osek-patur-2025']);
});

test('posted-sales watch uses dated calendar windows, node aliases, FX base cents and excludes non-posted revenue', () => {
  const nodes = [entity('ILCO', 'Israel Entity'), activityNode('ILTURN', 'Israel osek patur qualifying turnover')];
  const transactions = [
    makeTransaction({ id: 'annual-sale', workspaceId: 'w', date: '2026-03-10', exchangeRate: 2, totalAmountCents: 500_000, lines: [{ accountId: 'sales', amountCents: -500_000, dimensions: { world: 'ILCO', activity: 'ILTURN' } }] }),
    sale('prior-year', '2025-12-31', -900_000, { world: 'ILCO', activity: 'ILTURN' }),
    sale('after-as-of', '2026-10-13', -900_000, { world: 'ILCO', activity: 'ILTURN' }),
    sale('draft', '2026-04-01', -900_000, { world: 'ILCO', activity: 'ILTURN' }, { status: 'draft' }),
    sale('void', '2026-04-02', -900_000, { world: 'ILCO', activity: 'ILTURN' }, { status: 'void' }),
    sale('forecast', '2026-04-03', -900_000, { world: 'ILCO', activity: 'ILTURN' }, { type: 'forecast' }),
    sale('reversed-sale', '2026-04-04', -900_000, { world: 'ILCO', activity: 'ILTURN' }),
    sale('reversal', '2026-04-05', 900_000, { world: 'ILCO', activity: 'ILTURN' }, { metadata: { reversesTxId: 'reversed-sale' } }),
    sale('transfer', '2026-04-06', -900_000, { world: 'ILCO', activity: 'ILTURN' }, { isTransfer: true }),
    makeTransaction({ id: 'expense-line', workspaceId: 'w', date: '2026-04-07', totalAmountCents: 100_000, lines: [{ accountId: 'expense', amountCents: -100_000, dimensions: { world: 'ILCO', activity: 'ILTURN' } }] }),
    sale('unknown-activity', '2026-04-08', -250_000, { world: 'ILCO', activity: 'consulting' }),
  ];
  const report = registrationThresholdWatch({
    accounts, transactions, profiles: israelProfiles, dimensionNodes: nodes,
    entityDimensionId: 'world', activityDimensionId: 'activity', asOf: '2026-10-12', baseCurrency: 'ILS',
  });
  const row = report.rows.find(candidate => candidate.rule.id === 'il-osek-patur-2026');
  assert.ok(row);
  assert.deepEqual([row.entityName, row.activityValue, row.periodStart, row.periodEnd], [
    'Israel Co', 'il_osek_patur_turnover', '2026-01-01', '2026-10-12',
  ]);
  assert.equal(row.salesCents, 1_000_000, 'stored transaction rate converts -500,000 cents to ₪10,000 of base-currency sales');
  assert.equal(row.thresholdCents, 12_283_300);
  assert.equal(row.progressPercent, 1_000_000 / 12_283_300 * 100);
  assert.equal(row.result, 'below');
  assert.equal(report.unclassifiedRevenueLineCount, 1);
  assert.equal(report.invalidSplitLineCount, 0);

  const mismatchedCurrency = registrationThresholdWatch({
    accounts, transactions: [transactions[0]], profiles: israelProfiles, dimensionNodes: nodes,
    entityDimensionId: 'world', activityDimensionId: 'activity', asOf: '2026-10-12', baseCurrency: 'USD',
  }).rows[0];
  assert.equal(mismatchedCurrency.result, 'currency-mismatch');
  assert.equal(mismatchedCurrency.progressPercent, null);
  assert.equal(mismatchedCurrency.remainingCents, null);
});

test('UK trailing window includes leap day and excludes the day before it when rolling back twelve months', () => {
  const nodes = [entity('UKCO', 'UK Entity'), activityNode('UKVAT', 'UK VAT taxable turnover')];
  const profiles = { labels: { 'world:UKCO': { place: { country: 'GB' } } } };
  const transactions = [
    sale('before-window', '2024-02-28', -8_000_000, { world: 'UKCO', activity: 'UKVAT' }),
    sale('leap-day', '2024-02-29', -500_000, { world: 'UKCO', activity: 'UKVAT' }),
    sale('as-of-day', '2025-02-28', -250_000, { world: 'UKCO', activity: 'UKVAT' }),
  ];
  const report = registrationThresholdWatch({
    accounts, transactions, profiles, dimensionNodes: nodes,
    entityDimensionId: 'world', activityDimensionId: 'activity', asOf: '2025-02-28', baseCurrency: 'GBP',
  });
  const row = report.rows.find(candidate => candidate.rule.id === 'uk-vat-registration-2024-04');
  assert.ok(row);
  assert.deepEqual([row.periodStart, row.periodEnd, row.salesCents], ['2024-02-29', '2025-02-28', 750_000]);
});

test('Canada shows the current and recent single-quarter tests plus the four latest completed quarters', () => {
  const nodes = [entity('CACO', 'Canada Entity'), activityNode('GST', 'Canada GST/HST taxable supplies')];
  const profiles = { labels: { 'world:CACO': { place: { country: 'CA' } } } };
  const transactions = [
    sale('q4-2025', '2025-10-10', -500_000, { world: 'CACO', activity: 'GST' }),
    sale('q1-2026', '2026-01-15', -700_000, { world: 'CACO', activity: 'GST' }),
    sale('q2-2026', '2026-04-15', -800_000, { world: 'CACO', activity: 'GST' }),
    sale('q3-2026', '2026-07-15', -900_000, { world: 'CACO', activity: 'GST' }),
    sale('q4-2026', '2026-10-01', -400_000, { world: 'CACO', activity: 'GST' }),
    sale('before-window', '2025-09-30', -9_000_000, { world: 'CACO', activity: 'GST' }),
    sale('future', '2026-10-13', -9_000_000, { world: 'CACO', activity: 'GST' }),
  ];
  const report = registrationThresholdWatch({
    accounts, transactions, profiles, dimensionNodes: nodes,
    entityDimensionId: 'world', activityDimensionId: 'activity', asOf: '2026-10-12', baseCurrency: 'CAD',
  });
  const quarters = report.rows.filter(row => row.rule.id === 'ca-gst-small-supplier-single-quarter');
  assert.equal(quarters.length, 5);
  assert.deepEqual(quarters.map(row => [row.periodLabel, row.salesCents]), [
    ['Q4 2025', 500_000], ['Q1 2026', 700_000], ['Q2 2026', 800_000], ['Q3 2026', 900_000], ['Q4 2026 to date', 400_000],
  ]);
  const fourQuarter = report.rows.find(row => row.rule.id === 'ca-gst-small-supplier-four-quarters');
  assert.ok(fourQuarter);
  assert.deepEqual([fourQuarter.periodStart, fourQuarter.periodEnd, fourQuarter.salesCents, fourQuarter.progressPercent], [
    '2025-10-01', '2026-09-30', 2_900_000, 2_900_000 / 3_000_000 * 100,
  ]);
  assert.equal(fourQuarter.result, 'below');
});

test('EU comparison keeps the €10,000 threshold supplier-wide across qualifying activity and both calendar years', () => {
  const nodes = [entity('DECO', 'German Entity'), activityNode('EUOSS', 'EU OSS qualifying B2C supplies')];
  const profiles = { labels: { 'world:DECO': { place: { country: 'DE' } } } };
  const transactions = [
    sale('last-year-a', '2025-06-30', -400_000, { world: 'DECO', activity: 'EUOSS' }),
    sale('last-year-b', '2025-12-31', -300_000, { world: 'DECO', activity: 'EUOSS' }),
    sale('this-year-a', '2026-03-15', -600_000, { world: 'DECO', activity: 'EUOSS' }),
    sale('this-year-b', '2026-06-30', -500_000, { world: 'DECO', activity: 'EUOSS' }),
    sale('future', '2026-10-13', -900_000, { world: 'DECO', activity: 'EUOSS' }),
  ];
  const rows = registrationThresholdWatch({
    accounts, transactions, profiles, dimensionNodes: nodes,
    entityDimensionId: 'world', activityDimensionId: 'activity', asOf: '2026-10-12', baseCurrency: 'EUR',
  }).rows;
  assert.deepEqual(rows.map(row => [row.periodLabel, row.salesCents, row.result]), [
    ['2025 calendar year (previous year)', 700_000, 'below'],
    ['2026 calendar year to date', 1_100_000, 'over'],
  ]);
  assert.ok(rows.every(row => row.rule.effect.kind === 'registration-threshold' && /not a generic sales|not a generic/i.test(row.rule.effect.note)));
});

test('weighted line splits allocate, rather than duplicate, posted revenue across entities', () => {
  const nodes = [entity('IL-A', 'Entity A'), entity('IL-B', 'Entity B')];
  const profiles = { labels: {
    'world:IL-A': { place: { country: 'IL' } },
    'world:IL-B': { place: { country: 'IL' } },
  } };
  const tx = makeTransaction({
    id: 'split-sale', workspaceId: 'w', date: '2026-05-01', totalAmountCents: 101,
    lines: [{ accountId: 'sales', amountCents: -101, splitAllocations: [
      { dimensions: { world: 'IL-A', activity: 'il_osek_patur_turnover' }, weight: 0.5 },
      { dimensions: { world: 'IL-B', activity: 'il_osek_patur_turnover' }, weight: 0.5 },
    ] }],
  });
  const report = registrationThresholdWatch({
    accounts, transactions: [tx], profiles, dimensionNodes: nodes,
    entityDimensionId: 'world', activityDimensionId: 'activity', asOf: '2026-10-12', baseCurrency: 'ILS',
  });
  assert.deepEqual(report.rows.map(row => [row.entityName, row.salesCents]), [['Entity A', 51], ['Entity B', 50]]);
  assert.equal(report.rows.reduce((sum, row) => sum + row.salesCents, 0), 101);
  assert.equal(report.invalidSplitLineCount, 0);
});

test('invalid split weights and missing jurisdiction facts are surfaced instead of treated as zero', () => {
  const nodes = [entity('UNKNOWN', 'Unknown country'), activityNode('ILTURN', 'IL osek patur turnover')];
  const tx = makeTransaction({
    id: 'bad-split', workspaceId: 'w', date: '2026-05-01', totalAmountCents: 1_000,
    lines: [{ accountId: 'sales', amountCents: -1_000, splitAllocations: [
      { dimensions: { world: 'UNKNOWN', activity: 'ILTURN' }, weight: 0.4 },
      { dimensions: { world: 'UNKNOWN', activity: 'ILTURN' }, weight: 0.4 },
    ] }],
  });
  const report = registrationThresholdWatch({
    accounts, transactions: [tx], dimensionNodes: nodes,
    entityDimensionId: 'world', activityDimensionId: 'activity', asOf: '2026-10-12', baseCurrency: 'ILS',
  });
  assert.equal(report.invalidSplitLineCount, 1);
  assert.equal(report.unclassifiedRevenueLineCount, 1);
  assert.deepEqual(report.rows, []);
  assert.deepEqual(report.entitiesMissingCountry, ['Unknown country']);
});
