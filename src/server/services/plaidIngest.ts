import crypto from 'crypto';
import type { Firestore } from '../db/firestore';
import { existingImportIdentities, prepareBankRuleSuggestions } from './bankRuleService';
import { currencyDigits } from '../../lib/currencyMinorUnits';

/** One row of Plaid's /transactions/sync `added` or `modified` list, as far as a bank line needs it. */
interface PlaidRow {
  transaction_id?: unknown;
  account_id?: unknown;
  date?: unknown;
  name?: unknown;
  merchant_name?: unknown;
  amount?: unknown;
  pending?: unknown;
  iso_currency_code?: unknown;
  unofficial_currency_code?: unknown;
}

export interface PlaidBankLine {
  id: string;
  date: string;
  description: string;
  amountCents: number;
  currency: string;
  status: 'pending';
  matchedTransactionId: null;
  accountId?: string;
  plaidAccountId?: string;
  importIdentity: string;
  bankId: string;
  source: 'plaid';
}

/** The connection a sync belongs to: its ledger account, the Plaid account it is tied to, the books' currency. */
export interface PlaidConnection {
  id: string;
  accountId?: unknown;
  plaidAccountId?: unknown;
  workspaceCurrency?: unknown;
}

/** The fingerprint of a Plaid row: Plaid's own transaction id. */
export const plaidIdentity = (transactionId: string) => `plaid:${transactionId}`.slice(0, 300);

/**
 * The Plaid account a connection's ledger account stands for. It is the one saved on the connection;
 * when none is saved yet and every row of this sync comes from one Plaid account, that account (saved
 * with the cursor). Rows from any other Plaid account of the same bank login get no ledger account.
 */
export function plaidAccountFor(connection: PlaidConnection, rows: unknown[]): string | undefined {
  if (typeof connection.plaidAccountId === 'string' && connection.plaidAccountId) return connection.plaidAccountId;
  const seen = new Set(rows.map(r => (r as PlaidRow)?.account_id).filter((v): v is string => typeof v === 'string' && !!v));
  return seen.size === 1 ? [...seen][0] : undefined;
}

/**
 * AF-001: Plaid's posted rows as pending bank lines. A pending card authorisation is left out: Plaid
 * removes it and adds the posted row later, so storing it would leave a line for money that never moved.
 * The amount is in the row's own currency, with that currency's decimals. The connection's ledger
 * account is set only for rows of the Plaid account it stands for and in the books' currency; any other
 * row is stored for review without one, never booked to the wrong account or as home-currency money.
 */
export function plaidRowsAsBankLines(rows: unknown[], connection: PlaidConnection, workspaceId: string, plaidAccountId = plaidAccountFor(connection, rows)): PlaidBankLine[] {
  const lines: PlaidBankLine[] = [];
  const homeCurrency = typeof connection.workspaceCurrency === 'string' && connection.workspaceCurrency ? connection.workspaceCurrency.toUpperCase() : 'USD';
  for (const raw of rows) {
    const row = (raw || {}) as PlaidRow;
    if (row.pending === true) continue;
    const txId = typeof row.transaction_id === 'string' ? row.transaction_id : '';
    const date = typeof row.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.date) ? row.date : '';
    const amount = typeof row.amount === 'number' && Number.isFinite(row.amount) ? row.amount : NaN;
    if (!txId || !date || Number.isNaN(amount)) continue;
    const currency = String((typeof row.iso_currency_code === 'string' && row.iso_currency_code) || (typeof row.unofficial_currency_code === 'string' && row.unofficial_currency_code) || homeCurrency).toUpperCase().slice(0, 12);
    // Plaid: a positive amount is money out of the account; a bank line is signed as the account moves
    const amountCents = Math.round(-amount * 10 ** currencyDigits(currency)) || 0;
    const description = String((typeof row.name === 'string' && row.name) || (typeof row.merchant_name === 'string' && row.merchant_name) || 'Bank transaction').slice(0, 1000);
    const rowAccount = typeof row.account_id === 'string' && row.account_id ? row.account_id : undefined;
    const ownAccount = rowAccount === undefined || rowAccount === plaidAccountId;
    const ledgerAccount = ownAccount && currency === homeCurrency && typeof connection.accountId === 'string' && connection.accountId ? connection.accountId.slice(0, 200) : undefined;
    lines.push({
      id: `plaid_${crypto.createHash('sha256').update(`${workspaceId}:${txId}`).digest('hex').slice(0, 40)}`,
      date, description, amountCents, currency, status: 'pending', matchedTransactionId: null,
      ...(ledgerAccount ? { accountId: ledgerAccount } : {}),
      ...(rowAccount ? { plaidAccountId: rowAccount.slice(0, 200) } : {}),
      importIdentity: plaidIdentity(txId),
      bankId: connection.id,
      source: 'plaid',
    });
  }
  return lines;
}

