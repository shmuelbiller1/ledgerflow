/**
 * In-app notifications (S-01 S-03 S-04 S-06 S-12 S-14) and each person's choice of which ones they
 * get (S-19). The server creates one row per person in the `notifications` table
 * (src/server/services/notificationService.ts); the bell in the header shows the signed-in
 * person's rows and marks them read (NotificationDrawer.tsx).
 */
import { workspaceRole } from './periodLock';

type Role = 'owner' | 'accountant' | 'bookkeeper' | 'viewer';
const BOOKS: Role[] = ['owner', 'accountant', 'bookkeeper'];

export const NOTIFICATION_TYPES = {
  'invoice.sent': { label: 'An invoice was emailed to a customer', roles: BOOKS, tab: 'sales' },
  'invoice.viewed': { label: 'A customer opened an invoice for the first time', roles: BOOKS, tab: 'sales' },
  'estimate.signed': { label: 'A customer signed an estimate online', roles: BOOKS, tab: 'estimates' },
  'approval.requested': { label: 'An invoice waits for approval', roles: ['owner', 'accountant'] as Role[], tab: 'sales' },
  'approval.delegated': { label: 'Someone asked you to approve invoices in their place', roles: BOOKS, tab: 'sales' },
  'approval.decided': { label: 'An invoice was approved or sent back', roles: BOOKS, tab: 'sales' },
  'invoice.overdue': { label: 'An invoice became overdue', roles: BOOKS, tab: 'sales' },
  'invoice.draft_ready': { label: 'A recurring invoice is ready to review and send', roles: BOOKS, tab: 'sales' },
  'invoice.paper_copy': { label: 'A reminder is due for a customer who gets paper copies', roles: BOOKS, tab: 'sales' },
  'estimate.draft_ready': { label: 'A recurring estimate is ready to review and send', roles: BOOKS, tab: 'estimates' },
  'bill.draft_ready': { label: 'A recurring bill is ready to review', roles: BOOKS, tab: 'purchases' },
  'recurring.failed': { label: 'A recurring invoice, bill, estimate or entry could not be created', roles: BOOKS, tab: 'recurring' },
  'payment.received': { label: 'A customer payment was received', roles: BOOKS, tab: 'payments' },
  'payment.failed': { label: "A customer's online payment did not go through", roles: BOOKS, tab: 'sales' },
  'subscription.payment_failed': { label: 'The LedgerFlow plan could not be charged', roles: ['owner'] as Role[], tab: 'settings' },
  'email.bounced': { label: 'An email to a customer bounced or was marked as spam', roles: BOOKS, tab: 'sales' },
  'bank.disconnected': { label: 'A bank connection needs to be reconnected', roles: BOOKS, tab: 'banking' },
  'member.invited': { label: 'Someone was invited to the workspace', roles: ['owner'] as Role[], tab: 'settings' },
  'member.joined': { label: 'Someone joined the workspace', roles: ['owner', 'accountant'] as Role[], tab: 'settings' },
  'member.role_changed': { label: 'Your role in a workspace changed', roles: ['owner', 'accountant', 'bookkeeper', 'viewer'] as Role[], tab: 'settings' },
  'query.asked': { label: 'Someone asked a question about an entry', roles: ['owner', 'accountant'] as Role[], tab: 'client-queries' },
  'query.answered': { label: 'A question about an entry was answered', roles: BOOKS, tab: 'client-queries' },
  'task.assigned': { label: 'Someone gave you a task', roles: ['owner', 'accountant', 'bookkeeper', 'viewer'] as Role[], tab: 'tasks' },
  'task.done': { label: 'A task you gave was done', roles: ['owner', 'accountant', 'bookkeeper'] as Role[], tab: 'tasks' },
  'mention.query': { label: 'Someone mentioned you in a question about an entry', roles: ['owner', 'accountant', 'bookkeeper', 'viewer'] as Role[], tab: 'client-queries' },
  'time.decided': { label: 'Time you submitted was approved or sent back', roles: ['owner', 'accountant', 'bookkeeper', 'viewer'] as Role[], tab: 'time' },
  'record.changed': { label: 'A record you watch changed', roles: ['owner', 'accountant', 'bookkeeper', 'viewer'] as Role[], tab: 'tasks' },
  'mention.task': { label: 'Someone mentioned you in a task', roles: ['owner', 'accountant', 'bookkeeper', 'viewer'] as Role[], tab: 'tasks' },
  'health.problem': { label: 'The nightly check found a new problem in the books', roles: ['owner', 'accountant'] as Role[], tab: 'data-health' },
  'reconciliation.discrepancy': { label: 'A reconciled bank account no longer matches its statement', roles: ['owner', 'accountant'] as Role[], tab: 'reconciliation' },
  'transaction.unusual': { label: 'An entry far bigger than its account usually sees', roles: ['owner', 'accountant'] as Role[], tab: 'transactions' },
  'close.reminder': { label: 'A reminder to close last month', roles: ['owner', 'accountant'] as Role[], tab: 'month-end-close' },
  'budget.exceeded': { label: 'A budget was overspent', roles: ['owner', 'accountant'] as Role[], tab: 'budgets' },
  'cash.low': { label: 'Cash fell below the amount set in Settings → Alerts', roles: ['owner', 'accountant'] as Role[], tab: 'dashboard' },
  'asset.reminder': { label: "A fixed asset's warranty ends or its insurance renews soon", roles: BOOKS, tab: 'assets' },
  'payroll.approval_requested': { label: 'A pay run waits for your approval', roles: ['owner'] as Role[], tab: 'payroll' },
  'payroll.decided': { label: 'A pay run you prepared was approved or sent back', roles: ['owner', 'accountant'] as Role[], tab: 'payroll' },
} as const;

