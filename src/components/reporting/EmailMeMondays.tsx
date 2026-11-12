import { useState } from 'react';
import { toast } from 'sonner';
import { useAuthStore } from '../../stores/useAuthStore';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { db } from '../../firebase';
import { doc, updateDoc } from '../../lib/db/firestore';
import { EMAILABLE_REPORTS, addMondayEmail, mondayScheduleFor } from '../../lib/emailMeMondays';

/** EU-F3: one click to get this report every Monday (owners and accountants keep schedules; others see nothing). */
export default function EmailMeMondays({ reportTab }: { reportTab: string }) {
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const email = useAuthStore(s => s.user?.email) || '';
  const role = useCurrentRole();
  const [busy, setBusy] = useState(false);
  const kind = EMAILABLE_REPORTS[reportTab];
  if (!kind || !workspace?.id || !email || (role !== 'owner' && role !== 'accountant')) return null;
  const schedules = workspace.scheduledReports || [];
  if (mondayScheduleFor(schedules, kind, email)) {
    return <span className="text-xs text-[var(--muted)]" data-testid="email-me-mondays">Emailed to you every Monday</span>;
  }
  const add = async () => {
    if (busy) return;
    const result = addMondayEmail(schedules, kind, email, `sr_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`);
    if ('problem' in result) { toast.error(result.problem); return; }
    setBusy(true);
    const uid = useAuthStore.getState().user?.uid;
    // a reply after a sign-out or another account changes nothing here; the list it updates is the one now kept
    const stillSame = () => useAuthStore.getState().user?.uid === uid;
    try {
      await updateDoc(doc(db, 'workspaces', workspace.id), { scheduledReports: result.next, updatedAt: new Date().toISOString() });
      if (!stillSame()) return;
      const latest = useAuthStore.getState().workspaces;
      useAuthStore.getState().setWorkspaces(latest.map(w => (w.id === workspace.id ? { ...w, scheduledReports: result.next } : w)));
      toast.success(`You'll get this every Monday for the week before (change it in Settings → Scheduled reports)`);
    } catch {
      if (stillSame()) toast.error('Could not save the schedule (owners and accountants can).');
    } finally { setBusy(false); }
  };
  return (
    <button type="button" data-testid="email-me-mondays" disabled={busy} onClick={() => void add()}
      className="min-h-11 px-3 border border-[var(--line)] rounded-md text-xs disabled:opacity-50">Email me this every Monday</button>
  );
}