/**
 * AF-001: everything one sync downloaded, saved in one database transaction with the connection's new
 * cursor: new rows become pending bank lines; a correction (`modified`) updates a line still pending
 * and unmatched; a deletion (`removed`) removes a line still pending and unmatched. A line already
 * matched to a posted entry is never changed here: it is flagged (`bankChange`) for someone to review.
 * Either all of it is kept or none, so a failure repeats the same rows on the next sync.
 */
/** Rows stored per database transaction, so a first sync of a busy account is never one huge write. */
export const PLAID_STORE_CHUNK = 500;

/** Another sync of the same bank moved the cursor on while this one ran: nothing of this one is kept. */
export const PLAID_SYNC_CONFLICT = 'The bank was synced by another request meanwhile. Sync again.';

export async function storePlaidSync(db: Firestore, input: {
  workspaceId: string; uid: string; bankRef: { id: string }; lines: PlaidBankLine[]; bankUpdate: Record<string, unknown>;
  /** the cursor this sync started from: the cursor write is refused if another sync has moved the bank on */
  expectedCursor?: string;
  modified?: PlaidBankLine[]; removed?: string[];
}): Promise<{ stored: number; corrected: number; removed: number; flagged: number }> {
  // (Codex on #439) a long history is stored in bounded chunks; every chunk but the last carries no cursor,
  // so the cursor still never moves past a row that is not stored. A failure after some chunks keeps
  // those rows; the next sync brings them again and they are skipped as already stored.
  // corrections and deletions are chunked too (Codex on #439): applying one twice changes nothing, so a
  // retry after a part-done run is safe; only the very last transaction carries the cursor
  type Chunk = { lines: PlaidBankLine[]; modified: PlaidBankLine[]; removed: string[] };
  const chunks: Chunk[] = [];
  const slices = <T>(list: T[]) => { const out: T[][] = []; for (let i = 0; i < list.length; i += PLAID_STORE_CHUNK) out.push(list.slice(i, i + PLAID_STORE_CHUNK)); return out; };
  for (const lines of slices(input.lines)) chunks.push({ lines, modified: [], removed: [] });
  for (const modified of slices(input.modified || [])) chunks.push({ lines: [], modified, removed: [] });
  for (const removed of slices(input.removed || [])) chunks.push({ lines: [], modified: [], removed });
  if (chunks.length === 0) chunks.push({ lines: [], modified: [], removed: [] });
  const total = { stored: 0, corrected: 0, removed: 0, flagged: 0 };
  for (let c = 0; c < chunks.length; c++) {
    const last = c === chunks.length - 1;
    const r = await storePlaidChunk(db, { ...input, ...chunks[c], bankUpdate: last ? input.bankUpdate : undefined });
    total.stored += r.stored; total.corrected += r.corrected; total.removed += r.removed; total.flagged += r.flagged;
  }
  return total;
}

