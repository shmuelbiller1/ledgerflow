/**
 * A-74: expense policy checks. An organisation says, per expense category, what it will pay back
 * without questions: a maximum per line, and from what amount a receipt is needed. A claim is checked
 * **before** a person approves it, and every breach names the rule that was breached and what would
 * satisfy it.
 *
 * What this is: the organisation's own policy, checked against the claim's own lines. What it is not:
 * a tax rule, a posting, or a decision — it never rejects a claim by itself and never changes an
 * amount. The person approving still decides, and can see exactly why the screen is asking.
 *
 * Where the rows live: the workspace's own metadata (`metadata.expensePolicy`), an allowlisted field,
 * so a business of one and a company with a finance manual use the same code. Rows are dated, like
 * every other table in this product: a claim is checked against the policy in force on its date.
 *
 * Pure: no storage, no fetching, no clock.
 */
import type { ClaimLine } from './expenseClaims';

export interface ExpensePolicyRow {
  id: string;
  /** what the row is about: the expense account it applies to, and/or the item category words */
  accountId?: string;
  /** a plain word the line's description may name (e.g. "hotel"); when set, the row is about those lines */
  category?: string;
  /** the most one line may be, in whole cents; undefined = no limit */
  maxAmountCents?: number;
  /** the amount from which a receipt is needed (undefined = never required by this row) */
  receiptFromCents?: number;
  /** the row's own words for the screen: "Hotel: up to $250 a night, receipt always" */
  note?: string;
  validFrom: string;
  validTo?: string;
}

export interface ExpensePolicy {
  rows: ExpensePolicyRow[];
  /** the workspace's own rule when no row matches: a receipt is needed from this amount (optional) */
  defaultReceiptFromCents?: number;
}

/** Where the policy is kept on the workspace document. */
export const EXPENSE_POLICY_METADATA_KEY = 'expensePolicy';

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const isCents = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;

/**
 * Read the policy out of the workspace's metadata, keeping only rows that make sense. A corrupt entry
 * is dropped, never guessed at, and the caller is told how many were dropped so the screen can say so.
 */
export function parseExpensePolicy(metadata: unknown): { policy: ExpensePolicy; dropped: number } {
  const source = (metadata as { [EXPENSE_POLICY_METADATA_KEY]?: unknown } | null | undefined)?.[EXPENSE_POLICY_METADATA_KEY];
  const rawRows = (source as { rows?: unknown } | undefined)?.rows;
  const policy: ExpensePolicy = { rows: [] };
  const defaultReceipt = (source as { defaultReceiptFromCents?: unknown } | undefined)?.defaultReceiptFromCents;
  if (isCents(defaultReceipt)) policy.defaultReceiptFromCents = defaultReceipt;
  if (!Array.isArray(rawRows)) return { policy, dropped: 0 };
  let dropped = 0;
  for (const raw of rawRows) {
    const row = raw as Partial<ExpensePolicyRow>;
    const hasSubject = Boolean(row.accountId || row.category);
    const hasRule = isCents(row.maxAmountCents) || isCents(row.receiptFromCents);
    if (!row || typeof row.id !== 'string' || !row.id.trim() || !YMD.test(String(row.validFrom)) ||
        (row.validTo !== undefined && (!YMD.test(String(row.validTo)) || String(row.validTo) < String(row.validFrom))) ||
        !hasSubject || !hasRule) {
      dropped += 1;
      continue;
    }
    policy.rows.push({
      id: row.id.trim(),
      ...(row.accountId ? { accountId: row.accountId } : {}),
      ...(row.category ? { category: row.category.trim().toLowerCase() } : {}),
      ...(isCents(row.maxAmountCents) ? { maxAmountCents: row.maxAmountCents } : {}),
      ...(isCents(row.receiptFromCents) ? { receiptFromCents: row.receiptFromCents } : {}),
      ...(typeof row.note === 'string' && row.note.trim() ? { note: row.note.trim().slice(0, 200) } : {}),
      validFrom: String(row.validFrom),
      ...(row.validTo ? { validTo: String(row.validTo) } : {}),
    });
  }
  return { policy, dropped };
}

/** The rows in force on the claim's date, in the order they were written. */
export function policyRowsOn(policy: ExpensePolicy, date: string): ExpensePolicyRow[] {
  if (!YMD.test(date)) return [];
  return policy.rows.filter(row => row.validFrom <= date && (!row.validTo || date <= row.validTo));
}

