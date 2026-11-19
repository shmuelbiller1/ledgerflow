/**
 * Deductions (U-05 benefits and deductions, U-06 garnishments) in the Payroll employee directory:
 * under each employee's period net pay, what is deducted, and "Deductions" to add or remove pre-tax
 * (401(k), health), after-tax (Roth, dues) and garnishments (a court or agency order, limited to a
 * share of disposable earnings). Each shows what this period actually takes; one that does not fit
 * is cut, and the dialog says so. The rules are src/lib/payrollDeductions.ts; this saves the employee.
 */
import React, { useState } from 'react';
import { toast } from 'sonner';
import { useDialog } from '../../hooks/useDialog';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { computePeriodPayroll } from '../../lib/payroll-engine';
import { DEFAULT_GARNISHMENT_PERCENT, deductionProblem, KIND_LABEL, type DeductionKind, type EmployeeDeduction } from '../../lib/payrollDeductions';
import { formatCurrency } from '../../lib/utils';
import type { Employee } from '../../types';
import { saveEmployee } from '../../lib/recordWrites';

async function save(employee: Employee, deductions: EmployeeDeduction[]) {
  await saveEmployee(employee.workspaceId, employee.id, { deductions });
  useLedgerStore.setState(state => ({ employees: state.employees.map(e => (e.id === employee.id ? { ...e, deductions } : e)) }));
}

const describe = (d: EmployeeDeduction) => {
  const how = d.amountCents !== undefined ? `${formatCurrency(d.amountCents)} a pay period` : `${d.percent}% of ${d.kind === 'garnishment' ? 'disposable earnings' : 'gross pay'}`;
  return d.kind === 'garnishment' ? `${how}, at most ${d.maxPercent ?? DEFAULT_GARNISHMENT_PERCENT}% of disposable earnings` : how;
};

