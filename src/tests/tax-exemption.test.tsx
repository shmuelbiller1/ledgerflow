/**
 * Customer tax exemption certificates (T-05): kept on the customer; an invoice for them says they
 * are exempt and offers to charge no tax, or says their certificate ran out.
 */
import './helpers/dom';
import test, { afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { exemptionOn, taxExemptionOf } from '../lib/taxExemption';
import PartyModal, { type PartyFields } from '../components/common/PartyModal';
import TaxExemptionNotice from '../components/sales/TaxExemptionNotice';
import { setComponentWorkspace } from './helpers/componentFixtures';

const charity = { name: 'Food Bank', metadata: { taxExemption: { number: 'EX-77', expires: '2026-12-31' } } };

describe('Tax exemption certificates', () => {
  afterEach(() => cleanup());

  test('a certificate is good through its last day; none without a number; a bad date is ignored', () => {
    assert.equal(exemptionOn(charity, '2026-12-31')?.state, 'exempt');
    assert.equal(exemptionOn(charity, '2027-01-01')?.state, 'expired');
    assert.equal(exemptionOn({ metadata: { taxExemption: { number: ' ' } } }, '2026-10-11'), null);
    assert.equal(exemptionOn(null, '2026-10-11'), null);
    assert.deepEqual(taxExemptionOf({ metadata: { taxExemption: { number: ' EX-1 ', expires: 'soon' } } }), { number: 'EX-1' });
  });

  test('the customer form keeps the certificate and takes it away', () => {
    setComponentWorkspace('owner');
    const saved: PartyFields[] = [];
    render(<PartyModal side="customer" isOpen initial={{ id: 'c1', name: 'Food Bank', metadata: { memo: 'keep' } }} onClose={() => {}} onSave={p => { saved.push(p); }} />);
    fireEvent.change(screen.getByLabelText('Tax exemption certificate'), { target: { value: 'EX-77' } });
    fireEvent.change(screen.getByLabelText('Certificate good until'), { target: { value: '2026-12-31' } });
    fireEvent.submit(screen.getByLabelText('Customer Name').closest('form')!);
    assert.deepEqual(saved[0].metadata, { memo: 'keep', taxExemption: { number: 'EX-77', expires: '2026-12-31' } });
    cleanup();
    render(<PartyModal side="customer" isOpen initial={{ id: 'c1', name: 'Food Bank', metadata: saved[0].metadata }} onClose={() => {}} onSave={p => { saved.push(p); }} />);
    fireEvent.change(screen.getByLabelText('Tax exemption certificate'), { target: { value: '' } });
    fireEvent.submit(screen.getByLabelText('Customer Name').closest('form')!);
    assert.deepEqual(saved[1].metadata, { memo: 'keep', taxExemption: null }, 'null marks the saved certificate for deletion on the server');
    cleanup();
    render(<PartyModal side="vendor" isOpen initial={null} onClose={() => {}} onSave={() => {}} />);
    assert.equal(screen.queryByLabelText('Tax exemption certificate'), null);
  });

  test('on the invoice: exempt with a "Charge no tax" button while tax is charged; a certificate that ran out says so', () => {
    let noTax = 0;
    render(<TaxExemptionNotice customer={charity} date="2026-10-11" charging onNoTax={() => { noTax++; }} />);
    assert.match(screen.getByRole('status').textContent || '', /certificate EX-77, good until 2026-12-31/);
    fireEvent.click(screen.getByRole('button', { name: 'Charge no tax' }));
    assert.equal(noTax, 1);
    cleanup();
    render(<TaxExemptionNotice customer={charity} date="2026-10-11" charging={false} onNoTax={() => {}} />);
    assert.equal(screen.queryByRole('button'), null);
    cleanup();
    render(<TaxExemptionNotice customer={charity} date="2027-02-01" charging onNoTax={() => {}} />);
    assert.match(screen.getByRole('status').textContent || '', /ran out on 2026-12-31/);
  });
});

describe('Expected tax from the selling entity and the customer\'s place (PLAN §6)', () => {
  afterEach(() => cleanup());

  test('a customer in Haifa: 18%, with a button while the invoice charges 17%; a customer abroad: no tax', async () => {
    const { useAuthStore } = await import('../stores/useAuthStore');
    const ws = setComponentWorkspace('owner');
    useAuthStore.setState({ workspaces: [{ ...ws, taxProfiles: { books: { name: 'Acme Ltd', place: { country: 'IL' }, registrations: [{ kind: 'vat', number: '514000000', place: { country: 'IL' } }] } } }] });
    const used: number[] = [];
    render(<TaxExemptionNotice customer={{ metadata: { taxPlace: { country: 'IL', city: 'Haifa' } } }} date="2026-10-11" charging onNoTax={() => {}} currentRate={0.17} onUseRate={r => { used.push(r); }} />);
    assert.match(screen.getByRole('status').textContent || '', /Acme Ltd: expected tax 18%/);
    fireEvent.click(screen.getByRole('button', { name: 'Use 18%' }));
    assert.deepEqual(used, [0.18]);
    cleanup();
    render(<TaxExemptionNotice customer={{ metadata: { taxPlace: { country: 'DE' } } }} date="2026-10-11" charging onNoTax={() => {}} currentRate={0.18} onUseRate={r => { used.push(r); }} />);
    assert.match(screen.getByRole('status').textContent || '', /sold to another country/);
    fireEvent.click(screen.getByRole('button', { name: 'Use no tax' }));
    assert.deepEqual(used, [0.18, 0]);
  });

  test('the customer form keeps their tax place', () => {
    setComponentWorkspace('owner');
    const saved: PartyFields[] = [];
    render(<PartyModal side="customer" isOpen initial={{ id: 'c1', name: 'Bolt Inc' }} onClose={() => {}} onSave={p => { saved.push(p); }} />);
    fireEvent.change(screen.getByLabelText('Tax country'), { target: { value: 'us' } });
    fireEvent.change(screen.getByLabelText('Tax state'), { target: { value: 'tx' } });
    fireEvent.change(screen.getByLabelText('Tax city'), { target: { value: 'Austin' } });
    fireEvent.submit(screen.getByLabelText('Customer Name').closest('form')!);
    assert.deepEqual(saved[0].metadata, { taxPlace: { country: 'US', state: 'TX', city: 'Austin' } });
  });
});
