import ReportSchedule from '../reporting/ReportSchedule';
import React, { useState } from 'react';
import { toast } from 'sonner';
import { useDialog } from '../../hooks/useDialog';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { formatCurrency, formatDate } from '../../lib/utils';
import { bankProblem, companyProblem, nachaFile, type BankAccountType, type CompanyBank, type EmployeeBank } from '../../lib/nacha';
import type { Employee, PayRun } from '../../types';
import { saveEmployee } from '../../lib/recordWrites';

const field = 'px-2 py-1 border border-[var(--line)] rounded text-xs';
const companyKey = (workspaceId: string) => `lf_ach_company:${workspaceId}`;
function readCompany(workspaceId: string, name: string): CompanyBank {
  try {
    const saved = JSON.parse(localStorage.getItem(companyKey(workspaceId)) || 'null');
    if (saved && typeof saved === 'object') return { routing: '', companyId: '', bankName: '', ...saved, companyName: saved.companyName || name };
  } catch { /* nothing kept */ }
  return { routing: '', companyId: '', bankName: '', companyName: name };
}

/** The last 4 digits only: account numbers are not shown in full. */
const masked = (account?: string) => (account ? `••••${account.slice(-4)}` : '');

/**
 * Direct deposit file (U-09) for a posted pay run: each person's net pay with their bank account
 * (add or fix one here; it is kept on the employee), the company's bank details (kept in this
 * browser only), and the NACHA file to upload to the bank. Nothing is posted.
 */
