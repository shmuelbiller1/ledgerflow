import React, { useId, useState } from 'react';
import { toast } from 'sonner';
import { useAuthStore } from '../../../stores/useAuthStore';
import { useCurrentRole } from '../../../hooks/useCurrentRole';
import { saveWorkspaceSettings } from '../../../lib/workspaceSettingsSave';
import { MONEY_LOCALES, moneyText, type MoneyDisplaySettings } from '../../../lib/moneyFormat';

/**
 * How money is shown in this workspace (BB-05 localisation; BM-01 symbol placement, BM-02
 * separators, BM-03 accounting negatives): a country's number style and whether a negative amount
 * shows as -1,234.56 or (1,234.56). Display only: no amount is ever changed (src/lib/moneyFormat.ts).
 * Owners and accountants choose it for everyone in the workspace (`moneyDisplay`); menus stay in
 * English (owner decision 10).
 */
export default function MoneyDisplayPanel() {
  const id = useId();
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const setWorkspaces = useAuthStore(s => s.setWorkspaces);
  const role = useCurrentRole();
  const [busy, setBusy] = useState(false);
  if (!workspace) return null;
  const canChange = role === 'owner' || role === 'accountant';
  const current: MoneyDisplaySettings = workspace.moneyDisplay || {};
  const currency = workspace.currency || 'USD';
  const sample = (settings: MoneyDisplaySettings) => `${moneyText(123456789, currency, 2, settings)} · ${moneyText(-123456, currency, 2, settings)}`;

  const save = async (change: MoneyDisplaySettings) => {
    const next: MoneyDisplaySettings = { ...current, ...change };
    const clean: MoneyDisplaySettings = { ...(next.locale ? { locale: next.locale } : {}), ...(next.negativeStyle === 'accounting' ? { negativeStyle: 'accounting' } : {}) };
    setBusy(true);
    try {
      await saveWorkspaceSettings(workspace.id, { moneyDisplay: clean });
      setWorkspaces(useAuthStore.getState().workspaces.map(w => (w.id === workspace.id ? { ...w, moneyDisplay: clean } : w)));
      toast.success(`Money now shows as ${sample(clean)}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The money style was not saved');
    } finally {
      setBusy(false);
    }
  };

  const locales = MONEY_LOCALES.some(l => l.value === (current.locale || '')) ? MONEY_LOCALES : [...MONEY_LOCALES, { value: current.locale || '', label: current.locale || '' }];
  return (
    <div role="group" aria-labelledby={`${id}-title`} className="p-5 bg-[var(--panel)] border border-[var(--line)] rounded-xl space-y-3">
      <span id={`${id}-title`} className="text-xs font-bold uppercase tracking-wider text-[var(--text)]">Money display (whole workspace)</span>
      <div className="flex flex-wrap gap-3 text-sm">
        <label className="flex flex-col gap-1 text-[var(--muted)]">Number style
          <select value={current.locale || ''} disabled={!canChange || busy} onChange={e => void save({ locale: e.target.value || undefined })} className="px-2 py-1.5 border border-[var(--line)] rounded bg-[var(--surface)] text-[var(--text)]">
            {locales.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[var(--muted)]">Negative amounts
          <select value={current.negativeStyle === 'accounting' ? 'accounting' : 'minus'} disabled={!canChange || busy} onChange={e => void save({ negativeStyle: e.target.value as 'minus' | 'accounting' })} className="px-2 py-1.5 border border-[var(--line)] rounded bg-[var(--surface)] text-[var(--text)]">
            <option value="minus">With a minus sign</option>
            <option value="accounting">In brackets (accounting)</option>
          </select>
        </label>
      </div>
      <p className="text-xs text-[var(--muted)]">Shows as <bdi data-testid="money-sample">{sample(current)}</bdi>. Only how amounts look changes; nothing in the books does.{canChange ? '' : ' Owners and accountants choose it.'}</p>
    </div>
  );
}
