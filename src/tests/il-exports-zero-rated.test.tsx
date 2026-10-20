/**
 * An Israeli export is zero-rated (VAT Law s.30): a taxable sale at 0%, reported in the zero-rated box, with the input VAT
 * on its costs still deductible. Before this change the invoice's "Use no tax" took the workspace's exempt code first, so
 * an export landed in the exempt box. Every expected amount below is worked by hand in agorot.
 */
import './helpers/dom';
import test, { afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { resolveSellerProfile, type TaxProfiles } from '../lib/tax/profile';
import { resolveLineTax, taxChoiceFor } from '../lib/tax/resolveLineTax';
import { israelVatReturn, type IlVatDocument } from '../lib/tax/ilVatReturn';
import TaxExemptionNotice from '../components/sales/TaxExemptionNotice';
import { setComponentWorkspace } from './helpers/componentFixtures';

const DATE = '2026-04-14';
const profiles: TaxProfiles = {
  books: { name: 'Haifa Exports Ltd', place: { country: 'IL', city: 'Haifa' }, registrations: [{ kind: 'vat', number: '514000003', place: { country: 'IL' }, validFrom: '2020-01-01' }] },
  labels: { 'world:tx': { name: 'Austin LLC', place: { country: 'US', state: 'TX' }, registrations: [{ kind: 'sales_tax', number: '320001', place: { country: 'US', state: 'TX' } }] } },
};
const israel = resolveSellerProfile(profiles, {}, ['world']);
const texas = resolveSellerProfile(profiles, { world: 'tx' }, ['world']);
const codes = [
  { id: 'vat18', treatment: 'standard', components: [{ rate: 0.18 }] },
  { id: 'exempt', treatment: 'exempt', components: [] as Array<{ rate: number }> },
  { id: 'zero', treatment: 'zero_rated', components: [] as Array<{ rate: number }> },
];
const eff = (c: Array<{ rate: number }>) => c.reduce((s, x) => s + x.rate, 0);

test('an Israeli sale abroad is an export at the zero rate; a US seller\'s sale abroad is unchanged', () => {
  const germany = resolveLineTax({ seller: israel, buyer: { country: 'DE' }, date: DATE });
  assert.deepEqual([germany.reason, germany.rate, germany.treatment, germany.registration], ['export', 0, 'zero_rated', 'vat:IL:514000003']);
  const fromTexas = resolveLineTax({ seller: texas, buyer: { country: 'IL' }, date: DATE });
  assert.deepEqual([fromTexas.reason, fromTexas.treatment], ['export', undefined]);
  // the zero-rated code, not the exempt one that a bare 0 still picks
  assert.deepEqual(taxChoiceFor(0, codes, eff, germany.treatment), { taxCodeId: 'zero', taxRate: 0 });
  assert.deepEqual(taxChoiceFor(0, codes, eff), { taxCodeId: 'exempt', taxRate: 0 });
});

test('worked figures: a ₪20,000 export and a ₪1,000 + 18% purchase — zero-rated box, ₪180 back', () => {
  const germany = resolveLineTax({ seller: israel, buyer: { country: 'DE' }, date: DATE });
  const code = codes.find(c => c.id === taxChoiceFor(0, codes, eff, germany.treatment).taxCodeId)!;
  const exportInvoice: IlVatDocument = { id: 'INV-9', date: DATE, status: 'sent', taxVersion: 2, amountCents: 2_000_000, taxAmountCents: 0, taxTreatment: code.treatment as IlVatDocument['taxTreatment'] };
  // the cost of the export: ₪1,000 + 18% = ₪180 input VAT (18,000 agorot)
  const bill: IlVatDocument = { id: 'BILL-4', date: DATE, status: 'pending', taxVersion: 2, amountCents: 118_000, taxAmountCents: 18_000, taxTreatment: 'standard' };
  const r = israelVatReturn({ registration: 'vat:IL:514000003', profiles, order: ['world'], invoices: [exportInvoice], bills: [bill], startDate: '2026-04-01', endDate: '2026-04-30' });
  assert.deepEqual(
    [r.taxableSalesCents, r.outputVatCents, r.zeroRatedSalesCents, r.exemptSalesCents, r.otherInputVatCents, r.toPayCents],
    [0, 0, 2_000_000, 0, 18_000, -18_000],
  );
});

describe('exports on the invoice screen', () => {
  afterEach(() => cleanup());

  test('"Use no tax" takes the zero-rated code and the notice says why; on the exempt code it is offered again', async () => {
    const { useAuthStore } = await import('../stores/useAuthStore');
    const ws = setComponentWorkspace('owner');
    useAuthStore.setState({ workspaces: [{ ...ws, taxProfiles: profiles }] });
    const customer = { metadata: { taxPlace: { country: 'DE' } } };
    const used: Array<[number, string | undefined]> = [];
    render(<TaxExemptionNotice customer={customer} date={DATE} charging onNoTax={() => {}} currentRate={0.18} currentTreatment="standard" salesTreatments={['standard', 'exempt', 'zero_rated']} onUseRate={(r, t) => { used.push([r, t]); }} />);
    assert.match(screen.getByRole('status').textContent || '', /Haifa Exports Ltd: no tax: sold to another country\. An export is zero-rated \(VAT Law s\.30\)/);
    fireEvent.click(screen.getByRole('button', { name: 'Use no tax' }));
    cleanup();
    render(<TaxExemptionNotice customer={customer} date={DATE} charging={false} onNoTax={() => {}} currentRate={0} currentTreatment="exempt" salesTreatments={['standard', 'exempt', 'zero_rated']} onUseRate={(r, t) => { used.push([r, t]); }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Use no tax' }));
    assert.deepEqual(used, [[0, 'zero_rated'], [0, 'zero_rated']]);
    cleanup();
    render(<TaxExemptionNotice customer={customer} date={DATE} charging onNoTax={() => {}} currentRate={0.18} currentTreatment="standard" salesTreatments={['standard', 'exempt']} onUseRate={(r, t) => { used.push([r, t]); }} />);
    assert.match(screen.getByRole('status').textContent || '', /add a zero-rated sales tax code in Settings → Tax Manager/);
    assert.equal(screen.queryByRole('button', { name: 'Use no tax' }), null);
  });
});
