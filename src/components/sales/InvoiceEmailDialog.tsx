import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Mail, X } from 'lucide-react';
import type { Invoice } from '../../types';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { getIdToken } from '../../firebase';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { deliveryLabel, deliveryPhrase, preferredDelivery } from '../../lib/delivery';
import { approvalDetail, approvalStatus, isApproverRole } from '../../lib/invoiceApproval';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { useDialog } from '../../hooks/useDialog';

/**
 * Email an invoice or a payment reminder to the customer, and see every email sent for it
 * (send log with bounces and complaints, BL-05). Server: src/server/routes/emailRoutes.ts.
 */

interface LogEvent { event: string; recipient: string; subject: string | null; template: string | null; error: string | null; againstPreference: string | null; timestamp: string }

const EVENT_LABEL: Record<string, string> = { sent: 'Sent', failed: 'Failed', bounced: 'Bounced', complaint: 'Marked as spam', delivered: 'Delivered' };

async function authorized(path: string, init?: RequestInit) {
  const res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getIdToken()}`, ...(init?.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || 'The request failed');
  return data;
}

export default function InvoiceEmailDialog({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const workspaceId = useAuthStore(s => s.currentWorkspaceId) || '';
  const customer = useLedgerStore(s => s.customers).find(c => c.id === invoice.customerId);
  useLedgerCollections('customers');
  const overdue = !!invoice.dueDate && invoice.status !== 'paid' && invoice.status !== 'draft';
  // Y-27: the customer's own choice of how documents reach them; sending by hand still works, it just
  // says so up front and in the log.
  const paperCopy = preferredDelivery(customer) !== 'email';
  // BE-04: over the approval limit the invoice may not go out on its own; the dialog says why, and
  // for someone allowed to sign, sending it *is* the approval.
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const approvalState = approvalStatus(invoice, workspace?.invoiceApproval);
  const held = approvalState === 'awaiting' || approvalState === 'rejected';
  const canSign = isApproverRole(useCurrentRole());
  const [to, setTo] = useState(() => String(invoice.metadata?.sentTo || customer?.email || ''));
  const [template, setTemplate] = useState<'invoice' | 'reminder'>(overdue && invoice.status !== 'pending' ? 'reminder' : 'invoice');
  const [events, setEvents] = useState<LogEvent[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const { dialogProps, titleId } = useDialog(onClose);
  const base = `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/emails`;

  useEffect(() => {
    let cancelled = false;
    authorized(`${base}/log/${encodeURIComponent(invoice.id)}`)
      .then(data => { if (!cancelled) setEvents(data.events || []); })
      .catch(() => { if (!cancelled) setEvents([]); });
    return () => { cancelled = true; };
  }, [base, invoice.id, version]);

  const send = async () => {
    setBusy(true);
    try {
      const data = await authorized(`${base}/invoices/${encodeURIComponent(invoice.id)}`, { method: 'POST', body: JSON.stringify({ template, to }) });
      toast.success(`${template === 'reminder' ? 'Reminder' : 'Invoice'} emailed to ${data.to}.`);
      setVersion(v => v + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The email could not be sent');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div {...dialogProps} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-xl border border-[var(--line)] bg-[var(--surface)] shadow-xl">
        <div className="flex items-center justify-between border-b border-[var(--line)] p-4">
          <h2 id={titleId} className="text-sm font-bold text-[var(--text)] inline-flex items-center gap-2">
            <Mail className="w-4 h-4" aria-hidden="true" /> Email invoice {invoice.number || invoice.id}
          </h2>
          <button type="button" onClick={onClose} className="p-1 text-[var(--muted)]" aria-label="Close"><X className="w-4 h-4" aria-hidden="true" /></button>
        </div>
        <div className="space-y-3 p-4 text-sm">
          <div>
            <label htmlFor="email-to" className="mb-1 block text-xs font-semibold text-[var(--text)]">To</label>
            <input id="email-to" type="email" value={to} onChange={e => setTo(e.target.value)} className="w-full rounded-lg border border-[var(--line)] bg-[var(--panel)] px-3 py-2 text-[var(--text)]" />
          </div>
          <div>
            <label htmlFor="email-template" className="mb-1 block text-xs font-semibold text-[var(--text)]">Email</label>
            <select id="email-template" value={template} onChange={e => setTemplate(e.target.value as 'invoice' | 'reminder')} className="w-full rounded-lg border border-[var(--line)] bg-[var(--panel)] px-3 py-2 text-[var(--text)]">
              <option value="invoice">The invoice</option>
              <option value="reminder">Payment reminder</option>
            </select>
            <p className="mt-1 text-[11px] text-[var(--muted)]">The text comes from Settings → Emails & Reminders. The PDF is attached.</p>
          </div>
          {paperCopy && (
            <p className="text-xs text-[var(--neg)]">
              This customer asked for {deliveryPhrase(preferredDelivery(customer))} (Settings → {customer?.name || 'the customer'} → Documents go out by).
              Pressing send emails it anyway, and the log below says it went against their choice.
            </p>
          )}
          {held && (
            <p className="text-xs text-[var(--neg)]">
              {approvalDetail(approvalState, workspace?.invoiceApproval, invoice.approval, workspace?.currency)}
              {canSign
                ? ' Pressing send emails it and records your approval.'
                : ' An owner or an accountant approves it from the invoice list; until then it stays here.'}
            </p>
          )}
          <button type="button" disabled={busy || !to.includes('@') || invoice.status === 'draft'} onClick={send}
            className="rounded-lg bg-[var(--brass)] px-4 py-2 text-sm font-bold text-black disabled:opacity-50">
            {busy ? 'Sending…' : held && canSign ? 'Approve and send' : paperCopy ? 'Email anyway' : 'Send'}
          </button>
          {invoice.status === 'draft' && <p className="text-xs text-[var(--muted)]">Save the invoice as final before emailing it.</p>}

          <div className="border-t border-[var(--line)] pt-3">
            <p className="mb-2 text-xs font-semibold text-[var(--muted)]">Emails for this invoice</p>
            {events === null ? <p className="text-xs text-[var(--muted)]">Loading…</p>
              : events.length === 0 ? <p className="text-xs text-[var(--muted)]">None yet.</p>
              : (
                <ul className="max-h-48 space-y-1 overflow-auto text-xs">
                  {events.map(e => (
                    <li key={`${e.timestamp}:${e.event}:${e.recipient}`} className="flex justify-between gap-3">
                      <span className={e.event === 'sent' || e.event === 'delivered' ? 'text-[var(--text)]' : 'text-[var(--neg)]'}>
                        {EVENT_LABEL[e.event] || e.event}{e.template === 'reminder' ? ' (reminder)' : ''} · {e.recipient}{e.error ? ` · ${e.error}` : ''}
                        {e.againstPreference ? <span className="text-[var(--neg)]"> · against their choice ({deliveryLabel(e.againstPreference)})</span> : null}
                      </span>
                      <span className="shrink-0 text-[var(--muted)]">{e.timestamp.slice(0, 16).replace('T', ' ')}</span>
                    </li>
                  ))}
                </ul>
              )}
          </div>
        </div>
      </div>
    </div>
  );
}
