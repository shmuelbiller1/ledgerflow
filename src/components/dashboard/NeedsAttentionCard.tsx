import { runCommand } from '../../lib/runCommand';
import React, { useEffect, useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { useRefreshTick } from '../../hooks/useRefreshTick';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useUIStore } from '../../stores/useUIStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { runDataChecks } from '../../lib/dataChecks';
import { needsAttention } from '../../lib/needsAttention';
import { getLocalDateISO } from '../../lib/utils';
import { useClientQueries } from '../../services/clientQueryActions';
import { useCollection } from '../../hooks/useCollection';
import { db } from '../../firebase';
import { doc, getDoc } from '../../lib/db/firestore';
import { readBankStatuses, type BankStatus } from '../../lib/bankFeedStatus';
import type { PurchaseOrder } from '../../types';
import { TASK_KIND, type Task } from '../../lib/tasks';

/**
 * Needs attention (DA-02) at the top of the Overview: one row per kind of thing to do, with how
 * many, why and who can resolve it; each opens the exact place (the record itself when there is one). Worked out from the books each
 * time (src/lib/needsAttention.ts), so a row goes only when its cause has gone. Nothing to do: it
 * says so in one line.
 */
export default function NeedsAttentionCard() {
  const transactions = useLedgerStore(s => s.transactions);
  const accounts = useLedgerStore(s => s.accounts);
  const invoices = useLedgerStore(s => s.invoices);
  const bills = useLedgerStore(s => s.bills);
  const recurring = useLedgerStore(s => s.recurring);
  const inventory = useLedgerStore(s => s.inventory);
  const bankLines = useLedgerStore(s => s.bankLines);
  const payRuns = useLedgerStore(s => s.payRuns);
  const { loading } = useLedgerCollections('bankLines', 'bills', 'inventory', 'invoices', 'payRuns', 'recurring');
  const { data: purchaseOrders } = useCollection<PurchaseOrder>('purchaseOrders', { where: [{ field: 'status', op: '==', value: 'pending_approval' }], limit: 200 });
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  // BG-03: open tasks given to whoever is looking
  const uid = useAuthStore(s => s.user?.uid) || '';
  const { data: myTasks } = useCollection<Task>('documents', { where: [{ field: 'kind', op: '==', value: TASK_KIND }, { field: 'assignee', op: '==', value: uid }, { field: 'status', op: '==', value: 'open' }], limit: 200 });
  const goToPage = useUIStore(s => s.goToPage);
  const openRecord = useUIStore(s => s.openRecord);
  const { queries } = useClientQueries(workspace?.id);
  // bank connections whose login expired; none connected, or the server can't say: no row
  const workspaceId = workspace?.id;
  const [banks, setBanks] = useState<BankStatus[]>([]);
  // BC-04: read again when the tab comes back into view, and every 5 minutes
  const tick = useRefreshTick();
  useEffect(() => {
    if (!workspaceId) return;
    let live = true;
    (async () => {
      // a failed read means nothing to report on this card, not a broken dashboard
      const answer = await runCommand<unknown>({ path: `/api/v1/plaid/banks?workspaceId=${encodeURIComponent(workspaceId)}` }).catch(() => null);
      if (!answer) return [];
      return readBankStatuses(answer);
    })().then(list => { if (live) setBanks(list); }).catch(() => { if (live) setBanks([]); });
    return () => { live = false; };
  }, [workspaceId, tick]);
  // last month's sign-offs, for the workspace's own close steps left (only when it has some)
  const hasSteps = Boolean(workspace?.closeSteps?.length);
  const [signOffs, setSignOffs] = useState<Record<string, unknown> | undefined>(undefined);
  useEffect(() => {
    if (!workspaceId || !hasSteps) return;
    const [y, m] = getLocalDateISO().split('-').map(Number);
    const lastMonth = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
    let live = true;
    getDoc(doc(db, 'periods', `${workspaceId}_${lastMonth}`))
      .then(snap => { if (live) setSignOffs((snap.exists() ? snap.data()?.signOffs : null) || {}); })
      .catch(() => { if (live) setSignOffs(undefined); });
    return () => { live = false; };
  }, [workspaceId, hasSteps, tick]);

  const rows = useMemo(() => {
    if (!workspace) return [];
    const today = getLocalDateISO();
    const findings = runDataChecks({
      transactions: transactions || [], accounts: accounts || [], invoices: invoices || [], bills: bills || [], recurring: recurring || [],
      inventory: inventory || [], bankLines: bankLines || [], today, baseCurrency: workspace.currency || 'USD', dimensions: workspace.dimensions,
    });
    const closeByDay = (workspace.alerts as { closeReminderDay?: number | null } | undefined)?.closeReminderDay || undefined;
    return needsAttention({ today, workspace, bankLines: bankLines || [], invoices: invoices || [], findings, closeByDay, questions: queries, payRuns: payRuns || [], purchaseOrders, banks, lastMonthSignOffs: hasSteps ? signOffs : undefined, myTasks });
  }, [workspace, transactions, accounts, invoices, bills, recurring, inventory, bankLines, queries, payRuns, purchaseOrders, banks, hasSteps, signOffs, myTasks]);

  if (loading || !workspace) return null;
  return (
    <section aria-labelledby="needs-attention-title" className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
      <h2 id="needs-attention-title" className="text-sm font-bold text-[var(--text)]">Needs attention</h2>
      {rows.length === 0 ? (
        <p className="mt-1 text-sm text-[var(--muted)]">Nothing waiting: the bank is matched and connected, nothing waits for approval and the books have no problems.</p>
      ) : (
        <ul className="mt-2 divide-y divide-[var(--line)]">
          {rows.map(row => (
            <li key={row.id}>
              <button type="button" onClick={() => (row.record ? openRecord(row.record) : goToPage(row.page))} className="w-full flex items-center justify-between gap-3 py-2 text-start hover:bg-[var(--elevated)] rounded">
                <span>
                  <span className="block text-sm font-semibold text-[var(--text)]">{row.text}</span>
                  <span className="block text-xs text-[var(--muted)]">{row.why} For {row.who}.</span>
                </span>
                <ChevronRight aria-hidden="true" size={16} className="shrink-0 text-[var(--muted)] rtl:rotate-180" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
