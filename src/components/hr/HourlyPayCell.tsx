import React, { useState } from 'react';
import { useDialog } from '../../hooks/useDialog';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { formatCurrency } from '../../lib/utils';
import { hourlyProblem, isHourly } from '../../lib/hourlyPay';
import { useHandOvers } from '../collaboration/useHandOvers';
import type { Employee } from '../../types';
import { saveEmployee } from '../../lib/recordWrites';

/**
 * How an employee is paid (U-11): a yearly salary, or by the hour from their approved time on Time.
 * For hourly pay: the rate and whose time it is (the person in this workspace who logs it).
 */
export function HourlyPayCell({ employee, canWrite }: { employee: Employee; canWrite: boolean }) {
  const [open, setOpen] = useState(false);
  const { dialogProps, titleId } = useDialog(() => setOpen(false), open);
  useLedgerCollections('employees');
  const employees = useLedgerStore(s => s.employees);
  const setEmployees = useLedgerStore(s => s.setEmployees);
  const { people } = useHandOvers();
  const [hourly, setHourly] = useState(isHourly(employee));
  const [rate, setRate] = useState(employee.hourlyRateCents ? String(employee.hourlyRateCents / 100) : '');
  const [timeUid, setTimeUid] = useState(employee.timeUid || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (employee.workerType === 'contractor') return null;
  const draft = { payType: hourly ? 'hourly' as const : 'salary' as const, hourlyRateCents: Math.round(Number(rate.replace(',', '.')) * 100), timeUid };
  const problem = hourlyProblem(draft);
  // U-12: one person's time pays one employee — a run with two of them refuses
  const alsoPaid = hourly && timeUid ? employees.filter(e => e.id !== employee.id && isHourly(e) && e.timeUid === timeUid && e.status !== 'Terminated') : [];

  const save = async () => {
    if (problem) { setError(problem); return; }
    setBusy(true);
    try {
      const fields = hourly ? { payType: 'hourly' as const, hourlyRateCents: draft.hourlyRateCents, timeUid } : { payType: 'salary' as const };
      await saveEmployee(employee.workspaceId, employee.id, fields);
      const stamped = { ...fields, updatedAt: new Date().toISOString() };
      setEmployees(employees.map(e => (e.id === employee.id ? { ...e, ...stamped } as Employee : e)));
      setOpen(false);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); } finally { setBusy(false); }
  };

  return (
    <>
      <button type="button" disabled={!canWrite} onClick={() => setOpen(true)} className="text-[10px] font-normal text-[var(--muted)] hover:underline disabled:no-underline">
        {isHourly(employee) ? `Hourly, ${formatCurrency(employee.hourlyRateCents || 0)} an hour` : 'Salary'}<span className="sr-only">: how {employee.name} is paid</span>
      </button>
      {open && (
        <div {...dialogProps} className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-[var(--surface)] rounded-xl shadow-xl max-w-md w-full p-5 space-y-3 text-xs text-left font-sans">
            <h2 id={titleId} className="text-base font-bold text-[var(--text)]">How {employee.name} is paid</h2>
            <label className="flex items-center gap-2"><input type="radio" name={`pay-${employee.id}`} checked={!hourly} onChange={() => setHourly(false)} />A yearly salary ({formatCurrency(employee.salaryCents || 0)})</label>
            <label className="flex items-center gap-2"><input type="radio" name={`pay-${employee.id}`} checked={hourly} onChange={() => setHourly(true)} />By the hour, from their approved time on Time</label>
            {hourly && (
              <div className="space-y-2 pl-6">
                <label className="flex flex-col gap-1">Hourly rate<input inputMode="decimal" value={rate} onChange={e => setRate(e.target.value)} className="px-2 py-1 border border-[var(--line)] rounded w-28" /></label>
                <label className="flex flex-col gap-1">Whose time pays them
                  <select value={timeUid} onChange={e => setTimeUid(e.target.value)} className="px-2 py-1 border border-[var(--line)] rounded">
                    <option value="">Choose…</option>
                    {people.map(p => <option key={p.uid} value={p.uid}>{p.email || `A teammate (${p.role})`}</option>)}
                  </select>
                </label>
                {alsoPaid.length > 0 && <p role="status" className="text-amber-700">{alsoPaid.map(e => e.name).join(' and ')} {alsoPaid.length === 1 ? 'is' : 'are'} already paid from this person's time: a pay run with both refuses, so the same hours are not paid twice.</p>}
                <p className="text-[var(--muted)]">Each pay run pays their approved time up to the pay date that no earlier run paid. Taxes and deductions work as for a salary.</p>
              </div>
            )}
            {error && <p role="alert" className="text-rose-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className="text-[var(--muted)] hover:underline">Cancel</button>
              <button type="button" disabled={busy} onClick={() => void save()} className="px-3 py-1.5 rounded-lg bg-neutral-900 text-white font-semibold disabled:opacity-50">Save</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
