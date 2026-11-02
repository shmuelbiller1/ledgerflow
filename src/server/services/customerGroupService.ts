/**
 * CC-11: the workspace's customer groups (src/lib/customerGroups.ts). Only the server writes them
 * (`customerGroups` on the workspace, immutable for users), one change at a time inside a
 * serializable transaction, so two people editing at once each keep their change and a change that
 * no longer fits (the name was taken, the group removed meanwhile) is refused.
 */
import crypto from 'crypto';
import type { Firestore } from '../db/firestore';
import { workspaceRole } from '../../lib/periodLock';
import { isFixedTerm } from '../../lib/paymentTerms';
import { customerGroupNameKey, MAX_CUSTOMER_GROUPS, MAX_CUSTOMER_GROUP_NAME, normalizeCustomerGroups, type CustomerGroup } from '../../lib/customerGroups';
import { writeServerAuditLog } from './auditLogService';

export class CustomerGroupError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'CustomerGroupError';
  }
}

export type CustomerGroupChange =
  | { op: 'add'; name: unknown; paymentTerms?: unknown }
  | { op: 'rename'; id: unknown; name: unknown }
  | { op: 'setTerms'; id: unknown; paymentTerms: unknown }
  | { op: 'remove'; id: unknown };

const cleanName = (name: unknown): string => {
  const clean = typeof name === 'string' ? name.trim() : '';
  if (!clean) throw new CustomerGroupError(400, 'Enter a name');
  if (clean.length > MAX_CUSTOMER_GROUP_NAME) throw new CustomerGroupError(400, `Up to ${MAX_CUSTOMER_GROUP_NAME} characters`);
  return clean;
};
/** '' or null clears the terms; otherwise due on receipt or Net 1–365. */
const termsOf = (terms: unknown): CustomerGroup['paymentTerms'] | undefined => {
  if (terms === undefined || terms === null || terms === '') return undefined;
  if (!isFixedTerm(terms)) throw new CustomerGroupError(400, 'Choose due on receipt or Net 1–365 days');
  return terms;
};
const taken = (list: CustomerGroup[], name: string, exceptId?: string) =>
  list.some(g => g.id !== exceptId && customerGroupNameKey(g.name) === customerGroupNameKey(name));

/** The list after one change, or a CustomerGroupError saying why it does not fit the current list. */
export function applyCustomerGroupChange(current: CustomerGroup[], change: CustomerGroupChange, newId: () => string): { groups: CustomerGroup[]; said: string } {
  if (change.op === 'add') {
    const name = cleanName(change.name);
    const paymentTerms = termsOf(change.paymentTerms);
    if (taken(current, name)) throw new CustomerGroupError(409, `${name} is already a customer group`);
    if (current.length >= MAX_CUSTOMER_GROUPS) throw new CustomerGroupError(409, `Up to ${MAX_CUSTOMER_GROUPS} customer groups`);
    return { groups: [...current, { id: newId(), name, ...(paymentTerms ? { paymentTerms } : {}) }], said: `added ${name}` };
  }
  const target = typeof change.id === 'string' ? current.find(g => g.id === change.id) : undefined;
  if (!target) throw new CustomerGroupError(409, 'That customer group was removed meanwhile');
  if (change.op === 'remove') return { groups: current.filter(g => g.id !== target.id), said: `removed ${target.name}` };
  if (change.op === 'setTerms') {
    const paymentTerms = termsOf(change.paymentTerms);
    const { paymentTerms: _old, ...rest } = target;
    return {
      groups: current.map(g => (g.id === target.id ? { ...rest, ...(paymentTerms ? { paymentTerms } : {}) } : g)),
      said: `${target.name} terms ${paymentTerms || 'cleared'}`,
    };
  }
  const name = cleanName(change.name);
  if (taken(current, name, target.id)) throw new CustomerGroupError(409, `${name} is already a customer group`);
  return { groups: current.map(g => (g.id === target.id ? { ...g, name } : g)), said: `renamed ${target.name} to ${name}` };
}

export async function changeCustomerGroups(db: Firestore, input: { workspaceId: string; uid: string; email?: string; change: CustomerGroupChange }) {
  if (!input.change || !['add', 'rename', 'setTerms', 'remove'].includes((input.change as { op?: string }).op || '')) {
    throw new CustomerGroupError(400, 'Say what to change: add, rename, setTerms or remove');
  }
  return db.runTransaction(async t => {
    const ref = db.collection('workspaces').doc(input.workspaceId);
    const workspace = (await t.get(ref)).data();
    if (!workspace) throw new CustomerGroupError(404, 'Workspace not found');
    const role = workspaceRole(workspace, input.uid);
    if (role !== 'owner' && role !== 'accountant') throw new CustomerGroupError(403, 'Only owners and accountants keep the customer groups');
    const current = normalizeCustomerGroups(workspace.customerGroups);
    const { groups, said } = applyCustomerGroupChange(current, input.change, () => {
      const ids = new Set(current.map(g => g.id));
      for (;;) { const id = `cg_${crypto.randomBytes(8).toString('hex')}`; if (!ids.has(id)) return id; }
    });
    t.update(ref, { customerGroups: groups, updatedAt: new Date().toISOString() });
    await writeServerAuditLog({
      workspaceId: input.workspaceId, uid: input.uid, email: input.email, action: 'CUSTOMER_GROUPS_SET', entityType: 'workspaces', entityId: input.workspaceId,
      details: { description: `Customer groups: ${said}` },
    }, { db, tx: t });
    return { customerGroups: groups };
  });
}
