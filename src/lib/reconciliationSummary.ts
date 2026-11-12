/**
 * EU-C5: reconciliation that starts finished. Of a bank account's lines, how many are matched already or have a
 * match the matcher suggests (ready to confirm), and how many need the person — the ones with neither. The matcher
 * is the existing one; this only counts its answer.
 */
export interface ReconciliationSummary {
  total: number;
  matched: number;
  ready: number;
  needYou: number;
  /** "214 of 220 lines matched or ready to confirm — 6 need you" */
  text: string;
}

export function reconciliationSummary(matchedCount: number, unmatchedIds: readonly string[], suggestions: ReadonlyMap<string, string | undefined>): ReconciliationSummary {
  const ready = unmatchedIds.filter(id => suggestions.get(id)).length;
  const needYou = unmatchedIds.length - ready;
  const total = matchedCount + unmatchedIds.length;
  const done = matchedCount + ready;
  const text = total === 0
    ? 'No bank lines yet'
    : needYou === 0
      ? `All ${total} lines matched or ready to confirm`
      : `${done} of ${total} ${total === 1 ? 'line' : 'lines'} matched or ready to confirm — ${needYou} ${needYou === 1 ? 'needs' : 'need'} you`;
  return { total, matched: matchedCount, ready, needYou, text };
}

/** The lines to review with those that need the person first (each group keeps its order). */
export function needYouFirst<T extends { id: string }>(lines: readonly T[], suggestions: ReadonlyMap<string, string | undefined>): T[] {
  return [...lines.filter(l => !suggestions.get(l.id)), ...lines.filter(l => suggestions.get(l.id))];
}
