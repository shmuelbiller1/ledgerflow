import { runCommand } from '../../lib/runCommand';
import { useState } from 'react';
import { Mail } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '../../stores/useAuthStore';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { safeConfirm } from '../../lib/utils';

interface Result { sent: Array<{ name: string }>; skipped: Array<{ name: string; reason: string }>; failed: Array<{ name: string; message: string }> }

/**
 * Email statements (BE-07): every active customer with something open gets their statement PDF by
 * email ("statement" template in Settings → Emails). Who was skipped, and why, is listed after.
 */
export default function EmailStatementsButton({ className }: { className?: string }) {
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const role = useCurrentRole();
  const [busy, setBusy] = useState(false);
  if (!workspaceId || role === 'viewer') return null;

  const run = async () => {
    if (!safeConfirm('Email a statement to every active customer with an open balance?')) return;
    setBusy(true);
    try {
      const data = await runCommand<Partial<Result>>({
        path: `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/emails/statements`,
        method: 'POST',
        body: {},
      });
      const sent = data.sent || [];
      toast.success(sent.length ? `${sent.length} statement${sent.length === 1 ? '' : 's'} emailed` : 'No statements to send',
        data.skipped?.length ? { description: `Not sent: ${data.skipped.map(s => `${s.name} (${s.reason})`).join('; ')}` } : undefined);
      for (const f of data.failed || []) toast.error(`${f.name}: ${f.message}`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button type="button" disabled={busy} onClick={run}
      className={className || 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--line)] text-xs font-semibold text-[var(--text)] hover:border-[var(--brass-line)] disabled:opacity-50'}>
      <Mail aria-hidden="true" className="w-3.5 h-3.5" /> {busy ? 'Sending…' : 'Email statements'}
    </button>
  );
}
