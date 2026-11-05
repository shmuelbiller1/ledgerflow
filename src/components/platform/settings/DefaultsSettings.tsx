import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useAuthStore } from '../../../stores/useAuthStore';
import { useLedgerStore } from '../../../stores/useLedgerStore';
import { useLedgerCollections } from '../../../hooks/useLedgerCollections';
import { useCurrentRole } from '../../../hooks/useCurrentRole';
import { db } from '../../../firebase';
import { doc, updateDoc } from '../../../lib/db/firestore';
import { DEFAULT_ACCOUNT_SLOTS, accountInUse, withDefault, type DefaultAccountSlot } from '../../../lib/accountDefaults';
import type { ChartAccount } from '../../../types';

const accountLabel = (a: ChartAccount) => `${a.code ? `${a.code} – ` : ''}${a.name}`;

/**
 * Settings → Defaults (BB-03): the account each kind of posting uses, in one place. Each row says
 * which account is used now ("automatic" when none is chosen, the same rule the posting follows);
 * choosing one saves at once. Owners and accountants change them; everyone else reads them.
 * Default payment terms come from the customer (or their last invoice); the default tax code is the
 * one marked default in the tax codes.
 */
export default function DefaultsSettings() {
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const storedAccounts = useLedgerStore(s => s.accounts);
  useLedgerCollections('accounts');
  const accounts = useMemo(() => (storedAccounts || []).filter(a => !a.isArchived && a.isActive !== false), [storedAccounts]);
  const role = useCurrentRole();
  const canEdit = role === 'owner' || role === 'accountant';
  const [saving, setSaving] = useState<string | null>(null);
  const mappings = workspace?.defaultAccountMappings;

  const choose = async (slot: DefaultAccountSlot, accountId: string) => {
    if (!workspace || saving) return;
    const next = withDefault(mappings, slot.key, accountId);
    setSaving(slot.key);
    try {
      await updateDoc(doc(db, 'workspaces', workspace.id), { defaultAccountMappings: next });
      useAuthStore.setState(s => ({ workspaces: s.workspaces.map(w => (w.id === workspace.id ? { ...w, defaultAccountMappings: next } : w)) }));
      toast.success(`${slot.label}: ${accountId ? accountLabel(accounts.find(a => a.id === accountId) as ChartAccount) : 'automatic'}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="ledger-card p-4 md:p-8 bg-[var(--surface)] border border-[var(--line)] space-y-4">
      <div>
        <h2 className="text-lg font-bold text-[var(--text)]">Default accounts</h2>
        <p className="text-xs text-[var(--muted)]">
          Where invoices, bills and payments post when a line or document doesn’t name an account. “Automatic” is what the app picks by itself from your chart.
        </p>
      </div>
      <ul className="divide-y divide-[var(--line)]">
        {DEFAULT_ACCOUNT_SLOTS.map(slot => {
          const inUse = accountInUse(slot, accounts, mappings);
          const automatic = slot.automatic(accounts, mappings);
          const id = `default-${slot.key.replace(/\s+/g, '-')}`;
          return (
            <li key={slot.key} className="py-3 grid gap-2 sm:grid-cols-[1fr_minmax(0,18rem)] sm:items-center">
              <div className="min-w-0">
                <label htmlFor={id} className="text-sm font-bold text-[var(--text)]">{slot.label}</label>
                <p className="text-xs text-[var(--muted)]">{slot.hint}</p>
                {!inUse.account && <p className="text-xs text-amber-700 dark:text-amber-400">None in your chart yet: postings that need it stop and say so. Add one in the Chart of Accounts.</p>}
              </div>
              {canEdit ? (
                <select
                  id={id}
                  value={inUse.chosen ? inUse.account?.id : ''}
                  disabled={saving !== null}
                  onChange={e => void choose(slot, e.target.value)}
                  className="w-full p-2 bg-[var(--panel)] border border-[var(--line)] rounded-lg text-sm text-[var(--text)]"
                >
                  <option value="">Automatic{automatic ? ` (${accountLabel(automatic)})` : ' (none found)'}</option>
                  {accounts.filter(slot.fits).map(a => <option key={a.id} value={a.id}>{accountLabel(a)}</option>)}
                </select>
              ) : (
                <p id={id} className="text-sm text-[var(--text)]">{inUse.account ? accountLabel(inUse.account) : '—'}{inUse.account && !inUse.chosen ? ' (automatic)' : ''}</p>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-[var(--muted)]">
        Payment terms on a new invoice come from the customer (or their last invoice). The default tax code is the one marked default in your tax codes.
      </p>
    </div>
  );
}
