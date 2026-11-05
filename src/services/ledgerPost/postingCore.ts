import { ChartAccount, Transaction, TransactionLine, Workspace, Invoice, InventoryItem } from '../../types';
import type { LineAccountWeight } from '../../kernel/templates/TransactionTemplates';
import { isLockedDate } from '../../lib/periodLock';
import { rateUsedFor, rateUsedId, type RateUsed } from '../../lib/rateUsed';
import { minorUnitRate } from '../../lib/currencyMinorUnits';

// What every posting needs (F-11, moved from LedgerPostService): the data to post against, the
// period-lock check, account lookup and the one call that sends entries to the server.
//
// L-94 step 0: this file has no browser imports (no Firebase client, no stores, no toasts), so the
// server can run the same entry builders. Where a builder needs the screen's data or must send its
// entries, it asks the registered PostingHost; the browser registers one in postingKit.ts. Without a
// host, everything must come in the LedgerPostContext, and entries are only collected (context.capture).

export interface EntityMutation {
  collection: string;
  docId: string;
  action: 'create' | 'update' | 'delete';
  data?: Record<string, unknown>;
}

export interface LedgerPostContext {
  accounts?: ChartAccount[];
  /** the invoices a credit note's returned goods are checked against (BF-06) */
  invoices?: Invoice[];
  lockDate?: string | null;
  /** the workspace's partial unlock: a day inside it is open, as in the browser (CodeRabbit on #447) */
  lockException?: { fromDate?: string; toDate?: string } | null;
  transactions?: Transaction[];
  workspaces?: Workspace[];
  inventory?: InventoryItem[];
  idempotencyKey?: string;
  bypassPost?: boolean;
  uid?: string;
  /** the day the books count as today (the workspace's time zone); without it, the host's or UTC */
  today?: string;
  /** L-94: collect the entries a builder would send here, instead of sending them */
  capture?: Array<{ txs: PostableTransaction[]; entityMutation?: EntityMutation }>;
  /** the save already passed the period check (the server's shadow rebuild): the lock date still dates reversals, but refuses nothing */
  lockChecked?: boolean;
}

export type PostableTransaction = Omit<Partial<Transaction>, 'lines' | 'status' | 'type'> & {
  uid: string;
  workspaceId: string;
  date: string;
  description: string;
  totalAmountCents: number;
  currency?: string;
  status?: Transaction['status'] | string;
  type?: Transaction['type'] | string;
  lines: TransactionLine[];
};

/** Where the browser's own data and transport come from (postingKit.ts); absent on the server. */
export interface PostingHost {
  accounts(): ChartAccount[];
  transactions(): Transaction[];
  invoices(): Invoice[];
  workspaces(): Workspace[];
  lockDate(): string | null;
  lockException(): unknown;
  loadInventory(invoiceData: Partial<Invoice>): Promise<InventoryItem[]>;
  today(): string;
  uid(): string | undefined;
  send(txs: PostableTransaction[], workspaceId: string, entityMutation?: EntityMutation, context?: LedgerPostContext): Promise<void>;
}

let host: PostingHost | null = null;

export function registerPostingHost(next: PostingHost | null): void {
  host = next;
}

/** Today for a posting: the caller's day, else the host's (the workspace's time zone), else UTC. */
export function postingToday(context?: LedgerPostContext): string {
  return context?.today || host?.today() || new Date().toISOString().slice(0, 10);
}

/** Who is posting: the caller's uid, else the signed-in user, else 'system'. */
export function postingUid(context?: LedgerPostContext): string {
  return context?.uid || host?.uid() || 'system';
}

export function getAccounts(context?: LedgerPostContext): ChartAccount[] {
  return context?.accounts || host?.accounts() || [];
}

export function getLockDate(context?: LedgerPostContext): string | null {
  if (context && context.lockDate !== undefined) return context.lockDate;
  return host ? host.lockDate() : null;
}

export function getTransactions(context?: LedgerPostContext): Transaction[] {
  return context?.transactions || host?.transactions() || [];
}

export function getInvoices(context?: LedgerPostContext): Invoice[] {
  return context?.invoices || host?.invoices() || [];
}

export function getWorkspaces(context?: LedgerPostContext): Workspace[] {
  return context?.workspaces || host?.workspaces() || [];
}

