/** SBX-2 Part 2: the router answers exact book questions with code and sends everything else to the model. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answerTurn, routeQuestion, wordCodeAnswer, type CodeRoute } from '../server/services/assistantRouter';
import type { ModelClient } from '../server/services/assistantTurn';

/** Pinned: these MUST go to the model (actions, judgement, why, vague, several questions, unknown). */
const MUST_GO_TO_MODEL = [
  'Record a payment of 500 from Acme Ltd for INV-1001.',
  'Create an invoice for Acme Ltd for two hours of consulting.',
  'Make a bill from the electricity company for 320.',
  'Why is my profit lower than last month?',
  'Should I chase Acme or Beta first?',
  'Fix the books.',
  'Something looks off with my numbers, can you check?',
  "Move all of last month's office costs to a new project.",
  'Set up a monthly invoice for Beta Corp of 1,000.',
  'Can I afford to hire someone next quarter?',
  'Write off the small balances customers will never pay.',
  'Summarise how the business did this year in plain words.',
  'Who owes me money?', // the aging report has totals, not names
  'Which invoices are overdue?',
  'Which bills are due this week?',
  'What is my cash balance and who owes me?',
  'Delete invoice INV-1001.',
  'What is 1,250 plus 17% VAT?', // words and a percentage: not pure arithmetic
  'Tell me a joke.',
  'What were my sales excluding refunds this month?', // ask_books would ignore the exclusion
  'What is my cash balance without the petty cash?',
  'How much did I spend on rent compared to last year?',
  'What were my sales per customer this month?',
  'What is my revenue growth this year?',
  'What were my sales only in Tel Aviv this month?',
  '',
];

/** Pinned: these MUST be answered by code, through the named tool. */
const MUST_NOT_GO_TO_MODEL: Array<[string, CodeRoute['tool']]> = [
  ['What is my cash balance?', 'ask_books'],
  ['How much is in the bank account today?', 'ask_books'],
  ['What were my sales this month?', 'ask_books'],
  ['What did I spend last month?', 'ask_books'],
  ['How much do customers owe in total?', 'run_report'],
  ['How much do I owe suppliers?', 'run_report'],
  ['Show invoice INV-1001.', 'search_records'],
  ['Is invoice INV-1002 paid?', 'search_records'],
  ['Find the customer Acme Ltd.', 'search_records'],
  ['List my last five payments.', 'list_records'],
  ['What is 1,250 + 212.50?', 'calculate'],
];

test('pinned: questions that must go to the model do', () => {
  for (const q of MUST_GO_TO_MODEL) assert.equal(routeQuestion(q).path, 'model', q);
});

test('pinned: questions the books answer exactly go to code, through the right tool', () => {
  for (const [q, tool] of MUST_NOT_GO_TO_MODEL) {
    const d = routeQuestion(q);
    assert.equal(d.path, 'code', q);
    assert.equal(d.path === 'code' && d.route.tool, tool, q);
  }
});

test('the router never sends model-written arguments: the routed args come from the question', () => {
  const d = routeQuestion('Show invoice inv-77.');
  assert.ok(d.path === 'code');
  assert.deepEqual(d.route.args, { text: 'INV-77', collections: ['invoices'] });
  const c = routeQuestion('What is 1,250 + 212.50?');
  assert.ok(c.path === 'code' && c.route.tool === 'calculate');
  assert.equal(c.route.args.expression, '1250 + 212.50');
});

test('a figure is stated only when ask_books placed every word; otherwise the model answers', () => {
  const route = { tool: 'ask_books', args: { question: 'q' }, template: 'figure' } as const;
  const ok = { reading: { problem: null, understood: { accounts: ['Cash'], period: 'today' } }, answer: { answerCents: 1234567 } };
  assert.equal(wordCodeAnswer(route, ok, 'USD'), '12,345.67 USD — Cash, today. Source: posted entries (explain this number).');
  assert.equal(wordCodeAnswer(route, { ...ok, reading: { ...ok.reading, problem: 'No account matches "petty"' } }, 'USD'), null);
  assert.equal(wordCodeAnswer(route, { ...ok, answer: null }, 'USD'), null);
  assert.equal(wordCodeAnswer(route, ok, null), null, 'no workspace currency: not stated');
  assert.equal(wordCodeAnswer(route, { error: 'x' }, 'USD'), null);
});

