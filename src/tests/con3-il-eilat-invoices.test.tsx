/**
 * CON-3: Israel's special VAT areas (Eilat) on invoices. The Eilat Free Trade Zone Law, 1985, s.5:
 *  - a sale into Eilat by a dealer from outside the area is at the zero rate: a taxable sale at 0%,
 *    reported as zero-rated, and the seller keeps its input VAT;
 *  - a sale by a dealer resident in Eilat, for use there, is exempt: no VAT and no input credit,
 *    reported as exempt;
 *  - the same seller selling to the rest of Israel charges the ordinary 18% (from 1 Jan 2025).
 * Every expected amount below is worked by hand in agorot; none comes from another production helper.
 */
import './helpers/dom';
import test, { afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { resolveSellerProfile, type TaxProfiles, type TaxRegistration } from '../lib/tax/profile';
import { resolveLineTax, taxChoiceFor } from '../lib/tax/resolveLineTax';
import { israelVatReturn, type IlVatDocument } from '../lib/tax/ilVatReturn';
import TaxExemptionNotice from '../components/sales/TaxExemptionNotice';
import { setComponentWorkspace } from './helpers/componentFixtures';

const DATE = '2026-03-10';
const telAvivVat: TaxRegistration = { kind: 'vat', number: '514000001', place: { country: 'IL' }, validFrom: '2020-01-01' };
const eilatVat: TaxRegistration = { kind: 'vat', number: '514000002', place: { country: 'IL' }, validFrom: '2020-01-01' };
const profiles: TaxProfiles = {
  books: { name: 'Tel Aviv Ltd', place: { country: 'IL', city: 'Tel Aviv' }, registrations: [telAvivVat] },
  labels: { 'world:eilat': { name: 'Eilat Ltd', place: { country: 'IL', city: 'אילת' }, registrations: [eilatVat] } },
};
const telAviv = resolveSellerProfile(profiles, {}, ['world']);
const eilat = resolveSellerProfile(profiles, { world: 'eilat' }, ['world']);

// the workspace's sales codes, as taxCodeFromRate gives them
const codes = [
  { id: 'vat18', treatment: 'standard', components: [{ rate: 0.18 }] },
  { id: 'exempt', treatment: 'exempt', components: [] as Array<{ rate: number }> },
  { id: 'zero', treatment: 'zero_rated', components: [] as Array<{ rate: number }> },
];
const eff = (c: Array<{ rate: number }>) => c.reduce((s, x) => s + x.rate, 0);

test('CON-3: a sale into Eilat from Tel Aviv is zero-rated, whichever way the place is written', () => {
  for (const buyer of [{ country: 'IL', city: 'Eilat' }, { country: 'IL', city: 'אילת' }, { country: 'IL', district: 'EILAT' }, { country: 'IL', city: ' eilat ' }]) {
    const tax = resolveLineTax({ seller: telAviv, buyer, date: DATE });
    assert.deepEqual([tax.reason, tax.rate, tax.treatment, tax.registration], ['zero-area', 0, 'zero_rated', 'vat:IL:514000001'], JSON.stringify(buyer));
  }
  // before CON-3 only district === 'Eilat' was recognised: a Hebrew city was charged 18%
  assert.equal(resolveLineTax({ seller: telAviv, buyer: { country: 'IL', city: 'אילת' }, date: DATE }).rate, 0);
});

test('CON-3: an Eilat dealer selling in Eilat is exempt; selling to Haifa it charges 18%', () => {
  const local = resolveLineTax({ seller: eilat, buyer: { country: 'IL', city: 'Eilat' }, date: DATE });
  assert.deepEqual([local.reason, local.rate, local.treatment, local.registration], ['exempt-area', 0, 'exempt', 'vat:IL:514000002']);
  // the relief depends on facts the books do not hold: the answer names them and the ordinary rate (#234 review)
  assert.match(local.conditions || '', /supplied and used in Eilat/);
  assert.equal(local.ordinaryRate, 0.18);
  const into = resolveLineTax({ seller: telAviv, buyer: { country: 'IL', city: 'Eilat' }, date: DATE });
  assert.match(into.conditions || '', /goods sold to a dealer resident in Eilat.*services, sales to private buyers/);
  assert.equal(into.ordinaryRate, 0.18);
  const haifa = resolveLineTax({ seller: eilat, buyer: { country: 'IL', city: 'Haifa' }, date: DATE });
  assert.equal(haifa.conditions, undefined, 'an ordinary sale has no conditions');
  assert.deepEqual([haifa.reason, haifa.rate, haifa.treatment], ['taxed', 0.18, undefined]);
  // the other special areas are export areas: zero-rated even from Eilat
  const westBank = resolveLineTax({ seller: eilat, buyer: { country: 'IL', district: 'יהודה ושומרון' }, date: DATE });
  assert.deepEqual([westBank.reason, westBank.treatment], ['zero-area', 'zero_rated']);
});

test('CON-3: the invoice takes the code of exactly that treatment, never the other 0% one', () => {
  assert.deepEqual(taxChoiceFor(0, codes, eff, 'zero_rated'), { taxCodeId: 'zero', taxRate: 0 });
  assert.deepEqual(taxChoiceFor(0, codes, eff, 'exempt'), { taxCodeId: 'exempt', taxRate: 0 });
  // without a zero-rated code the exempt one is not substituted: it would drop the input credit
  assert.deepEqual(taxChoiceFor(0, codes.filter(c => c.id !== 'zero'), eff, 'zero_rated'), { taxCodeId: undefined, taxRate: 0, missing: 'zero_rated' });
  // no treatment: the old choice stands (an exempt code for 0)
  assert.deepEqual(taxChoiceFor(0, codes, eff), { taxCodeId: 'exempt', taxRate: 0 });
  // a positive rate never takes a non-taxing code, even one whose parts add to that rate (#239 review)
  assert.deepEqual(taxChoiceFor(0.18, [{ id: 'odd-exempt', treatment: 'exempt', components: [{ rate: 0.18 }] }, ...codes], eff), { taxCodeId: 'vat18', taxRate: 0 });
  assert.deepEqual(taxChoiceFor(0.18, [{ id: 'odd-exempt', treatment: 'exempt', components: [{ rate: 0.18 }] }], eff), { taxCodeId: undefined, taxRate: 18 });
});

test('CON-3 worked figures: three ₪10,000 invoices reach the VAT report in the boxes the law puts them', () => {
  const invoice = (id: string, netAgorot: number, treatment: 'standard' | 'zero_rated' | 'exempt', dimensions?: Record<string, string>): IlVatDocument => {
    // the invoice screen: the resolver's treatment → the code → the saved taxTreatment
    const choice = codes.find(c => c.treatment === treatment)!;
    const vatAgorot = Math.round(netAgorot * eff(choice.components));
    return { id, date: DATE, status: 'sent', taxVersion: 2, amountCents: netAgorot + vatAgorot, taxAmountCents: vatAgorot, taxTreatment: choice.treatment as IlVatDocument['taxTreatment'], ...(dimensions ? { dimensions } : {}) };
  };
  const into = resolveLineTax({ seller: telAviv, buyer: { country: 'IL', city: 'אילת' }, date: DATE });
  const haifa = resolveLineTax({ seller: telAviv, buyer: { country: 'IL', city: 'Haifa' }, date: DATE });
  const local = resolveLineTax({ seller: eilat, buyer: { country: 'IL', city: 'Eilat' }, date: DATE });
  const docs = [
    invoice('INV-1', 1_000_000, into.treatment!),                        // ₪10,000 into Eilat: zero-rated, VAT ₪0
    invoice('INV-2', 1_000_000, haifa.treatment ?? 'standard'),          // ₪10,000 to Haifa: VAT 18% = ₪1,800 = 180,000 agorot
    invoice('INV-3', 1_000_000, local.treatment!, { world: 'eilat' }), // ₪10,000 in Eilat by the Eilat dealer: exempt
  ];
  assert.deepEqual(docs.map(d => [d.amountCents, d.taxAmountCents]), [[1_000_000, 0], [1_180_000, 180_000], [1_000_000, 0]]);

  const base = { profiles, order: ['world'], invoices: docs, bills: [], startDate: '2026-03-01', endDate: '2026-03-31' };
  const telAvivReturn = israelVatReturn({ ...base, registration: 'vat:IL:514000001' });
  assert.deepEqual(
    [telAvivReturn.taxableSalesCents, telAvivReturn.outputVatCents, telAvivReturn.zeroRatedSalesCents, telAvivReturn.exemptSalesCents, telAvivReturn.toPayCents],
    [1_000_000, 180_000, 1_000_000, 0, 180_000],
  );
  const eilatReturn = israelVatReturn({ ...base, registration: 'vat:IL:514000002' });
  assert.deepEqual(
    [eilatReturn.taxableSalesCents, eilatReturn.outputVatCents, eilatReturn.zeroRatedSalesCents, eilatReturn.exemptSalesCents, eilatReturn.toPayCents],
    [0, 0, 0, 1_000_000, 0],
  );
});

describe('CON-3 on the invoice screen', () => {
  afterEach(() => cleanup());

  test('a Tel Aviv invoice to an Eilat customer states when the zero rate applies; the user chooses, 18% stays offered', async () => {
    const { useAuthStore } = await import('../stores/useAuthStore');
    const ws = setComponentWorkspace('owner');
    useAuthStore.setState({ workspaces: [{ ...ws, taxProfiles: profiles }] });
    const customer = { metadata: { taxPlace: { country: 'IL', city: 'אילת' } } };
    const used: Array<[number, string | undefined]> = [];
    render(<TaxExemptionNotice customer={customer} date={DATE} charging onNoTax={() => {}} currentRate={0.18} currentTreatment="standard" salesTreatments={['standard', 'exempt', 'zero_rated']} onUseRate={(r, t) => { used.push([r, t]); }} />);
    const text = screen.getByRole('status').textContent || '';
    assert.match(text, /Tel Aviv Ltd: a special VAT area: the sale can be zero-rated only when goods sold to a dealer resident in Eilat for its business there \(Eilat Free Trade Zone Law, s\.5\); services, sales to private buyers and goods on the law's excluded list are taxed at the ordinary rate\. Otherwise VAT is 18%\./);
    assert.doesNotMatch(text, /expected tax/, 'the relief is never presented as the expected tax');
    assert.equal(screen.queryByRole('button', { name: 'Use 18%' }), null, 'already at 18%');
    fireEvent.click(screen.getByRole('button', { name: 'It qualifies: use zero-rated' }));
    assert.deepEqual(used, [[0, 'zero_rated']]);
    cleanup();

    // already 0% on the exempt code: both choices are offered — the right relief code, or the ordinary 18% (a service, a private buyer)
    render(<TaxExemptionNotice customer={customer} date={DATE} charging={false} onNoTax={() => {}} currentRate={0} currentTreatment="exempt" salesTreatments={['standard', 'exempt', 'zero_rated']} onUseRate={(r, t) => { used.push([r, t]); }} />);
    fireEvent.click(screen.getByRole('button', { name: 'It qualifies: use zero-rated' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use 18%' }));
    assert.deepEqual(used, [[0, 'zero_rated'], [0, 'zero_rated'], [0.18, undefined]]);
    cleanup();

    render(<TaxExemptionNotice customer={customer} date={DATE} charging onNoTax={() => {}} currentRate={0.18} currentTreatment="standard" salesTreatments={['standard', 'exempt']} onUseRate={(r, t) => { used.push([r, t]); }} />);
    assert.match(screen.getByRole('status').textContent || '', /add a zero-rated sales tax code in Settings → Tax Manager/);
    assert.equal(screen.queryByRole('button', { name: /qualifies/ }), null);
  });

  test('the Eilat entity selling in Eilat: exempt only on conditions, and the input VAT is flagged for review, not promised', async () => {
    const { useAuthStore } = await import('../stores/useAuthStore');
    const ws = setComponentWorkspace('owner');
    useAuthStore.setState({ workspaces: [{ ...ws, taxProfiles: profiles }] });
    const used: Array<[number, string | undefined]> = [];
    render(<TaxExemptionNotice customer={{ metadata: { taxPlace: { country: 'IL', city: 'Eilat' } } }} date={DATE} charging onNoTax={() => {}} lineLabels={{ world: 'eilat' }} currentRate={0.18} currentTreatment="standard" salesTreatments={['standard', 'exempt', 'zero_rated']} onUseRate={(r, t) => { used.push([r, t]); }} />);
    const text = screen.getByRole('status').textContent || '';
    assert.match(text, /Eilat Ltd: Eilat dealer selling in Eilat: the sale can be exempt only when the seller is a dealer resident in Eilat and the goods or services are supplied and used in Eilat \(Eilat Free Trade Zone Law, s\.5\)/);
    assert.match(text, /input VAT on purchases for it is not deductible; the VAT report does not split those purchases out, so review them/);
    assert.doesNotMatch(text, /no input credit/);
    fireEvent.click(screen.getByRole('button', { name: 'It qualifies: use exempt' }));
    assert.deepEqual(used, [[0, 'exempt']]);
  });

  test('review (#237, #239): 44px actions; "Use 18%" offered while the current code does not tax, even if its parts add to 18%', async () => {
    const { useAuthStore } = await import('../stores/useAuthStore');
    const ws = setComponentWorkspace('owner');
    useAuthStore.setState({ workspaces: [{ ...ws, taxProfiles: profiles }] });
    const used: Array<[number, string | undefined]> = [];
    // an exempt code whose parts say 18%: the invoice charges nothing, so 18% is still the ordinary choice
    render(<TaxExemptionNotice customer={{ metadata: { taxPlace: { country: 'IL', city: 'Eilat' } } }} date={DATE} charging={false} onNoTax={() => {}} currentRate={0.18} currentTreatment="exempt" salesTreatments={['standard', 'exempt', 'zero_rated']} onUseRate={(r, t) => { used.push([r, t]); }} />);
    for (const name of ['It qualifies: use zero-rated', 'Use 18%']) assert.match(screen.getByRole('button', { name }).className, /\bmin-h-11\b/, name);
    fireEvent.click(screen.getByRole('button', { name: 'Use 18%' }));
    assert.deepEqual(used, [[0.18, undefined]]);
  });
});
