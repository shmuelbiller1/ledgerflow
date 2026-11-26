import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { CASES, type Outcome, RECEIPTS, gradeReceipt, mentions, recommended, whatHappened } from '../../scripts/eval/cases';
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
  assert.ok((bookTool('ask_books', { question: 'Tell me something interesting' }) as { reading: { problem?: string } }).reading.problem, 'unreadable questions are refused');
  const inv = byId('invoice').check;
  const draft = (quantity: number) => ({ answer: '', calls: [{ name: 'propose_invoice_create', args: { invoice: { customerId: 'cus_acme', items: [{ description: 'Consulting', quantity, unitPriceCents: 15000 }] } } }] });
  assert.ok(inv(draft(2)).pass);
  assert.ok(!inv(draft(2.5)).pass, '2.5 hours is not two hours');
});

test('SBX-2 Part 6 model test: a report the books do not have is refused, not replaced', () => {
  assert.ok('error' in (bookTool('run_report', { report: 'cash-flow' }) as object));
  assert.equal((bookTool('run_report', { report: 'profit-and-loss' }) as { report: string }).report, 'profit-and-loss');
});

test('SBX-2 Part 6 model test: a fair question about missing details passes, and the report says what happened', () => {
  assert.ok(byId('payment').check({ answer: 'Which account received the $500, Cash or Bank?', calls: [] }).pass);
  assert.ok(!byId('payment').check({ answer: 'Done.', calls: [] }).pass);
  assert.ok(!byId('payment').check({ answer: 'I recorded the payment in Bank. Anything else?', calls: [] }).pass, 'a completion claim plus an unrelated question');
  assert.ok(!byId('bill').check({ answer: 'I created the bill, due next week. Anything else?', calls: [] }).pass);
  assert.ok(byId('payment').check({ answer: 'Nothing has been done yet. Which account received the $500, Cash or Bank?', calls: [] }).pass, 'a negated statement is not a claim');
  assert.ok(byId('bill').check({ answer: "I haven't created the bill yet. What is the bill number?", calls: [] }).pass);
  const unrelated = [{ name: 'propose_journal_create', args: {} }];
  assert.ok(!byId('payment').check({ answer: 'Which account received the money?', calls: unrelated }).pass, 'an unrelated draft plus the right question');
  assert.ok(!byId('bill').check({ answer: 'What is the bill number?', calls: unrelated }).pass);
  assert.ok(byId('bill').check({ answer: 'What is the bill number and due date?', calls: [] }).pass);
  const seen = whatHappened({ answer: 'I could not draft it.', calls: [{ name: 'propose_bill_create', args: {}, ok: false, refusal: 'bill.date: Required' }] });
  assert.match(seen, /draft refused 1× \(propose_bill_create: bill.date: Required\)/);
  assert.match(seen, /answered: "I could not draft it."/);
});

