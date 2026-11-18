/**
 * Paid time off (U-04) in the Payroll employee directory: the balance in hours and what it is worth,
 * and "Time off" to set the hours earned a year (spread over the pay runs) and the hours brought in,
 * and to record or remove time taken. The sums are src/lib/ptoAccrual.ts; this saves the employee.
 */
import React, { useState } from 'react';
import { toast } from 'sonner';
import { useDialog } from '../../hooks/useDialog';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { allowanceProblem, ptoBalance, timeOffProblem, type TimeOff } from '../../lib/ptoAccrual';
import { formatCurrency, formatDate, getLocalDateISO } from '../../lib/utils';
import type { Employee, PayRun } from '../../types';
import { saveEmployee } from '../../lib/recordWrites';

type Saved = Pick<Employee, 'ptoHoursPerYear' | 'ptoOpeningHours' | 'ptoTaken'>;

async function save(employee: Employee, patch: Saved) {
  await saveEmployee(employee.workspaceId, employee.id, patch);
  useLedgerStore.setState(state => ({ employees: state.employees.map(e => (e.id === employee.id ? { ...e, ...patch } : e)) }));
}

/** Stable keys for the list: the day, the hours and the note, numbered when the same entry repeats. */
function keyed(list: TimeOff[]) {
  const seen = new Map<string, number>();
  return list.map((t, i) => {
    const base = `${t.date}|${t.hours}|${t.note || ''}`;
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return { t, i, key: `${base}|${n}` };
  });
}

