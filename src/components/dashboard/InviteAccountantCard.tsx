import { useState } from 'react';
import { toast } from 'sonner';
import { useAuthStore } from '../../stores/useAuthStore';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { getIdToken } from '../../firebase';
import { isEmailShape } from '../../lib/textShape';

/**
 * EU-I1: "Invite my accountant" in one step — the owner types an address and the existing invite (Settings → Team)
 * is made with the Accountant role; the link to send is shown with Copy. Seats and billing are unchanged (a free
 * accountant seat is the owner's decision, not made here). Only the owner sees it, as only the owner may invite.
 */
export default function InviteAccountantCard() {
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const isGuest = useAuthStore(s => s.isGuest);
  const role = useCurrentRole();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState('');
  if (!workspaceId || isGuest || role !== 'owner') return null;

  const invite = async () => {
    const address = email.trim();
    if (!isEmailShape(address)) { toast.error('Type your accountant\'s email address'); return; }
    if (busy) return;
    setBusy(true);
    const asked = workspaceId;
    try {
      const res = await fetch(`/api/v1/workspaces/${encodeURIComponent(asked)}/invites`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getIdToken()}` },
        body: JSON.stringify({ email: address, role: 'accountant' }),
      });
      const body = await res.json().catch(() => ({}));
      if (useAuthStore.getState().currentWorkspaceId !== asked) return; // another set of books is open now
      if (!res.ok) { toast.error(body.message || body.error || 'The invitation was not made'); return; }
      const token = body.invite?.token;
      setLink(token ? `${window.location.origin}/invite/${token}` : '');
      setEmail('');
      toast.success(`${address} is invited as your accountant`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The invitation was not made');
    } finally { setBusy(false); }
  };

  return (
    <section aria-labelledby="invite-accountant-title" className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 space-y-2">
      <h2 id="invite-accountant-title" className="font-bold text-[var(--text)]">Invite my accountant</h2>
      <p className="text-xs text-[var(--muted)]">They get their own sign-in with the Accountant role; change or remove it any time in Settings → Team.</p>
      <div className="flex flex-wrap gap-2">
        <input type="email" aria-label="Accountant's email" value={email} onChange={e => setEmail(e.target.value)} placeholder="accountant@example.com"
          className="min-h-11 flex-1 min-w-[12rem] px-3 rounded-lg border border-[var(--line)] bg-[var(--panel)] text-[var(--text)] text-sm" />
        <button type="button" disabled={busy} onClick={() => void invite()}
          className="min-h-11 px-4 rounded-lg bg-[var(--text)] text-[var(--surface)] text-sm font-semibold disabled:opacity-50">{busy ? 'Inviting…' : 'Invite'}</button>
      </div>
      {link && (
        <p className="text-xs flex flex-wrap items-center gap-2" role="status">
          <span className="break-all">Send them this link: {link}</span>
          <button type="button" className="min-h-11 px-3 rounded border border-[var(--line)]"
            onClick={() => { void navigator.clipboard?.writeText(link).then(() => toast.success('Link copied'), () => toast.error('Copy did not work; select the link instead')); }}>Copy</button>
        </p>
      )}
    </section>
  );
}
