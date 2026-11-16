import { z } from 'zod';
import { formatTzDate } from '../../lib/calendarDate';
import {
  formatDocumentNumber,
  highestUsed,
  numberingAuditSummary,
  NUMBERED_TYPES,
  resolveSeries,
  updateNumberingInTransaction,
  usedDocumentNumbers,
  type NumberedType,
  type NumberingUpdateResult,
} from '../services/numberingService';
import type { CommandDefinition } from './types';

export const numberingTypeInput = z.enum(NUMBERED_TYPES as unknown as [NumberedType, ...NumberedType[]]);

/** The same strict series shape accepted by the legacy PUT /numbering/:type endpoint. */
export const numberingSeriesInput = z.object({
  prefix: z.string().max(20).regex(/^[\p{L}\p{N} _\-/.#]*$/u, 'Use letters, digits, spaces and - _ / . #'),
  nextNumber: z.number().int().min(1).max(999_999_999),
  padding: z.number().int().min(1).max(10),
}).strict();

export const numberingUpdateInput = numberingSeriesInput.extend({ type: numberingTypeInput }).strict();
type NumberingUpdateInput = z.output<typeof numberingUpdateInput>;

export const numberingUpdateCommand: CommandDefinition<typeof numberingUpdateInput, NumberingUpdateResult> = {
  name: 'numbering.update',
  input: numberingUpdateInput,
  roles: ['owner', 'accountant'],
  async handler(ctx, tx, input: NumberingUpdateInput) {
    return updateNumberingInTransaction(ctx.db, tx, {
      workspaceId: ctx.workspaceId,
      uid: ctx.actor,
      email: ctx.email,
      ...input,
    });
  },
  async preview(ctx, input: NumberingUpdateInput) {
    const today = formatTzDate(new Date());
    const stored = (await ctx.db.collection('numberingSeries').doc(`${ctx.workspaceId}_${input.type}`).get()).data();
    const before = resolveSeries(input.type, stored, ctx.workspace, today);
    const highestForNewPrefix = highestUsed(await usedDocumentNumbers(ctx.db, ctx.workspaceId, input.type), input.prefix);
    const proposed = { prefix: input.prefix, nextNumber: input.nextNumber, padding: input.padding };
    const collision = input.nextNumber <= highestForNewPrefix;
    return {
      title: `Change ${input.type} document numbering`,
      lines: [
        `Current next number: ${formatDocumentNumber(before)}`,
        `Proposed next number: ${formatDocumentNumber(proposed)}`,
        `Highest number already used with the proposed prefix: ${highestForNewPrefix}`,
        collision
          ? `${formatDocumentNumber(proposed, highestForNewPrefix)} is already used; start at ${highestForNewPrefix + 1} or higher`
          : 'The proposed next number is unused',
      ],
    };
  },
  audit(input, result) {
    const summary = numberingAuditSummary(input, result);
    return {
      action: summary.action,
      entityType: summary.entityType,
      entityId: summary.entityId,
      description: summary.description,
      details: summary.details,
    };
  },
  inverse(_input, result) {
    if (result.before.nextNumber <= result.previousHighestUsed) return null;
    return {
      command: 'numbering.update',
      input: {
        type: result.series.type,
        prefix: result.before.prefix,
        nextNumber: result.before.nextNumber,
        padding: result.before.padding,
      },
    };
  },
  risk: 'normal',
  describe: {
    sentence: 'Set the prefix and next unused number for one document series; do not use this to renumber documents that have already been issued.',
    example: { type: 'invoice', prefix: 'INV-2027-', nextNumber: 1, padding: 4 },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The type, prefix, number, or padding is malformed.', next: 'Use a supported document type, an allowed prefix, a positive next number, and 1–10 padding digits.' },
      { code: 'NUMBER_ALREADY_USED', when: 'The requested next number is already used with the proposed prefix.', next: 'Choose a next number greater than the highest number already used with that prefix.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is not a workspace owner or accountant.', next: 'Ask an owner or accountant to change document numbering.' },
      { code: 'UNAUTHENTICATED', when: 'The request has no valid signed-in user or API key.', next: 'Sign in or use a valid API key.' },
      { code: 'NOT_A_MEMBER', when: 'The caller is not a member of this workspace.', next: 'Choose a workspace the caller belongs to.' },
      { code: 'WORKSPACE_NOT_FOUND', when: 'The workspace no longer exists.', next: 'Choose an existing workspace.' },
      { code: 'WORKSPACE_SCOPE', when: 'An API key is scoped to a different workspace.', next: 'Use a key scoped to this workspace.' },
      { code: 'INVALID_OPERATION_ID', when: 'The retry key is malformed.', next: 'Use an operation key of 1–128 letters, digits, underscores, dots, colons, or hyphens.' },
      { code: 'CONFLICT', when: 'An idempotency key was already used for a different numbering change.', next: 'Use a new idempotency key for a new change; reuse the old key only to retry the identical request.' },
    ],
  },
};
