import { useDataNeedsStore } from '../stores/useDataNeedsStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { browserProvenance } from '../lib/reportProvenance';
import type { LedgerKey } from '../lib/ledgerCollections';

/** Missing inputs are not zero. Use the same cap (including an unspecified cap) and failure
 * policy for release decisions, empty claims and both kinds of report export. */
export function usePartialReportInputs(keys: readonly LedgerKey[]): boolean {
  const failed = useDataNeedsStore(s => s.failed);
  return useLedgerStore(s => browserProvenance(keys, { failed, truncatedCollections: s.truncatedCollections, isDataTruncated: s.isDataTruncated }).completeness !== 'complete');
}
