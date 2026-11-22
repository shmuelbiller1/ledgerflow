import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CASES, RECEIPTS, gradeReceipt, mentions, recommended } from '../../scripts/eval/cases';
import { bookTool, profitAndLoss } from '../../scripts/eval/sampleBooks';
import { meteredFetch, runCase } from '../../scripts/assistant-model-eval';
import { stepCommand } from '../server/commands/sandboxStepCommands';

const byId = (id: string) => CASES.find(c => c.id === id)!;

test('SBX-2 Part 6 model test: the sample books answer from their own records', () => {
  assert.equal(profitAndLoss('2026-10', '2026-10').netProfitCents - profitAndLoss('2026-11', '2026-11').netProfitCents, 800_000);
  const found = bookTool('search_records', { text: 'INV-1001', collections: ['invoices'] }) as { matches: Array<{ id: string }> };
  assert.deepEqual(found.matches.map(m => m.id), ['inv_1001']);
  assert.deepEqual(bookTool('calculate', { expression: '1,250 * 117%' }), { expression: '1,250 * 117%', amount: 1462.5, cents: 146250 });
  assert.deepEqual(bookTool('explain_number', { accountIds: ['acc_office'], startDate: '2026-11-01', endDate: '2026-11-22' }),
    { startDate: '2026-11', endDate: '2026-11', totalCents: 280_000, lines: [{ accountId: 'acc_office', label: 'Office costs', cents: 280_000 }] });
  assert.ok('error' in (bookTool('calculate', { expression: 'process.exit()' }) as object), 'only arithmetic is evaluated');
  assert.equal((bookTool('calculate', { expression: '(1250 - 250) * 2 / 4 + -5' }) as { amount: number }).amount, 495);
  assert.ok('error' in (bookTool('calculate', { expression: '2 +' }) as object));
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
    // a complete bill (the command's own published example, so it passes the input schema)
    { tool_calls: [{ id: 'a', function: { name: 'propose_bill_create', arguments: JSON.stringify(stepCommand('bill.create').describe.example) } }] },
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

test('SBX-2 Part 6 model test: the chase check reads the recommendation, not the first name mentioned', () => {
  assert.equal(recommended('Acme has 1,232 overdue, while Beta has 4,500 overdue. Chase Beta first.'), 'beta');
  assert.equal(recommended('Beta owes more, but I would start with Acme.'), 'acme');
  assert.equal(recommended('Beta should be your priority; Acme can wait.'), 'beta');
  assert.equal(recommended('Acme and Beta both owe money.'), null);
  assert.ok(byId('chase').check({ answer: 'Acme has 1,232 overdue, while Beta has 4,500 overdue. Chase Beta first.', calls: [{ name: 'run_report', args: {} }] }).pass);
  assert.ok(!byId('chase').check({ answer: 'Beta owes more, but I would start with Acme.', calls: [{ name: 'run_report', args: {} }] }).pass);
});

test('SBX-2 Part 6 model test: list filters and the chartAccounts collection work like the real tools', () => {
  const acme = bookTool('list_records', { collection: 'invoices', where: [{ field: 'customerId', op: '==', value: 'cus_acme' }] }) as { records: Array<{ customerId: string }> };
  assert.ok(acme.records.length > 0 && acme.records.every(r => r.customerId === 'cus_acme'));
  const open = bookTool('list_records', { collection: 'invoices', where: [{ field: 'status', op: 'in', value: ['open', 'overdue'] }] }) as { records: Array<{ status: string }> };
  assert.ok(open.records.every(r => r.status !== 'paid'));
  assert.ok((bookTool('list_records', { collection: 'chartAccounts' }) as { records: unknown[] }).records.length > 0);
});

test('SBX-2 Part 6 model test: a missing billed cost is counted as missing, not as zero', async () => {
  const spend = { usd: 0, calls: 0, priced: 0 };
  const replies = [{ usage: { cost: 0.002 } }, { usage: {} }, 'not json'];
  let n = 0;
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => { const r = replies[n++]; return typeof r === 'string' ? new Response(r) : Response.json(r); }) as typeof fetch;
  try {
    const f = meteredFetch(spend, { calls: 0 }, 10);
    for (let i = 0; i < 3; i++) await f('https://model.test/v1/chat/completions');
  } finally { globalThis.fetch = orig; }
  assert.deepEqual(spend, { usd: 0.002, calls: 3, priced: 1 });
});

test('SBX-2 Part 6 model test: numeric sort, structured recurrence, and only valid drafts count', async () => {
  const top = bookTool('list_records', { collection: 'invoices', orderBy: { field: 'totalCents', direction: 'desc' }, limit: 1 }) as { records: Array<{ number: string }> };
  assert.equal(top.records[0].number, 'INV-1003', '450,000 cents sorts above 95,000');
  const rec = byId('recurring').check;
  assert.ok(!rec({ answer: '', calls: [{ name: 'propose_invoice_create', args: { invoice: { customerId: 'cus_beta', totalCents: 100000, description: 'monthly services' } } }] }).pass, 'the word "monthly" is not a recurrence');
  assert.ok(rec({ answer: '', calls: [{ name: 'propose_invoice_create', args: { invoice: { customerId: 'cus_beta', totalCents: 100000, type: 'recurring', recurringInterval: 'monthly' } } }] }).pass);
  assert.ok(!byId('bill').check({ answer: '', calls: [{ name: 'propose_bill_create', ok: false, args: { bill: { vendorId: 'ven_elec', totalCents: 32000 } } }] }).pass, 'a refused draft does not count');

  // the runner refuses an invalid proposal and returns the schema's error to the model
  const replies = [
    { tool_calls: [{ id: 'a', function: { name: 'propose_payment_receive', arguments: '{"amountCents":50000,"documentId":"inv_1001"}' } }] },
    { content: 'Done.' },
  ];
  let n = 0; let toolReply = '';
  const endpoint: typeof fetch = async (_input, init) => {
    const msgs = (JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }> }).messages;
    toolReply = msgs.filter(m => m.role === 'tool').map(m => m.content).join('');
    return Response.json({ choices: [{ message: { content: null, ...replies[n++] } }], usage: {} });
  };
  const { outcome } = await runCase('https://model.test/v1', endpoint, 'm', 'sys', 'Record a payment of 500 from Acme Ltd for INV-1001.');
  assert.equal(outcome.calls[0].ok, false);
  assert.match(toolReply, /Invalid input/);
  assert.ok(!byId('payment').check(outcome).pass);
});

