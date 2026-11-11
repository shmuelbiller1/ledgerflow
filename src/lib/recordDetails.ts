/** Nonfinancial metadata only. Posting, balances, prices and quantities are deliberately absent. */
export const RECORD_DETAIL_FIELDS = {
  customers: ['name', 'email', 'phone', 'address', 'notes'],
  vendors: ['name', 'email', 'phone', 'address', 'category'],
  projects: ['name', 'description'],
  inventory: ['name', 'sku', 'description'],
} as const;
export type DetailKind = keyof typeof RECORD_DETAIL_FIELDS;
export interface DetailTarget { kind: DetailKind; id: string }
export type DetailData = Record<string, unknown>;
export interface DetailSession { sampleSession?: object; uid: string; workspaceId: string; writable: boolean }
export interface DetailAdapter {
  session(): DetailSession | null;
  guardProjectRename?(target: DetailTarget, oldName: string): void;
  read(target: DetailTarget): Promise<DetailData | undefined>;
  update(target: DetailTarget, changes: Record<string, string>): Promise<void>;
}
function guard(adapter: DetailAdapter, session: DetailSession, write: boolean) {
  const current = adapter.session();
  if (!current || current.uid !== session.uid || current.workspaceId !== session.workspaceId || current.sampleSession !== session.sampleSession) throw new Error('Workspace or signed-in user changed. Reopen this record.');
  if (write && !current.writable) throw new Error('Your current workspace role cannot edit this record.');
}
export async function loadRecordDetails(adapter: DetailAdapter, target: DetailTarget): Promise<DetailData> {
  const session = adapter.session();
  if (!session) throw new Error('Sign in and select a workspace to edit details.');
  const record = await adapter.read(target); guard(adapter, session, false);
  if (!record || record.workspaceId !== session.workspaceId) throw new Error('This record is unavailable in the current workspace.');
  return record;
}
export async function saveRecordDetails(adapter: DetailAdapter, target: DetailTarget, baseline: DetailData, draft: Record<string, string>): Promise<DetailData> {
  const session = adapter.session();
  if (!session) throw new Error('Sign in and select a workspace to edit details.');
  guard(adapter, session, true);
  if (!draft.name?.trim()) throw new Error('Name is required.');
  const changes: Record<string, string> = {};
  for (const key of RECORD_DETAIL_FIELDS[target.kind]) {
    if (!(key in draft)) continue;
    if (draft[key].length > 10000) throw new Error(`${key} is too long.`);
    if (draft[key] !== String(baseline[key] ?? '')) changes[key] = draft[key];
  }
  const latest = await adapter.read(target); guard(adapter, session, true);
  if (!latest || latest.workspaceId !== session.workspaceId || baseline.workspaceId !== session.workspaceId) throw new Error('This record is unavailable in the current workspace.');
  for (const key of Object.keys(changes)) if (String(latest[key] ?? '') !== String(baseline[key] ?? '')) throw new Error('Someone changed these details. Reopen the record before saving.');
  if (target.kind === 'projects' && 'name' in changes) {
    if (!adapter.guardProjectRename) throw new Error('Project renaming needs a checked reference history.');
    adapter.guardProjectRename(target, String(latest.name ?? ''));
  }
  if (Object.keys(changes).length) { await adapter.update(target, changes); guard(adapter, session, true); }
  return { ...latest, ...changes };
}
