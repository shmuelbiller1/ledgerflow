import { runCommand, ServerCommandError } from '../../lib/runCommand';
import React, { useEffect, useMemo, useState } from 'react';
import { MessageSquareText } from 'lucide-react';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useUIStore } from '../../stores/useUIStore';
import { formatCurrency, formatDate, getLocalDateISO } from '../../lib/utils';
import { answerCents, readQuestion, type AskFilter, type AskReading } from '../../lib/askBooks';
import ReportEmptyState from './ReportEmptyState';

interface Line { key: string; date: string; description: string; payee?: string; accountName: string; amountCents: number; document: { type: 'invoice' | 'bill' | 'transaction'; id: string } | null; bankMatched: boolean; attachments: number }
interface Explanation { lines: Line[]; totalCents: number; entries: number }

const field = 'px-2 py-1.5 text-sm border border-[var(--line)] rounded bg-[var(--panel)] text-[var(--text)]';
const EXAMPLES = ['How much did we spend on rent last year?', 'Sales in March 2026', 'Electricity for Property 5 this year'];

/**
 * Ask the books (DA-03): a question in words, the filters it was read as (accounts, label, dates),
 * each one changeable, and the answer calculated by the server from the full history with the same
 * code as "explain this number" (N-12): posted entries only, in the workspace's currency, under your
 * own access. The entries behind the answer are listed and open their documents. The reading is
 * plain matching (src/lib/askBooks.ts); nothing here makes up a figure.
 */
