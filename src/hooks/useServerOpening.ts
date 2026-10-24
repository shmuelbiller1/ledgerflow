import { useEffect, useMemo, useState } from 'react';
import { getIdToken } from '../firebase';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { workspaceScope } from '../lib/serverAction';
import { openingCutoff, type ServerOpening } from '../lib/serverBalances';
import type { Transaction } from '../types';

/**
 * L-123 step 3: the server's account balances through the oldest loaded day (src/lib/serverBalances.ts), read again
 * when the workspace, that day or the number of loaded entries changes. Null until it arrives, when nothing is
 * loaded, or when the server cannot be reached: the screen then sums the loaded entries alone, as before.
 */
export function useServerOpening(transactions: Transaction[]): ServerOpening | null {
  const workspaceId = useAuthStore(s => s.currentWorkspaceId) || '';
  const asOf = useMemo(() => openingCutoff(transactions || []), [transactions]);
  const count = (transactions || []).length;
  const key = workspaceId && asOf ? `${workspaceId}|${asOf}|${count}` : '';
  const [answer, setAnswer] = useState<{ key: string; opening: ServerOpening | null } | null>(null);

  useEffect(() => {
    if (!key) return;
    const scope = workspaceScope(() => useAuthStore.getState().currentWorkspaceId);
    let live = true;
    (async () => {
      const query = new URLSearchParams({ workspaceId, asOf }).toString();
      const res = await fetch(`/api/v1/balances?${query}`, { headers: { Authorization: `Bearer ${await getIdToken()}` } });
      const body = await res.json().catch(() => ({})) as { accounts?: Record<string, number> };
      if (!res.ok || !body.accounts || typeof body.accounts !== 'object') throw new Error(`balances ${res.status}`);
      return { workspaceId, asOf, accounts: body.accounts };
    })().then(opening => {
      if (live && scope.isCurrent()) setAnswer({ key, opening });
    }).catch(() => {
      // best-effort: without the server's answer the screen keeps the loaded entries' sums (and says so)
      if (live && scope.isCurrent()) setAnswer({ key, opening: null });
    });
    return () => { live = false; };
  }, [key, workspaceId, asOf]);

  return answer && answer.key === key ? answer.opening : null;
}

/**
 * L-123 step 3b: mounted once (RootLayout), it keeps useLedgerStore.serverOpening on the server's answer for the
 * loaded entries, so computedAccounts and every screen that reads it show the server's balances.
 */
export function useServerOpeningSync(): void {
  const transactions = useLedgerStore(s => s.transactions);
  const opening = useServerOpening(transactions);
  useEffect(() => { useLedgerStore.getState().setServerOpening(opening); }, [opening]);
}
