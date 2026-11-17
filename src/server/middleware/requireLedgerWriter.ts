import type express from 'express';
import { getDb } from '../db/firestore';
import { getWorkspaceUserRole } from '../auth/workspaceRole';

/** Roles that may change the books (the database policies use the same list). */
export const LEDGER_WRITER_ROLES = ['owner', 'accountant', 'bookkeeper'];

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** A user's role from a workspace document: the creator is the owner, others per `roles` (default viewer). */
export function roleInWorkspace(workspace: { uid?: unknown; roles?: unknown } | undefined, uid: string): string {
  if (!workspace) return 'viewer';
  if (workspace.uid === uid) return 'owner';
  const roles = workspace.roles as Record<string, unknown> | undefined;
  const role = roles?.[uid];
  return typeof role === 'string' ? role : 'viewer';
}

function asId(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() && !value.includes('/') && !value.includes('\0') ? value.trim() : undefined;
}

function hasMalformedId(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '' && !asId(value);
}

/**
 * Every workspace a write request could touch: the ids in the body and query, the API key's
 * workspace, and for /:id routes the workspace of that transaction. Checking all of them means
 * the result doesn't depend on which one a handler happens to use.
 */
export async function targetWorkspaces(req: express.Request): Promise<Set<string>> {
  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
  const ids = new Set<string>();
  const addId = (v: unknown) => { const id = asId(v); if (id) ids.add(id); };
  addId(body.workspaceId);
  addId(body.sourceWorkspaceId);
  addId(body.targetWorkspaceId);
  addId((body.transaction as Record<string, unknown> | undefined)?.workspaceId);
  if (Array.isArray(body.transactions)) body.transactions.forEach(tx => addId((tx as Record<string, unknown> | null)?.workspaceId));
  addId(req.query.workspaceId);
  addId((req as express.Request & { user?: { developerWorkspaceId?: string } }).user?.developerWorkspaceId);

  const byId = /^\/([^/]+)(\/reverse)?$/.exec(req.path);
  if (byId && (req.method === 'PUT' || req.method === 'DELETE' || byId[2])) {
    let decoded: string;
    try { decoded = decodeURIComponent(byId[1]); } catch { decoded = ''; }
    const docId = asId(decoded);
    if (docId) {
      const snap = await getDb().collection('transactions').doc(docId).get();
      addId(snap.data()?.workspaceId);
    }
  }
  return ids;
}

/**
 * Router middleware: reads pass through; writes need the owner, accountant or bookkeeper role in
 * every workspace they name. Viewers are members too, so membership alone is not enough.
 */
export async function requireLedgerWriter(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (READ_METHODS.has(req.method)) return next();
  const user = (req as express.Request & { user?: { uid?: string; admin?: boolean } }).user;
  if (!user?.uid) return res.status(401).json({ error: 'Sign in required' });
  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
  const txObj = (body.transaction && typeof body.transaction === 'object' ? body.transaction : {}) as Record<string, unknown>;
  if (hasMalformedId(body.workspaceId) || hasMalformedId(txObj.workspaceId) || hasMalformedId(req.query.workspaceId)) {
    return res.status(400).json({ status: 'error', error: 'Invalid workspaceId', message: 'Invalid workspaceId' });
  }
  if (user.admin) return next();
  try {
    const workspaces = await targetWorkspaces(req);
    if (workspaces.size === 0) return res.status(400).json({ error: 'Missing workspaceId' });
    const db = getDb();
    for (const workspaceId of workspaces) {
      const role = await getWorkspaceUserRole(db, workspaceId, user.uid);
      if (!LEDGER_WRITER_ROLES.includes(role)) {
        return res.status(403).json({ error: 'Forbidden: changing the books requires the owner, accountant or bookkeeper role' });
      }
    }
    return next();
  } catch (e) {
    if (e instanceof Error && e.message === 'NOT_FOUND') return res.status(404).json({ error: 'Workspace not found' });
    return next(e);
  }
}
