import { guestSession, SAMPLE_WORKSPACE_ID } from '../../../lib/db/guestDatabase';
import { readGuestNumbering, saveGuestNumbering } from '../../../lib/guestNumbering';
import { useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import { Hash } from 'lucide-react';
import { useAuthStore } from '../../../stores/useAuthStore';
import { useCurrentRole } from '../../../hooks/useCurrentRole';
import { getIdToken } from '../../../firebase';
import { previewNumber } from '../../../lib/documentNumbers';

type NumberedType = 'invoice' | 'bill' | 'estimate' | 'creditNote' | 'vendorCredit' | 'payment';
interface SeriesView { type: NumberedType; prefix: string; nextNumber: number; padding: number; next: string; highestUsed: number }

const LABELS: Record<NumberedType, string> = { invoice: 'Invoices', bill: 'Bills', estimate: 'Estimates', creditNote: 'Credit notes', vendorCredit: 'Vendor credits', payment: 'Payments' };

async function api(workspaceId: string, path: string, init?: RequestInit) {
  if (guestSession()) {
    if (!init || init.method !== 'PUT') return { series: readGuestNumbering(workspaceId) };
    return { series: saveGuestNumbering(workspaceId, path.slice(1) as NumberedType, JSON.parse(String(init.body))) };
  }
  if (workspaceId === SAMPLE_WORKSPACE_ID) throw new Error('The sample company is closed.');
  const res = await fetch(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/numbering${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getIdToken()}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || 'Document numbering is not available');
  return data;
}

function SeriesRow({ series, workspaceId, onSaved }: { series: SeriesView; workspaceId: string; onSaved: (s: SeriesView) => void }) {
  const id = useId();
  const [prefix, setPrefix] = useState(series.prefix);
  const [next, setNext] = useState(String(series.nextNumber));
  const [padding, setPadding] = useState(String(series.padding));
  const [saving, setSaving] = useState(false);
  const preview = previewNumber(prefix, Number(next), Number(padding));
  const changed = prefix !== series.prefix || Number(next) !== series.nextNumber || Number(padding) !== series.padding;

  const save = async () => {
    setSaving(true);
    try {
      const sampleSession = guestSession();
      const data = await api(workspaceId, `/${series.type}`, { method: 'PUT', body: JSON.stringify({ prefix, nextNumber: Number(next), padding: Number(padding) }) });
      if (guestSession() !== sampleSession || useAuthStore.getState().currentWorkspaceId !== workspaceId) return;
      onSaved(data.series);
      toast.success(`${LABELS[series.type]}: the next number is ${data.series.next}`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const field = 'w-full px-3 py-2 text-sm bg-[var(--ink)] border border-[var(--line)] rounded-lg text-[var(--text)]';
  return (
    <fieldset className="border border-[var(--line)] rounded-xl p-4 space-y-3">
      <legend className="px-1 text-sm font-bold text-[var(--text)]">{LABELS[series.type]}</legend>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label htmlFor={`${id}-prefix`} className="block text-xs font-semibold text-[var(--muted)] mb-1">Prefix</label>
          <input id={`${id}-prefix`} value={prefix} maxLength={20} onChange={e => setPrefix(e.target.value)} className={field} />
        </div>
        <div>
          <label htmlFor={`${id}-next`} className="block text-xs font-semibold text-[var(--muted)] mb-1">Next number</label>
          <input id={`${id}-next`} type="number" min={1} value={next} onChange={e => setNext(e.target.value)} className={field} />
        </div>
        <div>
          <label htmlFor={`${id}-pad`} className="block text-xs font-semibold text-[var(--muted)] mb-1">Digits</label>
          <input id={`${id}-pad`} type="number" min={1} max={10} value={padding} onChange={e => setPadding(e.target.value)} className={field} />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
        <p className="text-[var(--muted)]">
          Next: <span className="font-mono text-[var(--text)]" data-testid={`next-${series.type}`}>{preview}</span>
          {series.highestUsed > 0 && <> · highest used with this prefix: {series.highestUsed}</>}
        </p>
        <button type="button" disabled={!changed || saving} onClick={save} className="px-4 py-2 text-sm font-semibold rounded-lg bg-emerald-700 text-white disabled:opacity-40">
          {saving ? 'Saving…' : `Save ${LABELS[series.type].toLowerCase()}`}
        </button>
      </div>
    </fieldset>
  );
}

/**
 * Settings → Document numbering (BA-07): prefix, next number and digits for invoices, bills,
 * estimates, credit notes, vendor credits and payments. The server refuses a next number that is already used,
 * so numbers never repeat.
 */
export default function NumberingSettings() {
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const role = useCurrentRole();
  const canChange = role === 'owner' || role === 'accountant';
  const [series, setSeries] = useState<SeriesView[] | null>(null);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const load = () => { setError(''); setVersion(v => v + 1); };

  useEffect(() => {
    let cancelled = false;
    if (!workspaceId || !canChange) return undefined;
    api(workspaceId, '/')
      .then(d => { if (!cancelled) setSeries(d.series); })
      .catch(err => { if (!cancelled) setError((err as Error).message); });
    return () => { cancelled = true; };
  }, [workspaceId, canChange, version]);

  return (
    <section className="space-y-4" aria-labelledby="numbering-title">
      <div className="flex items-center gap-2">
        <Hash aria-hidden="true" className="w-5 h-5 text-[var(--muted)]" />
        <h2 id="numbering-title" className="text-lg font-bold text-[var(--text)]">Document numbering</h2>
      </div>
      <p className="text-sm text-[var(--muted)]">Each new invoice, bill, estimate, credit note, vendor credit and payment gets the next number of its series. Change the prefix (for example a new year) or where numbering continues.</p>
      {!canChange && <p className="text-sm text-[var(--muted)]">Only owners and accountants change document numbers.</p>}
      {error && (
        <p role="alert" className="text-sm text-[var(--neg)]">
          {error} <button type="button" onClick={load} className="underline">Try again</button>
        </p>
      )}
      {canChange && !series && !error && <p className="text-sm text-[var(--muted)]">Loading…</p>}
      {series && workspaceId && series.map(s => (
        <SeriesRow key={`${s.type}-${s.prefix}-${s.nextNumber}-${s.padding}`} series={s} workspaceId={workspaceId}
          onSaved={saved => setSeries(list => (list || []).map(x => x.type === saved.type ? saved : x))} />
      ))}
    </section>
  );
}
