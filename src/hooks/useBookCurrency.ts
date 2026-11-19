import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';

/**
 * Resolve the active book/workspace currency for display and CSV exports.
 * Prefers the current workspace's currency, then window.__ledgerBaseCurrency / store baseCurrency,
 * falling back to 'USD'.
 */
export function useBookCurrency(): string {
  const workspaceCurrency = useAuthStore(s => s.getCurrentWorkspace()?.currency);
  const ledgerCurrency = useLedgerStore(s => s.baseCurrency);
  const windowCurrency = typeof window !== 'undefined'
    ? (window as Window & { __ledgerBaseCurrency?: string }).__ledgerBaseCurrency
    : undefined;
  return (workspaceCurrency || windowCurrency || ledgerCurrency || 'USD').trim().toUpperCase() || 'USD';
}
