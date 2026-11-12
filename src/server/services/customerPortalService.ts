import crypto from 'crypto';
import type { Firestore } from '../db/firestore';
import { workspaceRole } from '../../lib/periodLock';
import { calculateAmountDue } from '../../lib/documentMath';
import { holdsSending } from '../../lib/invoiceApproval';
import { writeServerAuditLog } from './auditLogService';

/**
 * Customer portal (K-27 / M-19): one private link per customer (`/c/<token>`) that shows the
 * customer their issued invoices, what is still due on each, and a "View and pay" link to each
 * invoice's own page (`/i/<pay token>`). Bookkeepers and above create, replace or turn off the link;
 * the token lives on the customer, written by the server only. The page shows nothing else: no other
 * customer, no drafts, no voided invoices, no ledger.
 */
export class PortalError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const WRITERS = ['owner', 'accountant', 'bookkeeper'];
export const PORTAL_TOKEN = /^cp_[a-f0-9]{48}$/;

interface Actor { workspaceId: string; uid: string; email?: string; customerId: string }

async function customerFor(db: Firestore, t: Parameters<Parameters<Firestore['runTransaction']>[0]>[0], input: Actor) {
  const ws = (await t.get(db.collection('workspaces').doc(input.workspaceId))).data();
  if (!ws) throw new PortalError(404, 'Workspace not found');
  if (!WRITERS.includes(workspaceRole(ws as never, input.uid))) throw new PortalError(403, 'Only owners, accountants and bookkeepers share portal links');
  const ref = db.collection('customers').doc(input.customerId);
  const customer = (await t.get(ref)).data();
  if (!customer || customer.workspaceId !== input.workspaceId) throw new PortalError(404, 'That customer is not in this workspace');
  return { ref, customer };
}

/** A new link for the customer; an earlier one stops working. */
export async function createPortalLink(db: Firestore, input: Actor): Promise<{ token: string }> {
  return db.runTransaction(async t => {
    const { ref, customer } = await customerFor(db, t, input);
    const token = `cp_${crypto.randomBytes(24).toString('hex')}`;
    t.update(ref, { portalToken: token, portalTokenAt: new Date().toISOString() });
    await writeServerAuditLog({
      workspaceId: input.workspaceId, uid: input.uid, email: input.email, action: 'CUSTOMER_PORTAL_LINK', entityType: 'customers', entityId: input.customerId,
      details: { description: `${customer.portalToken ? 'Replaced' : 'Created'} the portal link of "${String(customer.name || input.customerId)}"` },
    }, { db, tx: t });
    return { token };
  });
}

export async function revokePortalLink(db: Firestore, input: Actor): Promise<void> {
  await db.runTransaction(async t => {
    const { ref, customer } = await customerFor(db, t, input);
    if (!customer.portalToken) return;
    t.update(ref, { portalToken: null, portalTokenAt: null });
    await writeServerAuditLog({
      workspaceId: input.workspaceId, uid: input.uid, email: input.email, action: 'CUSTOMER_PORTAL_LINK_OFF', entityType: 'customers', entityId: input.customerId,
      details: { description: `Turned off the portal link of "${String(customer.name || input.customerId)}"` },
    }, { db, tx: t });
  });
}

export interface PortalInvoice { number: string; date: string; dueDate: string; totalCents: number; dueCents: number; currency: string; status: 'open' | 'overdue' | 'paid'; payPath: string }
export interface PortalView { business: string; customer: string; currency: string; owedCents: number; invoices: PortalInvoice[]; /** EU-I2: show "Sent with …" (off when the business turned it off) */ poweredBy: boolean }

const HIDDEN = new Set(['draft', 'void', 'voided', 'cancelled']);

/**
 * What the portal shows for a token, or null when it isn't a live link. Open invoices without a pay
 * page get one (as emailing them does), so each can be paid from here.
 */
export async function portalView(db: Firestore, token: string, today: string): Promise<PortalView | null> {
  if (!PORTAL_TOKEN.test(token)) return null;
  const found = await db.collection('customers').where('portalToken', '==', token).limit(1).get();
  const customerDoc = found.docs[0];
  const customer = customerDoc?.data();
  if (!customerDoc || !customer?.workspaceId) return null;
  const ws = (await db.collection('workspaces').doc(customer.workspaceId).get()).data();
  if (!ws) return null;
  const invoices = await db.collection('invoices').where('workspaceId', '==', customer.workspaceId).where('customerId', '==', customerDoc.id).get();
  const rows: PortalInvoice[] = [];
  for (const d of invoices.docs) {
    const inv = d.data();
    if (HIDDEN.has(String(inv.status || '').toLowerCase())) continue;
    // an invoice still waiting for (or sent back by) an approver has not gone to the customer yet
    if (holdsSending(inv as never, ws.invoiceApproval, String(ws.currency || 'USD'))) continue;
    const dueCents = calculateAmountDue(inv as never);
    let payToken = typeof inv.paymentToken === 'string' ? inv.paymentToken : '';
    if (!payToken && dueCents > 0) {
      payToken = `pay_${crypto.randomBytes(32).toString('hex')}`;
      await d.ref.update({ paymentToken: payToken });
    }
    const dueDate = String(inv.dueDate || inv.date || '').slice(0, 10);
    rows.push({
      number: String(inv.number || ''), date: String(inv.date || '').slice(0, 10), dueDate,
      totalCents: Number(inv.amountCents) || 0, dueCents, currency: String(inv.currency || ws.currency || 'USD'),
      status: dueCents <= 0 ? 'paid' : dueDate && dueDate < today ? 'overdue' : 'open',
      payPath: payToken ? `/i/${payToken}` : '',
    });
  }
  rows.sort((a, b) => (a.status === 'paid' ? 1 : 0) - (b.status === 'paid' ? 1 : 0) || a.dueDate.localeCompare(b.dueDate) || a.number.localeCompare(b.number));
  const currency = String(ws.currency || 'USD');
  return {
    business: String(ws.name || ''), customer: String(customer.name || ''), currency,
    poweredBy: (ws.branding as { hidePoweredBy?: boolean } | undefined)?.hidePoweredBy !== true,
    owedCents: rows.filter(r => r.currency === currency).reduce((s, r) => s + r.dueCents, 0),
    invoices: rows.filter(r => r.status !== 'paid' || r.date >= `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`),
  };
}