export default function AskBooksView() {
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const accounts = useLedgerStore(s => s.accounts);
  const nodes = useLedgerStore(s => s.dimensionNodes);
  const openRecord = useUIStore(s => s.openRecord);
  const [question, setQuestion] = useState('');
  const [reading, setReading] = useState<AskReading | null>(null);
  const [filter, setFilter] = useState<AskFilter | null>(null);
  const [result, setResult] = useState<{ key: string; data?: Explanation; error?: string } | null>(null);
  const currency = workspace?.currency || 'USD';
  const live = useMemo(() => (accounts || []).filter(a => !a.isArchived).sort((a, b) => a.name.localeCompare(b.name)), [accounts]);
  const dimensions = workspace?.dimensions || [];

  const ask = (text: string) => {
    const r = readQuestion(text, { accounts: live, dimensions, nodes: nodes || [], today: getLocalDateISO(), fiscalYearStartMonth: workspace?.fiscalYearStartMonth });
    setQuestion(text);
    setReading(r);
    setFilter(r.filter);
  };

  const key = workspace && filter && filter.accountIds.length > 0 && filter.startDate <= filter.endDate
    ? new URLSearchParams({
      workspaceId: workspace.id, accountIds: filter.accountIds.join(','), startDate: filter.startDate, endDate: filter.endDate,
      ...(filter.label ? { labelDimension: filter.label.dimensionId, labelValue: filter.label.value } : {}),
    }).toString()
    : '';
  useEffect(() => {
    if (!key) return;
    let on = true;
    (async () => {
      // the answer is only usable when it carries its lines; that check stays as `parse`, so a
      // server answering something else keeps failing here rather than at the render
      return runCommand({
        path: `/api/v1/reports/explain?${key}`,
        parse: (raw): Explanation => {
          const body = raw as Explanation;
          if (!Array.isArray(body.lines)) throw new ServerCommandError(200, 'The answer could not be calculated');
          return body;
        },
      });
    })().then(data => { if (on) setResult({ key, data }); }).catch(err => { if (on) setResult({ key, error: err instanceof Error ? err.message : String(err) }); });
    return () => { on = false; };
  }, [key]);
  const shown = result && result.key === key ? result : null;

  const toggleAccount = (id: string, on: boolean) => setFilter(f => f && ({ ...f, accountIds: on ? [...f.accountIds, id] : f.accountIds.filter(x => x !== id) }));
  const sense = reading?.sense || 'net';
  const named = new Map(live.map(a => [a.id, a.name]));
  // the accounts are still the ones read from the question (so they are said as read)
  const asRead = Boolean(filter && reading?.filter && filter.accountIds.length === reading.filter.accountIds.length && reading.filter.accountIds.every(id => filter.accountIds.includes(id)));

  return (
    <section aria-labelledby="ask-books-title" className="space-y-4">
      <div>
        <h2 id="ask-books-title" className="text-lg font-bold text-[var(--text)] flex items-center gap-2"><MessageSquareText className="w-5 h-5" aria-hidden="true" /> Ask the books</h2>
        <p className="text-sm text-[var(--muted)]">Ask about an account, a label and a period. You see how the question was read and can change it; the figure is calculated from all your posted entries, and the entries behind it are listed.</p>
      </div>
      <form className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); if (question.trim()) ask(question); }}>
        <label className="sr-only" htmlFor="ask-books-question">Your question</label>
        <input id="ask-books-question" value={question} onChange={e => setQuestion(e.target.value)} placeholder={EXAMPLES[0]} className={`${field} flex-1 min-w-[16rem]`} />
        <button type="submit" disabled={!question.trim()} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">Ask</button>
      </form>
      {!reading && (
        <p className="text-xs text-[var(--muted)]">For example: {EXAMPLES.map((ex, i) => (
          <React.Fragment key={ex}>{i > 0 && ' · '}<button type="button" className="text-indigo-600 dark:text-indigo-400 hover:underline" onClick={() => ask(ex)}>{ex}</button></React.Fragment>
        ))}</p>
      )}
      {reading && (
        <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 space-y-3 text-sm">
          <h3 className="font-semibold text-[var(--text)]">Read as</h3>
          {reading.problem && <p role="status" className="text-xs text-amber-700 dark:text-amber-400">{reading.problem}.</p>}
          <dl className="grid gap-2 sm:grid-cols-[8rem_1fr]">
            <dt className="text-[var(--muted)]">Accounts</dt>
            <dd>
              <details>
                <summary className="cursor-pointer text-[var(--text)]">
                  {!filter || filter.accountIds.length === 0 ? 'None yet: choose them'
                    : asRead ? reading.understood.accounts.join(', ') : filter.accountIds.map(id => named.get(id) || id).join(', ')}
                  {filter && filter.accountIds.length > 1 && <span className="text-[var(--muted)]"> ({filter.accountIds.length} accounts)</span>}
                </summary>
                <div role="group" aria-label="Accounts asked about" className="mt-2 grid max-h-48 gap-1 overflow-y-auto sm:grid-cols-2">
                  {live.map(a => (
                    <label key={a.id} className="flex items-center gap-2 text-xs text-[var(--text)]">
                      <input type="checkbox" checked={Boolean(filter?.accountIds.includes(a.id))}
                        onChange={e => (filter ? toggleAccount(a.id, e.target.checked) : setFilter({ accountIds: [a.id], startDate: `${getLocalDateISO().slice(0, 4)}-01-01`, endDate: getLocalDateISO() }))} />
                      <bdi>{a.name}</bdi>
                    </label>
                  ))}
                </div>
              </details>
            </dd>
            <dt className="text-[var(--muted)]">Label</dt>
            <dd>
              <label className="sr-only" htmlFor="ask-books-label">Label</label>
              <select id="ask-books-label" className={field} disabled={!filter}
                value={filter?.label ? `${filter.label.dimensionId}\u0000${filter.label.value}` : ''}
                onChange={e => setFilter(f => {
                  if (!f) return f;
                  const [dimensionId, value] = e.target.value.split('\u0000');
                  const { label: _old, ...rest } = f;
                  return e.target.value ? { ...rest, label: { dimensionId, value } } : rest;
                })}>
                <option value="">Any (no label)</option>
                {dimensions.map(d => (
                  <optgroup key={d.id} label={d.name}>
                    {(nodes || []).filter(n => n.dimensionId === d.id && n.status !== 'archived').map(n => (
                      <option key={n.id} value={`${d.id}\u0000${n.id}`}>{n.description || n.id}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </dd>
            <dt className="text-[var(--muted)]">Period</dt>
            <dd className="flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor="ask-books-from">From</label>
              <input id="ask-books-from" type="date" className={field} disabled={!filter} value={filter?.startDate || ''} onChange={e => setFilter(f => f && ({ ...f, startDate: e.target.value }))} />
              <span aria-hidden="true">–</span>
              <label className="sr-only" htmlFor="ask-books-to">To</label>
              <input id="ask-books-to" type="date" className={field} disabled={!filter} value={filter?.endDate || ''} onChange={e => setFilter(f => f && ({ ...f, endDate: e.target.value }))} />
              {filter && reading.filter && filter.startDate === reading.filter.startDate && filter.endDate === reading.filter.endDate && <span className="text-xs text-[var(--muted)]">{reading.understood.period}</span>}
            </dd>
          </dl>
          <p className="text-xs text-[var(--muted)]">Posted entries only · in {currency} · from the full history, under your own access.</p>
        </div>
      )}
      {filter && filter.startDate > filter.endDate && <p role="status" className="text-xs text-amber-700 dark:text-amber-400">The period starts after it ends.</p>}
      {key && !shown && <p className="text-sm text-[var(--muted)]">Calculating…</p>}
      {shown?.error && <p role="alert" className="text-sm text-rose-600">{shown.error}</p>}
      {shown?.data && shown.data.lines.length === 0 && <ReportEmptyState title="No posted entries match this question"
        description="Clear a filter, widen the period, or choose an account with posted activity. A draft or an unposted document is not included in this answer." />}
      {shown?.data && (
        <div className="space-y-2">
          <p className="text-2xl font-bold text-[var(--text)]" aria-live="polite">
            {formatCurrency(answerCents(shown.data.totalCents, sense), currency)}
            <span className="ml-2 text-sm font-normal text-[var(--muted)]">{sense === 'spent' ? 'spent' : sense === 'earned' ? 'earned' : 'net (debits less credits)'} · {shown.data.entries} entr{shown.data.entries === 1 ? 'y' : 'ies'}</span>
          </p>
          {shown.data.lines.length > 0 && (
            <table className="w-full text-sm">
              <caption className="sr-only">The entries behind the answer</caption>
              <thead>
                <tr className="text-xs text-[var(--muted)] border-b border-[var(--line)]">
                  <th scope="col" className="text-left font-semibold py-1">Date</th>
                  <th scope="col" className="text-left font-semibold py-1">Entry</th>
                  <th scope="col" className="text-right font-semibold py-1">Amount</th>
                </tr>
              </thead>
              <tbody>
                {shown.data.lines.map(l => (
                  <tr key={l.key} className="border-b border-[var(--line)]/50">
                    <td className="py-1 font-mono text-xs">{l.date ? formatDate(l.date) : ''}</td>
                    <td className="py-1">
                      {l.document ? (
                        <button type="button" className="text-left text-indigo-600 dark:text-indigo-400 hover:underline" onClick={() => openRecord({ type: l.document!.type, id: l.document!.id })}>
                          <bdi>{l.description || l.payee || 'Entry'}</bdi><span className="sr-only"> (open the {l.document.type === 'transaction' ? 'entry' : l.document.type})</span>
                        </button>
                      ) : <bdi>{l.description}</bdi>}
                      <span className="block text-[10px] text-[var(--muted)]"><bdi>{l.accountName}</bdi>{l.bankMatched ? ' · matched to the bank' : ''}{l.attachments > 0 ? ` · ${l.attachments} file${l.attachments === 1 ? '' : 's'}` : ''}</span>
                    </td>
                    <td className="py-1 text-right font-mono">{formatCurrency(answerCents(l.amountCents, sense), currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
}
