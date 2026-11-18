/**
 * A fixed asset's life after it is bought: it moves (X-05), it is sold or scrapped, wholly or in
 * part (X-03, X-04), and an asset built rather than bought is placed in service (X-09). Each write
 * was a hand-written route; each service already owned its rule, its transaction and its audit line,
 * so the commands add the registered door — the runner checks the workspace, the caller's role, the
 * plan and the period in one order — and the routes keep their legacy answers.
 *
 * The service keeps its own transaction (`db.runTransaction`), which is why these commands do not
 * touch the runner's transaction: the service's reads follow its writes, which only its own
 * transaction allows. That is the same shape the payment batch's credit and deposit commands use.
 *
 * None of them declares `dated`. A closed period is the service's own answer — a 409 in its own
 * words, after it has looked at the asset and the workspace's lock — and the runner's dated check
 * would answer 400 before the service ran. The lock is still enforced: by the service, and again by
 * the ledger door it posts through.
 *
 * `asset.costaddition` (below) is the one that does not go through a service: capitalising a cost
 * raises the basis every later depreciation run divides, so it reads the asset's own list inside the
 * runner's transaction and derives the new total from the same read.
 */
import { z } from 'zod';
import { disposeAsset, undoDisposal } from '../services/assetDisposalService';
import { transferAsset, undoTransfer } from '../services/assetTransferService';
import { placeInService, undoPlaceInService } from '../services/placeInServiceService';
import { HttpError } from '../auth/requestUser';
import type { AnyCommandDefinition, CommandContext, CommandDefinition } from './types';

const WRITERS = ['owner', 'accountant', 'bookkeeper'] as const;
const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const assetPath = z.object({ workspaceId: z.string().min(1).max(200).optional(), assetId: z.string().min(1).max(200) }).strict();

// --------------------------------------------------------------------------- dispose / undo

export const assetDisposeInput = assetPath.extend({
  date: z.string().max(10),
  proceedsCents: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  proceedsAccountId: z.string().max(200).optional(),
  gainLossAccountId: z.string().max(200).optional(),
  /** For an asset saved without its balance-sheet account. */
  assetAccountId: z.string().max(200).optional(),
  /** X-04: only this share (more than 0, less than 100 percent) is sold or scrapped. */
  portionPercent: z.number().gt(0).max(100).optional(),
}).strict();

type AssetDisposeInput = z.output<typeof assetDisposeInput>;
type DisposalResult = { transactionId: string; gainLossCents: number; catchUpCents: number };

export const assetDisposeCommand: CommandDefinition<typeof assetDisposeInput, DisposalResult> = {
  name: 'asset.dispose',
  input: assetDisposeInput,
  roles: [...WRITERS],
  async handler(ctx, _tx, input: AssetDisposeInput) {
    const { workspaceId: _bodyWorkspaceId, assetId, ...rest } = input;
    if (!DAY.test(input.date)) throw Object.assign(new Error('Choose the date it was sold or scrapped'), { status: 400 });
    return disposeAsset(ctx.db, { workspaceId: ctx.workspaceId, assetId, uid: ctx.actor, email: ctx.email, ...rest }) as Promise<DisposalResult>;
  },
  async preview(ctx, input: AssetDisposeInput) {
    return {
      title: input.portionPercent && input.portionPercent !== 100 ? `Sell ${input.portionPercent}% of the asset` : 'Sell or scrap the asset',
      lines: [
        `On ${input.date}, for ${input.proceedsCents} cents`,
        'One entry takes the cost and the depreciation posted so far off the books, with the gain or loss',
      ],
    };
  },
  // the service writes ASSET_DISPOSED inside its own transaction: one write, one record
  audit() { return null; },
  // the undo needs the asset it undoes: an inverse that only names the command is refused as INVALID_INPUT
  inverse(input, result) { return result ? { command: 'asset.undispose', input: { assetId: input.assetId } } : null; },
  risk: 'normal',
  describe: {
    sentence: 'Sell or scrap a fixed asset, wholly or in part, in one entry with the gain or loss; do not use it to move an asset to another location — that is asset.transfer.',
    example: { assetId: 'asset_123', date: '2026-06-30', proceedsCents: 250000 },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The date is missing or not a real day, or the share is outside 0–100.', next: 'Send a real date and, for a part sale, a share between 0 and 100.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is a viewer.', next: 'Ask an owner, accountant or bookkeeper.' },
      { code: 'PERIOD_LOCKED', when: 'The disposal date is in a closed period.', next: 'Choose an open date or ask an owner to reopen the period.' },
    ],
  },
};

