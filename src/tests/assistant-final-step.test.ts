import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FINAL_STEP, runAssistantTurn, type ModelClient } from '../server/services/assistantTurn';
import { openAiCompatibleClient } from '../server/services/openAiCompatibleClient';

const tools = [{ name: 'calculate', description: 'sum', parametersJsonSchema: { type: 'object', properties: {} } }];

test('out of steps: one last call with no tools gives the person an answer instead of nothing', async () => {
  const requests: Array<Record<string, unknown>> = [];
  const client: ModelClient = { models: { generateContent: async req => {
    requests.push(req);
    const cfg = req.config as { toolConfig?: { functionCallingConfig?: { mode?: string } } };
    if (cfg.toolConfig?.functionCallingConfig?.mode === 'NONE') return { text: 'Profit fell by 8,000; I could not check last year.' };
    return { functionCalls: [{ name: 'calculate', args: {} }] };
  } } };
  const { answer, metric } = await runAssistantTurn({ client, model: 'm', systemPrompt: 's', tools, question: 'Why?', callTool: async () => ({ cents: 1 }), maxSteps: 3 });
  assert.equal(answer, 'Profit fell by 8,000; I could not check last year.');
  assert.equal(metric.ok, true);
  assert.equal(requests.length, 4, 'three tool steps, then the final answer');
  const last = requests[3].contents as Array<{ parts: Array<{ text?: string }> }>;
  assert.equal(last.at(-1)?.parts[0].text, FINAL_STEP);
});

test('a final step that still asks for tools is not an answer', async () => {
  const client: ModelClient = { models: { generateContent: async () => ({ functionCalls: [{ name: 'calculate', args: {} }] }) } };
  const { answer, metric } = await runAssistantTurn({ client, model: 'm', systemPrompt: 's', tools, question: 'Why?', callTool: async () => ({}), maxSteps: 2 });
  assert.equal(answer, '');
  assert.equal(metric.ok, false);
});

test('the OpenAI-compatible client sends tool_choice "none" for the final step', async () => {
  let body: Record<string, unknown> = {};
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    body = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  const client = openAiCompatibleClient({ baseUrl: 'https://example.test/v1', fetchImpl });
  await client.models.generateContent({ model: 'm', contents: [{ role: 'user', parts: [{ text: 'q' }] }], config: { tools: [{ functionDeclarations: tools }], toolConfig: { functionCallingConfig: { mode: 'NONE' } } } });
  assert.equal(body.tool_choice, 'none');
  await client.models.generateContent({ model: 'm', contents: [{ role: 'user', parts: [{ text: 'q' }] }], config: { tools: [{ functionDeclarations: tools }] } });
  assert.equal(body.tool_choice, undefined);
});