/** The lock exception (a reopened range): the given context's when it sets the lock, else the browser's own. */
function lockException(context?: LedgerPostContext): unknown {
  return context && context.lockDate !== undefined ? context.lockException ?? null : host?.lockException() ?? null;
}

/**
 * The items an invoice sells, for cost of goods sold: the caller's list, else what the host has
 * loaded (plus any item on the invoice not loaded yet; postingKit.ts reads those from the database).
 */
export async function loadInventory(invoiceData: Partial<Invoice>, context?: LedgerPostContext): Promise<InventoryItem[]> {
  if (context?.inventory) return context.inventory;
  return host ? host.loadInventory(invoiceData) : [];
}

/**
 * New postings are recorded in the base currency. The amounts are converted once
 * (document amount × the document's rate) before they get here, so the entry and every line
 * carry rate 1; otherwise lineAmount() would apply the rate a second time. The document's own
 * currency and rate are kept in metadata. Reversals keep the rates of what they reverse.
 */
export function inBaseCurrency<T extends { currency?: string; exchangeRate?: number; date?: string; lines: TransactionLine[]; metadata?: Record<string, unknown> }>(
  tx: T, workspaceId: string, context?: LedgerPostContext, recordedRate?: Partial<RateUsed> | null,
): T {
  const baseCurrency = getWorkspaces(context).find(w => w.id === workspaceId)?.currency || 'USD';
  const documentCurrency = tx.currency || baseCurrency;
  // BM-06: a converted entry says which rate it used (its day and where it came from), on the entry and on each line
  const rateUsed = documentCurrency !== baseCurrency
    ? rateUsedFor({ currency: documentCurrency, base: baseCurrency, rate: tx.exchangeRate || 1, date: String(tx.date || ''), recorded: recordedRate })
    : null;
  return {
    ...tx,
    currency: baseCurrency,
    exchangeRate: 1,
    metadata: { ...(tx.metadata || {}), documentCurrency, documentExchangeRate: tx.exchangeRate || 1, ...(rateUsed ? { rateUsed } : {}) },
    lines: tx.lines.map(l => ({ ...l, exchangeRate: 1, ...(rateUsed ? { rateUsedId: rateUsedId(rateUsed) } : {}) })),
  };
}

/**
 * BM-04: the factor from a document's amounts (minor units of its currency) to the books' (minor units of the
 * workspace currency): the document's exchange rate × 10^(books' decimals − document's). A document in the books'
 * currency, or one of the same decimals, converts by its rate alone, as before.
 */
export function documentMinorRate(doc: { currency?: string; exchangeRate?: number }, workspaceId: string, context?: LedgerPostContext): number {
  const baseCurrency = getWorkspaces(context).find(w => w.id === workspaceId)?.currency || 'USD';
  return minorUnitRate(doc.exchangeRate || 1, doc.currency || baseCurrency, baseCurrency);
}

/**
 * Period Lock Guard
 */
export function verifyLockDate(dateStr: string, context?: LedgerPostContext): void {
  if (!dateStr || context?.lockChecked) return;
  const lockDate = getLockDate(context);
  if (isLockedDate(dateStr, lockDate, lockException(context) as never)) {
    throw new Error(`Period is locked on or before ${lockDate}. Cannot post or modify transaction on ${dateStr}.`);
  }
}

/**
 * The day to reverse a document's earlier entry when the document is edited, voided or deleted: the
 * earlier entry's own date while that day is open, so its month nets to the corrected amount (dated
 * today, the old amount stayed in the document's month next to the new one and the month's reports
 * were wrong; found by the main-path test, DA-08); today when that day is closed, so closed books are
 * corrected in the current period instead.
 */
export function reversalDate(originalDate: string | undefined, today: string, context?: LedgerPostContext): string {
  if (!originalDate) return today;
  const day = originalDate.slice(0, 10);
  return isLockedDate(day, getLockDate(context), lockException(context) as never) ? today : day;
}

/** Workspace mapping first, then the first chart account matching the predicate. */
export function findAccount(
  accounts: ChartAccount[],
  workspaceMappings: Record<string, string>,
  keys: string[],
  predicate: (a: ChartAccount) => boolean
): { id: string; name: string } | undefined {
  for (const key of keys) {
    const mappedId = workspaceMappings[key.toLowerCase()];
    const acc = mappedId ? accounts.find(a => a.id === mappedId) : undefined;
    if (acc) return { id: acc.id, name: acc.name };
  }
  const found = accounts.find(predicate);
  return found ? { id: found.id, name: found.name } : undefined;
}

