import React, { useId, useMemo, useState } from 'react';
import { Link2 } from 'lucide-react';
import { useEntityOperations } from '../../hooks/useEntityOperations';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { linkableVendorIds, linkedPair, partyNetPosition } from '../../lib/partyLink';
import { formatCurrency } from '../../lib/utils';
import type { PartySide } from './PartyModal';
import { RelatedRecordEditButton } from './RecordDetailsLauncher';

/**
 * CA-29: on a customer's or vendor's page, the other side of the same business. The customer's page
 * links (or unlinks) a vendor; both pages show what they owe us, what we owe them and the net.
 * Viewers read; other roles change the link. Display only: nothing is offset or posted.
 */
export default function PartyLinkPanel({ side, partyId }: { side: PartySide; partyId: string }) {
  const id = useId();
  const customers = useLedgerStore(s => s.customers);
  const vendors = useLedgerStore(s => s.vendors);
  const invoices = useLedgerStore(s => s.invoices);
  const bills = useLedgerStore(s => s.bills);
  const currency = useAuthStore(s => s.getCurrentWorkspace()?.currency) || 'USD';
  const { updateEntity } = useEntityOperations();
  const canEdit = useCurrentRole() !== 'viewer';
  const [saving, setSaving] = useState(false);
  // the vendor picked while its save runs or after it was refused, so a retry does not need picking again
  const [pending, setPending] = useState<string | null>(null);
  // the browser holds at most a capped slice of each list: say so instead of presenting a partial answer as complete
  const truncated = useLedgerStore(s => s.truncatedCollections);
  const incomplete = ['customers', 'vendors', 'invoices', 'bills'].some(c => truncated[c]);
  // until every input has arrived (or while one failed) an empty list is not a zero: withhold the totals
  const { loading } = useLedgerCollections('customers', 'vendors', 'invoices', 'bills');
  const failed = useDataNeedsStore(s => ['customers', 'vendors', 'invoices', 'bills'].some(c => s.failed[c as 'bills']));
  const totalsReady = !loading && !failed;

  const activeVendors = useMemo(() => vendors.filter(v => v.status !== 'inactive' && !(v as { isArchived?: boolean }).isArchived), [vendors]);
  // a capped vendor list may not hold the linked vendor: then trust the stored link rather than show "Not linked"
  const storedVendorId = side === 'customer' ? customers.find(c => c.id === partyId)?.linkedVendorId : undefined;
  const vendorsCapped = !!truncated.vendors;
  const vendorIds = useMemo(() => {
    const ids = new Set(vendors.map(v => v.id));
    if (vendorsCapped && storedVendorId) ids.add(storedVendorId);
    if (vendorsCapped && side === 'vendor') ids.add(partyId);
    return ids;
  }, [vendors, vendorsCapped, storedVendorId, side, partyId]);
  const pair = linkedPair(side, partyId, customers, vendorIds);
  // a link kept only from the stored id (capped list) stays editable, but its totals wait until the vendor is confirmed loaded
  const vendorConfirmed = !!pair && vendors.some(v => v.id === pair.vendorId);
  const position = pair && vendorConfirmed ? partyNetPosition(pair, invoices, bills) : null;
  const other = pair ? (side === 'customer' ? vendors.find(v => v.id === pair.vendorId) : customers.find(c => c.id === pair.customerId)) : undefined;
  const choices = side === 'customer' ? linkableVendorIds(partyId, customers, activeVendors.map(v => v.id)) : [];

  // one save at a time; updateEntity reports its own outcome
  const link = (vendorId: string) => {
    if (saving || !canEdit || side !== 'customer') return;
    setSaving(true);
    setPending(vendorId);
    updateEntity('customers', partyId, { linkedVendorId: vendorId }, vendorId ? 'Vendor linked' : 'Link removed').then(
      () => setPending(null),
      () => undefined, // refused (e.g. the vendor was just linked elsewhere): keep the choice shown; updateEntity reported it
    ).finally(() => setSaving(false));
  };

  if (side === 'vendor' && !pair && !truncated.customers) return null;

  return (
    <section aria-labelledby={`${id}-title`} className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3">
      <h2 id={`${id}-title`} className="font-bold text-slate-900 dark:text-white text-sm flex items-center gap-2">
        <Link2 aria-hidden="true" className="w-4 h-4" /> Same business as a {side === 'customer' ? 'vendor' : 'customer'}
      </h2>
      {side === 'customer' && (canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={`${id}-vendor`} className="text-xs text-[var(--muted)]">Linked vendor</label>
          <select
            id={`${id}-vendor`}
            value={pending ?? (pair?.vendorId || '')}
            disabled={saving}
            aria-busy={saving}
            onChange={e => link(e.target.value)}
            className="p-2 bg-[var(--panel)] border border-[var(--line)] rounded-lg text-sm text-[var(--text)]"
          >
            <option value="">Not linked</option>
            {pair && !choices.includes(pair.vendorId) && <option value={pair.vendorId}>{other?.name || pair.vendorId}</option>}
            {choices.map(vid => <option key={vid} value={vid}>{vendors.find(v => v.id === vid)?.name || vid}</option>)}
          </select>
          {pending !== null && !saving && (
            <span className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400" role="status">
              Not saved
              <button type="button" onClick={() => link(pending)} className="min-h-11 px-3 border border-[var(--line)] rounded-lg text-[var(--text)]">Try again</button>
            </span>
          )}
          {pair?.vendorId && <RelatedRecordEditButton target={{ kind: 'vendors', id: pair.vendorId }} />}
        </div>
      ) : (
        <p className="text-sm text-[var(--text)]">{other ? `Linked to vendor ${other.name}` : 'Not linked to a vendor'}</p>
      ))}
      {side === 'vendor' && other && <p className="text-sm text-[var(--text)]">Linked to customer {other.name} <RelatedRecordEditButton target={{ kind: 'customers', id: other.id }} /></p>}
      {incomplete && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Not every contact or document is loaded in this browser, so a link or part of these totals may be missing. Check the receivables and payables reports for the full figures.
        </p>
      )}
      {position && !totalsReady && (
        <p role="status" className="text-xs text-[var(--muted)]">{failed ? 'Some invoices, bills or contacts could not be loaded, so the totals are not shown.' : 'Loading invoices and bills…'}</p>
      )}
      {position && totalsReady && (
        <dl className="grid grid-cols-3 gap-2 text-sm" aria-label="Net position with this business">
          <div><dt className="text-xs text-[var(--muted)]">They owe us</dt><dd className="font-mono">{formatCurrency(position.receivableCents, currency)}</dd></div>
          <div><dt className="text-xs text-[var(--muted)]">We owe them</dt><dd className="font-mono">{formatCurrency(position.payableCents, currency)}</dd></div>
          <div>
            <dt className="text-xs text-[var(--muted)]">Net</dt>
            <dd className="font-mono font-bold">
              {position.netCents === 0 ? formatCurrency(0, currency) : `${formatCurrency(Math.abs(position.netCents), currency)} ${position.netCents > 0 ? 'owed to us' : 'owed by us'}`}
            </dd>
          </div>
        </dl>
      )}
    </section>
  );
}
