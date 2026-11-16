import { fill, useReportText } from './useReportText';
import { budgetLabel } from '../../lib/budgetByLabel';
import { useMemo, useRef, useState } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { usePageSyncedState } from '../../hooks/usePageSyncedState';
import { useServerOperationalReport, collectionStamp } from '../../hooks/useServerOperationalReport';
import { computeBudgetActual, type SavedBudget } from '../../lib/budgetActual';
import { splitReportPeriods } from '../../lib/reportColumns';
import { collection, getDocs, query, where } from '../../lib/db/firestore';
import { db } from '../../firebase';
import type { ChartAccount, Transaction } from '../../types';
import { formatCurrency } from '../../lib/utils';
import { Labelled } from '../ui/Labelled';
import DrillDownModal, { type ExplainRequest } from '../layout/DrillDownModal';
import { isDebitNatureType } from '../../lib/accountUtils';
import { RowTable } from '../ui/RowTable';

type History = { key: string; budgets: SavedBudget[]; accounts: ChartAccount[]; transactions: Transaction[] };
export default function BudgetActualReportView({ selectedYear = new Date().getFullYear(), startDate, endDate }: { selectedYear?: number; startDate?: string; endDate?: string }) {
  const reportText = useReportText();
  useLedgerCollections('budgets');
  const cachedBudgets = useLedgerStore(s => s.budgets);
  const cachedAccounts = useLedgerStore(s => s.accounts);
  const cachedTransactions = useLedgerStore(s => s.transactions);
  const truncatedTx = useLedgerStore(s => Boolean(s.truncatedCollections?.transactions));
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const user = useAuthStore(s => s.user);
  const guest = useAuthStore(s => s.isGuest);
  const from = startDate || `${selectedYear}-01-01`;
  const to = endDate || `${selectedYear}-12-31`;
  const key = JSON.stringify([workspaceId, user?.uid, from, to]);
  const [history, setHistory] = useState<History | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<{key: string; message: string} | null>(null);
  const [selection, setSelection] = usePageSyncedState(key, '', '');
  const [mode, setMode] = useState<'total' | 'months'>('total');
  const [drill, setDrill] = useState<{ key: string; name: string; transactions: Transaction[]; explain?: ExplainRequest } | null>(null);
  const current = history?.key === key ? history : null;
  const baUrl = workspaceId ? `/api/v1/reports/budget-actual-periods?${new URLSearchParams({ workspaceId, startDate: from, endDate: to, mode, ...(selection ? { budgetId: selection } : {}) })}` : '';
  const activeServer = useServerOperationalReport<{ budgets: SavedBudget[]; report: ReturnType<typeof computeBudgetActual> }>(
    truncatedTx && !current && !guest && Boolean(workspaceId),
    baUrl,
    `${key}:${mode}:${selection}:${collectionStamp(cachedBudgets, cachedAccounts, cachedTransactions)}`,
    body => ('report' in body ? { budgets: Array.isArray(body.budgets) ? (body.budgets as SavedBudget[]) : cachedBudgets, report: body.report as ReturnType<typeof computeBudgetActual> } : undefined),
  );
  // EU-E5: label budgets are compared in Profit by Label; this report is account-wide.
  const budgets = useMemo(() => (current?.budgets || activeServer?.budgets || cachedBudgets).filter(b => !budgetLabel(b)), [current, activeServer, cachedBudgets]);
  const accounts = current?.accounts || cachedAccounts;
  const transactions = current?.transactions || cachedTransactions;
  const budget = budgets.find(b => b.id === selection) || budgets.find(b => b.targetType === 'account');
  const periods = useMemo(() => splitReportPeriods(from, to, mode), [from, to, mode]);
  const localReport = useMemo(() => budget ? computeBudgetActual(budget, accounts, transactions, periods) : null, [budget, accounts, transactions, periods]);
  const report = (!current && activeServer) ? activeServer.report : localReport;
  const pending = useRef(false);
  async function load() {
    if (!workspaceId || pending.current) return;
    pending.current = true;
    setBusyKey(key); setError(null);
    try {
      const snapshots = await Promise.all(['budgets', 'chartAccounts', 'transactions'].map(name => getDocs(query(collection(db, name), where('workspaceId', '==', workspaceId)))));
      if (useAuthStore.getState().currentWorkspaceId !== workspaceId || useAuthStore.getState().user?.uid !== user?.uid) return;
      const rows = snapshots.map(snap => snap.docs.map(document => ({ ...document.data(), id: document.id })));
      setHistory({ key, budgets: rows[0] as SavedBudget[], accounts: rows[1] as ChartAccount[], transactions: rows[2] as Transaction[] });
    } catch { setError({ key, message: 'Could not load complete history. Retry; the figures below remain provisional.' }); }
    finally { pending.current = false; setBusyKey(previous => previous === key ? null : previous); }
  }
  return <section aria-label={reportText('r.budget-vs-actual', 'Budget vs Actual')} className="space-y-4 p-4 max-w-full">
    <h2 className="text-xl font-bold">{reportText('r.budget-vs-actual', 'Budget vs Actual')}</h2>
    <p>{reportText('r.posted-account-movement-for', 'Posted account movement for ')}{from} {reportText('r.through', 'through ')}{to}{reportText('r.difference-is-budget-less-actual-openings-are-ex', '. Difference is budget less actual; openings are excluded.')}</p>
    <p className="text-sm text-[var(--muted)]">{reportText('r.recurring-caps-are-spread-evenly-across-their-mo', 'Recurring caps are spread evenly across their months, with remainder cents in the final month. Partial months retain a full monthly cap. Credits reduce actuals; unsupported category/project or ambiguous account targets require an account budget.')}</p>
    <div className="flex flex-wrap gap-4">
      <Labelled label={reportText('r.budget', 'Budget')}><select className="min-h-11" value={budget?.id || ''} onChange={event => setSelection(event.target.value)}>{budgets.filter(b => b.targetType === 'account').map(b => <option key={b.id} value={b.id}>{(b as SavedBudget).name || b.targetId} · {b.period}</option>)}</select></Labelled>
      <Labelled label={reportText('r.columns', 'Columns')}><select className="min-h-11" value={mode} onChange={event => setMode(event.target.value as 'total' | 'months')}><option value="total">{reportText('r.total', 'Total')}</option><option value="months">{reportText('r.months', 'Months')}</option></select></Labelled>
      {!guest && <button type="button" className="btn-secondary min-h-11" disabled={busyKey === key || !workspaceId} onClick={() => void load()}>{busyKey === key ? reportText('r.loading', 'Loading…') : reportText('r.load-refresh-full-history', 'Load / refresh full history')}</button>}
    </div>
    {!current && !activeServer && <p role="status">{guest ? reportText('r.guest-sample-figures-use-the-loaded-demonstratio', 'Guest sample: figures use the loaded demonstration records.') : reportText('r.provisional-loaded-records-may-be-incomplete-loa', 'Provisional: loaded records may be incomplete. Load full history before relying on these figures.')}</p>}
    {error?.key === key && <p role="alert">{error.message}</p>}
    {!budget ? <p>No saved account budgets. Define an account target in Planning → Budgets.</p> : !report ? <p>Choose a budget with one unambiguous chart account.</p> : <div className="overflow-x-auto" role="region" aria-label={reportText('r.budget-vs-actual-figures', 'Budget vs actual figures')} tabIndex={0}>{/* NOSONAR: S6845 — tabIndex on scrollable region is the intentional axe scrollable-region-focusable pattern */}<RowTable
      caption={(<>{report.account.code} · {report.account.name}</>)}
      rows={report.columns}
      rowKey={column => column.period.id}
      captionClassName="text-left"
      tableClassName="w-full text-right"
      headRowClassName=""
      bodyClassName=""
      columns={[
        { header: "Period", className: "p-3", headClassName: "p-3", cell: (column) => column.period.label },
        { header: "Budget", className: "p-3", headClassName: "p-3", cell: (column) => formatCurrency(column.budgetCents) },
        { header: "Actual", headClassName: "p-3", cell: (column) => <button type="button" className="min-h-11 px-3 underline tabular-nums" aria-label={fill(reportText('r.budget-drill', '{amount}: entries for {account}, {period}'), { amount: formatCurrency(column.actualCents), account: report.account.name, period: column.period.label })} onClick={() => setDrill({ key, name: report.account.name, transactions: column.drillTransactions, explain: { accountIds: [report.account.id], startDate: column.period.startDate, endDate: column.period.endDate, expectedCents: column.actualCents, sign: isDebitNatureType(report.account.type) ? 1 : -1, label: column.period.label } })}>{formatCurrency(column.actualCents)}</button> },
        { header: "Difference", className: "p-3", headClassName: "p-3", cell: (column) => formatCurrency(column.differenceCents) },
        { header: "% used", className: "p-3", headClassName: "p-3", cell: (column) => column.percentUsed === null ? '—' : `${column.percentUsed.toFixed(1)}%` },
      ]}
    /></div>}
    <DrillDownModal key={key} isOpen={drill?.key === key} onClose={() => setDrill(null)} accountName={drill?.name || ''} transactions={drill?.key === key ? drill.transactions : []} explain={drill?.key === key ? drill.explain : undefined} formatCurrency={formatCurrency} from="Budget vs Actual" />
  </section>;
}
