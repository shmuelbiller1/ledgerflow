import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { useDialog } from '../../hooks/useDialog';
import { useAuthStore } from '../../stores/useAuthStore';
import { describeChanges, mergeProblem } from '../../lib/accountMerge';
import type { ChartAccount } from '../../types';
import { runCommand, type CommandBody } from '../../lib/runCommand';

/**
 * Merge this account into another (CA-33): pick the account to keep (same kind), see what moves
 * (entries, documents, rules, budgets, items, settings), then merge. The server moves everything in
 * one step, adds the opening balance to the kept account and removes this one; it refuses when a
 * closed period would change. Owners and accountants.
 */
interface Props {
  account: ChartAccount;
  accounts: ChartAccount[];
  onClose: () => void;
}

interface Preview { into: string; changes: Record<string, number>; total: number }

async function call(workspaceId: string, path: string, body: unknown) {
  const data = await runCommand<CommandBody>({ path: `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/chart-accounts${path}`, method: 'POST', body: body }) ?? {};
  return data as Preview;
}

export default function MergeAccountDialog({ account, accounts, onClose }: Props) {
  const workspaceId = useAuthStore(s => s.currentWorkspaceId) || '';
  const [intoId, setIntoId] = useState('');
  // the server's answer, for the account it was asked about (a newer choice hides an older answer)
  const [answer, setAnswer] = useState<{ intoId: string; preview?: Preview; problem?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const { dialogProps, titleId } = useDialog(onClose, true);

  const options = useMemo(() => accounts
    .filter(a => a.id !== account.id && !a.isArchived && a.type === account.type)
    .sort((a, b) => a.code.localeCompare(b.code)), [accounts, account]);
  const into = options.find(a => a.id === intoId);
  const localProblem = into ? mergeProblem(account, into) : null;
  const current = answer && answer.intoId === intoId ? answer : null;
  const preview = current?.preview || null;
  const problem = current?.problem || '';

  // what would change, asked of the server each time the kept account changes
  useEffect(() => {
    if (!into || localProblem || !workspaceId) return undefined;
    let live = true;
    call(workspaceId, '/merge/preview', { fromId: account.id, intoId: into.id })
      .then(p => { if (live) setAnswer({ intoId: into.id, preview: p }); })
      .catch(err => { if (live) setAnswer({ intoId: into.id, problem: err instanceof Error ? err.message : String(err) }); });
    return () => { live = false; };
  }, [into, localProblem, workspaceId, account.id]);

  const submit = async () => {
    if (!into || !preview) return;
    setSaving(true);
    try {
      await call(workspaceId, '/merge', { fromId: account.id, intoId: into.id });
      toast.success(`"${account.name}" merged into "${into.name}"`);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const label = (a: ChartAccount) => `${a.code ? `${a.code} · ` : ''}${a.name}`;

  return (
    <div {...dialogProps} className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4">
      <div className="bg-[var(--surface)] rounded-xl shadow-xl max-w-md w-full border border-[var(--line)]">
        <div className="flex items-center justify-between p-5 border-b border-[var(--line)]">
          <h2 id={titleId} className="text-lg font-bold text-[var(--text)]">Merge {label(account)} into another account</h2>
          <button type="button" onClick={onClose} aria-label="Close merge" className="p-1 rounded-lg text-[var(--muted)] hover:text-[var(--text)]">
            <X aria-hidden="true" className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label htmlFor="merge-account-into" className="block text-xs font-semibold text-[var(--muted)] mb-1">Account to keep</label>
            <select id="merge-account-into" value={intoId} onChange={e => setIntoId(e.target.value)} className="w-full px-3 py-2 text-sm bg-[var(--ink)] border border-[var(--line)] rounded-lg text-[var(--text)]">
              <option value="">Choose an account…</option>
              {options.map(a => <option key={a.id} value={a.id}>{label(a)}</option>)}
            </select>
            {options.length === 0 && <p className="text-xs text-[var(--muted)] mt-1">No other {account.type} account to merge into.</p>}
          </div>
          {(localProblem || problem) && <p role="alert" className="text-xs text-rose-700 dark:text-rose-300">{localProblem || problem}</p>}
          {into && preview && (
            <p role="status" className="text-xs text-[var(--text)] bg-[var(--ink)] border border-[var(--line)] rounded-lg p-3">
              {preview.total ? `${describeChanges(preview.changes)} will use "${into.name}" instead.` : `Nothing uses "${account.name}" yet.`}{' '}
              Amounts do not change; the opening balance of &quot;{account.name}&quot; is added to &quot;{into.name}&quot;, and
              &quot;{account.name}&quot; is then removed. This cannot be undone.
            </p>
          )}
          <div className="flex justify-end gap-3">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg text-[var(--text)] hover:bg-[var(--ink)]">Cancel</button>
            <button type="button" disabled={!preview || saving} onClick={submit} className="px-4 py-2 text-sm font-semibold rounded-lg bg-rose-700 text-white disabled:opacity-50">
              {saving ? 'Merging…' : 'Merge'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
