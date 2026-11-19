/**
 * A-135: review-only suggestions for duplicate customer/vendor records. These are candidate pairs,
 * not identities, and this function never chooses a winner or changes a contact.
 */
import { normalizeSearchText } from './textNormalization';

export type ReviewContactKind = 'customer' | 'vendor';
export type DuplicateMatchSignal = 'tax-id' | 'email' | 'phone' | 'name';

export interface ReviewContact {
  id: string;
  kind: ReviewContactKind;
  name: string;
  email?: string;
  phone?: string;
  taxId?: string;
}

export interface DuplicateContactSummary {
  id: string;
  kind: ReviewContactKind;
  name: string;
}

export interface DuplicateContactPair {
  key: string;
  left: DuplicateContactSummary;
  right: DuplicateContactSummary;
  signals: DuplicateMatchSignal[];
  /** Identifier matches are stronger evidence than a name-only suggestion, but neither proves identity. */
  strength: 'identifier-match' | 'name-only';
}

export interface DuplicateContactReview {
  pairs: DuplicateContactPair[];
  /** Large shared-value groups are omitted rather than expanded into thousands of noisy pairs. */
  ambiguousBuckets: number;
  truncated: boolean;
}

export const MAX_DUPLICATE_CONTACT_PAIRS = 5000;
const MAX_DUPLICATE_BUCKET_SIZE = 40;
const SIGNAL_ORDER: DuplicateMatchSignal[] = ['tax-id', 'email', 'phone', 'name'];

function normalizedName(value: string): string {
  return normalizeSearchText(value).replace(/[^\p{L}\p{M}\p{N}]/gu, '');
}

export function normalizedTaxId(value: string): string {
  return normalizeSearchText(value).replace(/[^\p{L}\p{N}]/gu, '');
}

export function normalizedEmail(value: string): string {
  return normalizeSearchText(value).trim();
}

export function normalizedPhone(value: string): string {
  return normalizeSearchText(value).replace(/[^0-9]/g, '');
}

function contactKey(contact: Pick<ReviewContact, 'kind' | 'id'>): string {
  return `${contact.kind}:${contact.id}`;
}

function orderedContacts(a: ReviewContact, b: ReviewContact): [ReviewContact, ReviewContact] {
  const aKey = contactKey(a);
  const bKey = contactKey(b);
  return aKey.localeCompare(bKey) <= 0 ? [a, b] : [b, a];
}

/** Find exact identifier matches and normalized-name suggestions within the supplied workspace set.
 *  With `incomingIds`, find only identifier pairs crossing from an incoming row to a stored contact.
 *  Neither side alone can consume the other's pair budget or trigger an omitted-group warning.
 */
export function findDuplicateContactCandidates(
  contacts: readonly ReviewContact[],
  { incomingIds }: { incomingIds?: ReadonlySet<string> } = {},
): DuplicateContactReview {
  const unique = new Map<string, ReviewContact>();
  for (const contact of contacts) {
    if (!contact || !contact.id || !['customer', 'vendor'].includes(contact.kind)) continue;
    const key = contactKey(contact);
    const name = typeof contact.name === 'string' ? contact.name.trim() : '';
    if (!unique.has(key)) unique.set(key, { ...contact, name });
  }

  const buckets = new Map<string, { signal: DuplicateMatchSignal; contacts: ReviewContact[] }>();
  const add = (contact: ReviewContact, signal: DuplicateMatchSignal, value: string, minimumLength: number) => {
    if (value.length < minimumLength) return;
    const key = `${signal}\u0000${value}`;
    const bucket = buckets.get(key) || { signal, contacts: [] };
    bucket.contacts.push(contact);
    buckets.set(key, bucket);
  };

  for (const contact of unique.values()) {
    const taxId = normalizedTaxId(contact.taxId || '');
    const email = normalizedEmail(contact.email || '');
    const phone = normalizedPhone(contact.phone || '');
    if (taxId.length >= 5) add(contact, 'tax-id', taxId, 5);
    if (email.includes('@') && email.length <= 320) add(contact, 'email', email, 3);
    if (phone.length >= 7) add(contact, 'phone', phone, 7);
    // Name matches are intentionally weak: they are suggestions to inspect, not a confidence score.
    if (!incomingIds) add(contact, 'name', normalizedName(contact.name), 4);
  }

  const pairs = new Map<string, { left: DuplicateContactSummary; right: DuplicateContactSummary; signals: Set<DuplicateMatchSignal> }>();
  let ambiguousBuckets = 0;
  let truncated = false;
  for (const { signal, contacts: bucket } of buckets.values()) {
    if (bucket.length < 2) continue;
    if (incomingIds && (!bucket.some(c => incomingIds.has(c.id)) || bucket.every(c => incomingIds.has(c.id)))) continue;
    if (bucket.length > MAX_DUPLICATE_BUCKET_SIZE) {
      ambiguousBuckets++;
      continue;
    }
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        if (incomingIds && incomingIds.has(bucket[i].id) === incomingIds.has(bucket[j].id)) continue;
        const [left, right] = orderedContacts(bucket[i], bucket[j]);
        const key = `${contactKey(left)}\u0000${contactKey(right)}`;
        const existing = pairs.get(key);
        if (existing) {
          existing.signals.add(signal);
          continue;
        }
        if (pairs.size >= MAX_DUPLICATE_CONTACT_PAIRS) {
          truncated = true;
          continue;
        }
        pairs.set(key, {
          left: { id: left.id, kind: left.kind, name: left.name },
          right: { id: right.id, kind: right.kind, name: right.name },
          signals: new Set([signal]),
        });
      }
    }
  }

  const signalWeight = (pair: { signals: Set<DuplicateMatchSignal> }) =>
    Number(pair.signals.has('tax-id')) * 8 + Number(pair.signals.has('email')) * 4 +
    Number(pair.signals.has('phone')) * 2 + Number(pair.signals.has('name'));
  const result = [...pairs.entries()].map(([key, pair]): DuplicateContactPair => {
    const signals = SIGNAL_ORDER.filter(signal => pair.signals.has(signal));
    return {
      key,
      left: pair.left,
      right: pair.right,
      signals,
      strength: signals.some(signal => signal !== 'name') ? 'identifier-match' : 'name-only',
    };
  }).sort((a, b) => {
    const weightA = signalWeight({ signals: new Set(a.signals) });
    const weightB = signalWeight({ signals: new Set(b.signals) });
    return weightB - weightA || a.left.name.localeCompare(b.left.name) ||
      a.right.name.localeCompare(b.right.name) || a.key.localeCompare(b.key);
  });

  return { pairs: result, ambiguousBuckets, truncated };
}

export const DUPLICATE_CONTACT_CSV_HEADERS = [
  'First contact type', 'First contact', 'First contact ID', 'Second contact type', 'Second contact', 'Second contact ID', 'Match signals', 'Review strength',
];

export function duplicateContactCsvRows(pairs: readonly DuplicateContactPair[]): Array<Array<string>> {
  return pairs.map(pair => [
    pair.left.kind, pair.left.name, pair.left.id, pair.right.kind, pair.right.name, pair.right.id,
    pair.signals.join('; '), pair.strength,
  ]);
}
