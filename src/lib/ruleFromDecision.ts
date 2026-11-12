/**
 * EU-C3: make a rule at the moment of deciding. "Always do this for Shell" turns the decision just made — this
 * merchant goes to this account, with these labels — into a bank rule the import, the review list and the server
 * all run (src/lib/bankRules.ts). The merchant is the first real word of the payee or description, so "SHELL 0042"
 * and "Shell 1187 Main St" are the same rule.
 */
import type { AutoRule } from '../types';

const NOISE = new Set(['pos', 'card', 'debit', 'credit', 'purchase', 'payment', 'pmt', 'ach', 'online', 'the', 'www', 'sq', 'tst']);

/** "SHELL 0042" → "shell"; "POS PURCHASE Corner Cafe" → "corner"; nothing usable → "". */
export function merchantKey(payee?: string, description?: string): string {
  const text = (payee || description || '').toLowerCase().replace(/\*/g, ' ');
  // Hebrew vowel marks (niqqud) belong to the word they sit on: "שָׁלוֹם" is one word of four letters
  const word = text.split(/[^\p{L}\p{M}]+/u).find(w => w.replace(/\p{M}/gu, '').length >= 3 && !NOISE.has(w));
  return word || '';
}

/** The merchant as people read it: "shell" → "Shell". */
export const merchantLabel = (key: string) => key.charAt(0).toLocaleUpperCase() + key.slice(1);

export function ruleFromDecision(input: { payee?: string; description?: string; accountId: string; accountName?: string; labels?: Record<string, string> }): Partial<AutoRule> | null {
  const key = merchantKey(input.payee, input.description);
  if (!key || !input.accountId) return null;
  const labels = Object.fromEntries(Object.entries(input.labels || {}).filter(([k, v]) => k !== 'category' && typeof v === 'string' && v));
  return {
    name: `${merchantLabel(key)} → ${input.accountName || input.accountId}`,
    condition: { descriptionContains: key },
    action: { targetAccountId: input.accountId, ...(input.accountName ? { targetCategory: input.accountName } : {}), ...(Object.keys(labels).length ? { targetDimensions: labels } : {}) },
    confidence: 1,
    isHardened: true,
    isActive: true,
  };
}
