import React, { useId } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { DEFAULT_WORKSPACE_DIMENSIONS, displayDimensionName } from '../../lib/dimensionUtils';
import type { DocumentDefaults } from '../../lib/documentDefaults';

/** Only drafting metadata; each document still uses its ordinary validation/save service. */
export default function DocumentDefaultsEditor({ side, value, onChange, showTax = true }: {
  side: 'customer' | 'vendor' | 'item'; value: DocumentDefaults; onChange: (value: DocumentDefaults) => void; showTax?: boolean;
}) {
  const id = useId();
  useLedgerCollections('accounts', 'taxRates');
  const accounts = useLedgerStore(s => s.accounts);
  const taxRates = useLedgerStore(s => s.taxRates);
  const nodes = useLedgerStore(s => s.dimensionNodes);
  const axes = useAuthStore(s => s.getCurrentWorkspace()?.dimensions) || DEFAULT_WORKSPACE_DIMENSIONS;
  const viewer = useCurrentRole() === 'viewer';
  const choices = accounts.filter(a => !a.isArchived && (side === 'customer' ? ['income', 'revenue'].includes(a.type) : side === 'vendor' ? ['expense', 'cost_of_goods', 'asset'].includes(a.type) : ['income', 'revenue', 'expense', 'cost_of_goods', 'asset'].includes(a.type)));
  const codes = taxRates.filter(t => t.type === 'Sales' && (side === 'customer' ? t.appliesTo !== 'purchases' : side === 'vendor' ? t.appliesTo !== 'sales' : true));
  const field = 'min-h-11 w-full min-w-0 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]';
  return <fieldset disabled={viewer} className="min-w-0 space-y-3 rounded-xl border border-[var(--line)] p-3">
    <legend className="px-1 text-sm font-semibold">Document defaults</legend>
    <p className="text-xs text-[var(--muted)]">Fill empty fields when selected. Anything already entered stays as it is. These are suggestions, not changes to existing documents.</p>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <label className="min-w-0 text-xs space-y-1">Default account
        <select disabled={viewer} aria-label="Default account" className={field} value={value.accountId || ''} onChange={e => onChange({ ...value, accountId: e.target.value })}>
          <option value="">No default</option>
          {value.accountId && !choices.some(a => a.id === value.accountId) && <option value={value.accountId}>Unavailable account — choose another</option>}
          {choices.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </label>
      {showTax && <label className="min-w-0 text-xs space-y-1">Default tax
        <select disabled={viewer} aria-label="Default tax" className={field} value={value.taxCodeId || ''} onChange={e => onChange({ ...value, taxCodeId: e.target.value })}>
          <option value="">No default</option>
          {value.taxCodeId && !codes.some(t => t.id === value.taxCodeId) && <option value={value.taxCodeId}>Unavailable tax code — choose another</option>}
          {codes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>}
      {axes.filter(a => a.id !== 'category').map(axis => <label key={axis.id} className="min-w-0 text-xs space-y-1">Default {displayDimensionName(axis)}
        <select disabled={viewer} aria-label={`Default ${displayDimensionName(axis)}`} className={field} value={value.dimensions?.[axis.id.toLowerCase()] || ''} onChange={e => onChange({ ...value, dimensions: { ...value.dimensions, [axis.id.toLowerCase()]: e.target.value } })}>
          <option value="">No default</option>
          {value.dimensions?.[axis.id.toLowerCase()] && !nodes.some(n => n.dimensionId === axis.id && n.id === value.dimensions?.[axis.id.toLowerCase()] && n.status !== 'archived') && <option value={value.dimensions[axis.id.toLowerCase()]}>{value.dimensions[axis.id.toLowerCase()]}</option>}
          {nodes.filter(n => n.dimensionId === axis.id && n.status !== 'archived').map(n => <option key={`${id}-${n.id}`} value={n.id}>{n.description}</option>)}
        </select>
      </label>)}
    </div>
  </fieldset>;
}
