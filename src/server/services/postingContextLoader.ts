import type { Firestore } from '../db/firestore';
import { effectiveLockDate } from '../../lib/periodLock';
import type { LedgerPostContext } from '../../services/ledgerPost/postingCore';
import type { ChartAccount, InventoryItem, Invoice, Transaction, Workspace } from '../../types';

/**
 * L-94: what a document's entry builder (postingCore, no browser code) needs, read from the database — the chart,
 * the workspace (mappings, base currency, closing date), the document's earlier entries, the stock items an invoice
 * sells and, for a credit note, the invoice it credits with that invoice's entries. Used by POST
 * /documents/:type/:id/post, which builds the entries itself (documentPostService.ts). Moved here unchanged from the
 * L-94 shadow check (now src/tests/helpers/postingShadowCheck.ts: the browser no longer sends document entries).
 */

/** Each document that posts: the metadata key its entries carry. */
export const DOCUMENT_ENTRY_KEY: Record<string, string> = { invoices: 'invoiceId', bills: 'billId', creditNotes: 'creditNoteId', vendorCredits: 'vendorCreditId' };

/** The workspace's today (YYYY-MM-DD) in its time zone, else UTC. */
export function todayIn(timezone?: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const get = (type: string) => parts.find(p => p.type === type)?.value;
    if (get('year') && get('month') && get('day')) return `${get('year')}-${get('month')}-${get('day')}`;
  } catch { /* an unknown time zone: UTC below */ }
  return new Date().toISOString().slice(0, 10);
}

const DAY_MS = 86_400_000;

/**
 * The day to build with (L-94): the browser's, when it is a real date within one day of the server's own today (near
 * midnight a browser in another time zone is a day apart: the person sees that day, and it dates reversals into a
 * closed period); else the server's. Moved here from the shadow check, which now lives in the tests.
 */
export function agreedPostingDay(serverToday: string, browserDay: unknown): string {
  if (typeof browserDay !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(browserDay)) return serverToday;
  const gap = Math.abs(Date.parse(`${browserDay}T00:00:00Z`) - Date.parse(`${serverToday}T00:00:00Z`));
  return Number.isFinite(gap) && gap <= DAY_MS ? browserDay : serverToday;
}

export async function loadPostingContext(db: Firestore, input: {
  workspaceId: string; uid: string; collection: string; docId: string;
  document: Record<string, unknown>; workspace: Record<string, unknown>;
  /** entries to leave out (the tests' shadow rebuild: what the request it checks has just written) */
  exclude?: Set<string>;
  /** the save already passed the server's period check: the closing date dates reversals but refuses nothing */
  lockChecked: boolean;
}): Promise<LedgerPostContext> {
  const { workspaceId, uid, collection, docId, document, workspace } = input;
  const key = DOCUMENT_ENTRY_KEY[collection];
  if (!key) throw new Error(`${collection} is not a document that posts`);
  const postedIds = input.exclude || new Set<string>();
  const [chart, entries] = await Promise.all([
    db.collection('chartAccounts').where('workspaceId', '==', workspaceId).get(),
    db.collection('transactions').where('workspaceId', '==', workspaceId).where(`metadata.${key}`, '==', docId).get(),
  ]);

  // the document's entries as they were before this request: everything except what it just wrote
  const before = entries.docs.map(d => ({ ...d.data(), id: d.id }) as Transaction).filter(tx => !postedIds.has(tx.id));

  // the stock items an invoice sells, for its cost of goods
  const itemIds = collection === 'invoices'
    ? [...new Set(((document.items || []) as Array<{ itemId?: string }>).map(l => l.itemId).filter((id): id is string => Boolean(id)))]
    : [];
  const inventory = (await Promise.all(itemIds.map(async id => {
    const snap = await db.collection('inventory').doc(id).get();
    const item = snap.data();
    return item && item.workspaceId === workspaceId ? ({ ...item, id } as InventoryItem) : null;
  }))).filter((i): i is InventoryItem => i !== null);

  // a credit note that takes goods back needs the invoice it credits and that invoice's entries (what left stock)
  const creditedId = collection === 'creditNotes' && typeof document.invoiceId === 'string' ? document.invoiceId : '';
  const credited = creditedId ? (await db.collection('invoices').doc(creditedId).get()).data() : undefined;
  const invoices = credited && credited.workspaceId === workspaceId ? [{ ...credited, id: creditedId } as Invoice] : [];
  const ofInvoice = invoices.length
    ? (await db.collection('transactions').where('workspaceId', '==', workspaceId).where('metadata.invoiceId', '==', creditedId).get()).docs.map(d => ({ ...d.data(), id: d.id }) as Transaction)
    : [];
  // other credit notes' returns on this invoice, with their reversals (a deleted credit note's reversal carries only its creditNoteId)
  const otherNotes = [...new Set(ofInvoice.map(tx => tx.metadata?.creditNoteId).filter((id): id is string => typeof id === 'string' && id !== docId))];
  const ofOtherNotes = (await Promise.all(otherNotes.map(async id => (await db.collection('transactions').where('workspaceId', '==', workspaceId).where('metadata.creditNoteId', '==', id).get()).docs
    .map(d => ({ ...d.data(), id: d.id }) as Transaction)))).flat();
  const seen = new Set(before.map(tx => tx.id));
  const invoiceEntries = [...ofInvoice, ...ofOtherNotes].filter(tx => !postedIds.has(tx.id) && !seen.has(tx.id) && (seen.add(tx.id), true));

  return {
    accounts: chart.docs.map(d => ({ ...d.data(), id: d.id }) as ChartAccount),
    workspaces: [{ ...workspace, id: workspaceId } as Workspace],
    transactions: [...before, ...invoiceEntries],
    invoices,
    inventory,
    // the closing date as this user sees it: it dates the reversals of entries in a closed period, and (unless the
    // save was already checked) refuses a document dated in a closed period, as in the browser
    lockDate: effectiveLockDate(workspace as never, uid),
    // its partial unlock too, so a reopened day is open here as in the browser and the activity preview
    lockException: (workspace.lockException ?? null) as { fromDate?: string; toDate?: string } | null,
    lockChecked: input.lockChecked,
    uid,
    today: todayIn(workspace.timezone as string | undefined),
    capture: [],
  };
}
