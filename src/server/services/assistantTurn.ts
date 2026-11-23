/**
 * SBX-2 Part 1: one assistant turn, measured. Every turn records which path answered it (code,
 * memory, cache or model), which model, tokens, the tools offered and called, time to the answer,
 * total time and cost. A model without a price row records its tokens and an unknown cost, never a
 * guess (src/lib/ai/modelPricing.ts).
 *
 * Privacy: a metric never holds the question, the answer, amounts, names or any other book data —
 * only the path, the model, counts, times and cost, tagged with the workspace it belongs to.
 *
 * `runAssistantTurn` is the thinnest model loop the later SBX-2 parts need: it sends the question
 * with the system prompt and the offered tools, runs the read tools the model asks for through the
 * caller's `callTool` (the sandbox read tools, which never write to the real books), and stops at a
 * text answer or after `maxSteps` model calls.
 */
import type { Content, FunctionCall, FunctionDeclaration } from '@google/genai';
import type { Firestore } from '../db/firestore';
import { tracedClient, type AiCallTrace } from './aiGateway';
import type { ToolCache } from './assistantReadCache';

export type AnswerPath = 'code' | 'memory' | 'cache' | 'model';

export interface AssistantTurnMetric {
  path: AnswerPath;
  /** The model that answered, when one did */
  model?: string;
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  /** Input tokens the provider served from its prompt cache (SBX-2 Part 4); part of inputTokens */
  cachedInputTokens: number;
  /** Which of the two models answered and the rule that chose it (SBX-2 Part 6) */
  modelTier?: 'simple' | 'strong';
  modelReason?: string;
  /** Tools the model was offered by the end of the turn, including any added by find_command */
  toolsOffered: number;
  /** Tool names only, never their arguments or results */
  toolsCalled: string[];
  /** Tool calls answered from the read cache (SBX-2 Part 4) */
  toolCacheHits: number;
  /** Time until the model's full answer arrived (replies are not streamed yet, so this is not a first-word time) */
  answerMs: number;
  totalMs: number;
  /** US cents; null when any model call in the turn has no price row */
  costCents: number | null;
  ok: boolean;
}

/** Builds the metric from the model calls the turn made. With no calls the cost is zero, not unknown. */
export function turnMetric(input: {
  path: AnswerPath; traces: readonly AiCallTrace[]; toolsOffered: number; toolsCalled: readonly string[];
  answerMs: number; totalMs: number; ok: boolean; toolCacheHits?: number;
}): AssistantTurnMetric {
  const { traces } = input;
  const unpriced = traces.some(t => t.ok && t.costCents === undefined);
  const cost = traces.reduce((sum, t) => sum + (t.costCents ?? 0), 0);
  return {
    path: input.path,
    ...(traces.length ? { model: traces[traces.length - 1].model } : {}),
    modelCalls: traces.length,
    inputTokens: traces.reduce((s, t) => s + t.inputTokens, 0),
    outputTokens: traces.reduce((s, t) => s + t.outputTokens, 0),
    cachedInputTokens: traces.reduce((s, t) => s + (t.cachedInputTokens ?? 0), 0),
    toolsOffered: input.toolsOffered,
    toolsCalled: [...input.toolsCalled],
    toolCacheHits: input.toolCacheHits ?? 0,
    answerMs: Math.round(input.answerMs),
    totalMs: Math.round(input.totalMs),
    costCents: unpriced ? null : cost,
    ok: input.ok,
  };
}

