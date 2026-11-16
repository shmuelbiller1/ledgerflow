import { z } from 'zod';
import type { Watch } from '../../lib/watches';
import { prepareWatchTarget, unwatchInTransaction, watchRecordInTransaction, WatchError, type PreparedWatchTarget } from '../services/watchService';
import type { CommandDefinition } from './types';

export const watchCreateInput = z.object({ record: z.unknown().optional() }).strict();
export const watchRemoveInput = z.object({ watchId: z.string().min(1).max(200) }).strict();

type WatchCreateInput = z.output<typeof watchCreateInput>;
type WatchRemoveInput = z.output<typeof watchRemoveInput>;
type WatchCreateResult = { watch: Watch; created: boolean };

export const watchCreateCommand: CommandDefinition<typeof watchCreateInput, WatchCreateResult, PreparedWatchTarget> = {
  name: 'watches.create',
  input: watchCreateInput,
  roles: ['owner', 'accountant', 'bookkeeper', 'viewer'],
  async prepare(ctx, input: WatchCreateInput) {
    return prepareWatchTarget(ctx.db, { workspaceId: ctx.workspaceId, uid: ctx.actor, record: input.record });
  },
  async handler(ctx, tx) {
    const prepared = ctx.prepared as PreparedWatchTarget;
    return watchRecordInTransaction(ctx.db, tx, {
      workspaceId: ctx.workspaceId,
      uid: ctx.actor,
      record: prepared.record,
      seenAt: prepared.seenAt,
    });
  },
  async preview(ctx, input) {
    const prepared = await prepareWatchTarget(ctx.db, { workspaceId: ctx.workspaceId, uid: ctx.actor, record: input.record });
    return { title: `Watch ${prepared.record.label}`, lines: [`${prepared.record.type}: ${prepared.record.id}`] };
  },
  audit(_input, result) {
    if (!result.created) return null;
    return {
      action: 'WATCH_STARTED',
      entityType: 'documents',
      entityId: result.watch.id,
      description: `${result.created ? 'Started watching' : 'Already watching'} ${result.watch.record.label}`,
    };
  },
  inverse(_input, result) {
    return result.created ? { command: 'watches.remove', input: { watchId: result.watch.id } } : null;
  },
  risk: 'normal',
  describe: {
    sentence: 'Watch an invoice, bill, ledger entry, account, or item for later change notices; do not use this to edit the record.',
    example: { record: { type: 'invoice', id: 'invoice_123', label: 'Invoice INV-12' } },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The selected record reference or label is malformed.', next: 'Provide a supported record type, its id, and a display label.' },
      { code: 'NOT_FOUND', when: 'The record is not in this workspace.', next: 'Reload the workspace and select an existing record.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is not a member of the workspace.', next: 'Ask a workspace owner to add you before watching records.' },
      { code: 'NOT_A_MEMBER', when: 'The command runner cannot verify the caller as a workspace member.', next: 'Ask a workspace owner to add you, then reload the workspace.' },
      { code: 'CONFLICT', when: 'The caller is already watching the maximum number of records.', next: 'Stop watching an older record first.' },
    ],
  },
};

export const watchRemoveCommand: CommandDefinition<typeof watchRemoveInput, Watch> = {
  name: 'watches.remove',
  input: watchRemoveInput,
  roles: ['owner', 'accountant', 'bookkeeper', 'viewer'],
  async handler(ctx, tx, input: WatchRemoveInput) {
    return unwatchInTransaction(ctx.db, tx, { workspaceId: ctx.workspaceId, uid: ctx.actor, watchId: input.watchId });
  },
  async preview(ctx, input) {
    const watch = (await ctx.db.collection('documents').doc(input.watchId).get()).data() as Watch | undefined;
    if (!watch || watch.kind !== 'watch' || watch.workspaceId !== ctx.workspaceId || watch.watcher !== ctx.actor) {
      throw new WatchError(404, 'You are not watching that');
    }
    return { title: `Stop watching ${watch.record.label}`, lines: [`${watch.record.type}: ${watch.record.id}`] };
  },
  audit(_input, watch) {
    return { action: 'WATCH_STOPPED', entityType: 'documents', entityId: watch.id, description: `Stopped watching ${watch.record.label}` };
  },
  inverse(_input, watch) {
    return { command: 'watches.create', input: { record: watch.record } };
  },
  risk: 'normal',
  describe: {
    sentence: 'Stop receiving change notices for a record you watch; do not use this to delete the record itself.',
    example: { watchId: 'watch_123' },
    refusals: [
      { code: 'NOT_FOUND', when: 'The watch is not yours or no longer exists.', next: 'Reload your watch list and choose one of your active watches.' },
    ],
  },
};