/** The rows that govern one line: the ones whose subject the line matches (account first, then words). */
export function policyRowsForLine(row: ExpensePolicyRow[], line: ClaimLine): ExpensePolicyRow[] {
  const words = ` ${String(line.description || '').toLowerCase()} `;
  return row.filter(rule => {
    const byAccount = rule.accountId ? rule.accountId === line.accountId : false;
    const byWords = rule.category ? words.includes(` ${rule.category} `) || words.includes(`${rule.category}`) : false;
    if (rule.accountId && rule.category) return byAccount && byWords;
    return byAccount || byWords;
  });
}

export type ExpenseBreachKind = 'over-max' | 'receipt-missing';

export interface ExpenseBreach {
  line: number;
  ruleId: string;
  kind: ExpenseBreachKind;
  /** the amount the line is, in whole cents */
  amountCents: number;
  /** the limit or the receipt threshold it crossed */
  limitCents: number;
  message: string;
}

/** Something the screen must ask a person about, but cannot call a breach: the receipt count is unknown. */
export interface ExpenseNotice {
  line: number;
  ruleId: string;
  kind: 'receipt-not-checked';
  /** the amount from which a receipt is needed */
  limitCents: number;
  message: string;
}

export interface ExpenseClaimCheck {
  breaches: ExpenseBreach[];
  /** what the checker could not decide because a fact (the receipt count) was not given to it */
  notices: ExpenseNotice[];
  /** the rules that were looked at and matched no line, so the screen can show the policy is alive */
  rulesChecked: number;
  linesChecked: number;
}

/** A line with the receipts that were attached for it (one receipt may cover several lines). */
export interface ClaimLineWithReceipts {
  line: ClaimLine;
  /**
   * How many receipts are attached to this line or to the claim as a whole. `undefined` means the
   * screen does not know (it does not read the file list): the checker then reports a notice, never a
   * breach — "no receipt" and "not counted" are different answers.
   */
  receipts?: number;
}

const money = (cents: number) => (cents / 100).toFixed(2);

/**
 * Check a claim against the policy in force on its date. Every breach names the rule, the line, the
 * amount and the ask; a line whose amount is equal to the maximum is not a breach (the limit is
 * inclusive), and a receipt count of one or more satisfies a receipt rule for that line.
 */
export function checkExpenseClaim(policy: ExpensePolicy, input: {
  date: string;
  lines: ClaimLineWithReceipts[];
}): ExpenseClaimCheck {
  const rules = policyRowsOn(policy, input.date);
  const breaches: ExpenseBreach[] = [];
  const notices: ExpenseNotice[] = [];
  input.lines.forEach((entry, index) => {
    const amount = Math.max(0, entry.line.amountCents);
    const matched = policyRowsForLine(rules, entry.line);
    for (const rule of matched) {
      if (isCents(rule.maxAmountCents) && amount > rule.maxAmountCents) {
        breaches.push({
          line: index + 1, ruleId: rule.id, kind: 'over-max', amountCents: amount, limitCents: rule.maxAmountCents,
          message: `Line ${index + 1} is ${money(amount)}; ${rule.note || rule.id} allows up to ${money(rule.maxAmountCents)}`,
        });
      }
    }
    // a receipt is needed from the lowest threshold that applies to this line: the line's own rules,
    // or the workspace's default when none of them names one
    const withThreshold = matched.filter(rule => isCents(rule.receiptFromCents));
    const threshold = withThreshold.length
      ? withThreshold.reduce((lowest, rule) => (rule.receiptFromCents! < lowest.receiptFromCents! ? rule : lowest), withThreshold[0])
      : (isCents(policy.defaultReceiptFromCents) ? { id: 'policy-default', receiptFromCents: policy.defaultReceiptFromCents } : undefined);
    const thresholdCents = threshold?.receiptFromCents as number | undefined;
    if (thresholdCents !== undefined && amount >= thresholdCents) {
      if (entry.receipts === undefined) {
        notices.push({
          line: index + 1, ruleId: threshold!.id, kind: 'receipt-not-checked', limitCents: thresholdCents,
          message: `Line ${index + 1} is ${money(amount)}; a receipt is needed from ${money(thresholdCents)} — not counted here`,
        });
      } else if (entry.receipts < 1) {
        breaches.push({
          line: index + 1, ruleId: threshold!.id, kind: 'receipt-missing', amountCents: amount,
          limitCents: thresholdCents,
          message: `Line ${index + 1} is ${money(amount)}; a receipt is needed from ${money(thresholdCents)}`,
        });
      }
    }
  });
  return { breaches, notices, rulesChecked: rules.length, linesChecked: input.lines.length };
}
