import React, { useState, useEffect, useCallback, useRef } from 'react';
import { usePlaidLink } from 'react-plaid-link';
import { toast } from 'sonner';
import { Link2 } from 'lucide-react';
import { getIdToken } from '../../firebase';
import { useAuthStore } from '../../stores/useAuthStore';
import { runCommand, type CommandBody } from '../../lib/runCommand';

async function plaidPost<T = CommandBody>(path: string, body: Record<string, unknown>, signal?: AbortSignal, isCurrent?: () => boolean): Promise<T> {
  // Asked twice: once before anything happens, and once more after the token is in hand. The second one is what
  // stops an unmounted reconnect from starting a request with credentials it waited for — `fetch` would reject
  // an already-aborted signal too, but by then the token has been fetched for nothing.
  signal?.throwIfAborted();
  const token = await getIdToken();
  signal?.throwIfAborted();
  if (isCurrent && !isCurrent()) throw new DOMException('Bank connection scope changed', 'AbortError');
  return await runCommand<T>({ path: `/api/v1/plaid/${path}`, method: 'POST', body, signal, token }) ?? {} as T;
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
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const uid = useAuthStore(s => s.user?.uid);
  const closed = useCallback(() => setStarted(false), []);
  const label = props.label || (props.bankId ? 'Reconnect bank' : 'Connect Bank');
  if (!started || !workspaceId || !uid) return <ConnectButton label={label} onClick={() => setStarted(true)} busy={!workspaceId || !uid} />;
  // A Link handler belongs to the identity and workspace for which its token was requested.
  return <PlaidLauncher key={JSON.stringify([uid, workspaceId, props.bankId])} {...props} workspaceId={workspaceId} uid={uid} label={label} onClosed={closed} />;
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
function PlaidLauncher({ onSuccessSync, bankId, label, onClosed, workspaceId, uid }: { onSuccessSync?: () => void; bankId?: string; label: string; onClosed: () => void; workspaceId: string; uid: string }) {
  const [token, setToken] = useState<string | null>(null);
  const active = useRef(true);
  const writing = useRef(false);
  const writeController = useRef<AbortController | null>(null);
  const isCurrent = useCallback(() => active.current && useAuthStore.getState().user?.uid === uid && useAuthStore.getState().currentWorkspaceId === workspaceId, [uid, workspaceId]);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; writeController.current?.abort(); };
  }, []);

  useEffect(() => {
    if (!workspaceId) return;
    const controller = new AbortController();
    plaidPost<{ link_token?: unknown }>('create_link_token', { workspaceId, ...(bankId ? { bankId } : {}) }, controller.signal, isCurrent)
      .then(data => {
        if (!isCurrent() || controller.signal.aborted) return;
        if (typeof data.link_token !== 'string' || !data.link_token.trim()) throw new Error('The bank connection could not be started. Please try again.');
        setToken(data.link_token);
      })
      .catch(err => {
        if (controller.signal.aborted || !isCurrent()) return;
        console.error('Error generating link token:', err);
        toast.error(err instanceof Error ? err.message : 'Bank connection failed');
        onClosed();
      });
    return () => { controller.abort(); };
  }, [workspaceId, bankId, onClosed, isCurrent]);

  const onSuccess = useCallback(
    async (public_token: string, metadata: { institution?: { name?: string } | null }) => {
      if (!isCurrent() || writing.current) return;
      writing.current = true;
      const controller = new AbortController();
      writeController.current = controller;
      try {
        const r = bankId
          ? await plaidPost('reconnected', { workspaceId, bankId }, controller.signal, isCurrent)
          : await plaidPost('exchange_public_token', { workspaceId, public_token, institutionName: metadata?.institution?.name || undefined }, controller.signal, isCurrent);
        if (!isCurrent() || controller.signal.aborted) return;
        if (r?.success !== true) throw new Error('The bank connection response was incomplete');
        toast.success(bankId ? 'Bank reconnected' : 'Bank connected via Plaid');
        if (bankId && r.webhookRegistered === false) toast.warning('Automatic bank updates could not be turned on. Use Sync to fetch new transactions.');
        if (!bankId && r.firstSync === 'login_required') toast.warning('The bank asks you to log in again. Use Reconnect on this bank.');
        else if (!bankId && r.firstSync && r.firstSync !== 'ok') toast.warning('Press Sync once to start automatic bank updates.');
        onSuccessSync?.();
      } catch (err) {
        if (isCurrent() && !controller.signal.aborted) {
          toast.error(`${err instanceof Error ? err.message : 'Failed to connect bank'}. Check your bank connections before trying again.`);
        }
      } finally {
        writing.current = false;
        if (writeController.current === controller) writeController.current = null;
        if (isCurrent()) onClosed();
      }
    },
    [onSuccessSync, bankId, workspaceId, onClosed, isCurrent]
  );

  const { open, ready, error: linkError } = usePlaidLink({ token, onSuccess, onExit: () => { if (isCurrent()) onClosed(); } });
  useEffect(() => {
    if (linkError && isCurrent()) {
      toast.error('The bank connection could not be loaded. Please try again.');
      onClosed();
    }
  }, [linkError, isCurrent, onClosed]);
  useEffect(() => { if (ready) open(); }, [ready, open]);

  return <ConnectButton label={label} onClick={() => { if (ready) open(); }} busy={!ready} />;
}
