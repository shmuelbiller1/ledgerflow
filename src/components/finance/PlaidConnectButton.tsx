import React, { useState, useEffect, useCallback } from 'react';
import { usePlaidLink } from 'react-plaid-link';
import { toast } from 'sonner';
import { Link2 } from 'lucide-react';
import { getIdToken } from '../../firebase';
import { useAuthStore } from '../../stores/useAuthStore';

async function plaidPost(path: string, body: Record<string, unknown>, signal?: AbortSignal) {
  const idToken = await getIdToken();
  signal?.throwIfAborted();
  const response = await fetch(`/api/v1/plaid/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify(body),
    signal,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || 'Bank connection failed');
  return data;
}

/**
 * Connect a bank for the current workspace through Plaid Link. With `bankId` it reconnects an
 * existing connection whose bank asked the user to log in again (Plaid update mode).
 *
 * Plaid's script (cdn.plaid.com) and the link token are requested only after the button is pressed: loading
 * them with every dashboard or Banking view asked the server for a token on each visit, and Plaid's script
 * threw an uncaught "Failed to find script" when the screen was left before it finished (found by the
 * first-hour guide browser test on CI).
 */
export default function PlaidConnectButton(props: { onSuccessSync?: () => void; bankId?: string; label?: string }) {
  const [started, setStarted] = useState(false);
  const closed = useCallback(() => setStarted(false), []);
  const label = props.label || (props.bankId ? 'Reconnect bank' : 'Connect Bank');
  if (!started) return <ConnectButton label={label} onClick={() => setStarted(true)} />;
  return <PlaidLauncher {...props} label={label} onClosed={closed} />;
}

function ConnectButton({ label, onClick, busy = false }: { label: string; onClick: () => void; busy?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-busy={busy || undefined}
      className="h-12 px-6 bg-[var(--surface)] hover:border-[var(--brass-line)] border border-[var(--line)] text-[var(--text)] font-black text-[10px] uppercase tracking-widest rounded-xl transition-all shadow-sm flex items-center gap-2 active:scale-95 disabled:opacity-50"
    >
      <Link2 size={14} aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}

/** After the press: the link token, then Plaid's script, then Plaid Link opens by itself once it is ready. */
function PlaidLauncher({ onSuccessSync, bankId, label, onClosed }: { onSuccessSync?: () => void; bankId?: string; label: string; onClosed: () => void }) {
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const [token, setToken] = useState<{ workspaceId: string; bankId?: string; value: string } | null>(null);
  const linkToken = token?.workspaceId === workspaceId && token?.bankId === bankId ? token.value : null;

  useEffect(() => {
    if (!workspaceId) return;
    const controller = new AbortController();
    plaidPost('create_link_token', { workspaceId, ...(bankId ? { bankId } : {}) }, controller.signal)
      .then(data => { if (!controller.signal.aborted) setToken({ workspaceId, bankId, value: data.link_token }); })
      .catch(err => {
        if (controller.signal.aborted) return;
        console.error('Error generating link token:', err);
        toast.error(err instanceof Error ? err.message : 'Bank connection failed');
        onClosed();
      });
    return () => { controller.abort(); };
  }, [workspaceId, bankId, onClosed]);

  const onSuccess = useCallback(
    async (public_token: string, metadata: { institution?: { name?: string } | null }) => {
      try {
        if (bankId) {
          const r = await plaidPost('reconnected', { workspaceId, bankId });
          toast.success('Bank reconnected');
          // AU-1: automatic updates could not be switched on; Sync still works
          if (r?.webhookRegistered === false) toast.warning('Automatic bank updates could not be turned on. Use Sync to fetch new transactions.');
        } else {
          const r = await plaidPost('exchange_public_token', { workspaceId, public_token, institutionName: metadata?.institution?.name || undefined });
          toast.success('Bank connected via Plaid');
          // AU-1: Plaid sends automatic updates only after a first sync; if it did not run, a Sync starts them
          if (r?.firstSync && r.firstSync !== 'ok') toast.warning('Press Sync once to start automatic bank updates.');
        }
        onSuccessSync?.();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to connect bank');
      } finally {
        onClosed();
      }
    },
    [onSuccessSync, bankId, workspaceId, onClosed]
  );

  const { open, ready } = usePlaidLink({ token: linkToken, onSuccess, onExit: () => onClosed() });
  useEffect(() => { if (ready) open(); }, [ready, open]);

  return <ConnectButton label={label} onClick={() => { if (ready) open(); }} busy={!ready} />;
}
