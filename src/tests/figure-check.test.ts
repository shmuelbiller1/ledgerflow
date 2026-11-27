import test from 'node:test';
import assert from 'node:assert/strict';
import { answerAmounts, checkFigures } from '../lib/figureCheck';
import { answerTurn } from '../server/services/assistantRouter';
import { chooseModel, DEFAULT_ASSISTANT_MODELS } from '../server/services/assistantModels';
import type { ModelClient } from '../server/services/assistantTurn';

const report = { rows: [{ name: 'Acme', balanceCents: 577_700 }, { name: 'Beta', balanceCents: 295_000 }], overdueCents: 577_700 };

test('amounts are read next to a currency sign or code, with k/million and "about"', () => {
  assert.deepEqual(answerAmounts('Acme owes $5,777.00, Beta 2,950 USD, about ₪1.2 million.').map(a => [a.value, a.approximate]),
    [[5777, false], [2950, false], [1_200_000, true]]);
  assert.deepEqual(answerAmounts('Invoice INV-2026 is 30 days late, 17.5% VAT.'), []);
});

test('amounts traced to tool results: as stored, from cents, totals, averages, sums and differences', () => {
  const ok = checkFigures('Overdue: $5,777. Total owed: $8,727.00. Average per customer $4,363.50; Acme owes $2,827 more than Beta.', [report], 'who owes us?', 'USD');
  assert.deepEqual(ok, { checked: 4, untraced: [] });
});

test('an amount nothing returned is reported (the 27 Nov Hebrew $85,000 balance)', () => {
  assert.deepEqual(checkFigures('Your bank balance is $85,000.', [report], 'what is in the bank?', 'USD').untraced, ['$85,000']);
  assert.deepEqual(checkFigures('Pay $85,000 to Beta?', [report], 'pay Beta $85,000', 'USD').untraced, [], 'an amount from the question is the person’s own');
});

test('a record in another currency converts with its own decimals; percentages and acronyms are no amounts (Codex review on #1056)', () => {
  assert.deepEqual(checkFigures('Beta owes KWD 7.125.', [{ rows: [{ currency: 'KWD', balanceCents: 7125 }] }], 'what does Beta owe?', 'USD').untraced, []);
  assert.deepEqual(checkFigures('VAT 17.5% applies.', [{ rate: 0.175 }], 'Which tax applies?', 'USD'), { checked: 0, untraced: [] });
  assert.deepEqual(answerAmounts('VAT 17.5 applies, USD 12.5% off'), []);
  assert.deepEqual(answerAmounts('at 1 USD = 0.923456 EUR, or EUR 1.08 per USD'), [], 'exchange rates are not amounts');
  assert.deepEqual(checkFigures('Total owed = $85,000.', [{ balanceCents: 577700 }], 'How much do customers owe?', 'USD').untraced, ['$85,000'], 'a total after "=" is still checked');
});

test('declared currencies, price rates and question identifiers are not loopholes (Codex review on #1056)', () => {
  assert.deepEqual(checkFigures('Beta owes KWD 71.25.', [{ rows: [{ currency: 'KWD', balanceCents: 7125 }] }], 'what does Beta owe?', 'USD').untraced, ['KWD 71.25']);
  assert.deepEqual(checkFigures('The monthly rate is $85,000 per month.', [{ balanceCents: 577700 }], 'what do we pay?', 'USD').untraced, ['$85,000']);
  assert.deepEqual(checkFigures('The outstanding balance on INV-85000 is $85,000.', [{ balanceCents: 577700 }], 'What is the outstanding balance on INV-85000?', 'USD').untraced, ['$85,000']);
  assert.deepEqual(checkFigures('Spent $2,026 in 2026.', [{ x: 1 }], 'what did we spend in 2026?', 'USD').untraced, ['$2,026']);
  assert.deepEqual(checkFigures('Paying Beta $850.', [{ x: 1 }], 'pay Beta 850', 'USD').untraced, []);
});

test('sub-unit amounts are checked, and totals never mix currencies (Codex review on #1056)', () => {
  assert.deepEqual(checkFigures('Balance: $0.99.', [{ balanceCents: 10 }], 'What is the balance?', 'USD').untraced, ['$0.99']);
  assert.deepEqual(checkFigures('Balance: $0.10.', [{ balanceCents: 10 }], 'What is the balance?', 'USD').untraced, []);
  const rows = [{ rows: [{ currency: 'KWD', balanceCents: 7125 }, { currency: 'USD', balanceCents: 1000 }] }];
  assert.deepEqual(checkFigures('Total KWD 8.125.', rows, 'total?', 'USD').untraced, ['KWD 8.125']);
  assert.deepEqual(checkFigures('Together 17.125 KWD.', rows, 'total?', 'USD').untraced, ['17.125 KWD'], 'no sums across currencies');
  const same = [{ rows: [{ currency: 'USD', balanceCents: 1000 }, { currency: 'USD', balanceCents: 2500 }] }];
  assert.deepEqual(checkFigures('Total $35.', same, 'total?', 'USD').untraced, []);
});

