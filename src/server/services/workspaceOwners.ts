/**
 * Who owns a workspace. The creator always counts as an owner (their role is never stored as
 * anything else), plus everyone the `roles` map marks as one. Shared by the role-change command
 * and the account routes that ask whether the last owner may be removed.
 */
export function countWorkspaceOwners(workspaceData: { uid?: string; roles?: Record<string, unknown> }): { count: number; ownerUids: string[] } {
  const ownerUids: string[] = [];
  if (workspaceData.uid) ownerUids.push(workspaceData.uid);
  if (workspaceData.roles) {
    for (const [uid, role] of Object.entries(workspaceData.roles)) {
      if (role === 'owner' && !ownerUids.includes(uid)) ownerUids.push(uid);
    }
  }
  return { count: ownerUids.length, ownerUids };
}
