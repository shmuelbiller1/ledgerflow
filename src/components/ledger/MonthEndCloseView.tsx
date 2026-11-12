import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, ArrowRight, BookOpen, CheckCircle2, Circle, Lock, LockOpen, ShieldCheck, Undo2, XCircle } from 'lucide-react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useUIStore } from '../../stores/useUIStore';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { db, getIdToken } from '../../firebase';
import { collection, doc, getDoc, getDocs, limit, query, where } from '../../lib/db/firestore';
import { cn, formatCurrency, getLocalDateISO } from '../../lib/utils';
import { downloadWorkbook, createWorkbook } from '../../lib/excelExport';
import { buildCloseChecklist, postingMismatchesThrough, readyToClose } from '../../lib/closeChecklist';
import { useEntityOperations } from '../../hooks/useEntityOperations';
import type { CloseItem } from '../../lib/closeChecklist';
import { monthCloseState, monthEnd } from '../../lib/periodLock';
import type { AppTab, PeriodStatus, Workspace } from '../../types';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import CloseComparisonPanel from './CloseComparisonPanel';
import WorkpapersPanel from './WorkpapersPanel';
import ClosingBalanceCheck from './ClosingBalanceCheck';
import CloseStepsEditor from './CloseStepsEditor';
import CloseJourneyPanel from './CloseJourneyPanel';
import PeriodClosingPanel from './PeriodClosingPanel';
import { closeStepItems } from '../../lib/closeSteps';
import { closePackageSheets } from '../../lib/closePackage';
import { computeNoTouchRate } from '../../lib/practiceAutomation';
import type { ClientQuery } from '../../lib/clientQueries';
import { byCodeUnit } from '../../lib/codeUnitOrder';

/**
 * Month-End Close (R-01 checklist, R-02 sign-offs, R-03 soft/hard close, R-08 drafts, R-10 roles,
 * BA-15 partial unlock). The checklist is src/lib/closeChecklist.ts; closing, reopening and
 * unlocking go through the server (src/server/services/periodCloseService.ts), which checks the
 * role, refuses drafts in the period and writes the audit log.
 */

const ITEM_TABS: Record<CloseItem['id'], string> = {
  drafts: 'ledger',
  categorize: 'ledger',
  reconcile: 'reconciliation',
  'trial-balance': 'reports',
  anomalies: 'audit-trail',
  aging: 'reports',
  depreciation: 'assets',
  postings: 'month-end-close',
};

const STATE_LABEL = {
  open: { text: 'Open', tone: 'text-[var(--muted)]' },
  soft: { text: 'Soft-closed: only owners and accountants can post', tone: 'text-amber-600' },
  hard: { text: 'Closed: nobody can post', tone: 'text-[var(--pos)]' },
  'partly-open': { text: 'Closed, with dates unlocked', tone: 'text-amber-600' },
} as const;

function previousMonth(today: string): string {
  const [y, m] = today.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const token = await getIdToken();
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || data.error || 'The request failed') as Error & { details?: unknown };
    err.details = data.details;
    throw err;
  }
  return data as T;
}


