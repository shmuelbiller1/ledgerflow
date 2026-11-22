import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CASES, RECEIPTS, gradeReceipt, mentions } from '../../scripts/eval/cases';
import { bookTool, profitAndLoss } from '../../scripts/eval/sampleBooks';
import { runCase } from '../../scripts/assistant-model-eval';

const byId = (id: string) => CASES.find(c => c.id === id)!;

test('SBX-2 Part 6 model test: the sample books answer from their own records', () => {
  assert.equal(profitAndLoss('2026-10', '2026-10').netProfitCents - profitAndLoss('2026-11', '2026-11').netProfitCents, 800_000);
  const found = bookTool('search_records', { text: 'INV-1001', collections: ['invoices'] }) as { matches: Array<{ id: string }> };
  assert.deepEqual(found.matches.map(m => m.id), ['inv_1001']);
  assert.deepEqual(bookTool('calculate', { expression: '1,250 * 117%' }), { expression: '1,250 * 117%', amount: 1462.5, cents: 146250 });
  assert.deepEqual(bookTool('explain_number', { accountIds: ['acc_office'], startDate: '2026-11-01', endDate: '2026-11-22' }),
    { startDate: '2026-11', endDate: '2026-11', totalCents: 280_000, lines: [{ accountId: 'acc_office', label: 'Office costs', cents: 280_000 }] });
  assert.ok('error' in (bookTool('calculate', { expression: 'process.exit()' }) as object), 'only arithmetic is evaluated');
});

test('SBX-2 Part 6 model test: graders pass the right outcome and fail a wrong one', () => {
  assert.ok(mentions('The drop is $8,000.', 800_000) && mentions('about 8k', 800_000) && !mentions('$18,000', 800_000));
  const pay = byId('payment').check;
  assert.ok(pay({ answer: '', calls: [{ name: 'propose_payment_receive', args: { amountCents: 50000, documentId: 'inv_1001' } }] }).pass);
  assert.ok(!pay({ answer: '', calls: [{ name: 'propose_payment_receive', args: { amountCents: 5000, documentId: 'inv_1001' } }] }).pass);
  assert.ok(!pay({ answer: '', calls: [{ name: 'propose_payment_receive', args: { amountCents: 500, documentId: 'inv_1001' } }] }).pass, '$5 is not $500');
  assert.ok(!pay({ answer: '', calls: [{ name: 'propose_payment_receive', args: { amountCents: 100, memo: 'see 50000', documentId: 'inv_1001' } }] }).pass, 'an unrelated field cannot supply the amount');
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

test('SBX-2 Part 6 model test: a failed turn is an error, and a timed-out turn stops spending', async () => {
  const failing: typeof fetch = async () => new Response('busy', { status: 503 });
  const failed = await runCase('https://model.test/v1', failing, 'm', 'sys', 'Fix the books.');
  assert.ok(failed.outcome.error, 'an endpoint error is not counted as finished');

  let calls = 0;
  // a slow endpoint that always asks for another tool: without the abort it would keep calling
  const slow: typeof fetch = async (_input, init) => {
    calls++;
    await new Promise((resolve, reject) => { const t = setTimeout(resolve, 40); init?.signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')); }); });
    return Response.json({ choices: [{ message: { content: null, tool_calls: [{ id: 'c', function: { name: 'calculate', arguments: '{"expression":"1+1"}' } }] } }], usage: {} });
  };
  const timedOut = await runCase('https://model.test/v1', slow, 'm', 'sys', 'Fix the books.', 60);
  assert.match(timedOut.outcome.error ?? '', /timed out/);
  const after = calls;
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(calls, after, 'no model calls after the case returned');
});

test('SBX-2 Part 6 model test: a drafted step can be listed and previewed, as the system prompt requires', async () => {
  const replies = [
    { tool_calls: [{ id: 'a', function: { name: 'propose_bill_create', arguments: '{"bill":{"vendorId":"ven_elec","totalCents":32000}}' } }] },
    { tool_calls: [{ id: 'b', function: { name: 'preview_proposal', arguments: '{"proposalId":"sbx_eval_proposal"}' } }] },
    { content: 'Drafted the bill for review.' },
  ];
  const seen: unknown[] = [];
  const endpoint: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }> };
    seen.push(body.messages.filter(m => m.role === 'tool').map(m => JSON.parse(m.content)));
    return Response.json({ choices: [{ message: { content: null, ...replies[seen.length - 1] } }], usage: {} });
  };
  const { outcome } = await runCase('https://model.test/v1', endpoint, 'm', 'sys', 'Make a bill from the electricity company for 320.');
  assert.equal(outcome.error, undefined);
  const preview = (seen[2] as Array<{ result?: { proposal?: { steps: Array<{ command: string }> } } }>).at(-1)?.result?.proposal;
  assert.equal(preview?.steps[0].command, 'bill.create');
});