test('an amount matches only its own currency, within that currency\'s minor unit (Codex review on #1056)', () => {
  assert.deepEqual(checkFigures('Beta owes USD 10.', [{ currency: 'KWD', balanceCents: 10000 }], 'What does Beta owe?', 'USD').untraced, ['USD 10']);
  assert.deepEqual(checkFigures('Beta owes KWD 10.', [{ currency: 'KWD', balanceCents: 10000 }], 'What does Beta owe?', 'USD').untraced, []);
  assert.deepEqual(checkFigures('Balance: KWD 0.012.', [{ currency: 'KWD', balanceCents: 1 }], 'What is the balance?', 'KWD').untraced, ['KWD 0.012']);
  assert.deepEqual(checkFigures('Balance: KWD 0.001.', [{ currency: 'KWD', balanceCents: 1 }], 'What is the balance?', 'KWD').untraced, []);
  assert.deepEqual(checkFigures('Acme owes $5,777.', [{ balanceCents: 577700 }], 'who owes?', 'USD').untraced, [], 'records with no currency are the workspace\'s');
});

test('"$10 CAD" is one CAD amount; question amounts keep their currency; equal records add up (Codex review on #1056)', () => {
  assert.deepEqual(checkFigures('Beta owes $10 CAD.', [{ currency: 'CAD', balanceCents: 1000 }], 'What does Beta owe?', 'USD'), { checked: 1, untraced: [] });
  assert.deepEqual(checkFigures('That is USD 85,000.', [{ balanceCents: 577700 }], 'Convert EUR 85000 to USD', 'USD').untraced, ['USD 85,000']);
  assert.deepEqual(checkFigures('That is EUR 85,000.', [{ balanceCents: 577700 }], 'Convert EUR 85000 to USD', 'USD').untraced, []);
  const two = [{ currency: 'USD', totalAmountCents: 10000 }, { currency: 'USD', totalAmountCents: 10000 }];
  assert.deepEqual(checkFigures('Together the two invoices total $200.', two, 'What is the combined total?', 'USD').untraced, []);
});

test('an acronym after a signed amount keeps the amount; sub-unit records add up (Codex review on #1056)', () => {
  assert.deepEqual(checkFigures('Total: $85,000 VAT included.', [{ balanceCents: 577700 }], 'What is the total?', 'USD').untraced, ['$85,000']);
  assert.deepEqual(checkFigures('Together the invoices total $0.70.', [{ currency: 'USD', totalAmountCents: 30 }, { currency: 'USD', totalAmountCents: 40 }], 'total?', 'USD').untraced, []);
});

test('calculator results are hundredths in any workspace; big reports stay fast (Codex review on #1056)', () => {
  assert.deepEqual(checkFigures('Total: KWD 12.345.', [{ cents: 12345, amount: 123.45 }], 'add these', 'KWD').untraced, ['KWD 12.345']);
  assert.deepEqual(checkFigures('Total: KWD 123.45.', [{ cents: 12345, amount: 123.45 }], 'add these', 'KWD').untraced, []);
  const rows = Array.from({ length: 20000 }, (_, i) => ({ debitCents: i, creditCents: i * 2, balanceCents: i * 3 }));
  const started = performance.now();
  checkFigures('Total $1.', [{ rows }], 'ledger?', 'USD');
  assert.ok(performance.now() - started < 5000, 'a 20,000-row report is checked in seconds');
});

test('a failed strong retry that drafted a step is reported as failed, not hidden behind the earlier answer (Codex review on #1056)', async () => {
  const seen: string[] = [];
  const step = new Map<string, number>();
  const client: ModelClient = { models: { generateContent: async req => {
    seen.push(req.model);
    const n = step.get(req.model) ?? 0;
    step.set(req.model, n + 1);
    if (req.model === DEFAULT_ASSISTANT_MODELS.simple) return n === 0
      ? { functionCalls: [{ name: 'run_report', args: {} }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } }
      : { text: 'The total would be $400.', usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } };
    if (n === 0) return { functionCalls: [{ name: 'propose_invoice_create', args: {} }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } };
    throw new Error('strong model failed after drafting');
  } } };
  const turn = await answerTurn({ client, model: 'unused', systemPrompt: 's', question: q, currency: 'USD',
    tools: [{ name: 'run_report', description: 'x' }, { name: 'propose_invoice_create', description: 'x' }],
    callTool: async () => report, modelRule: rule });
  assert.equal(turn.metric.ok, false);
  assert.equal(turn.metric.modelReason, 'figure-check-failed');
});

