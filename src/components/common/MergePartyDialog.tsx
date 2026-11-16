import { runCommand } from '../../lib/runCommand';
import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { useDialog } from '../../hooks/useDialog';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { detectDuplicateContacts } from '../../lib/contactUtils';
import type { Customer, Vendor } from '../../types';
import type { PartySide } from './PartyModal';

interface MergePartyDialogProps {
  side: PartySide;
  /** The contact that is kept (the page being viewed). */
  party: Customer | Vendor;
  onClose: () => void;
}

/**
 * Merge a duplicate into this customer or vendor (Y-23 BA-01). Likely duplicates (same name,
 * email or tax number) are listed first. The server moves every document, payment and schedule
 * of the duplicate here and deletes the duplicate, in one step.
 */
export default function MergePartyDialog({ side, party, onClose }: MergePartyDialogProps) {
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  useLedgerCollections('bills', 'customers', 'invoices', 'payments', 'vendors');
  const parties = useLedgerStore(s => (side === 'customer' ? s.customers : s.vendors)) as Array<Customer | Vendor>;
  const invoices = useLedgerStore(s => s.invoices);
  const bills = useLedgerStore(s => s.bills);
  const payments = useLedgerStore(s => s.payments);
  const [mergeId, setMergeId] = useState('');
  const [saving, setSaving] = useState(false);
  const { dialogProps, titleId } = useDialog(onClose, true);
  const label = side === 'customer' ? 'customer' : 'vendor';

  const options = useMemo(() => {
    const others = parties.filter(p => p.id !== party.id);
    const group = detectDuplicateContacts([party, ...others]).find(g => g.primaryContact.id === party.id);
    const likely = new Set((group?.duplicates || []).map(d => d.id));
    return [...others].sort((a, b) => Number(likely.has(b.id)) - Number(likely.has(a.id)) || a.name.localeCompare(b.name))
      .map(p => ({ party: p, likely: likely.has(p.id) }));
  }, [parties, party]);

  const chosen = options.find(o => o.party.id === mergeId)?.party;
  const documents = chosen
    ? side === 'customer' ? invoices.filter(i => i.customerId === chosen.id).length : bills.filter(b => b.vendorId === chosen.id).length
    : 0;
  const paymentCount = chosen ? payments.filter(p => p.contactId === chosen.id).length : 0;

  const submit = async () => {
    if (!chosen || !workspaceId) return;
    setSaving(true);
    try {
      await runCommand({
        path: `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/contacts/merge`,
        method: 'POST',
        body: { side, keepId: party.id, mergeId: chosen.id },
      });
      toast.success(`"${chosen.name}" merged into "${party.name}"`);
      onClose();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div {...dialogProps} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-[var(--surface)] rounded-xl shadow-xl max-w-md w-full border border-[var(--line)]">
        <div className="flex items-center justify-between p-5 border-b border-[var(--line)]">
          <h2 id={titleId} className="text-lg font-bold text-[var(--text)]">Merge a duplicate into {party.name}</h2>
          <button type="button" onClick={onClose} aria-label="Close merge" className="p-1 rounded-lg text-[var(--muted)] hover:text-[var(--text)]">
            <X aria-hidden="true" className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label htmlFor="merge-party" className="block text-xs font-semibold text-[var(--muted)] mb-1">Duplicate {label} to merge in</label>
            <select id="merge-party" value={mergeId} onChange={e => setMergeId(e.target.value)} className="w-full px-3 py-2 text-sm bg-[var(--ink)] border border-[var(--line)] rounded-lg text-[var(--text)]">
              <option value="">Choose a {label}…</option>
              {options.map(({ party: p, likely }) => (
                <option key={p.id} value={p.id}>{p.name}{p.email ? ` (${p.email})` : ''}{likely ? ' · likely duplicate' : ''}</option>
              ))}
            </select>
          </div>
          {chosen && (
            <p role="status" className="text-xs text-[var(--text)] bg-[var(--ink)] border border-[var(--line)] rounded-lg p-3">
              {documents} {side === 'customer' ? 'invoice' : 'bill'}{documents === 1 ? '' : 's'}, {paymentCount} payment{paymentCount === 1 ? '' : 's'} and
              everything else of &quot;{chosen.name}&quot; will belong to &quot;{party.name}&quot;. Amounts do not change.
              &quot;{chosen.name}&quot; is then deleted; empty details here are filled from it. This cannot be undone.
            </p>
          )}
          <div className="flex justify-end gap-3">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg text-[var(--text)] hover:bg-[var(--ink)]">Cancel</button>
            <button type="button" disabled={!chosen || saving} onClick={submit} className="px-4 py-2 text-sm font-semibold rounded-lg bg-rose-700 text-white disabled:opacity-50">
              {saving ? 'Merging…' : 'Merge'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
