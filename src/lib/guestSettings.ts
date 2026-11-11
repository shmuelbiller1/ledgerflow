import { assertGuestSession, guestRows, guestSession, SAMPLE_WORKSPACE_ID, writeGuestBatch } from './db/guestDatabase';
import { alertSettingsProblem, type AlertSettings } from './bookAlerts';
import { stagesProblem, type StageKind, type StageSets } from './stages';

/** Explicit sample-only metadata, never a fallback for a failed server request. */
function scope(workspaceId: string) {
  const session = guestSession();
  assertGuestSession(session);
  if (workspaceId !== SAMPLE_WORKSPACE_ID) throw new Error('Only the sample company can be changed in the demo.');
  return session!;
}
export function saveGuestAlerts(workspaceId: string, alerts: AlertSettings): AlertSettings {
  const session = scope(workspaceId);
  const problem = alertSettingsProblem(alerts);
  if (problem) throw new Error(problem);
  writeGuestBatch([{ op: 'update', table: 'workspaces', id: workspaceId, data: { alerts } }], session);
  return alerts;
}
export function readGuestStages(workspaceId: string, kind: StageKind) {
  scope(workspaceId);
  const stored = guestRows('documents').find(row => row.id === `${workspaceId}_stageSets`)?.data.sets;
  const sets = (stagesProblem(stored) ? {} : stored) as StageSets;
  const current: Record<string, string> = {};
  for (const row of guestRows('documents')) {
    const record = row.data.record as { type?: string; id?: string } | undefined;
    if (row.data.kind === 'recordStage' && record?.type === kind && record.id && typeof row.data.stage === 'string') current[record.id] = row.data.stage;
  }
  return { sets, stages: sets[kind] || [], current };
}
export function saveGuestStages(workspaceId: string, sets: StageSets) {
  const session = scope(workspaceId);
  const problem = stagesProblem(sets);
  if (problem) throw new Error(problem);
  const trimmed = Object.fromEntries(Object.entries(sets).map(([kind, values]) => [kind, values?.map(value => value.trim()) || []]));
  writeGuestBatch([{ op: 'set', table: 'documents', id: `${workspaceId}_stageSets`, data: { kind: 'stageSets', workspaceId, sets: trimmed } }], session);
}
export function moveGuestStage(workspaceId: string, kind: StageKind, id: string, stage: string) {
  const session = scope(workspaceId);
  const record = guestRows(kind === 'invoice' ? 'invoices' : 'bills').find(row => row.id === id);
  if (!record || record.data.workspaceId !== workspaceId) throw new Error('That record is not in the sample company.');
  if (stage && !readGuestStages(workspaceId, kind).stages.includes(stage)) throw new Error('Choose one of the stages');
  const key = `${workspaceId}_stage_${kind}_${id}`;
  writeGuestBatch([stage ? { op: 'set', table: 'documents', id: key, data: { kind: 'recordStage', workspaceId, record: { type: kind, id }, stage } } : { op: 'delete', table: 'documents', id: key }], session);
}
