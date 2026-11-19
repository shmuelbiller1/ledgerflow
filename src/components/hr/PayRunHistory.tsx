/**
 * The pay runs on Payroll (U-02): each run's date, people, cost and status (posted, undone, waiting
 * for approval, sent back with the owner's note, withdrawn), with payslips (U-01) and Undo for a
 * posted run, and the direct deposit file (U-09). Split out of PayrollView.
 */
import { runCommand, commandErrorMessage } from '../../lib/runCommand';
import { uiLanguageNow } from '../../lib/i18n/uiLanguageNow';
import React, { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { getIdToken } from '../../firebase';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { formatCurrency, formatDate } from '../../lib/utils';
import type { PayRun } from '../../types';
import { DirectDepositDialog } from './DirectDepositDialog';

const RUN_STATUS: Partial<Record<PayRun['status'], string>> = {
  processed: 'Posted to the ledger', undone: 'Undone', awaiting_approval: 'Waiting for approval', rejected: 'Sent back', withdrawn: 'Withdrawn',
};

export function PayRunHistory({ payRuns, canRunPayroll, onDone, onError }: {
  payRuns: PayRun[];
  canRunPayroll: boolean;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const setPayRuns = useLedgerStore(s => s.setPayRuns);
  const [undoingRun, setUndoingRun] = useState('');
  // U-01: the run whose payslips are listed
  const [slipsOf, setSlipsOf] = useState('');
  // U-09: the run whose direct deposit file is being made
  const [depositOf, setDepositOf] = useState<PayRun | null>(null);
  const downloadPayslip = async (run: PayRun, employeeId: string, name: string) => {
    if (!workspace?.id) return;
    try {
      const res = await fetch(`/api/v1/workspaces/${encodeURIComponent(workspace.id)}/pay-runs/${encodeURIComponent(run.id)}/payslips/${encodeURIComponent(employeeId)}`, {
        headers: { Authorization: `Bearer ${await getIdToken()}` },
      });
      // the payslip is a PDF, not JSON: runCommand parses JSON, so this one stays a plain fetch
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { message?: string }).message || 'The payslip could not be made');
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `payslip_${run.date}_${name.replace(/[^\w.-]+/g, '_')}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err) {
      onError(commandErrorMessage(err, uiLanguageNow()));
    }
  };

  const undoRun = async (run: PayRun) => {
    if (!workspace?.id || !window.confirm(`Undo the pay run of ${formatDate(run.date)}? Its ledger entry is voided.`)) return;
    setUndoingRun(run.id);
    try {
      await runCommand({ path: `/api/v1/workspaces/${encodeURIComponent(workspace.id)}/pay-runs/${encodeURIComponent(run.id)}`, method: 'DELETE' });
      setPayRuns(payRuns.map(r => (r.id === run.id ? { ...r, status: 'undone' } : r)));
      onDone(`Pay run of ${formatDate(run.date)} undone; its entry is void.`);
    } catch (err) {
      onError(commandErrorMessage(err, uiLanguageNow()));
    } finally {
      setUndoingRun('');
    }
  };

  return (
    <div className="bg-white border border-neutral-200 rounded-lg overflow-hidden shadow-xs">
      <table className="w-full text-left text-xs">
        <caption className="sr-only">Pay runs</caption>
        <thead className="bg-neutral-50 border-b border-neutral-200 text-neutral-600 font-semibold uppercase tracking-wider">
          <tr>
            <th scope="col" className="py-3 px-4">Pay Run Date</th>
            <th scope="col" className="py-3 px-4 text-center">Employees</th>
            <th scope="col" className="py-3 px-4 text-right">Total Employer Cost</th>
            <th scope="col" className="py-3 px-4 text-center">Status</th>
            {canRunPayroll && <th scope="col" className="py-3 px-4"><span className="sr-only">Actions</span></th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {payRuns.map((run) => (
            <React.Fragment key={run.id}>
            <tr className="hover:bg-neutral-50/80 transition-colors">
              <td className="py-3 px-4 font-medium text-neutral-900 font-mono">
                {formatDate(run.date)}
              </td>
              <td className="py-3 px-4 text-center text-neutral-600">
                {run.employeeCount} team members
              </td>
              <td className="py-3 px-4 text-right font-mono font-bold text-neutral-900">
                {formatCurrency(run.totalAmountCents)}
              </td>
              <td className="py-3 px-4 text-center">
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 border rounded-full text-[10px] font-semibold ${run.status === 'processed' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : run.status === 'awaiting_approval' ? 'bg-amber-50 text-amber-900 border-amber-200' : 'bg-neutral-50 text-neutral-700 border-neutral-200'}`}>
                  {run.status === 'processed' && <CheckCircle2 aria-hidden="true" className="w-3 h-3 text-emerald-600" />}
                  {RUN_STATUS[run.status] || run.status}
                </span>
                {run.status === 'rejected' && run.rejectionNote && <p className="mt-1 text-[10px] text-neutral-600">{run.rejectionNote}</p>}
              </td>
              {canRunPayroll && (
                <td className="py-3 px-4 text-right">
                  {run.status === 'processed' && (run.employees || []).length > 0 && (
                    <button type="button" aria-expanded={slipsOf === run.id} onClick={() => setSlipsOf(slipsOf === run.id ? '' : run.id)} className="mr-3 text-xs font-semibold text-neutral-700 hover:underline">
                      Payslips<span className="sr-only"> of the pay run of {formatDate(run.date)}</span>
                    </button>
                  )}
                  {run.status === 'processed' && (run.employees || []).length > 0 && (
                    <button type="button" onClick={() => setDepositOf(run)} className="mr-3 text-xs font-semibold text-neutral-700 hover:underline">
                      Direct deposit file<span className="sr-only"> of the pay run of {formatDate(run.date)}</span>
                    </button>
                  )}
                  {run.status === 'processed' && run.transactionId && (
                    <button type="button" disabled={undoingRun === run.id} onClick={() => void undoRun(run)} className="text-xs font-semibold text-neutral-500 hover:underline disabled:opacity-50">
                      Undo<span className="sr-only"> the pay run of {formatDate(run.date)}</span>
                    </button>
                  )}
                </td>
              )}
            </tr>
            {slipsOf === run.id && (
              <tr>
                <td colSpan={5} className="px-4 pb-3 bg-neutral-50">
                  <ul className="flex flex-wrap gap-2 pt-2">
                    {(run.employees || []).map(e => (
                      <li key={e.employeeId}>
                        <button type="button" onClick={() => void downloadPayslip(run, e.employeeId, e.name)} className="px-2.5 py-1 rounded-md border border-neutral-300 text-xs text-neutral-800 hover:bg-white">
                          {e.name}: payslip (PDF)
                        </button>
                      </li>
                    ))}
                  </ul>
                </td>
              </tr>
            )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
      {depositOf && workspace && <DirectDepositDialog run={depositOf} workspace={workspace} onClose={() => setDepositOf(null)} />}
    </div>
  );
}
