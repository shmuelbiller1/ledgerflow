import { useDialog } from '../../../hooks/useDialog';
import React, { useState, useEffect, useCallback } from 'react';
import { Users, UserPlus, Trash2, ShieldCheck, Check, RefreshCw, Copy, Shield, Activity, Clock, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '../../../stores/useAuthStore';
import { WorkspaceRole, ROLE_DESCRIPTIONS, useCurrentRole } from '../../../hooks/useCurrentRole';
import { WorkspaceInvite, AuditLog } from '../../../types';
import { RequireRole } from '../../ui/RequireRole';
import InlineEdit from '../../ui/InlineEdit';
import { EmptyState } from '../../ui/EmptyState';
import { useTeamRequests } from '../../../hooks/useTeamRequests';
import { copyWithFeedback } from '../../../lib/clipboard';
import { planFor } from '../../../lib/plans';

export default function TeamSettings() {
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const uid = useAuthStore(s => s.user?.uid);
  return <ScopedTeamSettings key={`${workspaceId}:${uid}`} />;
}

function ScopedTeamSettings() {
  const currentWorkspace = useAuthStore(s => s.getCurrentWorkspace());
  const workspaceId = currentWorkspace?.id || 'default_workspace';
  // same seat rule as the server (ACC-1): the plan's seats, at least 5; free access given by LedgerFlow has no cap
  const maxSeats = currentWorkspace?.maxSeats || Math.max(5, planFor(currentWorkspace?.plan).limits.seats);
  const unlimitedSeats = (currentWorkspace as { bypassBilling?: boolean } | undefined)?.bypassBilling === true;

  const [members, setMembers] = useState<string[]>([]);
  const [roles, setRoles] = useState<Record<string, WorkspaceRole>>({});
  const [invites, setInvites] = useState<WorkspaceInvite[]>([]);
  const [ownerUid, setOwnerUid] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  
  const [selectedRole, setSelectedRole] = useState<WorkspaceRole>('viewer');
  const role = useCurrentRole();
  const canManage = role === 'owner';
  const { request, saving, isCurrent } = useTeamRequests(workspaceId);
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState('');
  const { dialogProps: removeDialogProps, titleId: removeTitleId } = useDialog(() => { if (!saving) setRemoveTarget(null); }, !!removeTarget);

  // Member activity drawer state
  const [selectedMemberForLogs, setSelectedMemberForLogs] = useState<{ uid: string; email?: string } | null>(null);
  const { dialogProps: overlayDialogProps, titleId: overlayTitleId } = useDialog(() => setSelectedMemberForLogs(null), !!selectedMemberForLogs);
  const [memberLogs, setMemberLogs] = useState<AuditLog[]>([]);
  const [logsLoading, setLogsLoading] = useState<boolean>(false);

  const fetchTeamData = useCallback(async () => {
    try {
      setLoading(true);
      const [membersData, rolesData, invitesData] = await Promise.all([
        request(`/api/v1/workspaces/${workspaceId}/members`),
        request(`/api/v1/workspaces/${workspaceId}/roles`),
        canManage || role === 'accountant' ? request(`/api/v1/workspaces/${workspaceId}/invites`) : Promise.resolve({ invites: [] }),
      ]);
      if (membersData.status === 'success') {
        setMembers(membersData.members || []);
        if (membersData.ownerUid) setOwnerUid(membersData.ownerUid);
      }

      if (rolesData.roles) {
        setRoles(rolesData.roles);
      }

      if (Array.isArray(invitesData.invites)) {
        setInvites(invitesData.invites.filter((i: WorkspaceInvite) => i.status === 'pending'));
      }
    } catch (err) {
      if (isCurrent()) toast.error('Failed to load team settings', { description: (err as Error).message });
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [request, workspaceId, canManage, role, isCurrent]);

  useEffect(() => {
    const scheduled = setTimeout(() => { void fetchTeamData(); }, 0);
    return () => clearTimeout(scheduled);
  }, [fetchTeamData]);

  const activeSeatCount = new Set([...members, ownerUid || currentWorkspace?.uid || 'owner']).size; // unique people, owner counted once (ACC-1b)
  const seatsRemaining = Math.max(0, maxSeats - activeSeatCount);
  const isSeatLimitReached = !unlimitedSeats && activeSeatCount >= maxSeats;

  const handleSendInvite = async (next: string | number) => {
    const email = String(next).trim();
    if (isSeatLimitReached) throw new Error(`Workspace seat limit reached (${maxSeats} seats).`);
    await request(`/api/v1/workspaces/${workspaceId}/invites`, {
      method: 'POST', body: JSON.stringify({ email, role: selectedRole }),
    }, true);
    toast.success(`Invitation created for ${email}`);
    void fetchTeamData();
  };

  const handleRoleChange = async (targetUid: string, next: string | number) => {
    const newRole = String(next) as WorkspaceRole;
    await request(`/api/v1/workspaces/${workspaceId}/roles/${encodeURIComponent(targetUid)}`, {
      method: 'PATCH', body: JSON.stringify({ role: newRole }),
    }, true);
    setRoles(prev => ({ ...prev, [targetUid]: newRole }));
    useAuthStore.setState(state => ({ workspaces: state.workspaces.map(workspace => workspace.id === workspaceId
      ? { ...workspace, roles: { ...workspace.roles, [targetUid]: newRole } } : workspace) }));
    toast.success(`Role updated to ${newRole.toUpperCase()}`);
  };

  const handleRemoveMember = async () => {
    if (!removeTarget) return;
    try {
      await request(`/api/v1/workspaces/${workspaceId}/members/${encodeURIComponent(removeTarget)}`, { method: 'DELETE' }, true);
      setMembers(prev => prev.filter(uid => uid !== removeTarget));
      setRemoveTarget(null);
      toast.success('Member removed from workspace.');
    } catch (error) {
      if (isCurrent()) setRemoveError((error as Error).message);
    }
  };

  const handleRevokeInvite = async (inviteId: string) => {
    try {
      await request(`/api/v1/workspaces/${workspaceId}/invites/${encodeURIComponent(inviteId)}`, { method: 'DELETE' }, true);
      setInvites(prev => prev.filter(i => (i.id || i.inviteId) !== inviteId));
      toast.success('Invite revoked successfully.');
    } catch (err) {
      if (isCurrent()) toast.error('Error revoking invite', { description: (err as Error).message });
    }
  };

  const handleCopyInviteLink = (inviteToken: string) => {
    const link = `${window.location.origin}/invite/${inviteToken}`;
    void copyWithFeedback(link, 'Invite link copied to clipboard!');
  };

  const handleOpenMemberActivity = async (uid: string, email?: string) => {
    setSelectedMemberForLogs({ uid, email });
    setLogsLoading(true);
    try {
      const data = await request(`/api/v1/reports/audit-logs?workspaceId=${encodeURIComponent(workspaceId)}&uid=${encodeURIComponent(uid)}`);
      if (data.status === 'success' || Array.isArray(data.logs)) {
        setMemberLogs(data.logs || data.auditLogs || []);
      }
    } catch {
      if (isCurrent()) toast.error('Failed to load member activity history');
    } finally {
      if (isCurrent()) setLogsLoading(false);
    }
  };

  return (
    <div className="space-y-8 max-w-5xl">
      {removeTarget && <div {...removeDialogProps} className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-xl bg-[var(--surface)] p-6 space-y-4">
          <h2 id={removeTitleId} className="[unicode-bidi:plaintext]">{`Remove ${removeTarget}?`}</h2>
          <p>This person will lose access to this workspace. Their recorded work remains.</p>
          {removeError && <p role="alert">{removeError}</p>}
          <button type="button" disabled={saving} onClick={() => setRemoveTarget(null)}>Cancel</button>
          <button type="button" disabled={saving} onClick={() => void handleRemoveMember()}>Remove member</button>
        </div>
      </div>}
      {/* Header & Seat Gauge */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 bg-[var(--surface)] border border-[var(--line)] rounded-[24px]">
        <div className="space-y-1">
          <h2 className="text-xl font-black text-[var(--text)] tracking-tight flex items-center gap-2">
            <Users aria-hidden="true" size={22} className="text-indigo-600" />
            Workspace Team & Role Management
          </h2>
          <p className="text-xs text-[var(--muted)] max-w-xl">
            Control member roles and permissions for <span className="font-bold text-[var(--text)]">{currentWorkspace?.name || 'this workspace'}</span>. Role gates enforce access across reports, transactions, period locks, and administration.
          </p>
        </div>

        {/* Seat Limit Badge */}
        <div className="p-4 bg-[var(--ink)]/50 border border-[var(--line)] rounded-2xl shrink-0 space-y-2 min-w-[200px]">
          <div className="flex items-center justify-between text-xs font-bold">
            <span className="text-[var(--muted)] uppercase tracking-wider text-[10px]">Seat Capacity</span>
            <span className={isSeatLimitReached ? "text-amber-500 font-mono" : "text-emerald-500 font-mono"}>
              {activeSeatCount} / {unlimitedSeats ? 'Unlimited' : maxSeats} Used
            </span>
          </div>
          <div className="w-full h-2 bg-[var(--surface)] rounded-full overflow-hidden border border-[var(--line)]">
            <div
              className={`h-full transition-all ${isSeatLimitReached ? "bg-amber-500" : "bg-indigo-600"}`}
              style={{ width: unlimitedSeats ? '100%' : `${Math.min(100, (activeSeatCount / maxSeats) * 100)}%` }}
            />
          </div>
          <div className="text-[10px] text-[var(--muted)] font-medium text-right">
            {unlimitedSeats ? "Unlimited seats" : isSeatLimitReached ? "Limit reached · Upgrade required" : `${seatsRemaining} available seats`}
          </div>
        </div>
      </div>

      {/* Invite Form */}
      <RequireRole requiredRole="owner" disableOnly tooltip="Only the workspace owner can invite new members">
        <div className="p-6 bg-[var(--surface)] border border-[var(--line)] rounded-[24px] space-y-5">
          <div className="text-xs font-black uppercase tracking-wider text-[var(--muted)] flex items-center gap-1.5">
            <UserPlus aria-hidden="true" size={15} className="text-indigo-500" /> Invite Team Member or Accountant
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
            <div className="relative sm:col-span-6">
              <InlineEdit value="" kind="email" label="Invite team member email"
                placeholder="Type an email and press Enter to invite" canEdit={canManage && !saving && !isSeatLimitReached}
                onSave={handleSendInvite} />
            </div>

            <div className="sm:col-span-4">
              <select disabled={!canManage || saving} aria-label="Role for invited team member"
                value={selectedRole}
                onChange={(e) => setSelectedRole(e.target.value as WorkspaceRole)}
                className="w-full px-3 py-2.5 bg-[var(--ink)] border border-[var(--line)] rounded-xl text-xs font-bold text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-indigo-500 capitalize"
              >
                <option value="viewer">Viewer (Read-Only)</option>
                <option value="bookkeeper">Bookkeeper (Transactions/Invoices)</option>
                <option value="accountant">Accountant (Close Periods/Chart of Accounts)</option>
                <option value="owner">Owner (Full Admin)</option>
              </select>
            </div>


          </div>

          {/* Selected Role Powers Explainer */}
          <div className="p-4 bg-[var(--ink)]/40 border border-[var(--line)] rounded-2xl space-y-2">
            <div className="flex items-center justify-between text-xs font-black text-indigo-400 uppercase tracking-wider">
              <span>Role Powers: {ROLE_DESCRIPTIONS[selectedRole].title}</span>
              <Shield aria-hidden="true" size={14} />
            </div>
            <p className="text-xs text-slate-300">
              {ROLE_DESCRIPTIONS[selectedRole].summary}
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              {ROLE_DESCRIPTIONS[selectedRole].permissions.map((perm) => (
                <span key={perm} className="px-2 py-0.5 bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-[10px] font-semibold rounded-md flex items-center gap-1">
                  <Check aria-hidden="true" size={10} className="text-indigo-400" /> {perm}
                </span>
              ))}
            </div>
          </div>
        </div>
      </RequireRole>

      {/* Pending Invites Section */}
      {invites.length > 0 && (
        <div className="p-6 bg-[var(--surface)] border border-[var(--line)] rounded-[24px] space-y-4">
          <div className="text-xs font-black uppercase tracking-wider text-amber-500 flex items-center gap-2">
            <Clock aria-hidden="true" size={16} /> Pending Invitations ({invites.length})
          </div>

          <div className="space-y-2">
            {invites.map((inv) => (
              <div key={inv.id || inv.inviteId} className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 rounded-xl bg-[var(--ink)]/30 border border-[var(--line)] gap-3">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold font-mono text-[var(--text)]">{inv.email}</span>
                    <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-amber-500/10 text-amber-500 border border-amber-500/20">
                      {inv.role}
                    </span>
                  </div>
                  <div className="text-[10px] text-[var(--muted)] flex items-center gap-2">
                    <span>Expires: {new Date(inv.expiresAt).toLocaleDateString()}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleCopyInviteLink(inv.token)}
                    className="px-2.5 py-1.5 bg-[var(--surface)] border border-[var(--line)] hover:border-indigo-500 text-slate-300 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all"
                    title="Copy invite acceptance link"
                  >
                    <Copy aria-hidden="true" size={12} />
                    <span>Copy Link</span>
                  </button>
                  <RequireRole requiredRole="owner" disableOnly tooltip="Only the workspace owner can revoke invites">
                    <button
                      disabled={saving} onClick={() => handleRevokeInvite(inv.id || inv.inviteId || '')}
                      className="p-1.5 text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors text-xs font-bold flex items-center gap-1"
                      title="Revoke invitation"
                    >
                      <Trash2 aria-hidden="true" size={14} />
                      <span className="text-[10px] uppercase">Revoke</span>
                    </button>
                  </RequireRole>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active Workspace Members List */}
      <div className="p-6 bg-[var(--surface)] border border-[var(--line)] rounded-[24px] space-y-4">
        <div className="flex items-center justify-between border-b border-[var(--line)] pb-3">
          <div className="text-xs font-black uppercase tracking-wider text-[var(--muted)] flex items-center gap-2">
            <Users aria-hidden="true" size={16} className="text-indigo-500" />
            Authorized Active Workspace Members ({activeSeatCount})
          </div>
          <button
            onClick={fetchTeamData}
            className="text-[10px] font-bold text-[var(--muted)] hover:text-slate-200 flex items-center gap-1"
          >
            <RefreshCw aria-hidden="true" size={12} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>

        {loading ? (
          <div className="py-8 text-center text-xs text-[var(--muted)] font-mono">Loading team members and roles...</div>
        ) : (
          <div className="space-y-2">
            {/* Owner Row */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 rounded-xl bg-[var(--ink)]/40 border border-[var(--line)] gap-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-indigo-600/10 border border-indigo-500/30 text-indigo-500 font-black flex items-center justify-center text-xs">
                  OW
                </div>
                <div>
                  <div className="text-xs font-bold text-[var(--text)] font-mono flex items-center gap-2">
                    {ownerUid || currentWorkspace?.uid || 'Primary Owner'}
                    <span className="px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-widest bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                      Primary
                    </span>
                  </div>
                  <div className="text-[10px] text-[var(--muted)] flex items-center gap-1">
                    <ShieldCheck aria-hidden="true" size={10} className="text-indigo-500" /> Workspace Creator & Owner
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleOpenMemberActivity(ownerUid || currentWorkspace?.uid || '')}
                  className="px-2.5 py-1 bg-[var(--surface)] border border-[var(--line)] hover:border-indigo-500 text-slate-300 rounded-lg text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 transition-all"
                >
                  <Activity aria-hidden="true" size={12} /> Activity Log
                </button>
                <span className="text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                  Owner
                </span>
              </div>
            </div>

            {/* Invited Members Rows */}
            {members.map((mUid) => {
              const currentRole = roles[mUid] || (mUid === ownerUid ? 'owner' : 'viewer');
              const isOwner = mUid === ownerUid;

              return (
                <div key={mUid} className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 rounded-xl bg-[var(--ink)]/20 border border-[var(--line)] gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-emerald-600/10 border border-emerald-500/30 text-emerald-500 font-bold flex items-center justify-center text-xs font-mono">
                      {currentRole.substring(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div className="text-xs font-bold text-[var(--text)] font-mono">{mUid}</div>
                      <div className="text-[10px] text-[var(--muted)] flex items-center gap-1">
                        <Check aria-hidden="true" size={10} className="text-emerald-500" /> Active Member
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => handleOpenMemberActivity(mUid)}
                      className="px-2.5 py-1 bg-[var(--surface)] border border-[var(--line)] hover:border-indigo-500 text-slate-300 rounded-lg text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 transition-all"
                    >
                      <Activity aria-hidden="true" size={12} /> Activity
                    </button>

                    <InlineEdit value={currentRole} kind="select" label={`Role of ${mUid}`}
                      canEdit={canManage && !isOwner && !saving}
                      options={Object.entries(ROLE_DESCRIPTIONS).map(([value, info]) => ({ value, label: info.title }))}
                      display={ROLE_DESCRIPTIONS[currentRole]?.title || 'Viewer'}
                      onSave={next => handleRoleChange(mUid, next)} />

                    {!isOwner && (
                      <RequireRole requiredRole="owner" disableOnly tooltip="Only the workspace owner can remove members">
                        <button
                          disabled={saving} onClick={() => { setRemoveError(''); setRemoveTarget(mUid); }}
                          className="p-1.5 text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors text-xs font-bold flex items-center gap-1"
                          title="Revoke workspace access"
                        >
                          <Trash2 aria-hidden="true" size={14} />
                          <span className="text-[10px] uppercase">Revoke</span>
                        </button>
                      </RequireRole>
                    )}
                  </div>
                </div>
              );
            })}

            {members.length === 0 && (
              <EmptyState
                title="No team members yet"
                description="Bookkeepers and accountants you invite show here with their role and activity. Send an invitation above to collaborate."
              />
            )}
          </div>
        )}
      </div>

      {/* Member Activity Modal */}
      {selectedMemberForLogs && (
        <div {...overlayDialogProps} className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[var(--surface)] border border-[var(--line)] rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
            <div className="p-4 border-b border-[var(--line)] flex items-center justify-between bg-[var(--ink)]/40">
              <div className="flex items-center gap-2">
                <Activity aria-hidden="true" size={18} className="text-indigo-500" />
                <h3 id={overlayTitleId} className="text-sm font-bold text-[var(--text)] uppercase tracking-wider">
                  Member Activity History — {selectedMemberForLogs.email || selectedMemberForLogs.uid}
                </h3>
              </div>
              <button aria-label="Close member activity"
                onClick={() => setSelectedMemberForLogs(null)}
                className="p-1 text-[var(--muted)] hover:text-slate-100 rounded-lg"
              >
                <X aria-hidden="true" size={18} />
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1 space-y-3">
              {logsLoading ? (
                <div className="py-8 text-center text-xs text-[var(--muted)] font-mono">Loading activity history...</div>
              ) : memberLogs.length === 0 ? (
                <div className="py-8 text-center text-xs text-[var(--muted)] italic">
                  No activity logs recorded for this member.
                </div>
              ) : (
                memberLogs.map((log) => (
                  <div key={log.id} className="p-3 bg-[var(--ink)]/30 border border-[var(--line)] rounded-xl flex items-center justify-between text-xs">
                    <div>
                      <div className="font-bold text-[var(--text)] uppercase tracking-tight flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded text-[8px] bg-indigo-500/10 text-indigo-400 font-black">
                          {log.action}
                        </span>
                        <span>{log.entityType}</span>
                      </div>
                      <p className="text-[var(--muted)] text-[11px] mt-1 font-mono">
                        {log.details?.description || log.entityId}
                      </p>
                    </div>
                    <div className="text-[10px] text-[var(--muted)] font-mono">
                      {new Date(log.timestamp).toLocaleString()}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
