/**
 * The cells of the customer and vendor balance summaries: both reports print a party's name with its
 * contact details, how many documents are open, what was billed or invoiced, what was paid and what is
 * still due. The two differ only in their words and in which balance is called money owed, so the cells
 * live here and each report names its own columns.
 */
import { Mail, Phone } from 'lucide-react';
import { formatCurrency } from '../../lib/utils';

export interface PartyBalanceContact {
  name: string;
  email?: string;
  phone?: string;
}

/** Name, with the email and phone under it when the party has them. */
export function partyNameCell(item: PartyBalanceContact) {
  return (
    <div>
      <div className="font-semibold text-neutral-900 dark:text-white">{item.name}</div>
      <div className="flex items-center gap-3 text-[10px] text-neutral-400 mt-0.5">
        {item.email && <span className="flex items-center gap-1"><Mail className="w-2.5 h-2.5" />{item.email}</span>}
        {item.phone && <span className="flex items-center gap-1"><Phone className="w-2.5 h-2.5" />{item.phone}</span>}
      </div>
    </div>
  );
}

/** How many documents are still open, marked when there are any. */
export function partyOpenCountCell(count: number) {
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
      count > 0
        ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
        : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400'
    }`}>
      {count}
    </span>
  );
}

/** What was paid, in the colour the reports use for money received. */
export function partyPaidCell(cents: number, currency: string) {
  return (
    <span className="text-emerald-600 dark:text-emerald-400 font-medium">
      {formatCurrency(cents, currency)}
    </span>
  );
}

/**
 * What is still due. `owedTone` is the colour the report gives a balance the reader owes or is owed:
 * receivables are rose, payables amber. A credit balance is money the other way, so it stays emerald.
 */
export function partyBalanceCell(cents: number, currency: string, owedTone: 'rose' | 'amber') {
  const tone = cents > 0
    ? (owedTone === 'rose' ? 'text-rose-600 dark:text-rose-400' : 'text-amber-600 dark:text-amber-400')
    : cents < 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-neutral-500';
  return (
    <span className={`font-bold ${tone}`}>
      {formatCurrency(cents, currency)}
    </span>
  );
}

/** The rows the search box keeps: the party's name, email or phone carries the term. */
export function filterPartyBalanceRows<T extends PartyBalanceContact>(rows: T[], searchTerm: string): T[] {
  if (!searchTerm.trim()) return rows;
  const term = searchTerm.toLowerCase();
  return rows.filter(r =>
    r.name.toLowerCase().includes(term) ||
    (r.email && r.email.toLowerCase().includes(term)) ||
    (r.phone && r.phone.includes(term))
  );
}