export const assetUndoDisposalInput = assetPath;

export const assetUndoDisposalCommand: CommandDefinition<typeof assetUndoDisposalInput, Record<string, unknown>> = {
  name: 'asset.undispose',
  input: assetUndoDisposalInput,
  roles: [...WRITERS],
  async handler(ctx, _tx, input) {
    const { workspaceId: _bodyWorkspaceId, assetId } = input;
    return undoDisposal(ctx.db, { workspaceId: ctx.workspaceId, assetId, uid: ctx.actor, email: ctx.email }) as Promise<Record<string, unknown>>;
  },
  async preview(_ctx, input) {
    return { title: 'Undo the latest disposal', lines: [`Takes back the sale recorded on ${input.assetId}`, 'Its entry is voided while its date is open'] };
  },
  audit() { return null; },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Undo the latest disposal of a fixed asset while its date is open; do not use it to edit the entry by hand.',
    example: { assetId: 'asset_123' },
    refusals: [
      { code: 'NOT_FOUND', when: 'The asset is not in this workspace, or nothing was disposed of.', next: 'Check the asset in this workspace.' },
      { code: 'CONFLICT', when: 'The disposal date is in a closed period, or depreciation was posted after it.', next: 'Undo that later work first.' },
    ],
  },
};

// --------------------------------------------------------------------------- transfer / undo

export const assetTransferInput = assetPath.extend({
  date: z.string().max(10),
  location: z.string().max(200).optional(),
  assetAccountId: z.string().max(200).optional(),
  accumulatedAccountId: z.string().max(200).optional(),
}).strict();

type AssetTransferInput = z.output<typeof assetTransferInput>;

export const assetTransferCommand: CommandDefinition<typeof assetTransferInput, Record<string, unknown>> = {
  name: 'asset.transfer',
  input: assetTransferInput,
  roles: [...WRITERS],
  async handler(ctx, _tx, input: AssetTransferInput) {
    const { workspaceId: _bodyWorkspaceId, assetId, ...rest } = input;
    if (!DAY.test(input.date)) throw Object.assign(new Error('Choose the day it moved'), { status: 400 });
    return transferAsset(ctx.db, { workspaceId: ctx.workspaceId, assetId, uid: ctx.actor, email: ctx.email, ...rest }) as Promise<Record<string, unknown>>;
  },
  async preview(_ctx, input) {
    return {
      title: 'Move the asset',
      lines: [`On ${input.date}`, 'A move between balance-sheet accounts posts one balanced entry; the move can be undone while its date is open'],
    };
  },
  audit() { return null; },
  inverse(input, result) { return result ? { command: 'asset.undotransfer', input: { assetId: input.assetId } } : null; },
  risk: 'normal',
  describe: {
    sentence: 'Move a fixed asset to another location or another balance-sheet account, posting the move when the accounts change; do not use it to sell the asset — that is asset.dispose.',
    example: { assetId: 'asset_123', date: '2026-06-30', location: 'Warehouse B' },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The date is missing or not a real day.', next: 'Send a real date.' },
      { code: 'PERIOD_LOCKED', when: 'A posted move falls in a closed period.', next: 'Choose an open date.' },
    ],
  },
};

export const assetUndoTransferInput = assetPath;

