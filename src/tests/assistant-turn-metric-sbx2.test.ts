/** SBX-2 Part 1: each assistant turn is measured, priced from the dated table, and holds no book text. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordAssistantTurn, runAssistantTurn, turnMetric, type ModelClient } from '../server/services/assistantTurn';

/** A fake Gemini: first asks for a tool, then answers. Each call takes 10 "ms" on the fake clock. */
function fakeClient(model: string): { client: ModelClient; requests: Array<Record<string, unknown>> } {
  const requests: Array<Record<string, unknown>> = [];
  const replies = [
    { functionCalls: [{ name: 'run_report', args: { report: 'cash' } }], usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 20 } },
    { text: 'Cash is 1,234.00 (source: cash report).', usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 30 } },
  ];
  return { requests, client: { models: { generateContent: async req => { requests.push(req); assert.equal(req.model, model); return replies.shift(); } } } };
}

function clock() { let t = 0; return () => (t += 10); }

const SECRET_QUESTION = 'What is my cash balance at Acme Bank account 12345?';

test('a model turn is measured: path, model, tokens, tools, times and cost from the price table', async () => {
  const { client, requests } = fakeClient('gemini-2.5-flash');
  const toolArgs: unknown[] = [];
  const { answer, metric } = await runAssistantTurn({
    client, model: 'gemini-2.5-flash', systemPrompt: 'sys', question: SECRET_QUESTION, now: clock(),
    tools: [{ name: 'run_report', description: 'r' }, { name: 'ask_books', description: 'a' }],
    callTool: async (_name, args) => { toolArgs.push(args); return { cents: 123400 }; },
  });
  assert.match(answer, /Cash is/);
  assert.deepEqual(toolArgs, [{ report: 'cash' }], 'the model\'s tool call ran with its arguments');
  assert.equal(requests.length, 2, 'the tool result went back to the model');
  assert.equal(metric.path, 'model');
  assert.equal(metric.model, 'gemini-2.5-flash');
  assert.equal(metric.modelCalls, 2);
  assert.equal(metric.inputTokens, 2200);
  assert.equal(metric.outputTokens, 50);
  assert.equal(metric.toolsOffered, 2);
  assert.deepEqual(metric.toolsCalled, ['run_report']);
  assert.ok(metric.totalMs > 0 && metric.firstWordMs > 0 && metric.firstWordMs <= metric.totalMs);
  // gemini-2.5-flash: $0.30 in / $2.50 out per million tokens
  assert.ok(metric.costCents !== null && Math.abs(metric.costCents - (2200 * 0.3 + 50 * 2.5) * 100 / 1e6) < 1e-9);
  assert.equal(metric.ok, true);
});

test('a model with no price row records tokens and an unknown cost, never a guess', async () => {
  const { client } = fakeClient('some-unpriced-model');
  const { metric } = await runAssistantTurn({
    client, model: 'some-unpriced-model', systemPrompt: 's', question: 'q', now: clock(),
    tools: [{ name: 'run_report', description: 'r' }], callTool: async () => ({}),
  });
  assert.equal(metric.inputTokens, 2200);
  assert.equal(metric.costCents, null);
});

test('a turn answered without the model costs nothing and names no model', () => {
  const metric = turnMetric({ path: 'code', traces: [], toolsOffered: 0, toolsCalled: ['ask_books'], firstWordMs: 3, totalMs: 5, ok: true });
  assert.equal(metric.costCents, 0);
  assert.equal(metric.model, undefined);
  assert.equal(metric.modelCalls, 0);
});

test('the stored metric holds no question, answer or tool data', async () => {
  const { client } = fakeClient('gemini-2.5-flash');
  const { answer, metric } = await runAssistantTurn({
    client, model: 'gemini-2.5-flash', systemPrompt: 's', question: SECRET_QUESTION, now: clock(),
    tools: [{ name: 'run_report', description: 'r' }], callTool: async () => ({ cents: 123400, account: 'Acme Bank' }),
  });
  const written: Array<Record<string, unknown>> = [];
  const db = { collection: () => ({ doc: () => ({ set: async (row: Record<string, unknown>) => { written.push(row); } }) }) };
  await recordAssistantTurn(db as never, 'ws_1', 'u_1', metric);
  const stored = JSON.stringify(written);
  assert.equal(written.length, 1);
  assert.equal(written[0].workspaceId, 'ws_1');
  for (const leaked of ['Acme', '12345', 'cash balance', answer, '123400']) {
    assert.ok(!stored.includes(leaked), `stored metric must not contain "${leaked}"`);
  }
});

test('a model failure ends the turn as not ok, with what was measured so far', async () => {
  const client: ModelClient = { models: { generateContent: async () => { throw new Error('provider down'); } } };
  const { answer, metric } = await runAssistantTurn({ client, model: 'gemini-2.5-flash', systemPrompt: 's', question: 'q', tools: [], callTool: async () => ({}), now: clock() });
  assert.equal(answer, '');
  assert.equal(metric.ok, false);
  assert.equal(metric.modelCalls, 1);
});
