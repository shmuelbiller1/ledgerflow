import { useMemo } from 'react';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useDataNeedsStore } from '../stores/useDataNeedsStore';
import { useLedgerCollections } from './useLedgerCollections';
import { computeTransactionsByReference, type TransactionsByReference } from '../server/reports/referenceReport';
import { useServerRangeReport, type RangeReportSource } from './useServerRangeReport';

const parseReferences = (body: Record<string, unknown>) => {
  const r = body.references as TransactionsByReference | undefined;
  return r && typeof r === 'object' && Array.isArray(r.rows) ? r : null;
};

/**
 * L-123 step 5b: "Transactions by Reference" of `from`…`to` (computeTransactionsByReference). When the loaded entries
 * are capped and the range reaches the oldest loaded day, or the invoices or bills (whose numbers name postings) are
 * capped or failed to load, it comes from the server (GET /api/v1/balances/transactions-by-reference). Otherwise, and
 * until the server answers or when it cannot be reached, the loaded entries' list.
 */
export function useServerTransactionsByReference(from: string, to: string): { report: TransactionsByReference; source: RangeReportSource } {
  useLedgerCollections('transactions', 'bills', 'invoices');
  const transactions = useLedgerStore(s => s.transactions);
  const invoices = useLedgerStore(s => s.invoices);
  const bills = useLedgerStore(s => s.bills);
  const documentsShort = useLedgerStore(s => Boolean(s.truncatedCollections?.invoices || s.truncatedCollections?.bills));
  // a failed entries load leaves no oldest loaded day, so it is named here too (CodeRabbit on #512)
  const documentsFailed = useDataNeedsStore(s => Boolean(s.failed.transactions || s.failed.invoices || s.failed.bills));
  const loaded = useMemo(() => computeTransactionsByReference(transactions || [], { invoices, bills }, from, to), [transactions, invoices, bills, from, to]);
  // a document's number names its postings
  const extraKey = useMemo(() => JSON.stringify([(invoices || []).map(i => [i.id, i.number]), (bills || []).map(b => [b.id, b.number])]), [invoices, bills]);
  return useServerRangeReport({
    path: 'transactions-by-reference', from: from || undefined, to: to || undefined, extraKey,
    alsoIncomplete: documentsShort || documentsFailed, parse: parseReferences, loaded,
  });
}
