import { z } from 'zod';
import { HttpError } from '../auth/requestUser';
import { EDITABLE_RECORD_COLLECTIONS, editableRecordFields, sameRecordValue } from '../../lib/editableRecords';
import { editableValueProblem, recordValueAt } from '../../lib/editableValues';
import type { CommandContext, CommandDefinition } from './types';

/**
 * An ordinary record's own fields, changed one screen at a time.
 *
 * Two screens edit records in place: the inline field on a row (`RecordInlineField`) and the details drawer. Both
 * wrote `updateDoc(doc(db, kind, id), { ...fields, updatedAt: new Date().toISOString() })` straight from the tab, which
 * meant four things the server never saw:
 *
 * - **the allowlist was the tab's.** Each screen had its own list of editable fields; a client that sent `status` on a
 *   quote, `balanceCents` on a customer or a posting date on a document wrote it, and nothing refused.
 * - **`updatedAt` was the device's clock**, and a record could also arrive with `workspaceId`/`uid` of its own.
 * - **"someone else changed it" was a read, a compare and a write** — three round trips, so two tabs could both pass
 *   the compare and both write.
 * - **nothing was audited.** A rename of a customer, a change of its address, a project's budget: none of it left a
 *   line, in a workspace whose ledgers audit everything.
 *
 * The command reads `EDITABLE_RECORD_FIELDS` (in `src/lib/editableRecords.ts`, the same table the two screens use) as
 * the allowlist, so a collection or a field that is not named there cannot be written through this door at all. It
 * re-checks the caller's role on the server, stamps `updatedAt`, writes the audit line, and — when the caller says what
 * it read — refuses with `CONFLICT` in the same transaction that would have written, so the compare and the write
 * cannot be separated by another tab.
 *
 * What it is **not**: a way to change what a record *means*. Amounts on documents, posting dates, balances, quantities,
 * prices and the statuses of documents are absent from the table; those belong to the command that owns them
 * (`invoice.update`, `estimate.status`, `inventoryitem.field`, …).
 */
const idSchema = z.string().trim().min(1).max(400).refine(id => !id.includes('/'), 'Id cannot contain a slash');

/** A field's value: text, a planning amount, an on/off, a whole list (a label's aliases) or an explicit empty. */
const fieldValue = z.union([
  z.string().max(10000),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(z.string().max(400)).max(200),
]);
const fieldPath = z.string().trim().min(1).max(120);

export const recordFieldsInput = z.object({
  collection: z.enum(EDITABLE_RECORD_COLLECTIONS as [string, ...string[]]),
  id: idSchema,
  /** the fields to write, keyed by the name the screens use (`metadata.client` is a path into the record) */
  fields: z.record(fieldPath, fieldValue).refine(fields => Object.keys(fields).length > 0, 'Name at least one field'),
  /** what the caller read for those fields: a mismatch is the "someone changed it" refusal, checked in the transaction */
  expected: z.record(fieldPath, fieldValue).optional(),
}).strict().refine(
  input => Object.keys(input.fields).every(field => editableRecordFields(input.collection).includes(field)),
  { message: 'A field is not editable on this collection; the record’s own command owns it.', path: ['fields'] },
);

type FieldsInput = z.output<typeof recordFieldsInput>;
type RecordRow = Record<string, unknown>;
export type RecordFieldsSaved = { collection: string; id: string; fields: string[]; updatedAt: string };

/** `metadata.client` → `['metadata', 'client']`; a plain name is a one-part path. */
function pathOf(field: string): string[] {
  return field.split('.').filter(Boolean);
}

/** Build the patch, turning `metadata.client` into `{ metadata: { …old, client } }` rather than a literal dotted key. */
function patchOf(current: RecordRow, fields: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(fields)) {
    const parts = pathOf(field);
    if (parts.length === 1) {
      patch[field] = value;
      continue;
    }
    // copy the chain the caller's path runs through, so a nested edit cannot drop a sibling
    let target = patch;
    let source: unknown = current;
    for (const part of parts.slice(0, -1)) {
      const existingChild = source && typeof source === 'object' ? (source as RecordRow)[part] : undefined;
      const child = { ...(existingChild && typeof existingChild === 'object' ? existingChild as RecordRow : {}) };
      const inPatch = target[part];
      target[part] = inPatch && typeof inPatch === 'object' ? inPatch : child;
      target = target[part] as Record<string, unknown>;
      source = existingChild;
    }
    target[parts[parts.length - 1]] = value;
  }
  return patch;
}

/** Everyone who can change a record can change its fields; a viewer reads and is refused. */
const ROLES = ['owner', 'accountant', 'bookkeeper'] as const;

