import React, { useState } from 'react';
import { toast } from 'sonner';
import { getIdToken } from '../../firebase';
import { formatDate } from '../../lib/utils';
import type { EstimateSignature } from '../../lib/estimateSignature';

/**
 * Y-20 on Sales → Estimates: "Ask to sign" makes the estimate's private signing link (the server
 * keeps it; asking again gives the same link) and copies it to send to the customer; a signed
 * estimate says who signed and when.
 */
export function EstimateSignLink({ workspaceId, estimate }: { workspaceId: string; estimate: { id: string; number?: string } }) {
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState('');
  const ask = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/estimates/${encodeURIComponent(estimate.id)}/sign-link`, {
        method: 'POST', headers: { Authorization: `Bearer ${await getIdToken()}` },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || 'The signing link could not be made');
      const url = `${window.location.origin}/e/${body.token}`;
      setLink(url);
      let copied = true;
      await navigator.clipboard?.writeText(url).catch(() => { copied = false; });
      toast.success(copied ? 'Signing link copied: send it to the customer' : 'Signing link ready: copy it below and send it to the customer');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
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
