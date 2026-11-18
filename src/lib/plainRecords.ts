/**
 * The ordinary records a screen owns end to end — the collections `record.save` and `record.delete` will write.
 *
 * `useEntityOperations` used to finish every create, update and delete with `setDoc`/`updateDoc`/`deleteDoc` on
 * whatever `path` the caller passed. Every collection with a ledger meaning branches to its own command before it
 * gets there (invoices, bills, credit notes, vendor credits, customers, vendors, transactions, reconciliations,
 * payments, journal entries, chart accounts, employees, budgets, assets' lifecycle, estimates' status, inventory
 * movements), so what was left was this list: documents that a screen writes whole, and that no command owns.
 *
 * The list is an **allow-list**, the same answer `record.fields` gave for a record's own fields: a collection is not
 * writable through the generic door until someone names it here, so a ledger collection added tomorrow is refused
 * (with the name of the command that should own it) rather than quietly writable from a browser. What a collection
 * here still must not be used for: anything that posts. A purchase order is not a ledger document, a recurring rule
 * is a template, a tax rate is configuration, a loan row is a note about money — the postings they produce go through
 * `journal.create`, `transaction` routes and `loan.payment`.
 */
export const PLAIN_RECORD_COLLECTIONS = [
  'assets',
  'estimates',
  'inventory',
  'loans',
  'projects',
  'purchaseOrders',
  'recurring',
  'taxRates',
] as const;

export type PlainRecordCollection = (typeof PLAIN_RECORD_COLLECTIONS)[number];

export function isPlainRecordCollection(collection: string): collection is PlainRecordCollection {
  return (PLAIN_RECORD_COLLECTIONS as readonly string[]).includes(collection);
}

/**
 * The keys the server writes on every plain record, and that a caller's copy of them is dropped: the id is the
 * record's address, `uid` and `workspaceId` say who owns it, and the two timestamps are the server's clock.
 */
export const PLAIN_RECORD_SERVER_KEYS = ['id', 'uid', 'workspaceId', 'createdAt', 'updatedAt'] as const;
