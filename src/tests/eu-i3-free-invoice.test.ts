/** EU-I3: the free invoice maker's totals, checks and the draft it hands to the sample company. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FREE_INVOICE_STORAGE_KEY, clearFreeInvoice, freeInvoiceProblem, freeInvoiceTotals, parseRate,
  readFreeInvoice, stashFreeInvoice, toInvoiceDraft, type FreeInvoice,
} from '../lib/freeInvoice';

const base: FreeInvoice = {
  from: 'Dana Design', to: 'Acme Ltd', number: '7', date: '2026-11-16', dueDate: '2026-11-30', currency: 'USD', taxRate: 17,
  lines: [{ description: 'Logo design', quantity: 2, rateCents: 12_050 }, { description: 'Business cards', quantity: 1, rateCents: 4_900 }],
};

test('EU-I3: 2 × 120.50 + 49.00 = 290.00; 17% tax 49.30; total 339.30', () => {
  assert.deepEqual(freeInvoiceTotals(base), { subtotal: 29_000, tax: 4_930, total: 33_930 });
  assert.deepEqual(freeInvoiceTotals({ ...base, taxRate: 0 }), { subtotal: 29_000, tax: 0, total: 29_000 });
  // 1.5 × 0.99 = 1.485 → 149 (whole cents); 7% of 1.49 = 0.1043 → 0.10
  assert.deepEqual(freeInvoiceTotals({ lines: [{ description: 'x', quantity: 1.5, rateCents: 99 }], taxRate: 7 }), { subtotal: 149, tax: 10, total: 159 });
});

test('EU-I3: prices are read in the chosen currency', () => {
  assert.equal(parseRate('120.50', 'USD'), 12_050);
  assert.equal(parseRate('1,200', 'USD'), 120_000);
  assert.equal(parseRate('12.345', 'USD'), null);
  assert.equal(parseRate('abc', 'USD'), null);
  assert.equal(parseRate('', 'USD'), 0);
});

test('EU-I3: what stops an invoice from being saved', () => {
  assert.equal(freeInvoiceProblem(base), null);
  assert.equal(freeInvoiceProblem({ ...base, to: ' ' }), 'Add who the invoice is for.');
  assert.equal(freeInvoiceProblem({ ...base, dueDate: '2026-11-01' }), 'The due date is before the invoice date.');
  assert.equal(freeInvoiceProblem({ ...base, lines: [{ description: '', quantity: 1, rateCents: 0 }] }), 'Add at least one line.');
  assert.equal(freeInvoiceProblem({ ...base, lines: [{ description: '', quantity: 1, rateCents: 500 }] }), 'Every line needs a description.');
  assert.equal(freeInvoiceProblem({ ...base, lines: [{ description: 'x', quantity: 0, rateCents: 500 }] }), 'Every line needs a quantity above zero.');
});

test('EU-I3: the hand-off is a draft with the same lines and total', () => {
  assert.deepEqual(toInvoiceDraft(base), {
    customerName: 'Acme Ltd', number: '7', date: '2026-11-16', dueDate: '2026-11-30', currency: 'USD', status: 'draft',
    taxRate: 17, amountCents: 33_930,
    items: [
      { id: 'free-1', description: 'Logo design', quantity: 2, rateCents: 12_050, amountCents: 24_100, accountId: '' },
      { id: 'free-2', description: 'Business cards', quantity: 1, rateCents: 4_900, amountCents: 4_900, accountId: '' },
    ],
    metadata: { source: 'free-invoice-maker', from: 'Dana Design' },
  });
});

test('EU-I3: the draft travels once through browser storage, and other data is ignored', () => {
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  assert.equal(stashFreeInvoice(storage, base), true);
  assert.equal(readFreeInvoice(storage)?.customerName, 'Acme Ltd');
  assert.equal(readFreeInvoice(storage)?.customerName, 'Acme Ltd', 'reading does not clear it');
  clearFreeInvoice(storage);
  assert.equal(readFreeInvoice(storage), null);
  store.set(FREE_INVOICE_STORAGE_KEY, JSON.stringify({ customerName: 'x' }));
  assert.equal(readFreeInvoice(storage), null, 'only a draft from the maker is opened');
  store.set(FREE_INVOICE_STORAGE_KEY, '{not json');
  assert.equal(readFreeInvoice(storage), null);
  const blocked = { setItem: () => { throw new Error('QuotaExceeded'); } };
  assert.equal(stashFreeInvoice(blocked, base), false);
});

test('EU-I3: the rate is handed over as a fraction, so 1% and below keep their meaning', () => {
  assert.equal(toInvoiceDraft({ ...base, taxRate: 1 }).taxRate, 0.01);
  assert.equal(toInvoiceDraft({ ...base, taxRate: 0.5 }).taxRate, 0.005);
  assert.equal(toInvoiceDraft({ ...base, taxRate: 250 }).taxRate, 100, 'capped at 100% like the maker\'s own total');
  assert.equal(toInvoiceDraft({ ...base, taxRate: 1.5 }).taxRate, 1.5);
  assert.equal(toInvoiceDraft({ ...base, taxRate: 0 }).taxRate, 0);
});
