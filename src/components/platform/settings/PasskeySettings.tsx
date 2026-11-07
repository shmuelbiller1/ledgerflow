import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useAuthStore } from '../../../stores/useAuthStore';
import { addPasskey, listPasskeys, MAX_PASSKEY_NAME, passkeyName, passkeysSupported, removePasskey, renamePasskey, type PasskeyInfo } from '../../../lib/db/auth';
import InlineEdit from '../../ui/InlineEdit';
import { safeConfirm } from '../../../lib/utils';
import AsyncButton from '../../ui/AsyncButton';

/**
 * Passkeys (CC-12): sign in with the device's fingerprint, face or PIN. Personal to the account, like
 * two-step login. Adding one runs the browser's passkey prompt; removing one needs only a confirmation,
 * because the password (and any authenticator app) still works.
 */
export function PasskeySettings() {
  const uid = useAuthStore(s => s.user?.uid);
  const available = useAuthStore(s => Boolean(s.user && !s.user.isAnonymous && !s.isGuest));
  return <PasskeyPanel key={JSON.stringify([uid, available])} available={available} uid={uid} />;
}

function message(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

function PasskeyPanel({ available, uid }: { available: boolean; uid?: string }) {
  const [supported] = useState(passkeysSupported);
  const [passkeys, setPasskeys] = useState<PasskeyInfo[] | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const generation = useRef(0);
  const id = useId();
  const current = useCallback((version: number) => generation.current === version && useAuthStore.getState().user?.uid === uid, [uid]);

  const load = useCallback(async () => {
    const version = ++generation.current;
    try {
      const list = await listPasskeys();
      if (current(version)) setPasskeys(list);
    } catch (e) {
      if (current(version)) setError(message(e, 'Could not load your passkeys.'));
    }
  }, [current]);

  useEffect(() => {
    const version = ++generation.current;
    if (available && supported) {
      void listPasskeys().then(list => { if (current(version)) setPasskeys(list); })
        .catch(e => { if (current(version)) setError(message(e, 'Could not load your passkeys.')); });
    }
    return () => { generation.current = version + 1; };
  }, [available, supported, current]);

  const add = async () => {
    setError(''); setNotice('');
    try {
      const { named } = await addPasskey(name);
      setName('');
      if (named) setNotice('Passkey added. You can now sign in with it.');
      else setError('Passkey added and it works, but its name was not saved. Rename it in the list.');
    } catch (e) {
      setError(message(e, 'The passkey was not added.'));
      return;
    }
    await load();
  };

  const remove = async (passkey: PasskeyInfo) => {
    if (!safeConfirm(`Remove the passkey "${passkey.name}"? You can still sign in with your password.`)) return;
    setError(''); setNotice('');
    try {
      await removePasskey(passkey.id);
      setNotice(`Removed ${passkey.name}.`);
      await load();
    } catch (e) {
      setError(message(e, 'The passkey was not removed.'));
    }
  };

  const status = !available ? 'Sign in to manage your passkeys.'
    : !supported ? 'This browser cannot use passkeys.'
    : passkeys === null ? 'Loading your passkeys…'
    : passkeys.length ? `${passkeys.length} passkey${passkeys.length === 1 ? '' : 's'} can sign in to this account.`
    : 'No passkeys yet.';
  const buttonClass = 'min-h-11 max-w-full';
  return (
    <section aria-labelledby={`${id}-title`} className="p-6 bg-[var(--ink)] border border-[var(--line)] rounded-xl space-y-4 min-w-0">
      <h3 id={`${id}-title`} className="text-base font-black text-[var(--text)] uppercase tracking-tight">Passkeys</h3>
      <p className="text-xs text-[var(--muted)]">Sign in with your device's fingerprint, face or PIN instead of typing your password. If you use an authenticator app, it still asks for its code.</p>
      <p role="status" className="text-sm text-[var(--text)]">{status}</p>
      {error && <p role="alert" className="text-sm text-rose-400 break-words">{error}</p>}
      {notice && <p role="status" className="text-sm text-[var(--pos)]">{notice}</p>}
      {available && supported && passkeys !== null && <>
        <ul className="space-y-3">{passkeys.map(p => <li key={p.id} className="flex flex-wrap items-center justify-between gap-3">
          <span className="min-w-0 break-words text-sm flex flex-wrap items-center gap-1">
            <InlineEdit value={p.name} label="Passkey name" validate={v => (passkeyName(String(v), '') ? null : 'Give the passkey a name')}
              onSave={async next => { await renamePasskey(p.id, String(next)); setNotice(`Renamed to ${passkeyName(String(next))}.`); await load(); }} />
            <span>— added {p.createdAt.slice(0, 10)}{p.lastUsedAt ? `, last used ${p.lastUsedAt.slice(0, 10)}` : ''}</span>
          </span>
          <AsyncButton type="button" variant="secondary" className={buttonClass} onClick={() => remove(p)}>Remove {p.name}</AsyncButton>
        </li>)}</ul>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0">
            <label htmlFor={`${id}-name`} className="block text-sm">Name (optional)</label>
            <input id={`${id}-name`} type="text" value={name} maxLength={MAX_PASSKEY_NAME} placeholder="e.g. Work laptop" onChange={e => setName(e.target.value)}
              className="min-h-11 w-full max-w-64 px-3 bg-[var(--surface)] border border-[var(--line)] rounded-xl text-[var(--text)]" />
          </div>
          <AsyncButton type="button" className={buttonClass} loadingText="Waiting for your passkey…" onClick={add}>Add a passkey</AsyncButton>
        </div>
      </>}
    </section>
  );
}

export default PasskeySettings;
