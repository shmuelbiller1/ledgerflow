import type { ChartAccount } from '../types';

/**
 * PM-04: the one rule for the Retainage Receivable control account. Invoice posting debits it and a
 * payment that settles the retained part credits it, so both resolve it here (mapping first, then the
 * chart) — a payment never picks a different account than the invoice posted to.
 */
export const RETAINAGE_RECEIVABLE_KEYS = ['retainage', 'retention'];

export const isRetainageReceivableAccount = (a: Pick<ChartAccount, 'type' | 'category' | 'name'>): boolean =>
  a.type === 'asset' && a.category === 'Receivables'
  && ((a.name || '').toLowerCase().includes('retainage') || (a.name || '').toLowerCase().includes('retention'));

/** The workspace's Retainage Receivable account, as invoice posting resolves it, or undefined. */
export function findRetainageReceivable(accounts: ChartAccount[], mappings: Record<string, string> = {}): { id: string; name: string } | undefined {
  for (const key of RETAINAGE_RECEIVABLE_KEYS) {
    const mapped = mappings[key];
    const acc = mapped ? accounts.find(a => a.id === mapped) : undefined;
    if (acc) return { id: acc.id, name: acc.name };
  }
  const found = accounts.find(isRetainageReceivableAccount);
  return found ? { id: found.id, name: found.name } : undefined;
}
