/**
 * Modules (BB-07, src/lib/modules.ts): owners and accountants turn modules on or off for the
 * workspace. Only the server writes the setting (`modules` on the workspace), with an audit line.
 * Turning a module off hides its screens; it never deletes anything.
 */
import type { Firestore, Transaction } from '../db/firestore';
import { workspaceRole } from '../../lib/periodLock';
import { MODULES, modulesProblem, type Modules } from '../../lib/modules';
import { writeServerAuditLog } from './auditLogService';

export class ModuleSettingError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'ModuleSettingError';
  }
}

export interface ModuleWriteResult {
  workspaceId: string;
  modules: Modules;
  /** The effective prior values, including defaults for modules with no saved setting. */
  previousModules: Modules;
  changed: string[];
}

/** Apply a module change inside the command runner's transaction. */
export async function setModulesInTransaction(
  db: Firestore,
  tx: Transaction,
  input: { workspaceId: string; uid: string; modules: Modules },
): Promise<ModuleWriteResult> {
  const problem = modulesProblem(input.modules);
  if (problem) throw new ModuleSettingError(400, problem);
  const ref = db.collection('workspaces').doc(input.workspaceId);
  const workspace = (await tx.get(ref)).data();
  if (!workspace) throw new ModuleSettingError(404, 'Workspace not found');
  const role = workspaceRole(workspace, input.uid);
  if (role !== 'owner' && role !== 'accountant') throw new ModuleSettingError(403, 'Only owners and accountants choose the modules');
  const before = (workspace.modules || {}) as Modules;
  const previousModules = Object.fromEntries(MODULES.map(module => [module.id, before[module.id] !== false]));
  const modules = { ...before, ...input.modules };
  tx.update(ref, { modules, updatedAt: new Date().toISOString() });
  const changed = Object.entries(input.modules).filter(([id, on]) => (before[id] !== false) !== on)
    .map(([id, on]) => `${MODULES.find(m => m.id === id)?.name || id} ${on ? 'on' : 'off'}`);
  return { workspaceId: input.workspaceId, modules, previousModules, changed };
}

export function moduleAuditSummary(result: ModuleWriteResult) {
  if (result.changed.length === 0) return null;
  return {
    action: 'MODULES_SET',
    entityType: 'workspaces',
    entityId: result.workspaceId,
    description: `Modules: ${result.changed.join(', ')}`,
  };
}

/** Service compatibility wrapper; command callers use setModulesInTransaction via the shared runner. */
export async function setModules(db: Firestore, input: { workspaceId: string; uid: string; email?: string; modules: Modules }) {
  return db.runTransaction(async tx => {
    const result = await setModulesInTransaction(db, tx, input);
    const summary = moduleAuditSummary(result);
    if (summary) {
      const { description, ...audit } = summary;
      await writeServerAuditLog({
        workspaceId: input.workspaceId,
        uid: input.uid,
        email: input.email,
        ...audit,
        details: { description },
      }, { db, tx });
    }
    return { modules: result.modules };
  });
}

/**
 * What each module still holds (BB-07 step 2): the records of its screens, so Settings → Modules can
 * say that a module turned off still keeps them. Counted by the server for the workspace; a table the
 * database doesn't have yet counts nothing.
 */
const MODULE_RECORDS: Record<string, Array<{ table: string; where?: string }>> = {
  estimates: [{ table: 'estimates' }],
  'purchase-orders': [{ table: 'purchaseOrders' }],
  payroll: [{ table: 'employees' }, { table: 'payRuns' }],
  'fixed-assets': [{ table: 'assets' }],
  loans: [{ table: 'loans' }],
  'petty-cash': [{ table: 'transactions', where: `data->'metadata' ? 'pettyCash'` }],
  intercompany: [{ table: 'transactions', where: `data->'metadata'->>'isIntercompany' = 'true'` }],
  forecasting: [{ table: 'scenarios' }],
  inventory: [{ table: 'inventory' }],
  projects: [{ table: 'projects' }],
  budgets: [{ table: 'budgets' }],
};

export async function moduleRecords(db: Firestore, workspaceId: string): Promise<Record<string, number>> {
  const existing = await db.tables();
  const counts: Record<string, number> = {};
  for (const [id, sources] of Object.entries(MODULE_RECORDS)) {
    let n = 0;
    for (const { table, where } of sources.filter(x => existing.has(x.table))) {
      const rows = await db.readRows<{ n: number }>(`select count(*)::int as n from ${db.tableSource(table)} where workspace_id = $1${where ? ` and ${where}` : ''}`, [workspaceId]);
      n += rows[0]?.n || 0;
    }
    counts[id] = n;
  }
  return counts;
}
