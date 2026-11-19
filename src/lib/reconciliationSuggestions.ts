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

/** An entry's cash movements, converted once: per cash account, plus the net across them. */
export interface CashLegs {
  /** cash account id -> signed base amount on that account */
  byAccount: Map<string, number>;
  /** signed base amount summed across every cash account */
  net: number;
}

/** Convert one entry's lines into its cash legs. Call this once per entry, not once per bank line. */
export function cashLegsOf(
  entry: CashCandidateEntry,
  cashAccountIds: ReadonlySet<string>,
  amountOf: (line: { accountId: string; amountCents: number }) => number = line => line.amountCents,
): CashLegs {
  const byAccount = new Map<string, number>();
  for (const line of entry.lines || []) {
    if (!cashAccountIds.has(line.accountId)) continue;
    byAccount.set(line.accountId, (byAccount.get(line.accountId) || 0) + amountOf(line));
  }
  let net = 0;
  byAccount.forEach(delta => { net += delta; });
  return { byAccount, net };
}

/**
 * The signed cash movement an entry with these legs could have produced for `bankLine`, or `null`
 * when it could not have produced one (no cash leg, zero net, or the wrong direction).
 *
 * A statement line in a named cash account is measured by **that account's own leg**: an entry that
 * moved only another bank account is not a candidate, however large its total. Only the all-accounts
 * view (no cash account on the line) falls back to the entry's net cash movement.
 *
 * @param legs the entry's cash legs, precomputed with `cashLegsOf`
 * @param bankLine the statement line (its `accountId` may be missing in the all-accounts view)
 * @param cashAccountIds ids of the workspace's cash accounts
 */
export function cashLegFromLegs(
  legs: CashLegs,
  bankLine: CashCandidateLine,
  cashAccountIds: ReadonlySet<string>,
): number | null {
  if (legs.byAccount.size === 0) return null;
  const ownAccountId = bankLine.accountId && cashAccountIds.has(bankLine.accountId) ? bankLine.accountId : null;
  const leg = ownAccountId !== null ? (legs.byAccount.get(ownAccountId) || 0) : legs.net;
  if (leg === 0) return null;
  if (Math.sign(leg) !== Math.sign(bankLine.amountCents)) return null;
  return leg;
}

/**
 * Convenience wrapper: convert one entry's legs and ask whether they could produce `bankLine`.
 * Prefer `cashLegsOf` + `cashLegFromLegs` when the same entry is tested against many bank lines.
 */
export function cashLegForBankLine(
  entry: CashCandidateEntry,
  cashAccountIds: ReadonlySet<string>,
  bankLine: CashCandidateLine,
  amountOf: (line: { accountId: string; amountCents: number }) => number = line => line.amountCents,
): number | null {
  return cashLegFromLegs(cashLegsOf(entry, cashAccountIds, amountOf), bankLine, cashAccountIds);
}
