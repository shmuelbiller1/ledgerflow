import { runCommand, commandErrorMessage } from '../../lib/runCommand';
import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '../../stores/useAuthStore';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { formatCurrency } from '../../lib/utils';

/**
 * Apply open credits automatically (BE-06): every open credit note (vendor credit) of one customer
 * (vendor), or of all, goes to their open invoices (bills), oldest first. Done by the server in one
 * step; nothing is posted (issuing the credit already lowered what is owed).
 */
/** What auto-applying credits answers: the applications it made and their total. */
interface AutoApplyAnswer {
  data?: { applications?: Array<{ documentId: string }>; totalCents?: number };
  message?: string;
}

export default function ApplyCreditsButton({ kind, partyId, className }: { kind: 'customer' | 'vendor'; partyId?: string; className?: string }) {
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const currency = useAuthStore(s => s.getCurrentWorkspace()?.currency);
  const role = useCurrentRole();
  const [busy, setBusy] = useState(false);
  if (!workspaceId || role === 'viewer') return null;
  const noun = kind === 'customer' ? 'invoice' : 'bill';

  const run = async () => {
    setBusy(true);
    try {
      const data = await runCommand<AutoApplyAnswer>({
        path: '/api/v1/payments/credits/auto-apply',
        method: 'POST',
        body: { workspaceId, kind, ...(partyId ? { partyId } : {}) },
      });
      const applied = data.data;
      const applications: Array<{ documentId: string }> = applied?.applications || [];
      const documents = new Set(applications.map(a => a.documentId)).size;
      if (documents === 0) toast.info(`No open credits to apply to open ${noun}s`);
      else toast.success(`${formatCurrency(applied?.totalCents || 0, currency)} of credits applied to ${documents} ${noun}${documents === 1 ? '' : 's'}`);
    } catch (err) {
      toast.error(commandErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <button type="button" disabled={busy} onClick={run} title={`Use open credits on open ${noun}s, oldest first`}
      className={className || 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--line)] text-xs font-semibold text-[var(--text)] hover:border-[var(--brass-line)] disabled:opacity-50'}>
      <Sparkles aria-hidden="true" className="w-3.5 h-3.5" /> {busy ? 'Applying…' : 'Apply open credits'}
    </button>
  );
}
