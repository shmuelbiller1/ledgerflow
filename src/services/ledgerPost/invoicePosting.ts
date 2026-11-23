import { isIncomeAccount, resolveAccountRole } from '../../lib/accountUtils';
import { roundCents } from '../../lib/cents';
import { Invoice } from '../../types';
import { calculateDocumentTax, cashPostedWithDocumentCents, depositAppliedCents } from '../../lib/documentMath';
import { TransactionTemplates } from '../../kernel/templates/TransactionTemplates';
import { INVOICE_COGS_TYPE, planInvoiceCogs } from '../invoiceCogs';
import { goodsLeaveWith } from '../../lib/deliveries';
import { getAccounts, getTransactions, getWorkspaces, loadInventory, inBaseCurrency, verifyLockDate, findAccount, resolveAccount, lineAccounts, postTxsServerApi, postingToday, documentMinorRate, taxLineStamp, liveDocumentPostings, reversalEntries } from './postingCore';
import type { EntityMutation, LedgerPostContext } from './postingCore';
import { isOpeningBalanceEquity } from '../../lib/openingBalances';

/**
 * Post standard double-entry journal entries for an invoice.
 * Reverses prior postings instead of deleting them.
 */
export async function postInvoiceLedger(
  invoiceId: string, 
  invoiceData: Partial<Invoice>, 
  workspaceId: string, 
  uid: string, 
  entityMutation?: EntityMutation, 
  context?: LedgerPostContext
): Promise<{ cogsPendingReason?: string }> {
  if (!workspaceId || !invoiceId) return {};

  // an invoice spread over months (K-16) keeps its monthly entries: undo the spread before un-posting it
  const unposting = ['draft', 'rejected', 'void', 'cancelled'].includes(String(invoiceData.status || 'pending'));
  if (unposting && invoiceData.revenueSchedule?.id) {
    throw new Error('This invoice is spread over months: undo the spread first (Sales → Undo spread)');
  }

  const invoiceDate = invoiceData.date || postingToday(context);
  verifyLockDate(invoiceDate, context);

  const accounts = getAccounts(context);
  const workspaces = getWorkspaces(context);
  const currentWs = workspaces.find(w => w.id === workspaceId);
  const mappings = currentWs?.defaultAccountMappings || {};

  const arAccount = resolveAccount(
    accounts,
    mappings,
    ['ar', 'accounts receivable', 'receivables', 'receivable'],
    a => a.type === 'asset' && (a.category === 'Receivables' || a.name.toLowerCase().includes('receivable') || a.code === '1100'),
    'Accounts Receivable (A/R)'
  );

  const revenueAccount = resolveAccount(
    accounts,
    mappings,
    ['revenue', 'sales', 'income'],
    a => isIncomeAccount(a) || a.category === 'Revenue' || a.category === 'Sales',
    'Sales Revenue'
  );

  const cashAccount = resolveAccount(
    accounts,
    mappings,
    ['cash', 'bank', 'checking'],
    a => resolveAccountRole(a) === 'cash',
    'Cash & Cash Equivalents'
  );

  // 1. Reversing entries for the standing postings: never one already reversed, and never a
  // separate-lifecycle bad-debt write-off/recovery entry managed exclusively by badDebtService (A8-013)
  const today = postingToday(context);
  const existingTxs = liveDocumentPostings(
    getTransactions(context),
    t => t.metadata?.invoiceId === invoiceId,
    { excludeTypes: new Set(['invoice-bad-debt-writeoff', 'invoice-bad-debt-recovery']) },
  );
  const txsToPost = reversalEntries(existingTxs, {
    uid, workspaceId, today, context,
    describe: () => `Reversal of prior invoice posting (Invoice ${invoiceData.number || invoiceId})`,
    metadata: () => ({ invoiceId, type: 'invoice-reversal' })
  });

  const status = invoiceData.status || 'pending';
  if (status === 'draft' || status === 'rejected' || status === 'void' || status === 'cancelled') {
    // If setting to draft, rejected, voided, or cancelled, reversing prior postings (if any) is sufficient
    // the document itself is saved with them; a new draft has nothing to reverse and is still saved
    if (txsToPost.length > 0 || entityMutation) {
      await postTxsServerApi(txsToPost, workspaceId, entityMutation, context);
    }
    return {};
  }

  const rawAmount = invoiceData.amountCents || 0;
  // BM-04: minor units of the document's currency → minor units of the books' (¥ has none, KWD three)
  const rate = documentMinorRate(invoiceData, workspaceId, context);
  const amount = roundCents(rawAmount * rate);
  if (amount <= 0) { if (entityMutation) { await postTxsServerApi([], workspaceId, entityMutation, context); } return {}; }

  const invoiceNum = invoiceData.number || invoiceId;
  const customer = invoiceData.customerName || 'Customer';

  const taxAmount = roundCents(calculateDocumentTax(invoiceData) * rate);
  const discountAmount = roundCents((invoiceData.discountCents || 0) * rate);
  const retainageAmount = roundCents((invoiceData.retainageCents || 0) * rate);

  const taxAccount = taxAmount > 0 ? resolveAccount(
    accounts,
    mappings,
    ['tax payable', 'sales tax', 'tax liability', 'tax'],
    a => a.type === 'liability' && (a.name.toLowerCase().includes('tax') || a.category === 'Taxes'),
    'Sales Tax Payable'
  ) : null;

  const discountAccount = discountAmount > 0 ? resolveAccount(
    accounts,
    mappings,
    ['discount', 'sales discount'],
    a => a.type === 'expense' || (isIncomeAccount(a) && a.name.toLowerCase().includes('discount')),
    'Sales Discounts'
  ) : null;
  
  const retainageAccount = retainageAmount > 0 ? resolveAccount(
    accounts,
    mappings,
    ['retainage', 'retention'],
    a => a.type === 'asset' && a.category === 'Receivables' && (a.name.toLowerCase().includes('retainage') || a.name.toLowerCase().includes('retention')),
    'Retainage Receivable'
  ) : null;
  
  // income accounts; Opening Balance Equity only for a customer's opening balance (BA-02)
  const docLines = lineAccounts(invoiceData.items, accounts, revenueAccount, a => isIncomeAccount(a) || isOpeningBalanceEquity(a));
  const accrualLines = TransactionTemplates.buildInvoiceLines({
    invoiceNumber: String(invoiceNum),
    customerName: customer,
    totalCents: amount,
    taxCents: taxAmount,
    discountCents: discountAmount,
    retainageCents: retainageAmount,
    exchangeRate: invoiceData.exchangeRate || 1,
    arAccount,
    revenueAccount,
    lineAccounts: docLines,
    taxAccount,
    taxStamp: taxLineStamp(invoiceData),
    discountAccount,
    retainageAccount
  });

  const accrualTx = {
    uid,
    workspaceId,
    date: invoiceDate,
    description: `Invoice ${invoiceNum} - ${customer}`,
    totalAmountCents: amount,
    currency: invoiceData.currency || 'USD',
    exchangeRate: invoiceData.exchangeRate || 1,
    status: 'completed',
    type: 'actual',
    createdAt: new Date().toISOString(),
    metadata: {
      invoiceId,
      customerId: invoiceData.customerId,
      type: 'invoice-accrual'
    },
    lines: accrualLines
  };
  txsToPost.push(inBaseCurrency(accrualTx, workspaceId, context, invoiceData.metadata?.rateUsed as never));

  // 2.2 Deposit received in advance (AF-03): the money was booked to a Customer Deposits liability
  // when it came in; the invoice moves it against the receivable. Tax stays on the full invoice.
  const depositAmount = roundCents(depositAppliedCents(invoiceData) * rate);
  if (depositAmount > 0) {
    const depositAccount = resolveAccount(
      accounts,
      mappings,
      ['customer deposits', 'deposits', 'customer advances'],
      a => resolveAccountRole(a) === 'liability' && /deposit|advance|unearned|retainer/i.test(a.name || ''),
      'Customer Deposits'
    );
    const description = `Deposit applied to Invoice ${invoiceNum} - ${customer}`;
    txsToPost.push(inBaseCurrency({
      uid,
      workspaceId,
      date: invoiceDate,
      description,
      totalAmountCents: depositAmount,
      currency: invoiceData.currency || 'USD',
      exchangeRate: invoiceData.exchangeRate || 1,
      status: 'completed',
      type: 'actual',
      createdAt: new Date().toISOString(),
      metadata: { invoiceId, customerId: invoiceData.customerId, type: 'invoice-deposit' },
      lines: [
        { accountId: depositAccount.id, accountName: depositAccount.name, amountCents: depositAmount, description, exchangeRate: rate },
        { accountId: arAccount.id, accountName: arAccount.name, amountCents: -depositAmount, description, exchangeRate: rate },
      ],
    }, workspaceId, context, invoiceData.metadata?.rateUsed as never));
  }

  // 2.5 Cost of goods sold for lines that sell inventory items (the server moves the stock). Where
  // deliveries ship the goods (BF-08 step 2) an invoice books none, unless it already shipped its
  // goods before the workspace switched (an edit keeps that).
  const shipsGoods = goodsLeaveWith(currentWs) === 'invoice' || existingTxs.some(t => t.metadata?.type === INVOICE_COGS_TYPE);
  // M-21 step 2: the standard each existing sale line was already posted at. Reposting an invoice
  // reverses its old cost-of-goods entries and rebuilds them; a line whose standard has since changed
  // must keep the basis it was posted at, or the repost would reprice it and leave Inventory out of step.
  const originalStandards = new Map<string, { standardCostCents: number; quantity: number }>();
  for (const tx of existingTxs) {
    const meta = tx.metadata as { type?: string; cogsForLineId?: string; standardCostCents?: number; quantity?: number; standardQty?: number } | undefined;
    if (meta?.type === INVOICE_COGS_TYPE && typeof meta.cogsForLineId === 'string' && typeof meta.standardCostCents === 'number') {
      // the units the recorded standard applies to: the original sale's quantity, or the split recorded
      // when a later edit added units at the then-current standard
      const appliesTo = typeof meta.standardQty === 'number' ? meta.standardQty : Number(meta.quantity) || 0;
      originalStandards.set(meta.cogsForLineId, { standardCostCents: meta.standardCostCents, quantity: appliesTo });
    }
  }
  const cogs = !shipsGoods ? { entries: [], pendingReason: undefined } : planInvoiceCogs({
    invoiceId, invoice: invoiceData, date: invoiceDate, uid, workspaceId,
    baseCurrency: currentWs?.currency || 'USD',
    inventoryAccount: findAccount(accounts, mappings, ['inventory', 'stock', 'inventory asset'], a => resolveAccountRole(a) === 'inventory'),
    cogsAccount: findAccount(accounts, mappings, ['cogs', 'cost of goods sold', 'direct costs'], a => resolveAccountRole(a) === 'cogs'),
    items: await loadInventory(invoiceData, context),
    // M-21 step 2: a workspace posting at standard relieves the stock at the item's standard
    postAtStandard: Boolean(currentWs?.standardCosting?.enabled),
    originalStandards,
  });
  txsToPost.push(...cogs.entries);
  const wasPending = Boolean(invoiceData.metadata?.cogsPending);
  if (entityMutation && entityMutation.action !== 'delete' && (cogs.pendingReason || wasPending)) {
    entityMutation.data = { ...entityMutation.data, metadata: { ...(invoiceData.metadata || {}), cogsPending: Boolean(cogs.pendingReason) } };
  }

  // 3. Transaction 2: Payment Posting (DR Cash, CR A/R)
  if (status === 'paid' || status === 'partially_paid') {
    // Only what was marked paid on the document itself; payment records and credits post their own entries
    const paidAmtCents = roundCents(cashPostedWithDocumentCents({ ...invoiceData, status }) * rate);
    if (paidAmtCents > 0) {
      const paymentDate = invoiceData.paymentDate || invoiceData.paidAt || today;
      const paymentTx = {
        uid,
        workspaceId,
        date: paymentDate,
        description: `Payment Received for Invoice ${invoiceNum} - ${customer}`,
        totalAmountCents: paidAmtCents,
        currency: invoiceData.currency || 'USD',
        exchangeRate: invoiceData.exchangeRate || 1,
        status: 'completed',
        type: 'actual',
        createdAt: new Date().toISOString(),
        metadata: {
          invoiceId,
          customerId: invoiceData.customerId,
          type: 'invoice-payment'
        },
        lines: TransactionTemplates.buildPaymentLines({
          documentNumber: String(invoiceNum),
          entityName: customer,
          amountCents: paidAmtCents,
          exchangeRate: invoiceData.exchangeRate || 1,
          cashAccount,
          offsetAccount: arAccount,
          isReceipt: true,
          lineAccounts: docLines // DIM-1: the payment carries the invoice lines' labels
        })
      };
      txsToPost.push(inBaseCurrency(paymentTx, workspaceId, context, invoiceData.metadata?.rateUsed as never));
    }
  }

  // Atomic post via Server API
  await postTxsServerApi(txsToPost, workspaceId, entityMutation, context);
  return { cogsPendingReason: cogs.pendingReason };
}
