/**
 * Settings → Defaults (BB-03): which account each kind of posting uses. The key is the one the
 * posting code reads from the workspace's `defaultAccountMappings` (src/services/ledgerPost/*, the
 * server services); when it is not set, the posting picks an account by itself, and `automatic`
 * says which one (the same rule), so the page shows what will really happen.
 */
import { isUndepositedFundsAccount, resolveAccountRole } from './accountUtils';
import { advanceAccount } from './advancePayments';
import { deferredRevenueAccount, prepaidAccount } from './prepaidSchedule';
import type { ChartAccount } from '../types';

export interface DefaultAccountSlot {
  key: string;
  label: string;
  hint: string;
  /** Accounts that may be chosen for it. */
  fits: (a: ChartAccount) => boolean;
  /** The account postings use when nothing is chosen (undefined: none, the posting stops and says so). */
  automatic: (accounts: ChartAccount[]) => ChartAccount | undefined;
}

const name = (a: ChartAccount) => (a.name || '').toLowerCase();
const role = resolveAccountRole;

/**
 * CA-28 (mode of payment): the account a payment received or made by each method uses by default, e.g. cash into the
 * till or Undeposited Funds, cards into the card clearing bank. Not chosen: the Bank account above. The payment
 * screen preselects it; the person can still pick another account for that payment.
 */
export type PaymentMethod = 'cash' | 'check' | 'bank_transfer' | 'card' | 'other';
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash', check: 'Check', bank_transfer: 'Bank transfer', card: 'Card', other: 'Other',
};
export const paymentModeKey = (method: PaymentMethod) => `payment ${method}`;
const fitsPaymentAccount = (a: ChartAccount) => role(a) === 'cash' || isUndepositedFundsAccount(a);

function paymentModeSlots(): DefaultAccountSlot[] {
  return (Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map(method => ({
    key: paymentModeKey(method),
    label: `Payments by ${PAYMENT_METHOD_LABELS[method].toLowerCase()}`,
    hint: 'The account a payment received or made this way uses, unless you pick another on the payment',
    fits: fitsPaymentAccount,
    automatic: accounts => accounts.find(a => role(a) === 'cash'),
  }));
}

export const DEFAULT_ACCOUNT_SLOTS: DefaultAccountSlot[] = [
  {
    key: 'ar', label: 'Accounts receivable', hint: 'What customers owe: invoices, payments received, credit notes',
    fits: a => role(a) === 'ar' || a.type === 'asset',
    automatic: accounts => accounts.find(a => a.type === 'asset' && (a.category === 'Receivables' || name(a).includes('receivable') || a.code === '1100')),
  },
  {
    key: 'ap', label: 'Accounts payable', hint: 'What you owe vendors: bills, payments made, vendor credits',
    fits: a => role(a) === 'ap' || a.type === 'liability',
    automatic: accounts => accounts.find(a => role(a) === 'ap'),
  },
  {
    key: 'revenue', label: 'Sales', hint: 'Invoice lines without an account of their own',
    fits: a => role(a) === 'revenue',
    automatic: accounts => accounts.find(a => a.type === 'income' || a.category === 'Revenue' || a.category === 'Sales'),
  },
  {
    key: 'expense', label: 'Expenses', hint: 'Bill lines without an account of their own',
    fits: a => role(a) === 'expense' || role(a) === 'cogs',
    automatic: accounts => accounts.find(a => a.type === 'expense' || a.category === 'Expense'),
  },
  {
    key: 'cash', label: 'Bank', hint: 'Where documents marked paid on the spot are paid from or into',
    fits: a => role(a) === 'cash',
    automatic: accounts => accounts.find(a => role(a) === 'cash'),
  },
  {
    key: 'tax payable', label: 'Sales tax payable', hint: 'Tax charged on invoices, owed to the tax office',
    fits: a => a.type === 'liability',
    automatic: accounts => accounts.find(a => a.type === 'liability' && (name(a).includes('tax') || a.category === 'Taxes')),
  },
  {
    key: 'tax paid', label: 'Tax paid on purchases', hint: 'Tax on bills you can claim back',
    fits: a => a.type === 'asset' || a.type === 'expense' || a.type === 'liability',
    automatic: accounts => accounts.find(a => (a.type === 'asset' || a.type === 'expense' || a.type === 'liability') && name(a).includes('tax')),
  },
  {
    key: 'customer deposits', label: 'Customer deposits', hint: 'Money received before the invoice (applied to it later)',
    fits: a => role(a) === 'liability' || a.type === 'liability',
    automatic: accounts => advanceAccount(accounts, 'received'),
  },
  {
    key: 'vendor prepayments', label: 'Vendor prepayments', hint: 'Money paid before the bill (applied to it later)',
    fits: a => a.type === 'asset' && role(a) !== 'cash' && role(a) !== 'ar',
    automatic: accounts => advanceAccount(accounts, 'made'),
  },
  {
    key: 'prepaid expenses', label: 'Prepaid expenses', hint: 'Bills spread over the months they cover',
    fits: a => a.type === 'asset' && role(a) !== 'cash' && role(a) !== 'ar',
    automatic: accounts => prepaidAccount(accounts),
  },
  {
    key: 'deferred revenue', label: 'Deferred revenue', hint: 'Invoices spread over the months they are earned in',
    fits: a => a.type === 'liability' && role(a) !== 'ap',
    automatic: accounts => deferredRevenueAccount(accounts),
  },
  ...paymentModeSlots(),
];

/**
 * The account a payment by `method` goes into by default: the one chosen for the method, else the Bank default
 * (chosen or automatic), else the first of `candidates`. Only an account in `candidates` is returned.
 */
export function paymentModeAccountId(method: PaymentMethod, candidates: ChartAccount[], mappings: Record<string, string | undefined> | undefined): string {
  const ids = new Set(candidates.map(a => a.id));
  for (const key of [paymentModeKey(method), 'cash']) {
    const id = mappings?.[key];
    if (id && ids.has(id)) return id;
  }
  return candidates[0]?.id || '';
}

/** The account a slot uses now: the chosen one if it still exists, else the automatic one. */
export function accountInUse(slot: DefaultAccountSlot, accounts: ChartAccount[], mappings: Record<string, string | undefined> | undefined): { account?: ChartAccount; chosen: boolean } {
  const usable = accounts.filter(a => !a.isArchived && a.isActive !== false);
  const chosen = usable.find(a => a.id === mappings?.[slot.key]);
  return chosen ? { account: chosen, chosen: true } : { account: slot.automatic(usable), chosen: false };
}

/** The mappings with one slot set (or cleared, back to automatic); other keys are kept. */
export function withDefault(mappings: Record<string, string> | undefined, key: string, accountId: string): Record<string, string> {
  const next = { ...(mappings || {}) };
  if (accountId) next[key] = accountId;
  else delete next[key];
  return next;
}
