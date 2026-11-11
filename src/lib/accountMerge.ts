/**
 * Merging two accounts (CA-33): a duplicate account ("Office supplies" and "Office Supplies 2") is
 * folded into the one kept. Everything that points at the merged account (entry and document lines,
 * items, rules, budgets, loans, assets, workspace defaults, child accounts) points at the kept one
 * afterwards, and the merged account is removed. Pure helpers here; the server does the merge in one
 * database transaction (src/server/services/accountMergeService.ts).
 */
import type { ChartAccount } from '../types';

import { BRAND_NAME } from '../config/brand';
/** Why the two accounts cannot be merged, or null. */
export function mergeProblem(from: ChartAccount | undefined, into: ChartAccount | undefined): string | null {
  if (!from || !into) return 'Both accounts must be in this workspace';
  if (from.id === into.id) return 'Choose two different accounts';
  if (from.type !== into.type) return `"${from.name}" is ${article(from.type)} and "${into.name}" is ${article(into.type)}; only accounts of the same kind can be merged`;
  if (from.currency && into.currency && from.currency !== into.currency) return `"${from.name}" is in ${from.currency} and "${into.name}" in ${into.currency}`;
  if (from.isSystem || from.role) return `"${from.name}" is used by ${BRAND_NAME} itself and cannot be merged away; merge the other account into it instead`;
  if (from.asOfDate && into.asOfDate && from.asOfDate.slice(0, 10) !== into.asOfDate.slice(0, 10) && (from.openingBalanceCents || 0) !== 0 && (into.openingBalanceCents || 0) !== 0) {
    return `The two opening balances are on different dates (${from.asOfDate.slice(0, 10)} and ${into.asOfDate.slice(0, 10)})`;
  }
  return null;
}

function article(type: string): string {
  return /^[aeiou]/i.test(type) ? `an ${type} account` : `a ${type} account`;
}

/**
 * Replaces the merged account's id with the kept one's everywhere in a stored record: as a value (a
 * line's `accountId`, a default account, a parent, a list member) and as a key (amounts by account,
 * added together when both are numbers). A line whose account changed takes the kept account's
 * name. Returns the new record and how many places changed (0: leave the record alone).
 */
export function replaceAccountId<T>(value: T, from: string, into: string, intoName: string): { value: T; changes: number } {
  let changes = 0;
  const walk = (node: unknown): unknown => {
    if (node === from) { changes++; return into; }
    if (Array.isArray(node)) {
      const out = node.map(walk);
      // a list of account ids that held both keeps one of them
      return out.every(v => typeof v === 'string') && node.includes(from) && node.includes(into) ? [...new Set(out)] : out;
    }
    if (!node || typeof node !== 'object') return node;
    const out: Record<string, unknown> = {};
    let renamedLine = false;
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      const next = walk(child);
      if (key === 'accountId' && child === from) renamedLine = true;
      const target = key === from ? into : key;
      if (key === from) changes++;
      if (Object.prototype.hasOwnProperty.call(out, target)) {
        // both accounts had an entry: numbers are added; otherwise the kept account's own one stays
        const first = out[target];
        out[target] = typeof first === 'number' && typeof next === 'number' ? first + next : key === from ? first : next;
      } else {
        out[target] = next;
      }
    }
    if (renamedLine && 'accountName' in out) out.accountName = intoName;
    return out;
  };
  const result = walk(value) as T;
  return { value: changes ? result : value, changes };
}

/** The kept account after the merge: opening balances, the stored balance and project shares added up. */
export function mergedAccount(from: ChartAccount, into: ChartAccount): Partial<ChartAccount> {
  const allocations: Record<string, number> = { ...(into.projectAllocations || {}) };
  for (const [project, cents] of Object.entries(from.projectAllocations || {})) allocations[project] = (allocations[project] || 0) + (Number(cents) || 0);
  const fromOpening = from.openingBalanceCents || 0;
  return {
    balanceCents: (into.balanceCents || 0) + (from.balanceCents || 0),
    ...(fromOpening ? { openingBalanceCents: (into.openingBalanceCents || 0) + fromOpening, ...(into.asOfDate ? {} : from.asOfDate ? { asOfDate: from.asOfDate } : {}) } : {}),
    ...(from.projectAllocations ? { projectAllocations: allocations } : {}),
    // the kept account must not end up under the account that disappears
    ...(into.parentId === from.id ? { parentId: from.parentId || '' } : {}),
  };
}

const WHAT: Record<string, [string, string]> = {
  transactions: ['entry', 'entries'], journalEntries: ['journal entry', 'journal entries'], invoices: ['invoice', 'invoices'],
  bills: ['bill', 'bills'], payments: ['payment', 'payments'], creditNotes: ['credit note', 'credit notes'], vendorCredits: ['vendor credit', 'vendor credits'],
  autoRules: ['rule', 'rules'], budgets: ['budget', 'budgets'], inventory: ['item', 'items'], chartAccounts: ['sub-account', 'sub-accounts'],
  recurring: ['recurring schedule', 'recurring schedules'], bankLines: ['bank line', 'bank lines'], loans: ['loan', 'loans'], assets: ['fixed asset', 'fixed assets'],
  settings: ['workspace setting', 'workspace settings'],
};

/** What a merge moves, in words: "12 entries, 1 bill, 2 rules". */
export function describeChanges(changes: Record<string, number>): string {
  const parts = Object.entries(changes).filter(([, n]) => n > 0)
    .map(([table, n]) => { const [one, many] = WHAT[table] || ['other record', 'other records']; return `${n} ${n === 1 ? one : many}`; });
  return parts.length ? parts.join(', ') : 'nothing else';
}
