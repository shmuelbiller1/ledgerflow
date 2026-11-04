import { useMemo } from 'react';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useDataNeedsStore } from '../stores/useDataNeedsStore';
import { registrationThresholdWatch, thresholdWindowStart, type RegistrationThresholdWatch, type RegistrationThresholdWatchInput } from '../lib/registrationThresholdWatch';
import { useServerRangeReport, type RangeReportSource } from './useServerRangeReport';

const parseReport = (body: Record<string, unknown>) =>
  (body.report && typeof body.report === 'object' && Array.isArray((body.report as { rows?: unknown }).rows) ? body.report as RegistrationThresholdWatch : null);

/**
 * L-123 step 4n: the registration-threshold watch as of `asOf` (registrationThresholdWatch). Its windows reach back to
 * 1 January of the year before (thresholdWindowStart). When the loaded entries are capped and that day is before the
 * oldest loaded one, or the accounts or dimension nodes are capped, or the accounts or entries failed to load, sales
 * may be missing, so the report comes from the server (GET /api/v1/balances/registration-threshold). A change to the
 * loaded accounts, nodes, profiles or chosen dimensions asks again. `input` null (an invalid date, loading) asks nothing.
 */
export function useServerRegistrationThreshold(input: Omit<RegistrationThresholdWatchInput, 'transactions' | 'accounts' | 'dimensionNodes'> | null):
  { report: RegistrationThresholdWatch | null; source: RangeReportSource } {
  const workspaceId = useAuthStore(s => s.currentWorkspaceId) || '';
  const accounts = useLedgerStore(s => s.accounts);
  const transactions = useLedgerStore(s => s.transactions);
  const dimensionNodes = useLedgerStore(s => s.dimensionNodes);
  const capped = useLedgerStore(s => Boolean(s.truncatedCollections?.chartAccounts || s.truncatedCollections?.dimensionNodes));
  const failed = useDataNeedsStore(s => Boolean(s.failed.accounts || s.failed.transactions));
  const own = useMemo(() => {
    const scoped = <T extends { workspaceId?: string }>(rows: T[] | undefined) => (rows || []).filter(r => !workspaceId || r.workspaceId === workspaceId);
    return { accounts: scoped(accounts), transactions: scoped(transactions) };
  }, [workspaceId, accounts, transactions]);
  const loaded = useMemo(() => (input ? registrationThresholdWatch({ ...input, ...own, dimensionNodes }) : null), [input, own, dimensionNodes]);
  const query = useMemo(() => ({ entity: input?.entityDimensionId || '', activity: input?.activityDimensionId || '' }), [input?.entityDimensionId, input?.activityDimensionId]);
  const extraKey = useMemo(() => JSON.stringify([own.accounts, dimensionNodes, input?.profiles ?? null, input?.baseCurrency ?? '']), [own.accounts, dimensionNodes, input?.profiles, input?.baseCurrency]);
  const { report, source } = useServerRangeReport({
    path: 'registration-threshold', from: input ? thresholdWindowStart(input.asOf) : undefined, to: input?.asOf, query, extraKey,
    alsoIncomplete: capped || failed, parse: parseReport, loaded,
  });
  return { report, source };
}
