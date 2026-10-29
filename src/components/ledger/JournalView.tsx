import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Copy, Undo2 } from 'lucide-react';
import { JournalEntry } from '../../types';
import { getLocalDateISO } from '../../lib/utils';
import { EmptyState } from '../ui/EmptyState';

/** A journal entry as the list shows it: what kind it is and how it relates to reversals. */
export type JournalListEntry = JournalEntry & {
  /** 'journal' for one typed in by hand; documents, payments and runs have their own */
  kind?: string;
  isReversal?: boolean;
  reversedBy?: string;
  autoReverseOn?: string;
  /** an accountant's adjusting entry (BD-03) */
  adjusting?: boolean;
};

interface JournalViewProps {
  journalEntries: JournalListEntry[];
  formatCurrency: (val: number) => string;
  canEdit?: boolean;
  onReverse?: (entry: JournalListEntry, date: string, reason: string) => Promise<unknown> | unknown;
  onDuplicate?: (entry: JournalListEntry) => void;
  /** opens the journal-entry form — the empty list's "Add your first journal entry" action (A-262) */
  onAddEntry?: () => void;
}

const PAGE = 200;

/** Stable keys for an entry's lines: account and amounts, numbered when the same line repeats. */
function keyedLines<L extends { accountId: string; debit: number; credit: number }>(lines: L[]): Array<{ line: L; key: string }> {
  const seen = new Map<string, number>();
  return lines.map(line => {
    const base = `${line.accountId}|${line.debit}|${line.credit}`;
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return { line, key: `${base}|${n}` };
  });
}

/**
 * The general journal (K-05): every entry, newest first, or only the ones typed in by hand. Each
 * opens to its lines; a manual entry can be reversed (a mirror entry on the chosen day, through the
 * server) or duplicated into a new entry. Totals are what the list shows — nothing else is claimed.
 */
