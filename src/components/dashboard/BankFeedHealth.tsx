import React, { useEffect, useState } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import PlaidConnectButton from '../finance/PlaidConnectButton';

import { readBankStatuses } from '../../lib/bankFeedStatus';
import type { BankStatus } from '../../lib/bankFeedStatus';
import { runCommand, type CommandBody } from '../../lib/runCommand';
export default function BankFeedHealth() {
  const uid = useAuthStore(state => state.user?.uid), workspaceId = useAuthStore(state => state.currentWorkspaceId);
  const [refresh, setRefresh] = useState(0);
  return <><button type="button" onClick={() => setRefresh(value => value + 1)} className="min-h-11 underline">Refresh connection status</button><ConnectionStatus key={`${uid}:${workspaceId}:${refresh}`} /></>;
}
function ConnectionStatus() {
  const uid = useAuthStore(state => state.user?.uid), workspaceId = useAuthStore(state => state.currentWorkspaceId);
  const activeWorkspaceId = useAuthStore(state => state.getCurrentWorkspace()?.id);
  const role = useCurrentRole();
  const [result, setResult] = useState<{ banks?: BankStatus[]; error?: string }>({});
  useEffect(() => {
    if (!uid || !workspaceId || activeWorkspaceId !== workspaceId) return;
    let cancelled = false;
    const controller = new AbortController();
    (async () => {
      if (cancelled) return;
      const banks = readBankStatuses(await runCommand<CommandBody>({
        path: `/api/v1/plaid/banks?workspaceId=${encodeURIComponent(workspaceId)}`,
        signal: controller.signal,
      }));
      if (!cancelled) setResult({ banks });
    })().catch(error => { if (!cancelled) setResult({ error: error instanceof Error ? error.message : 'Could not read bank status.' }); });
    return () => { cancelled = true; controller.abort(); };
  }, [uid, workspaceId, activeWorkspaceId]);
  if (!uid) return <p>Sign in to see live bank connection status. Demo data is not a live feed.</p>;
  if (!workspaceId || activeWorkspaceId !== workspaceId) return <p>Select a workspace to see its bank connections.</p>;
  if (result.error) return <p role="alert">{result.error}</p>;
  if (!result.banks) return <p role="status">Loading connection status…</p>;
  return <><p className="text-sm text-[var(--muted)]">Connection status alone does not prove a fresh feed.</p>
    {result.banks.length === 0 ? <p>No connected banks.</p> : <ul className="space-y-3">{result.banks.map(bank => <li key={bank.id} className="flex flex-wrap items-center justify-between gap-2"><bdi>{bank.institutionName}</bdi><span>{bank.status === 'login_required' ? 'Login expired' : bank.status === 'active' ? 'Active connection' : bank.status}</span><span>Last successful sync: {bank.lastSyncedAt === undefined ? 'not provided by the current server.' : bank.lastSyncedAt === null ? 'Never successfully synced.' : <time dateTime={bank.lastSyncedAt}>{new Date(bank.lastSyncedAt).toLocaleString('en-US', { timeZoneName: 'short' })}</time>}</span>{bank.status === 'login_required' && role !== 'viewer' && <PlaidConnectButton bankId={bank.id} label="Reconnect" />}</li>)}</ul>}
  </>;
}
