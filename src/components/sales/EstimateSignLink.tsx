import React, { useLayoutEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { formatDate } from '../../lib/utils';
import type { EstimateSignature } from '../../lib/estimateSignature';
import { runCommand } from '../../lib/runCommand';
import { useAuthStore } from '../../stores/useAuthStore';

/**
 * Y-20 on Sales → Estimates: "Ask to sign" makes the estimate's private signing link (the server
 * keeps it; asking again gives the same link) and copies it to send to the customer; a signed
 * estimate says who signed and when.
 */
export function EstimateSignLink({ workspaceId, estimate }: { workspaceId: string; estimate: { id: string; number?: string } }) {
  const [busy, setBusy] = useState(false);
  const uid = useAuthStore(s => s.user?.uid || '');
  const [result, setResult] = useState<{ scope: string; link: string } | null>(null);
  const scope = JSON.stringify([workspaceId, estimate.id, uid]);
  const currentScope = useRef(scope);
  useLayoutEffect(() => { currentScope.current = scope; }, [scope]);
  const alive = useRef(false);
  const pending = useRef(false);
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const link = result?.scope === scope ? result.link : '';
  const stillCurrent = () => alive.current && currentScope.current === scope && useAuthStore.getState().currentWorkspaceId === workspaceId && useAuthStore.getState().user?.uid === uid;
  const ask = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      const body = await runCommand<{ token?: string }>({
        path: `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/estimates/${encodeURIComponent(estimate.id)}/sign-link`,
        method: 'POST',
      }) ?? {};
      if (!stillCurrent()) return;
      if (typeof body.token !== 'string' || !body.token.trim()) {
        throw new Error('The server accepted the request but returned no link. Refresh the estimate before trying again.');
      }
      const url = `${window.location.origin}/e/${body.token}`;
      setResult({ scope, link: url });
      let copied = false;
      if (navigator.clipboard?.writeText) {
        try { await navigator.clipboard.writeText(url); copied = true; } catch { copied = false; }
      }
      if (stillCurrent()) toast.success(copied ? 'Signing link copied: send it to the customer' : 'Signing link ready: copy it below and send it to the customer');
    } catch (err) {
      if (stillCurrent()) toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return (
    <>
      <button type="button" disabled={busy} onClick={() => void ask()}
        className="px-2.5 py-1 text-xs font-semibold border border-[var(--line)] text-[var(--text)] rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
        aria-label={`Ask the customer to sign estimate ${estimate.number || estimate.id}`} title="A private link where the customer reads the estimate and signs to accept it">
        Ask to sign
      </button>
      {link && <input readOnly value={link} aria-label="Signing link" onFocus={e => e.target.select()} className="w-56 px-2 py-1 text-xs border border-[var(--line)] rounded bg-[var(--panel)] text-[var(--text)]" />}
    </>
  );
}

export function EstimateSignedNote({ signature }: { signature?: EstimateSignature }) {
  if (!signature) return null;
  return <p className="mt-1 text-right text-xs text-emerald-700 dark:text-emerald-400">Signed online by <bdi>{signature.name}</bdi> on {formatDate(signature.signedAt.slice(0, 10))}</p>;
}
