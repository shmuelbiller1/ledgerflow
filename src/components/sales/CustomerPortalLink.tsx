import React, { useState } from 'react';
import { Link2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { getIdToken } from '../../firebase';
import { safeConfirm } from '../../lib/utils';
import type { Customer } from '../../types';

/**
 * The customer's portal link (K-27) on their page: make one (the customer sees their invoices and pays
 * them, no sign-in), copy it, make a new one (the old one stops working) or turn it off.
 */
export default function CustomerPortalLink({ customer }: { customer: Customer }) {
  const workspaceId = useAuthStore(s => s.currentWorkspaceId) || '';
  const role = useCurrentRole();
  const canShare = role === 'owner' || role === 'accountant' || role === 'bookkeeper';
  const [busy, setBusy] = useState(false);
  const token = customer.portalToken || '';
  const link = token ? `${window.location.origin}/c/${token}` : '';

  const call = async (method: 'POST' | 'DELETE') => {
    setBusy(true);
    try {
      const auth = await getIdToken().catch(() => null);
      const res = await fetch(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/customers/${encodeURIComponent(customer.id)}/portal-link`, {
        method, headers: auth ? { Authorization: `Bearer ${auth}` } : {},
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'That did not work');
      const next = method === 'POST' ? String(data.token) : null;
      useLedgerStore.setState(s => ({ customers: s.customers.map(c => (c.id === customer.id ? { ...c, portalToken: next } : c)) }));
      if (next) {
        let copied = true;
        await navigator.clipboard?.writeText(`${window.location.origin}/c/${next}`).catch(() => { copied = false; });
        toast.success(
          token
            ? (copied ? 'New link made and copied; the old one no longer works' : 'New link made (copy it below); the old one no longer works')
            : (copied ? 'Portal link made and copied' : 'Portal link made (copy it below)')
        );
      } else {
        toast.success('Portal link turned off');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!canShare && !link) return null;
  return (
    <section aria-labelledby={`portal-${customer.id}`} className="p-4 rounded-xl border border-[var(--line)] bg-[var(--surface)] space-y-2 text-sm">
      <h3 id={`portal-${customer.id}`} className="font-semibold text-[var(--text)] flex items-center gap-2"><Link2 className="w-4 h-4" aria-hidden="true" /> Customer portal</h3>
      <p className="text-xs text-[var(--muted)]">A private link where <bdi>{customer.name}</bdi> sees their invoices and pays them, without signing in.</p>
      {link ? (
        <div className="flex flex-wrap items-center gap-2">
          <input readOnly value={link} aria-label="Portal link" dir="ltr" onFocus={e => e.currentTarget.select()}
            className="flex-1 min-w-[16rem] px-2 py-1.5 text-xs border border-[var(--line)] rounded bg-[var(--panel)] text-[var(--text)]" />
          <button type="button" onClick={() => { void navigator.clipboard?.writeText(link).then(() => toast.success('Link copied')).catch(() => { toast.error('Could not copy link to clipboard'); }); }}
            className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">Copy</button>
          {canShare && (
            <>
              <button type="button" disabled={busy} onClick={() => { if (safeConfirm('Make a new link? The old one stops working.')) void call('POST'); }}
                className="text-xs text-[var(--muted)] hover:underline disabled:opacity-50">New link</button>
              <button type="button" disabled={busy} onClick={() => void call('DELETE')} className="text-xs text-[var(--muted)] hover:text-rose-600 disabled:opacity-50">Turn off</button>
            </>
          )}
        </div>
      ) : (
        <button type="button" disabled={busy} onClick={() => void call('POST')}
          className="px-3 py-1.5 rounded bg-indigo-600 text-white text-xs font-semibold disabled:opacity-50">{busy ? 'Making…' : 'Make a portal link'}</button>
      )}
    </section>
  );
}
