import type { DocumentReference, Firestore } from '../db/firestore';
import { WORKSPACE_PURGE_ORDER } from '../../constants/collections';
import { CLOSE_ROLES, postingLock, workspaceRole } from '../../lib/periodLock';
import type { PeriodLockSettings } from '../../lib/periodLock';
import { mergedAccount, mergeProblem, replaceAccountId } from '../../lib/accountMerge';
import type { ChartAccount } from '../../types';
import { writeServerAuditLog } from './auditLogService';

/**
 * Merging two accounts (CA-33), for owners and accountants: every record of the workspace that
 * points at the merged account is changed to point at the kept one, the kept account takes the
 * opening balance, and the merged account is removed, in one database transaction with an audit
 * line. Refused when the merge would change an entry or document in a closed period (reopen the
 * months first), or when the accounts are of different kinds or currencies. `preview` says what
 * would change without changing anything.
 */
export class AccountMergeError extends Error {
  constructor(readonly status: number, message: string, readonly details?: unknown) { super(message); }
}

/** Records with a posting date: changing their account changes the books on that date. */
const POSTED = new Set(['transactions', 'journalEntries', 'invoices', 'bills', 'payments', 'creditNotes', 'vendorCredits']);
/** History and messages: what happened is kept as it was. */
const LEFT_AS_THEY_WERE = new Set(['periods', 'notifications', 'emailEvents', 'errorLogs', 'presence', 'deepAuditJobs', 'clientQueries',
  'idempotencyKeys', 'billingLedgerTraces', 'invites', 'members', 'apiKeys', 'supportTickets', 'supportMessages', 'workspaceShards', 'taxReturns']);
const TABLES = WORKSPACE_PURGE_ORDER.filter(t => t !== 'chartAccounts' && !LEFT_AS_THEY_WERE.has(t));

interface Input { workspaceId: string; uid: string; email?: string; fromId: string; intoId: string }
export interface MergePreview { from: string; into: string; changes: Record<string, number>; total: number }

/** The rows (by table) whose stored data mentions the account id; checked again record by record. */
async function mentioning(db: Firestore, workspaceId: string, accountId: string): Promise<Array<{ table: string; id: string }>> {
  const found: Array<{ table: string; id: string }> = [];
  const needle = JSON.stringify(accountId);
  // a table whose migration is not applied yet is skipped (it has no rows to change)
  const existing = await db.tables();
  for (const table of [...TABLES, 'chartAccounts'].filter(name => existing.has(name))) {
    const rows = await db.readRows<{ id: string }>(
      `select id from ${db.tableSource(table)} where workspace_id = $1 and position($2 in data::text) > 0`,
      [workspaceId, needle],
    );
    for (const r of rows) found.push({ table, id: String(r.id) });
  }
  return found;
}

