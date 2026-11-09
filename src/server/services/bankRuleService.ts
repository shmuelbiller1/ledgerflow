import type { Firestore } from '../db/firestore';
import { FieldValue } from '../db/firestore';
import { workspaceRole } from '../../lib/periodLock';
import { sameSuggestion, suggestFromRules, type BankRuleContext, type BankRuleSuggestion } from '../../lib/bankRules';
import type { AutoRule, ChartAccount } from '../../types';
import { byCodeUnit } from '../../lib/codeUnitOrder';

/**
 * EG-9: the bank-feed rules run on the server (src/lib/bankRules.ts is the one rule function, shared
 * with the browser's import preview).
 * - prepareBankRuleSuggestions: inside the import's database transaction (POST /transactions/bulk,
 *   which the bank sync and the statement import both use), every new pending line gets the rules'
 *   suggestion. The line stays pending: nothing is posted until a person accepts it.
 * - rerunBankRules: the rules again over the lines not yet matched (owners and accountants).
 * A rule counts a hit on a line once: `ruleIdsApplied` on the line remembers every rule that ever
 * matched it, so re-running (or a repeated request) never counts or applies a rule twice.
 */

export class BankRuleError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

type Tx = Parameters<Parameters<Firestore['runTransaction']>[0]>[0];
type Reader = Pick<Tx, 'get'>;

export const MAX_RERUN_LINES = 5000;
const RERUN_CHUNK = 200;

/** The workspace's rules and the accounts and contacts a suggestion may name. */
export async function loadBankRuleInputs(db: Firestore, reader: Reader | null, workspaceId: string): Promise<{ rules: AutoRule[]; context: BankRuleContext }> {
  const read = (collection: string) => {
    const q = db.collection(collection).where('workspaceId', '==', workspaceId);
    return reader ? reader.get(q) : q.get();
  };
  // one after another: a transaction's reads share one database connection
  const rulesSnap = await read('autoRules');
  const accountsSnap = await read('chartAccounts');
  const customersSnap = await read('customers');
  const vendorsSnap = await read('vendors');
  const rules = rulesSnap.docs.map(d => ({ ...(d.data() as AutoRule), id: d.id })).filter(r => r.workspaceId === workspaceId);
  const accounts = accountsSnap.docs.map(d => ({ ...(d.data() as ChartAccount), id: d.id }));
  const contacts = [
    ...customersSnap.docs.map(d => ({ id: d.id, kind: 'customer' as const })),
    ...vendorsSnap.docs.map(d => ({ id: d.id, kind: 'vendor' as const })),
  ];
  return { rules, context: { accounts, contacts } };
}

interface LineLike { status?: string; matchedTransactionId?: string | null; description?: string; payee?: string; amountCents: number; date: string; ruleIdsApplied?: string[] }

/** What a line's rule fields become, and which rules hit it for the first time. */
export function ruleFieldsFor(rules: AutoRule[], context: BankRuleContext, line: LineLike, now: string) {
  const suggestion = suggestFromRules(rules, line, context);
  const before = Array.isArray(line.ruleIdsApplied) ? line.ruleIdsApplied : [];
  const firstHits = (suggestion?.ruleIds || []).filter(id => !before.includes(id));
  return {
    suggestion,
    firstHits,
    fields: { suggestion, ruleIdsApplied: [...before, ...firstHits], ...(suggestion ? { rulesAppliedAt: now } : {}) },
  };
}

/** Each rule's hit count raised by the lines it matched for the first time (rules deleted meanwhile are skipped). */
async function countHits(db: Firestore, t: Tx, hits: Map<string, number>, now: string) {
  const ids = [...hits.keys()];
  if (!ids.length) return () => undefined;
  const refs = ids.map(id => db.collection('autoRules').doc(id));
  const snaps = await t.getAll(...refs);
  return () => snaps.forEach((snap, i) => {
    if (snap.exists) t.update(refs[i], { hitCount: FieldValue.increment(hits.get(ids[i])!), lastTriggeredAt: now });
  });
}

const addHits = (hits: Map<string, number>, ids: string[]) => ids.forEach(id => hits.set(id, (hits.get(id) || 0) + 1));

/**
 * For the import: the rule fields of each new line (only pending lines not matched to an entry), read
 * inside the import's transaction. Call apply() with the writes; it raises the rules' hit counts.
 */
