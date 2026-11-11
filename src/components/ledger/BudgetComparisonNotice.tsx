import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { useScreenDataHealth } from '../../hooks/useScreenDataHealth';
import { useLedgerStore } from '../../stores/useLedgerStore';

/**
 * R-2: what the P&L's budget column can be trusted for. It also asks for the budgets, so they load as soon as "compare to budget" is chosen. A failed load is reported before "still loading"
 * (a failed collection never becomes loaded), then a capped list, then the label filter (budgets are per account).
 */
export function BudgetComparisonNotice({ labelFiltered }: { labelFiltered: boolean }) {
  const { loading } = useLedgerCollections('budgets');
  const health = useScreenDataHealth(['budgets']);
  const truncated = useLedgerStore(s => Boolean(s.truncatedCollections?.budgets));
  const tone = 'text-sm text-amber-700 dark:text-amber-300';
  const data = health.failedKeys.length > 0
    ? 'The budgets could not be loaded: the budget column may be incomplete. Try again from the notice above.'
    : loading ? 'Budgets are still loading: the budget column may be incomplete.'
    : truncated ? 'Only the first budgets loaded: the budget column may be incomplete.' : '';
  return <>
    {data && <p role="status" className={tone}>{data}</p>}
    {labelFiltered && <p role="status" className={tone}>The actual figures follow the label filter; budgets are set per account, so the budget column is for the whole account.</p>}
  </>;
}
