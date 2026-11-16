import { runCommand, commandErrorMessage } from '../../lib/runCommand';
import { useUIStore } from '../../stores/useUIStore';
import { translateScreenString } from '../../lib/i18n/screenTranslations';
import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useAuthStore } from '../../stores/useAuthStore';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { bankHealth, readBankStatuses, type BankStatus, type SyncLogEntry } from '../../lib/bankFeedStatus';
import PlaidConnectButton from '../finance/PlaidConnectButton';
import { LoadingState } from '../ui/LoadingState';

const tone = { ok: 'text-[var(--muted)]', behind: 'text-amber-700 dark:text-amber-400', action: 'text-rose-600' } as const;

/**
 * The workspace's bank connections on Bank Connections: each with its health (Z-28: connected, behind,
 * or needing someone) and last good sync, its sync history (Z-29: the last attempts and what came of
 * each), "Reconnect" when its login expired, and "Disconnect" for owners and accountants (Z-30): the
 * bank is told to stop and the stored connection is removed; the bank lines already imported stay.
 */
export default function ConnectedBanks() {
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const language = useUIStore(st => st.language);
  const bankText = (key: string, fallback: string) => translateScreenString('banking', key, language, fallback);
  const resultText = (r: SyncLogEntry['result']) =>
    r === 'ok' ? bankText('sync.ok', 'Synced') : r === 'login_required' ? bankText('sync.loginRequired', 'Login expired') : bankText('sync.error', 'Failed');
  // a demo has no database and no connections to ask the server about
  const isGuest = useAuthStore(s => s.isGuest && !s.user);
  const role = useCurrentRole();
  // no database (a demo) means no connections to ask about: the screen stays quiet
  const noServer = isGuest || !workspaceId;
  const [read, setRead] = useState<{ workspace: string; state: 'loading' | 'ready' | 'error'; banks: BankStatus[]; error: string }>({ workspace: '', state: 'loading', banks: [], error: '' });
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState('');
  const [now] = useState(() => Date.now());
  useEffect(() => {
    if (noServer || !workspaceId) return;
    const ws = workspaceId;
    let live = true;
    (async () => {
      try {
        return readBankStatuses(await runCommand({ path: `/api/v1/plaid/banks?workspaceId=${encodeURIComponent(ws)}` }));
      } catch (err) {
        // a failed read keeps this screen's own sentence, which names what failed, rather than the
        // server's status code; the original error is kept so nothing about it is lost
        throw new Error('The server could not list your bank connections', { cause: err });
      }
    })().then(list => { if (live) setRead({ workspace: ws, state: 'ready', banks: list, error: '' }); }).catch(err => {
      // a read that failed is not "no connections": say so, and offer the one action that retries it
      if (live) setRead({ workspace: ws, state: 'error', banks: [], error: err instanceof Error ? err.message : 'The server could not list your bank connections' });
    });
    return () => { live = false; };
  }, [noServer, workspaceId, reload]);
  // another workspace's connections are never shown while the new ones are read
  const fresh = read.workspace === workspaceId;
  const banks = fresh ? read.banks : [];
  const retry = () => { setRead({ workspace: workspaceId ?? '', state: 'loading', banks: [], error: '' }); setReload(n => n + 1); };

  const disconnect = async (bank: BankStatus) => {
    if (!workspaceId || busy) return;
    if (!window.confirm(`Disconnect ${bank.institutionName}? No new bank lines will arrive from it; the lines already imported stay.`)) return;
    setBusy(bank.id);
    try {
      await runCommand({ path: '/api/v1/plaid/disconnect', method: 'POST', body: { workspaceId, bankId: bank.id } });
      toast.success(`${bank.institutionName} disconnected; its imported lines are kept`);
      setReload(n => n + 1);
    } catch (err) {
      toast.error(commandErrorMessage(err));
    } finally {
      setBusy('');
    }
  };

  if (noServer) return null;
  if (!fresh) return <LoadingState what={bankText('connected.what', 'bank connections')} />;
  if (read.state === 'error') {
    return (
      <section role="alert" className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
        <h2 className="text-sm font-bold text-[var(--text)]">{bankText('connected.error', 'We couldn\'t check your bank connections')}</h2>
        <p className="mt-1 text-xs text-[var(--muted)]">{read.error}</p>
        <button
          type="button"
          onClick={retry}
          className="mt-3 min-h-11 px-4 py-2 rounded-xl border border-[var(--line)] bg-[var(--ink)] text-xs font-bold text-[var(--text)]"
        >
          {bankText('connected.retry', 'Try again')}
        </button>
      </section>
    );
  }
  if (read.state === 'loading') return <LoadingState what={bankText('connected.what', 'bank connections')} />;
  if (banks.length === 0) return null;
  return (
    <section aria-labelledby="connected-banks-title" className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
      <h2 id="connected-banks-title" className="text-sm font-bold text-[var(--text)]">{bankText('connected.title', 'Connected banks')}</h2>
      <ul className="mt-2 divide-y divide-[var(--line)] text-sm">
        {banks.map(bank => (
          <li key={bank.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span>
              <bdi className="font-semibold text-[var(--text)]">{bank.institutionName}</bdi>
              <span className={`block text-xs ${tone[bankHealth(bank, now).level]}`}>
                {bankHealth(bank, now).words} · {bankText('connected.lastSync', 'last good sync:')} {bank.lastSyncedAt ? new Date(bank.lastSyncedAt).toLocaleString() : bankText('connected.never', 'never')}
              </span>
              {bank.syncLog && bank.syncLog.length > 0 && (
                <details className="text-xs text-[var(--muted)]">
                  <summary className="cursor-pointer">{bankText('connected.history', 'Sync history')}<span className="sr-only"> {bankText('connected.of', 'of')} {bank.institutionName}</span></summary>
                  <ol className="mt-1 space-y-0.5">
                    {bank.syncLog.map(e => (
                      <li key={e.at}><time dateTime={e.at}>{new Date(e.at).toLocaleString()}</time>: {resultText(e.result)}{e.result === 'ok' ? `, ${e.lines ?? 0} ${e.lines === 1 ? bankText('connected.line', 'bank line') : bankText('connected.lines', 'bank lines')}` : ''}{e.error ? ` (${e.error})` : ''}</li>
                    ))}
                  </ol>
                </details>
              )}
            </span>
            <span className="flex items-center gap-2">
              {bank.status === 'login_required' && role !== 'viewer' && <PlaidConnectButton bankId={bank.id} label={bankText('connected.reconnect', 'Reconnect')} onSuccessSync={() => setReload(n => n + 1)} />}
              {(role === 'owner' || role === 'accountant') && (
                <button type="button" disabled={busy !== ''} onClick={() => void disconnect(bank)} className="text-xs text-rose-600 hover:underline disabled:opacity-50">
                  {bankText('connected.disconnect', 'Disconnect')}<span className="sr-only"> {bank.institutionName}</span>
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
