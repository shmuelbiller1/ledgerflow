import type { AutoRule, ChartAccount, Transaction } from '../types';
import { disabledRuleGroups, evaluateRuleCondition, ruleGroupName } from './rulesEngine';
import { byCodeUnit } from './codeUnitOrder';

/**
 * EG-9: the bank-feed rules, as one pure function used by the server (every imported or synced bank
 * line, and the re-run route) and by the browser (the import preview), so a line gets the same
 * suggestion whoever imports it. A rule only suggests: the account, the contact and the labels are
 * stored on the bank line as `suggestion`; nothing is posted until a person accepts it.
 *
 * Order: the rules by priority (missing = 100), then by id, so the order never depends on how the
 * rules were read. The first matching rule that names a usable account gives the account; the first
 * that names a contact gives the contact; labels (tags, dimensions) are gathered from every matching
 * rule, an earlier rule winning a dimension. A matching rule with stopProcessingOnMatch ends the run.
 * Paused rules and rules of a paused group never match.
 */

export interface BankRuleLine {
  description?: string;
  payee?: string;
  /** as the bank shows it: positive = money in, negative = money out */
  amountCents: number;
  date: string;
}

export interface BankRuleContact { id: string; kind: 'customer' | 'vendor' }

export interface BankRuleSuggestion {
  accountId?: string;
  accountName?: string;
  contactId?: string;
  contactKind?: 'customer' | 'vendor';
  tags: string[];
  dimensions: Record<string, string>;
  /** every rule that matched, in the order applied */
  ruleIds: string[];
}

export interface BankRuleContext {
  /** the workspace's chart: a rule's account is suggested only when it is here, active and not archived */
  accounts?: ChartAccount[];
  /** the workspace's customers and vendors: a rule's contact is suggested only when it is here */
  contacts?: BankRuleContact[];
}

const usable = (account: ChartAccount | undefined): account is ChartAccount =>
  !!account && !account.archived && !(account as ChartAccount & { isArchived?: boolean }).isArchived && account.isActive !== false;

/**
 * The rule's account: the checked counterparty action first, then the older targetNodeId, then an
 * older rule's targetCategory, an account *name*, matched exactly against the active chart (as
 * MatchingEngine.resolveCategory did). A name needs the chart: without one it suggests nothing.
 */
function ruleAccountId(rule: AutoRule, accounts: ChartAccount[] | undefined): string | undefined {
  const byId = rule.action?.targetAccountId || rule.action?.targetNodeId;
  if (byId) return byId;
  const name = rule.action?.targetCategory;
  if (!name || !accounts) return undefined;
  return accounts.find(a => usable(a) && a.name === name)?.id;
}

export function orderBankRules(rules: AutoRule[]): AutoRule[] {
  return [...rules].sort((a, b) => ((a.priority ?? 100) - (b.priority ?? 100)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The suggestion for one bank line, or null when no rule matches. Pure: same input, same answer. */
export function suggestFromRules(rules: AutoRule[], line: BankRuleLine, context: BankRuleContext = {}): BankRuleSuggestion | null {
  const paused = disabledRuleGroups(rules);
  const amount = Math.abs(Number(line.amountCents) || 0);
  // the rule conditions read an entry: the line as one, its total the size of the amount
  const asEntry = { id: '', description: line.description || '', payee: line.payee, date: String(line.date || '').slice(0, 10), totalAmountCents: amount, lines: [] } as unknown as Transaction;
  const accounts = new Map((context.accounts || []).map(a => [a.id, a]));
  const contacts = new Map((context.contacts || []).map(c => [c.id, c]));
  const out: BankRuleSuggestion = { tags: [], dimensions: {}, ruleIds: [] };
  for (const rule of orderBankRules(rules)) {
    if (!rule?.id || paused.has(ruleGroupName(rule)) || !evaluateRuleCondition(rule, asEntry)) continue;
    out.ruleIds.push(rule.id);
    const accountId = ruleAccountId(rule, context.accounts);
    if (!out.accountId && accountId) {
      const account = accounts.get(accountId);
      if (!context.accounts || usable(account)) {
        out.accountId = accountId;
        if (account?.name) out.accountName = account.name;
      }
    }
    const contactId = rule.action?.contactId;
    if (!out.contactId && contactId) {
      const contact = contacts.get(contactId);
      if (!context.contacts || contact) {
        out.contactId = contactId;
        if (contact) out.contactKind = contact.kind;
      }
    }
    for (const tag of [...(rule.action?.targetTags || []), ...(rule.action?.addTags || [])]) {
      if (typeof tag === 'string' && tag && !out.tags.includes(tag)) out.tags.push(tag);
    }
    for (const [key, value] of Object.entries(rule.action?.targetDimensions || {})) {
      if (!(key in out.dimensions) && typeof value === 'string') out.dimensions[key] = value;
    }
    if (rule.stopProcessingOnMatch) break;
  }
  return out.ruleIds.length ? out : null;
}

/** Two suggestions say the same thing (re-running the rules then changes nothing and counts no hit). */
export function sameSuggestion(a: BankRuleSuggestion | null | undefined, b: BankRuleSuggestion | null | undefined): boolean {
  const key = (s: BankRuleSuggestion | null | undefined) => s ? JSON.stringify([s.accountId ?? null, s.contactId ?? null, s.tags, Object.entries(s.dimensions).sort(([a], [b]) => byCodeUnit(a, b)), s.ruleIds]) : 'null';
  return key(a) === key(b);
}

/** EG-9: what a person keeps or changes when making an entry from a bank line (Reconciliation → Create entry). */
export interface ReconcileCreateChoice {
  accountId?: string;
  contactId?: string;
  contactKind?: 'customer' | 'vendor';
  contactName?: string;
  tags?: string[];
  dimensions?: Record<string, string>;
}

/**
 * The pre-filled choice for a bank line: the rules' suggestion when its account is still usable,
 * otherwise the first expense account (as before the rules ran on the server).
 */
export function reconcileCreateDefaults(line: { suggestion?: BankRuleSuggestion | null }, accounts: ChartAccount[]): ReconcileCreateChoice {
  const s = line.suggestion || null;
  const suggested = s?.accountId ? accounts.find(a => a.id === s.accountId) : undefined;
  const fallback = accounts.find(a => usable(a) && (a.type === 'expense' || a.category === 'Operations')) || accounts.find(a => a.type === 'expense' || a.category === 'Operations') || accounts[0];
  return {
    accountId: (usable(suggested) ? suggested : fallback)?.id,
    ...(s?.contactId ? { contactId: s.contactId, ...(s.contactKind ? { contactKind: s.contactKind } : {}) } : {}),
    tags: s?.tags ? [...s.tags] : [],
    dimensions: s?.dimensions ? { ...s.dimensions } : {},
  };
}