export function TimeOffCell({ employee, runs, canWrite }: { employee: Employee; runs: PayRun[]; canWrite: boolean }) {
  const [open, setOpen] = useState(false);
  const { dialogProps, titleId } = useDialog(() => setOpen(false), open);
  const [perYear, setPerYear] = useState('');
  const [opening, setOpening] = useState('');
  const [day, setDay] = useState('');
  const [taken, setTaken] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (employee.workerType === 'contractor') return <span className="text-neutral-400">none (contractor)</span>;
  const pto = ptoBalance(employee, runs);
  const hasPto = Boolean(employee.ptoHoursPerYear || employee.ptoOpeningHours || (employee.ptoTaken || []).length);

  const start = () => {
    setPerYear(String(employee.ptoHoursPerYear || 0));
    setOpening(String(employee.ptoOpeningHours || 0));
    setDay(getLocalDateISO());
    setTaken('');
    setNote('');
    setError('');
    setOpen(true);
  };

  const run = async (work: () => Promise<void>, done: string) => {
    setBusy(true);
    setError('');
    try {
      await work();
      toast.success(done);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const saveAllowance = () => {
    const year = Number(perYear);
    const brought = Number(opening);
    const problem = allowanceProblem(year) || allowanceProblem(brought, 'The hours brought in');
    if (problem) { setError(problem); return; }
    void run(() => save(employee, { ptoHoursPerYear: year, ptoOpeningHours: brought }), 'Time off allowance saved');
  };

  const record = () => {
    const entry: TimeOff = { date: day, hours: Number(taken), ...(note.trim() ? { note: note.trim().slice(0, 200) } : {}) };
    const problem = timeOffProblem(entry, pto.balanceHours);
    if (problem) { setError(problem); return; }
    const list = [...(employee.ptoTaken || []), entry].sort((a, b) => a.date.localeCompare(b.date));
    void run(async () => { await save(employee, { ptoTaken: list }); setTaken(''); setNote(''); }, 'Time off recorded');
  };

  const remove = (index: number) => {
    const list = (employee.ptoTaken || []).filter((_, i) => i !== index);
    void run(() => save(employee, { ptoTaken: list }), 'Time off removed');
  };

  return (
    <>
      <div className="font-mono text-neutral-800">{hasPto ? `${pto.balanceHours} h` : <span className="text-neutral-400">not set</span>}</div>
      {hasPto && <div className="text-[10px] text-neutral-500">worth {formatCurrency(pto.valueCents)}</div>}
      <button type="button" onClick={start} className="mt-1 text-[11px] font-semibold text-neutral-700 hover:underline">
        Time off<span className="sr-only"> of {employee.name}</span>
      </button>
      {open && (
        <div {...dialogProps} className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-5 space-y-4 text-xs text-left">
            <div className="flex items-start justify-between gap-3">
              <h2 id={titleId} className="text-base font-bold text-neutral-900">Time off: {employee.name}</h2>
              <button type="button" onClick={() => setOpen(false)} className="text-neutral-500 hover:text-neutral-800">Close</button>
            </div>
            <p role="status" className="text-sm text-neutral-800">
              {pto.balanceHours} hours available (worth {formatCurrency(pto.valueCents)}): {employee.ptoOpeningHours || 0} brought in + {pto.earnedHours} earned by {pto.runs} pay run{pto.runs === 1 ? '' : 's'} − {pto.takenHours} taken.
            </p>
            {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}

            <fieldset disabled={!canWrite || busy} className="space-y-2">
              <legend className="font-semibold text-neutral-900">Allowance</legend>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">Hours earned a year
                  <input type="number" min="0" step="0.25" value={perYear} onChange={e => setPerYear(e.target.value)} className="mt-1 w-full rounded-lg border border-neutral-300 p-2" />
                </label>
                <label className="block">Hours brought in
                  <input type="number" min="0" step="0.25" value={opening} onChange={e => setOpening(e.target.value)} className="mt-1 w-full rounded-lg border border-neutral-300 p-2" />
                </label>
              </div>
              <p className="text-neutral-500">Spread over the pay runs: {employee.payFrequency === 'Weekly' ? '52' : employee.payFrequency === 'Bi-Weekly' ? '26' : '12'} a year for {employee.payFrequency.toLowerCase()} pay.</p>
              <button type="button" disabled={!canWrite || busy} onClick={saveAllowance} className="min-h-9 px-3 rounded-lg bg-neutral-900 text-white font-semibold disabled:opacity-50">Save allowance</button>
            </fieldset>

            <fieldset disabled={!canWrite || busy} className="space-y-2">
              <legend className="font-semibold text-neutral-900">Record time off</legend>
              <div className="grid grid-cols-3 gap-2">
                <label className="block">Day
                  <input type="date" value={day} onChange={e => setDay(e.target.value)} className="mt-1 w-full rounded-lg border border-neutral-300 p-2" />
                </label>
                <label className="block">Hours taken
                  <input type="number" min="0" step="0.25" value={taken} onChange={e => setTaken(e.target.value)} className="mt-1 w-full rounded-lg border border-neutral-300 p-2" />
                </label>
                <label className="block">Note
                  <input type="text" maxLength={200} value={note} onChange={e => setNote(e.target.value)} className="mt-1 w-full rounded-lg border border-neutral-300 p-2" />
                </label>
              </div>
              <button type="button" disabled={!canWrite || busy} onClick={record} className="min-h-9 px-3 rounded-lg border border-neutral-300 font-semibold disabled:opacity-50">Record</button>
            </fieldset>

            {(employee.ptoTaken || []).length > 0 && (
              <ul aria-label={`Time off taken by ${employee.name}`} className="divide-y divide-neutral-100 border-t border-neutral-200">
                {keyed(employee.ptoTaken || []).map(({ t, i, key }) => (
                  <li key={key} className="flex items-center justify-between py-1.5">
                    <span>{formatDate(t.date)}: {t.hours} h{t.note ? ` · ${t.note}` : ''}</span>
                    {canWrite && (
                      <button type="button" disabled={busy} onClick={() => remove(i)} className="text-neutral-500 hover:underline disabled:opacity-50">
                        Remove<span className="sr-only"> the time off of {formatDate(t.date)}</span>
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </>
  );
}
