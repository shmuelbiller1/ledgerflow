import type { Firestore, Transaction as FirestoreTransaction } from '../db/firestore';
import { workspaceRole } from '../../lib/periodLock';
import { ENTRY_LINK_KIND, MAX_LINK_NOTE, MAX_LINKS_PER_ENTRY, type EntryLink } from '../../lib/entryLinks';
import { writeServerAuditLog } from './auditLogService';

/**
 * Transaction links (M-10, src/lib/entryLinks.ts). Everyone in the workspace reads them; owners,
 * accountants and bookkeepers make and remove them. Both entries must be in the workspace.
 */
export class LinkError extends Error {
  readonly code: string;
  constructor(readonly status: number, message: string, code?: string) {
    super(message);
    this.code = code || (status === 400 ? 'INVALID_INPUT' : status === 403 ? 'ROLE_REQUIRED' : status === 404 ? 'NOT_FOUND' : status === 409 ? 'CONFLICT' : 'LINK_ERROR');
  }
}

const WRITERS = ['owner', 'accountant', 'bookkeeper'];
interface Actor { workspaceId: string; uid: string; email?: string }

async function writer(db: Firestore, input: Actor) {
  const ws = (await db.collection('workspaces').doc(input.workspaceId).get()).data();
  if (!ws) throw new LinkError(404, 'Workspace not found');
  if (!WRITERS.includes(workspaceRole(ws as never, input.uid))) throw new LinkError(403, 'Only owners, accountants and bookkeepers link entries');
}

export async function linksOf(db: Firestore, input: Actor & { transactionId: string }): Promise<EntryLink[]> {
  const rows = await db.readRows<{ id: string; data: Omit<EntryLink, 'id'> }>(
    `select id, data from ${db.tableSource('documents')} where workspace_id = $1 and data->>'kind' = $2 and (data->>'a' = $3 or data->>'b' = $3) order by data->>'createdAt'`,
    [input.workspaceId, ENTRY_LINK_KIND, input.transactionId]);
  return rows.map(r => ({ ...r.data, id: r.id }));
}

export async function linkEntries(db: Firestore, input: Actor & { a?: unknown; b?: unknown; note?: unknown }): Promise<EntryLink> {
  if (typeof input.a !== 'string' || typeof input.b !== 'string' || !input.a || !input.b) throw new LinkError(400, 'Choose the two entries');
  if (input.a === input.b) throw new LinkError(400, 'An entry is not linked to itself');
  if (input.note !== undefined && (typeof input.note !== 'string' || input.note.length > MAX_LINK_NOTE)) throw new LinkError(400, `Keep the note under ${MAX_LINK_NOTE} characters`);
  await writer(db, input);
  const rows = await db.readRows<{ id: string }>(
    `select id from ${db.tableSource('transactions')} where workspace_id = $1 and id = any($2::text[])`,
    [input.workspaceId, [input.a, input.b]],
  );
  if (rows.length !== 2) throw new LinkError(404, 'Both entries must be in this workspace');
  const existing = await linksOf(db, { ...input, transactionId: input.a });
  const same = existing.find(l => l.a === input.b || l.b === input.b);
  if (same) return same;
  if (existing.length >= MAX_LINKS_PER_ENTRY || (await linksOf(db, { ...input, transactionId: input.b })).length >= MAX_LINKS_PER_ENTRY) throw new LinkError(409, `${MAX_LINKS_PER_ENTRY} links on an entry at most`);
  const ref = db.collection('documents').doc();
  const link: Omit<EntryLink, 'id'> = {
    kind: ENTRY_LINK_KIND, workspaceId: input.workspaceId, a: input.a, b: input.b,
    ...(typeof input.note === 'string' && input.note.trim() ? { note: input.note.trim() } : {}),
    createdBy: input.uid, createdAt: new Date().toISOString(),
  };
  await db.runTransaction(async t => {
    t.set(ref, link);
    await writeServerAuditLog({
      workspaceId: input.workspaceId, uid: input.uid, email: input.email, action: 'ENTRIES_LINKED', entityType: 'transactions', entityId: input.a as string,
      details: { description: `Linked two entries${link.note ? `: ${link.note}` : ''}`, otherEntry: input.b },
    }, { db, tx: t });
  });
  return { ...link, id: ref.id };
}

export async function unlinkEntries(db: Firestore, input: Actor & { linkId: string }) {
  await writer(db, input);
  const ref = db.collection('documents').doc(input.linkId);
  const link = (await ref.get()).data() as EntryLink | undefined;
  if (!link || link.kind !== ENTRY_LINK_KIND || link.workspaceId !== input.workspaceId) throw new LinkError(404, 'That link is not in this workspace');
  await db.runTransaction(async t => {
    t.delete(ref);
    await writeServerAuditLog({
      workspaceId: input.workspaceId, uid: input.uid, email: input.email, action: 'ENTRIES_UNLINKED', entityType: 'transactions', entityId: link.a,
      details: { description: 'Removed the link between two entries', otherEntry: link.b },
    }, { db, tx: t });
  });
}