test('amounts follow the currency\'s minor units (yen has none, KWD has three)', () => {
  const route = { tool: 'ask_books', args: { question: 'q' }, template: 'figure' } as const;
  const reading = { problem: null, understood: { accounts: ['Cash'], period: 'today' } };
  assert.match(String(wordCodeAnswer(route, { reading, answer: { answerCents: 1500 } }, 'JPY')), /^1,500 JPY/);
  assert.match(String(wordCodeAnswer(route, { reading, answer: { answerCents: 1500 } }, 'KWD')), /^1\.500 KWD/);
});

test('the aging answer uses the report\'s buckets and total; a different shape falls back to the model', () => {
  const route = { tool: 'run_report', args: { report: 'aging', params: { type: 'ar' } }, template: 'aging' } as const;
  const aging = { current: 10000, '1-30': 5000, '31-60': 0, '61-90': 0, '90+': 2500, total: 17500 };
  const text = String(wordCodeAnswer(route, aging, 'USD'));
  assert.match(text, /^Customers owe you 175\.00 USD/);
  assert.match(text, /90\+ days overdue 25\.00 USD/);
  assert.match(text, /Source: aging report\.$/);
  assert.equal(wordCodeAnswer(route, { total: 1 }, 'USD'), null);
});

test('records and calculations are worded with their source', () => {
  const records = { tool: 'search_records', args: { text: 'INV-1', collections: ['invoices'] }, template: 'records' } as const;
  const match = (record: Record<string, unknown>) => ({ collection: 'invoices', id: String(record.id ?? 'x'), matched: 'number', record });
  // the real search_records shape: { text, matches: [{ collection, id, matched, record }] }
  assert.equal(wordCodeAnswer(records, { text: 'INV-1', matches: [match({ id: 'i1', number: 'INV-1', status: 'paid', dueDate: '2026-11-30' })] }, 'USD'),
    'Invoice INV-1 (status paid, due 2026-11-30). Source: invoices records.', 'a status question gets the status');
  // substring matches (INV-10, a memo mentioning INV-1) are not the invoice asked for
  assert.equal(wordCodeAnswer(records, { text: 'INV-1', matches: [match({ id: 'i10', number: 'INV-10', status: 'open' }), match({ id: 'i1', number: 'INV-1', status: 'open' })] }, 'USD'),
    'Invoice INV-1 (status open). Source: invoices records.');
  assert.equal(wordCodeAnswer(records, { text: 'INV-1', matches: [match({ id: 'i10', number: 'INV-10' })] }, 'USD'), null, 'no exact number: the model looks further');
  assert.equal(wordCodeAnswer(records, { text: 'INV-1', matches: [] }, 'USD'), null, 'the scan is capped: never claim the invoice does not exist');
  const full = Array.from({ length: 20 }, (_, i) => match({ id: `i${i}`, number: i === 0 ? 'INV-1' : `INV-1${i}` }));
  assert.equal(wordCodeAnswer(records, { text: 'INV-1', matches: full }, 'USD'), null, 'a full page may be cut short: not stated');
  const payments = { tool: 'list_records', args: { collection: 'payments', limit: 2, orderBy: { field: 'date', direction: 'desc' } }, template: 'records' } as const;
  const listed = String(wordCodeAnswer(payments, { collection: 'payments', records: [
    { id: 'p1', date: '2026-11-20', amountCents: 50000, currency: 'USD', reference: 'CHQ-9' },
    { id: 'p2', date: '2026-11-18', amountCents: 1500, currency: 'JPY' },
  ] }, 'USD'));
  assert.match(listed, /^Last 2 payments: 2026-11-20 .*500.* CHQ-9; 2026-11-18 .*1,?500/);
  assert.equal(wordCodeAnswer(payments, { records: [{ id: 'p1', date: '2026-11-20' }] }, 'USD'), null, 'no amount: not stated');
  const calc = { tool: 'calculate', args: { expression: '1250 + 212.50' }, template: 'calculation' } as const;
  // the real calculate shape: { expression, cents, amount }
  assert.equal(wordCodeAnswer(calc, { expression: '1250 + 212.50', cents: 146250, amount: 1462.5 }, 'USD'), '1250 + 212.50 = 1,462.50. Source: calculate.');
  assert.equal(wordCodeAnswer(calc, { expression: '1250 + 212.50', cents: -5 }, 'USD'), '1250 + 212.50 = -0.05. Source: calculate.');
});

