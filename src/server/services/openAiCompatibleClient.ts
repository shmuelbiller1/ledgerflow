/**
 * SBX-2: lets the assistant loop (assistantTurn.ts, written against the Gemini request shape) call
 * an OpenAI-compatible Chat Completions endpoint such as the Arena API. It translates one
 * `generateContent` request into `/chat/completions` and the reply back, including tool calls and
 * token usage, so the same measured loop runs on either provider.
 *
 * The API key is not handled here: the session's network proxy adds `Authorization: Bearer` for the
 * configured host, so `apiKey` is only a placeholder the endpoint never sees from this code.
 */
import type { Content, FunctionDeclaration } from '@google/genai';
import type { ModelClient } from './assistantTurn';

type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> }
  | { role: 'tool'; tool_call_id: string; content: string };

interface ChatReply {
  choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** Gemini `contents` → OpenAI `messages`. Tool call ids are made from position, which is stable within a turn. */
export function toChatMessages(systemPrompt: string, contents: Content[]): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }];
  let callNo = 0;
  const pending: string[] = [];
  for (const content of contents) {
    const parts = content.parts ?? [];
    const calls = parts.filter(p => p.functionCall);
    const responses = parts.filter(p => p.functionResponse);
    if (content.role === 'model' && calls.length) {
      messages.push({ role: 'assistant', content: null, tool_calls: calls.map(p => {
        const id = `call_${callNo++}`;
        pending.push(id);
        return { id, type: 'function' as const, function: { name: String(p.functionCall!.name), arguments: JSON.stringify(p.functionCall!.args ?? {}) } };
      }) });
    } else if (responses.length) {
      for (const p of responses) messages.push({ role: 'tool', tool_call_id: pending.shift() ?? `call_${callNo++}`, content: JSON.stringify(p.functionResponse!.response ?? {}) });
    } else {
      messages.push({ role: content.role === 'model' ? 'assistant' : 'user', content: parts.map(p => p.text ?? '').join('') } as ChatMessage);
    }
  }
  return messages;
}

export function toChatTools(declarations: FunctionDeclaration[]) {
  return declarations.map(d => ({ type: 'function' as const, function: {
    name: d.name, description: d.description ?? '',
    parameters: (d as { parametersJsonSchema?: unknown }).parametersJsonSchema ?? d.parameters ?? { type: 'object', properties: {} },
  } }));
}

export function openAiCompatibleClient(options: { baseUrl: string; apiKey?: string; fetchImpl?: typeof fetch }): ModelClient {
  const doFetch = options.fetchImpl ?? fetch;
  return { models: { async generateContent(req) {
    const config = (req.config ?? {}) as { systemInstruction?: string; tools?: Array<{ functionDeclarations?: FunctionDeclaration[] }> };
    const declarations = (config.tools ?? []).flatMap(t => t.functionDeclarations ?? []);
    const body = {
      model: req.model,
      messages: toChatMessages(String(config.systemInstruction ?? ''), (req.contents ?? []) as Content[]),
      ...(declarations.length ? { tools: toChatTools(declarations) } : {}),
    };
    const res = await doFetch(`${options.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${options.apiKey ?? 'injected-by-proxy'}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Model endpoint answered ${res.status}`);
    const reply = await res.json() as ChatReply;
    const message = reply.choices?.[0]?.message ?? {};
    const toolCalls = message.tool_calls ?? [];
    const functionCalls = toolCalls.map(c => {
      let args: Record<string, unknown>;
      try { args = JSON.parse(c.function.arguments || '{}'); } catch { args = {}; }
      return { name: c.function.name, args };
    });
    return {
      text: message.content ?? '',
      ...(functionCalls.length ? { functionCalls, candidates: [{ content: { role: 'model', parts: functionCalls.map(functionCall => ({ functionCall })) } }] } : {}),
      usageMetadata: { promptTokenCount: reply.usage?.prompt_tokens ?? 0, candidatesTokenCount: reply.usage?.completion_tokens ?? 0 },
    };
  } } };
}
