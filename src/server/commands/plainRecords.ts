import { z } from 'zod';
import { HttpError } from '../auth/requestUser';
import { guardPlainRecordDelete, guardPlainRecordSave } from './plainRecordGuards';
import {
  PLAIN_RECORD_COLLECTIONS, PLAIN_RECORD_SERVER_KEYS, isPlainRecordCollection, type PlainRecordCollection,
} from '../../lib/plainRecords';
import type { CommandContext, CommandDefinition } from './types';

/**
 * An ordinary record, written whole.
 *
 * The three call sites this replaces finished with `setDoc`/`updateDoc`/`deleteDoc` on whatever collection the caller
 * named, from the tab. Between them they sent their own `workspaceId`, `uid` and timestamps, wrote into whatever row
 * the id happened to address — including another workspace's, if the id had been copied between two — and left no audit
 * line. `record.save` and `record.delete` take a collection from the allow-list in `src/lib/plainRecords.ts`, read the
 * row **inside the transaction**, refuse a row that belongs to another workspace, stamp the identity and the clock from
 * the session, and write the audit line.
 *
 * What this is not: a second way to write a ledger collection. `invoices`, `bills`, `transactions`, `journalEntries`,
 * `chartAccounts` and the rest are absent from the list on purpose and refused by name, so the caller is sent to the
 * command that owns the meaning of those rows. Nor is it a way to create a row with an id someone else chose and
 * overwrite it: a create whose id already exists is a `CONFLICT`, never a silent replace.
 */
const idSchema = z.string().trim().min(1).max(400).refine(id => !id.includes('/'), 'Id cannot contain a slash');

const collectionSchema = z.enum([...PLAIN_RECORD_COLLECTIONS] as [PlainRecordCollection, ...PlainRecordCollection[]]);

/** Segments that would walk into the prototype chain instead of into the record. */
const PROTOTYPE_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);
const fieldPathSchema = z.string().trim().min(1).max(200)
  .refine(path => !path.includes('/'), 'A field path cannot contain a slash')
  .refine(path => path.split('.').every(part => !PROTOTYPE_SEGMENTS.has(part)), 'A field path cannot name a prototype key');

export const recordSaveInput = z.object({
  collection: collectionSchema,
  /** absent on a create: the server chooses the id and answers with it */
  id: idSchema.optional(),
  data: z.record(fieldPathSchema, z.unknown())
    .refine(data => JSON.stringify(data).length <= 200_000, 'This record is too large to save here'),
  /**
   * Field paths to remove (`binLocations.store-1` when a bin is cleared). A browser write did this with a delete
   * sentinel; a named command says which fields it is removing, and the record it read is the one it edits.
   */
  unset: z.array(fieldPathSchema).max(50).optional(),
  /** explicit, so "replace this row" and "make this row" are different requests rather than a guess */
  create: z.boolean().optional(),
}).strict().refine(input => Object.keys(input.data).length > 0 || (input.unset?.length ?? 0) > 0,
  { message: 'Send at least one field to write or remove', path: ['data'] });

export const recordDeleteInput = z.object({ collection: collectionSchema, id: idSchema }).strict();

type SaveInput = z.output<typeof recordSaveInput>;
type DeleteInput = z.output<typeof recordDeleteInput>;
type RecordRow = Record<string, unknown>;

export type RecordSaved = { collection: string; id: string; created: boolean; updatedAt: string };
export type RecordDeleted = { collection: string; id: string; deleted: true };

const ROLES = ['owner', 'accountant', 'bookkeeper'] as const;

/** The caller's copy of the server's keys is dropped, so a tab cannot hand a row to another workspace or user. */
function withoutServerKeys(data: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...data };
  for (const key of PLAIN_RECORD_SERVER_KEYS) delete copy[key];
  return copy;
}

/** `binLocations.store-1` → a key inside `binLocations`, not a literal dotted field. */
function setAt(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.').filter(Boolean);
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    // own properties only: `__proto__` on a plain object answers with the prototype of every object in the process
    const child: unknown = Object.hasOwn(cursor, part) ? cursor[part] : undefined;
    if (!child || typeof child !== 'object' || Array.isArray(child)) cursor[part] = {};
    cursor = cursor[part] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]] = value;
}

function unsetAt(target: Record<string, unknown>, path: string): void {
  const parts = path.split('.').filter(Boolean);
  let cursor: Record<string, unknown> | undefined = target;
  for (const part of parts.slice(0, -1)) {
    const child: unknown = cursor && Object.hasOwn(cursor, part) ? cursor[part] : undefined;
    cursor = child && typeof child === 'object' && !Array.isArray(child) ? child as Record<string, unknown> : undefined;
  }
  if (cursor) delete cursor[parts[parts.length - 1]];
}

function collectionRefused(collection: string): HttpError {
  return Object.assign(new HttpError(
    `${collection} is not an ordinary record; use the command that owns it.`,
    400,
  ), { code: 'INVALID_INPUT', field: 'collection' });
}

function idOf(ref: unknown, fallback?: string): string {
  return fallback || String((ref as { id?: unknown }).id || '');
}

