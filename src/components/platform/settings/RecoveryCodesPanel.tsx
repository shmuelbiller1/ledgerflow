import React, { useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import { getIdToken } from '../../../firebase';
import { safeConfirm } from '../../../lib/utils';

import { BRAND_NAME, BRAND } from '../../../config/brand';
/**
 * Recovery codes for two-step login (L-85): ten one-time codes for the day the authenticator app is
 * lost. Shown once when made (copy or download them then); making new ones ends the old ones. On the
 * code step of sign-in, "Use a recovery code" takes one.
 */
async function call(method: 'GET' | 'POST') {
  const res = await fetch('/api/v1/account/recovery-codes', { method, headers: { Authorization: `Bearer ${await getIdToken()}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || 'Recovery codes are not available right now');
  return data as { left?: number; total?: number; codes?: string[] };
}

export default function RecoveryCodesPanel() {
  const id = useId();
  const [left, setLeft] = useState<number | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    call('GET').then(s => { if (live) setLeft(s.left ?? 0); }).catch(() => { if (live) setLeft(null); });
    return () => { live = false; };
  }, []);

  const make = async () => {
    if (left && !safeConfirm(`You have ${left} unused recovery code${left === 1 ? '' : 's'}. Make new ones? The old ones stop working.`)) return;
    setBusy(true);
    setError('');
    try {
      const made = await call('POST');
      setCodes(made.codes || []);
      setLeft((made.codes || []).length);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const text = () => `${BRAND_NAME} recovery codes (each works once)\n\n${(codes || []).join('\n')}\n`;
  const download = () => {
    const url = URL.createObjectURL(new Blob([text()], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${BRAND.fileSlug}-recovery-codes.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };

  return (
    <div className="space-y-2 border-t border-[var(--line)] pt-4" aria-labelledby={`${id}-title`} role="group">
      <h4 id={`${id}-title`} className="text-sm font-bold text-[var(--text)]">Recovery codes</h4>
      <p className="text-xs text-[var(--muted)]">If you lose the phone with your authenticator, a recovery code lets you sign in once and set two-step login up again.</p>
      <p role="status" className="text-sm text-[var(--text)]">{left === null ? 'Recovery code status is unavailable.' : left ? `${left} unused recovery code${left === 1 ? '' : 's'} left.` : 'No recovery codes yet.'}</p>
      {error && <p role="alert" className="text-sm text-rose-400 break-words">{error}</p>}
      {codes ? (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-[var(--text)]">Save these now: they are not shown again.</p>
          <ol className="grid grid-cols-2 gap-1 font-mono text-sm text-[var(--text)]" aria-label="Your recovery codes">
            {codes.map(c => <li key={c}>{c}</li>)}
          </ol>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="min-h-11 px-4 border border-[var(--line)] rounded-xl" onClick={() => { void navigator.clipboard?.writeText(text()).then(() => toast.success('Recovery codes copied')); }}>Copy</button>
            <button type="button" className="min-h-11 px-4 border border-[var(--line)] rounded-xl" onClick={download}>Download (.txt)</button>
            <button type="button" className="min-h-11 px-4 border border-[var(--line)] rounded-xl" onClick={() => setCodes(null)}>I saved them</button>
          </div>
        </div>
      ) : (
        <button type="button" disabled={busy} className="min-h-11 px-4 bg-[var(--surface)] border border-[var(--line)] rounded-xl" onClick={() => void make()}>
          {busy ? 'Working…' : left ? 'Make new recovery codes' : 'Make recovery codes'}
        </button>
      )}
    </div>
  );
}
