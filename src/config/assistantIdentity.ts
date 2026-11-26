/**
 * The in-app assistant's name and how each answer says where it came from (owner, 26 Nov 2026: professional
 * but transparent; the person must always see whether an answer was calculated from the books or written
 * by an AI model). Change the name here: every label reads it.
 */
export const ASSISTANT_NAME = 'Flo';
/** The button and sidebar entry that opens the assistant. */
export const ASK_ASSISTANT = `Ask ${ASSISTANT_NAME}`;
/** The assistant's title on its page and panel. */
export const ASSISTANT_TITLE = `${ASSISTANT_NAME} · your AI assistant`;

/** Where an answer came from, as the server reports it (`path`, plus `modelTier` for model answers). */
export type AnswerSource =
  | { kind: 'books' }
  | { kind: 'ai'; tier?: 'simple' | 'strong'; model?: string }
  | { kind: 'shortcut' };

/**
 * The server's answer path: `code` and `cache` are calculated from the books with no model (`cache` reused a
 * read made moments ago); `model` was written by an AI model. Anything unknown is treated as AI, never
 * passed off as exact.
 */
export function answerSource(result: { path?: string; model?: string; modelTier?: string }): AnswerSource {
  if (result.path === 'code' || result.path === 'cache' || result.path === 'memory') return { kind: 'books' };
  const tier = result.modelTier === 'simple' || result.modelTier === 'strong' ? result.modelTier : undefined;
  return { kind: 'ai', ...(tier ? { tier } : {}), ...(result.model ? { model: result.model } : {}) };
}

/** The badge text for each source, short enough for a phone. */
export function sourceLabel(source: AnswerSource): { title: string; detail: string } {
  if (source.kind === 'books') return { title: 'From your books', detail: 'Calculated from your records, no AI. The figures are exact.' };
  if (source.kind === 'shortcut') return { title: 'Shortcut', detail: 'Opens a page for you. Not an AI answer.' };
  const tier = source.tier === 'strong' ? 'thorough' : source.tier === 'simple' ? 'quick' : '';
  return {
    title: tier ? `AI answer · ${tier}` : 'AI answer',
    detail: `Written by an AI model${source.model ? ` (${source.model})` : ''} using your books. Check important figures before you rely on them.`,
  };
}
