/**
 * Return authorizations (ISS-143): a customer's request to send goods back against an invoice, and the
 * moves it goes through (approved, declined, received, closed, or linked to a credit note). Each request
 * carries its own `requestKey`, so a retry answers the same record instead of creating a second one —
 * the service owns that idempotency record and its audit line, inside its own transaction.
 */
import { z } from 'zod';
import { moveReturnAuthorization, requestReturnAuthorization } from '../services/returnAuthorizationService';
import type { AnyCommandDefinition, CommandDefinition } from './types';

const WRITERS = ['owner', 'accountant', 'bookkeeper'] as const;
const id = z.string().min(1).max(200);
const requestKey = z.string().regex(/^[A-Za-z0-9_-]{8,100}$/);

const ACTIONS = ['approve', 'decline', 'receive', 'link-credit-note'] as const;
const STATUSES = ['requested', 'approved', 'declined', 'received', 'closed'] as const;

export const rmaRequestInput = z.object({
  workspaceId: z.string().min(1).max(200).optional(),
  customerId: id,
  invoiceId: id,
  reason: z.string().max(1000),
  lines: z.array(z.object({ invoiceLineId: id, quantity: z.number().positive() }).strict()).min(1).max(200),
  requestKey,
}).strict();

export const rmaRequestCommand: CommandDefinition<typeof rmaRequestInput, Record<string, unknown>> = {
  name: 'rma.request',
  input: rmaRequestInput,
  roles: [...WRITERS],
  async handler(ctx, _tx, input) {
    return requestReturnAuthorization(ctx.db, {
      workspaceId: ctx.workspaceId,
      actor: { uid: ctx.actor, name: String(ctx.user.displayName || ctx.email || '') },
      customerId: input.customerId, invoiceId: input.invoiceId, reason: input.reason,
      lines: input.lines, requestKey: input.requestKey,
    }) as unknown as Promise<Record<string, unknown>>;
  },
  async preview(_ctx, input) {
    return {
      title: 'Ask for the goods back',
      lines: [
        `Against invoice ${input.invoiceId}, ${input.lines.length} line(s)`,
        'The customer keeps the RMA number; nothing is posted until it is received',
      ],
    };
  },
  audit() { return null; },
  inverse(_input, result) {
    const record = (result as { record?: { id?: string; customerId?: string } }).record;
    if (!record?.id) return null;
    // an RMA move needs its own request key; one derived from the record makes the undo repeatable
    // (a retried undo answers the same transition instead of declining a second time)
    return {
      command: 'rma.move',
      input: {
        rmaId: record.id, customerId: record.customerId, action: 'decline', expectedStatus: 'requested',
        requestKey: `undo_${record.id}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 100),
      },
    };
  },
  risk: 'normal',
  describe: {
    sentence: 'Record a customer’s request to return goods against an issued invoice and give it an RMA number; do not use it to post the credit — the goods are received first.',
    example: { customerId: 'cust_123', invoiceId: 'invoice_123', reason: 'Damaged in transit', lines: [{ invoiceLineId: 'line_1', quantity: 2 }], requestKey: 'rma-2026-06-30-1' },
    refusals: [
      { code: 'INVALID_INPUT', when: 'A line is not a stock line of the invoice, or the request key is not 8–100 letters, digits, - or _.', next: 'Send stock lines of that invoice and a fresh request key.' },
      { code: 'CONFLICT', when: 'The invoice is not issued, or more is returned than was sold.', next: 'Return no more than the invoice still sold.' },
      { code: 'NOT_FOUND', when: 'The customer or the invoice is not in this workspace.', next: 'Check the customer and invoice in this workspace.' },
    ],
  },
};

export const rmaMoveInput = z.object({
  workspaceId: z.string().min(1).max(200).optional(),
  customerId: id,
  rmaId: id,
  action: z.enum(ACTIONS),
  expectedStatus: z.enum(STATUSES),
  note: z.string().max(1000).optional(),
  creditNoteId: id.optional(),
  requestKey,
}).strict();

export const rmaMoveCommand: CommandDefinition<typeof rmaMoveInput, Record<string, unknown>> = {
  name: 'rma.move',
  input: rmaMoveInput,
  roles: [...WRITERS],
  async handler(ctx, _tx, input) {
    return moveReturnAuthorization(ctx.db, {
      workspaceId: ctx.workspaceId,
      actor: { uid: ctx.actor, name: String(ctx.user.displayName || ctx.email || '') },
      customerId: input.customerId, rmaId: input.rmaId, action: input.action,
      expectedStatus: input.expectedStatus, note: input.note, creditNoteId: input.creditNoteId,
      requestKey: input.requestKey,
    }) as unknown as Promise<Record<string, unknown>>;
  },
  async preview(_ctx, input) {
    return {
      title: `Move the RMA to ${input.action}`,
      lines: [`Only while it is ${input.expectedStatus}`, 'The move is kept on the customer with who made it and when'],
    };
  },
  audit() { return null; },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Move a return authorization on — approve it, decline it, record the goods received, or link the credit note; do not use it to skip receiving the goods before a credit note.',
    example: { customerId: 'cust_123', rmaId: 'rma_123', action: 'approve', expectedStatus: 'requested', requestKey: 'rma-approve-1' },
    refusals: [
      { code: 'CONFLICT', when: 'Someone else moved it since it was read (it is no longer the expected status).', next: 'Reload the RMA and look again.' },
      { code: 'FORBIDDEN', when: 'The caller may not approve or close this RMA.', next: 'Ask an owner or an accountant.' },
      { code: 'NOT_FOUND', when: 'The RMA is not this customer’s, or not in this workspace.', next: 'Check the customer and the RMA number.' },
    ],
  },
};

export const RMA_COMMANDS: AnyCommandDefinition[] = [rmaRequestCommand, rmaMoveCommand];
