import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useLedgerStore } from '../../../stores/useLedgerStore';
import { Lock, ShieldCheck, AlertCircle, RefreshCw } from 'lucide-react';
import { cn, safeConfirm } from '../../../lib/utils';
import { describeError } from '../../../lib/errorRemedies';
import { useAuthStore } from '../../../stores/useAuthStore';
import { useTransactionActions } from '../../../hooks/useTransactionActions';
import { multiFactor, TotpMultiFactorGenerator, type TotpSecret } from '../../../lib/db/auth';
import { auth } from '../../../firebase';
import { toast } from 'sonner';
import { RequireRole } from '../../ui/RequireRole';
import { useUIStore } from '../../../stores/useUIStore';
import RetentionSettingsPanel from './RetentionSettingsPanel';
import { retentionFor } from '../../../lib/retentionPolicy';
import AsyncButton from '../../ui/AsyncButton';
import RecoveryCodesPanel from './RecoveryCodesPanel';
import RequireTwoStepPanel from './RequireTwoStepPanel';
import TwoPersonRulePanel from './TwoPersonRulePanel';
import AccessReviewPanel from './AccessReviewPanel';
import { TWO_STEP_CHANGED } from '../../../lib/accessReview';
import AuditEvidencePackPanel from './AuditEvidencePackPanel';
import { inBackground } from '../../../lib/inBackground';

type AuthenticatorFactor = Awaited<ReturnType<ReturnType<typeof multiFactor>['getFactors']>>[number];

/** Personal account settings: independent of the user's workspace role. */
export function TwoStepLoginSettings() {
  const uid = useAuthStore(s => s.user?.uid);
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const available = useAuthStore(s => Boolean(s.user && !s.user.isAnonymous && !s.isGuest));
  return <TwoStepLoginPanel key={JSON.stringify([uid, workspaceId, available])} />;
}