export function DirectDepositDialog({ run, workspace, onClose }: { run: PayRun; workspace: { id: string; name?: string; currency?: string }; onClose: () => void }) {
  const { dialogProps, titleId } = useDialog(onClose, true);
  useLedgerCollections('employees');
  const employees = useLedgerStore(s => (s.employees || []) as Employee[]);
  const setEmployees = useLedgerStore(s => s.setEmployees);
  const [company, setCompany] = useState<CompanyBank>(() => readCompany(workspace.id, workspace.name || ''));
  const [editing, setEditing] = useState<{ id: string; bank: EmployeeBank } | null>(null);
  const [busy, setBusy] = useState(false);
  const bankOf = (id: string): EmployeeBank => {
    const e = employees.find(x => x.id === id);
    return { bankRouting: e?.bankRouting, bankAccount: e?.bankAccount, bankAccountType: e?.bankAccountType };
  };
  const lines = (run.employees || []).map(e => ({ employeeId: e.employeeId, name: e.name, netCents: e.netCents, bank: bankOf(e.employeeId) }));
  const ready = lines.filter(l => !bankProblem(l.bank));
  const companyIssue = companyProblem(company);
  const setCo = (change: Partial<CompanyBank>) => setCompany(c => ({ ...c, ...change }));

  const saveBank = async () => {
    if (!editing) return;
    const problem = bankProblem(editing.bank);
    if (problem) { toast.error(problem); return; }
    setBusy(true);
    try {
      const fields = { bankRouting: editing.bank.bankRouting, bankAccount: editing.bank.bankAccount, bankAccountType: editing.bank.bankAccountType };
      await saveEmployee(workspace.id, editing.id, fields);
      const stamped = { ...fields, updatedAt: new Date().toISOString() };
      setEmployees(employees.map(e => (e.id === editing.id ? { ...e, ...stamped } as Employee : e)));
      setEditing(null);
    } catch (err) { toast.error(err instanceof Error ? err.message : String(err)); } finally { setBusy(false); }
  };

  const download = () => {
    const file = nachaFile(company, lines, run.date, new Date());
    try { localStorage.setItem(companyKey(workspace.id), JSON.stringify(company)); } catch { /* kept for this visit only */ }
    const blob = new Blob([file.text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `direct-deposit_${run.date}.ach`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    toast.success(`${file.entries} ${file.entries === 1 ? 'deposit' : 'deposits'}, ${formatCurrency(file.totalCents, workspace.currency || 'USD')}: upload the file to your bank`);
  };

  return (
    <div {...dialogProps} className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-[var(--surface)] rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-5 space-y-4 text-xs text-left font-sans">
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="text-base font-bold text-[var(--text)]">Direct deposit file: pay run of {formatDate(run.date)}</h2>
          <button type="button" onClick={onClose} className="text-[var(--muted)] hover:underline">Close</button>
        </div>
        <p className="text-[var(--text)]">A NACHA (ACH) file of each person's net pay, to upload to your bank's online banking. The money arrives on the pay date if the bank gets the file in time; nothing is posted again.</p>
        <fieldset className="space-y-2">
          <legend className="font-semibold text-[var(--text)]">Your bank (kept in this browser only)</legend>
          <div className="flex flex-wrap gap-2">
            <label className="flex flex-col gap-1">Company name<input value={company.companyName} onChange={e => setCo({ companyName: e.target.value })} className={field} /></label>
            <label className="flex flex-col gap-1">Company ID from your bank<input value={company.companyId} maxLength={10} onChange={e => setCo({ companyId: e.target.value })} className={field} /></label>
            <label className="flex flex-col gap-1">Your bank's routing number<input inputMode="numeric" value={company.routing} maxLength={9} onChange={e => setCo({ routing: e.target.value.replace(/\D/g, '') })} className={field} /></label>
            <label className="flex flex-col gap-1">Your bank's name<input value={company.bankName || ''} onChange={e => setCo({ bankName: e.target.value })} className={field} /></label>
          </div>
          {companyIssue && <p role="status" className="text-amber-800 dark:text-amber-300">{companyIssue}</p>}
        </fieldset>
        <ReportSchedule
          caption={
            <>
              Deposits ({ready.length} of {lines.length} ready)
            </>
          }
          captionClassName="text-left font-semibold text-[var(--text)] pb-1"
          tableClassName="w-full"
          headRowClassName="border-b text-[var(--muted)]"
          bodyClassName=""
          rowClassName="border-b border-[var(--line)]"
          rows={lines}
          rowKey={(l) => l.employeeId}
          renderDetail={(l) =>
            editing?.id === l.employeeId ? (
              <div className="py-2 bg-[var(--panel)]">
                <div className="flex flex-wrap items-end gap-2 px-2">
                  <label className="flex flex-col gap-1">
                    Routing number
                    <input
                      inputMode="numeric"
                      maxLength={9}
                      value={editing.bank.bankRouting || ''}
                      onChange={(e) => setEditing({ ...editing, bank: { ...editing.bank, bankRouting: e.target.value.replace(/\D/g, '') } })}
                      className={field}
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    Account number
                    <input
                      inputMode="numeric"
                      maxLength={17}
                      value={editing.bank.bankAccount || ''}
                      onChange={(e) => setEditing({ ...editing, bank: { ...editing.bank, bankAccount: e.target.value.replace(/\D/g, '') } })}
                      className={field}
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    Type
                    <select
                      value={editing.bank.bankAccountType || 'checking'}
                      onChange={(e) => setEditing({ ...editing, bank: { ...editing.bank, bankAccountType: e.target.value as BankAccountType } })}
                      className={field}
                    >
                      <option value="checking">Checking</option>
                      <option value="savings">Savings</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void saveBank()}
                    className="px-2.5 py-1 rounded-md bg-neutral-900 text-white font-semibold disabled:opacity-50"
                  >
                    Save account
                  </button>
                  <button type="button" onClick={() => setEditing(null)} className="text-[var(--muted)] hover:underline">
                    Cancel
                  </button>
                </div>
              </div>
            ) : null
          }
          columns={[
            { header: 'Person', headClassName: 'text-left py-1', className: 'text-left font-normal py-1', cell: (l) => <bdi>{l.name}</bdi> },
            {
              header: 'Account',
              headClassName: 'text-left py-1', className: 'py-1',
              cell: (l) =>
                bankProblem(l.bank) ? (
                  <span className="text-amber-800 dark:text-amber-300">No bank account yet</span>
                ) : (
                  `${l.bank.bankAccountType} ${masked(l.bank.bankAccount)} at ${l.bank.bankRouting}`
                ),
            },
            {
              header: 'Net pay',
              headClassName: 'text-right py-1', className: 'py-1 text-right font-mono',
              cell: (l) => formatCurrency(l.netCents, workspace.currency || 'USD'),
            },
            {
              header: <span className="sr-only">Change</span>,
              headClassName: '', className: 'py-1 text-right',
              cell: (l) => (
                <button
                  type="button"
                  onClick={() => setEditing({ id: l.employeeId, bank: { bankAccountType: 'checking', ...l.bank } })}
                  className="text-[var(--text)] underline"
                >
                  {bankProblem(l.bank) ? 'Add' : 'Change'}
                  <span className="sr-only"> the bank account of {l.name}</span>
                </button>
              ),
            },
          ]}
        />
        {ready.length < lines.length && <p className="text-amber-800 dark:text-amber-300">People without a bank account are left out of the file; pay them another way.</p>}
        <button type="button" disabled={Boolean(companyIssue) || ready.length === 0} onClick={download} className="px-3 py-1.5 rounded-lg bg-neutral-900 text-white font-semibold disabled:opacity-50">Download the file</button>
      </div>
    </div>
  );
}
