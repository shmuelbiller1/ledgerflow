/**
 * Selling below zero (W-06): by default an invoice that sells more than is on hand is recorded,
 * stock goes below zero and a warning says so (simple books are never blocked). An owner can turn on
 * "Refuse sales beyond stock": then the server refuses any sale that would take an item below zero
 * (cogsStockService.ts), and nothing of it is written. Only the server writes the setting
 * (`refuseNegativeStock` on the workspace), only for owners, with an audit line. Stock adjustments
 * never go below zero and the manual cost-of-goods-sold entry always refuses it, whatever the setting.
 */
import type { Firestore, Transaction } from '../db/firestore';
import { workspaceRole } from '../../lib/periodLock';
import { writeServerAuditLog } from './auditLogService';
import { StockAdjustmentError } from './stockAdjustmentService';

export interface StockPolicyInput { workspaceId: string; uid: string; email?: string; refuse: boolean }

export async function setNegativeStockPolicy(db: Firestore, input: StockPolicyInput) {
  return db.runTransaction(t => setNegativeStockPolicyInTransaction(db, t, input));
}

/** The write, inside a transaction the caller owns. */
export async function setNegativeStockPolicyInTransaction(db: Firestore, t: Transaction, input: StockPolicyInput) {
  const ref = db.collection('workspaces').doc(input.workspaceId);
  const workspace = (await t.get(ref)).data();
  if (!workspace) throw new StockAdjustmentError(404, 'Workspace not found');
  if (workspaceRole(workspace, input.uid) !== 'owner') throw new StockAdjustmentError(403, 'Only owners decide whether sales may take stock below zero');
  t.update(ref, { refuseNegativeStock: input.refuse, updatedAt: new Date().toISOString() });
  await writeServerAuditLog({
    workspaceId: input.workspaceId, uid: input.uid, email: input.email, action: 'STOCK_POLICY_SET', entityType: 'workspaces', entityId: input.workspaceId,
    details: { description: input.refuse ? 'Sales that would take stock below zero are now refused' : 'Sales may take stock below zero again (with a warning)' },
  }, { db, tx: t });
  return { refuseNegativeStock: input.refuse };
}