export async function prepareBankRuleSuggestions<L extends LineLike>(db: Firestore, t: Tx, workspaceId: string, lines: L[]) {
  const now = new Date().toISOString();
  const open = lines.some(l => (l.status ?? 'pending') === 'pending' && !l.matchedTransactionId);
  if (!open) return { fieldsFor: (_line: L) => ({}), apply: () => undefined };
  const { rules, context } = await loadBankRuleInputs(db, t, workspaceId);
  const hits = new Map<string, number>();
  const fields = new Map<L, Record<string, unknown>>();
  for (const line of lines) {
    if ((line.status ?? 'pending') !== 'pending' || line.matchedTransactionId) continue;
    const r = ruleFieldsFor(rules, context, { ...line, ruleIdsApplied: [] }, now);
    fields.set(line, r.fields);
    addHits(hits, r.firstHits);
  }
  const applyHits = await countHits(db, t, hits, now);
  return { fieldsFor: (line: L) => fields.get(line) || {}, apply: applyHits };
}

/** The fingerprints among `lines` that a bank line of the workspace already has. */
export async function existingImportIdentities(db: Firestore, reader: Reader | null, workspaceId: string, lines: Array<{ importIdentity?: string }>): Promise<Set<string>> {
  const wanted = [...new Set(lines.map(l => l.importIdentity).filter((v): v is string => !!v))];
  const found = new Set<string>();
  for (let i = 0; i < wanted.length; i += 500) {
    const q = db.collection('bankLines').where('workspaceId', '==', workspaceId).where('importIdentity', 'in', wanted.slice(i, i + 500));
    const snap = reader ? await reader.get(q) : await q.get();
    snap.docs.forEach(d => { const v = d.data().importIdentity; if (typeof v === 'string') found.add(v); });
  }
  return found;
}

export interface RerunResult { checked: number; changed: number; suggested: number; truncated: boolean; nextCursor?: string }

/** POST /api/v1/transactions/bank-lines/apply-rules: the rules again over the pending lines (owners and accountants). */
export async function rerunBankRules(db: Firestore, input: { workspaceId: string; uid: string; after?: string; limit?: number }): Promise<RerunResult> {
  const ws = (await db.collection('workspaces').doc(input.workspaceId).get()).data();
  if (!ws) throw new BankRuleError(404, 'Workspace not found');
  const role = workspaceRole(ws as never, input.uid);
  if (role !== 'owner' && role !== 'accountant') throw new BankRuleError(403, 'Only owners and accountants re-run the bank rules');

  const snap = await db.collection('bankLines').where('workspaceId', '==', input.workspaceId).where('status', '==', 'pending').get();
  // by id, from after the cursor: a workspace with more lines than one call takes goes on with nextCursor
  const limit = Math.max(1, Math.min(MAX_RERUN_LINES, Math.floor(input.limit ?? MAX_RERUN_LINES)));
  const pendingIds = snap.docs.filter(d => !d.data().matchedTransactionId).map(d => d.id).sort(byCodeUnit)
    .filter(id => input.after === undefined || id > input.after);
  const ids = pendingIds.slice(0, limit);
  const { rules, context } = await loadBankRuleInputs(db, null, input.workspaceId);
  const truncated = pendingIds.length > ids.length;
  const result: RerunResult = { checked: 0, changed: 0, suggested: 0, truncated, ...(truncated ? { nextCursor: ids[ids.length - 1] } : {}) };
  for (let i = 0; i < ids.length; i += RERUN_CHUNK) {
    const chunk = ids.slice(i, i + RERUN_CHUNK);
    const part = await db.runTransaction(async (t) => {
      const now = new Date().toISOString();
      const refs = chunk.map(id => db.collection('bankLines').doc(id));
      const snaps = await t.getAll(...refs);
      const writes: Array<{ ref: (typeof refs)[number]; fields: Record<string, unknown> }> = [];
      const hits = new Map<string, number>();
      let checked = 0; let suggested = 0;
      snaps.forEach((s, j) => {
        const line = s.data() as (LineLike & { workspaceId?: string; suggestion?: BankRuleSuggestion | null }) | undefined;
        // read again in the transaction: a line matched or cleared meanwhile is left alone
        if (!line || line.workspaceId !== input.workspaceId || line.status !== 'pending' || line.matchedTransactionId) return;
        checked += 1;
        const r = ruleFieldsFor(rules, context, line, now);
        if (r.suggestion) suggested += 1;
        if (sameSuggestion(r.suggestion, line.suggestion ?? null) && r.firstHits.length === 0) return;
        writes.push({ ref: refs[j], fields: r.fields });
        addHits(hits, r.firstHits);
      });
      const applyHits = await countHits(db, t, hits, now);
      writes.forEach(w => t.update(w.ref, w.fields));
      applyHits();
      return { checked, suggested, changed: writes.length };
    });
    result.checked += part.checked; result.suggested += part.suggested; result.changed += part.changed;
  }
  return result;
}
