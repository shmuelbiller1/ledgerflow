import { useEffect, useState } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { TASK_KIND, type Task } from '../../lib/tasks';
import type { RecordRef } from '../../lib/recordLinks';
import { runCommand, type CommandBody } from '../../lib/runCommand';

interface Person { uid: string; role: string; email?: string }

/**
 * Shared-inbox triage (BG-05): the workspace's open tasks and people, read once for a list (To
 * Review), so each row can say who has it and hand it to someone (a task about that record).
 */
export function useHandOvers() {
  const workspaceId = useAuthStore(s => s.currentWorkspaceId) || '';
  const [tasks, setTasks] = useState<Task[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  useEffect(() => {
    if (!workspaceId) return;
    let live = true;
    (async () => {
      return await runCommand<CommandBody>({ path: `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/tasks` }) ?? {};
    })().then(data => { if (live) { setTasks(Array.isArray(data.tasks) ? data.tasks : []); setPeople(Array.isArray(data.people) ? data.people : []); } }).catch((err) => { console.warn('[useHandOvers] Could not load handover tasks:', err); });
    return () => { live = false; };
  }, [workspaceId]);
  const holder = (record: RecordRef) => tasks.find(t => t.kind === TASK_KIND && t.status === 'open' && t.record?.type === record.type && t.record.id === record.id);
  return { workspaceId, people, holder, added: (task: Task) => setTasks(list => [...list, task]) };
}

