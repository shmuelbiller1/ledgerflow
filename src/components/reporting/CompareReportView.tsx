import PivotSheet from '../ledger/PivotSheet';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { useReportText } from './useReportText';

/** EU-E8: Reports → Compare — the pivot over the workspace's entries, with saved layouts. */
export default function CompareReportView() {
  const reportText = useReportText();
  const transactions = useLedgerStore(s => s.transactions);
  useLedgerCollections('transactions', 'accounts');
  if (!transactions?.length) {
    return <p data-report-empty-state className="p-6 text-sm text-[var(--muted)]">{reportText('r.no-posted-entries-yet-record-or-import-some-then', 'No posted entries yet. Record or import some, then choose two labels to compare.')}</p>;
  }
  return <PivotSheet transactions={transactions} />;
}
