/**
 * #891 (A10-H1-01): which entry could a bank statement line be? Only a *cash* movement.
 *
 * Before this helper the reconciliation screen ranked candidates by `totalAmountCents` — the journal
 * header total — and treated a missing cash sign as eligible, so a bill accrual (expense + input VAT
 * against A/P, no bank leg at all) was offered, and preselected, against the withdrawal that paid it.
 * Accepting such a pair would mark a withdrawal cleared with no cash posting behind it and leave A/P
 * unpaid.
 *
 * The rule here:
 *   - the entry must move a recognised cash account (no cash leg → not a candidate);
 *   - in a named bank account's view the amount is that account's own leg (so a transfer is offered
 *     by the side that touched this bank, not by its zero net);
 *   - in the all-accounts view the amount is the entry's net movement across cash accounts, and a
 *     zero net (a transfer between two cash accounts) is not a candidate;
 *   - the direction must match the statement line (a deposit is not a withdrawal).
 */

export interface CashCandidateEntry {
  id: string;
  totalAmountCents?: number;
  lines?: Array<{ accountId: string; amountCents: number }>;
}

export interface CashCandidateLine {
  accountId?: string;
  amountCents: number;
}

/**
 * The signed cash movement `entry` could have produced for `bankLine`, or `null` when it could not
 * have produced one (no cash leg, zero net, or the wrong direction).
 *
 * @param cashAccountIds ids of the workspace's cash accounts
 * @param bankLine the statement line (its `accountId` may be missing in the all-accounts view)
 * @param amountOf how one line's base amount is read (the caller passes `lineAmount(l, tx)`)
 */
export function cashLegForBankLine(
  entry: CashCandidateEntry,
  cashAccountIds: ReadonlySet<string>,
  bankLine: CashCandidateLine,
  amountOf: (line: { accountId: string; amountCents: number }) => number = line => line.amountCents,
): number | null {
  const ownAccountId = bankLine.accountId && cashAccountIds.has(bankLine.accountId) ? bankLine.accountId : null;
  let leg = 0;
  let sawCashLeg = false;
  for (const line of entry.lines || []) {
    if (!cashAccountIds.has(line.accountId)) continue;
    sawCashLeg = true;
    const delta = amountOf(line);
    if (ownAccountId === null || line.accountId === ownAccountId) leg += delta;
  }
  if (!sawCashLeg || leg === 0) return null;
  if (Math.sign(leg) !== Math.sign(bankLine.amountCents)) return null;
  return leg;
}
