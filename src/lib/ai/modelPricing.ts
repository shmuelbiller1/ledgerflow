/**
 * What each AI model costs, as dated rows with the provider's page (the strategic review, 11 Oct:
 * the old constant priced Gemini 2.5 Flash at $0.075 / $0.30 per million tokens, about 4× and 8×
 * too low). Standard paid tier, text, US dollars per million tokens. A model without a row is not
 * priced: the caller records the tokens and leaves the cost unknown rather than guessing.
 *
 * `cachedInputUsdPerMillion` is the provider's context-caching price: input tokens the provider
 * served from its prompt cache (SBX-2 Part 4) are charged at this rate instead of the input rate.
 * A row without it charges every input token at the input rate (never a guessed discount).
 *
 * SBX-2 Part 6 rows were read from Google's pricing page on 2026-11-22. `validFrom` is that day, not
 * the model's launch: earlier calls stay unpriced rather than priced at a rate we did not see. Where
 * the page announces a later price, the later row is added with its date.
 */
export interface ModelPrice {
  model: string;
  validFrom: string;
  validTo?: string;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  cachedInputUsdPerMillion?: number;
  source: string;
}

const GOOGLE = 'https://ai.google.dev/gemini-api/docs/pricing';
/** The same page; on 2026-11-22 it is served from Google AI Studio's address. */
const GOOGLE_2026 = 'https://aistudio.google.com/docs/pricing';
/** Z.ai (GLM), read 2026-11-22. The owner approved providers other than Google on 22 Nov (docs/FOR_YOU.md). */
const ZAI = 'https://docs.z.ai/guides/overview/pricing';
/** OpenAI standard text rates, read 2026-11-23 (context under 272K tokens). */
const OPENAI = 'https://openai.com/api/pricing/';

export const MODEL_PRICES: ModelPrice[] = [
  { model: 'gpt-6-luna', validFrom: '2026-11-23', inputUsdPerMillion: 0.1, outputUsdPerMillion: 0.5, cachedInputUsdPerMillion: 0.01, source: OPENAI },
  { model: 'gpt-6.1-terra', validFrom: '2026-11-23', inputUsdPerMillion: 1, outputUsdPerMillion: 5, cachedInputUsdPerMillion: 0.05, source: OPENAI },
  { model: 'gemini-2.5-flash', validFrom: '2025-06-17', inputUsdPerMillion: 0.3, outputUsdPerMillion: 2.5, source: GOOGLE },
  // SBX-2 Part 6: the assistant's simple-turn model and the receipt/invoice reading (OCR) model.
  // The page lists text / image / video / audio input at the same price.
  { model: 'gemini-3.5-flash-lite', validFrom: '2026-11-22', inputUsdPerMillion: 0.3, outputUsdPerMillion: 2.5, cachedInputUsdPerMillion: 0.03, source: GOOGLE_2026 },
  // SBX-2 Part 6: the assistant's strong model. The page states this price through 31 Dec 2026, then double.
  { model: 'gemini-3.8-flash', validFrom: '2026-11-22', validTo: '2026-12-31', inputUsdPerMillion: 0.75, outputUsdPerMillion: 3.75, cachedInputUsdPerMillion: 0.075, source: GOOGLE_2026 },
  { model: 'gemini-3.8-flash', validFrom: '2027-01-01', inputUsdPerMillion: 1.5, outputUsdPerMillion: 7.5, cachedInputUsdPerMillion: 0.15, source: GOOGLE_2026 },
  // SBX-2 Part 6: the GLM comparison (not the default; see src/server/services/assistantModels.ts).
  { model: 'glm-5.3-flash', validFrom: '2026-11-22', inputUsdPerMillion: 0.15, outputUsdPerMillion: 0.5, cachedInputUsdPerMillion: 0.03, source: ZAI },
  { model: 'glm-5.3-flashx', validFrom: '2026-11-22', inputUsdPerMillion: 0.37, outputUsdPerMillion: 1.25, cachedInputUsdPerMillion: 0.075, source: ZAI },
  { model: 'glm-5.3', validFrom: '2026-11-22', inputUsdPerMillion: 1.4, outputUsdPerMillion: 4.4, cachedInputUsdPerMillion: 0.26, source: ZAI },
  { model: 'glm-4.6v', validFrom: '2026-11-22', inputUsdPerMillion: 0.3, outputUsdPerMillion: 0.9, cachedInputUsdPerMillion: 0.05, source: ZAI },
  { model: 'glm-ocr', validFrom: '2026-11-22', inputUsdPerMillion: 0.03, outputUsdPerMillion: 0.03, source: ZAI },
];

export function priceOn(model: string, date: string): ModelPrice | undefined {
  return MODEL_PRICES.find(p => p.model === model && p.validFrom <= date && (!p.validTo || date <= p.validTo));
}

/**
 * The cost in US cents (fractional) of one call, or undefined when the model has no price row.
 * `cachedInputTokens` is the part of `inputTokens` the provider served from its prompt cache.
 */
export function callCostCents(model: string, date: string, inputTokens: number, outputTokens: number, cachedInputTokens = 0): number | undefined {
  const price = priceOn(model, date);
  if (!price) return undefined;
  const cached = price.cachedInputUsdPerMillion === undefined ? 0 : Math.min(Math.max(cachedInputTokens, 0), inputTokens);
  const fresh = inputTokens - cached;
  return (fresh * price.inputUsdPerMillion + cached * (price.cachedInputUsdPerMillion ?? 0) + outputTokens * price.outputUsdPerMillion) * 100 / 1_000_000;
}