/** Stores one turn's metric with the other AI traces. Only the metric: no question or answer text. */
export async function recordAssistantTurn(db: Firestore, workspaceId: string, uid: string, metric: AssistantTurnMetric, reservationId?: string): Promise<void> {
  try {
    // a reserved model turn (planCapacity.reserveAssistantModelTurn) is replaced by its real metric
    const id = reservationId ?? `trace-${crypto.randomUUID()}`;
    await db.collection('billingLedgerTraces').doc(id).set({
      id, workspaceId, uid, algorithmName: 'ASSISTANT_TURN', assistantTurn: metric,
      calls: [], executionTimeMs: metric.totalMs, degraded: !metric.ok, timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[assistant turn not recorded]', err instanceof Error ? err.message : err);
  }
}

interface GenerateResponse {
  text?: string;
  functionCalls?: FunctionCall[];
  candidates?: Array<{ content?: Content }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}
export interface ModelClient { models: { generateContent: (req: Record<string, unknown> & { model: string }) => Promise<unknown> } }

export interface AssistantTurnInput {
  client: ModelClient;
  model: string;
  systemPrompt: string;
  tools: FunctionDeclaration[];
  question: string;
  /** Facts the application states for this turn (today, currency, financial year), put before the question. */
  facts?: string;
  /** Runs one read tool. Its result goes back to the model; it is never stored in the metric. */
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  /**
   * Turns a tool's result into extra tool definitions for the rest of the turn — `find_command`'s
   * discovery. The definitions come from the caller's own command catalog (trusted server code),
   * never from model text; they join both what the model is offered and what may run.
   */
  discover?: (tool: string, result: unknown) => FunctionDeclaration[];
  /** Read results cached per workspace, sandbox and inputs; dropped when the books change (SBX-2 Part 4) */
  cache?: ToolCache;
  maxSteps?: number;
  now?: () => number;
}

/** Runs one tool through the turn's cache when there is one; `hit` says the result came from the cache. */
export async function cachedToolCall(input: Pick<AssistantTurnInput, 'callTool' | 'cache'>, name: string, args: Record<string, unknown>): Promise<{ value: unknown; hit: boolean }> {
  if (!input.cache) return { value: await input.callTool(name, args), hit: false };
  return input.cache.read(name, args, async () => {
    const value = await input.callTool(name, args);
    // an error result is never kept: the next read tries again
    return { value, cache: !(value && typeof value === 'object' && 'error' in (value as object)) };
  });
}

export async function runAssistantTurn(input: AssistantTurnInput): Promise<{ answer: string; metric: AssistantTurnMetric }> {
  const now = input.now ?? (() => performance.now());
  const started = now();
  const traces: AiCallTrace[] = [];
  const client = tracedClient(input.client, traces, now)!;
  const toolsCalled: string[] = [];
  let toolCacheHits = 0;
  // Only the offered tools run; any other name the model returns is refused and recorded as 'unknown',
  // so a made-up or injected name never reaches callTool or the stored metric.
  const declarations = [...input.tools];
  const offered = new Set(declarations.map(t => String(t.name)));
  const contents: Content[] = [{ role: 'user', parts: [{ text: input.facts ? `${input.facts}\n\nQuestion: ${input.question}` : input.question }] }];
  const config = { systemInstruction: input.systemPrompt, tools: [{ functionDeclarations: declarations }] };
  let answered: number | undefined;
  let answer = '';
  let ok = false;
  try {
    for (let step = 0; step < (input.maxSteps ?? 6); step++) {
      const res = await client.models.generateContent({ model: input.model, contents, config }) as GenerateResponse;
      const calls = res.functionCalls ?? [];
      if (!calls.length) {
        answer = res.text ?? '';
        answered = now();
        // An empty reply (e.g. a blocked response with only feedback) is not a successful answer.
        ok = answer.trim().length > 0;
        break;
      }
      contents.push(res.candidates?.[0]?.content ?? { role: 'model', parts: calls.map(functionCall => ({ functionCall })) });
      const parts = [];
      for (const call of calls) {
        const name = String(call.name ?? '');
        toolsCalled.push(offered.has(name) ? name : 'unknown');
        let response: Record<string, unknown>;
        if (!offered.has(name)) response = { error: 'This tool was not offered.' };
        else {
          try {
            const { value: result, hit } = await cachedToolCall(input, name, (call.args ?? {}) as Record<string, unknown>);
            if (hit) toolCacheHits++;
            response = { result };
            for (const found of input.discover?.(name, result) ?? []) {
              if (found.name && !offered.has(String(found.name))) { offered.add(String(found.name)); declarations.push(found); }
            }
          } catch (err) { response = { error: err instanceof Error ? err.message : 'tool failed' }; }
        }
        parts.push({ functionResponse: { name, response } });
      }
      contents.push({ role: 'user', parts });
    }
  } catch {
    ok = false;
  }
  const ended = now();
  return {
    answer,
    metric: turnMetric({ path: 'model', traces, toolsOffered: declarations.length, toolsCalled, toolCacheHits,
      answerMs: (answered ?? ended) - started, totalMs: ended - started, ok }),
  };
}
