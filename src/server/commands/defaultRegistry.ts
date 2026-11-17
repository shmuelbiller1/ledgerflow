import { alertSettingsUpdateCommand } from './alerts';
import { importMapRestoreCommand, importMapSaveCommand } from './importMaps';
import { entryLinkCreateCommand, entryLinkRemoveCommand } from './entryLinks';
import { stageDefineCommand, stageMoveCommand } from './stages';
import { taskCreateCommand, taskRemoveCommand, taskStatusCommand } from './tasks';
import { timeInvoiceCommand, timeLogCommand, timeMoveCommand, timeRatesCommand, timeRemoveCommand, timeUpdateCommand } from './time';
import { watchCreateCommand, watchRemoveCommand } from './watches';
import {
  workspaceModulesCommand,
  workspaceNextNumberCommand,
  workspaceOpeningBalancesCommand,
  workspaceRetentionCommand,
  workspaceSetupCompleteCommand,
} from './workspaceSettings';
import { customerCreateCommand, customerUpdateCommand, warrantyUpdateCommand } from './customers';
import { customerBalanceCommand, vendorBalanceCommand } from './contactBalances';
import { vendorCreateCommand, vendorUpdateCommand } from './vendors';
import { autoRuleCreateCommand, autoRuleUpdateCommand, autoRuleDeleteCommand, autoRuleGroupCommand, autoRuleRecordHitsCommand } from './autoRules';
import { autoRuleLearnCommand } from './rulePatterns';
import { dimensionAxesCommand, dimensionNodeCommand } from './dimensions';
import { userProvisionCommand, workspaceCreateCommand } from './bootstrap';
import { projectDeleteCommand, projectRestoreCommand } from './projects';
import { workspaceSettingsCommand } from './workspaceSettingsPanel';
import {
  bankLinePayCommand,
  bankLineSplitCommand,
  bankRulesRerunCommand,
  clearEntriesCommand,
  completeReconciliationCommand,
  reconcileCommand,
  updateBankLineCommand,
} from './reconciliations';
import { journalCreateCommand } from './ledger';
import { paymentReceiveCommand } from './payments';
import { numberingUpdateCommand } from './numbering';
import {
  inventoryAdjustCommand,
  inventoryCogsCommand,
  inventoryCountCommand,
  inventoryDeliverCommand,
  inventoryLandedCostCommand,
  inventoryLandedCostUndoCommand,
  inventoryReturnCommand,
  inventoryRevalueCommand,
  inventoryStockClosingCommand,
  inventoryStockPolicyCommand,
  inventoryTransferCommand,
  inventoryUndoDeliveryCommand,
} from './inventory';
import {
  periodCloseCommand,
  periodCloseStepsCommand,
  periodDepreciationCommand,
  periodFxRevaluationCommand,
  periodFxRevaluationUndoCommand,
  periodBalancesRebuildCommand,
  periodYearCloseCommand,
  periodRelockCommand,
  periodReopenCommand,
  periodSignOffCommand,
  periodUnlockCommand,
} from './periods';
import {
  billCreateCommand,
  billDeleteCommand,
  billUpdateCommand,
  creditNoteCreateCommand,
  creditNoteDeleteCommand,
  creditNoteUpdateCommand,
  invoiceCreateCommand,
  invoiceDeleteCommand,
  invoiceUpdateCommand,
  vendorCreditCreateCommand,
  vendorCreditDeleteCommand,
  vendorCreditUpdateCommand,
} from './documents';
import { CommandRegistry } from './registry';
import { workspaceInviteRevokeCommand } from './workspaceInvites';
import { workspaceCancelDeletionCommand } from './workspaceLifecycle';
import { accountMakeRecoveryCodesCommand, accountSetNotificationEmailCommand, accountUseRecoveryCodeCommand } from './account';
import {
  groupCreateCommand,
  groupDeleteCommand,
  groupKeepRatesCommand,
  groupSetLineMergesCommand,
  groupShareCommand,
  groupUnshareCommand,
  groupUpdateCommand,
} from './groups';

