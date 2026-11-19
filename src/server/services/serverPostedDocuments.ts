const SERVER_POSTED: Record<string, string> = { invoices: 'Invoices', bills: 'Bills', creditNotes: 'Credit notes', vendorCredits: 'Vendor credits' };
const DOCUMENT_KEYS: Record<string, string> = { invoiceId: 'Invoices', billId: 'Bills', creditNoteId: 'Credit notes', vendorCreditId: 'Vendor credits' };

/** The kind of document a bulk request saves or posts entries for, when the server must build them instead. */
export function documentPostedByServer(body: { entityMutation?: { collection?: unknown }; transactions?: unknown } | undefined): string | null {
  const collection = String(body?.entityMutation?.collection ?? '');
  if (Object.hasOwn(SERVER_POSTED, collection)) return SERVER_POSTED[collection];
  for (const tx of Array.isArray(body?.transactions) ? body!.transactions as Array<{ metadata?: Record<string, unknown> }> : []) {
    const key = Object.keys(DOCUMENT_KEYS).find(k => tx?.metadata?.[k] != null && tx.metadata[k] !== '');
    if (key) return DOCUMENT_KEYS[key];
  }
  return null;
}