test('SBX-2 Part 6 model test: a polite request with a list counts as asking (real Terra replies)', () => {
  const pay = 'I found **INV-1001** for Acme Ltd. Before I draft the payment, please confirm:\n- The payment date\n- Whether it was received into **Bank** or **Cash**';
  assert.ok(byId('payment').check({ answer: pay, calls: [] }).pass);
  const inv = 'I found Acme Ltd’s customer record. To prepare the invoice draft for two hours of consulting, please provide:\n- The hourly rate and currency';
  assert.ok(byId('invoice').check({ answer: inv, calls: [] }).pass);
  const bill = 'I found **City Electric Co** in your vendors. Is that the right company? To draft the bill, please provide the bill date, due date, currency';
  assert.ok(byId('bill').check({ answer: bill, calls: [] }).pass);
  // a request for something else does not count
  assert.ok(!byId('payment').check({ answer: 'Payment noted. Please let me know if you need anything else.', calls: [] }).pass);
  // a real Luna reply: "recorded cents" describes a field, it is not a claim that the payment was recorded
  const luna = 'I found INV-1001 for Acme Ltd, with 1,200.00 outstanding in the invoice’s recorded cents (120,000 cents). Before I draft the payment, please confirm:\n\n- Is the payment **500.00** in your books’ currency?\n- What date was it received?\n- Which account received it: **Cash** or **Bank**?';
  assert.ok(byId('payment').check({ answer: luna, calls: [] }).pass);
  assert.ok(!byId('payment').check({ answer: 'I have recorded the payment. Was it to Bank or Cash?', calls: [] }).pass);
  assert.ok(!byId('payment').check({ answer: 'Payment recorded successfully. Which account received it, Cash or Bank?', calls: [] }).pass);
  // a real Luna reply (23 Nov 04:28): "saved as a draft" is part of the request, not a claim that it was saved
  const lunaInvoice = 'I found **Acme Ltd** (customer record `cus_acme`). To draft the invoice, please provide:\n\n- The consulting rate per hour\n- The invoice date\n- Whether you want it saved as a **draft** or issued (sent) invoice';
  assert.ok(byId('invoice').check({ answer: lunaInvoice, calls: [] }).pass);
  assert.ok(!byId('invoice').check({ answer: 'Invoice saved. Please provide the hourly rate.', calls: [] }).pass);
  assert.ok(!byId('invoice').check({ answer: 'Let me know the hourly rate; I\'ve saved it as a draft.', calls: [] }).pass);
  assert.ok(!byId('invoice').check({ answer: 'Please confirm the hourly rate:\n- Invoice saved as INV-001', calls: [] }).pass);
  assert.ok(!byId('invoice').check({ answer: 'Please provide the hourly rate; I created the invoice as INV-001.', calls: [] }).pass);
  assert.ok(!byId('invoice').check({ answer: 'Please provide the hourly rate. We recorded it already.', calls: [] }).pass);
  // a negated or descriptive line inside a request is not a claim
  assert.ok(byId('invoice').check({ answer: 'Please confirm the hourly rate; I have not saved anything yet.', calls: [] }).pass);
  assert.ok(byId('invoice').check({ answer: 'Please provide:\n- The hourly rate\n- No invoice created yet', calls: [] }).pass);
  assert.ok(byId('invoice').check({ answer: 'Please provide:\n- The hourly rate\n- Amount recorded on the timesheet', calls: [] }).pass);
  // a generic closing offer is not a clarifying question
  for (const id of ['fix-books', 'move-project', 'recurring']) assert.ok(!byId(id).check({ answer: 'Please let me know if you need anything else.', calls: [] }).pass, id);
  // a later statement announcing a guess does not supply the detail the request asked for
  assert.ok(!byId('bill').check({ answer: 'Please confirm the supplier. I will use the current date.', calls: [] }).pass);
});

test('SBX-2 Part 6: the test books use the real question reader (src/lib/askBooks.ts)', () => {
  const ask = (question: string) => bookTool('ask_books', { question }) as { answer: { lines?: Array<{ account: string; cents: number }> } | null; reading: { problem?: string; understood?: { period: string } } };
  // "October 2026" is that month (a real Luna question got the whole year before)
  const october = ask('What were Office costs in October 2026?');
  assert.match(String(october.reading.understood?.period), /2026-10-01/);
  assert.deepEqual(october.answer?.lines?.map(l => [l.account, l.cents]), [['Office costs', 180000]]);
  // whole words: "current" is not the Rent account
  assert.deepEqual(ask('What is the current Cash balance?').answer?.lines?.map(l => l.account), ['Cash']);
  // the same reading as the site, exclusions included: the real reader does not read "excluding", so neither does the test
  assert.deepEqual(ask('Office costs excluding Rent in October 2026').answer?.lines?.map(l => l.account).sort(), ['Office costs', 'Rent']);
});