export default function JournalView({ journalEntries = [], formatCurrency, canEdit = false, onReverse, onDuplicate, onAddEntry }: JournalViewProps) {
  const [manualOnly, setManualOnly] = useState(true);
  const [adjustingOnly, setAdjustingOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [reversing, setReversing] = useState<string | null>(null);
  const [reverseOn, setReverseOn] = useState(getLocalDateISO());
  const [reason, setReason] = useState('');
  const [shown, setShown] = useState(PAGE);

  const entries = useMemo(() => {
    const q = search.trim().toLowerCase();
    return journalEntries
      .filter(e => !manualOnly || e.kind === 'journal')
      .filter(e => !adjustingOnly || e.adjusting)
      .filter(e => !q || [e.description, e.reference, ...e.lines.map(l => l.accountName)].some(t => String(t || '').toLowerCase().includes(q)))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }, [journalEntries, manualOnly, adjustingOnly, search]);
  const debits = (e: JournalListEntry) => e.lines.reduce((sum, l) => sum + (l.debit || 0), 0);
  const total = entries.reduce((sum, e) => sum + debits(e), 0);

  return (
    <section aria-labelledby="journal-title" className="bg-[var(--surface)] border border-[var(--line)] rounded-xl overflow-hidden flex-1 flex flex-col">
      <div className="p-4 border-b border-[var(--line)] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-[var(--ink)]">
        <div>
          <h2 id="journal-title" className="text-sm font-bold text-[var(--text)]">General journal</h2>
          <p className="text-xs text-[var(--muted)]">{entries.length} {entries.length === 1 ? 'entry' : 'entries'} · {formatCurrency(total)} in debits</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={manualOnly} onChange={e => { setManualOnly(e.target.checked); setShown(PAGE); }} />
            Entries typed in by hand only
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={adjustingOnly} onChange={e => { setAdjustingOnly(e.target.checked); setShown(PAGE); }} />
            Adjusting entries only
          </label>
          <label className="flex items-center gap-1.5">
            <span className="sr-only">Search the journal</span>
            <input type="search" value={search} onChange={e => { setSearch(e.target.value); setShown(PAGE); }} placeholder="Search description, reference, account"
              className="px-2 py-1 border border-[var(--line)] rounded bg-[var(--panel)] min-w-[14rem]" />
          </label>
        </div>
      </div>

      {entries.length === 0 ? (
        <EmptyState
          title={manualOnly ? 'No journal entries typed in by hand yet' : 'No entries match'}
          description={manualOnly
            ? 'Adjustments you type yourself — accruals, corrections, openings — are listed here once added.'
            : 'Choose another search or filter, or widen the list with the filters above.'}
          actionLabel={manualOnly && canEdit && onAddEntry ? 'Add your first journal entry' : undefined}
          onAction={manualOnly && canEdit ? onAddEntry : undefined}
        />
      ) : (
        <ul className="divide-y divide-[var(--line)]">
          {entries.slice(0, shown).map(e => {
            const isOpen = open === e.id;
            const canReverse = canEdit && e.kind === 'journal' && !e.isReversal && !e.reversedBy && Boolean(onReverse);
            return (
              <li key={e.id} className="text-sm">
                <div className="flex items-center gap-3 px-4 py-2">
                  <button type="button" onClick={() => setOpen(isOpen ? null : e.id)} aria-expanded={isOpen}
                    aria-label={`${isOpen ? 'Hide' : 'Show'} the lines of ${e.description || 'the entry'} on ${e.date}`}
                    className="p-0.5 text-[var(--muted)] hover:text-[var(--text)]">
                    {isOpen ? <ChevronDown className="w-4 h-4" aria-hidden="true" /> : <ChevronRight className="w-4 h-4" aria-hidden="true" />}
                  </button>
                  <span className="font-mono text-xs text-[var(--muted)] w-24 shrink-0">{String(e.date).slice(0, 10)}</span>
                  <span className="flex-1 min-w-0 truncate text-[var(--text)]">
                    {e.description || 'Journal entry'}
                    {e.reference && e.reference !== e.id && <span className="text-[var(--muted)]"> · {e.reference}</span>}
                    {e.adjusting && <span className="ml-2 text-[10px] font-semibold text-indigo-700 dark:text-indigo-400">adjusting</span>}
                    {e.isReversal && <span className="ml-2 text-[10px] font-semibold text-amber-700 dark:text-amber-400">a reversal</span>}
                    {e.reversedBy && <span className="ml-2 text-[10px] font-semibold text-[var(--muted)]">reversed</span>}
                    {e.autoReverseOn && !e.reversedBy && <span className="ml-2 text-[10px] font-semibold text-[var(--muted)]">reverses on {e.autoReverseOn}</span>}
                  </span>
                  <span className="font-mono font-semibold tabular-nums">{formatCurrency(debits(e))}</span>
                  {canEdit && e.kind === 'journal' && onDuplicate && (
                    <button type="button" onClick={() => onDuplicate(e)} title="A new entry with the same lines" aria-label={`Duplicate ${e.description || 'the entry'} of ${e.date}`}
                      className="p-1 text-[var(--muted)] hover:text-[var(--text)]"><Copy className="w-4 h-4" aria-hidden="true" /></button>
                  )}
                  {canReverse && (
                    <button type="button" onClick={() => { setReversing(e.id); setReverseOn(getLocalDateISO()); setReason(''); }} title="Undo it with a mirror entry"
                      aria-label={`Reverse ${e.description || 'the entry'} of ${e.date}`} className="p-1 text-[var(--muted)] hover:text-amber-700"><Undo2 className="w-4 h-4" aria-hidden="true" /></button>
                  )}
                </div>
                {reversing === e.id && (
                  <div className="px-4 pb-3 pl-12 flex flex-wrap items-center gap-2 text-xs">
                    <label className="flex items-center gap-1">Reverse on
                      <input type="date" value={reverseOn} min={String(e.date).slice(0, 10)} onChange={ev => setReverseOn(ev.target.value)} className="px-2 py-1 border border-[var(--line)] rounded bg-[var(--panel)]" />
                    </label>
                    <label className="flex items-center gap-1">Why
                      <input value={reason} onChange={ev => setReason(ev.target.value)} placeholder="Entered twice" className="px-2 py-1 border border-[var(--line)] rounded bg-[var(--panel)]" />
                    </label>
                    <button type="button" disabled={!reason.trim() || reverseOn < String(e.date).slice(0, 10)}
                      onClick={async () => { await onReverse?.(e, reverseOn, reason.trim()); setReversing(null); }}
                      className="px-2 py-1 rounded bg-amber-600 text-white font-semibold disabled:opacity-50">Reverse it</button>
                    <button type="button" onClick={() => setReversing(null)} className="text-[var(--muted)] hover:underline">Cancel</button>
                  </div>
                )}
                {isOpen && (
                  <table className="ml-12 mr-4 mb-3 text-xs w-[calc(100%-4rem)]">
                    <caption className="sr-only">Lines of {e.description || 'the entry'}</caption>
                    <thead><tr className="text-[var(--muted)]"><th scope="col" className="text-left font-semibold">Account</th><th scope="col" className="text-right font-semibold">Debit</th><th scope="col" className="text-right font-semibold">Credit</th></tr></thead>
                    <tbody>
                      {keyedLines(e.lines).map(({ line: l, key }) => (
                        <tr key={key}>
                          <td className="py-0.5">{l.accountName || l.accountId}</td>
                          <td className="text-right font-mono">{l.debit ? formatCurrency(l.debit) : ''}</td>
                          <td className="text-right font-mono">{l.credit ? formatCurrency(l.credit) : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {entries.length > shown && (
        <button type="button" onClick={() => setShown(n => n + PAGE)} className="m-3 self-center text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">
          Show {Math.min(PAGE, entries.length - shown)} more of {entries.length - shown}
        </button>
      )}
    </section>
  );
}
