import { useMemo } from 'react';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useLedgerCollections } from './useLedgerCollections';
import { computeGeneralLedger } from '../server/reports/computeReports';
import { useServerRangeReport, type RangeReportSource } from './useServerRangeReport';

export type GeneralLedger = ReturnType<typeof computeGeneralLedger>;

const parseLedger = (body: Record<string, unknown>) => {
  const ledger = body.ledger as GeneralLedger | undefined;
  return ledger && typeof ledger === 'object' && Array.isArray(ledger.accounts) ? ledger : null;
};

/**
 * L-123 step 5a: every account's general ledger of `from`…`to` (computeGeneralLedger). When the loaded entries are
 * capped, whatever the period (each opening line needs every entry before it), it comes from the server (GET /api/v1/balances/general-ledger):
 * each opening line summed through the day before `from`, then every entry of the range. Otherwise, and until the
 * server answers or when it cannot be reached, the loaded entries' ledger.
 */
export function useServerGeneralLedger(from: string, to: string): { ledger: GeneralLedger; source: RangeReportSource } {
  useLedgerCollections('transactions', 'accounts');
  const accounts = useLedgerStore(s => s.accounts);
  const transactions = useLedgerStore(s => s.transactions);
  // every opening line sums all the entries before `from`, so capped entries need the server whatever the period
  const capped = useLedgerStore(s => Boolean(s.truncatedCollections?.transactions));
  const loaded = useMemo(() => computeGeneralLedger(accounts, transactions, from, to), [accounts, transactions, from, to]);
  // the opening balances and the account fields the ledger shows come from the chart too
  const extraKey = useMemo(() => JSON.stringify(accounts.map(a => [a.id, a.code, a.name, a.type, a.category, a.openingBalanceCents])), [accounts]);
  const { report, source } = useServerRangeReport({ path: 'general-ledger', from: from || undefined, to: to || undefined, extraKey, alsoIncomplete: capped, parse: parseLedger, loaded });
  return { ledger: report, source };
}
