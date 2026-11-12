import PivotSheet from '../ledger/PivotSheet';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';

/** EU-E8: Reports → Compare — the pivot over the workspace's entries, with saved layouts. */
export default function CompareReportView() {
  const transactions = useLedgerStore(s => s.transactions);
  useLedgerCollections('transactions', 'accounts');
  if (!transactions?.length) {
    return <p data-report-empty-state className="p-6 text-sm text-[var(--muted)]">No posted entries yet. Record or import some, then choose two labels to compare.</p>;
  }
  return <PivotSheet transactions={transactions} />;
}
