import { useId, useState, type ReactElement } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { displayDimensionName } from '../../lib/dimensionUtils';
import type { ReportLabelFilterValue } from '../../lib/reportLabelScope';

const DEFAULT_LABELS = [{ id: 'location', name: 'Location' }, { id: 'class', name: 'Class' }, { id: 'project', name: 'Project' }, { id: 'department', name: 'Department' }];

const field = 'bg-[var(--ink)] min-h-11 min-w-0 w-full border border-[var(--line)] text-xs font-semibold px-2 py-1 rounded-md focus-visible:ring-2 focus-visible:ring-[var(--brass)] outline-none text-[var(--text)] normal-case tracking-normal';

/**
 * EU-E4: the label filter a report shows when it can honour it — one of the workspace's labels (not Category) and
 * one of its values. A report that cannot honour it does not render this (hidden, never ignored).
 */
export function useReportLabelFilter(): { filter: ReportLabelFilterValue | null; control: ReactElement | null } {
  const formId = useId();
  // the workspace's labels, else the P&L's usual four (AU-2), so the filter is there before any label is set up
  const own = (useAuthStore(s => s.getCurrentWorkspace()?.dimensions) || []).filter(d => d.id !== 'category');
  const labels = own.length ? own : DEFAULT_LABELS;
  const nodes = useLedgerStore(s => s.dimensionNodes) || [];
  const [dimensionId, setDimensionId] = useState('');
  const [value, setValue] = useState('');
  const label = labels.find(d => d.id === dimensionId);
  const values = nodes.filter(n => n.dimensionId === dimensionId && n.status !== 'archived');
  // typed like the P&L's: upper or lower case, the value's name or id (lineHasLabel)
  const filter = label && value.trim() ? { dimensionId: label.id, value: value.trim() } : null;
  const control = (
    <div data-filter-group data-testid="report-label-filter" className="flex min-w-0 flex-col gap-1 text-[9px] font-bold text-[var(--text)]">
      <label htmlFor={`${formId}-label-kind`}>Label</label>
      <select id={`${formId}-label-kind`} aria-label="Label kind" value={dimensionId} onChange={e => { setDimensionId(e.target.value); setValue(''); }} className={field}>
        <option value="">All</option>
        {labels.map(d => <option key={d.id} value={d.id}>{displayDimensionName(d)}</option>)}
      </select>
      {label && <>
        <label htmlFor={`${formId}-label-value`}>Label value</label>
        <input id={`${formId}-label-value`} aria-label="Label value" list={`${formId}-label-values`} value={value} onChange={e => setValue(e.target.value)} placeholder="e.g. Tel Aviv" className={field} />
        <datalist id={`${formId}-label-values`}>{values.map(v => <option key={v.id} value={v.description} />)}</datalist>
      </>}
    </div>
  );
  return { filter, control };
}
