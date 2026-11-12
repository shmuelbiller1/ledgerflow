/**
 * EU-B6: a typed entry ("paid $40 gas #maui @Shell") that cannot post to the wrong place. The account comes from the
 * workspace's bank rules (the same `suggestFromRules` the bank feed runs), else from the payee's history (every earlier
 * entry to one account); when neither says, the plan asks instead of guessing. `#label` picks a label value by its
 * code or description, `@vendor` names the payee. The preview is in the workspace's currency and must be confirmed.
 */
import type { AutoRule, ChartAccount, DimensionNode, Transaction } from '../types';
import { suggestFromRules } from './bankRules';
import { evaluateCalibratedAutoPost } from './practiceAutomation';
import { resolveAccountRole } from './accountUtils';
import { isPostable } from './txFilters';

export interface TypedEntryPlan {
  /** what to ask before anything can post; empty when ready */
  question: string;
  accountId?: string;
  accountName?: string;
  /** where the account came from, in words */
  because?: string;
  cashAccountId?: string;
  cashAccountName?: string;
  labels: Record<string, string>;
  /** `#words` that matched no label value (said, never dropped silently) */
  unknownLabels: string[];
  payee?: string;
  description: string;
  amountCents: number;
  isExpense: boolean;
  /** "Fuel · Property: Maui house · ₪40.00 from Bank" */
  preview: string;
}

/** `#maui` and `@Shell` out of the typed text; the rest is the description. */
export function splitTyped(text: string): { rest: string; tags: string[]; payee?: string } {
  const tags = [...text.matchAll(/(?:^|\s)#([\p{L}\p{N}_-]+)/gu)].map(m => m[1]);
  const at = /(?:^|\s)@([\p{L}\p{N}_&.'-]+(?:\s+[\p{Lu}][\p{L}\p{N}_&.'-]*)*)/u.exec(text);
  const rest = text.replace(/(?:^|\s)#[\p{L}\p{N}_-]+/gu, ' ').replace(/(?:^|\s)@[\p{L}\p{N}_&.'-]+(?:\s+[\p{Lu}][\p{L}\p{N}_&.'-]*)*/u, ' ').replace(/\s+/g, ' ').trim();
  return { rest, tags, payee: at?.[1] };
}

export function planTypedEntry(input: {
  text: string;
  amountCents: number;
  isExpense: boolean;
  description: string;
  parsedPayee?: string;
  accounts: readonly ChartAccount[];
  rules: readonly AutoRule[];
  history: readonly Transaction[];
  nodes: readonly DimensionNode[];
  labelNames: Readonly<Record<string, string>>;
  format: (cents: number) => string;
  /** the account the person chose when asked */
  chosenAccountId?: string;
}): TypedEntryPlan {
  const { text, amountCents, isExpense, accounts, rules, history, nodes, labelNames, format, chosenAccountId } = input;
  const split = splitTyped(text);
  const payee = split.payee || input.parsedPayee;
  const description = input.description.replace(/(?:^|\s)[#@]\S+/g, ' ').replace(/\s+/g, ' ').trim() || payee || 'Typed entry';
  const live = (a?: ChartAccount) => (a && !a.isArchived && !a.archived ? a : undefined);
  const wanted = isExpense ? ['expense', 'cost_of_goods'] : ['income'];
  const fits = (a?: ChartAccount) => Boolean(a && wanted.includes(a.type));

  const labels: Record<string, string> = {};
  const unknownLabels: string[] = [];
  for (const tag of split.tags) {
    const t = tag.toLowerCase();
    const node = nodes.find(n => n.status !== 'archived' && (n.id.toLowerCase() === t || n.description.toLowerCase() === t || n.description.toLowerCase().replace(/\s+/g, '') === t || n.description.toLowerCase().split(/\s+/)[0] === t));
    if (node) labels[node.dimensionId] = node.id; else unknownLabels.push(tag);
  }

  let account: ChartAccount | undefined;
  let because: string | undefined;
  const chosen = live(accounts.find(a => a.id === chosenAccountId));
  if (chosen) { account = chosen; because = 'chosen by you'; }
  if (!account && rules.length) {
    const ruled = suggestFromRules([...rules], { description, payee, amountCents, date: '' }, { accounts: [...accounts] });
    const ruleAccount = live(accounts.find(a => a.id === ruled?.accountId));
    if (ruled && fits(ruleAccount)) {
      account = ruleAccount;
      const rule = rules.find(r => r.id === ruled.ruleIds[0]);
      because = `rule: ${rule?.name || rule?.condition.descriptionContains || 'a rule'}`;
      for (const [k, v] of Object.entries(ruled.dimensions)) if (!(k in labels)) labels[k] = v;
    }
  }
  if (!account) {
    const posted = history.filter(t => isPostable(t));
    const cal = evaluateCalibratedAutoPost({ payee, description }, posted);
    const histAccount = live(accounts.find(a => a.id === cal.suggestedAccountId));
    if (cal.sampleSize >= 2 && cal.unchangedCount === cal.sampleSize && fits(histAccount)) {
      account = histAccount;
      because = `same as the last ${cal.sampleSize} times`;
    }
  }
  const cash = accounts.find(a => live(a) && resolveAccountRole(a) === 'cash');
  const labelText = Object.entries(labels).map(([k, v]) => `${labelNames[k] || k}: ${nodes.find(n => n.dimensionId === k && n.id === v)?.description || v}`);
  const question = !amountCents ? 'How much? Type an amount, e.g. $40.'
    : !cash ? 'Add a bank or cash account first: the money has to come from somewhere.'
      : !account ? `Which account is "${description}"? No rule or history says yet.`
        : '';
  const preview = account
    ? [account.name, ...labelText, `${format(amountCents)} ${isExpense ? 'from' : 'into'} ${cash?.name || 'the bank'}`].join(' · ')
    : `${format(amountCents)} — choose the account`;
  return {
    question, accountId: account?.id, accountName: account?.name, because, cashAccountId: cash?.id, cashAccountName: cash?.name,
    labels, unknownLabels, payee, description, amountCents, isExpense, preview,
  };
}