test('routed model evaluation uses the live tier choice and code answers', async () => {
  const requested: string[] = [];
  const fake: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { model: string };
    requested.push(body.model);
    return Response.json({ choices: [{ message: { content: 'Here is the answer.' } }], usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.001 } });
  };
  const routed = { simple: 'gpt-6-luna', strong: 'gpt-6.1-terra' };
  const run = (question: string) => runCase('https://model.test/v1', fake, routed.simple, 'sys', question, 5000, routed);

  const vague = await run('Something looks wrong.');
  assert.deepEqual(requested.splice(0), [routed.strong]);
  assert.equal(vague.metric?.modelTier, 'strong');
  assert.equal(vague.metric?.modelReason, 'ambiguous');

  const simple = await run('Record a payment of 500 from Acme Ltd for INV-1001.');
  assert.deepEqual(requested.splice(0), [routed.simple]);
  assert.equal(simple.metric?.modelTier, 'simple');
  assert.equal(simple.metric?.modelReason, 'simple');

  const code = await run('How much do customers owe me?');
  assert.deepEqual(requested, []);
  assert.equal(code.metric?.path, 'code');
  assert.equal(code.metric?.costCents, 0);
  assert.match(code.outcome.answer, /Customers owe you/);
});

test('routed model evaluation reuses the live simple failure retry', async () => {
  const requested: string[] = [];
  const fake: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { model: string };
    requested.push(body.model);
    if (requested.length === 1) return new Response('unavailable', { status: 503 });
    return Response.json({ choices: [{ message: { content: 'Which account received the payment?' } }], usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.001 } });
  };
  const routed = { simple: 'gpt-6-luna', strong: 'gpt-6.1-terra' };
  const result = await runCase('https://model.test/v1', fake, routed.simple, 'sys', 'Record a payment of 500 from Acme Ltd for INV-1001.', 5000, routed);
  assert.deepEqual(requested, [routed.simple, routed.strong]);
  assert.equal(result.metric?.modelTier, 'strong');
  assert.equal(result.metric?.modelReason, 'simple-model-failed');
  assert.equal(result.metric?.modelCalls, 2);
  assert.equal(result.outcome.error, undefined);
});

test('routed evaluation does not retry after a proposal was attempted', async () => {
  const requested: string[] = [];
  const fake: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { model: string };
    requested.push(body.model);
    if (requested.length === 1) return Response.json({ choices: [{ message: { tool_calls: [{ id: 'a', function: { name: 'propose_payment_receive', arguments: '{}' } }] } }], usage: {} });
    return new Response('unavailable', { status: 503 });
  };
  const routed = { simple: 'gpt-6-luna', strong: 'gpt-6.1-terra' };
  const result = await runCase('https://model.test/v1', fake, routed.simple, 'sys', 'Record a payment of 500 from Acme Ltd for INV-1001.', 5000, routed);
  assert.deepEqual(requested, [routed.simple, routed.simple]);
  assert.equal(result.metric?.modelTier, 'simple');
  assert.ok(result.outcome.error);
});

test('routed code answers use the live ask_books result shape and figures', async () => {
  let calls = 0;
  const fake: typeof fetch = async () => { calls++; throw new Error('unexpected model call'); };
  const routed = { simple: 'gpt-6-luna', strong: 'gpt-6.1-terra' };
  const run = (q: string) => runCase('https://model.test/v1', fake, routed.simple, 'sys', q, 5000, routed);
  const sales = await run('What were my sales last month?');
  assert.equal(sales.metric?.path, 'code');
  assert.match(sales.outcome.answer, /46,000\.00/);
  const cash = await run('What is my cash balance?');
  assert.equal(cash.metric?.path, 'code');
  assert.match(cash.outcome.answer, /12,345\.00/);
  assert.equal(calls, 0);
});