/**
 * Resolve specific accounts using workspace mappings first, then CHART fallbacks, or throw loudly.
 */
export function resolveAccount(
  accounts: ChartAccount[],
  workspaceMappings: Record<string, string>,
  keys: string[],
  predicate: (a: ChartAccount) => boolean,
  errorName: string
): { id: string; name: string } {
  const found = findAccount(accounts, workspaceMappings, keys, predicate);
  if (found) return found;

  // 3. Fail loudly instead of using fake fallback IDs
  throw new Error(`Missing ${errorName} account. Please set up a ${errorName} account in Chart of Accounts or Workspace Settings.`);
}

/**
 * The account chosen on each document line (by id, or by name for lines typed by hand), so
 * revenue / cost goes where the user put it (L-115). A line without a usable account uses the
 * document's default account. Returns undefined when there are no lines.
 */
export function lineAccounts(
  lines: Array<{ accountId?: string; amountCents?: number; dimensions?: Record<string, string> }> | undefined,
  accounts: ChartAccount[],
  fallback: { id: string; name: string },
  usable: (a: ChartAccount) => boolean
): LineAccountWeight[] | undefined {
  if (!Array.isArray(lines) || lines.length === 0) return undefined;
  return lines.map(line => {
    const key = String(line.accountId || '').trim();
    const account = key ? accounts.find(a => a.id === key) || accounts.find(a => (a.name || '').toLowerCase() === key.toLowerCase()) : undefined;
    // the line's labels (BF-09), without empty ones
    const labels = Object.fromEntries(Object.entries(line.dimensions || {})
      .filter(([k, v]) => k && typeof v === 'string' && v.trim() !== '').map(([k, v]) => [k, v.trim()]));
    return {
      account: account && usable(account) ? { id: account.id, name: account.name } : fallback,
      weightCents: Number(line.amountCents) || 0,
      ...(Object.keys(labels).length > 0 ? { dimensions: labels } : {}),
    };
  });
}

/**
 * Send the entries (and the document change) to the server in one request — through the host. With
 * `context.capture`, the entries are collected there instead and nothing is sent (L-94).
 */
export async function postTxsServerApi(
  txs: PostableTransaction[],
  workspaceId: string,
  entityMutation?: EntityMutation,
  context?: LedgerPostContext
): Promise<void> {
  if ((!txs || txs.length === 0) && !entityMutation) return;
  if (context?.capture) {
    context.capture.push({ txs: txs || [], ...(entityMutation ? { entityMutation } : {}) });
    return;
  }
  if (!host) throw new Error('Postings cannot be sent here: no posting host is registered (pass context.capture to collect them)');
  await host.send(txs, workspaceId, entityMutation, context);
}

/**
 * EG-12: what an invoice's or bill's tax entry line keeps of the tax it used, as the document saved it: the code, its
 * treatment and each part's rate and amount, and `taxRate` when the code has one part. Read from the
 * document, never from the workspace's current rates, so the entry shows the breakdown it was posted with.
 */
export function taxLineStamp(doc: { taxCodeId?: string; taxTreatment?: TransactionLine['taxTreatment']; taxBreakdown?: Array<{ name: string; rate: number; taxCents: number }> }): Partial<TransactionLine> {
  const parts = (Array.isArray(doc.taxBreakdown) ? doc.taxBreakdown : [])
    .filter(p => p && Number.isFinite(Number(p.rate)))
    .map(p => ({ name: String(p.name), rate: Number(p.rate), taxCents: Math.round(Number(p.taxCents) || 0) }));
  if (!doc.taxCodeId && parts.length === 0) return {};
  return {
    ...(parts.length === 1 ? { taxRate: parts[0].rate } : {}),
    ...(doc.taxCodeId ? { taxCodeId: doc.taxCodeId } : {}),
    ...(doc.taxTreatment ? { taxTreatment: doc.taxTreatment } : {}),
    ...(parts.length ? { taxBreakdown: parts } : {}),
  };
}
