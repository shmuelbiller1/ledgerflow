/**
 * Selling or scrapping a fixed asset (X-03). One ledger entry on the disposal date:
 * - depreciation still due through the disposal month (what src/lib/depreciationEngine.ts says is
 *   due, minus what was posted): DR depreciation expense, CR accumulated depreciation;
 * - the asset leaves the books: DR accumulated depreciation (all of it), CR the asset account (its cost);
 * - the money received, if any: DR the account it went to;
 * - the difference is the gain (CR) or loss (DR) on the chosen account:
 *   proceeds + accumulated depreciation − cost.
 * Lines on the same account are added together. Positive cents are debits, negative credits.
 *
 * Part of an asset (X-04, for example 2 of 5 vans): the depreciation still due is posted for the whole
 * asset, then only that share of its cost and of its accumulated depreciation leaves the books, with
 * the money received and the gain or loss on that share. The rest stays and keeps depreciating on the
 * smaller cost and salvage value.
 */
export interface DisposalAccounts {
  asset: { id: string; name: string };
  accumulated: { id: string; name: string };
  expense?: { id: string; name: string };
  gainLoss?: { id: string; name: string };
  proceeds?: { id: string; name: string };
}

export interface DisposalInput {
  costCents: number;
  /** Depreciation already posted. */
  postedDepreciationCents: number;
  /** Depreciation still due through the disposal month (0 when up to date). */
  catchUpCents: number;
  proceedsCents: number;
}

export interface DisposalLine { accountId: string; accountName: string; amountCents: number }

/** Proceeds plus all depreciation minus cost: positive is a gain, negative a loss. */
export function disposalGainLoss(input: DisposalInput): number {
  return input.proceedsCents + input.postedDepreciationCents + input.catchUpCents - input.costCents;
}

/** What is missing or wrong, or null. */
export function disposalProblem(input: DisposalInput, accounts: Partial<DisposalAccounts>): string | null {
  if (!Number.isSafeInteger(input.proceedsCents) || input.proceedsCents < 0) return 'The amount received must be zero or more';
  if (!accounts.asset) return 'Choose the account the asset is in (for example Equipment)';
  if (!accounts.accumulated && input.postedDepreciationCents + input.catchUpCents > 0) return 'Choose the accumulated depreciation account';
  if (input.catchUpCents > 0 && !accounts.expense) return 'Choose the depreciation expense account';
  if (input.proceedsCents > 0 && !accounts.proceeds) return 'Choose the account the money went to';
  if (disposalGainLoss(input) !== 0 && !accounts.gainLoss) return 'Choose the account for the gain or loss on disposal';
  return null;
}

export function disposalLines(input: DisposalInput, accounts: DisposalAccounts): DisposalLine[] {
  const totals = new Map<string, DisposalLine>();
  const add = (account: { id: string; name: string } | undefined, cents: number) => {
    if (!account || !cents) return;
    const row = totals.get(account.id) || { accountId: account.id, accountName: account.name, amountCents: 0 };
    row.amountCents += cents;
    totals.set(account.id, row);
  };
  add(accounts.expense, input.catchUpCents);
  add(accounts.accumulated, -input.catchUpCents);
  add(accounts.accumulated, input.postedDepreciationCents + input.catchUpCents);
  add(accounts.proceeds, input.proceedsCents);
  add(accounts.asset, -input.costCents);
  add(accounts.gainLoss, -disposalGainLoss(input));
  return [...totals.values()].filter(l => l.amountCents !== 0);
}

/** Why a share cannot be sold or scrapped, or null: more than 0% and less than 100%, two decimals at most. */
export function portionProblem(percent: number): string | null {
  if (!Number.isFinite(percent) || percent <= 0 || percent >= 100) return 'Choose a share between 0% and 100% (all of it is a full disposal)';
  if (Math.round(percent * 100) / 100 !== percent) return 'The share has at most two decimals';
  return null;
}

/** The share of the cost and salvage value that leaves (whole cents), and what stays. */
export function portionOf(asset: { purchasePriceCents?: number; salvageValueCents?: number }, percent: number) {
  const cost = asset.purchasePriceCents || 0;
  const salvage = asset.salvageValueCents || 0;
  const costPartCents = Math.round(cost * percent / 100);
  const salvagePartCents = Math.round(salvage * percent / 100);
  return { costPartCents, salvagePartCents, remainingCostCents: cost - costPartCents, remainingSalvageCents: salvage - salvagePartCents };
}

/**
 * FA-01 + X-04: the share of each capitalized addition that stays with the asset after a share of it
 * leaves. Additions are components of the cost, so they shrink with it — the engine then schedules the
 * retained basis, not the full additions on a smaller asset.
 */
export function retainedCostAdditions<A extends { amountCents: number }>(additions: A[] | undefined, percentLeaving: number): A[] {
  const kept = 100 - percentLeaving;
  return (Array.isArray(additions) ? additions : []).map(a => ({ ...a, amountCents: Math.round(Number(a.amountCents) * kept / 100) }));
}

/**
 * The entry for a share, in the terms `disposalLines` takes: the catch-up for the whole asset, then
 * `accumulatedPartCents` (the share's accumulated depreciation, catch-up included) and the share's cost
 * leave. Gain or loss = proceeds + accumulatedPartCents − costPartCents.
 */
export function partialDisposalInput(costPartCents: number, accumulatedPartCents: number, catchUpCents: number, proceedsCents: number): DisposalInput {
  return { costCents: costPartCents, postedDepreciationCents: accumulatedPartCents - catchUpCents, catchUpCents, proceedsCents };
}
