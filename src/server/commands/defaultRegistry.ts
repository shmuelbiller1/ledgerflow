import { alertSettingsUpdateCommand } from './alerts';
import { importMapRestoreCommand, importMapSaveCommand } from './importMaps';
import { entryLinkCreateCommand, entryLinkRemoveCommand } from './entryLinks';
import { stageDefineCommand, stageMoveCommand } from './stages';
import { taskCreateCommand, taskRemoveCommand, taskStatusCommand } from './tasks';
import { timeInvoiceCommand, timeLogCommand, timeMoveCommand, timeRatesCommand, timeRemoveCommand, timeUpdateCommand } from './time';
import { watchCreateCommand, watchRemoveCommand } from './watches';
import { customerCreateCommand, customerUpdateCommand, warrantyUpdateCommand } from './customers';
import { vendorCreateCommand, vendorUpdateCommand } from './vendors';
import { autoRuleCreateCommand, autoRuleUpdateCommand, autoRuleDeleteCommand, autoRuleGroupCommand, autoRuleRecordHitsCommand } from './autoRules';
import { journalCreateCommand } from './ledger';
import { paymentReceiveCommand } from './payments';
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

/** Construct the built-in command set; tests and alternate server entry points get an isolated registry. */
export function createDefaultCommandRegistry(): CommandRegistry {
  const registry = new CommandRegistry();
  registry.register(alertSettingsUpdateCommand);
  registry.register(importMapSaveCommand);
  registry.register(importMapRestoreCommand);
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
  registry.register(autoRuleRecordHitsCommand);
  registry.register(invoiceDeleteCommand);
  registry.register(billDeleteCommand);
  registry.register(creditNoteDeleteCommand);
  registry.register(vendorCreditDeleteCommand);
  return registry;
}

/** The server's process-wide, read-mostly registry. */
export const commandRegistry = createDefaultCommandRegistry();
