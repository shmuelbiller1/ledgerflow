/**
 * Two workspace-wide housekeeping writes: renaming a tag everywhere, and filing a tax return.
 *
 * Both already had a service that owns the work and the words it refuses with — `tagService` and
 * `taxReturnService` — so the command is the registered door in front of them: a name, a schema, the
 * roles, and the runner's workspace and role checks in one order. `tag.change` reports how many rows
 * carried the name; `tax.file` answers the return it filed, and neither can be undone by sending the
 * inverse (a merged tag cannot be told apart from a tag that was always called that, and a filed
 * return is a dated record), so both are one-way.
 */
import { z } from 'zod';
import { changeTag } from '../services/tagService';
import { fileTaxReturn } from '../services/taxReturnService';
import type { AnyCommandDefinition, CommandDefinition } from './types';

const YMD = /^\d{4}-\d{2}-\d{2}$/;

// --------------------------------------------------------------------------- tag.change

export const tagChangeInput = z.object({
  workspaceId: z.string().min(1).max(200).optional(),
  from: z.string().min(1).max(50),
  /** the new name, or null to take the tag off every row that carries it */
  to: z.string().max(50).nullable(),
}).strict();

export const tagChangeCommand: CommandDefinition<typeof tagChangeInput, { changed: number }> = {
  name: 'tag.change',
  input: tagChangeInput,
  roles: ['owner', 'accountant', 'bookkeeper'],
  async handler(ctx, _tx, input) {
    const changed = await changeTag(ctx.db, ctx.workspaceId, input.from, input.to, { uid: ctx.actor, email: ctx.email });
    return { changed };
  },
  async preview(_ctx, input) {
    return {
      title: input.to === null ? `Remove the tag "${input.from}"` : `Rename "${input.from}" to "${input.to}"`,
      lines: [
        'Every invoice, bill, entry, contact and document carrying the tag is updated',
        input.to === null ? 'The rows stay; only the label comes off' : 'A name that is already in use is merged into it',
      ],
    };
  },
  audit() { return null; },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Rename a tag across the workspace, merge it into an existing name, or remove it from every row; do not use it to change what a row is — only the label it carries.',
    example: { from: 'Travel', to: 'Travel & meals' },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The old name is blank, the new name is longer than 50 characters, or the body has an extra field.', next: 'Send just `from` and `to` (null removes the tag).' },
      { code: 'FORBIDDEN', when: 'The caller is a viewer.', next: 'Ask an owner, accountant or bookkeeper.' },
    ],
  },
};

// --------------------------------------------------------------------------- tax.file

export const taxFileInput = z.object({
  workspaceId: z.string().min(1).max(200).optional(),
  startDate: z.string().regex(YMD),
  endDate: z.string().regex(YMD),
  reference: z.string().max(100).optional(),
  /** CON-4b: the registration the return is for ('vat:IL:514000001'); absent: the whole workspace */
  registration: z.string().max(120).regex(/^[a-z_]+:[^:]{2,60}:[^:]{1,40}$/).optional(),
}).strict();

export const taxFileCommand: CommandDefinition<typeof taxFileInput, Record<string, unknown>> = {
  name: 'tax.file',
  input: taxFileInput,
  roles: ['owner', 'accountant'],
  async handler(ctx, _tx, input) {
    return fileTaxReturn(ctx.db, {
      workspaceId: ctx.workspaceId, uid: ctx.actor, startDate: input.startDate, endDate: input.endDate,
      ...(input.reference !== undefined ? { reference: input.reference } : {}),
      ...(input.registration !== undefined ? { registration: input.registration } : {}),
    }) as Promise<Record<string, unknown>>;
  },
  async preview(ctx, input) {
    return {
      title: `File the tax return for ${input.startDate} to ${input.endDate}`,
      lines: [
        input.registration ? `For ${input.registration}` : 'For the whole workspace',
        'The return is computed from the filed ledger and kept as a dated record',
      ],
      accounts: [],
    };
  },
  audit() { return null; },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Compute and keep the tax return for a period you name; do not use it to correct a return already filed — file a later one that covers the correction.',
    example: { startDate: '2026-01-01', endDate: '2026-03-31', reference: 'Q1 2026' },
    refusals: [
      { code: 'INVALID_INPUT', when: 'A date is not YYYY-MM-DD, the period is backwards, or the registration is not shaped like `vat:XX:123`.', next: 'Send both dates and, if you mean one registration, its full id.' },
      { code: 'NOT_FOUND', when: 'The registration is not one this workspace holds for that period.', next: 'Check the registration id on the tax profile, or leave it out to file for the whole workspace.' },
      { code: 'FORBIDDEN', when: 'The caller is a bookkeeper or a viewer.', next: 'Ask an owner or an accountant.' },
    ],
  },
};

export const TAX_COMMANDS: AnyCommandDefinition[] = [tagChangeCommand, taxFileCommand];
