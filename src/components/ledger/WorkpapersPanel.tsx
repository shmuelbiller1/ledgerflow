/**
 * BD-04 workpapers (AI #3, A-6): on Month-End Close, per account and month — the balance at
 * month end, a note, files and a "reviewed by … on …" mark. Read-only on money: the balances
 * come from the general ledger's own figures (buildWorkpapers in src/lib/workpapers.ts); the
 * note and the review mark are saved on the account document by owners and accountants (the
 * chartAccounts policy limits writes to them); the files go through the attachments service
 * with the month in the label. Nothing is posted.
 */
import React, { useMemo } from 'react';
import { CheckCircle2, ClipboardList } from 'lucide-react';
import { toast } from 'sonner';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { db } from '../../firebase';
import { doc, updateDoc } from '../../lib/db/firestore';
import { formatCurrency } from '../../lib/utils';
import {
  buildWorkpapers,
  clearWorkpaperReview,
  markWorkpaperReviewed,
  setWorkpaperNote,
  workpaperLabel,
  workpaperMonthProblem,
  type WorkpaperRow,
} from '../../lib/workpapers';
import type { ChartAccount } from '../../types';
import InlineEdit from '../ui/InlineEdit';
import AttachmentsPanel from '../common/AttachmentsPanel';

function monthLabel(month: string): string {
  const [year, index] = month.split('-').map(Number);
  return new Date(year, (index || 1) - 1, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });
}

/**
 * Save one month's workpaper on the account. Until the database change is applied the guard
 * refuses the new field; that is said with what to do about it (the same pattern as loans).
 */
async function saveWorkpaper(account: ChartAccount, next: ChartAccount): Promise<void> {
  try {
    await updateDoc(doc(db, 'chartAccounts', account.id), { workpapers: next.workpapers || {}, updatedAt: new Date().toISOString() });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/not allowed on chartAccounts/.test(message)) {
      throw new Error('This workspace database has not been updated for workpapers yet: the owner applies supabase/migrations/20261013050000_chart_account_workpapers.sql, and saving works from then on.', { cause: err });
    }
    throw err instanceof Error ? err : new Error(message);
  }
}