/** Construct the built-in command set; tests and alternate server entry points get an isolated registry. */
export function createDefaultCommandRegistry(): CommandRegistry {
  const registry = new CommandRegistry();
  registry.register(alertSettingsUpdateCommand);
  registry.register(importMapSaveCommand);
  registry.register(importMapRestoreCommand);
  registry.register(userProvisionCommand);
  registry.register(workspaceCreateCommand);
  registry.register(projectDeleteCommand);
  registry.register(projectRestoreCommand);
  registry.register(workspaceModulesCommand);
  registry.register(workspaceSettingsCommand);
  registry.register(workspaceNextNumberCommand);
  registry.register(workspaceOpeningBalancesCommand);
  registry.register(workspaceRetentionCommand);
  registry.register(workspaceSetupCompleteCommand);
  registry.register(workspaceInviteRevokeCommand);
  registry.register(workspaceCancelDeletionCommand);
  registry.register(periodCloseCommand);
  registry.register(periodDepreciationCommand);
  registry.register(periodReopenCommand);
  registry.register(periodUnlockCommand);
  registry.register(periodRelockCommand);
  registry.register(periodSignOffCommand);
  registry.register(periodCloseStepsCommand);
  registry.register(periodBalancesRebuildCommand);
  registry.register(periodFxRevaluationCommand);
  registry.register(periodFxRevaluationUndoCommand);
  registry.register(periodYearCloseCommand);
  registry.register(entryLinkCreateCommand);
  registry.register(entryLinkRemoveCommand);
  registry.register(stageDefineCommand);
  registry.register(stageMoveCommand);
  registry.register(taskCreateCommand);
  registry.register(taskRemoveCommand);
  registry.register(taskStatusCommand);
  registry.register(timeInvoiceCommand);
  registry.register(timeLogCommand);
  registry.register(timeMoveCommand);
  registry.register(timeRatesCommand);
  registry.register(timeRemoveCommand);
  registry.register(timeUpdateCommand);
  registry.register(watchCreateCommand);
  registry.register(watchRemoveCommand);
  registry.register(customerCreateCommand);
  registry.register(customerUpdateCommand);
  registry.register(warrantyUpdateCommand);
  registry.register(vendorCreateCommand);
  registry.register(vendorUpdateCommand);
  registry.register(journalCreateCommand);
  registry.register(numberingUpdateCommand);
  registry.register(paymentReceiveCommand);
  registry.register(invoiceCreateCommand);
  registry.register(billCreateCommand);
  registry.register(creditNoteCreateCommand);
  registry.register(vendorCreditCreateCommand);
  registry.register(invoiceUpdateCommand);
  registry.register(billUpdateCommand);
  registry.register(creditNoteUpdateCommand);
  registry.register(vendorCreditUpdateCommand);
  registry.register(autoRuleCreateCommand);
  registry.register(autoRuleUpdateCommand);
  registry.register(autoRuleDeleteCommand);
  registry.register(autoRuleGroupCommand);
  registry.register(autoRuleLearnCommand);
  registry.register(customerBalanceCommand);
  registry.register(vendorBalanceCommand);
  registry.register(dimensionNodeCommand);
  registry.register(dimensionAxesCommand);
  registry.register(autoRuleRecordHitsCommand);
  registry.register(invoiceDeleteCommand);
  registry.register(billDeleteCommand);
  registry.register(creditNoteDeleteCommand);
  registry.register(vendorCreditDeleteCommand);
  registry.register(accountMakeRecoveryCodesCommand);
  registry.register(accountSetNotificationEmailCommand);
  registry.register(accountUseRecoveryCodeCommand);
  registry.register(groupCreateCommand);
  registry.register(groupUpdateCommand);
  registry.register(groupDeleteCommand);
  registry.register(groupShareCommand);
  registry.register(groupUnshareCommand);
  registry.register(groupSetLineMergesCommand);
  registry.register(groupKeepRatesCommand);
  registry.register(inventoryCogsCommand);
  registry.register(inventoryAdjustCommand);
  registry.register(inventoryCountCommand);
  registry.register(inventoryRevalueCommand);
  registry.register(inventoryStockPolicyCommand);
  registry.register(inventoryDeliverCommand);
  registry.register(inventoryReturnCommand);
  registry.register(inventoryUndoDeliveryCommand);
  registry.register(reconcileCommand);
  registry.register(clearEntriesCommand);
  registry.register(updateBankLineCommand);
  registry.register(completeReconciliationCommand);
  registry.register(bankLinePayCommand);
  registry.register(bankLineSplitCommand);
  registry.register(bankRulesRerunCommand);
  registry.register(inventoryTransferCommand);
  registry.register(inventoryStockClosingCommand);
  registry.register(inventoryLandedCostCommand);
  registry.register(inventoryLandedCostUndoCommand);
  return registry;
}

/** The server's process-wide, read-mostly registry. */
export const commandRegistry = createDefaultCommandRegistry();
