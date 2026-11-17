import { z } from 'zod';
import { HttpError } from '../auth/requestUser';
import type { CommandContext, CommandDefinition } from './types';

/**
 * A cost added to an asset after it was bought: the capitalising half of `ConstructionActions`.
 *
 * Capitalising a cost raises the asset's cost basis, and the basis is what every later depreciation run divides, so a
 * browser write here changes what the books say an asset is worth, quietly and with the tab's own clock on the row.
 * `purchasePriceCents` and `costAdditions` were written as a pair from the tab; two tabs adding a cost at the same
 * time kept only the last one's list, and the total then described a list that no longer existed.
 *
 * The command appends the one cost to the list it reads inside the transaction and derives the new basis from that
 * same read, so the list and the total cannot disagree. A cost of zero is refused: it is a typo, not a fact.
 *
 * What it is **not**: a posting. Nothing is posted here — the entry that capitalised the expenditure was already
 * made, and this only says that the asset's own record now includes it.
 */
const idSchema = z.string().trim().min(1).max(200).refine(id => !id.includes('/'), 'Id cannot contain a slash');
const text = (max: number) => z.string().trim().max(max);

export const assetCostAdditionInput = z.object({
  assetId: idSchema,
  /** the day the cost was borne: the asset's own date field, not a posting date */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'A date is YYYY-MM-DD'),
  amountCents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  note: text(120).optional(),
}).strict();

type CostInput = z.output<typeof assetCostAdditionInput>;
type AssetRow = Record<string, unknown> & {
  id?: string;
  name?: string;
  purchasePriceCents?: number;
  costAdditions?: Array<{ date: string; amountCents: number; note?: string }>;
};
export type AssetCostAdded = { assetId: string; purchasePriceCents: number; additions: number };

export const assetCostAdditionCommand: CommandDefinition<typeof assetCostAdditionInput, AssetCostAdded> = {
  name: 'asset.costaddition',
  input: assetCostAdditionInput,
  roles: ['owner', 'accountant'],
  async handler(ctx: CommandContext, tx, input: CostInput) {
    const ref = ctx.db.collection('assets').doc(input.assetId);
    const snapshot = await tx.get(ref);
    const existing = snapshot.data() as AssetRow | undefined;
    if (!snapshot.exists || existing?.workspaceId !== ctx.workspaceId) {
      throw Object.assign(new HttpError('This asset is not in the selected workspace.', 404), { code: 'NOT_FOUND' });
    }
    const costAdditions = [
      ...(Array.isArray(existing.costAdditions) ? existing.costAdditions : []),
      { date: input.date, amountCents: input.amountCents, ...(input.note ? { note: input.note } : {}) },
    ];
    const purchasePriceCents = Number(existing.purchasePriceCents || 0) + input.amountCents;
    tx.update(ref, { purchasePriceCents, costAdditions, updatedAt: new Date().toISOString() });
    return { assetId: input.assetId, purchasePriceCents, additions: costAdditions.length };
  },
  async preview(ctx: CommandContext, input: CostInput) {
    const snapshot = await ctx.db.collection('assets').doc(input.assetId).get();
    const existing = snapshot.data() as AssetRow | undefined;
    if (!snapshot.exists || existing?.workspaceId !== ctx.workspaceId) {
      throw new HttpError('This asset is not in the selected workspace.', 404);
    }
    return {
      title: `Capitalise a cost on ${String(existing.name || input.assetId)}`,
      lines: [`${input.date}: ${(input.amountCents / 100).toFixed(2)}`, `the basis becomes ${((Number(existing.purchasePriceCents || 0) + input.amountCents) / 100).toFixed(2)}`],
    };
  },
  audit(_input: CostInput, result: AssetCostAdded) {
    return {
      action: 'ASSET_COST_CAPITALISED',
      entityType: 'assets',
      entityId: result.assetId,
      description: `Capitalised a cost on the asset ${result.assetId}`,
      details: { purchasePriceCents: result.purchasePriceCents, additions: result.additions },
    };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Add one capitalised cost to an asset and raise its cost basis; do not use it to record the expenditure itself, which is a journal entry.',
    example: { assetId: 'asset_1', date: '2026-11-16', amountCents: 250000, note: 'Electrical work' },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The amount is zero or negative, or the date is not YYYY-MM-DD.', next: 'Send a positive amount in cents and a date as YYYY-MM-DD.' },
      { code: 'NOT_FOUND', when: 'The asset is not in the selected workspace.', next: 'Reload the assets and choose one in this workspace.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is not an owner or an accountant.', next: 'Ask a workspace owner or accountant to capitalise the cost.' },
    ],
    next: [{ command: 'period.depreciation', label: 'Run this period’s depreciation' }],
  },
};
