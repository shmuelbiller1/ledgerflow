/**
 * DIM-1 (W2 worked figures): a payment recorded on its own (Record payment → applied to invoices/bills)
 * carries the paid documents' labels in proportion, so each label's part of the entry balances.
 *
 * Figures by hand:
 *  INV-1: lines 6,000.00 Tel Aviv + 4,000.00 Haifa (+ 1,700.00 tax) = 11,700.00 → paid in full:
 *    bank +7,020.00 Tel Aviv, +4,680.00 Haifa; receivable −7,020.00 Tel Aviv, −4,680.00 Haifa (60 / 40).
 *  The same invoice paid with 15,000.00 (3,300.00 not applied): the 3,300.00 stays unlabelled on both sides.
 *  BILL-1: lines 3,000.00 Property A + 1,000.00 Property B, paid 4,000.00 → bank −3,000.00 A, −1,000.00 B;
 *    payable +3,000.00 A, +1,000.00 B.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPaymentAtomic, documentLabelWeights } from '../server/services/paymentService';

type Doc = Record<string, unknown>;
type Line = { accountId: string; amountCents: number; dimensions?: Record<string, string> };

/** A one-transaction in-memory database: enough for createPaymentAtomic without FX or withholding. */
function memoryDb(seed: Record<string, Doc>) {
  const data = new Map(Object.entries(seed));
  let n = 0;
  return {
    data,
    collection: (name: string) => ({
      doc: (id?: string) => ({ id: id || `${name}-${++n}`, key: `${name}/${id || `${name}-${n}`}` }),
      where: () => ({ query: name }),
    }),
    runTransaction: async <T>(fn: (tx: unknown) => Promise<T>) => {
      const staged = new Map([...data].map(([k, v]) => [k, structuredClone(v)]));
      const tx = {
        get: async (ref: { key?: string; query?: string }) => ref.query
          ? { docs: [...staged].filter(([k]) => k.startsWith(`${ref.query}/`)).map(([k, v]) => ({ id: k.split('/')[1], data: () => structuredClone(v) })) }
          : { exists: staged.has(ref.key!), data: () => structuredClone(staged.get(ref.key!)) },
        set: (ref: { key: string }, v: Doc) => { staged.set(ref.key, v); },
        update: (ref: { key: string }, v: Doc) => { staged.set(ref.key, { ...staged.get(ref.key), ...v }); },
      };
      const out = await fn(tx);
      for (const [k, v] of staged) data.set(k, v);
      return out;
    },
  };
}

const seed = (): Record<string, Doc> => ({
  'workspaces/ws': { id: 'ws', uid: 'u', currency: 'USD' },
  'chartAccounts/bank': { id: 'bank', name: 'Bank', workspaceId: 'ws' },
  'chartAccounts/ar': { id: 'ar', name: 'Accounts Receivable', workspaceId: 'ws' },
  'chartAccounts/ap': { id: 'ap', name: 'Accounts Payable', workspaceId: 'ws' },
  'invoices/inv1': {
    id: 'inv1', workspaceId: 'ws', number: 'INV-1', status: 'sent', amountCents: 1_170_000, totalCents: 1_170_000, amountPaidCents: 0,
    items: [{ amountCents: 600_000, dimensions: { location: 'Tel Aviv' } }, { amountCents: 400_000, dimensions: { location: 'Haifa' } }],
  },
  'bills/bill1': {
    id: 'bill1', workspaceId: 'ws', number: 'BILL-1', status: 'open', amountCents: 400_000, totalCents: 400_000, amountPaidCents: 0,
    splits: [{ amountCents: 300_000, dimensions: { property: 'A' } }, { amountCents: 100_000, dimensions: { property: 'B' } }],
  },
});

const by = (lines: Line[], account: string, key: string, value?: string) =>
  lines.filter(l => l.accountId === account && l.dimensions?.[key] === value).reduce((s, l) => s + l.amountCents, 0);