test('the routed CLI writes tier, reason, billed cost and tier shares', async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'ledgerflow-eval-'));
  await mkdir(resolve(dir, 'docs'));
  const server = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: 'What should I check?' } }], usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.001 } }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    const env = { ...process.env, ASSISTANT_EVAL_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
      ASSISTANT_EVAL_ROUTED: 'gpt-6-luna,gpt-6.1-terra', ASSISTANT_EVAL_MODELS: '', ASSISTANT_EVAL_OCR_MODELS: '',
      ASSISTANT_EVAL_REPEATS: '1', ASSISTANT_EVAL_PROMPTS: resolve('assistant/SYSTEM_PROMPT.md') };
    const child = spawn(resolve('node_modules/.bin/tsx'), [resolve('scripts/assistant-model-eval.ts'), '--write'], { cwd: dir, env });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const status = await new Promise<number | null>((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
    assert.equal(status, 0, stderr);
    assert.match(stdout, /\| routed \(luna -> terra\) \|/);
    assert.match(stdout, /final tier share \(simple \/ strong \/ code\)/);
    const folder = resolve(dir, 'docs/eval/runs');
    const [file] = await readdir(folder);
    const saved = JSON.parse(await readFile(resolve(folder, file), 'utf8')) as { turns: Array<{ tier: string; reason: string; billedCents: number; metric: { modelCalls: number } }> };
    assert.equal(saved.turns.length, CASES.length);
    assert.ok(saved.turns.some(t => t.tier === 'simple'));
    assert.ok(saved.turns.some(t => t.tier === 'strong'));
    assert.ok(saved.turns.every(t => t.reason && t.billedCents === 0.1 && t.metric.modelCalls === 1));
    assert.match(stdout, /2\.10¢/);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});

test('grader: correct clarifications in other wording pass (25 Nov Luna run), wrong ones still fail', () => {
  const o = (answer: string, calls: Outcome['calls'] = []): Outcome => ({ answer, calls });
  const payment = byId('payment'), recurring = byId('recurring'), markPaid = byId('mark-paid');
  // Luna's real answers, marked wrong before
  assert.equal(payment.check(o('I found Acme Ltd’s **INV-1001** (invoice `inv_1001`), marked overdue and unpaid. To draft a **USD 500.00** payment against it, I need:\n\n- The payment date\n- The cash account to receive it: **Cash** or **Bank**\n')).pass, true);
  assert.equal(recurring.check(o('I found **Beta Corp** (`cus_beta`, billing@beta.example). I can set up the monthly amount as **USD 1,000.00**, but I need:\n\n- The **start date** for the recurring invoice\n- The **invoice line description** (what the charge is for)\n')).pass, true);
  assert.equal(markPaid.check(o('I found **INV-1003** for **Beta Corp**: it’s overdue, with **USD 4,500.00** outstanding.\n\nDo you mean that Beta Corp has actually paid it? If so, tell me the **payment date** and the **cash/bank account** to record it against. I’ll draft the payment for your review.')).pass, true);
  // still failing: a claim of having done it, asking nothing, or asking only an unrelated detail
  assert.equal(payment.check(o('I recorded the payment of 500 to the Bank account.')).pass, false);
  assert.equal(payment.check(o('INV-1001 is overdue and unpaid. It is for 1,200.00.')).pass, false);
  assert.equal(payment.check(o('I need:\n- The payment date\n')).pass, false, 'asks only the date, not which account');
  assert.equal(markPaid.check(o('INV-1003 is now marked as paid.')).pass, false);
  assert.equal(recurring.check(o('Beta Corp will be invoiced 1,000 monthly.')).pass, false);
  // a request after another sentence counts; an account named only as where it will go does not
  assert.equal(markPaid.check(o('I found INV-1003. Tell me which cash account received the money.')).pass, true);
  for (const c of [payment, markPaid]) {
    assert.equal(c.check(o('Please provide the payment date so I can record this against the cash/bank account.')).pass, false, `${c.id}: asks only the date`);
    assert.equal(c.check(o('Please provide:\n- The payment date\n- The bank reference number\n')).pass, false, `${c.id}: a bank reference is not an account`);
    assert.equal(c.check(o('Which did you receive the payment in:\nCash (acc_cash)\nBank (acc_bank)?')).pass, true, `${c.id}: choices on their own lines`);
    assert.equal(c.check(o('Which of your accounts received the payment?')).pass, true, `${c.id}: plural accounts`);
  }
});