/** Apply a link create inside the command runner's transaction; reads of the two ledger rows and existing links are in that same snapshot. */
export async function linkEntriesInTransaction(
  db: Firestore,
  tx: FirestoreTransaction,
  input: Actor & { a?: unknown; b?: unknown; note?: unknown },
): Promise<{ link: EntryLink; created: boolean }> {
  if (typeof input.a !== 'string' || typeof input.b !== 'string' || !input.a || !input.b) throw new LinkError(400, 'Choose the two entries');
  if (input.a === input.b) throw new LinkError(400, 'An entry is not linked to itself');
  if (input.note !== undefined && (typeof input.note !== 'string' || input.note.length > MAX_LINK_NOTE)) {
    throw new LinkError(400, `Keep the note under ${MAX_LINK_NOTE} characters`);
  }
  const workspace = (await tx.get(db.collection('workspaces').doc(input.workspaceId))).data();
  if (!workspace) throw new LinkError(404, 'Workspace not found');
  if (!WRITERS.includes(workspaceRole(workspace as never, input.uid))) {
    throw new LinkError(403, 'Only owners, accountants and bookkeepers link entries');
  }
  const [a, b] = await tx.getAll(
    db.collection('transactions').doc(input.a),
    db.collection('transactions').doc(input.b),
  );
  if (!a.exists || a.data()?.workspaceId !== input.workspaceId || !b.exists || b.data()?.workspaceId !== input.workspaceId) {
    throw new LinkError(404, 'Both entries must be in this workspace');
  }
  const [aForward, aReverse, bForward, bReverse] = await Promise.all([
    tx.get(db.collection('documents').where('workspaceId', '==', input.workspaceId).where('kind', '==', ENTRY_LINK_KIND).where('a', '==', input.a)),
    tx.get(db.collection('documents').where('workspaceId', '==', input.workspaceId).where('kind', '==', ENTRY_LINK_KIND).where('b', '==', input.a)),
    tx.get(db.collection('documents').where('workspaceId', '==', input.workspaceId).where('kind', '==', ENTRY_LINK_KIND).where('a', '==', input.b)),
    tx.get(db.collection('documents').where('workspaceId', '==', input.workspaceId).where('kind', '==', ENTRY_LINK_KIND).where('b', '==', input.b)),
  ]);
  const uniqueLinks = (...groups: Array<{ docs: Array<{ id: string; data(): Record<string, unknown> | undefined }> }>) => {
    const found = new Map<string, EntryLink>();
    for (const group of groups) for (const doc of group.docs) {
      const data = doc.data();
      if (data) found.set(doc.id, { ...data, id: doc.id } as unknown as EntryLink);
    }
    return [...found.values()];
  };
  const linksA = uniqueLinks(aForward, aReverse);
  const linksB = uniqueLinks(bForward, bReverse);
  const existing = linksA.find(link => (link.a === input.a && link.b === input.b) || (link.a === input.b && link.b === input.a));
  if (existing) return { link: existing, created: false };
  if (linksA.length >= MAX_LINKS_PER_ENTRY || linksB.length >= MAX_LINKS_PER_ENTRY) {
    throw new LinkError(409, `${MAX_LINKS_PER_ENTRY} links on an entry at most`);
  }
  const ref = db.collection('documents').doc();
  const link: Omit<EntryLink, 'id'> = {
    kind: ENTRY_LINK_KIND,
    workspaceId: input.workspaceId,
    a: input.a,
    b: input.b,
    ...(typeof input.note === 'string' && input.note.trim() ? { note: input.note.trim() } : {}),
    createdBy: input.uid,
    createdAt: new Date().toISOString(),
  };
  tx.create(ref, link);
  return { link: { ...link, id: ref.id }, created: true };
}

/** Apply a link removal inside the command runner's transaction. */
export async function unlinkEntriesInTransaction(
  db: Firestore,
  tx: FirestoreTransaction,
  input: Actor & { linkId: string },
): Promise<EntryLink> {
  const workspace = (await tx.get(db.collection('workspaces').doc(input.workspaceId))).data();
  if (!workspace) throw new LinkError(404, 'Workspace not found');
  if (!WRITERS.includes(workspaceRole(workspace as never, input.uid))) {
    throw new LinkError(403, 'Only owners, accountants and bookkeepers link entries');
  }
  const ref = db.collection('documents').doc(input.linkId);
  const link = (await tx.get(ref)).data() as EntryLink | undefined;
  if (!link || link.kind !== ENTRY_LINK_KIND || link.workspaceId !== input.workspaceId) {
    throw new LinkError(404, 'That link is not in this workspace');
  }
  tx.delete(ref);
  return link;
}
