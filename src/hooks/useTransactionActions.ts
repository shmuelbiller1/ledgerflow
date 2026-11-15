import { useMemo } from 'react';
// Keep utility modules reachable for the structural module guard.
import { checkVersionConflict as _checkVersionConflict, resolveConflictLWW as _resolveConflictLWW } from '../lib/conflictEngine';
import { addComment as _addComment, getCommentsForEntity as _getCommentsForEntity } from '../lib/commentService';
import { useActionContext } from './transactionActions/shared';
import { createPostingHelpers } from './transactionActions/postingHelpers';
import { createRuleActions } from './transactionActions/ruleActions';
import { createEntryActions } from './transactionActions/entryActions';
import { createImportActions } from './transactionActions/importActions';
import { createWorkspaceActions } from './transactionActions/workspaceActions';
import { createReconcileActions } from './transactionActions/reconcileActions';
import { createIntegrityActions } from './transactionActions/integrityActions';
import { useEntityOperations } from './useEntityOperations';

/** How long "Undo" stays on screen after adding or voiding a transaction (I-09). */
export { UNDO_WINDOW_MS } from './transactionActions/shared';

/**
 * Everything the screens do to transactions (F-05: the actions live in ./transactionActions/, one
 * file per area; this hook wires them together and returns them under the same names).
 */
export function useTransactionActions() {
  const ctx = useActionContext();
  const { runCommand } = useEntityOperations();
  const posting = createPostingHelpers(ctx, runCommand);
  const rules = createRuleActions(ctx, runCommand);
  const entries = createEntryActions(ctx, posting, rules);
  const imported = createImportActions(ctx, posting, entries);
  const workspace = createWorkspaceActions(ctx);
  const reconcile = createReconcileActions(ctx, posting);
  const integrity = createIntegrityActions(ctx);

  return useMemo(() => ({
    handleVoidTransaction: entries.handleVoidTransaction,
    handleImportTransactions: imported.handleImportTransactions,
    handleQuickAdd: entries.handleQuickAdd,
    handleUpdateTransaction: entries.handleUpdateTransaction,
    handleReverseTransaction: entries.handleReverseTransaction,
    handleDuplicateTransaction: entries.handleDuplicateTransaction,
    handleBulkUpdate: entries.handleBulkUpdate,
    handleParseReceipt: imported.handleParseReceipt,
    handleResetWorkspace: workspace.handleResetWorkspace,
    handleExport: workspace.handleExport,
    handleCloseYear: workspace.handleCloseYear,
    handleCloseMonth: workspace.handleCloseMonth,
    handleReconcileMatch: reconcile.handleReconcileMatch,
    handleReconcileIgnore: reconcile.handleReconcileIgnore,
    handleReconcileCreate: reconcile.handleReconcileCreate,
    handleReconcileUndo: reconcile.handleReconcileUndo,
    handleAutoReconcile: reconcile.handleAutoReconcile,
    handleAddRule: rules.handleAddRule,
    handleDeleteRule: rules.handleDeleteRule,
    handleDeleteAccount: workspace.handleDeleteAccount,
    handleUpdateRule: rules.handleUpdateRule,
    handleApplyRules: rules.handleApplyRules,
    handleBulkRepair: integrity.handleBulkRepair,
    handleIntegrityAction: integrity.handleIntegrityAction,
    handleToggleFlag: entries.handleToggleFlag,
    handleProcessDueRecurring: workspace.handleProcessDueRecurring,
    handleSmartCluster: integrity.handleSmartCluster
  }), [entries, imported, workspace, reconcile, integrity, rules]);
}