test('aging buckets are minor units; a calculation backs any currency (Codex review on #1056)', () => {
  const aging = { current: 577700, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, total: 577700 };
  assert.deepEqual(checkFigures('Customers owe $577,700.', [aging], 'Explain the amounts owed', 'USD').untraced, ['$577,700']);
  assert.deepEqual(checkFigures('Customers owe $5,777.', [aging], 'Explain the amounts owed', 'USD').untraced, []);
  assert.deepEqual(checkFigures('The total is EUR 120.', [{ expression: '100 * 1.2', cents: 12000, amount: 120 }], 'What is EUR 100 multiplied by 1.2?', 'USD').untraced, []);
});

test('minor-unit fields are only cents, and billions are read (Codex review on #1056)', () => {
  assert.deepEqual(checkFigures('Your balance is $577,700.', [{ balanceCents: 577700 }], 'What is my balance?', 'USD').untraced, ['$577,700']);
  assert.deepEqual(checkFigures('Your balance is $5,777.', [{ balanceCents: 577700 }], 'What is my balance?', 'USD').untraced, []);
  assert.deepEqual(checkFigures('Revenue: $1.2 billion', [{ revenueCents: 120000000000 }], 'What is revenue?', 'USD').untraced, []);
  assert.deepEqual(checkFigures('Paid $5,777.', [{ amount: 5777 }], 'what was paid?', 'USD').untraced, [], 'a field without a unit may hold whole amounts');
});

const tools = [{ name: 'run_report', description: 'x' }];
const turnClient = (answers: Record<string, string>, seen: string[]): ModelClient => {
  const step = new Map<string, number>();
  return { models: { generateContent: async req => {
    seen.push(req.model);
    const n = step.get(req.model) ?? 0;
    step.set(req.model, n + 1);
    if (n === 0) return { functionCalls: [{ name: 'run_report', args: {} }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 1 } };
    step.set(req.model, 0);
    return { text: answers[req.model], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 1 } };
  } } };
};
const q = 'How much do customers owe us in total?';
const rule = { choose: (reason: string) => chooseModel(q, reason, []), strong: DEFAULT_ASSISTANT_MODELS.strong };

test('the real fallback: a believable but unbacked figure from the simple model goes to the strong model', async () => {
  const seen: string[] = [];
  const client = turnClient({ [DEFAULT_ASSISTANT_MODELS.simple]: 'Customers owe $5,777.', [DEFAULT_ASSISTANT_MODELS.strong]: 'Customers owe $8,727 in total.' }, seen);
  // the simple answer is backed ($5,777 is Acme's balance): no retry
  const first = await answerTurn({ client, model: 'unused', systemPrompt: 's', tools, question: q, currency: 'USD', callTool: async () => report, modelRule: rule });
  assert.equal(first.metric.modelTier, 'simple');
  assert.equal(first.metric.figuresUntraced, 0);

  seen.length = 0;
  const wrong = turnClient({ [DEFAULT_ASSISTANT_MODELS.simple]: 'Customers owe $9,100.', [DEFAULT_ASSISTANT_MODELS.strong]: 'Customers owe $8,727 in total.' }, seen);
  const turn = await answerTurn({ client: wrong, model: 'unused', systemPrompt: 's', tools, question: q, currency: 'USD', callTool: async () => report, modelRule: rule });
  assert.deepEqual(seen, [DEFAULT_ASSISTANT_MODELS.simple, DEFAULT_ASSISTANT_MODELS.simple, DEFAULT_ASSISTANT_MODELS.strong, DEFAULT_ASSISTANT_MODELS.strong]);
  assert.equal(turn.answer, 'Customers owe $8,727 in total.');
  assert.equal(turn.metric.modelTier, 'strong');
  assert.equal(turn.metric.modelReason, 'figure-check-failed');
  assert.equal(turn.metric.modelCalls, 4);
  assert.equal(turn.metric.figuresUntraced, 0);
});

test('when the strong model is unbacked too, the answer is shown with a warning naming the amount', async () => {
  const seen: string[] = [];
  const client = turnClient({ [DEFAULT_ASSISTANT_MODELS.simple]: 'Customers owe $9,100.', [DEFAULT_ASSISTANT_MODELS.strong]: 'Customers owe $9,200.' }, seen);
  const turn = await answerTurn({ client, model: 'unused', systemPrompt: 's', tools, question: q, currency: 'USD', callTool: async () => report, modelRule: rule });
  assert.match(turn.answer, /^Customers owe \$9,200\.\n\nPlease check: I could not match \$9,200 to a figure in your books\.$/);
  assert.equal(turn.metric.figuresUntraced, 1);
  assert.equal(turn.metric.ok, true);
});
