import { runCommand } from '../../lib/runCommand';
import React, { useState } from 'react';
import { toast } from 'sonner';
import { useAuthStore } from '../../stores/useAuthStore';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import type { RecordRef } from '../../lib/recordLinks';
import type { useHandOvers } from './useHandOvers';

/** "With dana@…" when someone has it, else "Give to…" for owners, accountants and bookkeepers. */
export function HandOver({ record, hand }: { record: RecordRef & { label: string }; hand: ReturnType<typeof useHandOvers> }) {
  const uid = useAuthStore(s => s.user?.uid) || '';
  const role = useCurrentRole();
  const [busy, setBusy] = useState(false);
  const nameOf = (id: string) => (id === uid ? 'you' : hand.people.find(p => p.uid === id)?.email || 'a teammate');
  const has = hand.holder(record);
  if (has) return <span className="text-xs text-[var(--muted)]">With {nameOf(has.assignee)}</span>;
  if (!['owner', 'accountant', 'bookkeeper'].includes(role) || hand.people.length === 0) return null;
  const give = async (assignee: string) => {
    if (!assignee) return;
    setBusy(true);
    try {
      const data = await runCommand<{ task: Parameters<typeof hand.added>[0] }>({
        path: `/api/v1/workspaces/${encodeURIComponent(hand.workspaceId)}/tasks`,
        method: 'POST',
        body: { title: `Review: ${record.label}`.slice(0, 200), assignee, record },
      });
      hand.added(data.task);
      toast.success(`Given to ${nameOf(assignee)}`);
    } catch (err) { toast.error(err instanceof Error ? err.message : String(err)); } finally { setBusy(false); }
  };
  return (
    <select value="" disabled={busy} aria-label={`Give ${record.label} to someone`} onChange={e => void give(e.target.value)}
      className="px-2 py-1 text-xs border border-[var(--line)] rounded bg-[var(--panel)] text-[var(--text)]">
      <option value="">Give to…</option>
      {hand.people.map(p => <option key={p.uid} value={p.uid}>{p.uid === uid ? 'Me' : p.email || `A teammate (${p.role})`}</option>)}
    </select>
  );
}
