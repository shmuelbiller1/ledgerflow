import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { FieldValue } from '../db/firestore';
import { getShardedCounterValue, stageShardedCounterIncrement } from '../services/shardedCounterService';
import { COMMAND_ROLES, type CommandDefinition } from './types';

const input = z.object({
  algorithmName: z.string().min(1),
  complexityFormat: z.string().optional(),
  // The old endpoint also receives numeric strings. Normalize after validation for both paths.
  weightScore: z.union([z.number(), z.string()]).nullish(),
  executionTimeMs: z.union([z.number(), z.string()]).nullish(),
}).strict();

// Only the old HTTP address accepts arbitrary JSON here: it checked the name for presence,
// stored the two labels as supplied, and coerced weight/time with Number(). Keep the generated
// command schema strict and share the transaction, audit and calculation between both doors.
const legacyInput = z.object({
  algorithmName: z.unknown().refine(Boolean),
  complexityFormat: z.unknown().optional(),
  weightScore: z.unknown().optional(),
  executionTimeMs: z.unknown().optional(),
}).strict();

const normalized = (value: unknown, fallback: number, max: number) =>
  Math.max(1, Math.min(max, Math.floor(Math.abs(Number(value) || fallback))));
const weight = (value: unknown) => normalized(value, 10, 1000);
const quota = (value: number) => Math.round(value * 0.1);

type ComputeResult = {
  traceRecord: Record<string, unknown> & { id: string };
  updatedMetrics: Record<string, number>;
};

const compute: Omit<CommandDefinition<typeof legacyInput, ComputeResult>, 'input'> = {
  name: 'billing.recordcompute', roles: COMMAND_ROLES, allowPlatformAdmin: true,
  async handler({ db, workspace, workspaceId, actor, email }, tx, fields) {
    const weightScore = weight(fields.weightScore);
    const executionTimeMs = normalized(fields.executionTimeMs, 50, 60_000);
    const quotaCents = quota(weightScore);
    const wsData = workspace as Record<string, number | undefined>;
    const [queries, credits] = await Promise.all([
      getShardedCounterValue(db, workspaceId, 'totalQueriesThisMonth', wsData.totalQueriesThisMonth || 0, tx),
      getShardedCounterValue(db, workspaceId, 'computeCreditBalance', wsData.computeCreditBalance ?? 100_000, tx),
    ]);
    const ref = db.collection('billingLedgerTraces').doc();
    const traceRecord = {
      id: ref.id, workspaceId, uid: actor, userEmail: email, algorithmName: fields.algorithmName,
      complexityFormat: fields.complexityFormat, weightScore, executionTimeMs, timestamp: new Date().toISOString(),
      hash: createHash('sha256').update(`${workspaceId}-${fields.algorithmName}-${weightScore}-${randomUUID()}`).digest('hex'),
    };
    tx.create(ref, traceRecord);
    stageShardedCounterIncrement(db, tx, workspaceId, 'totalQueriesThisMonth', 1);
    stageShardedCounterIncrement(db, tx, workspaceId, 'computeCreditBalance', -weightScore);
    tx.update(db.collection('workspaces').doc(workspaceId), {
      apiQuotaTotalCentsUsed: FieldValue.increment(quotaCents),
      computeHardnessScore: FieldValue.increment(weightScore),
    });
    return { traceRecord, updatedMetrics: {
      apiQuotaTotalCentsUsed: (wsData.apiQuotaTotalCentsUsed || 0) + quotaCents,
      totalQueriesThisMonth: queries + 1,
      computeHardnessScore: (wsData.computeHardnessScore || 0) + weightScore,
      computeCreditBalance: Math.max(0, credits - weightScore),
    } };
  },
  async preview(_ctx, fields) {
    const units = weight(fields.weightScore);
    return { title: `Record a computation: ${fields.algorithmName}`, lines: [`${units} compute credits`, `${quota(units)} usage cents`, 'Does not post a journal entry or change the plan.'] };
  },
  audit: (_input, { traceRecord }) => ({
    action: 'COMPUTE_RECORDED', entityType: 'billingLedgerTraces', entityId: traceRecord.id,
    description: 'Recorded one completed computation', details: { weightScore: traceRecord.weightScore },
  }),
  risk: 'normal',
  describe: {
    sentence: 'Record usage for one already completed computation; do not use this to call an AI provider, change the plan, or post a ledger entry.',
    example: { algorithmName: 'LABEL_SUGGESTIONS', complexityFormat: 'O(n)', weightScore: 25, executionTimeMs: 80 },
    refusals: [
      { code: 'NOT_A_MEMBER', when: 'The caller does not belong to the target workspace.', next: 'Use a workspace you belong to.' },
      { code: 'INVALID_INPUT', when: 'The computation has no name or a usage number is malformed.', next: 'Supply the computation name and measured weight and time.' },
    ],
  },
};

export const billingRecordComputeCommand = { ...compute, input } satisfies CommandDefinition<typeof input, ComputeResult>;
export const legacyBillingRecordComputeCommand = { ...compute, input: legacyInput };