function TwoStepLoginPanel() {
  const [user] = useState(() => useAuthStore.getState().user);
  const [workspaceId] = useState(() => useAuthStore.getState().currentWorkspaceId);
  const [available] = useState(() => Boolean(user && !user.isAnonymous && !useAuthStore.getState().isGuest));
  const [factors, setFactors] = useState<AuthenticatorFactor[] | null>(null);
  const [secret, setSecret] = useState<TotpSecret | null>(null);
  const [removing, setRemoving] = useState<AuthenticatorFactor | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const generation = useRef(0);
  const running = useRef(false);
  const codeRef = useRef<HTMLInputElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const id = useId();
  const current = useCallback((version: number) => generation.current === version && useAuthStore.getState().user?.uid === user?.uid && useAuthStore.getState().currentWorkspaceId === workspaceId && !useAuthStore.getState().isGuest, [user?.uid, workspaceId]);

  useEffect(() => {
    const version = ++generation.current;
    if (available && user) {
      void multiFactor(user).getFactors().then(list => { if (current(version)) setFactors(list); }).catch(e => { if (current(version)) setError(e instanceof Error ? e.message : 'Could not load authenticators.'); });
    }
    return () => { generation.current = version + 1; };
  }, [user, available, current]);

  useEffect(() => { if (secret || removing) codeRef.current?.focus(); }, [secret, removing]);

  const run = async (action: 'reload' | 'add' | 'verify' | 'remove' | 'cancel', factor?: AuthenticatorFactor) => {
    if (!available || !user || running.current) return;
    const version = generation.current;
    running.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const mfa = multiFactor(user);
      if (action === 'add') {
        const next = await TotpMultiFactorGenerator.generateSecret(await mfa.getSession());
        if (current(version)) { setSecret(next); setCode(''); }
        else { await mfa.cancelEnrollment(next.factorId).catch(() => {}); }
      } else if (action === 'verify' && secret) {
        await mfa.enroll(TotpMultiFactorGenerator.assertionForEnrollment(secret, code));
        if (!current(version)) return;
        setSecret(null); setCode(''); setNotice('Authenticator added. Two-step login is on.');
        // window.Event, not the bare global: a test document rejects an Event from another realm.
        window.dispatchEvent(new window.Event(TWO_STEP_CHANGED));
      } else if (action === 'remove' && removing) {
        await mfa.remove(removing.id, code);
        if (!current(version)) return;
        setRemoving(null); setCode(''); setNotice('Authenticator removed.');
        window.dispatchEvent(new window.Event(TWO_STEP_CHANGED));
      } else if (action === 'cancel') {
        const factorId = secret?.factorId || factor?.id;
        if (!factorId) return;
        await mfa.cancelEnrollment(factorId);
        if (!current(version)) return;
        setSecret(null); setCode(''); setNotice('Unfinished setup canceled.');
      }
      if (action !== 'add' && current(version)) {
        setFactors(null);
        const list = await mfa.getFactors();
        if (current(version)) { setFactors(list); statusRef.current?.focus(); }
      }
    } catch (e) {
      if (current(version)) { setError(e instanceof Error ? e.message : 'Authenticator action failed. Please retry.'); codeRef.current?.focus(); }
    } finally {
      if (current(version)) { running.current = false; setBusy(false); }
    }
  };

  const verified = factors?.filter(f => f.status === 'verified') || [];
  const setup = Boolean(secret || removing);
  const buttonClass = 'min-h-11 max-w-full';
  return (
    <section aria-labelledby={`${id}-title`} className="p-6 bg-[var(--ink)] border border-[var(--line)] rounded-xl space-y-4 min-w-0">
      <h3 id={`${id}-title`} className="text-base font-black text-[var(--text)] uppercase tracking-tight">Two-step login</h3>
      <p className="text-xs text-[var(--muted)]">Use an authenticator app for your account across all workspaces. Keep access to an enrolled app until its replacement is verified.</p>
      <p ref={statusRef} tabIndex={-1} role="status" className="text-sm text-[var(--text)]">{!available ? 'Sign in to manage your authenticators.' : factors === null ? 'Authenticator status is unavailable until it loads.' : verified.length ? `Two-step login is on (${verified.length} authenticator${verified.length === 1 ? '' : 's'}).` : 'Two-step login is off.'}</p>
      {error && <p role="alert" className="text-sm text-rose-400 break-words">{error}</p>}
      {notice && <p role="status" className="text-sm text-[var(--pos)]">{notice}</p>}
      {available && !setup && <>
        <ul className="space-y-3">{factors?.map(factor => <li key={factor.id} className="flex flex-wrap items-center justify-between gap-3">
          <span className="min-w-0 break-words text-sm">{factor.friendly_name || 'Authenticator'} — {factor.status === 'verified' ? 'verified' : 'unfinished setup'}</span>
          {factor.status === 'verified' ? <button type="button" disabled={busy} className={`${buttonClass} px-4 border border-[var(--line)] rounded-xl`} onClick={() => { setRemoving(factor); setCode(''); setError(''); setNotice(''); }}>Remove {factor.friendly_name || 'authenticator'}</button> : <AsyncButton type="button" disabled={busy} variant="secondary" className={buttonClass} onClick={() => run('cancel', factor)}>Cancel unfinished setup</AsyncButton>}
        </li>)}</ul>
        <div className="flex flex-wrap gap-3">
          <button type="button" disabled={busy || factors === null} className={`${buttonClass} px-4 bg-[var(--surface)] border border-[var(--line)] rounded-xl`} onClick={() => run('add')}>{busy ? 'Working…' : 'Add authenticator'}</button>
          <AsyncButton type="button" disabled={busy} variant="secondary" className={buttonClass} onClick={() => run('reload')}>Reload status</AsyncButton>
        </div>
        {verified.length > 0 && <RecoveryCodesPanel />}
      </>}
      {setup && <div className="space-y-3">
        {secret ? <>
          <p className="text-sm">Scan this QR code or enter the setup key in your authenticator app, then verify its current code.</p>
          {secret.qrCodeSvg && <img src={secret.qrCodeSvg} alt="QR code to add LedgerFlow to your authenticator app" className="w-40 h-40 bg-white p-2 rounded" />}
          <code className="block break-all text-sm text-[var(--text)]">{secret.secretKey}</code>
        </> : <p className="text-sm">To remove {removing?.friendly_name || 'this authenticator'}, enter a current code from that app. {verified.length === 1 && 'Removing your last authenticator turns off two-step login.'}</p>}
        <label htmlFor={`${id}-code`} className="block text-sm">Current 6-digit authenticator code</label>
        <input ref={codeRef} id={`${id}-code`} type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} readOnly={busy} onChange={e => setCode(e.target.value)} className="min-h-11 w-full max-w-48 px-3 bg-[var(--surface)] border border-[var(--line)] rounded-xl text-[var(--text)]" />
        <div className="flex flex-wrap gap-3">
          <AsyncButton type="button" disabled={busy || !/^\d{6}$/.test(code)} className={buttonClass} variant={secret ? 'primary' : 'danger'} onClick={() => run(secret ? 'verify' : 'remove')}>{secret ? 'Verify and add' : 'Verify and remove'}</AsyncButton>
          {secret ? <AsyncButton type="button" variant="secondary" className={buttonClass} disabled={busy} onClick={() => run('cancel')}>Cancel setup</AsyncButton> : <button type="button" className={`${buttonClass} px-4 border border-[var(--line)] rounded-xl`} disabled={busy} onClick={() => { setRemoving(null); setCode(''); setError(''); statusRef.current?.focus(); }}>Cancel removal</button>}
        </div>
      </div>}
    </section>
  );
}

