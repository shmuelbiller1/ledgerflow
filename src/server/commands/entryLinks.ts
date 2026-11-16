import { z } from 'zod';
import { ENTRY_LINK_KIND, MAX_LINK_NOTE, type EntryLink } from '../../lib/entryLinks';
import { workspaceRole } from '../../lib/periodLock';
import { linksOf, linkEntriesInTransaction, unlinkEntriesInTransaction, LinkError } from '../services/entryLinkService';
import type { CommandDefinition } from './types';

export const entryLinkCreateInput = z.object({
  a: z.unknown().optional(),
  b: z.unknown().optional(),
  note: z.unknown().optional(),
}).strict();
export const entryLinkRemoveInput = z.object({ linkId: z.string().min(1).max(200) }).strict();

type EntryLinkCreateInput = z.output<typeof entryLinkCreateInput>;
type EntryLinkRemoveInput = z.output<typeof entryLinkRemoveInput>;
type EntryLinkCreateResult = { link: EntryLink; created: boolean };

function validateLinkInput(input: EntryLinkCreateInput): asserts input is EntryLinkCreateInput & { a: string; b: string } {
  if (typeof input.a !== 'string' || typeof input.b !== 'string' || !input.a || !input.b) throw new LinkError(400, 'Choose the two entries');
  if (input.a === input.b) throw new LinkError(400, 'An entry is not linked to itself');
  if (input.note !== undefined && (typeof input.note !== 'string' || input.note.length > MAX_LINK_NOTE)) {
    throw new LinkError(400, `Keep the note under ${MAX_LINK_NOTE} characters`);
  }
}

export const entryLinkCreateCommand: CommandDefinition<typeof entryLinkCreateInput, EntryLinkCreateResult> = {
  name: 'entrylink.create',
  input: entryLinkCreateInput,
  roles: ['owner', 'accountant', 'bookkeeper'],
  async handler(ctx, tx, input: EntryLinkCreateInput) {
    return linkEntriesInTransaction(ctx.db, tx, {
      workspaceId: ctx.workspaceId, uid: ctx.actor, email: ctx.email,
      a: input.a, b: input.b, note: input.note,
    });
  },
  async preview(ctx, input) {
    validateLinkInput(input);
    const [a, b] = await ctx.db.getAll(
      ctx.db.collection('transactions').doc(input.a),
      ctx.db.collection('transactions').doc(input.b),
    );
    if (!a.exists || a.data()?.workspaceId !== ctx.workspaceId || !b.exists || b.data()?.workspaceId !== ctx.workspaceId) {
      throw new LinkError(404, 'Both entries must be in this workspace');
    }
    const existing = await linksOf(ctx.db, { workspaceId: ctx.workspaceId, uid: ctx.actor, transactionId: input.a });
    const link = existing.find(item => (item.a === input.a && item.b === input.b) || (item.a === input.b && item.b === input.a));
    return {
      title: link ? 'Entries are already linked' : 'Link two entries',
      lines: [
        `${input.a} ↔ ${input.b}`,
        ...(typeof input.note === 'string' && input.note.trim() ? [`Note: ${input.note.trim()}`] : []),
      ],
    };
  },
  audit(_input, result) {
    if (!result.created) return null;
    return {
      action: 'ENTRIES_LINKED',
      entityType: 'transactions',
      entityId: result.link.a,
      description: `${result.created ? 'Linked two entries' : 'Entries were already linked'}${result.link.note ? `: ${result.link.note}` : ''}`,
      details: { otherEntry: result.link.b },
    };
  },
  inverse(_input, result) {
    return result.created ? { command: 'entrylink.remove', input: { linkId: result.link.id } } : null;
  },
  risk: 'normal',
  describe: {
    sentence: 'Add a note-only relationship between two ledger entries in this workspace; do not use this to post, reverse, or otherwise change either entry.',
    example: { a: 'transaction_sale', b: 'transaction_refund', note: 'Refund of the sale' },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The entries are missing, identical, or the note is too long.', next: 'Choose two different entry ids and use a note of at most 300 characters.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is not an owner, accountant, or bookkeeper.', next: 'Ask a workspace bookkeeper or above to link the entries.' },
      { code: 'NOT_FOUND', when: 'One or both entries are not in this workspace.', next: 'Reload the workspace and select two existing entries.' },
      { code: 'CONFLICT', when: 'One entry already has the maximum number of links.', next: 'Remove an old link before adding another.' },
    ],
  },
};

export const entryLinkRemoveCommand: CommandDefinition<typeof entryLinkRemoveInput, EntryLink> = {
  name: 'entrylink.remove',
  input: entryLinkRemoveInput,
  roles: ['owner', 'accountant', 'bookkeeper'],
  async handler(ctx, tx, input: EntryLinkRemoveInput) {
    return unlinkEntriesInTransaction(ctx.db, tx, {
      workspaceId: ctx.workspaceId, uid: ctx.actor, email: ctx.email, linkId: input.linkId,
    });
  },
  async preview(ctx, input) {
    const link = (await ctx.db.collection('documents').doc(input.linkId).get()).data() as EntryLink | undefined;
    if (!link || link.kind !== ENTRY_LINK_KIND || link.workspaceId !== ctx.workspaceId) throw new LinkError(404, 'That link is not in this workspace');
    if (!['owner', 'accountant', 'bookkeeper'].includes(workspaceRole(ctx.workspace as never, ctx.actor))) {
      throw new LinkError(403, 'Only owners, accountants and bookkeepers link entries');
    }
    return { title: 'Remove the entry link', lines: [`${link.a} ↔ ${link.b}`, link.note || 'No note'] };
  },
  audit(_input, link) {
    return {
      action: 'ENTRIES_UNLINKED',
      entityType: 'transactions',
      entityId: link.a,
      description: 'Removed the link between two entries',
      details: { otherEntry: link.b },
    };
  },
  inverse(_input, link) {
    return { command: 'entrylink.create', input: { a: link.a, b: link.b, ...(link.note ? { note: link.note } : {}) } };
  },
  risk: 'normal',
  describe: {
    sentence: 'Remove a note-only relationship between two entries; do not use this to edit or delete either ledger entry.',
    example: { linkId: 'entry_link_123' },
    refusals: [
      { code: 'NOT_FOUND', when: 'The link is not in the selected workspace.', next: 'Reload the entry links and choose an existing link.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is not an owner, accountant, or bookkeeper.', next: 'Ask a workspace bookkeeper or above to remove the link.' },
    ],
  },
};