async function mergeOnce(db: Firestore, input: Input, apply: boolean): Promise<MergePreview> {
  const candidates = (await mentioning(db, input.workspaceId, input.fromId)).filter(c => !(c.table === 'chartAccounts' && (c.id === input.fromId || c.id === input.intoId)));
  return db.runTransaction(async t => {
    const wsRef = db.collection('workspaces').doc(input.workspaceId);
    const ws = (await t.get(wsRef)).data() as (Record<string, unknown> & PeriodLockSettings) | undefined;
    if (!ws) throw new AccountMergeError(404, 'Workspace not found');
    if (!CLOSE_ROLES.includes(workspaceRole(ws, input.uid))) throw new AccountMergeError(403, 'Only owners and accountants merge accounts');
    const fromRef = db.collection('chartAccounts').doc(input.fromId);
    const intoRef = db.collection('chartAccounts').doc(input.intoId);
    const [fromSnap, intoSnap] = await t.getAll(fromRef, intoRef);
    const inWs = (snap: typeof fromSnap) => {
      const data = snap.data();
      return data && data.workspaceId === input.workspaceId ? ({ ...data, id: snap.id } as ChartAccount) : undefined;
    };
    const from = inWs(fromSnap);
    const into = inWs(intoSnap);
    const problem = mergeProblem(from, into);
    if (problem) throw new AccountMergeError(400, problem);

    const refs = candidates.map(c => db.collection(c.table).doc(c.id) as DocumentReference);
    const snaps = refs.length ? await t.getAll(...refs) : [];
    const writes: Array<{ ref: DocumentReference; data: Record<string, unknown> }> = [];
    const changes: Record<string, number> = {};
    const closed: string[] = [];
    snaps.forEach((snap, i) => {
      const data = snap.data();
      if (!data || data.workspaceId !== input.workspaceId) return;
      const { value, changes: n } = replaceAccountId(data, from!.id, into!.id, into!.name);
      if (!n) return;
      const table = candidates[i].table;
      const date = typeof data.date === 'string' ? data.date : '';
      if (POSTED.has(table) && postingLock(date, ws, input.uid)) closed.push(`${table === 'transactions' ? 'entry' : table.replace(/s$/, '')} ${String(data.number || data.description || snap.id)} (${date.slice(0, 10)})`);
      changes[table] = (changes[table] || 0) + 1;
      writes.push({ ref: refs[i], data: value as Record<string, unknown> });
    });
    // the workspace's own settings (default accounts and the like)
    const wsReplaced = replaceAccountId(ws as Record<string, unknown>, from!.id, into!.id, into!.name);
    const wsFields = Object.fromEntries(Object.entries(wsReplaced.value).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify((ws as Record<string, unknown>)[k])));
    if (wsReplaced.changes) changes.settings = 1;
    if (closed.length) {
      throw new AccountMergeError(409, `Merging would change ${closed.length} record${closed.length === 1 ? '' : 's'} in a closed period (for example ${closed.slice(0, 3).join(', ')}). Reopen those months first, or keep both accounts.`, { closed: closed.slice(0, 50) });
    }
    const preview: MergePreview = { from: from!.name, into: into!.name, changes, total: Object.values(changes).reduce((s, n) => s + n, 0) };
    if (!apply) return preview;

    for (const w of writes) t.set(w.ref, w.data);
    if (Object.keys(wsFields).length) t.update(wsRef, wsFields);
    t.update(intoRef, { ...mergedAccount(from!, into!), updatedAt: new Date().toISOString() });
    t.delete(fromRef);
    await writeServerAuditLog({
      workspaceId: input.workspaceId, uid: input.uid, email: input.email, action: 'ACCOUNT_MERGED', entityType: 'chartAccounts', entityId: into!.id,
      details: {
        description: `Merged "${from!.code ? `${from!.code} ` : ''}${from!.name}" into "${into!.code ? `${into!.code} ` : ''}${into!.name}": ${preview.total} record${preview.total === 1 ? '' : 's'} moved`,
        fromId: from!.id, fromName: from!.name, fromCode: from!.code || '', changes,
      },
    }, { db, tx: t });
    return preview;
  });
}

/** What merging would change (nothing is changed). */
export function previewAccountMerge(db: Firestore, input: Input): Promise<MergePreview> {
  return mergeOnce(db, input, false);
}

/**
 * Merges, then looks once more for anything written meanwhile that still names the merged account
 * (it no longer exists, so those records are moved too).
 */
export async function mergeAccounts(db: Firestore, input: Input): Promise<MergePreview> {
  const result = await mergeOnce(db, input, true);
  for (let pass = 0; pass < 2; pass++) {
    const left = await mentioning(db, input.workspaceId, input.fromId);
    if (!left.length) break;
    await db.runTransaction(async t => {
      const intoName = String((await t.get(db.collection('chartAccounts').doc(input.intoId))).data()?.name || '');
      const refs = left.map(c => db.collection(c.table).doc(c.id) as DocumentReference);
      const snaps = await t.getAll(...refs);
      snaps.forEach((snap, i) => {
        const data = snap.data();
        if (!data || data.workspaceId !== input.workspaceId) return;
        const { value, changes } = replaceAccountId(data, input.fromId, input.intoId, intoName);
        if (changes) t.set(refs[i], value as Record<string, unknown>);
      });
    });
  }
  return result;
}
