/**
 * The AI gateway (strategic review, PLAN §9): every model call made for an AI task passes through
 * here. It (1) lets through only the payload fields the task declares, so nothing else in a request
 * reaches the model provider; (2) records each call — task, model, tokens, measured time, and the
 * cost from the dated price table (src/lib/ai/modelPricing.ts; an unpriced model is recorded as
 * unknown, never guessed) — so every AI result can be traced to what produced it.
 */
import { callCostCents } from '../../lib/ai/modelPricing';

/** The fields each AI task may send to the model (read from AIBackendService's cases). */
export const AI_TASK_FIELDS: Record<string, readonly string[]> = {
  'strategic-analysis': ['mode', 'data'],
  'generate-forecast': ['transactions', 'horizon'],
  'map-transactions': ['transactions', 'accounts', 'context'],
  'analyze-trends': ['transactions', 'context'],
  'parse-query': ['query', 'context'],
  'parse-magic-entry': ['input', 'accounts', 'categories', 'patternContext'],
  'parse-receipt': ['base64Data', 'mimeType', 'context', 'fallbackCurrency'],
  'read-document': ['base64Data', 'mimeType', 'fallbackCurrency'],
  'parse-statement': ['content', 'mimeType', 'context'],
  'parse-personal-tax-profile': ['message'],
  'build-auto-rule': ['sentence', 'accounts', 'categories', 'projects'],
  'chat': ['query', 'ledgerSummary'],
  'parse-business-blueprint': ['description'],
};

/** Only the task's declared fields; an unknown task gets none. */
export function allowedPayload(task: string, payload: Record<string, unknown>): Record<string, unknown> {
  const fields = AI_TASK_FIELDS[task] || [];
  return Object.fromEntries(Object.entries(payload).filter(([key]) => fields.includes(key)));
}

export interface AiCallTrace {
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Input tokens the provider served from its prompt cache (part of inputTokens) */
  cachedInputTokens?: number;
  ms: number;
  /** US cents; absent when the model has no price row */
  costCents?: number;
  ok: boolean;
}

interface GenerateResult { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; cachedContentTokenCount?: number } }
interface ModelsLike { generateContent: (req: { model: string } & Record<string, unknown>) => Promise<unknown> }

/** The client with each generateContent call measured and recorded in `traces`. */
export function tracedClient<T extends object>(client: T | null, traces: AiCallTrace[], now: () => number = () => performance.now()): T | null {
  if (!client) return null;
  const inner = (client as unknown as { models: ModelsLike }).models;
  const models: ModelsLike = {
    async generateContent(req) {
      const started = now();
      try {
        const result = await inner.generateContent(req) as GenerateResult;
        const inputTokens = result?.usageMetadata?.promptTokenCount || 0;
        const outputTokens = result?.usageMetadata?.candidatesTokenCount || 0;
        const cachedInputTokens = result?.usageMetadata?.cachedContentTokenCount || 0;
        const cost = callCostCents(req.model, new Date().toISOString().slice(0, 10), inputTokens, outputTokens, cachedInputTokens);
        traces.push({ model: req.model, inputTokens, outputTokens, ...(cachedInputTokens ? { cachedInputTokens } : {}),
          ms: Math.round(now() - started), ...(cost === undefined ? {} : { costCents: cost }), ok: true });
        return result;
      } catch (err) {
        traces.push({ model: req.model, inputTokens: 0, outputTokens: 0, ms: Math.round(now() - started), ok: false });
        throw err;
      }
    },
  };
  return new Proxy(client, { get: (target, key) => (key === 'models' ? new Proxy(inner, { get: (m, k) => (k === 'generateContent' ? models.generateContent : Reflect.get(m, k)) }) : Reflect.get(target, key)) });
}
