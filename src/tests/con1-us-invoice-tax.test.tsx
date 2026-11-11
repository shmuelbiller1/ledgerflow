/**
 * CON-1: the US state sales-tax table (137) and item taxability (139) on the invoice. One invoice carries one tax
 * rate, so the suggestion gives one rate when every line is taxed alike, "mixed" when they differ, and "confirm" when
 * the state table leaves a line's category unclear. TX, CA, NY, WA and CO are checked; other states say "not
 * verified"; the answer says whether local rates are included. Rates are worked by hand from the state tables.
 */
import './helpers/dom';
import test, { afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { resolveSellerProfile, type TaxProfiles } from '../lib/tax/profile';
import { ruleRateTable } from '../lib/tax/ruleRateTable';
import { isSupportedUsState, lineTaxCategory, usInvoiceTax, US_SUPPORTED_STATES } from '../lib/tax/usInvoiceTax';
import TaxExemptionNotice from '../components/sales/TaxExemptionNotice';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { BRAND_NAME } from '../config/brand';

const DATE = '2026-08-10';
const profiles: TaxProfiles = {
  books: { name: 'Austin Goods LLC', place: { country: 'US', state: 'TX' }, registrations: [
    { kind: 'sales_tax', number: '320001', place: { country: 'US', state: 'TX' } },
    { kind: 'sales_tax', number: 'CA-1', place: { country: 'US', state: 'CA' } },
    { kind: 'sales_tax', number: 'IL-1', place: { country: 'US', state: 'IL' } },
  ] },
};
const seller = resolveSellerProfile(profiles, {}, ['world']);
const packs = ruleRateTable();
const austin = { country: 'US', state: 'TX', city: 'Austin' };
const ask = (lineCategories: Array<string | null | undefined>, buyer = austin, extra: Partial<Parameters<typeof usInvoiceTax>[0]> = {}) =>
  usInvoiceTax({ seller, buyer, date: DATE, lineCategories, fallback: packs, ...extra });

test('CON-1: the supported states are exactly TX, CA, NY, WA and CO', () => {
  assert.deepEqual([...US_SUPPORTED_STATES], ['TX', 'CA', 'NY', 'WA', 'CO']);
  assert.equal(isSupportedUsState('tx'), true);
  assert.equal(isSupportedUsState('IL'), false);
});

test('CON-1 worked figures: Texas general goods — 6.25% state rate, local rates not included; $1,000 → $62.50', () => {
  const answer = ask(['general', '']);
  assert.equal(answer?.kind, 'rate');
  if (answer?.kind !== 'rate') return;
  assert.deepEqual([answer.rate, answer.state, answer.verified, answer.localIncluded, answer.categories], [0.0625, 'TX', true, false, ['general']]);
  // $1,000.00 = 100,000 cents × 6.25% = 6,250 cents
  assert.equal(Math.round(100_000 * answer.rate), 6_250);
});

test('CON-1: with Austin\'s local rows loaded the answer says local rates are included (6.25% + 2% = 8.25%)', () => {
  const tables = { 'US-TX': (_place: unknown, _date: string, category?: string) => category === 'groceries'
    ? [{ level: 'state' as const, name: 'TX groceries', rate: 0 }]
    : [{ level: 'state' as const, name: 'Texas', rate: 0.0625 }, { level: 'city' as const, name: 'Austin', rate: 0.02 }] };
  const answer = ask(['general'], austin, { tables });
  assert.deepEqual(answer?.kind === 'rate' && [answer.rate, answer.localIncluded], [0.0825, true]);
  // $1,000.00 → 8,250 cents
  assert.equal(Math.round(100_000 * 0.0825), 8_250);
});

test('CON-1: groceries alone are not taxed in Texas; groceries with general goods are "mixed"', () => {
  const groceries = ask(['groceries', 'groceries']);
  assert.deepEqual(groceries?.kind === 'rate' && [groceries.rate, groceries.categories], [0, ['groceries']]);
  const mixed = ask(['groceries', 'general', null]);
  assert.equal(mixed?.kind, 'mixed');
  if (mixed?.kind !== 'mixed') return;
  assert.deepEqual(mixed.groups.map(g => [g.category, g.rate, g.lines]), [['groceries', 0, 1], ['general', 0.0625, 2]]);
  assert.equal(mixed.linesWithoutItem, 1, 'the free-text line is counted as general goods, and said so');
});

test('CON-1: a category the Texas table leaves unclear (services) or an unknown one asks a person', () => {
  const services = ask(['services', 'general']);
  assert.deepEqual(services?.kind === 'confirm' && [services.unclear, services.unknown], [['services'], []]);
  const unknown = ask(['furniture']);
  assert.deepEqual(unknown?.kind === 'confirm' && [unknown.unclear, unknown.unknown], [[], ['furniture']]);
});

test('CON-1: California SaaS is exempt; Illinois is answered but "not verified"; no permit → no tax', () => {
  const saas = ask(['saas'], { country: 'US', state: 'CA', city: 'San Jose' });
  assert.deepEqual(saas?.kind === 'rate' && [saas.rate, saas.verified], [0, true]);
  const illinois = ask(['general'], { country: 'US', state: 'IL', city: 'Chicago' });
  assert.deepEqual(illinois?.kind === 'rate' && [illinois.rate, illinois.verified], [0.0625, false]);
  assert.deepEqual(ask(['general'], { country: 'US', state: 'NY', city: 'Albany' }), { kind: 'none', reason: 'not-registered' });
  assert.equal(usInvoiceTax({ seller: resolveSellerProfile({ books: { place: { country: 'IL' } } }, {}, []), date: DATE, lineCategories: [] }), undefined, 'not a US seller');
});

test('CON-1: a line\'s category comes from its linked item, else the item whose name it carries; a service item counts as Services', () => {
  const items = [
    { id: 'i1', name: 'Rice 5kg', productTaxCategory: 'groceries' },
    { id: 'i2', name: 'Installation', itemType: 'service' },
    { id: 'i3', name: 'Chair', sku: 'CH-1' },
  ];
  assert.equal(lineTaxCategory({ itemId: 'i1' }, items), 'groceries');
  assert.equal(lineTaxCategory({ description: 'Installation' }, items), 'services', 'a service item stays unlinked on the line');
  assert.equal(lineTaxCategory({ description: 'CH-1' }, items), '', 'an item with no category: general goods');
  assert.equal(lineTaxCategory({ description: 'Custom work' }, items), null, 'free text: no item');
});

test('CON-1 review: a taxability row must be in force on the invoice date — before the table starts, a person decides', () => {
  // the 2026 table starts on 1 Jan 2026: a 31 Dec 2025 grocery invoice is not "taxable at 6.25%" by default
  const before = usInvoiceTax({ seller, buyer: austin, date: '2025-12-31', lineCategories: ['groceries'], fallback: packs });
  assert.deepEqual(before?.kind === 'confirm' && [before.unclear, before.unloaded], [['groceries'], 0]);
  assert.equal(ask(['groceries'])?.kind, 'rate', 'on 10 Aug 2026 the row is in force');
});

test('CON-1 review: a line whose item is not loaded is unknown, never general goods', () => {
  const answer = ask([undefined, 'groceries']);
  assert.deepEqual(answer?.kind === 'confirm' && [answer.unloaded, answer.unclear, answer.unknown], [1, [], []]);
  const items = [{ id: 'i1', name: 'Rice 5kg', productTaxCategory: 'groceries' }];
  assert.equal(lineTaxCategory({ itemId: 'gone' }, items), undefined, 'linked to an item that is not in the list');
  assert.equal(lineTaxCategory({ description: 'Installation' }, items, false), undefined, 'the list is still loading or capped');
  assert.equal(lineTaxCategory({ description: 'Installation' }, items, true), null, 'the whole list is loaded: free text');
});

describe('CON-1 on the invoice screen', () => {
  afterEach(() => cleanup());

  const mount = async (lineCategories: Array<string | null | undefined>, customerPlace = austin, currentRate = 0) => {
    const { useAuthStore } = await import('../stores/useAuthStore');
    const ws = setComponentWorkspace('owner');
    useAuthStore.setState({ workspaces: [{ ...ws, taxProfiles: profiles }] });
    const used: number[] = [];
    render(<TaxExemptionNotice customer={{ metadata: { taxPlace: customerPlace } }} date={DATE} charging={currentRate > 0} onNoTax={() => {}} lineCategories={lineCategories} currentRate={currentRate} onUseRate={r => { used.push(r); }} />);
    return { used, text: screen.getByRole('status').textContent || '' };
  };

  test('one rate: the state rate, what it leaves out, and a button', async () => {
    const { used, text } = await mount(['general']);
    assert.match(text, /Austin Goods LLC: expected sales tax 6\.25% \(Texas state sales tax 6\.25%\)\. This is the TX state rate only: city, county and district rates are not included/);
    assert.doesNotMatch(text, /Not verified/);
    fireEvent.click(screen.getByRole('button', { name: 'Use 6.25%' }));
    assert.deepEqual(used, [0.0625]);
  });

  test('mixed lines: no single rate is offered', async () => {
    const { text } = await mount(['groceries', 'general']);
    assert.match(text, /the lines are taxed differently in TX \(mixed\): Groceries \(food at home\) 0%, General goods 6\.25%\. One invoice carries one tax rate/);
    assert.equal(screen.queryByRole('button'), null);
  });

  test('unclear category: confirm with the state', async () => {
    const { text } = await mount(['services']);
    assert.match(text, new RegExp(String.raw`whether Services is taxed in TX is not settled in ${BRAND_NAME}'s table: confirm with the state and choose the tax yourself`));
    assert.equal(screen.queryByRole('button'), null);
  });

  test('review: a 0% state answer still says city, county and district taxes are not included', async () => {
    const { text } = await mount(['groceries'], { country: 'US', state: 'CA', city: 'San Jose' }, 0.0725);
    assert.match(text, /no state sales tax: Groceries \(food at home\) is not taxed by CA\. City, county and district taxes are not included, and some places tax what the state does not/);
    assert.match(screen.getByRole('button', { name: 'Use no tax' }).className, /\bmin-h-11\b/);
  });

  test('review: an item not loaded yet: no rate is suggested', async () => {
    const { text } = await mount([undefined, 'general']);
    assert.match(text, /1 line\(s\) have an item that is not loaded yet, so its tax category is not known: confirm with the state and choose the tax yourself/);
    assert.equal(screen.queryByRole('button'), null);
  });

  test('another state: answered, labelled not verified', async () => {
    const { text } = await mount(['general'], { country: 'US', state: 'IL', city: 'Chicago' }, 0.0625);
    assert.match(text, new RegExp(String.raw`Not verified: ${BRAND_NAME} has checked the state tables of TX, CA, NY, WA, CO only\.`));
    assert.equal(screen.queryByRole('button'), null, 'already at 6.25%');
  });
});
