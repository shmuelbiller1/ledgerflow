import { z } from 'zod';
import { HttpError } from '../auth/requestUser';
import { writeServerAuditLog } from '../services/auditLogService';
import type { CommandContext, CommandDefinition } from './types';

/**
 * A note in the audit trail written by the person who did the thing.
 *
 * `transactionActions` recorded "the entry was updated" and "the entry was reversed" by `addDoc`-ing into
 * `auditLogs` from the tab. That is the one collection where a browser write is *actively* wrong: the trail is a
 * hash chain (`buildAuditLogRecord` stamps `seq`, `prevHash`, `chainHash` and `entryHash`), so a row added by the
 * client has no chain position — either the verifier skips it, or it breaks the chain for everything after it. The
 * row also carried the tab's own `uid` and clock.
 *
 * So the note is a command: the caller says *what* happened (`action`, the entity, and the details the screen already
 * showed), and the server says *who* and *when* — the actor and the chain position come from the session and the
 * trail itself.
 *
 * What it refuses: an unresolvable action name, and details that are not a flat record of primitives (a nested blob
 * is how an audit line becomes unreadable a year later). It is deliberately not a general write: there is no field
 * for `timestamp`, `uid`, `seq` or any hash, so a caller cannot place its own note in the chain.
 */
const idSchema = z.string().trim().max(400);
const ACTION = /^[A-Z][A-Z0-9_]{2,63}$/;

export const auditAppendInput = z.object({
  /** the trail's own vocabulary: `UPDATE_TRANSACTION`, `TRANSACTION_REVERSED`, `DELETE_EMPTY_ACCOUNT`… */
  action: z.string().trim().regex(ACTION, 'An audit action is upper case letters, digits and underscores'),
  entityType: z.string().trim().min(1).max(80),
  entityId: idSchema,
  /** the human sentence the screen showed; the existing trail puts it in `details.description` */
  description: z.string().trim().max(500).optional(),
  details: z.record(z.string(), z.union([z.string().max(500), z.number(), z.boolean(), z.null()])).optional(),
}).strict();

type AppendInput = z.output<typeof auditAppendInput>;
export type AuditAppended = { id: string; action: string };

/** Any member who can change a record can say so; a viewer has nothing to note. */
const ROLES = ['owner', 'accountant', 'bookkeeper'] as const;

export const auditAppendCommand: CommandDefinition<typeof auditAppendInput, AuditAppended> = {
  name: 'audit.append',
  input: auditAppendInput,
  roles: ROLES,
  async handler(ctx: CommandContext, tx, input: AppendInput) {
    if (input.details && Object.keys(input.details).length > 40) {
      throw Object.assign(new HttpError('An audit note carries at most 40 detail fields.', 400), { code: 'INVALID_INPUT' });
    }
    const details = {
      ...(input.details || {}),
      description: input.description || `${input.action} on ${input.entityType} ${input.entityId}`,
    };
    const id = await writeServerAuditLog({
      workspaceId: ctx.workspaceId,
      uid: ctx.actor,
      email: ctx.user.email || '',
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      details,
    }, { db: ctx.db, tx });
    if (!id) throw Object.assign(new HttpError('The audit trail could not take the note.', 503), { code: 'UNAVAILABLE' });
    return { id, action: input.action };
  },
  async preview(_ctx: CommandContext, input: AppendInput) {
    return {
      title: `Note “${input.action}” in the audit trail`,
      lines: [input.description || `${input.entityId}`, 'who and when are stamped on the server'],
    };
  },
  /** the note *is* an audit line; writing another one about it would be a note about a note */
  audit() { return null; },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Add one hash-chained line to the workspace audit trail, stamped with the caller and the server clock; do not use it to write books — a posting is its own command and writes its own line.',
    example: { action: 'UPDATE_TRANSACTION', entityType: 'transaction', entityId: 'tx-1', description: 'Changed the category' },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The action is not upper case letters, digits and underscores, or the details are nested or more than 40 fields.', next: 'Send a flat record of strings, numbers, booleans or nulls.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is a viewer.', next: 'A viewer can read the trail but has no change of their own to note.' },
      { code: 'UNAVAILABLE', when: 'The audit trail is not writable in this environment.', next: 'Retry once; if it stays unavailable the change itself should be treated as failed.' },
    ],
  },
};
