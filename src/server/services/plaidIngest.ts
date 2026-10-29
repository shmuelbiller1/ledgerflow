import crypto from 'crypto';
import type { Firestore } from '../db/firestore';
import { existingImportIdentities, prepareBankRuleSuggestions } from './bankRuleService';

/** One row of Plaid's /transactions/sync `added` list, as far as a bank line needs it. */
interface PlaidRow {
  transaction_id?: unknown;
  date?: unknown;
  name?: unknown;
  merchant_name?: unknown;
  amount?: unknown;
  pending?: unknown;
}

export interface PlaidBankLine {
  id: string;
  date: string;
  description: string;
  amountCents: number;
  status: 'pending';
  matchedTransactionId: null;
  accountId?: string;
  importIdentity: string;
  bankId: string;
  source: 'plaid';
}

/**
 * AF-001: Plaid's posted rows as pending bank lines. A pending card authorisation is left out: Plaid
 * removes it and adds the posted row later, so storing it would leave a line for money that never moved.
 * The fingerprint is Plaid's own transaction id, so the same row arriving again is never a second line.
 */
export function plaidRowsAsBankLines(rows: unknown[], bank: { id: string; accountId?: unknown }, workspaceId: string): PlaidBankLine[] {
  const lines: PlaidBankLine[] = [];
  for (const raw of rows) {
    const row = (raw || {}) as PlaidRow;
    if (row.pending === true) continue;
    const txId = typeof row.transaction_id === 'string' ? row.transaction_id : '';
    const date = typeof row.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.date) ? row.date : '';
    const amount = typeof row.amount === 'number' && Number.isFinite(row.amount) ? row.amount : NaN;
    if (!txId || !date || Number.isNaN(amount)) continue;
    // Plaid: a positive amount is money out of the account; a bank line is signed as the account moves
    const amountCents = Math.round(-amount * 100) || 0;
    const description = String((typeof row.name === 'string' && row.name) || (typeof row.merchant_name === 'string' && row.merchant_name) || 'Bank transaction').slice(0, 1000);
    lines.push({
      id: `plaid_${crypto.createHash('sha256').update(`${workspaceId}:${txId}`).digest('hex').slice(0, 40)}`,
      date, description, amountCents, status: 'pending', matchedTransactionId: null,
      ...(typeof bank.accountId === 'string' && bank.accountId ? { accountId: bank.accountId.slice(0, 200) } : {}),
      importIdentity: `plaid:${txId}`.slice(0, 300),
      bankId: bank.id,
      source: 'plaid',
    });
  }
  return lines;
}

/**
 * AF-001: the downloaded rows and the connection's new cursor are saved in one database transaction.
 * Either both are kept or neither is, so a failure anywhere repeats the same rows on the next sync and
 * a row is never lost behind a cursor that already moved past it. Rows already stored are skipped.
 */
export async function storePlaidSync(db: Firestore, input: {
  workspaceId: string; uid: string; bankRef: { id: string }; lines: PlaidBankLine[]; bankUpdate: Record<string, unknown>;
}): Promise<{ stored: number }> {
  let stored = 0;
  await db.runTransaction(async (t) => {
    const seen = await existingImportIdentities(db, t, input.workspaceId, input.lines);
    const fresh = input.lines.filter((line, i, all) => !seen.has(line.importIdentity) && all.findIndex(l => l.importIdentity === line.importIdentity) === i);
    const refs = fresh.map(line => db.collection('bankLines').doc(line.id));
    const taken = refs.length > 0 ? new Set((await t.getAll(...refs)).filter(s => s.exists).map(s => s.id)) : new Set<string>();
    const write = fresh.filter((_, i) => !taken.has(refs[i].id));
    const rules = await prepareBankRuleSuggestions(db, t, input.workspaceId, write);
    const now = new Date().toISOString();
    for (const line of write) {
      t.create(db.collection('bankLines').doc(line.id), { ...line, ...rules.fieldsFor(line), workspaceId: input.workspaceId, uid: input.uid, createdAt: now });
    }
    rules.apply();
    t.update(db.collection('banks').doc(input.bankRef.id), input.bankUpdate);
    stored = write.length;
  });
  return { stored };
}
