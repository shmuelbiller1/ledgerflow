/**
 * ISS-143 (GitHub #143): return authorizations (RMAs) are requested and moved on by the server, in one database
 * transaction each, instead of by browser writes to the customer's metadata (which a migration now refuses:
 * 20261022000000_rma_server_only.sql). Every rule is checked against what is in the database at that moment:
 *   - who acts, and with which role, comes from the workspace's own membership, never from the request;
 *   - a request is for an issued invoice of that customer; each line's sold quantity, item and description come
 *     from the invoice; quantities are whole hundredths; and with every earlier RMA on the invoice that was not
 *     declined (requested, approved, received or closed all keep their units) the total never exceeds what was sold;
 *   - approve and decline are for an owner or accountant who did not request it; receive needs an approved RMA;
 *     closing links a real credit note of the same workspace, customer and invoice (not draft or void);
 *   - each action names the status it expects (compare-and-swap): two approvers, or a retry after another person
 *     acted, cannot both change it;
 *   - each call carries a request key: the same key again returns the first answer and changes nothing.
 * The transitions themselves are src/lib/warehouseRecords.ts's (createReturnAuthorization,
 * transitionReturnAuthorization); nothing here moves stock or posts to the ledger.
 */
import type { Firestore } from '../db/firestore';
import { workspaceRole } from '../../lib/periodLock';
import { formatTzDate } from '../../lib/calendarDate';
import {
  createReturnAuthorization, returnAuthorizationCapacityProblem, returnAuthorizationId, returnAuthorizationNumber,
  returnAuthorizationsFromMetadata, rmaFieldPath, transitionReturnAuthorization,
  type ReturnAuthorizationAction, type ReturnAuthorizationRecord, type ReturnAuthorizationRequestLine, type ReturnAuthorizationStatus,
} from '../../lib/warehouseRecords';
import { randomWarehouseToken } from '../../lib/warehouseRecordUtils';
import { writeServerAuditLog } from './auditLogService';
import type { CreditNote, EntityMetadata } from '../../types';

export class ReturnAuthorizationError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'ReturnAuthorizationError';
  }
}

const UNISSUED = new Set(['draft', 'rejected', 'void', 'cancelled']);
const KEY = /^[A-Za-z0-9_-]{8,100}$/;

export interface RmaResult { record: ReturnAuthorizationRecord; replayed: boolean }

interface Actor { uid: string; name?: string }

const keyRef = (db: Firestore, workspaceId: string, requestKey: string) => {
  if (!KEY.test(requestKey)) throw new ReturnAuthorizationError(400, 'A request key (8–100 letters, digits, - or _) is required');
  return db.collection('idempotencyKeys').doc(`${workspaceId}_rma_${requestKey}`);
};

export async function requestReturnAuthorization(db: Firestore, input: {
  workspaceId: string; actor: Actor; customerId: string; invoiceId: string; reason: string;
  lines: Array<{ invoiceLineId: string; quantity: number }>; requestKey: string;
}): Promise<RmaResult> {
  const idem = keyRef(db, input.workspaceId, input.requestKey);
  return db.runTransaction(async t => {
    const done = await t.get(idem);
    if (done.exists) return { record: done.data()!.record as ReturnAuthorizationRecord, replayed: true };
    const workspace = (await t.get(db.collection('workspaces').doc(input.workspaceId))).data();
    if (!workspace) throw new ReturnAuthorizationError(404, 'Workspace not found');
    const role = workspaceRole(workspace as never, input.actor.uid);
    const customerRef = db.collection('customers').doc(input.customerId);
    const customer = (await t.get(customerRef)).data();
    const invoice = (await t.get(db.collection('invoices').doc(input.invoiceId))).data();
    if (!customer || customer.workspaceId !== input.workspaceId) throw new ReturnAuthorizationError(404, 'That customer is not in this workspace');
    if (!invoice || invoice.workspaceId !== input.workspaceId || invoice.customerId !== input.customerId) throw new ReturnAuthorizationError(404, 'That invoice is not this customer\'s in this workspace');
    if (UNISSUED.has(String(invoice.status))) throw new ReturnAuthorizationError(409, 'Only an issued invoice can have goods returned against it');

    // each line as the invoice says it: what was sold, the item and its description
    const items = Array.isArray(invoice.items) ? invoice.items as Array<{ id?: string; itemId?: string; description?: string; quantity?: number }> : [];
    const lines: ReturnAuthorizationRequestLine[] = (input.lines || []).map(l => {
      const sold = items.find(i => i.id === l.invoiceLineId);
      if (!sold || !sold.itemId) throw new ReturnAuthorizationError(400, 'Each line must be a stock line of the invoice');
      return { invoiceLineId: l.invoiceLineId, itemId: sold.itemId, description: String(sold.description || 'Inventory item'), quantity: Number(l.quantity), soldQuantity: Number(sold.quantity) };
    });
    const existing = returnAuthorizationsFromMetadata(customer.metadata as EntityMetadata | undefined, input.customerId, input.workspaceId);
    const capacity = returnAuthorizationCapacityProblem({ workspaceId: input.workspaceId, customerId: input.customerId, invoiceId: input.invoiceId, lines }, existing);
    if (capacity) throw new ReturnAuthorizationError(409, capacity);

    const at = new Date().toISOString();
    let id = '';
    let number = '';
    for (let attempt = 0; attempt < 4 && !id; attempt++) {
      const token = randomWarehouseToken();
      const candidate = returnAuthorizationId(token);
      const candidateNumber = returnAuthorizationNumber(formatTzDate(new Date(), String(workspace.timezone || 'UTC')), token);
      if (!existing.some(r => r.id === candidate || r.number === candidateNumber)) { id = candidate; number = candidateNumber; }
    }
    if (!id) throw new ReturnAuthorizationError(409, 'Could not make a unique RMA number; try again');
    let record: ReturnAuthorizationRecord;
    try {
      record = createReturnAuthorization({
        id, number, workspaceId: input.workspaceId, customerId: input.customerId, customerName: String(customer.name || ''),
        invoiceId: input.invoiceId, invoiceNumber: String(invoice.number || input.invoiceId), reason: input.reason, lines,
        actor: { uid: input.actor.uid, name: input.actor.name || '', role }, at,
      });
    } catch (err) {
      throw new ReturnAuthorizationError(400, err instanceof Error ? err.message : String(err));
    }
    t.update(customerRef, { [rmaFieldPath(id)]: record });
    t.set(idem, { workspaceId: input.workspaceId, kind: 'rma-request', record, createdAt: at, actor: input.actor.uid });
    await writeServerAuditLog({
      workspaceId: input.workspaceId, uid: input.actor.uid, action: 'RMA_REQUESTED', entityType: 'customers', entityId: input.customerId,
      details: { description: `${number} requested for invoice ${record.invoiceNumber}`, rmaId: id, lines: record.lines.map(l => ({ invoiceLineId: l.invoiceLineId, quantity: l.quantity })) },
    }, { db, tx: t });
    return { record, replayed: false };
  });
}

