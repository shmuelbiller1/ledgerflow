import { z } from 'zod';
import { HttpError } from '../auth/requestUser';
import type { CommandContext, CommandDefinition } from './types';

/**
 * A quote, and the milestones that bill it — the seven writes `EstimatesView` made by hand.
 *
 * The screen created a quote with `addDoc`, put it through four status moves with `updateDoc` (`accepted` when the
 * customer said yes, `declined`, and `converted` twice: once for a whole-order invoice and once for the last part of a
 * part-invoiced order), and `MilestoneSchedule` / `OrderInvoiceDialog` rewrote the milestone list on the row. Every one
 * of them typed `updatedAt` from the tab, none of them left an audit line, and an estimate id from another workspace
 * was an update anyone could send.
 *
 * Two commands, because there are two things a person does:
 *
 * - `estimate.save` writes the quote itself — a new one (no `id`, with the number the series gave it) or a change to
 *   the terms and lines of one that is still open, and the milestone schedule, which is part of the terms.
 * - `estimate.status` moves a quote through the stages the screen calls: accepted (it becomes an order, with the
 *   customer's reference and who accepted it), declined, or converted (with the invoice it became). Conversion is a
 *   one-way door: a converted estimate cannot go back to a quote, because an invoice already points at it.
 *
 * What it is **not**: an invoice. `estimate.status` with `converted` records which invoice took the quote over; the
 * invoice itself is created by `invoice.create` (the screen calls it first and passes the id here). Nothing here posts,
 * moves a balance or changes a report figure — an estimate is a promise, not a posting.
 */
const idSchema = z.string().trim().min(1).max(200).refine(id => !id.includes('/'), 'Id cannot contain a slash');
const cents = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const text = (max: number) => z.string().trim().max(max);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'A date is YYYY-MM-DD');

const lineSchema = z.object({
  itemId: text(200).optional(),
  description: text(300).min(1),
  quantity: z.number().positive().max(1_000_000),
  unitPriceCents: cents,
  amountCents: cents,
}).strict();

/** A milestone is a share of the order with an optional date; invoicing one writes `invoicedAt`. */
const milestoneSchema = z.object({
  id: z.string().trim().min(1).max(120),
  label: text(80).min(1),
  percent: z.number().positive().max(100),
  due: day.optional(),
  invoicedAt: z.string().trim().max(40).optional(),
}).strict();

const STATUSES = ['draft', 'sent', 'accepted', 'declined', 'converted', 'expired'] as const;

export const estimateSaveInput = z.object({
  /** absent when a new quote is written; present when its terms or milestones change */
  id: idSchema.optional(),
  /** the number the estimate series gave it; required for a new quote, never re-chosen for an existing one */
  number: text(40).optional(),
  /** required when the quote is written (no `id`); a change may name only what it touches */
  customerId: text(200).min(1).optional(),
  customerName: text(200).min(1).optional(),
  date: day.optional(),
  expiryDate: day.optional(),
  amountCents: cents.optional(),
  currency: text(8).min(3).max(8).optional(),
  description: text(400).optional(),
  status: z.enum(STATUSES).optional(),
  lines: z.array(lineSchema).max(500).optional(),
  milestones: z.array(milestoneSchema).max(20).optional(),
}).strict();

export const estimateStatusInput = z.object({
  id: idSchema,
  status: z.enum(['accepted', 'declined', 'converted']),
  /** the customer's own reference, for an accepted order */
  customerReference: text(100).optional(),
  /** the invoice that took the order over, for `converted` */
  convertedInvoiceId: idSchema.optional(),
}).strict();

const ROLES = ['owner', 'accountant', 'bookkeeper'] as const;
type SaveInput = z.output<typeof estimateSaveInput>;
type StatusInput = z.output<typeof estimateStatusInput>;
type EstimateRow = Record<string, unknown> & { id?: string; status?: string };
export type EstimateSaved = { id: string; created: boolean; status: string };

