import { useListText } from '../../lib/i18n/useListText';
import type { ColumnDef } from '@tanstack/react-table';
/**
 * The pay runs on Payroll (U-02): each run's date, people, cost and status (posted, undone, waiting
 * for approval, sent back with the owner's note, withdrawn), with payslips (U-01) and Undo for a
 * posted run, and the direct deposit file (U-09). Split out of PayrollView.
 */
import { TanStackDataGrid } from '../ui/TanStackDataGrid';
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
  const listText = useListText();
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
    <div className="bg-[var(--surface)] border border-[var(--line)] rounded-lg overflow-hidden shadow-xs">
      <TanStackDataGrid
        data={payRuns}
        getRowId={(run) => run.id}
        caption={listText('Pay runs')}
        columnScope="pay-run-history"
        columnLabel={listText('Pay runs')}
        rowHeaderColumn="date"
        hidePaginationOnSinglePage

        renderDetail={(run) =>
          slipsOf === run.id ? (
            <div className="px-4 pb-3 bg-[var(--panel)]">
              <ul className="flex flex-wrap gap-2 pt-2">
                {(run.employees || []).map((e) => (
                  <li key={e.employeeId}>
                    <button
                      type="button"
                      onClick={() => void downloadPayslip(run, e.employeeId, e.name)}
                      className="px-2.5 py-1 rounded-md border border-[var(--line)] text-xs text-[var(--text)] hover:bg-[var(--surface)]"
                    >
                      {e.name}: payslip (PDF)
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null
        }
        columns={[
          {
            id: 'date', header: listText('Pay Run Date'), accessorFn: (run) => run.date,
            cell: ({ row: { original: run } }) => <div className="font-medium text-[var(--text)] font-mono">{formatDate(run.date)}</div>,
          },
          {
            id: 'employees', header: listText('Employees'), accessorFn: (run) => run.employeeCount,
            cell: ({ row: { original: run } }) => (
              <div className="text-center text-[var(--muted)]">
                <>{run.employeeCount} team members</>
              </div>
            ),
          },
          {
            id: 'total', header: listText('Total Employer Cost'), accessorFn: (run) => run.totalAmountCents,
            cell: ({ row: { original: run } }) => <div className="text-right font-mono font-bold text-[var(--text)]">{formatCurrency(run.totalAmountCents)}</div>,
          },
          {
            id: 'status', header: listText('Status'), accessorFn: (run) => run.status,
            cell: ({ row: { original: run } }) => (
              <div className="text-center">
                <>
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 border rounded-full text-[10px] font-semibold ${run.status === 'processed' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : run.status === 'awaiting_approval' ? 'bg-amber-50 text-amber-900 border-amber-200' : 'bg-[var(--panel)] text-[var(--text)] border-[var(--line)]'}`}
                  >
                    {run.status === 'processed' && <CheckCircle2 aria-hidden="true" className="w-3 h-3 text-[var(--pos)]" />}
                    {RUN_STATUS[run.status] || run.status}
                  </span>
                  {run.status === 'rejected' && run.rejectionNote && <p className="mt-1 text-[10px] text-[var(--muted)]">{run.rejectionNote}</p>}
                </>
              </div>
            ),
          },
          ...(canRunPayroll
            ? [
                {
                  id: 'actions',
                  header: listText('Actions'),
                  cell: ({ row: { original: run } }) => (
                    <div className="text-right">
                      <>
                        {run.status === 'processed' && (run.employees || []).length > 0 && (
                          <button
                            type="button"
                            aria-expanded={slipsOf === run.id}
                            onClick={() => setSlipsOf(slipsOf === run.id ? '' : run.id)}
                            className="mr-3 text-xs font-semibold text-[var(--text)] hover:underline"
                          >
                            Payslips<span className="sr-only"> of the pay run of {formatDate(run.date)}</span>
                          </button>
                        )}
                        {run.status === 'processed' && (run.employees || []).length > 0 && (
                          <button type="button" onClick={() => setDepositOf(run)} className="mr-3 text-xs font-semibold text-[var(--text)] hover:underline">
                            Direct deposit file<span className="sr-only"> of the pay run of {formatDate(run.date)}</span>
                          </button>
                        )}
                        {run.status === 'processed' && run.transactionId && (
                          <button
                            type="button"
                            disabled={undoingRun === run.id}
                            onClick={() => void undoRun(run)}
                            className="text-xs font-semibold text-[var(--muted)] hover:underline disabled:opacity-50"
                          >
                            Undo<span className="sr-only"> the pay run of {formatDate(run.date)}</span>
                          </button>
                        )}
                      </>
                    </div>
                  ),
                },
              ] satisfies ColumnDef<PayRun>[]
            : []),
        ]}
      />
      {depositOf && workspace && <DirectDepositDialog run={depositOf} workspace={workspace} onClose={() => setDepositOf(null)} />}
    </div>
  );
}
