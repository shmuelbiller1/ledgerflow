/**
 * Links to any record (Z-32): the address hash is `#<screen>` or `#<screen>/<type>/<id>`, e.g.
 * `#sales/invoice/abc123`. Opening such a link shows the screen and highlights the record there
 * (useUIStore.focusRecord). Data Health, notifications and search results use these links.
 */
export type RecordType = 'transaction' | 'invoice' | 'bill' | 'recurring' | 'account' | 'item' | 'bankLine';
export interface RecordRef { type: RecordType; id: string }

/** Where a record opens: the screen, and the record id to highlight there. */
export const RECORD_TABS: Record<RecordType, string> = {
  transaction: 'transactions', invoice: 'sales', bill: 'purchases', recurring: 'recurring', account: 'ledger', item: 'inventory',
  bankLine: 'reconciliation',
};

/** Creation links are separate from saved-record IDs; no durable record uses the sentinel. */
export const NEW_RECORD_TABS = {
  invoice: 'sales', customer: 'sales', bill: 'purchases', vendor: 'purchases', journalEntry: 'ledger',
} as const;
export type NewRecordType = keyof typeof NEW_RECORD_TABS;
export function newRecordHash(type: NewRecordType): string {
  return `${NEW_RECORD_TABS[type]}/${type}/new`;
}

const TYPES = new Set<string>(Object.keys(RECORD_TABS));

export function recordHash(record: RecordRef): string {
  return `${RECORD_TABS[record.type]}/${record.type}/${encodeURIComponent(record.id)}`;
}

/** The screen and (optionally) the record a hash points to. */
export function parseRecordHash(hash: string): { tab: string; record?: RecordRef; create?: NewRecordType } {
  const clean = hash.replace(/^#/, '');
  // sign-in data sent back after "Sign in with Google" (#access_token=…&…, #error=…) is not a page;
  // no page name has "=" in it
  if (clean.includes('=')) return { tab: '' };
  const [tab, type, ...rest] = clean.split('/');
  const id = rest.join('/');
  if (id === 'new' && type && Object.hasOwn(NEW_RECORD_TABS, type) && NEW_RECORD_TABS[type as NewRecordType] === tab) {
    return { tab, create: type as NewRecordType };
  }
  if (type && id && TYPES.has(type)) {
    try {
      return { tab, record: { type: type as RecordType, id: decodeURIComponent(id) } };
    } catch {
      return { tab };
    }
  }
  return { tab };
}
