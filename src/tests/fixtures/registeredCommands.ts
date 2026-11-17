/**
 * Every registered command name and area, sorted — asserted by `commands.test.ts` and kept here so that test stays
 * about the registry's behaviour rather than being half a page of strings.
 *
 * The list is regenerated from `createDefaultCommandRegistry()` (the test itself fails loudly when they disagree, which
 * is what makes it a guard: a command added without a thought for the list is caught by the diff).
 */
export const REGISTERED_COMMAND_NAMES: readonly string[] = [
  'account.makerecoverycodes', 'account.setnotificationemail', 'account.userecoverycode', 'alerts.update', 'apikey.provision',
  'apikey.revoke', 'apikey.revokepersonal', 'asset.costaddition', 'asset.dispose', 'asset.placeservice', 'asset.transfer',
  'asset.undispose', 'asset.undoplaceservice', 'asset.undotransfer', 'auditlog.append', 'autorule.create', 'autorule.delete',
  'autorule.group', 'autorule.learn', 'autorule.recordhits', 'autorule.reset', 'autorule.update', 'bill.create', 'bill.delete',
  'bill.spread', 'bill.spreadundo', 'bill.update', 'budget.delete', 'budget.save', 'chartaccount.create', 'chartaccount.delete',
  'chartaccount.update', 'creditnote.create', 'creditnote.delete', 'creditnote.update', 'customer.balance', 'customer.create',
  'customer.update', 'document.save', 'employee.create', 'employee.update', 'entrylink.create', 'entrylink.remove',
  'estimate.save', 'estimate.status', 'groups.create', 'groups.delete', 'groups.keeprates', 'groups.setlinemerges', 'groups.share',
  'groups.unshare', 'groups.update', 'inventory.adjust', 'inventory.categoryrename', 'inventory.cogs', 'inventory.count',
  'inventory.deliver', 'inventory.landedcost', 'inventory.landedcostundo', 'inventory.return', 'inventory.revalue',
  'inventory.stockclosing', 'inventory.stockpolicy', 'inventory.transfer', 'inventory.undodelivery', 'inventoryitem.delete',
  'inventoryitem.field', 'inventoryitem.save', 'invoice.create', 'invoice.delete', 'invoice.spread', 'invoice.spreadundo',
  'invoice.update', 'invoice.writeoff', 'invoice.writeoffreverse', 'journal.create', 'loan.payment', 'notification.read',
  'numbering.update', 'payment.apply', 'payment.creditapply', 'payment.creditrefund', 'payment.creditsautoapply',
  'payment.deposit', 'payment.receive', 'payment.void', 'period.balancesrebuild', 'period.close', 'period.closesteps',
  'period.depreciation', 'period.fxrevaluation', 'period.fxrevaluationundo', 'period.relock', 'period.reopen', 'period.signoff',
  'period.unlock', 'period.yearclose', 'presence.beat', 'presence.leave', 'project.delete', 'project.restore', 'query.ask',
  'query.close', 'query.reply', 'reconciliations.bankline', 'reconciliations.banklinepay', 'reconciliations.banklinesplit',
  'reconciliations.bankrules', 'reconciliations.clear', 'reconciliations.complete', 'reconciliations.reconcile', 'rma.move',
  'rma.request', 'savedlist.allocationrules', 'savedlist.approvaldelegate', 'savedlist.customergroup', 'savedlist.paymenttype',
  'savedlist.pricelists', 'savedlist.roledashboard', 'savedlist.salesreps', 'savedlist.taxprofiles', 'stages.define',
  'stages.move', 'support.message', 'support.status', 'support.ticket', 'tasks.create', 'tasks.remove', 'tasks.status',
  'time.invoice', 'time.log', 'time.move', 'time.rates', 'time.remove', 'time.update', 'user.aikeyremove', 'user.aikeyset',
  'user.preferences', 'user.provision', 'vendor.balance', 'vendor.create', 'vendor.update', 'vendorcredit.create',
  'vendorcredit.delete', 'vendorcredit.update', 'warranty.update', 'watches.create', 'watches.remove', 'workspace.applytemplate',
  'workspace.canceldeletion', 'workspace.create', 'workspace.dimensionaxes', 'workspace.dimensionnode', 'workspace.dimensionnodes',
  'workspace.dimensionnodesmigrate', 'workspace.importmap', 'workspace.importrecords', 'workspace.invite', 'workspace.modules',
  'workspace.nextnumber', 'workspace.openingbalances', 'workspace.restoremaps', 'workspace.retention', 'workspace.revokeinvite',
  'workspace.savetemplate', 'workspace.scheduledeletion', 'workspace.settings', 'workspace.setupcomplete', 'workspace.undoimport',
  'workspace.updaterole',
];

export const REGISTERED_COMMAND_AREAS: readonly string[] = ['account', 'alerts', 'apikey', 'asset', 'auditlog', 'autorule', 'bill', 'budget', 'chartaccount', 'creditnote', 'customer', 'document', 'employee', 'entrylink', 'estimate', 'groups', 'inventory', 'inventoryitem', 'invoice', 'journal', 'loan', 'notification', 'numbering', 'payment', 'period', 'presence', 'project', 'query', 'reconciliations', 'rma', 'savedlist', 'stages', 'support', 'tasks', 'time', 'user', 'vendor', 'vendorcredit', 'warranty', 'watches', 'workspace'];