export async function moveReturnAuthorization(db: Firestore, input: {
  workspaceId: string; actor: Actor; customerId: string; rmaId: string; expectedStatus: ReturnAuthorizationStatus;
  action: 'approve' | 'decline' | 'receive' | 'link-credit-note'; note?: string; creditNoteId?: string; requestKey: string;
}): Promise<RmaResult> {
  const idem = keyRef(db, input.workspaceId, input.requestKey);
  return db.runTransaction(async t => {
    const done = await t.get(idem);
    if (done.exists) return { record: done.data()!.record as ReturnAuthorizationRecord, replayed: true };
    const workspace = (await t.get(db.collection('workspaces').doc(input.workspaceId))).data();
    if (!workspace) throw new ReturnAuthorizationError(404, 'Workspace not found');
    const role = workspaceRole(workspace as never, input.actor.uid);
    const customerRef = db.collection('customers').doc(input.customerId);
    const customer = (await t.get(customerRef)).data();
    if (!customer || customer.workspaceId !== input.workspaceId) throw new ReturnAuthorizationError(404, 'That customer is not in this workspace');
    const record = returnAuthorizationsFromMetadata(customer.metadata as EntityMetadata | undefined, input.customerId, input.workspaceId).find(r => r.id === input.rmaId);
    if (!record) throw new ReturnAuthorizationError(404, 'That RMA is not this customer\'s');
    if (record.status !== input.expectedStatus) throw new ReturnAuthorizationError(409, `This RMA is ${record.status} now, not ${input.expectedStatus}: someone else acted on it. Reload and look again.`);

    let action: ReturnAuthorizationAction;
    if (input.action === 'link-credit-note') {
      const credit = input.creditNoteId ? (await t.get(db.collection('creditNotes').doc(input.creditNoteId))).data() : undefined;
      if (!credit || credit.workspaceId !== input.workspaceId) throw new ReturnAuthorizationError(404, 'That credit note is not in this workspace');
      action = { type: 'link-credit-note', creditNote: { ...(credit as CreditNote), id: input.creditNoteId! }, ...(input.note ? { note: input.note } : {}) };
    } else if (input.action === 'decline') {
      action = { type: 'decline', note: input.note || '' };
    } else {
      action = { type: input.action, ...(input.note ? { note: input.note } : {}) };
    }
    const moved = transitionReturnAuthorization(record, action, { uid: input.actor.uid, name: input.actor.name || '', role }, new Date().toISOString());
    if (!moved.ok) throw new ReturnAuthorizationError(/owner or accountant|requested an RMA|workspace editor/.test(moved.reason) ? 403 : 409, moved.reason);
    t.update(customerRef, { [rmaFieldPath(record.id)]: moved.record });
    t.set(idem, { workspaceId: input.workspaceId, kind: 'rma-transition', record: moved.record, createdAt: new Date().toISOString(), actor: input.actor.uid });
    await writeServerAuditLog({
      workspaceId: input.workspaceId, uid: input.actor.uid, action: `RMA_${moved.record.status.toUpperCase()}`, entityType: 'customers', entityId: input.customerId,
      details: { description: `${record.number}: ${record.status} → ${moved.record.status}`, rmaId: record.id, ...(moved.record.linkedCreditNoteId ? { creditNoteId: moved.record.linkedCreditNoteId } : {}) },
    }, { db, tx: t });
    return { record: moved.record, replayed: false };
  });
}