/** Stages a quote can still be rewritten in: once an order is accepted, its terms are what the customer agreed to. */
const EDITABLE = new Set(['draft', 'sent']);

export const estimateSaveCommand: CommandDefinition<typeof estimateSaveInput, EstimateSaved> = {
  name: 'estimate.save',
  input: estimateSaveInput,
  roles: ROLES,
  async handler(ctx: CommandContext, tx, input: SaveInput) {
    const now = new Date().toISOString();
    if (!input.id) {
      const missing = ['number', 'customerId', 'customerName', 'date', 'expiryDate', 'amountCents', 'currency']
        .filter(key => input[key as keyof SaveInput] === undefined);
      if (missing.length > 0) {
        throw Object.assign(new HttpError(
          `A new quote needs the number its series gave it and its terms: ${missing.join(', ')}.`,
          400,
        ), { code: 'INVALID_INPUT' });
      }
      const ref = ctx.db.collection('estimates').doc();
      const id = (ref as unknown as { id: string }).id;
      const { id: _id, ...fields } = input;
      tx.set(ref, {
        ...fields,
        id,
        uid: ctx.actor,
        workspaceId: ctx.workspaceId,
        status: input.status || 'draft',
        createdAt: now,
        updatedAt: now,
      });
      return { id, created: true, status: input.status || 'draft' };
    }
    const ref = ctx.db.collection('estimates').doc(input.id);
    const snapshot = await tx.get(ref);
    const existing = snapshot.data() as EstimateRow | undefined;
    if (!snapshot.exists || existing?.workspaceId !== ctx.workspaceId) {
      throw Object.assign(new HttpError('This quote is not in the selected workspace.', 404), { code: 'NOT_FOUND' });
    }
    if (!EDITABLE.has(String(existing.status || 'draft')) && (input.lines !== undefined || input.amountCents !== undefined)) {
      throw Object.assign(new HttpError(
        `This quote is ${String(existing.status)}, so its lines and total are what the customer agreed to; a change to them is a new quote.`,
        409,
      ), { code: 'CONFLICT' });
    }
    const { id: _id, number: _number, ...fields } = input;
    tx.update(ref, { ...fields, updatedAt: now });
    return { id: input.id, created: false, status: String(fields.status || existing.status || 'draft') };
  },
  async preview(ctx: CommandContext, input: SaveInput) {
    if (!input.id) return { title: `Write quote ${input.number || ''}`, lines: [input.customerName || 'A new quote', `${input.status || 'draft'}, expires ${input.expiryDate || '—'}`] };
    const snapshot = await ctx.db.collection('estimates').doc(input.id).get();
    const existing = snapshot.data() as EstimateRow | undefined;
    if (!snapshot.exists || existing?.workspaceId !== ctx.workspaceId) {
      throw new HttpError('This quote is not in the selected workspace.', 404);
    }
    return {
      title: `Change quote ${String(existing?.number || input.id)}`,
      lines: [input.customerName || String(existing?.customerName || ''), `expires ${input.expiryDate || String(existing?.expiryDate || '—')}`],
    };
  },
  audit(_input: SaveInput, result: EstimateSaved) {
    return {
      action: result.created ? 'ESTIMATE_CREATED' : 'ESTIMATE_UPDATED',
      entityType: 'estimates',
      entityId: result.id,
      description: `${result.created ? 'Wrote' : 'Changed'} the quote ${result.id} (${result.status})`,
    };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Write a quote or change its terms, lines and milestone schedule while it is still a quote; do not use it to invoice it, which invoice.create does.',
    example: { number: 'EST-1042', customerId: 'cust_1', customerName: 'Acme', date: '2026-11-16', expiryDate: '2026-12-16', amountCents: 250000, currency: 'USD' },
    refusals: [
      { code: 'INVALID_INPUT', when: 'A line, a milestone (>20, adding past 100%) or a date is not one the screen could have produced, or a new quote has no number.', next: 'Send the number the series gave it, whole cents, and dates as YYYY-MM-DD.' },
      { code: 'CONFLICT', when: 'The quote is already accepted, declined or converted and the change touches its lines or total.', next: 'Write a new quote; an accepted order\'s terms are what the customer agreed to.' },
      { code: 'NOT_FOUND', when: 'The quote is not in the selected workspace.', next: 'Reload the quotes and choose one in this workspace.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is a viewer.', next: 'Ask an owner, accountant or bookkeeper to write the quote.' },
    ],
    next: [{ command: 'estimate.status', label: 'Accept, decline or convert it' }],
  },
};

