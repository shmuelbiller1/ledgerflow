/** createEntryActions wired to the stores with no-op helpers, for tests of one entry action. */
import { createEntryActions } from '../../hooks/transactionActions/entryActions';
import { useLedgerStore } from '../../stores/useLedgerStore';
import type { ChartAccount } from '../../types';

export const testEntryActions = (workspaceId: string, accounts: ChartAccount[] = []) => createEntryActions({
  user: { uid: 'u1', getIdToken: async () => 't' }, currentWorkspaceId: workspaceId, accounts,
  setTransactions: useLedgerStore.getState().setTransactions, setIsSyncing: () => {}, recordAudit: async () => {}, isPeriodLocked: () => false,
} as never, { recordRulePattern: async () => {}, balanceTransactionLines: (l: unknown) => l } as never, { handleAddRule: async () => {} } as never);
