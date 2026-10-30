import type { Firestore } from '../db/firestore';
import { delegationProblem, type ApprovalDelegate } from '../../lib/approvalDelegation';
import { formatTzDate } from '../../lib/calendarDate';
import { writeServerAuditLog } from './auditLogService';
import { notify } from './notificationService';

/**
 * Approving in someone's place (BG-07, src/lib/approvalDelegation.ts): an owner or accountant hands
 * their invoice approvals to one person until a date, or takes them back. One hand-over per person;
 * ones that have ended are dropped. The person is told.
 */
export class DelegateError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export async function setApprovalDelegate(db: Firestore, input: { workspaceId: string; uid: string; email?: string; to?: unknown; until?: unknown; clear?: boolean }) {
  const result = await db.runTransaction(async t => {
    const ref = db.collection('workspaces').doc(input.workspaceId);
    const ws = (await t.get(ref)).data();
    if (!ws) throw new DelegateError(404, 'Workspace not found');
    const today = formatTzDate(new Date(), typeof ws.timezone === 'string' ? ws.timezone : 'UTC');
    if (!input.clear) {
      const problem = delegationProblem(ws, input.uid, input, today);
      if (problem) throw new DelegateError(problem.startsWith('Only') ? 403 : 400, problem);
    }
    const current = (Array.isArray(ws.approvalDelegates) ? ws.approvalDelegates as ApprovalDelegate[] : []).filter(d => d.from !== input.uid && d.until >= today);
    const mine: ApprovalDelegate | null = input.clear ? null : { from: input.uid, to: String(input.to), until: String(input.until) };
    const approvalDelegates = mine ? [...current, mine] : current;
    t.update(ref, { approvalDelegates, updatedAt: new Date().toISOString() });
    await writeServerAuditLog({
      workspaceId: input.workspaceId, uid: input.uid, email: input.email, action: 'APPROVAL_DELEGATED', entityType: 'workspaces', entityId: input.workspaceId,
      details: { description: mine ? `Invoice approvals handed to a teammate until ${mine.until}` : 'Invoice approvals taken back' },
    }, { db, tx: t });
    return { approvalDelegates, mine };
  });
  if (result.mine) {
    await notify(db, {
      workspaceId: input.workspaceId, kind: 'approval.delegated', title: 'You approve invoices in someone\'s place',
      message: `${input.email || 'A teammate'} asked you to approve invoices over the limit for them until ${result.mine.until}.`,
      eventKey: `delegate:${input.uid}:${result.mine.to}:${result.mine.until}`, actorUid: input.uid, onlyUids: [result.mine.to],
    });
  }
  return { approvalDelegates: result.approvalDelegates };
}
