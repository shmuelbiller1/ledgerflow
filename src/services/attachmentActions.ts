import { collection, getDocs, query, where } from '../lib/db/firestore';
import { saveDocument } from '../lib/recordWrites';
import { db } from '../firebase';
import { getSupabase } from '../lib/db/client';
import { runCommand } from '../lib/runCommand';
import { type Attachment, type AttachmentCollection, type AttachmentTarget, MAX_FILES_AT_ONCE, attachmentProblem, attachmentRecord, attachmentsOf } from '../lib/attachments';

/** The file as a data address ("data:application/pdf;base64,…"), the way the Vault keeps files. */
export function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error(`${file.name} could not be read`));
    reader.readAsDataURL(file);
  });
}

export interface AttachResult {
  saved: Attachment[];
  /** files not kept, each with the reason */
  refused: Array<{ name: string; reason: string }>;
}

/**
 * Keep files with a record (K-07). Each file is checked (size), read and saved on its own, so one
 * refused file doesn't stop the others; nothing is reported as saved unless the database took it.
 */
export async function attachFiles(
  workspaceId: string,
  uid: string,
  target: AttachmentTarget,
  files: File[],
  canContinue: () => boolean = () => true,
): Promise<AttachResult> {
  const result: AttachResult = { saved: [], refused: [] };
  for (const [i, file] of files.entries()) {
    if (i >= MAX_FILES_AT_ONCE) { result.refused.push({ name: file.name, reason: `at most ${MAX_FILES_AT_ONCE} files at once` }); continue; }
    if (!canContinue()) {
      result.refused.push({ name: file.name, reason: 'The record or workspace changed before this file was attached' });
      break;
    }
    const problem = attachmentProblem(file);
    if (problem) { result.refused.push({ name: file.name, reason: problem }); continue; }
    try {
      const fileUrl = await readAsDataUrl(file);
      // FileReader yields to the event loop. Recheck the user's selected record before writing it.
      if (!canContinue()) {
        result.refused.push({ name: file.name, reason: 'The record or workspace changed before this file was attached' });
        break;
      }
      const record = attachmentRecord(file, fileUrl, target, { uid, workspaceId });
      // one file, one command: `putAttachment` is the per-file step, so the loop below carries each file's own
      // outcome (a refusal is recorded and the next file still goes) rather than pretending the batch is atomic
      const ref = await putAttachment(workspaceId, record);
      result.saved.push({ ...record, id: ref.id });
    } catch (err) {
      result.refused.push({ name: file.name, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  return result;
}

/** Write one attachment; the caller keeps the outcome, which is why the loop above is sequential per file. */
async function putAttachment(workspaceId: string, record: Omit<Attachment, 'id'> & { id?: string }): Promise<{ id: string }> {
  return saveDocument(workspaceId, record);
}

/** The files kept with one record, newest first. */
export async function loadAttachments(workspaceId: string, target: Pick<AttachmentTarget, 'collection' | 'id' | 'scope'>): Promise<Attachment[]> {
  const snap = await getDocs(query(collection(db, 'documents'), where('workspaceId', '==', workspaceId), where('linkedId', '==', target.id)));
  return attachmentsOf(snap.docs.map(d => ({ ...(d.data() as Omit<Attachment, 'id'>), id: d.id })), target);
}

/** Metadata-only index used by reports: never selects the file's potentially 700 KB data URL. */
export interface AttachmentLinkIndexRow {
  id: string;
  linkedId: string;
  linkedCollection: AttachmentCollection;
  name?: string;
  createdAt?: string;
}

export interface AttachmentLinkIndex {
  rows: AttachmentLinkIndexRow[];
  /** True when the safety cap was reached; callers must not treat absent links as a confirmed absence. */
  truncated: boolean;
}

/** Minimal query port so the projection and workspace boundary can be tested without a live database. */
export interface AttachmentIndexQueryBuilder extends PromiseLike<{ data: unknown; error: { message?: string } | null }> {
  select(columns: string): AttachmentIndexQueryBuilder;
  eq(column: string, value: string): AttachmentIndexQueryBuilder;
  in(column: string, values: string[]): AttachmentIndexQueryBuilder;
  order(column: string, options: { ascending: boolean }): AttachmentIndexQueryBuilder;
  range(from: number, to: number): AttachmentIndexQueryBuilder;
}

export interface AttachmentIndexClient {
  from(table: string): AttachmentIndexQueryBuilder;
}

const ATTACHMENT_INDEX_PAGE_SIZE = 1000;
export const MAX_ATTACHMENT_INDEX_ROWS = 50_000;
const ATTACHMENT_INDEX_PAGES_AT_ONCE = 4;

/** One page of linked-file metadata, scoped in SQL to this workspace and target collections. */
export async function queryAttachmentLinkIndexPage(
  client: AttachmentIndexClient,
  workspaceId: string,
  collections: readonly AttachmentCollection[],
  from: number,
  to: number,
): Promise<AttachmentLinkIndexRow[]> {
  const result = await client.from('documents')
    .select('id, linkedId:data->>linkedId, linkedCollection:data->>linkedCollection, name:data->>name, createdAt:data->>createdAt')
    .eq('workspace_id', workspaceId)
    .in('data->>linkedCollection', [...collections])
    .order('id', { ascending: true })
    .range(from, to);
  if (result.error) throw new Error(result.error.message || 'Attachment metadata could not be loaded');
  if (!Array.isArray(result.data)) return [];

  const wanted = new Set<string>(collections);
  return result.data.flatMap((value): AttachmentLinkIndexRow[] => {
    if (!value || typeof value !== 'object') return [];
    const row = value as Record<string, unknown>;
    if (typeof row.id !== 'string' || typeof row.linkedId !== 'string' ||
        typeof row.linkedCollection !== 'string' || !wanted.has(row.linkedCollection)) return [];
    return [{
      id: row.id,
      linkedId: row.linkedId,
      linkedCollection: row.linkedCollection as AttachmentCollection,
      ...(typeof row.name === 'string' ? { name: row.name } : {}),
      ...(typeof row.createdAt === 'string' ? { createdAt: row.createdAt } : {}),
    }];
  });
}

/**
 * Read only the association/name/date columns for linked attachments. The original documents query
 * selects `fileUrl` too, which is unnecessary and expensive for report counts. SQL scopes every
 * page by workspace and collection; hitting the cap is surfaced to the report, never called complete.
 */
export async function loadAttachmentLinkIndex(
  workspaceId: string,
  collections: readonly AttachmentCollection[],
  client: AttachmentIndexClient = getSupabase() as unknown as AttachmentIndexClient,
  maxRows = MAX_ATTACHMENT_INDEX_ROWS,
): Promise<AttachmentLinkIndex> {
  if (!workspaceId || !collections.length) return { rows: [], truncated: false };
  const cap = Number.isSafeInteger(maxRows) && maxRows > 0 ? Math.min(maxRows, MAX_ATTACHMENT_INDEX_ROWS) : MAX_ATTACHMENT_INDEX_ROWS;
  const rows: AttachmentLinkIndexRow[] = [];

  for (let offset = 0; offset < cap;) {
    const starts: number[] = [];
    for (let page = 0; page < ATTACHMENT_INDEX_PAGES_AT_ONCE && offset + page * ATTACHMENT_INDEX_PAGE_SIZE < cap; page++) {
      starts.push(offset + page * ATTACHMENT_INDEX_PAGE_SIZE);
    }
    const pages = await Promise.all(starts.map(start => queryAttachmentLinkIndexPage(
      client,
      workspaceId,
      collections,
      start,
      Math.min(start + ATTACHMENT_INDEX_PAGE_SIZE, cap) - 1,
    )));
    let exhausted = false;
    for (let index = 0; index < pages.length; index++) {
      rows.push(...pages[index]);
      const requested = Math.min(ATTACHMENT_INDEX_PAGE_SIZE, cap - starts[index]);
      if (pages[index].length < requested) { exhausted = true; break; }
    }
    if (exhausted) return { rows, truncated: false };
    offset += starts.length * ATTACHMENT_INDEX_PAGE_SIZE;
  }
  return { rows: rows.slice(0, cap), truncated: true };
}

/** Remove a file (through the server: it checks who may, and keeps an audit line). */
export async function removeAttachment(workspaceId: string, attachmentId: string): Promise<void> {
  await runCommand({
    path: `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/attachments/${encodeURIComponent(attachmentId)}`,
    method: 'DELETE',
  });
}

/** One line saying what happened, for a toast. */
export function attachSummary(result: AttachResult): { ok: boolean; message: string } {
  const saved = result.saved.length;
  const refused = result.refused.map(r => `${r.name}: ${r.reason}`).join('; ');
  if (!result.refused.length) return { ok: true, message: `${saved} file${saved === 1 ? '' : 's'} attached` };
  return { ok: false, message: saved ? `${saved} attached; not attached: ${refused}` : `Not attached: ${refused}` };
}