const sliceOf = (lines: Line[], key: string, value?: string) =>
  lines.filter(l => l.dimensions?.[key] === value).reduce((s, l) => s + l.amountCents, 0);

test('DIM-1: an invoice paid in full by a payment record carries its lines\' labels 60/40', async () => {
  const db = memoryDb(seed());
  const { ledgerTransaction } = await createPaymentAtomic(db, {
    workspaceId: 'ws', uid: 'u', paymentDate: '2026-10-21', amountCents: 1_170_000, cashAccountId: 'bank', offsetAccountId: 'ar',
    customerId: 'c1', allocations: [{ documentId: 'inv1', documentType: 'invoice', amountCents: 1_170_000 }],
  });
  const lines = ledgerTransaction.lines as Line[];
  assert.equal(lines.reduce((s, l) => s + l.amountCents, 0), 0, 'the entry balances');
  assert.ok(lines.every(l => l.dimensions?.location), 'every line has a location');
  assert.deepEqual([by(lines, 'bank', 'location', 'Tel Aviv'), by(lines, 'bank', 'location', 'Haifa')], [702_000, 468_000]);
  assert.deepEqual([by(lines, 'ar', 'location', 'Tel Aviv'), by(lines, 'ar', 'location', 'Haifa')], [-702_000, -468_000]);
  for (const place of ['Tel Aviv', 'Haifa']) assert.equal(sliceOf(lines, 'location', place), 0, `${place} balances on its own`);
});

test('DIM-1: the part of a payment not applied to a document stays unlabelled', async () => {
  const db = memoryDb(seed());
  const { ledgerTransaction } = await createPaymentAtomic(db, {
    workspaceId: 'ws', uid: 'u', paymentDate: '2026-10-21', amountCents: 1_500_000, cashAccountId: 'bank', offsetAccountId: 'ar',
    customerId: 'c1', allocations: [{ documentId: 'inv1', documentType: 'invoice', amountCents: 1_170_000 }],
  });
  const lines = ledgerTransaction.lines as Line[];
  assert.equal(lines.reduce((s, l) => s + l.amountCents, 0), 0);
  assert.deepEqual([by(lines, 'bank', 'location', 'Tel Aviv'), by(lines, 'bank', 'location', 'Haifa'), by(lines, 'bank', 'location', undefined)], [702_000, 468_000, 330_000]);
  for (const place of ['Tel Aviv', 'Haifa', undefined]) assert.equal(sliceOf(lines, 'location', place), 0, `${place ?? 'unlabelled'} balances`);
});

test('DIM-1: a bill paid by a payment record carries its splits\' labels', async () => {
  const db = memoryDb(seed());
  const { ledgerTransaction } = await createPaymentAtomic(db, {
    workspaceId: 'ws', uid: 'u', paymentDate: '2026-10-21', amountCents: 400_000, cashAccountId: 'bank', offsetAccountId: 'ap',
    vendorId: 'v1', allocations: [{ documentId: 'bill1', documentType: 'bill', amountCents: 400_000 }],
  });
  const lines = ledgerTransaction.lines as Line[];
  assert.deepEqual([by(lines, 'bank', 'property', 'A'), by(lines, 'bank', 'property', 'B')], [-300_000, -100_000]);
  assert.deepEqual([by(lines, 'ap', 'property', 'A'), by(lines, 'ap', 'property', 'B')], [300_000, 100_000]);
  for (const p of ['A', 'B']) assert.equal(sliceOf(lines, 'property', p), 0);
});

test('DIM-1: a document without labels gives an unlabelled payment (no change)', () => {
  assert.deepEqual(documentLabelWeights({ items: [{ amountCents: 500 }] }, 'invoice', 500), [{ cents: 500 }]);
  assert.deepEqual(documentLabelWeights({}, 'bill', 700), [{ cents: 700 }]);
  // part of a document: 1,000.00 of the 10,000.00 lines, 60/40
  assert.deepEqual(documentLabelWeights(seed()['invoices/inv1'], 'invoice', 100_000).map(w => w.cents), [60_000, 40_000]);
});
