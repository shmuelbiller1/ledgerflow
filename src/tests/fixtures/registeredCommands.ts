/**
 * Every registered command name and area, sorted — asserted by `commands.test.ts` and kept here so that test stays
 * about the registry's behaviour rather than being half a page of strings.
 *
 * The list is regenerated from `createDefaultCommandRegistry()` (the test itself fails loudly when they disagree, which
 * is what makes it a guard: a command added without a thought for the list is caught by the diff).
 */
export const REGISTERED_COMMAND_NAMES: readonly string[] = [
  'account.makerecoverycodes', 'account.merge', 'account.mergepreview', 'account.setnotificationemail',
  'account.userecoverycode', 'alerts.update', 'apikey.provision', 'apikey.revoke', 'apikey.revokepersonal',
  'asset.costaddition', 'asset.dispose', 'asset.placeservice', 'asset.transfer', 'asset.undispose',
  'asset.undoplaceservice', 'asset.undotransfer', 'auditlog.append', 'autorule.create', 'autorule.delete',
  'autorule.group', 'autorule.learn', 'autorule.recordhits', 'autorule.reset', 'autorule.update', 'bill.create',
  'bill.delete', 'bill.spread', 'bill.spreadundo', 'bill.update', 'budget.delete', 'budget.save', 'chartaccount.create',
  'chartaccount.delete', 'chartaccount.update', 'contact.delete', 'contact.merge', 'creditnote.create',
  'creditnote.delete', 'creditnote.update', 'customer.balance', 'customer.create', 'customer.update', 'document.save',
  'employee.create', 'employee.update', 'entrylink.create', 'entrylink.remove', 'estimate.save', 'estimate.signlink',
  'estimate.status', 'groups.create', 'groups.delete', 'groups.keeprates', 'groups.setlinemerges', 'groups.share',
  'groups.unshare', 'groups.update', 'inventory.adjust', 'inventory.categoryrename', 'inventory.cogs',
  'inventory.count', 'inventory.deliver', 'inventory.landedcost', 'inventory.landedcostundo', 'inventory.return',
  'inventory.revalue', 'inventory.stockclosing', 'inventory.stockpolicy', 'inventory.transfer',
  'inventory.undodelivery', 'inventoryitem.delete', 'inventoryitem.field', 'inventoryitem.save', 'invoice.create',
  'invoice.delete', 'invoice.spread', 'invoice.spreadundo', 'invoice.update', 'invoice.writeoff',
  'invoice.writeoffreverse', 'journal.batchupdate', 'journal.create', 'journal.recategorize', 'journaltemplate.remove',
  'journaltemplate.save', 'lease.capitalize', 'loan.payment', 'notification.read', 'numbering.update', 'payment.apply',
  'payment.creditapply', 'payment.creditrefund', 'payment.creditsautoapply', 'payment.deposit', 'payment.receive',
  'payment.void', 'payroll.approval', 'payroll.approve', 'payroll.reject', 'payroll.run', 'payroll.undo',
  'period.balancesrebuild', 'period.close', 'period.closesteps', 'period.depreciation', 'period.fxrevaluation',
  'period.fxrevaluationundo', 'period.relock', 'period.reopen', 'period.signoff', 'period.unlock', 'period.yearclose',
  'portal.linkcreate', 'portal.linkrevoke', 'presence.beat', 'presence.leave', 'project.delete', 'project.restore',
  'query.ask', 'query.close', 'query.reply', 'reconciliations.bankline', 'reconciliations.banklinepay',
  'reconciliations.banklinesplit', 'reconciliations.bankrules', 'reconciliations.clear', 'reconciliations.complete',
  'reconciliations.reconcile', 'record.delete', 'record.fields', 'record.save', 'reportschedule.preview',
  'reportschedule.send', 'revenue.recognize', 'rma.move', 'rma.request', 'savedlist.allocationrules',
  'savedlist.approvaldelegate', 'savedlist.customergroup', 'savedlist.paymenttype', 'savedlist.pricelists',
  'savedlist.roledashboard', 'savedlist.salesreps', 'savedlist.taxprofiles', 'security.twoperson', 'security.twostep',
  'stages.define', 'stages.move', 'support.message', 'support.status', 'support.ticket', 'tag.change', 'tasks.create',
  'tasks.remove', 'tasks.status', 'tax.file', 'time.invoice', 'time.log', 'time.move', 'time.rates', 'time.remove',
  'time.update', 'user.aikeyremove', 'user.aikeyset', 'user.preferences', 'user.provision', 'vendor.balance',
  'vendor.create', 'vendor.update', 'vendorcredit.create', 'vendorcredit.delete', 'vendorcredit.update',
  'warranty.update', 'watches.create', 'watches.remove', 'workspace.applytemplate', 'workspace.branding',
  'workspace.canceldeletion', 'workspace.create', 'workspace.dimensionaxes', 'workspace.dimensionnode',
  'workspace.dimensionnodes', 'workspace.dimensionnodesmigrate', 'workspace.importmap', 'workspace.importrecords',
  'workspace.invite', 'workspace.modules', 'workspace.nextnumber', 'workspace.openingbalances', 'workspace.restoremaps',
  'workspace.retention', 'workspace.revokeinvite', 'workspace.savetemplate', 'workspace.scheduledeletion',
  'workspace.settings', 'workspace.setupcomplete', 'workspace.undoimport', 'workspace.updaterole',
];

export const REGISTERED_COMMAND_AREAS: readonly string[] = [
  'account', 'alerts', 'apikey', 'asset', 'auditlog', 'autorule', 'bill', 'budget', 'chartaccount', 'contact',
  'creditnote', 'customer', 'document', 'employee', 'entrylink', 'estimate', 'groups', 'inventory', 'inventoryitem',
  'invoice', 'journal', 'journaltemplate', 'lease', 'loan', 'notification', 'numbering', 'payment', 'payroll', 'period',
  'portal', 'presence', 'project', 'query', 'reconciliations', 'record', 'reportschedule', 'revenue', 'rma',
  'savedlist', 'security', 'stages', 'support', 'tag', 'tasks', 'tax', 'time', 'user', 'vendor', 'vendorcredit',
  'warranty', 'watches', 'workspace',
];
