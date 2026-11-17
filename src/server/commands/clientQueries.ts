/**
 * Client queries (BD-07): a member asks about an entry, any member answers, the asker follows up or
 * anyone with the right role closes it. Only the server writes `clientQueries` — members read them
 * live — so who may do what is decided in `clientQueryService`, which also notifies the other side
 * and writes the audit line, inside its own transaction.
 *
 * The role lists here are the loosest a member could be and still be in the conversation: the service
 * decides who may ask (not a viewer) and who may close (the asker, an owner or an accountant). A
 * narrower list would take those answers away from the service and answer 403 where it answers with
 * its own words.
 */
import { z } from 'zod';
import { askQuery, closeQuery, replyToQuery } from '../services/clientQueryService';
import { MAX_QUESTION, MAX_REPLY } from '../../lib/clientQueries';
import type { AnyCommandDefinition, CommandDefinition } from './types';

const MEMBERS = ['owner', 'accountant', 'bookkeeper', 'viewer'] as const;
const id = z.string().min(1).max(200);

export const queryAskInput = z.object({
  workspaceId: z.string().min(1).max(200).optional(),
  transactionId: id,
  question: z.string().max(MAX_QUESTION + 100),
}).strict();

export const queryAskCommand: CommandDefinition<typeof queryAskInput, Record<string, unknown>> = {
  name: 'query.ask',
  input: queryAskInput,
  roles: [...MEMBERS],
  async handler(ctx, _tx, input) {
    const { workspaceId: _bodyWorkspaceId, ...rest } = input;
    return { query: await askQuery(ctx.db, { ...rest, workspaceId: ctx.workspaceId, uid: ctx.actor, email: ctx.email }) };
  },
  async preview(_ctx, input) {
    return {
      title: 'Ask about the entry',
      lines: [`About ${input.transactionId}`, 'The other side of the books is told, and the question waits for an answer'],
    };
  },
  audit() { return null; },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Ask a client or an accountant about one entry in the books; do not use it to change the entry — the answer is what changes it.',
    example: { transactionId: 'tx_123', question: 'What was this charge for?' },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The question is shorter than three characters or longer than the limit.', next: 'Write the question in a sentence or two.' },
      { code: 'FORBIDDEN', when: 'The caller is a viewer (viewers answer, they do not ask).', next: 'Ask an owner, accountant or bookkeeper to put the question.' },
      { code: 'CONFLICT', when: 'The entry already has the most open questions it may have.', next: 'Close one of them first.' },
    ],
  },
};

export const queryReplyInput = z.object({
  workspaceId: z.string().min(1).max(200).optional(),
  queryId: id,
  text: z.string().max(MAX_REPLY + 100),
}).strict();

export const queryReplyCommand: CommandDefinition<typeof queryReplyInput, Record<string, unknown>> = {
  name: 'query.reply',
  input: queryReplyInput,
  roles: [...MEMBERS],
  async handler(ctx, _tx, input) {
    const { workspaceId: _bodyWorkspaceId, ...rest } = input;
    return { query: await replyToQuery(ctx.db, { ...rest, workspaceId: ctx.workspaceId, uid: ctx.actor, email: ctx.email }) };
  },
  async preview(_ctx, input) {
    return { title: 'Answer the question', lines: [`On ${input.queryId}`, 'The asker is told; a follow-up from the asker puts it back to waiting'] };
  },
  audit() { return null; },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Answer a question about an entry, or follow it up; do not use it to close the conversation — that is query.close.',
    example: { queryId: 'cq_123', text: 'That was the bank fee for the wire.' },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The answer is empty or longer than the limit.', next: 'Write the answer in a sentence or two.' },
      { code: 'CONFLICT', when: 'The question is closed, or the conversation has as many messages as it may have.', next: 'Close it and ask again if it matters.' },
      { code: 'NOT_FOUND', when: 'The question is not in this workspace.', next: 'Check the question in this workspace.' },
    ],
  },
};

export const queryCloseInput = z.object({
  workspaceId: z.string().min(1).max(200).optional(),
  queryId: id,
}).strict();

export const queryCloseCommand: CommandDefinition<typeof queryCloseInput, Record<string, unknown>> = {
  name: 'query.close',
  input: queryCloseInput,
  roles: [...MEMBERS],
  async handler(ctx, _tx, input) {
    await closeQuery(ctx.db, { queryId: input.queryId, workspaceId: ctx.workspaceId, uid: ctx.actor, email: ctx.email });
    return {};
  },
  async preview(_ctx, input) {
    return { title: 'Close the question', lines: [`${input.queryId} leaves the waiting list`, 'Only the asker, an owner or an accountant may close it'] };
  },
  audit() { return null; },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Close a question about an entry once it is answered; do not use it to delete the conversation — it stays in the record.',
    example: { queryId: 'cq_123' },
    refusals: [
      { code: 'FORBIDDEN', when: 'The caller neither asked it nor is an owner or an accountant.', next: 'Ask the person who asked, or an owner, to close it.' },
      { code: 'NOT_FOUND', when: 'The question is not in this workspace.', next: 'Check the question in this workspace.' },
    ],
  },
};

export const CLIENT_QUERY_COMMANDS: AnyCommandDefinition[] = [queryAskCommand, queryReplyCommand, queryCloseCommand];
