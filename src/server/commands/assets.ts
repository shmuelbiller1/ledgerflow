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
 */
import { z } from 'zod';
import { disposeAsset, undoDisposal } from '../services/assetDisposalService';
import { transferAsset, undoTransfer } from '../services/assetTransferService';
import { placeInService, undoPlaceInService } from '../services/placeInServiceService';
import type { AnyCommandDefinition, CommandDefinition } from './types';

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
  inverse(_input, result) { return result ? { command: 'asset.undispose', input: {} } : null; },
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
  inverse(_input, result) { return result ? { command: 'asset.undotransfer', input: {} } : null; },
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
  inverse(_input, result) { return result ? { command: 'asset.undoplaceservice', input: {} } : null; },
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

export const ASSET_COMMANDS: AnyCommandDefinition[] = [
  assetDisposeCommand, assetUndoDisposalCommand,
  assetTransferCommand, assetUndoTransferCommand,
  assetPlaceInServiceCommand, assetUndoPlaceInServiceCommand,
];