export const estimateStatusCommand: CommandDefinition<typeof estimateStatusInput, EstimateSaved> = {
  name: 'estimate.status',
  input: estimateStatusInput,
  roles: ROLES,
  async handler(ctx: CommandContext, tx, input: StatusInput) {
    const ref = ctx.db.collection('estimates').doc(input.id);
    const snapshot = await tx.get(ref);
    const existing = snapshot.data() as EstimateRow | undefined;
    if (!snapshot.exists || existing?.workspaceId !== ctx.workspaceId) {
      throw Object.assign(new HttpError('This quote is not in the selected workspace.', 404), { code: 'NOT_FOUND' });
    }
    const current = String(existing.status || 'draft');
    if (current === 'converted' && input.status !== 'converted') {
      throw Object.assign(new HttpError(
        'This quote became an invoice already; it cannot go back to being a quote or an order.',
        409,
      ), { code: 'CONFLICT' });
    }
    if (input.status === 'converted' && !input.convertedInvoiceId) {
      throw Object.assign(new HttpError('A converted quote names the invoice that took it over.', 400), { code: 'INVALID_INPUT' });
    }
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { status: input.status, updatedAt: now };
    if (input.status === 'accepted') {
      patch.orderedAt = now;
      patch.orderedBy = ctx.actor;
      if (input.customerReference) patch.customerReference = input.customerReference;
    }
    if (input.status === 'converted') patch.convertedInvoiceId = input.convertedInvoiceId;
    tx.update(ref, patch);
    return { id: input.id, created: false, status: input.status };
  },
  async preview(ctx: CommandContext, input: StatusInput) {
    const snapshot = await ctx.db.collection('estimates').doc(input.id).get();
    const existing = snapshot.data() as EstimateRow | undefined;
    if (!snapshot.exists || existing?.workspaceId !== ctx.workspaceId) {
      throw new HttpError('This quote is not in the selected workspace.', 404);
    }
    return {
      title: `Mark quote ${String(existing?.number || input.id)} ${input.status}`,
      lines: [
        input.status === 'accepted' ? 'It becomes an order that can be invoiced in parts' : `It is marked ${input.status}`,
        ...(input.convertedInvoiceId ? [`The invoice that took it over: ${input.convertedInvoiceId}`] : []),
      ],
    };
  },
  audit(_input: StatusInput, result: EstimateSaved) {
    return {
      action: 'ESTIMATE_STATUS',
      entityType: 'estimates',
      entityId: result.id,
      description: `Marked quote ${result.id} ${result.status}`,
    };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Accept a quote as an order, decline it, or record the invoice that converted it; do not use it to create the invoice, which invoice.create does first.',
    example: { id: 'est_1', status: 'accepted', customerReference: 'PO-4471' },
    refusals: [
      { code: 'CONFLICT', when: 'The quote is already converted, or the stage it is in cannot go to the one asked for.', next: 'Write a new quote, or invoice the order instead of re-staging it.' },
      { code: 'INVALID_INPUT', when: 'A conversion does not name the invoice that took the quote over.', next: 'Create the invoice first, then pass its id.' },
      { code: 'NOT_FOUND', when: 'The quote is not in the selected workspace.', next: 'Reload the quotes and choose one in this workspace.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is a viewer.', next: 'Ask an owner, accountant or bookkeeper to move it.' },
    ],
    next: [{ command: 'estimate.save', label: 'Change its terms' }],
  },
};
