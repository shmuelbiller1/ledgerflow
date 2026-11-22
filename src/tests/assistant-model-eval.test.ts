import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CASES, RECEIPTS, gradeReceipt, mentions } from '../../scripts/eval/cases';
import { bookTool, profitAndLoss } from '../../scripts/eval/sampleBooks';

const byId = (id: string) => CASES.find(c => c.id === id)!;

test('SBX-2 Part 6 model test: the sample books answer from their own records', () => {
  assert.equal(profitAndLoss('2026-10', '2026-10').netProfitCents - profitAndLoss('2026-11', '2026-11').netProfitCents, 800_000);
  const found = bookTool('search_records', { text: 'INV-1001', collections: ['invoices'] }) as { matches: Array<{ id: string }> };
  assert.deepEqual(found.matches.map(m => m.id), ['inv_1001']);
  assert.deepEqual(bookTool('calculate', { expression: '1,250 * 117%' }), { expression: '1,250 * 117%', amount: 1462.5, cents: 146250 });
  assert.ok('error' in (bookTool('calculate', { expression: 'process.exit()' }) as object), 'only arithmetic is evaluated');
});

test('SBX-2 Part 6 model test: graders pass the right outcome and fail a wrong one', () => {
  assert.ok(mentions('The drop is $8,000.', 800_000) && mentions('about 8k', 800_000) && !mentions('$18,000', 800_000));
  const pay = byId('payment').check;
  assert.ok(pay({ answer: '', calls: [{ name: 'propose_payment_receive', args: { amountCents: 50000, documentId: 'inv_1001' } }] }).pass);
  assert.ok(!pay({ answer: '', calls: [{ name: 'propose_payment_receive', args: { amountCents: 5000, documentId: 'inv_1001' } }] }).pass);
  assert.ok(byId('fix-books').check({ answer: 'What should I look at?', calls: [] }).pass);
  assert.ok(!byId('fix-books').check({ answer: 'Done?', calls: [{ name: 'propose_journal_create', args: {} }] }).pass, 'never draft on a vague request');
  assert.ok(byId('chase').check({ answer: 'Beta first, then Acme.', calls: [{ name: 'run_report', args: {} }] }).pass);
  assert.ok(!byId('chase').check({ answer: 'Acme first, then Beta.', calls: [{ name: 'run_report', args: {} }] }).pass);
  assert.ok(byId('profit-drop').check({ answer: 'Profit fell by $8,000, mainly lower sales.', calls: [] }).pass);
});

test('SBX-2 Part 6 model test: every receipt adds up and is graded field by field', () => {
  for (const r of RECEIPTS) {
    const lines = r.lines.reduce((s, l) => s + l[1], 0);
    assert.equal(Math.round(('taxIncluded' in r ? lines : lines + r.tax) * 100), Math.round(r.total * 100), r.id);
  }
  const r = RECEIPTS[1];
  assert.equal(gradeReceipt(r, { vendor: 'City Electric Co', date: r.date, total: '$320.00', tax: 23.7 }).score, 4);
  assert.equal(gradeReceipt(r, null).score, 0);
});
