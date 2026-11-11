/**
 * Required labels (Z-12): a workspace can say that entries on some accounts must carry a label,
 * e.g. "Property is required on Utilities" or "Project is required on Construction". The rule sits
 * on the label's own definition (`requiredOn` in Settings → Labels): the accounts, and the day it
 * applies from, so older entries are not suddenly flagged. Nothing is required unless a rule is set,
 * so simple books see nothing new.
 *
 * A line counts as labelled when `getLineDimension` finds a value for it (on the line, in its tags or
 * on the entry), or when every split of the line has one. Missing labels are a Data Health finding
 * that opens the entry, gone once it is labelled, and a warning in the journal form before saving.
 * Postable entries only (AGENTS.md): drafts and voided entries are never flagged.
 *
 * A rule can also refuse: then the server does not save an entry a person typed without the label
 * (`refusedLabels`, checked when entries are posted or edited). Entries LedgerFlow makes itself (cost
 * of goods sold, spreads, revaluations, payments, reversals) are never refused, only listed.
 */
import type { ChartAccount, DimensionDefinition, Transaction, TransactionLine } from '../types';
import { getLineDimension } from './dimensionUtils';
import { isPostable } from './txFilters';

export interface RequiredOn {
  /** the accounts whose lines need this label */
  accountIds: string[];
  /** YYYY-MM-DD: entries dated before it are not checked */
  since: string;
  /** the server refuses an entry a person typed without it (otherwise it is listed and warned about) */
  refuse?: boolean;
}

export interface MissingLabel {
  transactionId: string;
  date: string;
  description: string;
  accountId: string;
  accountName: string;
  dimensionId: string;
  dimensionName: string;
}

type LineLike = Pick<TransactionLine, 'accountId' | 'dimensions' | 'class' | 'location' | 'project' | 'department' | 'tags' | 'splitAllocations' | 'accountName'>;

interface CompiledLabelRule {
  dimensionId: string;
  dimensionName: string;
  accountIds: Set<string>;
  since: string;
  refuse: boolean;
}

const rulesCache = new WeakMap<DimensionDefinition[], CompiledLabelRule[]>();
const accountNameCache = new WeakMap<Pick<ChartAccount, 'id' | 'name'>[], Map<string, string>>();

/** The label rules of a workspace (only labels with at least one account). */
export function requiredLabelRules(dimensions: DimensionDefinition[] | undefined): CompiledLabelRule[] {
  if (!dimensions) return [];
  const cached = rulesCache.get(dimensions);
  if (cached) return cached;
  const compiled = dimensions.flatMap(d => (d.id !== 'category' && d.requiredOn?.accountIds?.length
    ? [{ dimensionId: d.id, dimensionName: d.name || d.id, accountIds: new Set(d.requiredOn.accountIds), since: d.requiredOn.since || '', refuse: d.requiredOn.refuse === true }]
    : []));
  rulesCache.set(dimensions, compiled);
  return compiled;
}

function accountNamesMap(accounts: Pick<ChartAccount, 'id' | 'name'>[]): Map<string, string> {
  const cached = accountNameCache.get(accounts);
  if (cached) return cached;
  const map = new Map(accounts.map(a => [a.id, a.name]));
  accountNameCache.set(accounts, map);
  return map;
}

function hasLabel(line: LineLike, tx: Pick<Transaction, 'tags' | 'dimensions' | 'projectId' | 'classId' | 'locationId'> | undefined, dimensionId: string): boolean {
  if (getLineDimension(line as TransactionLine, tx as Transaction | undefined, dimensionId) !== 'Unassigned') return true;
  const splits = line.splitAllocations || [];
  return splits.length > 0 && splits.every(s => Boolean(s.dimensions?.[dimensionId]));
}