export const recordFieldsCommand: CommandDefinition<typeof recordFieldsInput, RecordFieldsSaved> = {
  name: 'record.fields',
  input: recordFieldsInput,
  roles: ROLES,
  async handler(ctx: CommandContext, tx, input: FieldsInput) {
    const ref = ctx.db.collection(input.collection).doc(input.id);
    const snapshot = await tx.get(ref);
    const record = snapshot.data() as RecordRow | undefined;
    if (!snapshot.exists || record?.workspaceId !== ctx.workspaceId) {
      throw Object.assign(new HttpError('This record is not in the selected workspace.', 404), { code: 'NOT_FOUND' });
    }
    // the schema refuses a field the table does not name; this says *which* one, so the screen can show the reason
    const unknownField = Object.keys(input.fields).find(field => !editableRecordFields(input.collection).includes(field));
    if (unknownField) {
      throw Object.assign(new HttpError(
        `${input.collection} has no editable field called ${unknownField}; the record’s own command owns it.`,
        400,
      ), { code: 'INVALID_INPUT', field: unknownField });
    }
    // a published document keeps the number and dates it was issued with; the screen refuses this, so must the door it
    // cannot skip
    if (input.collection === 'estimates' && record.status !== 'draft') {
      throw Object.assign(new HttpError('Only draft estimates can be edited in place.', 409), { code: 'CONFLICT' });
    }
    // the *value* rules, the same ones the editor applies. A caller that skipped the editor — the SDK, a script — is
    // refused here, with the field named, rather than writing a blank name or a `void` project status
    for (const [field, value] of Object.entries(input.fields)) {
      const problem = editableValueProblem(input.collection, field, value);
      if (problem) {
        throw Object.assign(new HttpError(`${field}: ${problem}`, 400), { code: 'INVALID_INPUT', field });
      }
    }
    // the conflict check and the write are the same transaction: no other tab can slip between them
    for (const [field, expected] of Object.entries(input.expected || {})) {
      const stored = recordValueAt(record, field);
      if (!sameRecordValue(stored, expected)) {
        throw Object.assign(new HttpError(
          `${field} was changed by someone else. Reload its current value before saving.`,
          409,
        ), { code: 'CONFLICT', field });
      }
    }
    const updatedAt = new Date().toISOString();
    tx.update(ref, { ...patchOf(record, input.fields as Record<string, unknown>), updatedAt });
    return { collection: input.collection, id: input.id, fields: Object.keys(input.fields), updatedAt };
  },
  async preview(ctx: CommandContext, input: FieldsInput) {
    const snapshot = await ctx.db.collection(input.collection).doc(input.id).get();
    if (!snapshot.exists || (snapshot.data() as RecordRow)?.workspaceId !== ctx.workspaceId) {
      throw new HttpError('This record is not in the selected workspace.', 404);
    }
    const now = Object.entries(input.fields).map(([field, value]) => `${field} → ${
      typeof value === 'string' ? value.slice(0, 80) : JSON.stringify(value)
    }`);
    return { title: `Change ${Object.keys(input.fields).join(', ')}`, lines: now };
  },
  audit(input: FieldsInput, result: RecordFieldsSaved) {
    return {
      action: 'RECORD_FIELDS_UPDATED',
      entityType: input.collection,
      entityId: input.id,
      description: `Changed ${result.fields.join(', ')} on ${input.collection}`,
      details: { fields: result.fields.join(', ') },
    };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Change the non-financial fields a screen edits in place — a name, an address, a note, a planning budget — and refuse if someone else changed them first; do not use it for an amount on a document, a posting date or a status, which the record’s own command owns.',
    example: { collection: 'customers', id: 'cust-1', fields: { address: '14 Herzl St, Tel Aviv' }, expected: { address: '' } },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The collection is not editable in place, the field is not named for that collection, the value is not text, a number, a switch, a null or a list, or the value breaks the field’s own rule — a blank required name, a negative or fractional planning amount, a status a project does not have, an impossible date, an address-shaped email or a tag Code 128 cannot print.', next: 'Send a field the screen offers with a value its editor would accept, or use the command that owns the field.' },
      { code: 'NOT_FOUND', when: 'The record is not in the selected workspace.', next: 'Reload the list and open a record in this workspace.' },
      { code: 'CONFLICT', when: 'The field no longer holds the value the caller read, or the record is an estimate that is no longer a draft.', next: 'Reload the record, then save again — an issued estimate keeps the number and dates it was issued with.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is a viewer.', next: 'Ask an owner, accountant or bookkeeper to change the record.' },
    ],
  },
};
