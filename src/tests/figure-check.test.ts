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
