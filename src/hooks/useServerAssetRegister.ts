import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { workspaceScope } from '../lib/serverAction';
import { getBalances } from '../lib/balancesApi';
import { assetRegisterReport, type AssetRegisterReport } from '../lib/assetRegisterReport';
import { depreciationLedger, type DepreciationLedgerRow } from '../lib/depreciationLedger';
import { rangeRevision } from '../lib/serverTopLines';
import { useLedgerCollections } from './useLedgerCollections';
import type { ChartAccount, FixedAsset, Transaction } from '../types';

type Source = 'loaded' | 'server' | 'loaded-incomplete';
const inWorkspace = <T extends { workspaceId?: string }>(list: readonly T[] | undefined, workspaceId: string) =>
  (list || []).filter(a => !workspaceId || a.workspaceId === workspaceId);

/**
 * L-123 step 4c/4h: a report over the workspace's fixed assets and posted depreciation runs. When the loaded assets,
 * entries or accounts are capped, assets or runs may be missing from the browser, so the report comes from the server
 * (GET `/api/v1/balances/<path>`). Otherwise, and until it answers or when it cannot be reached, `compute` over the
 * loaded lists, as before (each report keeps its own workspace rule). `source` says which. Null while `enabled` is
 * false (loading, or an invalid date). `compute` and `parse` must keep their identity (module functions or useCallback).
 */
function useServerAssetReport<T extends object>(path: string, query: Record<string, string>, enabled: boolean,
  compute: (assets: FixedAsset[], accounts: ChartAccount[], transactions: Transaction[], workspaceId: string) => T,
  parse: (body: Record<string, unknown>) => T | null): (T & { source: Source }) | null {
  useLedgerCollections('assets');
  const workspaceId = useAuthStore(s => s.currentWorkspaceId) || '';
  const assets = useLedgerStore(s => s.assets);
  const transactions = useLedgerStore(s => s.transactions);
  const accounts = useLedgerStore(s => s.accounts);
  const capped = useLedgerStore(s => Boolean(s.truncatedCollections?.assets || s.truncatedCollections?.transactions || s.truncatedCollections?.chartAccounts));
  const needed = enabled && capped && !!workspaceId;
  // any edit to a loaded entry, asset or account (all report inputs, so whole) changes the server's report too
  const revision = useMemo(() => (needed ? `${rangeRevision(transactions || [], '')}.${JSON.stringify(assets || [])}.${JSON.stringify(accounts || [])}` : ''),
    [needed, transactions, assets, accounts]);
  const queryText = new URLSearchParams(query).toString();
  const key = needed ? `${workspaceId}|${path}|${queryText}|${revision}` : '';
  const [answer, setAnswer] = useState<{ key: string; workspaceId: string; report: T | null } | null>(null);

  useEffect(() => {
    if (!key) return;
    const scope = workspaceScope(() => useAuthStore.getState().currentWorkspaceId);
    let live = true;
    (async () => {
      const body = await getBalances<Record<string, unknown>>(path, { workspaceId, ...Object.fromEntries(new URLSearchParams(queryText)) }, b => parse(b as Record<string, unknown>) !== null);
      return parse(body);
    })().then(report => {
      if (live && scope.isCurrent()) setAnswer({ key, workspaceId, report });
    }).catch(() => {
      // best-effort: without the server's answer the screen keeps the loaded lists' report and says it may be short
      if (live && scope.isCurrent()) setAnswer({ key, workspaceId, report: null });
    });
    return () => { live = false; };
  }, [key, workspaceId, path, queryText, parse]);

  const server = key && answer?.key === key && answer.workspaceId === workspaceId ? answer.report : null;
  return useMemo(() => {
    if (!enabled) return null;
    if (server) return { ...server, source: 'server' as const };
    const own = compute(assets || [], accounts || [], transactions || [], workspaceId);
    return { ...own, source: capped ? 'loaded-incomplete' as const : 'loaded' as const };
  }, [enabled, server, workspaceId, assets, accounts, transactions, capped, compute]);
}

const parseRegister = (b: Record<string, unknown>): AssetRegisterReport | null => (Array.isArray(b.rows) && Array.isArray(b.categories) && b.totals
  ? { rows: b.rows, categories: b.categories, totals: b.totals, historicalChanges: Number(b.historicalChanges) || 0 } as AssetRegisterReport
  : null);

/** L-123 step 4c: the fixed-asset register as of `asOf` (GET /api/v1/balances/asset-register when capped). */
export function useServerAssetRegister(asOf: string, enabled: boolean): (AssetRegisterReport & { source: Source }) | null {
  // the register keeps the workspace's own records only, as before step 4h
  const compute = useCallback((assets: FixedAsset[], accounts: ChartAccount[], transactions: Transaction[], workspaceId: string) =>
    assetRegisterReport(inWorkspace(assets, workspaceId), inWorkspace(accounts, workspaceId), inWorkspace(transactions, workspaceId), asOf), [asOf]);
  return useServerAssetReport('asset-register', useMemo(() => ({ asOf }), [asOf]), enabled, compute, parseRegister);
}

const parseLedger = (b: Record<string, unknown>): { rows: DepreciationLedgerRow[] } | null => (Array.isArray(b.rows) ? { rows: b.rows as DepreciationLedgerRow[] } : null);

/**
 * L-123 step 4h: the depreciation ledger over `from`…`to` (GET /api/v1/balances/depreciation-ledger when capped). The
 * depreciation before the period needs every earlier run, which a capped list may not hold.
 */
export function useServerDepreciationLedger(from: string, to: string, enabled: boolean): { rows: DepreciationLedgerRow[]; source: Source } | null {
  const compute = useCallback((assets: FixedAsset[], _accounts: ChartAccount[], transactions: Transaction[]) => ({ rows: depreciationLedger(assets, transactions, from, to) }), [from, to]);
  return useServerAssetReport('depreciation-ledger', useMemo(() => ({ from, to }), [from, to]), enabled, compute, parseLedger);
}
