import React, { useId, useState } from 'react';
import { toast } from 'sonner';
import { X } from 'lucide-react';
import { getIdToken } from '../../../firebase';
import { useAuthStore } from '../../../stores/useAuthStore';
import { useCurrentRole } from '../../../hooks/useCurrentRole';
import { termOptions } from '../../../lib/paymentTerms';
import { customerGroupNameKey, MAX_CUSTOMER_GROUPS, MAX_CUSTOMER_GROUP_NAME, normalizeCustomerGroups, type CustomerGroup } from '../../../lib/customerGroups';
import InlineEdit from '../../ui/InlineEdit';

/**
 * CC-11: the workspace's customer groups and their defaults. A customer in a group starts each new
 * invoice with the group's payment terms when it has none of its own. Owners and accountants change
 * the list (through the server, one change at a time); others read it. Removing a group leaves its
 * customers without one and changes no invoice.
 */
export function CustomerGroupsSettings() {
  const id = useId();
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const saved = normalizeCustomerGroups(workspace?.customerGroups);
  const role = useCurrentRole();
  const canEdit = role === 'owner' || role === 'accountant';
  const [name, setName] = useState('');
  const [terms, setTerms] = useState('');
  const [saving, setSaving] = useState(false);

  const clean = name.trim();
  const duplicate = clean !== '' && saved.some(g => customerGroupNameKey(g.name) === customerGroupNameKey(clean));
  const full = saved.length >= MAX_CUSTOMER_GROUPS;
  const canAdd = canEdit && !saving && clean !== '' && clean.length <= MAX_CUSTOMER_GROUP_NAME && !duplicate && !full;
  const choices = termOptions(workspace?.paymentTermDays);
  const termsLabel = (value?: string) => choices.find(c => c.value === value)?.label || (value ? value : 'No default');

  // One change at a time, sent to the server, which applies it to the list as it is in the database
  // inside a transaction and refuses one that no longer fits. The reply is ignored after a sign-out or
  // account switch, and its message and draft clearing only belong to the workspace still open. It
  // rejects when the save fails (after saying why), so an inline edit stays open with what was typed.
  type Change = { op: 'add'; name: string; paymentTerms: string } | { op: 'rename'; id: string; name: string } | { op: 'setTerms'; id: string; paymentTerms: string } | { op: 'remove'; id: string };
  const save = (change: Change, done: string, onSaved?: () => void): Promise<void> => {
    if (!workspaceId || saving || !canEdit) return Promise.reject(new Error('Not saved'));
    setSaving(true);
    const startedBy = useAuthStore.getState().user?.uid;
    return getIdToken().catch(() => null).then(token => fetch(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/customer-groups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(change),
    })).then(async res => {
      const data = await res.json().catch(() => ({})) as { message?: string; customerGroups?: unknown };
      if (!res.ok) throw Object.assign(new Error(data.message || 'Customer groups could not be saved (owners and accountants can change them).'), { shown: true });
      const customerGroups = normalizeCustomerGroups(data.customerGroups);
      const now = useAuthStore.getState();
      if (now.user?.uid !== startedBy) return;
      now.setWorkspaces(now.workspaces.map(w => (w.id === workspaceId ? { ...w, customerGroups } : w)));
      if (now.currentWorkspaceId !== workspaceId) return;
      onSaved?.();
      toast.success(done);
    }).catch((err: unknown) => {
      const shown = (err as { shown?: boolean }).shown;
      if (!shown) console.error('[Settings] Failed to save customer groups:', err);
      toast.error(shown ? (err as Error).message : 'Customer groups could not be saved. Check the connection and try again.');
      throw err;
    }).finally(() => setSaving(false));
  };

  const renameProblem = (g: CustomerGroup, next: string | number): string | null => {
    const value = String(next).trim();
    if (!value) return 'Enter a name';
    if (value.length > MAX_CUSTOMER_GROUP_NAME) return `Up to ${MAX_CUSTOMER_GROUP_NAME} characters`;
    if (saved.some(x => x.id !== g.id && customerGroupNameKey(x.name) === customerGroupNameKey(value))) return `${value} is already a customer group`;
    return null;
  };

  const add = (e: React.FormEvent): void => {
    e.preventDefault();
    if (!canAdd) return;
    save({ op: 'add', name: clean, paymentTerms: terms }, `${clean} added`, () => { setName(''); setTerms(''); }).catch(() => undefined); // the failure was already said
  };

  const hint = duplicate ? `${clean} is already a customer group.` : full ? `Up to ${MAX_CUSTOMER_GROUPS} customer groups.` : clean.length > MAX_CUSTOMER_GROUP_NAME ? `Up to ${MAX_CUSTOMER_GROUP_NAME} characters.` : '';

  return (
    <div className="p-5 bg-[var(--panel)] border border-[var(--line)] rounded-xl space-y-3 md:col-span-2">
      <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text)]">Customer groups</h3>
      <p className="text-[10px] text-[var(--muted)]">
        Group customers (for example Wholesale and Retail) and give each group default payment terms. A customer in a group starts new invoices with the group&apos;s terms unless it has its own. Put a customer in a group on its page.
      </p>
      <ul className="space-y-2" aria-label="Your customer groups">
        {saved.length === 0 && <li className="text-xs text-[var(--muted)]">No customer groups yet.</li>}
        {saved.map(g => (
          <li key={g.id} className="flex flex-wrap items-center gap-3 px-3 py-1 rounded-lg border border-[var(--line)] text-sm text-[var(--text)]">
            <InlineEdit value={g.name} label={`Name of customer group ${g.name}`} canEdit={canEdit && !saving}
              onSave={next => save({ op: 'rename', id: g.id, name: String(next).trim() }, `Renamed to ${String(next).trim()}`)}
              validate={next => renameProblem(g, next)} display={<bdi>{g.name}</bdi>} />
            {canEdit ? (
              <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
                Terms
                <select
                  value={g.paymentTerms || ''}
                  disabled={saving}
                  aria-busy={saving}
                  onChange={e => { save({ op: 'setTerms', id: g.id, paymentTerms: e.target.value }, `${g.name}: ${termsLabel(e.target.value)}`).catch(() => undefined); }}
                  className="min-h-11 bg-[var(--surface)] text-[var(--text)] text-sm p-2 rounded-lg border border-[var(--line)]"
                >
                  <option value="">No default</option>
                  {termOptions(workspace?.paymentTermDays, g.paymentTerms).map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </label>
            ) : (
              <span className="text-xs text-[var(--muted)]">Terms: {termsLabel(g.paymentTerms)}</span>
            )}
            {canEdit && (
              <button
                type="button"
                disabled={saving}
                aria-label={`Remove ${g.name}`}
                onClick={() => { save({ op: 'remove', id: g.id }, `${g.name} removed`).catch(() => undefined); }}
                className="ml-auto min-h-11 min-w-11 flex items-center justify-center text-[var(--muted)] hover:text-[var(--text)]"
              >
                <X aria-hidden="true" className="w-3.5 h-3.5" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {canEdit ? (
        <form onSubmit={add} className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <label htmlFor={`${id}-name`} className="text-xs text-[var(--muted)]">Name</label>
            <input id={`${id}-name`} value={name} maxLength={MAX_CUSTOMER_GROUP_NAME + 10} onChange={e => setName(e.target.value)} aria-describedby={`${id}-hint`}
              className="w-48 bg-[var(--surface)] text-[var(--text)] text-sm p-2.5 rounded-lg border border-[var(--line)]" />
          </div>
          <div className="space-y-1">
            <label htmlFor={`${id}-terms`} className="text-xs text-[var(--muted)]">Default terms</label>
            <select id={`${id}-terms`} value={terms} onChange={e => setTerms(e.target.value)}
              className="bg-[var(--surface)] text-[var(--text)] text-sm p-2.5 rounded-lg border border-[var(--line)]">
              <option value="">No default</option>
              {choices.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <button type="submit" disabled={!canAdd} aria-busy={saving}
            className="min-h-11 px-4 rounded-lg border border-[var(--line)] text-sm font-medium text-[var(--text)] disabled:opacity-50">
            Add group
          </button>
          <p id={`${id}-hint`} className="w-full text-[10px] text-[var(--muted)]" role={hint ? 'status' : undefined}>{hint}</p>
        </form>
      ) : (
        <p className="text-[10px] text-[var(--muted)]">Owners and accountants can change these.</p>
      )}
    </div>
  );
}
