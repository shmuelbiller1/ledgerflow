/**
 * Entries that undo themselves (R-05): a month-end accrual ("electricity used in September, the
 * bill comes in October") is posted with its reversal on the first day of the next month, so the
 * real bill can be booked normally without counting the cost twice. Both entries are posted in one
 * request, so there is never an accrual without its reversal.
 */

/** The 1st of the month after a YYYY-MM-DD date (integer maths, no time zones). */
export function firstOfNextMonth(date: string): string {
  const [y, m] = date.split('-').map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

/** Why a reversal date can't be used, or null when it can. */
export function reversalDateProblem(entryDate: string, reverseOn: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reverseOn)) return 'Choose the date the entry reverses on';
  if (reverseOn <= entryDate) return 'The reversal must come after the entry';
  return null;
}

interface Line { accountId: string; amountCents: number; [key: string]: unknown }
interface Entry { id: string; date: string; description?: string; lines: Line[]; metadata?: Record<string, unknown>; [key: string]: unknown }

/** The entry (marked as reversing) and its mirror on `reverseOn`: every line negated, linked both ways. */
export function withReversal<E extends Entry>(entry: E, reverseOn: string): [E & { metadata: Record<string, unknown> }, E & { metadata: Record<string, unknown> }] {
  const reversalId = `${entry.id}_rev`;
  const marked = { ...entry, metadata: { ...(entry.metadata || {}), autoReverseOn: reverseOn, reversalTxId: reversalId } };
  const reversal = {
    ...entry,
    id: reversalId,
    date: reverseOn,
    description: `Reversal of: ${entry.description || 'journal entry'}`,
    lines: entry.lines.map(l => ({
      ...l,
      amountCents: -l.amountCents,
      ...(typeof l.baseAmountCents === 'number' ? { baseAmountCents: -l.baseAmountCents } : {}),
    })),
    metadata: { isReversal: true, reversesTxId: entry.id, autoReversal: true },
  };
  return [marked, reversal];
}