/** Workspace security, period locking, two-step authentication, retention, and deletion settings. */
export default function SecuritySettings() {
  const lockDate = useLedgerStore(s => s.lockDate);
  const [isResetting, setIsResetting] = useState(false);
  const currentWorkspaceId = useAuthStore(state => state.currentWorkspaceId);
  const txActions = useTransactionActions();

  const handleLockDateChange = async (dateStr: string | null) => {
    if (dateStr) {
      await txActions.handleCloseMonth(dateStr);
    } else {
      // If we want to allow clearing, we'd need a route for that, 
      // but for now we follow the audit which emphasizes close-month.
      // Reopening needs a reason and the right role: it is done in Month-End Close.
      toast.info('To reopen a closed period, use Month-End Close (a reason is required).');
      useUIStore.getState().setActiveTab('month-end-close');
    }
  };

  const handleSystemPurge = async () => {
    if (!currentWorkspaceId) return;

    setIsResetting(true);
    try {
        await txActions.handleResetWorkspace();
    } catch (err) {
        const described = describeError(err, 'delete');
        toast.error(described.title, { description: described.remedy });
    } finally {
        setIsResetting(false);
    }
  };

  return (
    <div className="space-y-10">
      <RequireTwoStepPanel />
      <TwoPersonRulePanel />
      <AccessReviewPanel />
      <AuditEvidencePackPanel />
      {/* Fiscal Period Locking */}
      <div className="ledger-card p-8 md:p-10 bg-[var(--surface)] border border-[var(--line)] shadow-sm rounded-2xl">
        <div className="flex items-center gap-5 mb-8">
          <div className="w-12 h-12 bg-[var(--brass)] text-[var(--ink)] rounded-xl flex items-center justify-center shadow-md">
            <Lock aria-hidden="true" size={24} />
          </div>
          <div>
            <h2 className="text-2xl font-black text-[var(--text)] uppercase tracking-wider">Fiscal Period Locking</h2>
            <p className="text-[10px] font-black text-[var(--muted)] uppercase tracking-widest mt-1">Immutable Ledger Storage Compliance</p>
          </div>
        </div>

        <div className="flex flex-col md:flex-row items-stretch md:items-center gap-6 p-6 bg-[var(--ink)]/50 rounded-xl border border-[var(--line)]">
          <div className="flex-1 space-y-1">
            <p className="text-sm font-bold text-[var(--text)] uppercase tracking-tight">Closed Period Lock Date</p>
            <p className="text-[10px] text-[var(--muted)] leading-relaxed font-bold uppercase tracking-widest">
              Transactions on or before this date cannot be modified without administrative override.
            </p>
          </div>
          <input aria-label="Closed Period Lock Date"
            type="date" 
            value={lockDate || ''}
            onChange={(e) => handleLockDateChange(e.target.value || null)}
            className="bg-[var(--surface)] border border-[var(--line)] px-4 py-2.5 rounded-xl font-bold text-[var(--text)] outline-none focus:border-[var(--brass-line)] shadow-sm"
          />
        </div>
      </div>

      <div className="ledger-card p-8 md:p-10 bg-[var(--surface)] border border-[var(--line)] shadow-sm rounded-2xl">
        <div className="flex items-center gap-5 mb-8">
          <div className="w-12 h-12 bg-[var(--ink)] border border-[var(--line)] rounded-xl flex items-center justify-center shadow-sm">
            <ShieldCheck aria-hidden="true" size={24} className="text-[var(--pos)]" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-[var(--text)] uppercase tracking-wider">High-Integrity Firewall</h2>
            <p className="text-[10px] font-black text-[var(--muted)] uppercase tracking-widest mt-1">Zero-Trust Modal Configuration</p>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          {[
            { label: 'Rule Encryption', status: 'AES-256 GCM', desc: 'Symmetric encryption for all stored rule keys and model context.', active: true },
            { label: 'Institutional Sync', status: 'Real-time', desc: 'Secure profile synchronization with Firestore Enterprise identity provider.', active: true },
            { label: 'Deterministic Fallback', status: 'Enabled', desc: 'Automatically switch to algorithmic logic if rule confidence drops below 0.65.', active: true },
            { label: 'Blockchain Hashing', status: 'Queued', desc: 'Optional: Commit ledger hashes to an immutable chain for public verification.', active: false }
          ].map((item) => (
            <div key={item.label} className="flex items-start gap-6 p-5 bg-[var(--ink)]/40 border border-[var(--line)] rounded-xl hover:border-[var(--brass-line)] transition-all group">
              <div className="flex-1">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] font-bold text-[var(--brass)] uppercase tracking-widest">{item.label}</p>
                  <span className={cn(
                    "px-2.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider border",
                    item.active ? "bg-[var(--pos)]/10 text-[var(--pos)] border-[var(--pos)]/20" : "bg-[var(--surface)] text-[var(--muted)] border-[var(--line)]"
                  )}>
                    {item.status}
                  </span>
                </div>
                <p className="text-xs font-semibold text-[var(--text)] leading-relaxed">{item.desc}</p>
              </div>
            </div>
          ))}

          <div className="pt-6 mt-4 border-t border-[var(--line)] space-y-6">
            <TwoStepLoginSettings />

            <div className="p-6 bg-[var(--ink)] border border-[var(--line)] rounded-xl flex flex-col md:flex-row items-center justify-between gap-6">
                <div className="space-y-1">
                  <h3 className="text-base font-black text-[var(--text)] uppercase tracking-tight">Active Sessions</h3>
                  <p className="text-xs font-medium text-[var(--muted)] leading-relaxed max-w-md">
                    Revoke all existing sessions and refresh tokens globally. You will be signed out on all devices.
                  </p>
                </div>
                <button 
                  onClick={async () => {
                    try {
                      const res = await fetch('/api/v1/auth/revoke-sessions', {
                        method: 'POST',
                        headers: {
                          'Authorization': `Bearer ${await useAuthStore.getState().user?.getIdToken()}`
                        }
                      });
                      if (!res.ok) throw new Error(await res.text());
                      toast.success('Sessions revoked. You will be signed out.');
                    } catch (err) {
                      toast.error('Failed to revoke sessions: ' + (err as Error).message);
                    }
                  }}
                  className="px-6 py-3 bg-[var(--surface)] text-[var(--text)] border border-[var(--line)] rounded-xl text-[10px] font-bold uppercase tracking-wider hover:bg-[var(--ink)] transition-all flex items-center gap-2 cursor-pointer shrink-0"
                >
                  <AlertCircle aria-hidden="true" size={14} />
                  REVOKE ALL SESSIONS
                </button>
            </div>

            <div className="p-6 bg-[var(--ink)]/50 border border-[var(--line)] rounded-xl flex flex-col md:flex-row items-center justify-between gap-6">
                <div className="space-y-1">
                  <h3 className="text-base font-black text-[var(--text)] uppercase tracking-tight">Download my data</h3>
                  <p className="text-xs font-medium text-[var(--muted)] leading-relaxed max-w-md">
                    Your profile, the workspaces you belong to, your notifications, sign-ins and what you did (audit trail), as one file. The books themselves are in each workspace's backup.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const res = await fetch('/api/v1/account/my-data', { headers: { Authorization: `Bearer ${await useAuthStore.getState().user?.getIdToken()}` } });
                      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not collect your data');
                      const blob = new Blob([JSON.stringify(await res.json(), null, 2)], { type: 'application/json' });
                      const link = document.createElement('a');
                      link.href = URL.createObjectURL(blob);
                      link.download = 'ledgerflow-my-data.json';
                      link.click();
                      URL.revokeObjectURL(link.href);
                    } catch (err) {
                      const described = describeError(err, 'get');
                      toast.error(described.title, { description: described.remedy });
                    }
                  }}
                  className="px-6 py-3 bg-[var(--surface)] border border-[var(--line)] text-[var(--text)] rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all flex items-center gap-2 shrink-0"
                >
                  Download my data
                </button>
            </div>

            <div className="p-6 bg-rose-500/5 border border-rose-500/20 rounded-xl flex flex-col md:flex-row items-center justify-between gap-6">
                <div className="space-y-1">
                  <h3 className="text-base font-black text-rose-500 uppercase tracking-tight">Delete User Account</h3>
                  <p className="text-xs font-medium text-[var(--muted)] leading-relaxed max-w-md">
                    Deletes your sign-in and personal data. A workspace only you use is deleted after 30 days; you leave workspaces you share. If you are the only owner of a shared workspace, make someone else an owner first (Settings → Team).
                  </p>
                </div>
                <button 
                  onClick={async () => {
                    if (safeConfirm('Delete your account? Your sign-in and personal data are deleted; workspaces only you use are deleted after 30 days. This can\'t be undone.')) {
                      try {
                        const res = await fetch('/api/v1/auth/delete-account', {
                          method: 'DELETE',
                          headers: {
                            'Authorization': `Bearer ${await useAuthStore.getState().user?.getIdToken()}`
                          }
                        });
                        const body = await res.json().catch(() => ({}));
                        if (res.status === 409) {
                          toast.error('Your account was not deleted', { description: body.error });
                          return;
                        }
                        if (!res.ok) throw new Error(body.error || 'Failed to delete account');
                        toast.success('Your account was deleted.');
                        inBackground(auth.signOut(), 'Your account was deleted, but signing out failed. Sign out again, or close this tab.');
                      } catch (err) {
                        const described = describeError(err, 'delete');
                        toast.error(described.title, { description: described.remedy });
                      }
                    }
                  }}
                  className="px-6 py-3 bg-rose-500 text-white rounded-xl text-[10px] font-bold uppercase tracking-wider hover:bg-rose-600 transition-all shadow-md flex items-center gap-2 cursor-pointer shrink-0"
                >
                  <AlertCircle aria-hidden="true" size={14} />
                  DELETE ACCOUNT
                </button>
            </div>

            <RetentionSettingsPanel />

            <div className="p-6 bg-rose-500/5 border border-rose-500/20 rounded-xl flex flex-col md:flex-row items-center justify-between gap-6">
                <div className="space-y-1">
                  <h3 className="text-base font-black text-rose-500 uppercase tracking-tight">Delete this workspace</h3>
                  <p className="text-xs font-medium text-[var(--muted)] leading-relaxed max-w-md">
                    Everything in this workspace is deleted after {retentionFor(useAuthStore.getState().getCurrentWorkspace()).deletionGraceDays} days (Data retention above); until then an owner can keep it. The audit trail is kept.</p>
                </div>
                <RequireRole requiredRole="owner" disableOnly tooltip="Only an owner can delete the workspace">
                  <button 
                    onClick={handleSystemPurge}
                    disabled={isResetting}
                    className="px-6 py-3 bg-rose-500 text-white rounded-xl text-[10px] font-bold uppercase tracking-wider hover:bg-rose-600 transition-all shadow-md flex items-center gap-2 disabled:opacity-50 cursor-pointer shrink-0"
                  >
                    {isResetting ? <RefreshCw aria-hidden="true" size={14} className="animate-spin" /> : <AlertCircle aria-hidden="true" size={14} />}
                    {isResetting ? 'Deleting…' : 'Delete workspace'}
                  </button>
                </RequireRole>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
