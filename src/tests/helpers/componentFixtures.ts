import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import type { LedgerKey } from '../../lib/ledgerCollections';
import type { User } from '../../lib/db/auth';
import type { Workspace } from '../../types';
import type { WorkspaceRole } from '../../hooks/useCurrentRole';
import { useAuthStore } from '../../stores/useAuthStore';
import { auth } from '../../firebase';

export function setComponentWorkspace(role: WorkspaceRole = 'owner'): Workspace {
  const user: User = {
    uid: 'test-user', providerId: 'test', email: 'test@example.test', displayName: 'Test', photoURL: null,
    emailVerified: true, isAnonymous: false, tenantId: null, providerData: [], metadata: {},
    getIdToken: async () => 'test-token',
    getIdTokenResult: async () => ({ token: 'test-token', claims: {}, expirationTime: '', issuedAtTime: '', signInProvider: 'test' }),
    reload: async () => {},
  };
  const workspace: Workspace = { id: 'component-workspace', uid: role === 'owner' ? user.uid : 'another-owner', name: 'Test workspace', businessType: 'custom', createdAt: '2026-01-01', currency: 'USD', roles: { [user.uid]: role } };
  useAuthStore.setState({ user, currentWorkspaceId: workspace.id, workspaces: [workspace], isGuest: false });
  // Screens that send through `runCommand` get their token from the auth singleton, not the store, so a test
  // workspace has to be signed in there too — otherwise the request goes out with no `Authorization` header and
  // the fixture's "test-token" never appears on the wire.
  auth.currentUser = user;
  return workspace;
}


export function markComponentCollectionsLoaded(...keys: LedgerKey[]): void {
  const loaded: Partial<Record<LedgerKey, boolean>> = {};
  for (const key of keys) loaded[key] = true;
  useDataNeedsStore.setState({ loadedWorkspaceId: useAuthStore.getState().currentWorkspaceId, loaded, failed: {} });
}

/** A signed-in report screen with an arrived chart and journal for this workspace. */
export function setLoadedAccountReportWorkspace() {
  const workspace = setComponentWorkspace();
  markComponentCollectionsLoaded('accounts', 'transactions', 'bills');
  return workspace;
}