export const assetUndoTransferCommand: CommandDefinition<typeof assetUndoTransferInput, Record<string, unknown>> = {
  name: 'asset.undotransfer',
  input: assetUndoTransferInput,
  roles: [...WRITERS],
  async handler(ctx, _tx, input) {
    return undoTransfer(ctx.db, { workspaceId: ctx.workspaceId, assetId: input.assetId, uid: ctx.actor, email: ctx.email }) as Promise<Record<string, unknown>>;
  },
  async preview() {
    return { title: 'Undo the latest move', lines: ['Its entry is voided while its date is open'] };
  },
  audit() { return null; },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Undo the latest move of a fixed asset while its date is open; do not use it to edit the asset by hand.',
    example: { assetId: 'asset_123' },
    refusals: [{ code: 'NOT_FOUND', when: 'The asset is not in this workspace.', next: 'Check the asset in this workspace.' }],
  },
};

// --------------------------------------------------------------------------- place in service / undo

export const assetPlaceInServiceInput = assetPath.extend({
  date: z.string().max(10),
  assetAccountId: z.string().min(1).max(200),
  usefulLifeYears: z.number().gt(0).max(100).optional(),
  salvageValueCents: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
}).strict();

type AssetPlaceInServiceInput = z.output<typeof assetPlaceInServiceInput>;

export const assetPlaceInServiceCommand: CommandDefinition<typeof assetPlaceInServiceInput, Record<string, unknown>> = {
  name: 'asset.placeservice',
  input: assetPlaceInServiceInput,
  roles: [...WRITERS],
  async handler(ctx, _tx, input: AssetPlaceInServiceInput) {
    const { workspaceId: _bodyWorkspaceId, assetId, ...rest } = input;
    if (!DAY.test(input.date)) throw Object.assign(new Error('Choose the day and the account it belongs in'), { status: 400 });
    return placeInService(ctx.db, { workspaceId: ctx.workspaceId, assetId, uid: ctx.actor, email: ctx.email, ...rest }) as Promise<Record<string, unknown>>;
  },
  async preview(_ctx, input) {
    return {
      title: 'Place the asset in service',
      lines: [`On ${input.date}`, 'One entry moves it out of construction in progress', 'Depreciation starts from the month it is in service'],
    };
  },
  audit() { return null; },
  inverse(input, result) { return result ? { command: 'asset.undoplaceservice', input: { assetId: input.assetId } } : null; },
  risk: 'normal',
  describe: {
    sentence: 'Place an asset that was built rather than bought in service, starting its depreciation; do not use it to buy an asset.',
    example: { assetId: 'asset_123', date: '2026-06-30', assetAccountId: 'acc_equipment' },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The date is missing or not a real day, or no account is chosen.', next: 'Send a real date and the balance-sheet account it belongs in.' },
      { code: 'PERIOD_LOCKED', when: 'The date is in a closed period.', next: 'Choose an open date.' },
    ],
  },
};

export const assetUndoPlaceInServiceInput = assetPath;

export const assetUndoPlaceInServiceCommand: CommandDefinition<typeof assetUndoPlaceInServiceInput, Record<string, unknown>> = {
  name: 'asset.undoplaceservice',
  input: assetUndoPlaceInServiceInput,
  roles: [...WRITERS],
  async handler(ctx, _tx, input) {
    return undoPlaceInService(ctx.db, { workspaceId: ctx.workspaceId, assetId: input.assetId, uid: ctx.actor, email: ctx.email }) as Promise<Record<string, unknown>>;
  },
  async preview() {
    return { title: 'Undo placing it in service', lines: ['Only while nothing happened to the asset since'] };
  },
  audit() { return null; },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Undo placing an asset in service while nothing has happened to it since; do not use it to change depreciation by hand.',
    example: { assetId: 'asset_123' },
    refusals: [{ code: 'CONFLICT', when: 'Depreciation or another change was posted since.', next: 'Undo that later work first.' }],
  },
};

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

/**
 * The six service-backed life-cycle moves, in the list the registry iterates. `asset.costaddition` is deliberately not
 * here: it keeps its own read inside the runner's transaction and writes its own audit line, which those six leave to
 * their services.
 */
export const ASSET_COMMANDS: AnyCommandDefinition[] = [
  assetDisposeCommand, assetUndoDisposalCommand,
  assetTransferCommand, assetUndoTransferCommand,
  assetPlaceInServiceCommand, assetUndoPlaceInServiceCommand,
];