function clock() { let t = 0; return () => (t += 5); }
function countingModel() {
  const calls: unknown[] = [];
  const client: ModelClient = { models: { generateContent: async req => { calls.push(req); return { text: 'model answer', usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10 } }; } } };
  return { client, calls };
}

test('an exact question is answered by code with no model call; the metric says path code and cost 0', async () => {
  const { client, calls } = countingModel();
  const { answer, metric } = await answerTurn({
    client, model: 'gemini-2.5-flash', systemPrompt: 's', tools: [], currency: 'USD', now: clock(),
    question: 'What is my cash balance?',
    callTool: async () => ({ reading: { problem: null, understood: { accounts: ['Cash'], period: 'today' } }, answer: { answerCents: 50000 } }),
  });
  assert.equal(calls.length, 0, 'no model call');
  assert.match(answer, /^500\.00 USD — Cash/);
  assert.equal(metric.path, 'code');
  assert.equal(metric.costCents, 0);
  assert.deepEqual(metric.toolsCalled, ['ask_books']);
});

test('when the tool cannot place the question, the model answers instead (not sure → model)', async () => {
  const { client, calls } = countingModel();
  const { answer, metric } = await answerTurn({
    client, model: 'gemini-2.5-flash', systemPrompt: 's', tools: [], currency: 'USD', now: clock(),
    question: 'What is my petty float balance?',
    callTool: async () => ({ reading: { problem: 'No account matches "petty float"' }, answer: null }),
  });
  assert.equal(calls.length, 1);
  assert.equal(answer, 'model answer');
  assert.equal(metric.path, 'model');
});

test('a question that must go to the model never runs a code tool first', async () => {
  const { client, calls } = countingModel();
  const ran: string[] = [];
  await answerTurn({ client, model: 'gemini-2.5-flash', systemPrompt: 's', tools: [], currency: 'USD', now: clock(),
    question: 'Record a payment of 500 from Acme Ltd.', callTool: async name => { ran.push(name); return {}; } });
  assert.deepEqual(ran, []);
  assert.equal(calls.length, 1);
});

test('routed arguments are valid input for the real read tools', async () => {
  const { searchRecordsInput, listRecordsInput, calculateInput, askBooksInput } = await import('../server/services/sandboxTools');
  const schemas = { search_records: searchRecordsInput, list_records: listRecordsInput, calculate: calculateInput, ask_books: askBooksInput } as const;
  for (const [q] of MUST_NOT_GO_TO_MODEL) {
    const d = routeQuestion(q);
    assert.ok(d.path === 'code');
    if (d.route.tool === 'run_report') continue; // report params are checked by the report route itself
    const schema = schemas[d.route.tool];
    assert.ok(schema.safeParse(d.route.args).success, `${q}: ${JSON.stringify(d.route.args)}`);
  }
});

test('a fallback turn counts the code tool it already ran, in its time and tools', async () => {
  let t = 0;
  const now = () => (t += 7);
  const client: ModelClient = { models: { generateContent: async () => ({ text: 'model answer', usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } }) } };
  const { metric } = await answerTurn({ client, model: 'gemini-2.5-flash', systemPrompt: 's', tools: [], currency: 'USD', now,
    question: 'Show invoice INV-404.', callTool: async () => ({ text: 'INV-404', matches: [] }) });
  assert.equal(metric.path, 'model');
  assert.deepEqual(metric.toolsCalled.slice(0, 1), ['search_records']);
  assert.ok(metric.totalMs >= 7 + 7, 'includes the code tool time');
});