test('SBX-2 Part 6 model test: aging side, ask_books account scope, and exact invoice quantity', () => {
  const ap = bookTool('run_report', { report: 'aging', params: { type: 'ap' } }) as { type: string; total: number };
  assert.deepEqual([ap.type, ap.total], ['ap', 95_000]);
  assert.equal((bookTool('run_report', { report: 'aging', params: { type: 'ar' } }) as { type: string }).type, 'ar');
  const office = bookTool('ask_books', { question: 'How much did I spend on office costs last month?' }) as { answer: { totalCents: number } };
  assert.equal(office.answer.totalCents, 180_000);
  assert.ok((bookTool('ask_books', { question: 'Tell me something interesting' }) as { problem?: string }).problem, 'unreadable questions are refused');
  const inv = byId('invoice').check;
  const draft = (quantity: number) => ({ answer: '', calls: [{ name: 'propose_invoice_create', args: { invoice: { customerId: 'cus_acme', items: [{ description: 'Consulting', quantity, unitPriceCents: 15000 }] } } }] });
  assert.ok(inv(draft(2)).pass);
  assert.ok(!inv(draft(2.5)).pass, '2.5 hours is not two hours');
});

test('SBX-2 Part 6 model test: a report the books do not have is refused, not replaced', () => {
  assert.ok('error' in (bookTool('run_report', { report: 'cash-flow' }) as object));
  assert.equal((bookTool('run_report', { report: 'profit-and-loss' }) as { report: string }).report, 'profit-and-loss');
});
