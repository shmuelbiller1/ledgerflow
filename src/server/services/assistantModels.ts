/**
 * SBX-2 Part 6: two models, chosen by a written rule, and the model that reads receipts.
 *
 * Models (prices in src/lib/ai/modelPricing.ts, read from Google's pricing page on 2026-11-22):
 * - simple: `gemini-3.5-flash-lite` — $0.30 in / $2.50 out per million tokens, $0.03 cached input.
 * - strong: `gemini-3.8-flash` — $0.75 / $3.75 (cached $0.075) until 31 Dec 2026, then $1.50 / $7.50.
 * - ocr: `gemini-3.5-flash-lite` — the page lists image input at the text price.
 *
 * The rule, in order (the first that applies decides; `reason` is logged with the turn):
 * 1. `ambiguous`: the router found the request vague or holding several questions, or it is vague
 *    itself ("something", "looks off", "fix the books", "sort out", "clean up").
 * 2. `high-risk`: the request names a high-risk action (delete, void, write off, reverse, merge, refund,
 *    dispose, revalue, close a period, or a change to "all"/"every" record), or the command it reads as
 *    is marked `risk: 'high'` (the same flag that makes the person confirm it alone with two-step sign-in).
 * 3. `several-steps`: two or more actions in one request, words that chain steps ("then", "after
 *    that", "and also", "for each"), or analysis that needs several dependent reads and a judgement
 *    ("why", "should", "afford", "forecast", "compare", "versus", "trend", "summarise").
 * 4. `long`: over 300 characters.
 * 5. otherwise `simple`.
 * If the simple model fails (no answer, an error, the step limit) before drafting any step, the turn is retried once on the
 * strong model with reason `simple-model-failed`. A turn is never moved to a *cheaper* model, and a
 * plan limit refuses the turn instead (Part 7).
 *
 * Providers: the owner approved providers other than Google on 22 Nov (docs/FOR_YOU.md). An override
 * (`ASSISTANT_MODEL_SIMPLE` / `_STRONG` / `_OCR`) is used only when the model has a price row for today
 * in src/lib/ai/modelPricing.ts — Part 7 meters cents, so an unpriced model would spend unseen — and,
 * for a model that is not Gemini, only when its OpenAI-compatible endpoint is set
 * (`ASSISTANT_MODEL_BASE_URL`, optional `ASSISTANT_MODEL_API_KEY`). The defaults stay Gemini until GLM's
 * quality is measured on the replay (no key yet); GLM-5.3-Flash would cut list price by half.
 */
import type { AnyCommandDefinition } from '../commands/types';
import { priceOn } from '../../lib/ai/modelPricing';
import { findAssistantCommands } from './assistantCatalog';
import { openAiCompatibleClient } from './openAiCompatibleClient';
import type { ModelClient } from './assistantTurn';

export type ModelTier = 'simple' | 'strong';
export interface ModelChoice { tier: ModelTier; model: string; reason: string }

export const DEFAULT_ASSISTANT_MODELS = {
  simple: 'gemini-3.5-flash-lite',
  strong: 'gemini-3.8-flash',
  ocr: 'gemini-3.5-flash-lite',
} as const;

export const isGeminiModel = (model: string) => /^gemini-[a-z0-9.-]+$/.test(model);

/** A model the assistant may use: priced today, and reachable (Gemini, or another provider's endpoint is set). */
export function isApprovedModel(model: string, env: Record<string, string | undefined> = process.env, day = new Date().toISOString().slice(0, 10)): boolean {
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(model) || !priceOn(model, day)) return false;
  return isGeminiModel(model) || Boolean(env.ASSISTANT_MODEL_BASE_URL);
}

/** The configured models; an override that is unpriced or unreachable is ignored. */
export function assistantModels(env: Record<string, string | undefined> = process.env, day = new Date().toISOString().slice(0, 10)) {
  const pick = (name: string | undefined, fallback: string) => {
    const model = name?.trim().toLowerCase();
    return model && isApprovedModel(model, env, day) ? model : fallback;
  };
  return {
    simple: pick(env.ASSISTANT_MODEL_SIMPLE, DEFAULT_ASSISTANT_MODELS.simple),
    strong: pick(env.ASSISTANT_MODEL_STRONG, DEFAULT_ASSISTANT_MODELS.strong),
    ocr: pick(env.ASSISTANT_MODEL_OCR, DEFAULT_ASSISTANT_MODELS.ocr),
  };
}

const HIGH_RISK = /\b(delete|deleting|remove|void|voiding|write ?offs?|writing off|written off|reverse|reversing|reversal|merge|merging|refund|dispose|disposal|revalue|close (the |a )?(period|month|year|books)|all|every|bulk)\b/i;
const ACTIONS = /\b(create|record|make|add|set ?up|move|write ?off|fix|delete|remove|send|pay|post|change|update|edit|cancel|void|refund|approve|reconcile|draft|apply|transfer|issue|merge|reverse|split)\b/gi;
const CHAIN = /\b(then|after that|afterwards|and also|for each|followed by)\b/i;
const VAGUE = /\b(something|anything|stuff|things?|looks? off|weird|wrong|fix (the|my) books|sort (it |things |this )?out|clean ?up|tidy)\b/i;
const ANALYSIS = /\b(why|should|afford|forecast|predict|compare|comparison|versus|vs|trend|summari[sz]e|summary|explain why|what if)\b/i;
const LONG = 300;

/**
 * Which model answers a turn the router sent to the model. `routerReason` is the router's own reason
 * (assistantRouter.ts); `commands` are the commands the person may draft (to read their risk flag).
 */
export function chooseModel(question: string, routerReason: string, commands: readonly AnyCommandDefinition[],
  models = assistantModels()): ModelChoice {
  const strong = (reason: string): ModelChoice => ({ tier: 'strong', model: models.strong, reason });
  const text = question.trim().replace(/\s+/g, ' ');
  if (routerReason === 'vague' || routerReason === 'several-questions' || VAGUE.test(text)) return strong('ambiguous');
  const [closest] = findAssistantCommands(commands, text, 1, { strict: true });
  const closestRisk = closest ? commands.find(command => command.name === closest.command)?.risk : undefined;
  if (HIGH_RISK.test(text) || closestRisk === 'high') return strong('high-risk');
  if ((text.match(ACTIONS) ?? []).length >= 2 || CHAIN.test(text) || ANALYSIS.test(text)) return strong('several-steps');
  if (text.length > LONG) return strong('long');
  return { tier: 'simple', model: models.simple, reason: 'simple' };
}

/**
 * One client for the turn: Gemini models go to Google, any other approved model to the configured
 * OpenAI-compatible endpoint. Null when a model the turn may need has no way to be reached.
 */
export function routedModelClient(gemini: ModelClient | null, env: Record<string, string | undefined> = process.env): ModelClient | null {
  const other = env.ASSISTANT_MODEL_BASE_URL ? openAiCompatibleClient({ baseUrl: env.ASSISTANT_MODEL_BASE_URL, apiKey: env.ASSISTANT_MODEL_API_KEY }) : null;
  const models = assistantModels(env);
  const needsGemini = [models.simple, models.strong].some(isGeminiModel);
  if (needsGemini && !gemini) return null;
  return { models: { generateContent: req => {
    const target = isGeminiModel(String(req.model)) ? gemini : other;
    if (!target) throw new Error('no client for this model');
    return target.models.generateContent(req);
  } } };
}
