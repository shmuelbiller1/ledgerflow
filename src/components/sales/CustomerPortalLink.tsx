import React, { useLayoutEffect, useRef, useState } from 'react';
import { Link2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { safeConfirm } from '../../lib/utils';
import type { Customer } from '../../types';
import { runCommand } from '../../lib/runCommand';

/**
 * The customer's portal link (K-27) on their page: make one (the customer sees their invoices and pays
 * them, no sign-in), copy it, make a new one (the old one stops working) or turn it off.
 */
export default function CustomerPortalLink({ customer }: { customer: Customer }) {
  const workspaceId = useAuthStore(s => s.currentWorkspaceId) || '';
  const uid = useAuthStore(s => s.user?.uid || '');
  const role = useCurrentRole();
  const canShare = role === 'owner' || role === 'accountant' || role === 'bookkeeper';
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState<{ scope: string; message: string } | null>(null);
  const pending = useRef(false);
  const alive = useRef(false);
  const scope = JSON.stringify([workspaceId, uid, customer.id]);
  const currentScope = useRef(scope);
  useLayoutEffect(() => { currentScope.current = scope; }, [scope]);
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const token = customer.portalToken || '';
  const needsRefresh = uncertain?.scope === scope;
  const link = token && !needsRefresh ? `${window.location.origin}/c/${token}` : '';
  const stillCurrent = () => alive.current && currentScope.current === scope && useAuthStore.getState().currentWorkspaceId === workspaceId && useAuthStore.getState().user?.uid === uid;

  const call = async (method: 'POST' | 'DELETE') => {
    if (!workspaceId || !uid || !canShare || pending.current || needsRefresh) return;
    pending.current = true;
    setBusy(true);
    try {
      const data = await runCommand<{ token?: string }>({
        path: `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/customers/${encodeURIComponent(customer.id)}/portal-link`,
        method,
      }) ?? {};
      if (!stillCurrent()) return;
      if (method === 'POST' && (typeof data.token !== 'string' || !data.token.trim())) {
        throw new Error('The server accepted the request but returned no link. Refresh the customer before trying again.');
      }
      const next = method === 'POST' ? data.token! : null;
      useLedgerStore.setState(s => ({ customers: s.customers.map(c => (c.id === customer.id ? { ...c, portalToken: next } : c)) }));
      if (next) {
        let copied = false;
        if (navigator.clipboard?.writeText) {
          try { await navigator.clipboard.writeText(`${window.location.origin}/c/${next}`); copied = true; } catch { copied = false; }
        }
        if (!stillCurrent()) return;
        toast.success(
          token
            ? (copied ? 'New link made and copied; the old one no longer works' : 'New link made (copy it below); the old one no longer works')
            : (copied ? 'Portal link made and copied' : 'Portal link made (copy it below)')
        );
      } else {
        toast.success('Portal link turned off');
      }
    } catch (err) {
      if (stillCurrent()) {
        const message = err instanceof Error ? err.message : String(err);
        setUncertain({ scope, message });
        toast.error(message);
      }
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  };

  if (!canShare && !link) return null;
  return (
    <section aria-labelledby={`portal-${customer.id}`} className="p-4 rounded-xl border border-[var(--line)] bg-[var(--surface)] space-y-2 text-sm">
      <h3 id={`portal-${customer.id}`} className="font-semibold text-[var(--text)] flex items-center gap-2"><Link2 className="w-4 h-4" aria-hidden="true" /> Customer portal</h3>
      <p className="text-xs text-[var(--muted)]">A private link where <bdi>{customer.name}</bdi> sees their invoices and pays them, without signing in.</p>
      {needsRefresh ? (
        <p role="alert" className="text-xs text-rose-600">Could not confirm the link's current state: {uncertain.message} Reload the customer from the server before sharing or changing its link.</p>
      ) : link ? (
        <div className="flex flex-wrap items-center gap-2">
          <input readOnly value={link} aria-label="Portal link" dir="ltr" onFocus={e => e.currentTarget.select()}
            className="flex-1 min-w-[16rem] px-2 py-1.5 text-xs border border-[var(--line)] rounded bg-[var(--panel)] text-[var(--text)]" />
          <button type="button" onClick={() => {
            if (!navigator.clipboard?.writeText) { toast.error('Clipboard is unavailable; select the link to copy it.'); return; }
            void navigator.clipboard.writeText(link).then(() => toast.success('Link copied')).catch(() => { toast.error('Could not copy link to clipboard'); });
          }}
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