export default function WorkpapersPanel({ month, currency }: { month: string; currency?: string }) {
  const accounts = useLedgerStore(s => s.accounts);
  const transactions = useLedgerStore(s => s.transactions);
  const updateAccount = useLedgerStore(s => s.updateAccount);
  const role = useCurrentRole();
  const user = useAuthStore(s => s.user);
  // the chartAccounts policy lets owners and accountants write; everyone else reads
  const canWrite = role === 'owner' || role === 'accountant';
  const problem = workpaperMonthProblem(month);
  const result = useMemo(
    () => (problem ? null : buildWorkpapers({ accounts: accounts || [], transactions: transactions || [], month })),
    [accounts, transactions, month, problem],
  );

  if (problem || !result) {
    return (
      <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 space-y-2" aria-labelledby="workpapers">
        <h2 id="workpapers" className="text-lg font-medium text-[var(--text)] flex items-center gap-2">
          <ClipboardList className="w-5 h-5 text-[var(--brass)]" aria-hidden="true" /> Workpapers
        </h2>
        <p role="alert" className="text-sm text-[var(--neg)]">{problem}</p>
      </section>
    );
  }

  const { rows, reviewedCount, endDate } = result;
  const label = workpaperLabel(month);
  const byId = new Map((accounts || []).map(a => [a.id, a]));
  const reviewer = (user?.displayName || user?.email || '').trim();

  /** Save on the account and show it at once (the live list would refresh it anyway). */
  const save = async (account: ChartAccount, updated: ChartAccount, success: string) => {
    await saveWorkpaper(account, updated);
    updateAccount(account.id, { workpapers: updated.workpapers || {} });
    toast.success(success);
  };

  const saveNote = (account: ChartAccount) => async (next: string | number) => {
    await save(account, setWorkpaperNote(account, month, String(next)), 'Note saved');
  };

  const markReviewed = (account: ChartAccount) => async () => {
    if (!reviewer) { toast.error('Sign in to mark a workpaper reviewed'); return; }
    try {
      await save(account, markWorkpaperReviewed(account, month, reviewer), `Marked reviewed by ${reviewer}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The review mark was not saved');
    }
  };

  const unmarkReview = (account: ChartAccount) => async () => {
    try {
      await save(account, clearWorkpaperReview(account, month), 'Review mark removed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The review mark was not removed');
    }
  };

  return (
    <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 space-y-4" aria-labelledby="workpapers">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h2 id="workpapers" className="text-lg font-medium text-[var(--text)] flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-[var(--brass)]" aria-hidden="true" /> Workpapers
          </h2>
          <p className="text-sm text-[var(--muted)] mt-1">
            Per account: the balance at the end of {monthLabel(month)}, a note, files and a review mark.
            Owners and accountants keep them; nothing here changes the books.
          </p>
        </div>
        <p className="text-sm text-[var(--muted)]">{reviewedCount} of {rows.length} reviewed</p>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No account has a balance at the end of {monthLabel(month)} yet.</p>
      ) : (
        // a table that scrolls sideways can be reached and scrolled with the keyboard
        <div className="overflow-x-auto rounded-xl border border-[var(--line)]" tabIndex={0} role="region" aria-label={`Workpapers of ${monthLabel(month)}`}>{/* NOSONAR: S6845 — tabIndex on scrollable region is the intentional axe scrollable-region-focusable pattern */}
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">
              Workpapers of {monthLabel(month)}: each account's balance at {endDate}, its note, its files and its review mark
            </caption>
            <thead className="bg-[var(--ink)]">
              <tr>
                <th scope="col" className="p-3 text-left">Account</th>
                <th scope="col" className="p-3 text-right whitespace-nowrap">Balance at {endDate}</th>
                <th scope="col" className="p-3 text-left">Note</th>
                <th scope="col" className="p-3 text-left">Files</th>
                <th scope="col" className="p-3 text-left">Reviewed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row: WorkpaperRow) => {
                const account = byId.get(row.accountId);
                if (!account) return null;
                return (
                  <tr key={row.accountId} className="border-t border-[var(--line)] align-top">
                    <th scope="row" className="p-3 text-left">
                      <span className="block font-medium"><bdi>{row.name}</bdi></span>
                      <span className="block text-xs font-normal text-[var(--muted)]">{row.code}</span>
                    </th>
                    <td className="p-3 text-right whitespace-nowrap tabular-nums">{formatCurrency(row.balanceCents, currency)}</td>
                    <td className="p-3 min-w-[16rem]">
                      <InlineEdit
                        kind="textarea"
                        value={row.note}
                        label={`Note on ${row.name} for ${month}`}
                        placeholder="Add a note"
                        canEdit={canWrite}
                        onSave={saveNote(account)}
                      />
                    </td>
                    <td className="p-3 min-w-[14rem]">
                      {/* one name per account (screen readers tell the file lists apart), and only this month's files */}
                      <AttachmentsPanel target={{ collection: 'chartAccounts', id: row.accountId, label: `${label}: ${row.name}`, scope: label }} />
                    </td>
                    <td className="p-3">
                      {row.reviewedBy ? (
                        <div className="space-y-1">
                          <p className="flex items-center gap-1.5 text-[var(--pos)]">
                            <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                            <span>Reviewed by {row.reviewedBy}{row.reviewedAt ? ` on ${row.reviewedAt.slice(0, 10)}` : ''}</span>
                          </p>
                          {canWrite && (
                            <button type="button" onClick={() => void unmarkReview(account)()}
                              className="text-xs font-semibold text-[var(--brass)] hover:underline">
                              Remove the review
                            </button>
                          )}
                        </div>
                      ) : canWrite ? (
                        <button type="button" onClick={() => void markReviewed(account)()}
                          className="text-xs font-semibold px-2.5 py-1 rounded-lg border border-[var(--line)] text-[var(--text)]">
                          Mark reviewed
                        </button>
                      ) : (
                        <span className="text-[var(--faint)]">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-[var(--muted)]">
        Balances are in the account's own direction, as in the general ledger. Notes and review marks are kept on the account;
        files are kept with it through the attachments service.
      </p>
    </section>
  );
}
