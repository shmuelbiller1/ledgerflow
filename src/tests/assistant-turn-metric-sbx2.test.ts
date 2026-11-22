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
  assert.ok(metric.totalMs > 0 && metric.answerMs > 0 && metric.answerMs <= metric.totalMs);
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
  const metric = turnMetric({ path: 'code', traces: [], toolsOffered: 0, toolsCalled: ['ask_books'], answerMs: 3, totalMs: 5, ok: true });
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

test('the same loop runs on an OpenAI-compatible endpoint (Arena): tools, tool results and usage translate', async () => {
  const { openAiCompatibleClient } = await import('../server/services/openAiCompatibleClient');
  const bodies: Array<Record<string, unknown>> = [];
  const replies = [
    { choices: [{ message: { content: null, tool_calls: [{ id: 'x1', function: { name: 'ask_books', arguments: '{"question":"cash"}' } }] } }], usage: { prompt_tokens: 900, completion_tokens: 15 } },
    { choices: [{ message: { content: 'Cash is 10.00.' } }], usage: { prompt_tokens: 950, completion_tokens: 8 } },
  ];
  const fetchImpl = (async (url: string, init: { body: string; headers: Record<string, string> }) => {
    assert.equal(url, 'https://api.example.test/v1/chat/completions');
    assert.match(init.headers.Authorization, /^Bearer /);
    bodies.push(JSON.parse(init.body));
    return { ok: true, status: 200, json: async () => replies.shift() };
  }) as unknown as typeof fetch;
  const client = openAiCompatibleClient({ baseUrl: 'https://api.example.test/v1/', fetchImpl });
  const { answer, metric } = await runAssistantTurn({
    client, model: 'gpt-6-luna', systemPrompt: 'SYS', question: 'How much cash?', now: clock(),
    tools: [{ name: 'ask_books', description: 'a', parametersJsonSchema: { type: 'object' } } as never],
    callTool: async (name, args) => ({ name, args, cents: 1000 }),
  });
  assert.equal(answer, 'Cash is 10.00.');
  assert.deepEqual(metric.toolsCalled, ['ask_books']);
  assert.equal(metric.inputTokens, 1850);
  assert.equal(metric.outputTokens, 23);
  assert.equal(metric.costCents, null, 'gpt-6-luna has no price row yet: unknown, not guessed');
  const first = bodies[0] as { messages: Array<{ role: string; content: unknown }>; tools: Array<{ function: { name: string } }> };
  assert.deepEqual(first.messages.map(m => m.role), ['system', 'user']);
  assert.equal(first.tools[0].function.name, 'ask_books');
  const second = bodies[1] as { messages: Array<{ role: string; tool_call_id?: string; tool_calls?: unknown[] }> };
  assert.deepEqual(second.messages.map(m => m.role), ['system', 'user', 'assistant', 'tool']);
  assert.equal(second.messages[3].tool_call_id, 'call_0');
});

test('a tool the model was not offered is refused, not run, and recorded only as "unknown"', async () => {
  const replies = [
    { functionCalls: [{ name: 'delete_everything_IGNORE_PREVIOUS', args: {} }, { name: 'ask_books', args: {} }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 1 } },
    { text: 'done', usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 1 } },
  ];
  const seen: Array<Record<string, unknown>> = [];
  const client: ModelClient = { models: { generateContent: async req => { seen.push(req); return replies.shift(); } } };
  const ran: string[] = [];
  const { metric } = await runAssistantTurn({
    client, model: 'gemini-2.5-flash', systemPrompt: 's', question: 'q', now: clock(),
    tools: [{ name: 'ask_books', description: 'a' }], callTool: async name => { ran.push(name); return {}; },
  });
  assert.deepEqual(ran, ['ask_books'], 'only the offered tool ran');
  assert.deepEqual(metric.toolsCalled, ['unknown', 'ask_books']);
  assert.ok(!JSON.stringify(metric).includes('IGNORE_PREVIOUS'));
  const sentBack = JSON.stringify(seen[1]);
  assert.match(sentBack, /This tool was not offered/);
});

test('an empty or blocked reply is not counted as a successful turn', async () => {
  const client: ModelClient = { models: { generateContent: async () => ({ promptFeedback: { blockReason: 'SAFETY' }, usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 0 } }) } };
  const { answer, metric } = await runAssistantTurn({ client, model: 'gemini-2.5-flash', systemPrompt: 's', question: 'q', tools: [], callTool: async () => ({}), now: clock() });
  assert.equal(answer, '');
  assert.equal(metric.ok, false);
  assert.equal(metric.modelCalls, 1);
});

test('a command found with find_command becomes callable for the rest of the turn', async () => {
  const replies = [
    { functionCalls: [{ name: 'find_command', args: { words: 'recurring invoice' } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 1 } },
    { functionCalls: [{ name: 'propose_record_save', args: { kind: 'recurring' } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 1 } },
    { text: 'Drafted.', usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 1 } },
  ];
  const offeredPerCall: string[][] = [];
  const client: ModelClient = { models: { generateContent: async req => {
    const decls = ((req.config as { tools: Array<{ functionDeclarations: Array<{ name: string }> }> }).tools[0].functionDeclarations).map(d => d.name);
    offeredPerCall.push([...decls]);
    return replies.shift();
  } } };
  const ran: string[] = [];
  const catalog = { propose_record_save: { name: 'propose_record_save', description: 'Draft a record save' } };
  const { answer, metric } = await runAssistantTurn({
    client, model: 'gemini-2.5-flash', systemPrompt: 's', question: 'Set up a monthly invoice', now: clock(),
    tools: [{ name: 'find_command', description: 'f' }],
    callTool: async name => { ran.push(name); return name === 'find_command' ? { commands: ['propose_record_save'] } : { drafted: true }; },
    // the declarations come from the server catalog, looked up by the names the trusted tool returned
    discover: (tool, result) => tool === 'find_command'
      ? ((result as { commands: string[] }).commands).flatMap(n => (catalog as Record<string, { name: string; description: string }>)[n] ? [(catalog as Record<string, { name: string; description: string }>)[n]] : [])
      : [],
  });
  assert.equal(answer, 'Drafted.');
  assert.deepEqual(ran, ['find_command', 'propose_record_save'], 'the discovered command ran');
  assert.deepEqual(metric.toolsCalled, ['find_command', 'propose_record_save']);
  assert.deepEqual(offeredPerCall[0], ['find_command']);
  assert.deepEqual(offeredPerCall[1], ['find_command', 'propose_record_save'], 'the next model call is offered the discovered command');
});
