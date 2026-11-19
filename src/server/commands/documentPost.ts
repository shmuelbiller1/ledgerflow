import { z } from 'zod';
import { commitPreparedDocumentPost, prepareDocumentRequest, previewDocumentPost,
  type DocumentPostInput, type DocumentPostResult, type PreparedDocumentRequest } from '../services/documentPostService';
import { requestPayloadHash } from '../utils/idempotency';
import type { CommandContext, CommandDefinition } from './types';

export const postedDocumentType = z.enum(['invoices', 'bills', 'creditNotes', 'vendorCredits']);
export const legacyDocumentBody = z.object({
  workspaceId: z.string().min(1).max(200),
  action: z.enum(['create', 'update', 'delete']),
  data: z.record(z.string(), z.unknown()).optional(),
  // The service accepts a day only if within one day of its own (L-94).
  postingDay: z.string().max(10).optional(),
  creditLimitOverride: z.object({ reason: z.string().trim().min(1).max(500) }).strict().optional(),
}).strict();

const inputSchema = legacyDocumentBody.partial({ workspaceId: true }).extend({
  collection: postedDocumentType,
  docId: z.string().min(1).describe('ID of the invoice, bill, credit note or vendor credit being posted'),
});
type Input = z.output<typeof inputSchema>;

function postInput(ctx: Pick<CommandContext, 'workspaceId'>, input: Input, idempotencyKey?: string): DocumentPostInput {
  return { ...input, workspaceId: ctx.workspaceId, data: input.action === 'delete' ? {} : input.data || {}, idempotencyKey };
}

export const documentPostCommand: CommandDefinition<typeof inputSchema, DocumentPostResult, PreparedDocumentRequest> = {
  name: 'document.post',
  input: inputSchema,
  roles: ['owner', 'accountant', 'bookkeeper'],
  allowPlatformAdmin: true,
  idempotencyHash(_ctx, input) {
    const { postingDay: _day, ...hashed } = input;
    return requestPayloadHash(hashed);
  },
  prepare: (ctx, input) => prepareDocumentRequest(ctx.db, ctx.user, postInput(ctx, input)),
  async handler(ctx, tx) {
    const prepared = ctx.prepared as PreparedDocumentRequest;
    return 'replay' in prepared ? prepared.replay : commitPreparedDocumentPost(ctx.db, ctx.user, prepared.plan, { transaction: tx, afterCommit: ctx.afterCommit });
  },
  async preview(ctx, input) {
    return previewDocumentPost(ctx.db, ctx.user, postInput(ctx, input));
  },
  audit(input, result) {
    if (!result.committed || input.action === 'delete') return null; // deletion is already audited with its snapshot by the ledger service
    return {
      action: input.action === 'create' ? 'DOCUMENT_CREATED' : 'DOCUMENT_UPDATED', entityType: input.collection, entityId: input.docId,
      description: `${input.action === 'create' ? 'Created' : 'Updated'} ${input.collection}/${input.docId} using server posting`,
      details: { postingCount: result.transactions.length },
    };
  },
  risk: 'normal',
  describe: {
    sentence: 'Save or delete a supported document using server-built postings; never send prebuilt entries, and prefer the type-specific invoice, bill or credit commands for new integrations.',
    example: { collection: 'invoices', docId: 'inv_1', action: 'update', data: { customerName: 'Example Co' } },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The document family, ID, action or data is invalid.', next: 'Send only the document and its intended action.' },
      { code: 'CONFLICT', when: 'The books closed, a settlement or another edit prevents the change, or the retry key refers to another request.', next: 'Reload the document and review the posting refusal before retrying.' },
    ],
  },
};

/** No new caller can supply a legacy shared retry key in command input. */
export function documentPostWithLegacyKey(idempotencyKey: string | undefined): typeof documentPostCommand {
  if (!idempotencyKey) return documentPostCommand;
  return { ...documentPostCommand, prepare: (ctx, input) => prepareDocumentRequest(ctx.db, ctx.user, postInput(ctx, input, idempotencyKey)) };
}