export const recordSaveCommand: CommandDefinition<typeof recordSaveInput, RecordSaved> = {
  name: 'record.save',
  input: recordSaveInput,
  roles: ROLES,
  async handler(ctx: CommandContext, tx, input: SaveInput) {
    // the schema already refuses these; the handler says which collection, because a caller reading a refusal wants it
    if (!isPlainRecordCollection(input.collection)) throw collectionRefused(input.collection);
    const ref = input.id ? ctx.db.collection(input.collection).doc(input.id) : ctx.db.collection(input.collection).doc();
    const snapshot = await tx.get(ref);
    const existing = snapshot.exists ? snapshot.data() as RecordRow : undefined;
    if (existing && existing.workspaceId !== ctx.workspaceId) {
      throw Object.assign(new HttpError('This record is not in the selected workspace.', 404), { code: 'NOT_FOUND' });
    }
    // a save that names an id is a save of a record that exists; only an explicit `create` (or an id-less request) makes one
    const create = input.create ?? !input.id;
    const id = idOf(ref, input.id);
    if (create && existing) {
      throw Object.assign(new HttpError('That id is already taken in this collection; open the record instead.', 409), { code: 'CONFLICT', field: 'id' });
    }
    if (!create && !existing) {
      throw Object.assign(new HttpError('This record is not in the selected workspace.', 404), { code: 'NOT_FOUND' });
    }
    const now = new Date().toISOString();
    const data = withoutServerKeys(input.data as Record<string, unknown>);
    // the row this transaction read is the base: a field the caller did not send is untouched, a removed path is
    // removed from the merged copy rather than left as a sentinel the next reader would have to understand
    const merged: RecordRow = create ? {} : { ...(existing ?? {}) };
    for (const [field, value] of Object.entries(data)) setAt(merged, field, value);
    for (const field of input.unset ?? []) unsetAt(merged, field);
    guardPlainRecordSave(input.collection, existing, merged);
    tx.set(ref, create
      ? { ...merged, id, uid: ctx.user.uid, workspaceId: ctx.workspaceId, createdAt: now, updatedAt: now }
      : { ...merged, id, uid: existing?.uid ?? ctx.user.uid, workspaceId: ctx.workspaceId, createdAt: existing?.createdAt ?? now, updatedAt: now });
    return { collection: input.collection, id, created: create, updatedAt: now };
  },
  async preview(ctx: CommandContext, input: SaveInput) {
    const fields = Object.keys(input.data).join(', ');
    if (input.id) {
      const snapshot = await ctx.db.collection(input.collection).doc(input.id).get();
      const existing = snapshot.exists ? snapshot.data() as RecordRow : undefined;
      if (existing && existing.workspaceId !== ctx.workspaceId) throw new HttpError('This record is not in the selected workspace.', 404);
    }
    return { title: `${input.create ? 'Create' : 'Save'} ${input.collection}`, lines: [fields] };
  },
  audit(input: SaveInput, result: RecordSaved) {
    return {
      action: result.created ? 'RECORD_CREATED' : 'RECORD_SAVED',
      entityType: input.collection,
      entityId: result.id,
      description: `${result.created ? 'Created' : 'Saved'} ${input.collection}`,
      details: { fields: Object.keys(input.data).join(', ') },
    };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Create or save a whole ordinary record — a purchase order, a recurring rule, a tax rate, a project, an asset, an estimate, an inventory item or a loan note — and never a ledger collection, whose own command owns the postings.',
    example: { collection: 'purchaseOrders', id: 'po-1', data: { status: 'approved' }, unset: ['binLocations.store-1'] },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The collection is not an ordinary record, the record is empty or too large, or a field name is empty.', next: 'Use the command that owns that collection, or send the fields the screen shows.' },
      { code: 'NOT_FOUND', when: 'The record is not in the selected workspace, or a save names an id that does not exist without asking to create it.', next: 'Reload the list and open a record in this workspace.' },
      { code: 'CONFLICT', when: 'A create names an id that is already taken, or the save changes a field only a ledger command may change (asset depreciation or disposal, stock or cost of a stocked item, an accepted estimate, a received purchase order).', next: 'Open that record and save it, or let the server choose the id.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is a viewer.', next: 'Ask an owner, accountant or bookkeeper to save the record.' },
    ],
  },
};

export const recordDeleteCommand: CommandDefinition<typeof recordDeleteInput, RecordDeleted> = {
  name: 'record.delete',
  input: recordDeleteInput,
  roles: ROLES,
  async handler(ctx: CommandContext, tx, input: DeleteInput) {
    if (!isPlainRecordCollection(input.collection)) throw collectionRefused(input.collection);
    const ref = ctx.db.collection(input.collection).doc(input.id);
    const snapshot = await tx.get(ref);
    const record = snapshot.exists ? snapshot.data() as RecordRow : undefined;
    if (!record || record.workspaceId !== ctx.workspaceId) {
      throw Object.assign(new HttpError('This record is not in the selected workspace.', 404), { code: 'NOT_FOUND' });
    }
    guardPlainRecordDelete(input.collection, record);
    tx.delete(ref);
    return { collection: input.collection, id: input.id, deleted: true as const };
  },
  async preview(ctx: CommandContext, input: DeleteInput) {
    const snapshot = await ctx.db.collection(input.collection).doc(input.id).get();
    const record = snapshot.exists ? snapshot.data() as RecordRow : undefined;
    if (!record || record.workspaceId !== ctx.workspaceId) throw new HttpError('This record is not in the selected workspace.', 404);
    return { title: `Delete ${input.collection}`, lines: [String(record.name || record.number || input.id)] };
  },
  audit(input: DeleteInput) {
    return {
      action: 'RECORD_DELETED',
      entityType: input.collection,
      entityId: input.id,
      description: `Deleted ${input.collection}`,
    };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Delete one ordinary record (a purchase order, a recurring rule, a tax rate, a project, an asset, an estimate, an inventory item or a loan note); a ledger collection is refused and keeps its own command.',
    example: { collection: 'taxRates', id: 'tax-1' },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The collection is not an ordinary record.', next: 'Use the command that owns that collection.' },
      { code: 'NOT_FOUND', when: 'The record is not in the selected workspace.', next: 'Reload the list and try the row you can see.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is a viewer.', next: 'Ask an owner, accountant or bookkeeper to delete it.' },
    ],
  },
};
