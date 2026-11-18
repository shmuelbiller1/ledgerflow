import type { Firestore } from '../db/firestore';
import { writeServerAuditLog } from './auditLogService';

/**
 * Tags as one list for the workspace (K-15): every tag in use on contacts, projects, documents and
 * entries (the Vault's own folders are not tags), with how many records of each kind carry it, and renaming, merging and removing
 * one everywhere at once. Tags match without regard to case ("VIP" is "vip"), as the tag filters do
 * (src/lib/contacts.ts `hasTag`). Only the `tags` field changes; amounts and postings never do.
 */
export const TAGGED: Record<string, string> = {
  customers: 'Customers',
  vendors: 'Vendors',
  projects: 'Projects',
  invoices: 'Invoices',
  bills: 'Bills',
  creditNotes: 'Credit notes',
  vendorCredits: 'Vendor credits',
  transactions: 'Entries',
  journalEntries: 'Journal entries',
};

export class TagError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export interface TagUse { tag: string; total: number; byKind: Record<string, number> }

const key = (tag: string) => tag.trim().toLocaleLowerCase();

/** Every tag in use, the most used spelling shown, most used first. */
export async function listTags(db: Firestore, workspaceId: string): Promise<TagUse[]> {
  const byKey = new Map<string, { spellings: Map<string, number>; byKind: Record<string, number> }>();
  for (const table of Object.keys(TAGGED)) {
    const rows = await db.readRows<{ tag: string; n: number }>(
      `select t.tag, count(*)::int as n
         from ${db.tableSource(table)} d,
              jsonb_array_elements_text(case when jsonb_typeof(d.data->'tags') = 'array' then d.data->'tags' else '[]'::jsonb end) as t(tag)
        where d.workspace_id = $1
        group by t.tag`,
      [workspaceId],
    );
    for (const { tag, n } of rows) {
      if (!tag.trim()) continue;
      const entry = byKey.get(key(tag)) || { spellings: new Map<string, number>(), byKind: {} };
      entry.spellings.set(tag, (entry.spellings.get(tag) || 0) + n);
      entry.byKind[table] = (entry.byKind[table] || 0) + n;
      byKey.set(key(tag), entry);
    }
  }
  return [...byKey.values()].map(e => {
    const tag = [...e.spellings.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
    return { tag, total: Object.values(e.byKind).reduce((s, n) => s + n, 0), byKind: e.byKind };
  }).sort((a, b) => b.total - a.total || a.tag.localeCompare(b.tag));
}

/** The record's tags with `from` (any case) replaced by `to`, or removed when `to` is null; no tag twice. */
export function retag(tags: unknown, from: string, to: string | null): string[] {
  const out: string[] = [];
  for (const t of Array.isArray(tags) ? tags.map(String) : []) {
    const next = key(t) === key(from) ? to : t;
    if (next && !out.some(o => key(o) === key(next))) out.push(next);
  }
  return out;
}

const BATCH = 300;

/**
 * Rename (or merge into an existing tag of that name, or remove when `to` is null) one tag on every
 * record that has it. Records are changed in batches of up to 300, each in one database transaction;
 * running it again finishes whatever an interruption left. Returns how many records changed.
 */
export async function changeTag(db: Firestore, workspaceId: string, from: string, to: string | null, who: { uid: string; email?: string }): Promise<number> {
  const source = from.trim();
  const target = to === null ? null : to.trim();
  if (!source) throw new TagError('Which tag?');
  if (target !== null && !target) throw new TagError('Type the new name');
  if (target !== null && target.length > 50) throw new TagError('Tags are at most 50 characters');
  if (target !== null && target === source) return 0;
  let changed = 0;
  for (const table of Object.keys(TAGGED)) {
    const rows = await db.readRows<{ id: string }>(
      `select d.id from ${db.tableSource(table)} d
        where d.workspace_id = $1 and jsonb_typeof(d.data->'tags') = 'array'
          and exists (select 1 from jsonb_array_elements_text(d.data->'tags') t(tag) where lower(trim(t.tag)) = lower($2))`,
      [workspaceId, source],
    );
    for (let i = 0; i < rows.length; i += BATCH) {
      const refs = rows.slice(i, i + BATCH).map(r => db.collection(table).doc(r.id));
      changed += await db.runTransaction(async t => {
        const snaps = await t.getAll(...refs);
        let n = 0;
        const now = new Date().toISOString();
        for (const snap of snaps) {
          const data = snap.data();
          if (!data || data.workspaceId !== workspaceId) continue;
          t.update(snap.ref, { tags: retag(data.tags, source, target), updatedAt: now });
          n++;
        }
        return n;
      });
    }
  }
  if (changed > 0) {
    await writeServerAuditLog({
      workspaceId, uid: who.uid, email: who.email, action: target === null ? 'tag.removed' : 'tag.renamed', entityType: 'tags', entityId: source,
      details: { description: target === null ? `Removed the tag "${source}" from ${changed} records` : `Renamed the tag "${source}" to "${target}" on ${changed} records`, from: source, to: target, records: changed },
    }, { db });
  }
  return changed;
}