export function DeductionsCell({ employee, canWrite }: { employee: Employee; canWrite: boolean }) {
  const [open, setOpen] = useState(false);
  const { dialogProps, titleId } = useDialog(() => setOpen(false), open);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<DeductionKind>('pre_tax');
  const [how, setHow] = useState<'amount' | 'percent'>('amount');
  const [value, setValue] = useState('');
  const [limit, setLimit] = useState(String(DEFAULT_GARNISHMENT_PERCENT));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (employee.workerType === 'contractor') return null;
  const list = employee.deductions || [];
  const period = computePeriodPayroll(employee);
  const total = period.preTaxDeductionsCents + period.garnishmentsCents + period.postTaxDeductionsCents;
  const taken = new Map(period.deductionLines.map(l => [l.id, l]));

  const start = () => {
    setName('');
    setKind('pre_tax');
    setHow('amount');
    setValue('');
    setLimit(String(DEFAULT_GARNISHMENT_PERCENT));
    setError('');
    setOpen(true);
  };

  const store = async (next: EmployeeDeduction[], done: string) => {
    setBusy(true);
    setError('');
    try {
      await save(employee, next);
      toast.success(done);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    const number = Number(value);
    const entry: EmployeeDeduction = {
      id: `ded_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name: name.trim(), kind,
      ...(how === 'amount' ? { amountCents: Math.round(number * 100) } : { percent: number }),
      ...(kind === 'garnishment' ? { maxPercent: Number(limit) } : {}) };
    if (!value.trim() || !Number.isFinite(number)) { setError(how === 'amount' ? 'Enter the amount a pay period' : 'Enter the percent'); return; }
    const problem = deductionProblem(entry);
    if (problem) { setError(problem); return; }
    if (await store([...list, entry], `${entry.name} added`)) { setName(''); setValue(''); }
  };

  return (
    <>
      {total > 0 && <div className="text-[10px] text-[var(--muted)]">after {formatCurrency(total)} deducted</div>}
      <button type="button" onClick={start} className="mt-1 text-[11px] font-semibold text-[var(--text)] hover:underline">
        Deductions<span className="sr-only"> of {employee.name}</span>
      </button>
      {open && (
        <div {...dialogProps} className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-[var(--surface)] rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-5 space-y-4 text-xs text-left font-sans">
            <div className="flex items-start justify-between gap-3">
              <h2 id={titleId} className="text-base font-bold text-[var(--text)]">Deductions: {employee.name}</h2>
              <button type="button" onClick={() => setOpen(false)} className="text-[var(--muted)] hover:text-[var(--text)]">Close</button>
            </div>
            <p role="status" className="text-sm text-[var(--text)]">
              This pay period: {formatCurrency(period.grossPayCents)} gross, {formatCurrency(period.totalWithholdingCents)} taxes, {formatCurrency(total)} deducted, {formatCurrency(period.netPayCents)} net pay.
            </p>
            {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}

            {list.length === 0 && !employee.preTaxDeductionsCents ? <p className="text-[var(--muted)]">No deductions.</p> : (
              <ul aria-label={`Deductions of ${employee.name}`} className="divide-y divide-neutral-100 border-y border-[var(--line)]">
                {employee.preTaxDeductionsCents ? (
                  <li className="py-1.5">Pre-tax deductions: {formatCurrency(employee.preTaxDeductionsCents)} a pay period</li>
                ) : null}
                {list.map(d => {
                  const line = taken.get(d.id);
                  return (
                    <li key={d.id} className="flex items-start justify-between gap-2 py-1.5">
                      <span>
                        <span className="font-semibold">{d.name}</span> · {KIND_LABEL[d.kind]} · {describe(d)}
                        {line && line.cents < line.requestedCents && (
                          <span className="block text-amber-700">This period takes {formatCurrency(line.cents)} of {formatCurrency(line.requestedCents)}: {d.kind === 'garnishment' ? 'the limit or the pay left allows no more' : 'not enough pay is left'}</span>
                        )}
                      </span>
                      {canWrite && (
                        <button type="button" disabled={busy} onClick={() => void store(list.filter(x => x.id !== d.id), `${d.name} removed`)} className="text-[var(--muted)] hover:underline disabled:opacity-50">
                          Remove<span className="sr-only"> {d.name}</span>
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {canWrite && (
              <fieldset disabled={busy} className="space-y-2">
                <legend className="font-semibold text-[var(--text)]">Add a deduction</legend>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">Name
                    <input type="text" maxLength={60} value={name} onChange={e => setName(e.target.value)} placeholder="401(k), Health, Child support" className="mt-1 w-full rounded-lg border border-[var(--line)] p-2" />
                  </label>
                  <label className="block">Kind
                    <select value={kind} onChange={e => setKind(e.target.value as DeductionKind)} className="mt-1 w-full rounded-lg border border-[var(--line)] p-2">
                      <option value="pre_tax">Pre-tax (401(k), health, HSA)</option>
                      <option value="post_tax">After-tax (Roth, dues)</option>
                      <option value="garnishment">Garnishment (court or agency order)</option>
                    </select>
                  </label>
                  <label className="block">How much
                    <select value={how} onChange={e => setHow(e.target.value as 'amount' | 'percent')} className="mt-1 w-full rounded-lg border border-[var(--line)] p-2">
                      <option value="amount">An amount each pay period</option>
                      <option value="percent">{kind === 'garnishment' ? 'A percent of disposable earnings' : 'A percent of gross pay'}</option>
                    </select>
                  </label>
                  <label className="block">{how === 'amount' ? 'Amount' : 'Percent'}
                    <input type="number" min="0" step={how === 'amount' ? '0.01' : '0.5'} value={value} onChange={e => setValue(e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--line)] p-2" />
                  </label>
                  {kind === 'garnishment' && (
                    <label className="block col-span-2">Most the order allows (% of disposable earnings: pay less taxes)
                      <input type="number" min="1" max="65" step="1" value={limit} onChange={e => setLimit(e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--line)] p-2" />
                    </label>
                  )}
                </div>
                <button type="button" disabled={busy} onClick={() => void add()} className="min-h-9 px-3 rounded-lg bg-neutral-900 text-white font-semibold disabled:opacity-50">Add</button>
              </fieldset>
            )}
          </div>
        </div>
      )}
    </>
  );
}
