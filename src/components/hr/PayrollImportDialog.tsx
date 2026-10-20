import React, { useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { useDialog } from '../../hooks/useDialog';
import { getIdToken } from '../../firebase';
import type { ChartAccount, DimensionDefinition } from '../../types';
import { formatCurrency } from '../../lib/utils';
import { isCashAccount } from '../../lib/txFilters';
import {
  PAYROLL_ACCOUNT_ROLES, PAYROLL_COLUMN_SETS, payrollEntries, readPayrollCsv,
  type PayrollAccountRole, type PayrollAccounts, type PayrollProvider,
} from '../../lib/payrollProviderImport';

interface PayrollImportDialogProps {
  workspaceId: string;
  accounts: ChartAccount[];
  dimensions: DimensionDefinition[];
  currency?: string;
  onClose: () => void;
}

const field = 'w-full min-h-11 px-3 py-2 text-sm bg-white border border-neutral-300 rounded-lg text-neutral-900';
const label = 'block text-xs font-semibold text-neutral-600 mb-1';
const accountLabel = (a: ChartAccount) => `${a.code ? `${a.code} - ` : ''}${a.name}`;

/**
 * PAY-1: records an outside payroll provider's results from its CSV (src/lib/payrollProviderImport.ts). The preview
 * shows each pay date's entry; the server reads the file again and posts one entry per pay date
 * (payrollImportService.ts). Nothing is guessed: every account is chosen here, and a column the provider's column set
 * does not have, a row that does not add up or a facility the books do not have stops the import with the reason.
 */
export default function PayrollImportDialog({ workspaceId, accounts, dimensions, currency, onClose }: PayrollImportDialogProps) {
  // #261 review: while the import is being posted the dialog cannot be dismissed (the request would still post)
  const savingRef = useRef(false);
  const close = () => { if (!savingRef.current) onClose(); };
  const { dialogProps, titleId } = useDialog(close, true);
  const [provider, setProvider] = useState<PayrollProvider>('gusto');
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [chosen, setChosen] = useState<PayrollAccounts>({});
  const [labelDimensionId, setLabelDimensionId] = useState('');
  const [saving, setSaving] = useState(false);
  const [serverProblems, setServerProblems] = useState<string[]>([]);
  // a new file or a second click makes an earlier answer stale: only the latest request's answer is shown
  const requestSeq = useRef(0);

  const usable = accounts.filter(a => !a.isArchived);
  const choicesFor = (side: 'expense' | 'liability', role: PayrollAccountRole) => usable.filter(a => {
    const type = String(a.type || '').toLowerCase();
    if (side === 'expense') return type === 'expense' || type === 'cost_of_goods';
    if (role === 'clearing') return (type === 'liability' || type === 'asset') && !isCashAccount(a);
    return type === 'liability';
  });

  const read = useMemo(() => (csv ? readPayrollCsv(csv, provider) : { rows: [], problems: [] }), [csv, provider]);
  // the preview groups by the file's own facility names; the server matches them to the workspace's labels
  const preview = useMemo(() => payrollEntries(read.rows, chosen), [read.rows, chosen]);
  const needed = PAYROLL_ACCOUNT_ROLES.filter(r => read.rows.some(row => row[`${r.from}Cents` as const] !== 0));
  const problems = [...read.problems, ...(read.problems.length ? [] : preview.problems)];

  const loadFile = async (file: File | undefined) => {
    const mine = ++requestSeq.current;
    setServerProblems([]);
    if (!file) return;
    const text = await file.text();
    // #261 review: a later choice of file wins, whichever read finishes first
    if (mine !== requestSeq.current) return;
    setFileName(file.name);
    setCsv(text);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (problems.length || !preview.payDates.length) return;
    const mine = ++requestSeq.current;
    savingRef.current = true;
    setSaving(true);
    setServerProblems([]);
    try {
      const res = await fetch(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/pay-runs/imports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getIdToken()}` },
        body: JSON.stringify({ provider, csv, fileName, accounts: chosen, ...(labelDimensionId ? { labelDimensionId } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (mine !== requestSeq.current) return;
      if (!res.ok) {
        setServerProblems([String(data.message || 'The payroll could not be imported'), ...(Array.isArray(data.problems) ? data.problems.map(String) : [])]);
        return;
      }
      const posted = (data.entries || []) as Array<{ payDate: string }>;
      toast.success(`Payroll recorded: ${posted.length} ${posted.length === 1 ? 'entry' : 'entries'} (${posted.map(p => p.payDate).join(', ')})`);
      onClose();
    } catch (err) {
      if (mine === requestSeq.current) setServerProblems([(err as Error).message]);
    } finally {
      savingRef.current = false;
      if (mine === requestSeq.current) setSaving(false);
    }
  };

  return (
    <div {...dialogProps} className="fixed inset-0 z-[210] flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto border border-neutral-200">
        <div className="flex items-center justify-between p-5 border-b border-neutral-200">
          <div>
            <h2 id={titleId} className="text-lg font-bold text-neutral-900">Import payroll from a provider</h2>
            <p className="text-xs text-neutral-600">Records what your payroll provider ran: one entry per pay date. It does not run payroll.</p>
          </div>
          <button type="button" onClick={close} disabled={saving} aria-label="Close payroll import" className="disabled:opacity-50 min-h-11 min-w-11 p-1 rounded-lg text-neutral-500 hover:text-neutral-900">
            <X aria-hidden="true" className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="payroll-import-provider" className={label}>Provider</label>
              <select id="payroll-import-provider" value={provider} onChange={e => setProvider(e.target.value as PayrollProvider)} className={field}>
                {(Object.keys(PAYROLL_COLUMN_SETS) as PayrollProvider[]).map(p => <option key={p} value={p}>{PAYROLL_COLUMN_SETS[p].name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="payroll-import-file" className={label}>CSV file</label>
              <input id="payroll-import-file" type="file" accept=".csv,text/csv" onChange={e => loadFile(e.target.files?.[0])} className={field} />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="payroll-import-label" className={label}>Split costs by label (optional)</label>
              <select id="payroll-import-label" value={labelDimensionId} onChange={e => setLabelDimensionId(e.target.value)} className={field}>
                <option value="">Do not split</option>
                {dimensions.filter(d => !d.isWorld).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <p className="text-xs text-neutral-600 mt-1">The file's department or location must name one of this label's values exactly.</p>
            </div>
          </div>

          {csv && !read.problems.length && (
            <fieldset className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <legend className="text-sm font-semibold text-neutral-900 mb-2">Accounts</legend>
              {needed.map(r => (
                <div key={r.role}>
                  <label htmlFor={`payroll-import-${r.role}`} className={label}>{r.label}</label>
                  <select id={`payroll-import-${r.role}`} value={chosen[r.role] || ''} onChange={e => setChosen(c => ({ ...c, [r.role]: e.target.value || undefined }))} className={field}>
                    <option value="">Choose an account</option>
                    {choicesFor(r.side, r.role).map(a => <option key={a.id} value={a.id}>{accountLabel(a)}</option>)}
                  </select>
                </div>
              ))}
            </fieldset>
          )}

          {problems.length > 0 && csv && (
            <ul role="alert" className="text-xs text-red-700 space-y-1 list-disc pl-5">{problems.map(p => <li key={p}>{p}</li>)}</ul>
          )}
          {serverProblems.length > 0 && (
            <ul role="alert" className="text-xs text-red-700 space-y-1 list-disc pl-5" data-testid="payroll-import-refused">{serverProblems.map(p => <li key={p}>{p}</li>)}</ul>
          )}

          {!problems.length && preview.payDates.map(p => (
            <div key={p.payDate} className="border border-neutral-200 rounded-lg" data-testid="payroll-import-preview">
              <div className="px-3 py-2 bg-neutral-50 text-sm font-semibold text-neutral-900 flex justify-between">
                <span>Pay date {p.payDate} · {p.totals.people} {p.totals.people === 1 ? 'person' : 'people'}</span>
                <span className="tabular-nums">Cost {formatCurrency(p.totals.costCents, currency)}</span>
              </div>
              <table className="w-full text-xs">
                <caption className="sr-only">The entry for the pay date {p.payDate}</caption>
                <thead><tr className="text-neutral-600"><th scope="col" className="text-left px-3 py-1">Account</th><th scope="col" className="text-right px-3 py-1">Debit</th><th scope="col" className="text-right px-3 py-1">Credit</th></tr></thead>
                <tbody>
                  {PAYROLL_ACCOUNT_ROLES.map(r => {
                    const cents = p.lines.filter(l => l.role === r.role).reduce((s, l) => s + l.amountCents, 0);
                    if (!cents) return null;
                    const name = usable.find(a => a.id === chosen[r.role])?.name || r.label;
                    return (
                      <tr key={r.role} className="border-t border-neutral-100">
                        <td className="px-3 py-1 text-neutral-900">{name}</td>
                        <td className="px-3 py-1 text-right tabular-nums">{cents > 0 ? formatCurrency(cents, currency) : ''}</td>
                        <td className="px-3 py-1 text-right tabular-nums">{cents < 0 ? formatCurrency(-cents, currency) : ''}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}

          <p className="text-xs text-neutral-600">The same file is refused a second time. To correct an imported pay date, reverse its entry without a replacement, then import the corrected file; if you already corrected it with Reverse &amp; Correct, the corrected entry stands and the file is refused. Pay the net amount from the bank to the payroll clearing account.</p>
          <div className="flex justify-end gap-3">
            <button type="button" onClick={close} disabled={saving} className="min-h-11 px-4 py-2 text-sm rounded-lg text-neutral-800 hover:bg-neutral-100 disabled:opacity-50">Cancel</button>
            <button type="submit" disabled={saving || !!problems.length || !preview.payDates.length} className="min-h-11 px-4 py-2 text-sm font-semibold rounded-lg bg-neutral-900 text-white disabled:opacity-50">
              {saving ? 'Recording…' : `Record ${preview.payDates.length || ''} ${preview.payDates.length === 1 ? 'entry' : 'entries'}`.replace(/\s+/g, ' ')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