export type NotificationType = keyof typeof NOTIFICATION_TYPES;
export const NOTIFICATION_TYPE_KEYS = Object.keys(NOTIFICATION_TYPES) as NotificationType[];

/** A person's choices: `false` turns a type off; anything else (or missing) means on. */
export type NotificationPrefs = Partial<Record<NotificationType, boolean>>;

export function isNotificationType(value: unknown): value is NotificationType {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(NOTIFICATION_TYPES, value);
}

export function wantsNotification(prefs: NotificationPrefs | null | undefined, type: NotificationType): boolean {
  return prefs?.[type] !== false;
}

interface WorkspaceMembership {
  uid?: unknown;
  members?: unknown;
  roles?: unknown;
  admins?: unknown;
}

/** Everyone in the workspace: the owner, the member list and everyone with a role. */
export function workspaceMemberIds(workspace: WorkspaceMembership): string[] {
  const ids = new Set<string>();
  if (typeof workspace.uid === 'string' && workspace.uid) ids.add(workspace.uid);
  if (Array.isArray(workspace.members)) workspace.members.forEach(m => typeof m === 'string' && m && ids.add(m));
  if (workspace.roles && typeof workspace.roles === 'object') Object.keys(workspace.roles).forEach(m => ids.add(m));
  if (workspace.admins && typeof workspace.admins === 'object') {
    Object.entries(workspace.admins).forEach(([m, on]) => on === true && ids.add(m));
  }
  return [...ids];
}

/** Types a person with this role can receive (for the choices screen). */
export function typesForRole(role: string): NotificationType[] {
  return NOTIFICATION_TYPE_KEYS.filter(t => (NOTIFICATION_TYPES[t].roles as readonly string[]).includes(role));
}

/**
 * Who gets a notification: members whose role receives this type, except the person who did it,
 * and except those who turned the type off.
 */
export function notificationRecipients(
  workspace: WorkspaceMembership,
  type: NotificationType,
  prefsByUid: Map<string, NotificationPrefs | null | undefined>,
  actorUid?: string,
): string[] {
  const roles = NOTIFICATION_TYPES[type].roles as readonly string[];
  return workspaceMemberIds(workspace).filter(uid =>
    uid !== actorUid
    && roles.includes(workspaceRole(workspace, uid))
    && wantsNotification(prefsByUid.get(uid), type));
}
