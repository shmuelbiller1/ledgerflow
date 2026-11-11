import { workspaceActor } from '../lib/guestActor';
import { useAuthStore } from '../stores/useAuthStore';

export type WorkspaceRole = 'owner' | 'accountant' | 'bookkeeper' | 'viewer';

export const ROLE_HIERARCHY: Record<WorkspaceRole, number> = {
  owner: 4,
  accountant: 3,
  bookkeeper: 2,
  viewer: 1
};

export const ROLE_DESCRIPTIONS: Record<WorkspaceRole, { title: string; summary: string; permissions: string[] }> = {
  owner: {
    title: 'Workspace Owner',
    summary: 'Full access to all financial data, billing, settings, and team management.',
    permissions: ['Everything in Accountant role', 'Manage team members & roles', 'Billing & subscription controls', 'Delete workspace']
  },
  accountant: {
    title: 'Accountant',
    summary: 'Full ledger management, period locks, month-end closing, and chart of accounts controls.',
    permissions: ['Everything in Bookkeeper role', 'Close periods & lock dates', 'Manage Chart of Accounts', 'Run forensic & consolidated reports']
  },
  bookkeeper: {
    title: 'Bookkeeper',
    summary: 'Daily transaction logging, invoices, bills, payments, and bank reconciliation.',
    permissions: ['Create/edit transactions, invoices & bills', 'Record payments & match receipts', 'Manage vendors & customers', 'Cannot lock periods or manage users']
  },
  viewer: {
    title: 'Viewer',
    summary: 'Read-only access to view financial reports, statements, and ledger records.',
    permissions: ['View general ledger & balance sheet', 'Export reports', 'Read-only access across all views', 'Cannot edit data or change settings']
  }
};

export function useCurrentRole(): WorkspaceRole {
  const currentWorkspace = useAuthStore(s => s.getCurrentWorkspace());
  const user = useAuthStore(workspaceActor);

  if (!currentWorkspace || !user) return 'viewer';
  if (currentWorkspace.uid === user.uid) return 'owner';

  // any other stored value (an old 'admin', a typo) gets no more than the server gives it: read-only
  const role = currentWorkspace.roles?.[user.uid];
  return role && role in ROLE_HIERARCHY ? role : 'viewer';
}

export function hasRoleAtLeast(currentRole: WorkspaceRole, requiredRole: WorkspaceRole): boolean {
  return (ROLE_HIERARCHY[currentRole] || 1) >= (ROLE_HIERARCHY[requiredRole] || 1);
}