async function storePlaidChunk(db: Firestore, input: {
  workspaceId: string; uid: string; bankRef: { id: string }; lines: PlaidBankLine[]; bankUpdate?: Record<string, unknown>;
  expectedCursor?: string;
  modified?: PlaidBankLine[]; removed?: string[];
}): Promise<{ stored: number; corrected: number; removed: number; flagged: number }> {
  const result = { stored: 0, corrected: 0, removed: 0, flagged: 0 };
  await db.runTransaction(async (t) => {
    // reads first (the transaction refuses a read after a write)
    // (CodeRabbit on #439) two overlapping syncs: the one that commits last must not put an older cursor back.
    // Every chunk checks it (Codex on #439), so a stale sync never commits old corrections before its last chunk
    if ('expectedCursor' in input) {
      const bankNow = await t.get(db.collection('banks').doc(input.bankRef.id));
      const savedCursor = (bankNow.data() as { syncCursor?: unknown } | undefined)?.syncCursor;
      if ((typeof savedCursor === 'string' ? savedCursor : undefined) !== input.expectedCursor) {
        throw new Error(PLAID_SYNC_CONFLICT);
      }
    }
    const seen = await existingImportIdentities(db, t, input.workspaceId, input.lines);
    const inBatch = new Set<string>();
    const fresh = input.lines.filter(line => {
      if (seen.has(line.importIdentity) || inBatch.has(line.importIdentity)) return false;
      inBatch.add(line.importIdentity);
      return true;
    });
    const refs = fresh.map(line => db.collection('bankLines').doc(line.id));
    const taken = refs.length > 0 ? new Set((await t.getAll(...refs)).filter(s => s.exists).map(s => s.id)) : new Set<string>();
    const write = fresh.filter((_, i) => !taken.has(refs[i].id));
    const changes = [
      ...(input.modified || []).map(line => ({ kind: 'modified' as const, line, id: line.id })),
      ...(input.removed || []).map(txId => ({ kind: 'removed' as const, line: undefined, id: `plaid_${crypto.createHash('sha256').update(`${input.workspaceId}:${txId}`).digest('hex').slice(0, 40)}` })),
    ];
    const changeSnaps = changes.length > 0 ? await t.getAll(...changes.map(c => db.collection('bankLines').doc(c.id))) : [];
    // (CodeRabbit on #439) a correction for a row that was never stored is the only copy Plaid will send
    // once the cursor moves: it is stored as a new line, never dropped
    const batchIds = new Set(write.map(l => l.id));
    changes.forEach((change, i) => {
      if (change.kind === 'modified' && change.line && !changeSnaps[i]?.exists && !batchIds.has(change.id) && !seen.has(change.line.importIdentity)) {
        write.push(change.line);
        batchIds.add(change.id);
      }
    });
    const rules = await prepareBankRuleSuggestions(db, t, input.workspaceId, write);
    const now = new Date().toISOString();
    for (const line of write) {
      t.create(db.collection('bankLines').doc(line.id), { ...line, ...rules.fieldsFor(line), workspaceId: input.workspaceId, uid: input.uid, createdAt: now });
    }
    rules.apply();
    changes.forEach((change, i) => {
      const snap = changeSnaps[i];
      const current = snap?.exists ? snap.data() || {} : undefined;
      // only this workspace's Plaid lines; a correction for a row never stored is a new line next time Plaid sends it
      if (!current || current.workspaceId !== input.workspaceId || current.source !== 'plaid') return;
      const ref = db.collection('bankLines').doc(change.id);
      const open = (current.status ?? 'pending') === 'pending' && !current.matchedTransactionId;
      if (!open) {
        t.update(ref, { bankChange: change.kind, bankChangeAt: now, bankCorrection: change.line ? { date: change.line.date, description: change.line.description, amountCents: change.line.amountCents, currency: change.line.currency } : null });
        result.flagged += 1;
      } else if (change.kind === 'removed') {
        t.delete(ref);
        result.removed += 1;
      } else if (change.line) {
        // (Codex on #439) the rule suggestion was made for the old text and amount: it is dropped, not offered
        t.update(ref, { date: change.line.date, description: change.line.description, amountCents: change.line.amountCents, currency: change.line.currency, suggestion: null, updatedAt: now });
        result.corrected += 1;
      }
    });
    if (input.bankUpdate) t.update(db.collection('banks').doc(input.bankRef.id), input.bankUpdate);
    result.stored = write.length;
  });
  return result;
}
