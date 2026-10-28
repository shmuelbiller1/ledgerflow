import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Wallet } from 'lucide-react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { getIdToken } from '../../firebase';
import { formatCurrency, getLocalDateISO, readAmountCents } from '../../lib/utils';
import { applicableDocuments, suggestApplication, unappliedPayments, type AdvancePayment, type ApplicableDocument } from '../../lib/advancePayments';

const centsText = (cents: number) => (cents / 100).toFixed(2);

/**
 * Money a customer paid before the invoice (a deposit) or paid to a vendor before the bill (a prepayment)
 * that is not applied yet (BE-12, K-18): shown on the contact page with "Apply", which fills the open
 * invoices/bills oldest first; the amounts can be changed before applying.
 */
export default function UnappliedPayments({ side, partyId }: { side: 'customer' | 'vendor'; partyId: string }) {
  const received = side === 'customer';
  const payments = useLedgerStore(s => s.payments) as unknown as AdvancePayment[];
  const invoices = useLedgerStore(s => s.invoices) as unknown as ApplicableDocument[];
  const bills = useLedgerStore(s => s.bills) as unknown as ApplicableDocument[];
  useLedgerCollections('payments', received ? 'invoices' : 'bills');
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const baseCurrency = useAuthStore(s => s.getCurrentWorkspace()?.currency) || 'USD';
  const role = useCurrentRole();
  const canApply = role === 'owner' || role === 'accountant' || role === 'bookkeeper';
  const [openId, setOpenId] = useState<string | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  // what the server says is left after applying, until the live update brings the payment itself
  const [leftAfter, setLeftAfter] = useState<Record<string, number>>({});

  const waiting = useMemo(
    () => unappliedPayments(payments || [], partyId, received ? 'received' : 'made')
      .map(p => ({ ...p, unappliedCents: Math.min(Number(p.unappliedCents) || 0, leftAfter[p.id] ?? Infinity) }))
      .filter(p => p.unappliedCents > 0),
    [payments, partyId, received, leftAfter],
  );
  const open = waiting.find(p => p.id === openId);
  const documents = useMemo(
    () => (open ? applicableDocuments(open, (received ? invoices : bills) || [], partyId, baseCurrency) : []),
    [open, received, invoices, bills, partyId, baseCurrency],
  );
  if (waiting.length === 0) return null;

  const docWord = received ? 'invoice' : 'bill';
  const start = (p: AdvancePayment & { unappliedCents: number }) => {
    const docs = applicableDocuments(p, (received ? invoices : bills) || [], partyId, baseCurrency);
    const suggested = suggestApplication(p.unappliedCents, docs.map(d => ({ id: d.doc.id, dueCents: d.dueCents })));
    setAmounts(Object.fromEntries(Object.entries(suggested).map(([id, cents]) => [id, centsText(cents)])));
    setOpenId(p.id);
  };
  const chosen = documents
    .map(d => ({ documentId: d.doc.id, documentType: docWord as 'invoice' | 'bill', amountCents: readAmountCents(amounts[d.doc.id]) ?? 0, dueCents: d.dueCents }))
    .filter(a => a.amountCents > 0);
  // a typed amount that is not an amount ('1.2.3') is refused, not dropped as if left blank
  const badAmount = documents.some(d => (amounts[d.doc.id] || '').trim() !== '' && readAmountCents(amounts[d.doc.id]) === null);
  const total = chosen.reduce((sum, a) => sum + a.amountCents, 0);
  const tooMuch = open ? total > open.unappliedCents : false;
  const overDue = chosen.find(a => a.amountCents > a.dueCents);
  const currency = open?.currency || baseCurrency;

  const apply = async () => {
    if (!open || busy) return;
    if (badAmount) return toast.error('One of the amounts is not a number. Correct it, then apply.');
    if (chosen.length === 0) return toast.error(`Enter an amount on at least one ${docWord}`);
    if (tooMuch || overDue) return;
    setBusy(true);
    try {
      const token = await getIdToken().catch(() => null);
      const res = await fetch(`/api/v1/payments/${encodeURIComponent(open.id)}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ workspaceId, date: getLocalDateISO(), allocations: chosen.map(({ dueCents: _due, ...a }) => a) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'The payment could not be applied');
      const left = Number(data.data?.unappliedCents);
      setLeftAfter(prev => ({ ...prev, [open.id]: Number.isFinite(left) ? left : open.unappliedCents - total }));
      toast.success(`${formatCurrency(total, currency)} applied`);
      setOpenId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby={`unapplied-${partyId}`} className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-4 space-y-3">
      <h2 id={`unapplied-${partyId}`} className="font-bold text-sm flex items-center gap-2 text-[var(--text)]">
        <Wallet className="w-4 h-4 text-amber-600" aria-hidden="true" />
        {received ? 'Paid in advance, not applied to an invoice yet' : 'Paid in advance, not applied to a bill yet'}
      </h2>
      <ul className="space-y-2">
        {waiting.map(p => (
          <li key={p.id} className="text-sm">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-[var(--muted)]">{p.date?.slice(0, 10)} · {p.number || 'Payment'}</span>
              <span className="font-mono font-bold">Unapplied: {formatCurrency(p.unappliedCents, p.currency || baseCurrency)}</span>
              {canApply && openId !== p.id && (
                <button type="button" onClick={() => start(p)} className="text-indigo-600 dark:text-indigo-400 font-semibold hover:underline">
                  Apply to {docWord}s
                </button>
              )}
            </div>
            {openId === p.id && (
              <div className="mt-2 space-y-2 rounded-lg border border-[var(--line)] bg-[var(--panel)] p-3">
                {documents.length === 0 ? (
                  <p className="text-xs text-[var(--muted)]">No open {docWord}s in {p.currency || baseCurrency}. Apply it once there is one.</p>
                ) : documents.map(({ doc, dueCents }) => (
                  <div key={doc.id} className="flex items-center gap-2">
                    <label htmlFor={`apply-${p.id}-${doc.id}`} className="flex-1 truncate">
                      {doc.number || doc.id} · due {doc.dueDate?.slice(0, 10) || doc.date?.slice(0, 10) || '—'} · open {formatCurrency(dueCents, doc.currency || baseCurrency)}
                    </label>
                    <input
                      id={`apply-${p.id}-${doc.id}`}
                      inputMode="decimal"
                      value={amounts[doc.id] || ''}
                      onChange={e => setAmounts(prev => ({ ...prev, [doc.id]: e.target.value }))}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void apply(); } }}
                      className="w-28 p-1 text-right font-mono bg-[var(--panel)] border border-[var(--line)] rounded"
                      placeholder="0.00"
                    />
                  </div>
                ))}
                {tooMuch && <p role="alert" className="text-xs text-rose-600">That is more than the {formatCurrency(p.unappliedCents, currency)} left on this payment.</p>}
                {overDue && <p role="alert" className="text-xs text-rose-600">More than is open on that {docWord}.</p>}
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void apply()}
                    disabled={busy || documents.length === 0 || tooMuch || Boolean(overDue) || total === 0}
                    className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                  >
                    {busy ? 'Applying…' : `Apply ${formatCurrency(total, currency)}`}
                  </button>
                  <button type="button" onClick={() => setOpenId(null)} className="text-xs text-[var(--muted)] hover:underline">Cancel</button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
