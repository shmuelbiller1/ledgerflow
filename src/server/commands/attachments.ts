import { z } from 'zod';
import { mayRemoveAttachment } from '../../lib/attachments';
import { CommandRefusal } from '../utils/commandExecutor';
import { HttpError } from '../auth/requestUser';
import type { CommandContext, CommandDefinition } from './types';

/**
 * A file kept with the books: the Vault's uploads, the receipt a person snapped, the invoice a record was attached to.
 *
 * Three screens wrote this collection with `addDoc` and one rewrote it with `updateDoc`, and every one of them sent
 * `uid`, `workspaceId` and `createdAt` from the tab. Two things that costs, both quiet:
 *
 * - the row could name another workspace, so `documents` was the one collection where a tab could file something into
 *   a book it could not otherwise write;
 * - the timestamp was the device's, which is how a receipt ends up dated before the bill it justifies.
 *
 * So there is one command for both halves of the act: a new document (`saveDocument` in the screens) and a link from
 * an existing one to the record it belongs to (`linkDocument`). The second is why `name` is optional when `id` is
 * named — linking a receipt to the draft bill it became must not require re-sending the file.
 *
 * What it is **not**: the upload. `fileUrl` is what the storage step already produced (a data URI or a signed URL);
 * this writes the row that points at it. Nothing here posts, posts nothing to the ledger, and a document never
 * carries a balance.
 */
const idSchema = z.string().trim().min(1).max(200).refine(id => !id.includes('/'), 'Id cannot contain a slash');
const text = (max: number) => z.string().trim().max(max);

export const documentSaveInput = z.object({
  /** present when an existing document is being linked to a record; absent when a new one is written */
  id: idSchema.optional(),
  name: text(200).min(1).optional(),
  /** the storage answer: a data URI or a URL; the row points at it and never contains the file twice */
  fileUrl: text(8_000_000).min(1).optional(),
  mimeType: text(120).optional(),
  sizeBytes: z.number().int().min(0).max(200_000_000).optional(),
  tags: z.array(text(60)).max(20).optional(),
  /** what filed it (a vault upload, a snapped receipt, an attachment), kept for the list's own grouping */
  source: text(60).optional(),
  /** the record this file belongs to: both halves, or neither */
  linkedCollection: text(60).optional(),
  linkedId: text(200).optional(),
  linkedLabel: text(120).optional(),
  /** the entry a vault document was posted to, once the person injects it into the ledger */
  linkedTransactionId: text(200).optional(),
}).strict()
  .refine(input => (input.linkedCollection === undefined) === (input.linkedId === undefined),
    'A document is linked to a record by naming both the collection and the record.')
  .refine(input => input.id !== undefined || (input.name !== undefined && input.fileUrl !== undefined),
    'A new document needs its name and the file it points at.');

type SaveInput = z.output<typeof documentSaveInput>;
const ROLES = ['owner', 'accountant', 'bookkeeper'] as const;
export type DocumentSaved = { id: string; created: boolean };

const EVIDENCE_LINK_FIELDS = ['linkedTransactionId', 'linkedCollection', 'linkedId'] as const;
const EVIDENCE_FILE_FIELDS = ['fileUrl', 'storagePath', 'mimeType', 'sizeBytes'] as const;

