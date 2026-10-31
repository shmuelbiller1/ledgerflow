import crypto from 'crypto';
import type { Firestore } from '../db/firestore';
import { workspaceRole } from '../../lib/periodLock';
import { SIGN_TOKEN, signatureProblem, signState, type EstimateSignature } from '../../lib/estimateSignature';
import { formatMoney as formatCurrency } from '../../lib/moneyFormat';
import { writeServerAuditLog } from './auditLogService';
import { notify } from './notificationService';

/**
 * Signing an estimate online (Y-20, src/lib/estimateSignature.ts). Writers make the private link
 * (`signToken` on the estimate, written by the server only); the public page reads the estimate by
 * it, and the customer's signature is stamped here: who, when, the address and the browser. The
 * estimate becomes an order (status accepted, `orderedAt`), an audit line is written and the people
 * who keep the books are told. Nothing is posted: an order is invoiced as before.
 */
export class SignError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const WRITERS = ['owner', 'accountant', 'bookkeeper'];

export async function createSignLink(db: Firestore, input: { workspaceId: string; estimateId: string; uid: string; email?: string }, today: string): Promise<{ token: string }> {
  return db.runTransaction(async t => {
    const ws = (await t.get(db.collection('workspaces').doc(input.workspaceId))).data();
    if (!ws) throw new SignError(404, 'Workspace not found');
    if (!WRITERS.includes(workspaceRole(ws as never, input.uid))) throw new SignError(403, 'Only owners, accountants and bookkeepers ask customers to sign');
    const ref = db.collection('estimates').doc(input.estimateId);
    const est = (await t.get(ref)).data();
    if (!est || est.workspaceId !== input.workspaceId) throw new SignError(404, 'That estimate is not in this workspace');
    const state = signState(est, today);
    if (state === 'signed') throw new SignError(409, 'This estimate is already accepted');
    if (state !== 'open') throw new SignError(409, est.status === 'draft' ? 'Send the estimate first (it is a draft)' : 'This estimate can no longer be accepted');
    if (typeof est.signToken === 'string' && SIGN_TOKEN.test(est.signToken)) return { token: est.signToken };
    const token = `es_${crypto.randomBytes(24).toString('hex')}`;
    t.update(ref, { signToken: token, signTokenAt: new Date().toISOString() });
    await writeServerAuditLog({
      workspaceId: input.workspaceId, uid: input.uid, email: input.email, action: 'ESTIMATE_SIGN_LINK', entityType: 'estimates', entityId: input.estimateId,
      details: { description: `Made the signing link of estimate ${String(est.number || input.estimateId)}` },
    }, { db, tx: t });
    return { token };
  });
}

async function byToken(db: Firestore, token: string) {
  if (!SIGN_TOKEN.test(token)) return null;
  const snap = await db.collection('estimates').where('signToken', '==', token).limit(1).get();
  const doc = snap.docs[0];
  return doc ? { ref: doc.ref, est: doc.data() } : null;
}

/** What the customer sees on the signing page; null for a link that is not valid. */
export async function signView(db: Firestore, token: string, today: string) {
  const found = await byToken(db, token);
  if (!found) return null;
  const { est } = found;
  const ws = (await db.collection('workspaces').doc(String(est.workspaceId)).get()).data() || {};
  const lines = Array.isArray(est.lines) ? est.lines as Array<Record<string, unknown>> : [];
  const signature = est.signature as EstimateSignature | undefined;
  return {
    company: String(ws.name || ''),
    number: String(est.number || ''),
    date: String(est.date || '').slice(0, 10),
    expiryDate: est.expiryDate ? String(est.expiryDate).slice(0, 10) : '',
    customerName: String(est.customerName || ''),
    currency: String(est.currency || ws.currency || 'USD'),
    lines: lines.slice(0, 500).map((l, i) => ({ key: `line-${i + 1}`, description: String(l.description || ''), quantity: Number(l.quantity) || 0, amountCents: Number(l.amountCents) || 0 })),
    taxCents: Number(est.taxAmountCents) || 0,
    amountCents: Number(est.amountCents) || 0,
    notes: typeof est.notes === 'string' ? est.notes.slice(0, 2000) : '',
    state: signState(est, today),
    ...(signature ? { signedBy: signature.name, signedAt: signature.signedAt } : {}),
  };
}

export async function signEstimate(db: Firestore, token: string, input: { name?: unknown; agree?: unknown }, evidence: { ip?: string; userAgent?: string }, today: string) {
  const problem = signatureProblem(input);
  if (problem) throw new SignError(400, problem);
  const found = await byToken(db, token);
  if (!found) throw new SignError(404, 'This link is not valid any more. Ask for a new one.');
  const result = await db.runTransaction(async t => {
    const est = (await t.get(found.ref)).data();
    if (!est || est.signToken !== token) throw new SignError(404, 'This link is not valid any more. Ask for a new one.');
    const state = signState(est, today);
    if (state === 'signed') throw new SignError(409, 'This estimate is already accepted');
    if (state !== 'open') throw new SignError(409, state === 'expired' ? 'This estimate has expired. Ask for a new one.' : 'This estimate can no longer be accepted');
    const ws = (await t.get(db.collection('workspaces').doc(String(est.workspaceId)))).data() || {};
    const now = new Date().toISOString();
    const signature: EstimateSignature = {
      name: String(input.name).trim(), signedAt: now,
      ...(evidence.ip ? { ip: evidence.ip.slice(0, 64) } : {}),
      ...(evidence.userAgent ? { userAgent: evidence.userAgent.slice(0, 300) } : {}),
    };
    t.update(found.ref, { signature, status: 'accepted', orderedAt: now, orderedBy: 'customer', updatedAt: now });
    const number = String(est.number || found.ref.id);
    await writeServerAuditLog({
      workspaceId: String(est.workspaceId), uid: 'customer', email: '', action: 'ESTIMATE_SIGNED', entityType: 'estimates', entityId: found.ref.id,
      details: { description: `${signature.name} signed estimate ${number} online${signature.ip ? ` from ${signature.ip}` : ''}` },
    }, { db, tx: t });
    return { workspaceId: String(est.workspaceId), number, customer: String(est.customerName || 'The customer'), amount: formatCurrency(Number(est.amountCents) || 0, String(est.currency || ws.currency || 'USD')), signature };
  });
  await notify(db, {
    workspaceId: result.workspaceId, kind: 'estimate.signed', title: `${result.customer} accepted estimate ${result.number}`,
    message: `Signed online by ${result.signature.name} for ${result.amount}. It is now an order, ready to invoice.`,
    eventKey: `estimate-signed:${found.ref.id}`, recordId: found.ref.id,
  });
  return { signedBy: result.signature.name, signedAt: result.signature.signedAt };
}
