import { useEffect, useState } from 'react';
import { getIdToken } from '../../firebase';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useUIStore } from '../../stores/useUIStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { displayDimensionName } from '../../lib/dimensionUtils';
import { formatCurrency, formatDate, getLocalDateISO } from '../../lib/utils';
import { calculateAmountDue } from '../../lib/documentMath';
import { labelValueView } from '../../lib/labelValuePage';

const field = 'px-2 py-1.5 border border-[var(--line)] rounded bg-[var(--panel)] text-[var(--text)]';

/** The label and value asked for in the address (`?label=property&value=maui`), if any. */
function fromAddress(): { label: string; value: string } {
  if (typeof window === 'undefined') return { label: '', value: '' };
  const q = new URLSearchParams(window.location.search);
  return { label: q.get('label') || '', value: q.get('value') || '' };
}

/**
 * EU-E6: a page per label value — profit this year (the server's Profit by Label column for the value), its open
 * invoices and bills, and its last entries. Read-only; each document opens itself.
 */
export default function LabelValuePageView() {
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const nodes = useLedgerStore(s => s.dimensionNodes) || [];
  const transactions = useLedgerStore(s => s.transactions);
  const invoices = useLedgerStore(s => s.invoices);
  const bills = useLedgerStore(s => s.bills);
  const openRecord = useUIStore(s => s.openRecord);
  useLedgerCollections('invoices', 'bills');
  const labels = (workspace?.dimensions || []).filter(d => d.id !== 'category');
  const [asked] = useState(fromAddress);
  const [label, setLabel] = useState(asked.label);
  const labelId = label || labels[0]?.id || '';
  const values = nodes.filter(n => n.dimensionId === labelId && n.status !== 'archived');
  const [value, setValue] = useState(asked.value);
  const valueId = values.some(v => v.id === value) ? value : values[0]?.id || '';
  const node = values.find(v => v.id === valueId);
  const currency = workspace?.currency || 'USD';
  const money = (c: number) => formatCurrency(c, currency);
  const view = labelValueView({ label: labelId, value: valueId, transactions: transactions || [], invoices: invoices || [], bills: bills || [] });

  const today = getLocalDateISO();
  const key = workspace && labelId && valueId ? new URLSearchParams({ workspaceId: workspace.id, dimensionId: labelId, startDate: `${today.slice(0, 4)}-01-01`, endDate: today }).toString() : '';
  const [profit, setProfit] = useState<{ key: string; netIncome?: number; error?: string } | null>(null);
  useEffect(() => {
    if (!key) return;
    let live = true;
    (async () => {
      const res = await fetch(`/api/v1/reports/by-label?${key}`, { headers: { Authorization: `Bearer ${await getIdToken()}` } });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !Array.isArray(body.columns)) throw new Error(body.message || body.error || 'The profit could not be worked out');
      return body.columns as Array<{ value: string; netIncome: number }>;
    })()
      .then(columns => { if (live) setProfit({ key, netIncome: columns.find(c => c.value === valueId)?.netIncome ?? 0 }); })
      .catch(err => { if (live) setProfit({ key, error: err instanceof Error ? err.message : String(err) }); });
    return () => { live = false; };
  }, [key, valueId]);
  const profitNow = profit?.key === key ? profit : null;

  if (!labels.length) {
    return <p data-report-empty-state className="p-6 text-sm text-[var(--muted)]">No labels yet. Add one in Settings → Labels, then choose a value to see its page.</p>;
  }
  return (
    <section aria-labelledby="label-value-title" className="space-y-4 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <h2 id="label-value-title" className="text-xl font-bold flex-1">{node ? node.description : 'Choose a value'}</h2>
        <label className="flex flex-col text-xs">Label
          <select aria-label="Label" className={field} value={labelId} onChange={e => { setLabel(e.target.value); setValue(''); }}>
            {labels.map(d => <option key={d.id} value={d.id}>{displayDimensionName(d)}</option>)}
          </select>
        </label>
        <label className="flex flex-col text-xs">Value
          <select aria-label="Value" className={field} value={valueId} onChange={e => setValue(e.target.value)}>
            {values.map(v => <option key={v.id} value={v.id}>{v.description}</option>)}
          </select>
        </label>
      </div>
      {!node ? (
        <p data-report-empty-state className="text-sm text-[var(--muted)]">No values for this label yet. Add one in Settings → Labels.</p>
      ) : (
        <>
          <div className="rounded-xl border border-[var(--line)] p-4">
            <div className="text-xs text-[var(--muted)]">Profit this year</div>
            <div className="text-2xl font-bold tabular-nums" data-testid="label-value-profit">
              {profitNow?.error ? <span className="text-sm text-rose-600">{profitNow.error}</span> : profitNow ? money(profitNow.netIncome || 0) : 'Working it out…'}
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <RecordList title={`Open invoices (${view.openInvoices.length})`} empty="No open invoices with this value."
              rows={view.openInvoices.map(inv => ({ key: inv.id, text: `${inv.number || inv.id} · ${inv.customerName || ''}`, amount: formatCurrency(calculateAmountDue(inv), inv.currency || currency), open: () => openRecord({ type: 'invoice', id: inv.id }) }))} />
            <RecordList title={`Open bills (${view.openBills.length})`} empty="No open bills with this value."
              rows={view.openBills.map(b => ({ key: b.id, text: `${b.number || b.id} · ${b.vendorName || ''}`, amount: formatCurrency(calculateAmountDue(b), b.currency || currency), open: () => openRecord({ type: 'bill', id: b.id }) }))} />
          </div>
          <RecordList title="Last entries" empty="No posted entries with this value yet."
            rows={view.entries.map(t => ({ key: t.id, text: `${formatDate(t.date)} · ${t.description}`, amount: money(t.totalAmountCents || 0), open: () => openRecord({ type: 'transaction', id: t.id }) }))} />
        </>
      )}
    </section>
  );
}

/** One titled list of records, each opening itself, or a line saying there are none. */
function RecordList({ title, empty, rows }: { title: string; empty: string; rows: Array<{ key: string; text: string; amount: string; open: () => void }> }) {
  return (
    <div>
      <h3 className="text-sm font-bold">{title}</h3>
      {rows.length === 0 ? <p className="text-sm text-[var(--muted)]">{empty}</p> : (
        <ul className="divide-y divide-[var(--line)] text-sm">
          {rows.map(r => (
            <li key={r.key}><button type="button" className="w-full flex justify-between py-1.5 text-left hover:underline" onClick={r.open}>
              <span>{r.text}</span><span className="tabular-nums">{r.amount}</span>
            </button></li>
          ))}
        </ul>
      )}
    </div>
  );
}