export const documentSaveCommand: CommandDefinition<typeof documentSaveInput, DocumentSaved> = {
  name: 'document.save',
  input: documentSaveInput,
  roles: ROLES,
  async handler(ctx: CommandContext, tx, input: SaveInput) {
    const now = new Date().toISOString();
    const { id, ...fields } = input;
    // #912: evidence can only point at a real entry of these books
    const linkTarget = typeof fields.linkedTransactionId === 'string' ? fields.linkedTransactionId.trim() : '';
    if (linkTarget) {
      const entry = await tx.get(ctx.db.collection('transactions').doc(linkTarget));
      if (!entry.exists || (entry.data() as Record<string, unknown> | undefined)?.workspaceId !== ctx.workspaceId) {
        throw Object.assign(new HttpError('That journal entry is not in this workspace.', 409), { code: 'LINK_TARGET_NOT_FOUND' });
      }
    }
    if (!id) {
      const ref = ctx.db.collection('documents').doc();
      const rowId = (ref as unknown as { id: string }).id;
      tx.set(ref, {
        ...fields,
        id: rowId,
        uid: ctx.actor,
        workspaceId: ctx.workspaceId,
        createdAt: now,
        updatedAt: now,
      });
      return { id: rowId, created: true };
    }
    const ref = ctx.db.collection('documents').doc(id);
    const snapshot = await tx.get(ref);
    const existing = snapshot.data() as Record<string, unknown> | undefined;
    if (!snapshot.exists || existing?.workspaceId !== ctx.workspaceId) {
      throw Object.assign(new HttpError('This document is not in the selected workspace.', 404), { code: 'NOT_FOUND' });
    }
    // #912 (and Gitar on #989): on another member's document, a bookkeeper may fill in a link that is not
    // set yet (attaching an unlinked vault file), but moving an existing link or replacing the file is an
    // owner's or accountant's decision
    if (existing.uid !== ctx.actor && ctx.role !== 'owner' && ctx.role !== 'accountant') {
      const sent = fields as Record<string, unknown>;
      const changes = (key: string) => key in sent && (sent[key] ?? null) !== (existing[key] ?? null);
      const movesLink = EVIDENCE_LINK_FIELDS.some(key => changes(key) && (existing[key] ?? null) !== null && existing[key] !== '');
      const replacesFile = EVIDENCE_FILE_FIELDS.some(changes);
      if (movesLink || replacesFile) {
        throw Object.assign(new HttpError('Only an owner or accountant can move or replace another member\'s document.', 403), { code: 'ROLE_REQUIRED' });
      }
    }
    tx.update(ref, { ...fields, updatedAt: now });
    return { id, created: false };
  },
  async preview(ctx: CommandContext, input: SaveInput) {
    if (!input.id) return { title: `Keep the file “${input.name || ''}”`, lines: [input.mimeType || 'a file', input.linkedLabel ? `with ${input.linkedLabel}` : 'not linked to a record yet'] };
    const snapshot = await ctx.db.collection('documents').doc(input.id).get();
    if (!snapshot.exists) throw new HttpError('This document is not in the selected workspace.', 404);
    return { title: `Change the document ${input.id}`, lines: Object.keys(input).filter(key => key !== 'id') };
  },
  audit(_input: SaveInput, result: DocumentSaved) {
    return {
      action: result.created ? 'DOCUMENT_SAVED' : 'DOCUMENT_LINKED',
      entityType: 'documents',
      entityId: result.id,
      description: result.created ? `Kept the document ${result.id}` : `Changed the document ${result.id}`,
    };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Keep a file with the books (a vault upload, a snapped receipt, an attachment) or link an existing one to the record it belongs to; do not use it to upload — the storage step produces the file first.',
    example: { name: 'receipt.jpg', fileUrl: 'https://…/receipt.jpg', mimeType: 'image/jpeg', linkedCollection: 'bills', linkedId: 'bill_1' },
    refusals: [
      { code: 'INVALID_INPUT', when: 'A new document has no name or no file, or a link names only half of what it points at.', next: 'Send the name and the file for a new document, and both the collection and the record for a link.' },
      { code: 'NOT_FOUND', when: 'The document being changed is not in the selected workspace.', next: 'Reload the documents and choose one in this workspace.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is a viewer.', next: 'Ask an owner, accountant or bookkeeper to keep the file.' },
    ],
    next: [{ command: 'bill.create', label: 'Record the bill it supports' }],
  },
};

const documentRemoveInput = z.object({ id: z.string().min(1).describe('Id of the attachment row, not the linked record') }).strict();
type AttachmentRow = { uid?: string; workspaceId?: string; name?: string; linkedCollection?: string; linkedId?: string; linkedLabel?: string };
type RemovedAttachment = { id: string; file: Omit<AttachmentRow, 'uid' | 'workspaceId'> };

function checkRemoval(ctx: Pick<CommandContext, 'workspaceId' | 'role' | 'actor'>, file: AttachmentRow | undefined) {
  if (!file || file.workspaceId !== ctx.workspaceId) {
    throw new CommandRefusal('That file is not in this workspace (already removed?)', 404, 'NOT_FOUND');
  }
  if (!mayRemoveAttachment(ctx.role, ctx.actor, { uid: String(file.uid || '') })) {
    throw new CommandRefusal('Only the person who added it, or an owner, accountant or bookkeeper, can remove it', 403, 'NOT_UPLOADER');
  }
  return file;
}

export const documentRemoveCommand: CommandDefinition<typeof documentRemoveInput, RemovedAttachment> = {
  name: 'document.remove',
  input: documentRemoveInput,
  peopleOnly: true,
  roles: [...ROLES, 'viewer'],
  async handler(ctx, tx, { id }) {
    const ref = ctx.db.collection('documents').doc(id);
    const { name, linkedCollection, linkedId, linkedLabel } = checkRemoval(ctx, (await tx.get(ref)).data() as AttachmentRow | undefined);
    tx.delete(ref);
    return { id, file: { name, linkedCollection, linkedId, linkedLabel } };
  },
  async preview(ctx, { id }) {
    const file = checkRemoval(ctx, (await ctx.db.collection('documents').doc(id).get()).data() as AttachmentRow | undefined);
    return {
      title: `Remove the file “${file.name || id}”`,
      lines: [file.linkedLabel ? `From ${file.linkedLabel}` : 'From the workspace files', 'The related record and its ledger entries are not removed.'],
    };
  },
  audit(_input, { id, file }) {
    return {
      action: 'attachment.removed',
      entityType: file.linkedCollection || 'documents',
      entityId: file.linkedId || id,
      description: `Removed the file "${file.name || id}"${file.linkedLabel ? ` from ${file.linkedLabel}` : ''}`,
      details: { attachmentId: id, name: file.name || null },
    };
  },
  risk: 'normal',
  describe: {
    sentence: 'Remove a file from the workspace or its linked record; this does not delete the invoice, bill or other record itself.',
    example: { id: 'attachment_1' },
    refusals: [
      { code: 'NOT_FOUND', when: 'The file is not in the current workspace, or was already removed.', next: 'Reload the workspace’s files.' },
      { code: 'NOT_UPLOADER', when: 'A viewer tries to remove someone else’s file.', next: 'Ask the uploader or a workspace writer to remove it.' },
    ],
  },
};
