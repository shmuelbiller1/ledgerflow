/**
 * Customer and vendor extras (Y-21 Y-22 Y-24 Y-25 + A-136 contact roles): the people to deal with
 * at a company (including standard roles: Billing, Shipping, Accounts payable, Purchasing, Owner,
 * Other), tags, and a notes timeline. Pure helpers shared by the contact form and the contact page.
 */

export const STANDARD_CONTACT_ROLES = [
  'Billing',
  'Shipping',
  'Accounts payable',
  'Purchasing',
  'Owner',
  'Other',
] as const;
export type StandardContactRole = typeof STANDARD_CONTACT_ROLES[number];

export interface ContactPerson {
  name: string;
  email?: string;
  phone?: string;
  /** e.g. "Billing", "Shipping", "Accounts payable", "Owner" */
  role?: string;
}

export interface ContactNote {
  id: string;
  text: string;
  /** ISO time */
  at: string;
  /** who wrote it (email or name) */
  by?: string;
}

export const MAX_NOTES = 200;
export const MAX_NOTE_LENGTH = 2000;

/** Canonicalize common role spellings to their standard label when matching, else keep custom role text trimmed. */
export function canonicalContactRole(raw?: string): string {
  const cleaned = String(raw || '').trim();
  if (!cleaned) return '';
  const low = cleaned.toLowerCase().replace(/[\s_-]+/g, ' ');
  if (low === 'billing' || low === 'ar' || low === 'accounts receivable') return 'Billing';
  if (low === 'shipping' || low === 'warehouse' || low === 'receiving' || low === 'logistics') return 'Shipping';
  if (low === 'accounts payable' || low === 'ap' || low === 'payables') return 'Accounts payable';
  if (low === 'purchasing' || low === 'procurement' || low === 'buyer') return 'Purchasing';
  if (low === 'owner' || low === 'director' || low === 'ceo') return 'Owner';
  if (low === 'other') return 'Other';
  return cleaned;
}

/** Return all contacts matching a target role (case-insensitive canonical match). */
export function contactsByRole(people: ContactPerson[] | undefined, role: StandardContactRole): ContactPerson[] {
  const target = canonicalContactRole(role);
  return (people || []).filter(p => canonicalContactRole(p.role) === target);
}

/** Resolve the preferred email for a role on a customer/vendor, falling back to the company's main email. */
export function preferredEmailForRole(
  party: { email?: string; contacts?: ContactPerson[] } | null | undefined,
  role: StandardContactRole,
): string {
  const match = contactsByRole(party?.contacts, role).find(c => Boolean(c.email?.trim()));
  return (match?.email || party?.email || '').trim().toLowerCase();
}

/** "vip, wholesale , VIP" → ['vip', 'wholesale']: trimmed, no empties, no repeats (any case). */
export function parseTags(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(',')) {
    const tag = raw.trim().replace(/\s+/g, ' ').slice(0, 40);
    const key = tag.toLocaleLowerCase();
    if (tag && !seen.has(key)) { seen.add(key); out.push(tag); }
  }
  return out.slice(0, 20);
}

/** Contact people with a name, fields trimmed and canonical standard role normalized when matched. */
export function cleanContacts(people: ContactPerson[]): ContactPerson[] {
  return people
    .map(p => ({
      name: p.name.trim(),
      email: (p.email || '').trim().toLowerCase(),
      phone: (p.phone || '').trim(),
      role: canonicalContactRole(p.role),
    }))
    .filter(p => p.name)
    .map(p => Object.fromEntries(Object.entries(p).filter(([, v]) => v)) as unknown as ContactPerson)
    .slice(0, 20);
}

/** The notes with a new one first (empty text: unchanged), at most MAX_NOTES kept. */
export function addNote(notes: ContactNote[] | undefined, text: string, by: string | undefined, now: string, id: string): ContactNote[] {
  const body = text.trim().slice(0, MAX_NOTE_LENGTH);
  if (!body) return notes || [];
  return [{ id, text: body, at: now, ...(by ? { by } : {}) }, ...(notes || [])].slice(0, MAX_NOTES);
}

/** Every tag used by these contacts, sorted, for the filter chips. */
export function allTags(parties: Array<{ tags?: string[] }>): string[] {
  const byKey = new Map<string, string>();
  for (const p of parties) for (const t of p.tags || []) if (!byKey.has(t.toLocaleLowerCase())) byKey.set(t.toLocaleLowerCase(), t);
  return [...byKey.values()].sort((a, b) => a.localeCompare(b));
}

/** True when the contact has the tag (any case); no tag chosen matches everyone. */
export const hasTag = (party: { tags?: string[] }, tag: string | null) =>
  !tag || (party.tags || []).some(t => t.toLocaleLowerCase() === tag.toLocaleLowerCase());

/** An archived customer or vendor (I-22): kept on its records, hidden from lists unless asked. */
export function isArchivedParty(party: { status?: string }): boolean {
  return party.status === 'inactive' || party.status === 'archived';
}
