import { useEffect, useMemo, useState } from 'react';
import { getIdToken } from '../firebase';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { workspaceScope } from '../lib/serverAction';
import { assetRegisterReport, type AssetRegisterReport } from '../lib/assetRegisterReport';
import { rangeRevision } from '../lib/serverTopLines';
import { useLedgerCollections } from './useLedgerCollections';

const inWorkspace = <T extends { workspaceId?: string }>(list: readonly T[] | undefined, workspaceId: string) =>
  (list || []).filter(a => !workspaceId || a.workspaceId === workspaceId);

/**
 * L-123 step 4c: the fixed-asset register as of `asOf`. When the loaded assets or entries are capped, assets or posted
 * depreciation runs may be missing from the browser, so the register comes from the server
 * (GET /api/v1/balances/asset-register). Otherwise, and until it answers or when it cannot be reached, the loaded
 * lists' register, as before. `source` says which. Null while `enabled` is false (loading, or an invalid date).
 */
export function useServerAssetRegister(asOf: string, enabled: boolean): (AssetRegisterReport & { source: 'loaded' | 'server' | 'loaded-incomplete' }) | null {
  useLedgerCollections('assets');
  const workspaceId = useAuthStore(s => s.currentWorkspaceId) || '';
  const assets = useLedgerStore(s => s.assets);
  const transactions = useLedgerStore(s => s.transactions);
  const accounts = useLedgerStore(s => s.accounts);
  const capped = useLedgerStore(s => Boolean(s.truncatedCollections?.assets || s.truncatedCollections?.transactions || s.truncatedCollections?.chartAccounts));
  const needed = enabled && capped && !!workspaceId;
  // any edit to a loaded entry, asset or account (all register inputs, so whole) changes the server's register too
  const revision = useMemo(() => (needed ? `${rangeRevision(transactions || [], '')}.${JSON.stringify(assets || [])}.${JSON.stringify(accounts || [])}` : ''),
    [needed, transactions, assets, accounts]);
  const key = needed ? `${workspaceId}|${asOf}|${revision}` : '';
  const [answer, setAnswer] = useState<{ key: string; server: (AssetRegisterReport & { workspaceId: string }) | null } | null>(null);

  useEffect(() => {
    if (!key) return;
    const scope = workspaceScope(() => useAuthStore.getState().currentWorkspaceId);
    let live = true;
    (async () => {
      const query = new URLSearchParams({ workspaceId, asOf }).toString();
      const res = await fetch(`/api/v1/balances/asset-register?${query}`, { headers: { Authorization: `Bearer ${await getIdToken()}` } });
      const body = await res.json().catch(() => ({})) as Partial<AssetRegisterReport>;
      if (!res.ok || !Array.isArray(body.rows) || !Array.isArray(body.categories) || !body.totals) throw new Error(`asset register ${res.status}`);
      return { workspaceId, rows: body.rows, categories: body.categories, totals: body.totals, historicalChanges: Number(body.historicalChanges) || 0 };
    })().then(server => {
      if (live && scope.isCurrent()) setAnswer({ key, server });
    }).catch(() => {
      // best-effort: without the server's answer the screen keeps the loaded lists' register and says it may be short
      if (live && scope.isCurrent()) setAnswer({ key, server: null });
    });
    return () => { live = false; };
  }, [key, workspaceId, asOf]);

  const server = key && answer?.key === key ? answer.server : null;
  return useMemo(() => {
    if (!enabled) return null;
    if (server && server.workspaceId === workspaceId) return { rows: server.rows, categories: server.categories, totals: server.totals, historicalChanges: server.historicalChanges, source: 'server' as const };
    const own = assetRegisterReport(inWorkspace(assets, workspaceId), inWorkspace(accounts, workspaceId), inWorkspace(transactions, workspaceId), asOf);
    return { ...own, source: capped ? 'loaded-incomplete' as const : 'loaded' as const };
  }, [enabled, server, workspaceId, assets, accounts, transactions, asOf, capped]);
}
