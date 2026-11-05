import React, { useRef, useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import { toast } from 'sonner';
import { getIdToken } from '../../firebase';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { useEntityOperations } from '../../hooks/useEntityOperations';
import { formatCurrency, formatDate, getLocalDateISO } from '../../lib/utils';
import { calculateDueDate } from '../../lib/paymentTerms';
import { entryValueCents, formatDuration, invoiceLinesFromTime, MAX_DESCRIPTION, parseDuration, STATUS_LABEL, timeProblem, type TimeEntry, type TimeRates } from '../../lib/timeEntries';
import { useHandOvers } from './useHandOvers';
import TimeRatesPanel from './TimeRatesPanel';
import { EmptyState } from '../ui/EmptyState';
import { LoadingState } from '../ui/LoadingState';
import TimeTimer from './TimeTimer';

const field = 'px-2 py-1.5 text-sm border border-[var(--line)] rounded bg-[var(--panel)] text-[var(--text)]';

async function call(workspaceId: string, path: string, method = 'GET', body?: unknown) {
  const res = await fetch(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/time${path}`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getIdToken()}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || 'That did not work');
  return data;
}

/**
 * Time (V-01 time entries, V-03 billable, V-04 rates, V-05 approval, V-06 time → invoice): log what
 * you did, for which customer or project and whether it is billable; submit it; owners and
 * accountants approve or send it back and keep the hourly rates; approved billable time becomes a
 * draft invoice for its customer (src/lib/timeEntries.ts, src/server/services/timeService.ts).
 */
export default function TimeView() {
  // the log-time form offers the customers and projects it labels time with
  const { loading } = useLedgerCollections('customers', 'projects');
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const uid = useAuthStore(s => s.user?.uid) || '';
  const role = useCurrentRole();
  const customers = useLedgerStore(s => s.customers);
  const projects = useLedgerStore(s => s.projects);
  const { addEntity } = useEntityOperations();
  const { people } = useHandOvers();
  const unlinked = useRef(new Map<string, { id: string; number: string }>());
  const [entries, setEntries] = useState<TimeEntry[] | null>(null);
  const [rates, setRates] = useState<TimeRates | undefined>(undefined);
  const [canApprove, setCanApprove] = useState(false);
  const [failed, setFailed] = useState('');
  const [draft, setDraft] = useState({ date: getLocalDateISO(), duration: '', description: '', customerId: '', projectId: '', billable: true });
  const [billFor, setBillFor] = useState('');
  const [busy, setBusy] = useState(false);
  const workspaceId = workspace?.id || '';
  const currency = workspace?.currency || 'USD';
  const canBill = ['owner', 'accountant', 'bookkeeper'].includes(role);

  useEffect(() => {
    if (!workspaceId) return;
    let live = true;
    call(workspaceId, '')
      .then(data => { if (live) { setEntries(data.entries || []); setRates(data.rates); setCanApprove(Boolean(data.canApprove)); setFailed(''); } })
      .catch(err => { if (live) setFailed(err instanceof Error ? err.message : String(err)); });
    return () => { live = false; };
  }, [workspaceId]);

  if (!workspace) return <div className="p-6 md:p-8"><h1 className="text-2xl font-bold text-[var(--text)]">Time</h1><p className="text-sm text-[var(--muted)]">Open a workspace to log time: what you worked on, for which customer or project, approved and billed from here.</p></div>;
  const minutes = parseDuration(draft.duration);
  const input = { date: draft.date, minutes: minutes ?? 0, description: draft.description, billable: draft.billable, ...(draft.customerId ? { customerId: draft.customerId } : {}), ...(draft.projectId ? { projectId: draft.projectId } : {}) };
  const problem = draft.duration && minutes === null ? 'How long: 1:30, 1.5 or 90m' : timeProblem(input);
  const customerName = (id?: string) => (customers || []).find(c => c.id === id)?.name || '';
  const projectName = (id?: string) => (projects || []).find(p => p.id === id)?.name || '';
  const personName = (id: string) => (id === uid ? 'You' : people.find(p => p.uid === id)?.email || 'A teammate');
  const replace = (changed: TimeEntry[]) => setEntries(list => (list || []).map(e => changed.find(c => c.id === e.id) || e));

  const log = async () => {
    setBusy(true);
    try {
      const data = await call(workspaceId, '', 'POST', input);
      setEntries(list => [data.entry, ...(list || [])]);
      setDraft(d => ({ ...d, duration: '', description: '' }));
    } catch (err) { toast.error(err instanceof Error ? err.message : String(err)); } finally { setBusy(false); }
  };
  const move = async (list: TimeEntry[], to: 'submitted' | 'open' | 'approved', done: string, note?: string) => {
    try {
      const data = await call(workspaceId, '/move', 'POST', { entryIds: list.map(e => e.id), to, ...(note ? { note } : {}) });
      replace(data.entries);
      toast.success(done);
    } catch (err) { toast.error(err instanceof Error ? err.message : String(err)); }
  };
  const remove = async (e: TimeEntry) => {
    try { await call(workspaceId, `/${encodeURIComponent(e.id)}`, 'DELETE'); setEntries(list => (list || []).filter(x => x.id !== e.id)); } catch (err) { toast.error(err instanceof Error ? err.message : String(err)); }
  };

  const all = entries || [];
  const mineOpen = all.filter(e => e.person === uid && e.status === 'open');
  const waiting = all.filter(e => e.status === 'submitted');
  const billable = all.filter(e => e.billable && e.status === 'approved' && !e.invoiceId && (!billFor || e.customerId === billFor));
  const billCustomers = [...new Set(all.filter(e => e.billable && e.status === 'approved' && !e.invoiceId).map(e => e.customerId || ''))].filter(Boolean);
  const lines = invoiceLinesFromTime(billable, rates);
  const billTotal = lines.reduce((s, l) => s + l.amountCents, 0);

  // #97: an invoice made for these hours whose "mark invoiced" step failed; a retry links that one
  // instead of making a second invoice for the same time
  const makeInvoice = async () => {
    if (!billFor || lines.length === 0) return;
    setBusy(true);
    const hours = billable.map(e => e.id).sort().join(',');
    const pending = unlinked.current.get(hours);
    try {
      if (pending) {
        await call(workspaceId, '/invoiced', 'POST', { entryIds: billable.map(e => e.id), invoiceId: pending.id });
        unlinked.current.delete(hours);
        setEntries(list => (list || []).map(e => (billable.some(b => b.id === e.id) ? { ...e, status: 'invoiced', invoiceId: pending.id } : e)));
        toast.success(`Time linked to draft invoice ${pending.number}.`);
        return;
      }
      const numberRes = await fetch(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/next-number`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getIdToken()}` }, body: JSON.stringify({ type: 'invoice' }) });
      const number = numberRes.ok ? (await numberRes.json()).number : undefined;
      if (!number) throw new Error('Could not get the next invoice number. Please try again.');
      const today = getLocalDateISO();
      const ref = await addEntity('invoices', {
        number, customerId: billFor, customerName: customerName(billFor), date: today, dueDate: calculateDueDate(today, 'net_30'),
        amountCents: billTotal, amountPaidCents: 0, status: 'draft', currency, items: lines, metadata: { fromTime: true },
      });
      if (!ref) return;
      unlinked.current.set(hours, { id: ref.id, number });
      try {
        await call(workspaceId, '/invoiced', 'POST', { entryIds: billable.map(e => e.id), invoiceId: ref.id });
      } catch (err) {
        throw new Error(`Draft invoice ${number} was saved, but the time was not marked as invoiced (${err instanceof Error ? err.message : String(err)}). Press "Make a draft invoice" again to link it; no second invoice is made.`, { cause: err });
      }
      unlinked.current.delete(hours);
      setEntries(list => (list || []).map(e => (billable.some(b => b.id === e.id) ? { ...e, status: 'invoiced', invoiceId: ref.id } : e)));
      toast.success(`Draft invoice ${number} for ${formatCurrency(billTotal, currency)} made from ${lines.length} time ${lines.length === 1 ? 'entry' : 'entries'}. Review it in Sales, then send it.`);
    } catch (err) { toast.error(err instanceof Error ? err.message : String(err)); } finally { setBusy(false); }
  };

  return (
    <div className="h-full overflow-auto p-6 md:p-8">
      <div className="max-w-5xl mx-auto space-y-5">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold text-[var(--text)] flex items-center gap-2"><Clock className="w-6 h-6" aria-hidden="true" /> Time</h1>
          <p className="text-sm text-[var(--muted)]">Log what you worked on and submit it. Owners and accountants approve it; approved billable time becomes a draft invoice for its customer.</p>
        </header>

        <fieldset disabled={busy} className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 space-y-3 text-sm">
          <legend className="px-1 font-semibold text-[var(--text)]">Log time</legend>
          <TimeTimer workspaceId={workspaceId} description={draft.description} onStop={(m, d) => setDraft(x => ({ ...x, date: getLocalDateISO(), duration: formatDuration(m), description: x.description || d }))} />
          <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1 text-[var(--muted)]">Day<input type="date" value={draft.date} onChange={e => setDraft(d => ({ ...d, date: e.target.value }))} className={field} /></label>
            <label className="flex flex-col gap-1 text-[var(--muted)]">How long<input value={draft.duration} placeholder="1:30" onChange={e => setDraft(d => ({ ...d, duration: e.target.value }))} className={`${field} w-24`} /></label>
            <label className="flex flex-col gap-1 text-[var(--muted)] flex-1 min-w-60">What was done<input value={draft.description} maxLength={MAX_DESCRIPTION} onChange={e => setDraft(d => ({ ...d, description: e.target.value }))} className={field} /></label>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-[var(--muted)]">Customer
              <select value={draft.customerId} onChange={e => setDraft(d => ({ ...d, customerId: e.target.value }))} className={field}>
                <option value="">None</option>
                {[...(customers || [])].sort((a, b) => a.name.localeCompare(b.name)).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[var(--muted)]">Project
              <select value={draft.projectId} onChange={e => setDraft(d => ({ ...d, projectId: e.target.value }))} className={field}>
                <option value="">None</option>
                {(projects || []).filter(p => p.status !== 'archived').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2 text-[var(--text)]"><input type="checkbox" checked={draft.billable} onChange={e => setDraft(d => ({ ...d, billable: e.target.checked }))} />Billable</label>
            <button type="button" disabled={Boolean(problem)} onClick={() => void log()} className="rounded-lg bg-indigo-600 px-3 py-1.5 font-semibold text-white disabled:opacity-50">Log it</button>
          </div>
          {(draft.duration || draft.description) && problem && <p role="status" className="text-xs text-amber-700 dark:text-amber-400">{problem}</p>}
        </fieldset>

        {failed && <p role="alert" className="text-sm text-rose-600">{failed}</p>}
        {!entries && !failed && <LoadingState what="logged time" />}

        {mineOpen.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-[var(--text)]">{mineOpen.length} of your entries not submitted ({formatDuration(mineOpen.reduce((s, e) => s + e.minutes, 0))} h)</span>
            <button type="button" onClick={() => void move(mineOpen, 'submitted', 'Submitted for approval')} className="rounded-lg border border-[var(--line)] px-3 py-1.5 font-semibold text-[var(--text)]">Submit my time</button>
          </div>
        )}

        {canApprove && waiting.length > 0 && (
          <section aria-label="Waiting for approval" className="rounded-xl border border-amber-300 bg-amber-50/40 p-4 space-y-2 text-sm">
            <h2 className="font-semibold text-[var(--text)]">Waiting for approval ({waiting.length})</h2>
            <ul className="space-y-1">
              {waiting.map(e => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span><bdi>{personName(e.person)}</bdi> · {formatDate(e.date)} · {formatDuration(e.minutes)} h · <bdi>{e.description}</bdi>{e.customerId ? ` · ${customerName(e.customerId)}` : ''}</span>
                  <span className="flex gap-2 text-xs">
                    <button type="button" onClick={() => void move([e], 'approved', 'Approved')} className="text-emerald-700 hover:underline">Approve<span className="sr-only"> {e.description}</span></button>
                    <button type="button" onClick={() => { const note = window.prompt('What should change? (optional)'); if (note !== null) void move([e], 'open', 'Sent back', note); }} className="text-rose-600 hover:underline">Send back<span className="sr-only"> {e.description}</span></button>
                  </span>
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => void move(waiting, 'approved', `${waiting.length} approved`)} className="rounded-lg bg-emerald-600 px-3 py-1.5 font-semibold text-white">Approve all</button>
          </section>
        )}

        {entries && (
          <table className="w-full text-sm rounded-xl border border-[var(--line)] bg-[var(--surface)]">
            <caption className="text-left font-semibold text-[var(--text)] pb-1">{canApprove ? 'Everyone\'s time' : 'Your time'} ({formatDuration(all.reduce((s, e) => s + e.minutes, 0))} h)</caption>
            <thead><tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
              <th scope="col" className="text-left p-2">Day</th>{canApprove && <th scope="col" className="text-left p-2">Who</th>}<th scope="col" className="text-left p-2">What</th>
              <th scope="col" className="text-right p-2">Hours</th>{rates && <th scope="col" className="text-right p-2">Value</th>}<th scope="col" className="text-left p-2">Status</th><th scope="col"><span className="sr-only">Remove</span></th>
            </tr></thead>
            <tbody>
              {all.length === 0 && (
                <tr><td colSpan={7}>
                  {loading ? <LoadingState what="logged time" /> : (
                    <EmptyState
                      title="No time logged yet"
                      description="Hours logged above show here with their status; billable time can then be priced and pulled onto an invoice."
                    />
                  )}
                </td></tr>
              )}
              {all.map(e => (
                <tr key={e.id} className="border-b border-[var(--line)]/50">
                  <td className="p-2 font-mono">{e.date}</td>{canApprove && <td className="p-2"><bdi>{personName(e.person)}</bdi></td>}
                  <td className="p-2"><bdi>{e.description}</bdi><span className="text-xs text-[var(--muted)]">{[customerName(e.customerId), projectName(e.projectId), e.billable ? 'billable' : ''].filter(Boolean).map(x => ` · ${x}`).join('')}</span>{e.note && <span className="block text-xs text-rose-600">Sent back: <bdi>{e.note}</bdi></span>}</td>
                  <td className="p-2 text-right font-mono">{formatDuration(e.minutes)}</td>
                  {rates && <td className="p-2 text-right font-mono">{e.billable ? formatCurrency(entryValueCents(e, rates), currency) : ''}</td>}
                  <td className="p-2 text-xs">{STATUS_LABEL[e.status]}</td>
                  <td className="p-2 text-right">{((e.person === uid && e.status === 'open') || (canApprove && e.status !== 'invoiced')) && <button type="button" onClick={() => void remove(e)} className="text-xs text-rose-600 hover:underline">Remove<span className="sr-only"> {e.description} on {e.date}</span></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {canBill && billCustomers.length > 0 && (
          <section aria-label="Bill approved time" className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 space-y-2 text-sm">
            <h2 className="font-semibold text-[var(--text)]">Bill approved time</h2>
            <label className="flex items-center gap-2 text-[var(--muted)]">Customer
              <select value={billFor} onChange={e => setBillFor(e.target.value)} className={field}>
                <option value="">Choose…</option>
                {billCustomers.map(id => <option key={id} value={id}>{customerName(id) || id}</option>)}
              </select>
            </label>
            {billFor && <p className="text-[var(--text)]">{lines.length} {lines.length === 1 ? 'entry' : 'entries'}, {formatCurrency(billTotal, currency)}{rates && lines.some(l => l.rateCents === 0) ? ' (some have no rate yet: set the rates first)' : ''}</p>}
            <button type="button" disabled={!billFor || lines.length === 0 || busy} onClick={() => void makeInvoice()} className="rounded-lg bg-emerald-600 px-3 py-1.5 font-semibold text-white disabled:opacity-50">Make a draft invoice</button>
          </section>
        )}

        {canApprove && rates && <TimeRatesPanel workspaceId={workspaceId} rates={rates} onSaved={setRates} people={people} />}
      </div>
    </div>
  );
}