/** The required labels missing on one entry (one per label and account). */
export function missingLabels(tx: Transaction, dimensions: DimensionDefinition[] | undefined, accounts: Pick<ChartAccount, 'id' | 'name'>[] = []): MissingLabel[] {
  const rules = requiredLabelRules(dimensions);
  if (rules.length === 0 || !isPostable(tx)) return [];
  const date = String(tx.date || '').slice(0, 10);
  const name = accountNamesMap(accounts);
  const found = new Map<string, MissingLabel>();
  for (const rule of rules) {
    if (rule.since && date < rule.since) continue;
    for (const line of tx.lines || []) {
      if (!rule.accountIds.has(line.accountId) || hasLabel(line, tx, rule.dimensionId)) continue;
      const key = `${rule.dimensionId}|${line.accountId}`;
      if (!found.has(key)) found.set(key, {
        transactionId: tx.id, date, description: tx.description || '', accountId: line.accountId,
        accountName: name.get(line.accountId) || line.accountName || 'an account', dimensionId: rule.dimensionId, dimensionName: rule.dimensionName,
      });
    }
  }
  return [...found.values()];
}

/** The kinds of entry where a person chose the accounts (an entry without a kind is a journal entry). */
const TYPED_BY_A_PERSON = new Set(['journal', 'invoice-accrual', 'bill-accrual', 'bank-line-split', 'standalone-payment', 'credit-note-issuance', 'vendor-credit-issuance']);

/** Whether a person typed this entry; a reversal, or an entry LedgerFlow made itself, is not. */
export function typedByPerson(tx: Pick<Transaction, 'metadata'>): boolean {
  const meta = (tx.metadata || {}) as Record<string, unknown>;
  if (meta.reversesTxId || meta.isReversal) return false;
  return meta.type === undefined || meta.type === null || meta.type === '' || TYPED_BY_A_PERSON.has(String(meta.type));
}

/** The missing labels whose rule refuses the entry (none for an entry a person did not type). */
export function refusedLabels(tx: Transaction, dimensions: DimensionDefinition[] | undefined, accounts: Pick<ChartAccount, 'id' | 'name'>[] = []): MissingLabel[] {
  const refusing = new Set(requiredLabelRules(dimensions).filter(r => r.refuse).map(r => r.dimensionId));
  if (refusing.size === 0 || !typedByPerson(tx)) return [];
  return missingLabels(tx, dimensions, accounts).filter(m => refusing.has(m.dimensionId));
}

/** What the server answers when it refuses: each label and account, and what to do. */
export function refusedLabelsMessage(missing: MissingLabel[]): string {
  const what = missing.map(m => `${m.dimensionName} on ${m.accountName}`).join(', ');
  return `This entry needs ${what} (a required label). Add it to the line, or ask an owner or accountant to change the rule in Settings → Labels → Required labels.`;
}

/**
 * For a form before it is saved: "Project is required on Utilities (line 2)". `lines` are the form's
 * lines with an account; `date` is the entry's date.
 */
export function requiredLabelWarnings(lines: LineLike[], date: string, dimensions: DimensionDefinition[] | undefined, accounts: Pick<ChartAccount, 'id' | 'name'>[] = []): string[] {
  const rules = requiredLabelRules(dimensions);
  if (rules.length === 0) return [];
  const name = new Map(accounts.map(a => [a.id, a.name]));
  const warnings: string[] = [];
  for (const rule of rules) {
    if (rule.since && date.slice(0, 10) < rule.since) continue;
    lines.forEach((line, i) => {
      if (line.accountId && rule.accountIds.has(line.accountId) && !hasLabel(line, undefined, rule.dimensionId)) {
        warnings.push(`${rule.dimensionName} is required on ${name.get(line.accountId) || line.accountName || 'this account'} (line ${i + 1})${rule.refuse ? ': the entry is not saved without it' : ''}`);
      }
    });
  }
  return warnings;
}

/** The definitions with this label's rule changed: no accounts means no rule. */
export function withRequiredOn(dimensions: DimensionDefinition[], dimensionId: string, requiredOn: RequiredOn | undefined): DimensionDefinition[] {
  return dimensions.map(d => {
    if (d.id !== dimensionId) return d;
    const { requiredOn: _old, ...rest } = d;
    return requiredOn && requiredOn.accountIds.length > 0
      ? { ...rest, requiredOn: { accountIds: [...new Set(requiredOn.accountIds)], since: requiredOn.since, ...(requiredOn.refuse ? { refuse: true } : {}) } }
      : rest;
  });
}
