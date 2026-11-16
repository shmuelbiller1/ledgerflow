import { z } from 'zod';
import { STAGE_KINDS, stagesProblem, type StageKind, type StageSets } from '../../lib/stages';
import { readStages, defineStagesInTransaction, moveToStageInTransaction, StageError } from '../services/stageService';
import type { CommandDefinition } from './types';

export const stageDefineInput = z.object({ sets: z.unknown().optional() }).strict();
export const stageMoveInput = z.object({ kind: z.unknown().optional(), id: z.unknown().optional(), stage: z.unknown().optional() }).strict();

type StageDefineInput = z.output<typeof stageDefineInput>;
type StageMoveInput = z.output<typeof stageMoveInput>;
type StageDefineResult = Awaited<ReturnType<typeof defineStagesInTransaction>>;
type StageMoveResult = Awaited<ReturnType<typeof moveToStageInTransaction>>;

export const stageDefineCommand: CommandDefinition<typeof stageDefineInput, StageDefineResult> = {
  name: 'stages.define',
  input: stageDefineInput,
  roles: ['owner', 'accountant'],
  async handler(ctx, tx, input: StageDefineInput) {
    return defineStagesInTransaction(ctx.db, tx, {
      workspaceId: ctx.workspaceId, uid: ctx.actor, email: ctx.email, sets: input.sets,
    });
  },
  async preview(ctx, input) {
    const problem = stagesProblem(input.sets);
    if (problem) throw new StageError(400, problem);
    const current = ((await ctx.db.collection('documents').doc(`${ctx.workspaceId}_stageSets`).get()).data()?.sets || {}) as StageSets;
    const sets = input.sets as StageSets;
    return {
      title: 'Define invoice and bill stages',
      lines: STAGE_KINDS.map(kind => `${kind}: ${(current[kind] || []).join(' → ') || 'none'} → ${(sets[kind] || []).join(' → ') || 'none'}`),
    };
  },
  audit(_input, result) {
    return {
      action: 'STAGES_DEFINED',
      entityType: 'documents',
      entityId: result.setsId,
      description: Object.entries(result.sets).map(([kind, stages]) => `${kind}: ${(stages || []).join(' → ') || 'none'}`).join('; '),
    };
  },
  inverse(_input, result) { return { command: 'stages.define', input: { sets: result.previousSets } }; },
  risk: 'normal',
  describe: {
    sentence: 'Define the workspace-specific invoice and bill progress stages without changing document status or the books; do not use it to mark an invoice paid.',
    example: { sets: { invoice: ['Draft', 'For review', 'Sent'], bill: ['Received', 'Checked', 'Ready to pay'] } },
    refusals: [
      { code: 'INVALID_INPUT', when: 'A stage list has an unsupported kind, duplicate, empty name, or more than 12 stages.', next: 'Use only invoice and bill lists with unique names up to 40 characters.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is not an owner or accountant.', next: 'Ask a workspace owner or accountant to define stages.' },
      { code: 'NOT_FOUND', when: 'The workspace no longer exists.', next: 'Choose an existing workspace.' },
    ],
  },
};

export const stageMoveCommand: CommandDefinition<typeof stageMoveInput, StageMoveResult> = {
  name: 'stages.move',
  input: stageMoveInput,
  roles: ['owner', 'accountant', 'bookkeeper'],
  async handler(ctx, tx, input: StageMoveInput) {
    return moveToStageInTransaction(ctx.db, tx, {
      workspaceId: ctx.workspaceId, uid: ctx.actor, email: ctx.email,
      kind: input.kind, id: input.id, stage: input.stage,
    });
  },
  async preview(ctx, input) {
    if (!STAGE_KINDS.includes(input.kind as StageKind) || typeof input.id !== 'string' || !input.id) {
      throw new StageError(400, 'Choose the invoice or bill');
    }
    const current = await readStages(ctx.db, { workspaceId: ctx.workspaceId, uid: ctx.actor, kind: input.kind });
    const table = input.kind === 'invoice' ? 'invoices' : 'bills';
    const record = (await ctx.db.collection(table).doc(input.id).get()).data();
    if (!record || record.workspaceId !== ctx.workspaceId) throw new StageError(404, `That ${input.kind} is not in this workspace`);
    const stages = current.stages;
    if (input.stage !== '' && input.stage !== null && (typeof input.stage !== 'string' || !stages.includes(input.stage))) {
      throw new StageError(400, 'Choose one of the stages');
    }
    return {
      title: `Change ${input.kind} stage`,
      lines: [`${String(record.number || input.id)}: ${String(input.stage || 'no stage')}`],
    };
  },
  audit(_input, result) {
    return {
      action: 'STAGE_CHANGED',
      entityType: result.kind === 'invoice' ? 'invoices' : 'bills',
      entityId: result.id,
      description: `${result.kind === 'invoice' ? 'Invoice' : 'Bill'} ${String(result.record.number || result.id)}: ${result.stage || 'no stage'}`,
    };
  },
  inverse(_input, result) {
    return { command: 'stages.move', input: { kind: result.kind, id: result.id, stage: result.previousStage } };
  },
  risk: 'normal',
  describe: {
    sentence: 'Move an invoice or bill to one of its configured progress stages, or clear the stage; do not use it to change its accounting status.',
    example: { kind: 'bill', id: 'bill_123', stage: 'Checked' },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The record kind, id, or chosen stage is invalid.', next: 'Choose an invoice or bill and one of its configured stages, or send an empty stage to clear it.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is not an owner, accountant, or bookkeeper.', next: 'Ask a workspace bookkeeper or above to move the stage.' },
      { code: 'NOT_FOUND', when: 'The invoice or bill is not in this workspace.', next: 'Reload the workspace and choose an existing document.' },
    ],
  },
};
