/**
 * CC-09: the workspace's payment types (src/lib/paymentTypes.ts). Only the server writes them
 * (`paymentTypes` on the workspace, immutable for users), one change at a time inside a serializable
 * transaction: two people adding, renaming or removing at once each keep their change (a conflicting
 * write is retried against the list as the other left it), and a change that no longer fits is refused.
 */
import crypto from 'crypto';
import type { Firestore } from '../db/firestore';
import { workspaceRole } from '../../lib/periodLock';
import { isPaymentMethod, MAX_PAYMENT_TYPES, MAX_PAYMENT_TYPE_NAME, normalizePaymentTypes, type PaymentType } from '../../lib/paymentTypes';
import { writeServerAuditLog } from './auditLogService';

export class PaymentTypeError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'PaymentTypeError';
  }
}

export type PaymentTypeChange =
  | { op: 'add'; name: unknown; method: unknown }
  | { op: 'rename'; id: unknown; name: unknown }
  | { op: 'remove'; id: unknown };

const cleanName = (name: unknown): string => {
  const clean = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '';
  if (!clean) throw new PaymentTypeError(400, 'Enter a name');
  if (clean.length > MAX_PAYMENT_TYPE_NAME) throw new PaymentTypeError(400, `Up to ${MAX_PAYMENT_TYPE_NAME} characters`);
  return clean;
};
const taken = (list: PaymentType[], name: string, exceptId?: string) =>
  list.some(t => t.id !== exceptId && t.name.toLocaleLowerCase() === name.toLocaleLowerCase());

/** The list after one change, or a PaymentTypeError saying why it does not fit the current list. */
export function applyPaymentTypeChange(current: PaymentType[], change: PaymentTypeChange, newId: () => string): { types: PaymentType[]; said: string } {
  if (change.op === 'add') {
    const name = cleanName(change.name);
    if (!isPaymentMethod(change.method)) throw new PaymentTypeError(400, 'Choose a payment method');
    if (taken(current, name)) throw new PaymentTypeError(409, `${name} is already a payment type`);
    if (current.length >= MAX_PAYMENT_TYPES) throw new PaymentTypeError(409, `Up to ${MAX_PAYMENT_TYPES} payment types`);
    return { types: [...current, { id: newId(), name, method: change.method }], said: `added ${name}` };
  }
  const target = typeof change.id === 'string' ? current.find(t => t.id === change.id) : undefined;
  if (!target) throw new PaymentTypeError(409, 'That payment type was removed meanwhile');
  if (change.op === 'remove') return { types: current.filter(t => t.id !== target.id), said: `removed ${target.name}` };
  const name = cleanName(change.name);
  if (taken(current, name, target.id)) throw new PaymentTypeError(409, `${name} is already a payment type`);
  return { types: current.map(t => (t.id === target.id ? { ...t, name } : t)), said: `renamed ${target.name} to ${name}` };
}

export async function changePaymentTypes(db: Firestore, input: { workspaceId: string; uid: string; email?: string; change: PaymentTypeChange }) {
  if (!input.change || !['add', 'rename', 'remove'].includes((input.change as { op?: string }).op || '')) {
    throw new PaymentTypeError(400, 'Say what to change: add, rename or remove');
  }
  return db.runTransaction(async t => {
    const ref = db.collection('workspaces').doc(input.workspaceId);
    const workspace = (await t.get(ref)).data();
    if (!workspace) throw new PaymentTypeError(404, 'Workspace not found');
    const role = workspaceRole(workspace, input.uid);
    if (role !== 'owner' && role !== 'accountant') throw new PaymentTypeError(403, 'Only owners and accountants keep the payment types');
    const current = normalizePaymentTypes(workspace.paymentTypes);
    const { types, said } = applyPaymentTypeChange(current, input.change, () => {
      const ids = new Set(current.map(x => x.id));
      for (;;) { const id = `pt_${crypto.randomBytes(8).toString('hex')}`; if (!ids.has(id)) return id; }
    });
    t.update(ref, { paymentTypes: types, updatedAt: new Date().toISOString() });
    await writeServerAuditLog({
      workspaceId: input.workspaceId, uid: input.uid, email: input.email, action: 'PAYMENT_TYPES_SET', entityType: 'workspaces', entityId: input.workspaceId,
      details: { description: `Payment types: ${said}` },
    }, { db, tx: t });
    return { paymentTypes: types };
  });
}