// #643: the four document kinds the posting check covers, where each is saved (saving re-posts it) and what it is called
const MISMATCH_COLLECTION = { invoice: 'invoices', bill: 'bills', 'credit-note': 'creditNotes', 'vendor-credit': 'vendorCredits' } as const;
const MISMATCH_LABEL = { invoice: 'Invoice', bill: 'Bill', 'credit-note': 'Credit note', 'vendor-credit': 'Vendor credit' } as const;
export default function MonthEndCloseView() {
  const transactions = useLedgerStore(s => s.transactions);
  const accounts = useLedgerStore(s => s.accounts);
  const bankLines = useLedgerStore(s => s.bankLines);
  const invoices = useLedgerStore(s => s.invoices);
  const bills = useLedgerStore(s => s.bills);
  const creditNotes = useLedgerStore(s => s.creditNotes);
  const vendorCredits = useLedgerStore(s => s.vendorCredits);
  const journalEntries = useLedgerStore(s => s.journalEntries);
  const assets = useLedgerStore(s => s.assets);
  const { loading: collectionsLoading } = useLedgerCollections('assets', 'bankLines', 'bills', 'creditNotes', 'invoices', 'vendorCredits');
  const workspaces = useAuthStore(s => s.workspaces) || [];
  const setWorkspaces = useAuthStore(s => s.setWorkspaces);
  const workspaceId = useAuthStore(s => s.currentWorkspaceId) || '';
  const setActiveTab = useUIStore(s => s.setActiveTab);
  const { updateEntity } = useEntityOperations();
  const role = useCurrentRole();
  const canClose = role === 'owner' || role === 'accountant';
  const canSign = canClose || role === 'bookkeeper';

  const workspace = workspaces.find(w => w.id === workspaceId);
  const [month, setMonth] = useState(() => previousMonth(getLocalDateISO()));
  const [period, setPeriod] = useState<PeriodStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [blockedDrafts, setBlockedDrafts] = useState<Array<{ collection: string; id: string; date: string; label: string }>>([]);
  const [reopenReason, setReopenReason] = useState('');
  const [unlock, setUnlock] = useState({ fromDate: '', toDate: '', reason: '' });

  useEffect(() => {
    let cancelled = false;
    if (!workspaceId) return;
    getDoc(doc(db, 'periods', `${workspaceId}_${month}`))
      .then(snap => { if (!cancelled) setPeriod(snap.exists() ? ({ id: snap.id, ...snap.data() } as PeriodStatus) : null); })
      .catch(() => { if (!cancelled) setPeriod(null); });
    return () => { cancelled = true; };
  }, [workspaceId, month]);

  const baseCurrency = workspace?.currency;
  const items = useMemo(() => buildCloseChecklist({
    month, baseCurrency, transactions: transactions || [], bankLines: bankLines || [], invoices: invoices || [], bills: bills || [], creditNotes: creditNotes || [], vendorCredits: vendorCredits || [], journalEntries: journalEntries || [], assets: assets || [],
  }), [month, baseCurrency, transactions, bankLines, invoices, bills, creditNotes, vendorCredits, journalEntries, assets]);
  const mismatches = useMemo(() => postingMismatchesThrough({ invoices: invoices || [], bills: bills || [], creditNotes: creditNotes || [], vendorCredits: vendorCredits || [], transactions: transactions || [], baseCurrency }, monthEnd(month)), [invoices, bills, creditNotes, vendorCredits, transactions, baseCurrency, month]);
  const stepItems = useMemo(() => closeStepItems(workspace?.closeSteps, month, workspace?.fiscalYearStartMonth || 1), [workspace?.closeSteps, workspace?.fiscalYearStartMonth, month]);
  const signOffs = period?.signOffs || {};
  const readiness = readyToClose([...items, ...stepItems], signOffs);
  const state = monthCloseState(month, workspace);
  const end = monthEnd(month);
  const isFutureMonth = end > getLocalDateISO();
  const fiscalEndMonth = ((workspace?.fiscalYearStartMonth || 1) + 10) % 12 + 1;
  const isFiscalYearEnd = Number(month.slice(5, 7)) === fiscalEndMonth;
  const lockException = workspace?.lockException;

  const patchWorkspace = (fields: Partial<Workspace>) => setWorkspaces(workspaces.map(w => (w.id === workspaceId ? { ...w, ...fields } : w)));
  const base = `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/periods`;

  const run = async <T,>(work: () => Promise<T>, success: string, after?: (result: T) => void) => {
    setBusy(true);
    setBlockedDrafts([]);
    try {
      const result = await work();
      after?.(result);
      toast.success(success);
    } catch (err) {
      const details = (err as { details?: unknown }).details;
      if (Array.isArray(details) && details.every(d => typeof (d as { collection?: unknown })?.collection === 'string')) setBlockedDrafts(details);
      toast.error(err instanceof Error ? err.message : 'That did not work');
    } finally {
      setBusy(false);
    }
  };

  const close = (mode: 'soft' | 'hard') => run(
    () => post<{ lockDate: string | null; softLockDate: string }>(`${base}/${month}/close`, { mode }),
    mode === 'hard' ? `${month} is closed.` : `${month} is soft-closed.`,
    r => {
      patchWorkspace({ lockDate: r.lockDate, softLockDate: r.softLockDate, ...(lockException && lockException.fromDate <= end ? { lockException: null } : {}) });
      setPeriod(p => ({ ...(p || { id: `${workspaceId}_${month}`, uid: '', workspaceId, periodId: month, startDate: `${month}-01`, endDate: end }), status: mode === 'hard' ? 'closed' : 'soft_closed', closeMode: mode }));
    },
  );

  const reopen = () => run(
    () => post<{ lockDate: string | null; softLockDate: string | null }>(`${base}/${month}/reopen`, { reason: reopenReason }),
    `${month} is open again.`,
    r => { patchWorkspace({ lockDate: r.lockDate, softLockDate: r.softLockDate }); setReopenReason(''); },
  );

  const sign = (itemId: string, remove: boolean) => run(
    () => post<{ signOffs: PeriodStatus['signOffs'] }>(`${base}/${month}/sign-off`, { itemId, remove }),
    remove ? 'Sign-off removed.' : 'Signed off.',
    r => setPeriod(p => ({ ...(p || { id: `${workspaceId}_${month}`, uid: '', workspaceId, periodId: month, status: 'open', startDate: `${month}-01`, endDate: end }), signOffs: r.signOffs })),
  );

  const doUnlock = () => run(
    () => post<{ lockException: Workspace['lockException'] }>(`${base}/unlock`, unlock),
    'Dates unlocked.',
    r => { patchWorkspace({ lockException: r.lockException }); setUnlock({ fromDate: '', toDate: '', reason: '' }); },
  );

  const relock = () => run(() => post(`${base}/relock`, {}), 'Closed again.', () => patchWorkspace({ lockException: null }));

  // Reposting reverses what the ledger has for the document and posts it again from the document
  // (LedgerPostService), which fixes missing, doubled, left-over and wrong-amount entries.
  const repost = async (items: typeof mismatches) => {
    setBusy(true);
    let done = 0;
    for (const m of items) {
      try {
        await updateEntity(MISMATCH_COLLECTION[m.kind], m.id, {});
        done++;
      } catch (err) {
        toast.error(`${MISMATCH_LABEL[m.kind]} ${m.number}: ${err instanceof Error ? err.message : 'could not be reposted'}`);
      }
    }
    setBusy(false);
    if (done) toast.success(`Reposted ${done} document${done === 1 ? '' : 's'}.`);
  };

  // CA-07: closing the year records it (and its profit) without posting an entry; the balance
  // sheet carries the profit in retained earnings by itself
  const postYearEnd = () => run(
    () => post<{ message?: string }>('/api/v1/transactions/close-year', { workspaceId, closingDate: end, lockPeriod: false }),
    'Year closed: its profit stays in retained earnings on the balance sheet.',
  );

  const exportPackage = async () => {
    const toastId = toast.loading('Building the close package…');
    try {
      // R-11: the month's questions about entries go in too (read once, not kept live here)
      const queries = workspaceId
        ? (await getDocs(query(collection(db, 'clientQueries'), where('workspaceId', '==', workspaceId), limit(2000)))).docs.map(d => ({ ...(d.data() as Omit<ClientQuery, 'id'>), id: d.id }))
        : [];
      const sheets = closePackageSheets({
        month, monthEnd: end, state: STATE_LABEL[state].text,
        closedThrough: [workspace?.lockDate || '', workspace?.softLockDate || ''].sort(byCodeUnit).pop() || '',
        items: [...items, ...stepItems], signOffs, accounts: accounts || [], transactions: transactions || [], queries,
      });
      const workbook = await createWorkbook();
      for (const sheet of sheets) {
        const ws = workbook.addWorksheet(sheet.name);
        ws.columns = sheet.columns.map(c => ({ header: c.header, key: c.key, width: c.width, ...(c.money ? { style: { numFmt: '#,##0.00' } } : {}) }));
        for (const row of sheet.rows) ws.addRow(row);
      }
      await downloadWorkbook(workbook, `Close_Package_${month}.xlsx`);
      toast.success('Close package downloaded.', { id: toastId });
    } catch (err) {
      toast.error(`The package could not be built: ${err instanceof Error ? err.message : String(err)}`, { id: toastId });
    }
  };

  const doneCount = items.filter(i => i.status === 'done' || signOffs[i.id]).length + stepItems.filter(i => signOffs[i.id]).length;
  const noTouchMonth = useMemo(() => computeNoTouchRate((bankLines || []) as never, transactions || [], month), [bankLines, transactions, month]);
  const monthLabel = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });

  return (
    <div className="h-full overflow-auto p-6 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold text-[var(--text)] flex items-center gap-3">
              <ShieldCheck className="w-6 h-6 text-[var(--pos)]" aria-hidden="true" /> Month-End Close
            </h1>
            <p className="text-sm text-[var(--muted)] mt-1">Check the month, sign off what was reviewed, then close it.</p>
          </div>
          <div className="flex items-end gap-3">
            <div>
              <label htmlFor="close-month" className="block text-xs font-semibold text-[var(--muted)] mb-1">Month</label>
              <input id="close-month" type="month" value={month} onChange={e => e.target.value && setMonth(e.target.value)}
                className="px-3 py-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] text-sm text-[var(--text)]" />
            </div>
            <button type="button" onClick={exportPackage} className="px-3 py-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] text-sm text-[var(--text)] inline-flex items-center gap-2">
              <BookOpen className="w-4 h-4" aria-hidden="true" /> Close package (.xlsx)
            </button>
          </div>
        </div>

        <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] overflow-hidden" aria-labelledby="close-status">
          <div className="p-5 border-b border-[var(--line)] flex items-center justify-between gap-4 flex-wrap bg-[var(--panel)]">
            <div>
              <h2 id="close-status" className="text-lg font-medium text-[var(--text)]">{monthLabel}</h2>
              <p className={cn('text-sm font-medium mt-1 inline-flex items-center gap-1.5', STATE_LABEL[state].tone)}>
                {state === 'open' ? <LockOpen className="w-4 h-4" aria-hidden="true" /> : <Lock className="w-4 h-4" aria-hidden="true" />}
                {STATE_LABEL[state].text}
              </p>
              <p className="text-xs text-[var(--muted)] mt-1">
                {workspace?.lockDate ? `Closed through ${workspace.lockDate}` : 'Nothing is closed'}
                {workspace?.softLockDate && workspace.softLockDate > (workspace.lockDate || '') ? ` · soft-closed through ${workspace.softLockDate}` : ''}
                {lockException ? ` · unlocked ${lockException.fromDate} to ${lockException.toDate}` : ''}
                {noTouchMonth.ratePercent !== null ? ` · No-touch bank rate: ${noTouchMonth.ratePercent}% (${noTouchMonth.noTouchCount}/${noTouchMonth.totalBankLines})` : ''}
              </p>
            </div>
            <div className="text-sm text-[var(--muted)]">{doneCount} of {items.length + stepItems.length} checked</div>
          </div>

          <ul className="divide-y divide-[var(--line)]">
            {items.map(item => {
              const signed = signOffs[item.id];
              return (
                <li key={item.id} className="p-4 flex items-start gap-3">
                  <span className="mt-0.5" aria-hidden="true">
                    {item.status === 'done' || signed ? <CheckCircle2 className="w-5 h-5 text-[var(--pos)]" />
                      : item.status === 'blocker' ? <XCircle className="w-5 h-5 text-[var(--neg)]" />
                      : item.count ? <AlertTriangle className="w-5 h-5 text-amber-500" /> : <Circle className="w-5 h-5 text-[var(--muted)]" />}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-[var(--text)]">{item.title}</p>
                    <p className={cn('text-sm mt-0.5', item.status === 'blocker' ? 'text-[var(--neg)]' : 'text-[var(--muted)]')}>{item.detail}</p>
                    {signed && <p className="text-xs text-[var(--muted)] mt-1">Signed off by {signed.by} on {signed.at.slice(0, 10)}{signed.note ? `: ${signed.note}` : ''}</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {item.status !== 'done' && item.id !== 'postings' && (
                      <button type="button" onClick={() => setActiveTab(ITEM_TABS[item.id] as AppTab)} className="text-xs font-semibold text-[var(--brass)] hover:underline inline-flex items-center gap-1">
                        Open <ArrowRight className="w-3 h-3" aria-hidden="true" />
                      </button>
                    )}
                    {item.status === 'attention' && canSign && state !== 'hard' && (
                      <button type="button" disabled={busy} onClick={() => sign(item.id, !!signed)}
                        className="text-xs font-semibold px-2.5 py-1 rounded-lg border border-[var(--line)] text-[var(--text)] disabled:opacity-50">
                        {signed ? 'Remove sign-off' : 'Sign off'}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
            {stepItems.map(item => {
              const signed = signOffs[item.id];
              return (
                <li key={item.id} className="p-4 flex items-start gap-3">
                  <span className="mt-0.5" aria-hidden="true">
                    {signed ? <CheckCircle2 className="w-5 h-5 text-[var(--pos)]" /> : <Circle className="w-5 h-5 text-[var(--muted)]" />}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-[var(--text)]"><bdi>{item.title}</bdi></p>
                    <p className="text-sm mt-0.5 text-[var(--muted)]">{item.detail}</p>
                    {signed && <p className="text-xs text-[var(--muted)] mt-1">Signed off by {signed.by} on {signed.at.slice(0, 10)}{signed.note ? `: ${signed.note}` : ''}</p>}
                  </div>
                  {canSign && state !== 'hard' && (
                    <button type="button" disabled={busy} onClick={() => sign(item.id, !!signed)} aria-label={`${signed ? 'Remove sign-off' : 'Sign off'}: ${item.title}`}
                      className="shrink-0 text-xs font-semibold px-2.5 py-1 rounded-lg border border-[var(--line)] text-[var(--text)] disabled:opacity-50">
                      {signed ? 'Remove sign-off' : 'Sign off'}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>

          {canClose && workspace && (
            <CloseStepsEditor workspace={workspace} workspaces={workspaces} onSaved={closeSteps => patchWorkspace({ closeSteps })} />
          )}

          {mismatches.length > 0 && (
            <div className="p-4 border-t border-[var(--line)] space-y-2">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-sm font-medium text-[var(--text)]">Documents to repost</p>
                {canSign && (
                  <button type="button" disabled={busy} onClick={() => repost(mismatches)} className="px-3 py-1.5 rounded-lg border border-[var(--line)] text-xs font-semibold text-[var(--text)] disabled:opacity-50">
                    Repost all ({mismatches.length})
                  </button>
                )}
              </div>
              <ul className="divide-y divide-[var(--line)] text-sm">
                {mismatches.slice(0, 50).map(m => (
                  <li key={`${m.kind}:${m.id}`} className="py-2 flex items-center justify-between gap-3">
                    <span className="text-[var(--text)]">
                      {MISMATCH_LABEL[m.kind]} {m.number}{m.party ? ` · ${m.party}` : ''}
                      <span className="block text-xs text-[var(--muted)]">{m.detail}{m.issue === 'amount' ? ` (document ${formatCurrency(m.expectedCents)}, ledger ${formatCurrency(m.postedCents)})` : ''}</span>
                    </span>
                    {canSign && (
                      <button type="button" disabled={busy} onClick={() => repost([m])} className="text-xs font-semibold text-[var(--brass)] hover:underline disabled:opacity-50">Repost</button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {blockedDrafts.length > 0 && (
            <div className="p-4 border-t border-[var(--line)] text-sm text-[var(--text)]" role="alert">
              <p className="font-medium text-[var(--neg)]">Drafts dated in the period being closed:</p>
              <ul className="mt-1 list-disc pl-5 text-[var(--muted)]">
                {blockedDrafts.map(d => <li key={`${d.collection}:${d.id}`}>{d.label} ({d.collection}, {d.date})</li>)}
              </ul>
            </div>
          )}

          <div className="p-5 border-t border-[var(--line)] space-y-4">
            {!canClose ? (
              <p className="text-sm text-[var(--muted)]">Owners and accountants close and reopen periods. You can sign off the items you reviewed.</p>
            ) : state === 'open' ? (
              <div className="space-y-2">
                {!readiness.ready && <p className="text-sm text-[var(--muted)]">{readiness.reason}</p>}
                {collectionsLoading && <p className="text-sm text-[var(--muted)]">Loading invoices, bills and credits before the month can be closed…</p>}
                {isFutureMonth && <p className="text-sm text-[var(--muted)]">This month hasn't ended yet.</p>}
                <div className="flex gap-3 flex-wrap">
                  <button type="button" disabled={busy || collectionsLoading || isFutureMonth || items.some(i => i.status === 'blocker')} onClick={() => close('soft')}
                    className="px-4 py-2 rounded-lg border border-[var(--line)] bg-[var(--panel)] text-sm font-semibold text-[var(--text)] disabled:opacity-50">
                    Soft close (accountants can still adjust)
                  </button>
                  <button type="button" disabled={busy || collectionsLoading || isFutureMonth || !readiness.ready} onClick={() => close('hard')}
                    className="px-4 py-2 rounded-lg bg-[var(--brass)] text-[var(--ink)] text-sm font-bold disabled:opacity-50 inline-flex items-center gap-2">
                    <Lock className="w-4 h-4" aria-hidden="true" /> Close {month}
                  </button>
                  {isFiscalYearEnd && role === 'owner' && (
                    <button type="button" disabled={busy || isFutureMonth} onClick={postYearEnd}
                      className="px-4 py-2 rounded-lg border border-[var(--line)] text-sm font-semibold text-[var(--text)] disabled:opacity-50">
                      Record the year as closed
                    </button>
                  )}
                </div>
                <p className="text-xs text-[var(--muted)]">Closing a month also closes every month before it.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {state === 'soft' && (
                  <button type="button" disabled={busy || collectionsLoading || !readiness.ready} onClick={() => close('hard')}
                    className="px-4 py-2 rounded-lg bg-[var(--brass)] text-[var(--ink)] text-sm font-bold disabled:opacity-50 inline-flex items-center gap-2">
                    <Lock className="w-4 h-4" aria-hidden="true" /> Close for good
                  </button>
                )}
                <div className="flex items-end gap-2 flex-wrap">
                  <div className="flex-1 min-w-[16rem]">
                    <label htmlFor="reopen-reason" className="block text-xs font-semibold text-[var(--muted)] mb-1">Reason for reopening</label>
                    <input id="reopen-reason" value={reopenReason} onChange={e => setReopenReason(e.target.value)} placeholder="e.g. a supplier bill arrived late"
                      className="w-full px-3 py-2 rounded-lg border border-[var(--line)] bg-[var(--panel)] text-sm text-[var(--text)]" />
                  </div>
                  <button type="button" disabled={busy || reopenReason.trim().length < 5 || (state !== 'soft' && role !== 'owner')} onClick={reopen}
                    className="px-4 py-2 rounded-lg border border-[var(--line)] text-sm font-semibold text-[var(--text)] disabled:opacity-50 inline-flex items-center gap-2"
                    title={state !== 'soft' && role !== 'owner' ? 'Only the owner can reopen a closed month' : undefined}>
                    <Undo2 className="w-4 h-4" aria-hidden="true" /> Reopen {month} and later months
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* A-151: the month's path in order, read-only; signing off and closing stay above. */}
        <CloseJourneyPanel month={month} state={state} items={items} accounts={accounts} bankLines={bankLines}
          invoices={invoices} bills={bills} journalEntries={journalEntries} currency={workspace?.currency || 'USD'} />

        {/* EG-3: the closing document of each closed year, every version, read-only and printable */}
        <PeriodClosingPanel key={`${workspace?.lockDate || ''}`} workspaceId={workspaceId} currency={workspace?.currency} onOpenMonth={setMonth} />

        {/* CA-06: a closed month's balances now, against the snapshot taken when it was closed */}
        {state !== 'open' && (
          <ClosingBalanceCheck key={`${month}-${period?.status || ''}-${period?.closeMode || ''}`} workspaceId={workspaceId} month={month} currency={workspace?.currency} />
        )}

        {/* R-09: this month beside the month before and the same month last year, read-only. */}
        <CloseComparisonPanel month={month} currency={workspace?.currency} />

        {/* BD-04: per account and month, the balance at month end, a note, files and a review mark. */}
        <WorkpapersPanel month={month} currency={workspace?.currency} />

        {canClose && (workspace?.lockDate || workspace?.softLockDate) && (
          <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 space-y-3" aria-labelledby="partial-unlock">
            <h2 id="partial-unlock" className="text-sm font-semibold text-[var(--text)]">Unlock a few dates</h2>
            <p className="text-xs text-[var(--muted)]">Open a date range inside the closed period (for example to fix one entry) without reopening whole months. Close it again when done.</p>
            {lockException ? (
              <div className="flex items-center justify-between gap-3 flex-wrap text-sm text-[var(--text)]">
                <span>Unlocked {lockException.fromDate} to {lockException.toDate}{lockException.reason ? `: ${lockException.reason}` : ''}</span>
                <button type="button" disabled={busy} onClick={relock} className="px-3 py-1.5 rounded-lg bg-[var(--brass)] text-[var(--ink)] text-xs font-bold disabled:opacity-50">Close again</button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-end">
                <div>
                  <label htmlFor="unlock-from" className="block text-xs font-semibold text-[var(--muted)] mb-1">From</label>
                  <input id="unlock-from" type="date" value={unlock.fromDate} onChange={e => setUnlock({ ...unlock, fromDate: e.target.value })} className="w-full px-2 py-1.5 rounded-lg border border-[var(--line)] bg-[var(--panel)] text-sm text-[var(--text)]" />
                </div>
                <div>
                  <label htmlFor="unlock-to" className="block text-xs font-semibold text-[var(--muted)] mb-1">To</label>
                  <input id="unlock-to" type="date" value={unlock.toDate} onChange={e => setUnlock({ ...unlock, toDate: e.target.value })} className="w-full px-2 py-1.5 rounded-lg border border-[var(--line)] bg-[var(--panel)] text-sm text-[var(--text)]" />
                </div>
                <div>
                  <label htmlFor="unlock-reason" className="block text-xs font-semibold text-[var(--muted)] mb-1">Reason</label>
                  <input id="unlock-reason" value={unlock.reason} onChange={e => setUnlock({ ...unlock, reason: e.target.value })} className="w-full px-2 py-1.5 rounded-lg border border-[var(--line)] bg-[var(--panel)] text-sm text-[var(--text)]" />
                </div>
                <button type="button" disabled={busy || !unlock.fromDate || !unlock.toDate || unlock.reason.trim().length < 5} onClick={doUnlock}
                  className="px-3 py-2 rounded-lg border border-[var(--line)] text-sm font-semibold text-[var(--text)] disabled:opacity-50">Unlock</button>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
