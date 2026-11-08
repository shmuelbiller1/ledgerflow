/**
 * Labels on one document line (BF-09): Project, Location, Property… on an invoice line or a bill
 * line, posted with that line's revenue or expense so reports by label include it. Folded away by
 * default ("Labels", with what is set); it opens by itself when the line's account needs a label
 * (Z-12, Settings → Dimensions → Required labels) and says which one is missing. The values offered
 * are the workspace's own (Settings → Dimensions); new labels can also be saved or renamed inline.
 */
import React, { useId, useState } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { DEFAULT_WORKSPACE_DIMENSIONS, resolveDimensionLabel } from '../../lib/dimensionUtils';
import { requiredLabelWarnings } from '../../lib/requiredLabels';
import { DimensionValueActions, InlineAddDimensionAxis } from './DimensionValueActions';

export function LineLabels({ value, onChange, accountId, date, lineNumber }: {
  value?: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  accountId?: string;
  /** the document's date: a required-label rule applies from its own date on */
  date?: string;
  lineNumber: number;
}) {
  const id = useId();
  const dimensions = useAuthStore(s => s.getCurrentWorkspace()?.dimensions) || DEFAULT_WORKSPACE_DIMENSIONS;
  const nodes = useLedgerStore(s => s.dimensionNodes || []);
  const accounts = useLedgerStore(s => s.accounts || []);
  const axes = dimensions.filter(d => d.id !== 'category');
  const labels = value || {};
  const warnings = requiredLabelWarnings([{ accountId: accountId || '', dimensions: labels }], date || '9999-12-31', dimensions, accounts)
    .map(w => w.replace(/ \(line 1\)$/, ''));
  const [open, setOpen] = useState(false);
  const shown = open || warnings.length > 0;
  const set = Object.entries(labels).filter(([, v]) => v);
  if (axes.length === 0) return null;

  const change = (dimensionId: string, text: string) => {
    const next = { ...labels };
    const key = dimensionId.toLowerCase();
    if (text.trim()) next[key] = text; else delete next[key];
    onChange(next);
  };

  return (
    <div className="space-y-1 text-[11px]">
      <button type="button" aria-expanded={shown} aria-controls={`${id}-labels`} onClick={() => setOpen(!open)}
        className="font-semibold text-[var(--muted)] hover:text-[var(--text)] hover:underline">
        Labels<span className="sr-only"> for line {lineNumber}</span>
        {set.length > 0 && <span className="font-normal">: {set.map(([k, v]) => `${axes.find(a => a.id.toLowerCase() === k)?.name || k} ${resolveDimensionLabel(nodes, k, v)}`).join(' · ')}</span>}
      </button>
      {warnings.length > 0 && <p role="status" className="text-amber-700 dark:text-amber-400">{warnings.join('; ')}</p>}
      {shown && (
        <div id={`${id}-labels`} className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            {axes.map(axis => {
              const listId = `${id}-${axis.id}`;
              const known = nodes.filter(n => n.dimensionId === axis.id && n.status !== 'archived');
              const currentValue = labels[axis.id.toLowerCase()] || '';
              return (
                <div key={axis.id}>
                  <label htmlFor={`${listId}-input`} className="block text-[var(--muted)]">{axis.name}<span className="sr-only"> for line {lineNumber}</span></label>
                  <input id={`${listId}-input`} list={listId} value={currentValue} onChange={e => change(axis.id, e.target.value)}
                    className="mt-0.5 w-full px-2 py-1 bg-[var(--surface)] border border-[var(--line)] rounded-lg text-[var(--text)]" />
                  <datalist id={listId}>{known.map(n => <option key={n.id} value={n.id}>{n.description}</option>)}</datalist>
                  <DimensionValueActions
                    dimensionId={axis.id}
                    dimensionName={axis.name}
                    value={currentValue}
                    lineNumber={lineNumber}
                    onSelectNode={node => change(axis.id, node.id)}
                    onRenamed={node => { if (currentValue) change(axis.id, node.id); }}
                  />
                </div>
              );
            })}
          </div>
          <InlineAddDimensionAxis />
        </div>
      )}
    </div>
  );
}
