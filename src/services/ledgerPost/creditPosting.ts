import { roundCents } from '../../lib/cents';
import { planReturnEntries, returnableLines, returnProblem } from '../../lib/salesReturns';
import { isIncomeAccount, resolveAccountRole } from '../../lib/accountUtils';
import { CreditNote, VendorCredit } from '../../types';
import { getAccounts, getTransactions, getWorkspaces, inBaseCurrency, verifyLockDate, resolveAccount, postTxsServerApi, findAccount, getInvoices, postingToday, documentMinorRate, liveDocumentPostings, reversalEntries } from './postingCore';
import { validStandardCost } from '../../lib/standardCostSettings';
import type { EntityMutation, LedgerPostContext, PostableTransaction } from './postingCore';

/**
 * Post double-entry journal entries for a Customer Credit Note.
 */
export async function postCreditNoteLedger(
  creditNoteId: string, 
  creditNoteData: Partial<CreditNote>, 
  workspaceId: string, 
  uid: string, 
  entityMutation?: EntityMutation, 
  context?: LedgerPostContext
) {
  if (!workspaceId || !creditNoteId) return;

  const cnDate = creditNoteData.date || postingToday(context);
  verifyLockDate(cnDate, context);

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

  const salesReturnAccount = resolveAccount(
    accounts,
    mappings,
    ['revenue', 'sales', 'income', 'sales returns'],
    a => isIncomeAccount(a) || a.category === 'Revenue',
    'Sales Returns / Revenue'
  );

  // Reversals of prior CN postings
  const today = postingToday(context);
  const txsToPost = reversalEntries(liveDocumentPostings(getTransactions(context), t => t.metadata?.creditNoteId === creditNoteId), {
    uid, workspaceId, today, context,
    describe: () => `Reversal of prior credit note posting (CN ${creditNoteId})`,
    metadata: (prevTx) => ({
      creditNoteId,
      type: 'credit-note-reversal',
      // a returned-goods entry's reversal names its invoice too (BF-06)
      ...(prevTx.metadata?.invoiceId ? { invoiceId: prevTx.metadata.invoiceId } : {})
    })
  });

  // A draft has no financial effect: saving one posts nothing, and taking an issued credit back to draft reverses
  // its posting like a void does (audit F1, 5 Nov). Only issuing it (open) posts it.
  if (creditNoteData.status === 'void' || creditNoteData.status === 'draft') {
    // A credit already applied to invoices/bills or refunded can't be voided (that would undo money that moved)
    if (typeof creditNoteData.remainingCents === 'number' && creditNoteData.remainingCents < (creditNoteData.amountCents || 0)) {
      throw new Error(creditNoteData.status === 'void'
        ? 'This credit has been applied or refunded and can no longer be voided.'
        : 'This credit has been applied or refunded and can no longer go back to draft.');
    }
    if (txsToPost.length > 0 || entityMutation) {
      await postTxsServerApi(txsToPost, workspaceId, entityMutation, context);
    }
    return;
  }

  const rawAmount = creditNoteData.amountCents || 0;
  // BM-04: minor units of the document's currency → minor units of the books'
  const rate = documentMinorRate(creditNoteData, workspaceId, context);
  const amount = roundCents(rawAmount * rate);
  if (amount <= 0) return;
  // The credited invoice's share of tax comes off tax payable too (L-118)
  const cnTax = creditNoteData.taxVersion === 2 ? Math.min(amount, roundCents((creditNoteData.taxAmountCents || 0) * rate)) : 0;
  const cnTaxAccount = cnTax > 0 ? resolveAccount(
    accounts,
    mappings,
    ['tax payable', 'sales tax', 'tax liability', 'tax'],
    a => a.type === 'liability' && (a.name.toLowerCase().includes('tax') || a.category === 'Taxes'),
    'Sales Tax Payable'
  ) : null;

  const cnTx = {
    uid,
    workspaceId,
    date: cnDate,
    description: `Credit Note ${creditNoteData.number || creditNoteId}: ${creditNoteData.customerName || 'Customer'}`,
    totalAmountCents: amount,
    currency: creditNoteData.currency || 'USD',
    exchangeRate: creditNoteData.exchangeRate || 1,
    status: 'completed',
    type: 'actual',
    createdAt: new Date().toISOString(),
    metadata: {
      creditNoteId,
      customerId: creditNoteData.customerId,
      type: 'credit-note-issuance'
    },
    lines: [
      { accountId: salesReturnAccount.id, accountName: salesReturnAccount.name, amountCents: amount - cnTax, debitCents: amount - cnTax, creditCents: 0, description: 'Sales Return / Discount' },
      ...(cnTax > 0 && cnTaxAccount ? [{ accountId: cnTaxAccount.id, accountName: cnTaxAccount.name, amountCents: cnTax, debitCents: cnTax, creditCents: 0, description: 'Sales tax reversed by the credit' }] : []),
      { accountId: arAccount.id, accountName: arAccount.name, amountCents: -amount, debitCents: 0, creditCents: amount, description: 'Accounts Receivable Credit' }
    ]
  };
  txsToPost.push(inBaseCurrency(cnTx, workspaceId, context, creditNoteData.metadata?.rateUsed as never));

  // BF-06: goods the customer sent back go back into stock, at the cost they left at
  const goods = (creditNoteData.returnedGoods || []).filter(g => g.quantity > 0);
  if (goods.length > 0) {
    const invoice = getInvoices(context).find(i => i.id === creditNoteData.invoiceId);
    if (!invoice) throw new Error('Returned goods need the credited invoice: link the credit note to it, or open Sales and try again.');
    // the credit note's own earlier returns are reversed above, so they don't count against it
    const lines = returnableLines(invoice, getTransactions(context), creditNoteId);
    const problem = returnProblem(goods, lines);
    if (problem) throw new Error(problem);
    // M-21 step 2: under standard-cost posting a sale relieved stock at the standard it had then. If the
    // item's standard has changed since (it could be, once the stock sold down to zero), bringing the
    // units back at the old sale cost and relieving them again at the new standard leaves Inventory out of
    // step. Refuse the incompatible return before it changes stock.
    if (currentWs?.standardCosting?.enabled) {
      const itemsById = new Map((context?.inventory || []).map(i => [i.id, i]));
      for (const g of goods) {
        const line = lines.find(l => l.invoiceLineId === g.invoiceLineId);
        if (!line || line.saleStandard !== true) continue;
        // an item the context did not load (the sample-workspace path) is not a changed standard:
        // without the item there is no standard to compare against, so the return posts as before
        const item = itemsById.get(g.itemId);
        const currentStandard = item ? validStandardCost(item.standardCostCents) : null;
        if (currentStandard !== null && currentStandard !== line.unitCostCents) {
          throw new Error(`The standard cost of ${line.description || g.itemId} changed since it was sold, so returning it at the sale's cost would leave Inventory out of step with the standard. Revalue the stock or turn standard-cost posting off before recording this return.`);
        }
      }
    }
    const inventoryAccount = findAccount(accounts, mappings, ['inventory', 'stock', 'inventory asset'], a => resolveAccountRole(a) === 'inventory');
    const cogsAccount = findAccount(accounts, mappings, ['cogs', 'cost of goods sold', 'direct costs'], a => resolveAccountRole(a) === 'cogs');
    if (!inventoryAccount || !cogsAccount) throw new Error('Returned goods need an Inventory account and a Cost of Goods Sold account in the chart of accounts.');
    txsToPost.push(...planReturnEntries({
      creditNote: { id: creditNoteId, number: creditNoteData.number, invoiceId: creditNoteData.invoiceId, date: cnDate, returnedGoods: goods, customerId: creditNoteData.customerId },
      lines, uid, workspaceId, baseCurrency: currentWs?.currency || 'USD', inventoryAccount, cogsAccount,
    }) as PostableTransaction[]);
  }

  await postTxsServerApi(txsToPost, workspaceId, entityMutation, context);
}

/**
 * Post double-entry journal entries for a Vendor Credit.
 */
export async function postVendorCreditLedger(
  vendorCreditId: string, 
  vendorCreditData: Partial<VendorCredit>, 
  workspaceId: string, 
  uid: string, 
  entityMutation?: EntityMutation, 
  context?: LedgerPostContext
) {
  if (!workspaceId || !vendorCreditId) return;

  const vcDate = vendorCreditData.date || postingToday(context);
  verifyLockDate(vcDate, context);

  const accounts = getAccounts(context);
  const workspaces = getWorkspaces(context);
  const currentWs = workspaces.find(w => w.id === workspaceId);
  const mappings = currentWs?.defaultAccountMappings || {};

  const apAccount = resolveAccount(
    accounts,
    mappings,
    ['ap', 'accounts payable', 'payables', 'payable'],
    a => a.type === 'liability' && (a.category === 'Payables' || resolveAccountRole(a) === 'ap' || a.code === '2000'),
    'Accounts Payable (A/P)'
  );

  const expenseAccount = resolveAccount(
    accounts,
    mappings,
    ['expense', 'purchase rebates', 'cogs'],
    a => a.type === 'expense' || a.category === 'Expense' || a.category === 'COGS',
    'Purchase Rebates / Expense'
  );

  // Reversals of prior VC postings
  const today = postingToday(context);
  const txsToPost = reversalEntries(liveDocumentPostings(getTransactions(context), t => t.metadata?.vendorCreditId === vendorCreditId), {
    uid, workspaceId, today, context,
    describe: () => `Reversal of prior vendor credit posting (VC ${vendorCreditId})`,
    metadata: () => ({ vendorCreditId, type: 'vendor-credit-reversal' })
  });

  // A draft has no financial effect: saving one posts nothing, and taking an issued credit back to draft reverses
  // its posting like a void does (audit F1, 5 Nov). Only issuing it (open) posts it.
  if (vendorCreditData.status === 'void' || vendorCreditData.status === 'draft') {
    // A credit already applied to invoices/bills or refunded can't be voided (that would undo money that moved)
    if (typeof vendorCreditData.remainingCents === 'number' && vendorCreditData.remainingCents < (vendorCreditData.amountCents || 0)) {
      throw new Error(vendorCreditData.status === 'void'
        ? 'This credit has been applied or refunded and can no longer be voided.'
        : 'This credit has been applied or refunded and can no longer go back to draft.');
    }
    if (txsToPost.length > 0 || entityMutation) {
      await postTxsServerApi(txsToPost, workspaceId, entityMutation, context);
    }
    return;
  }

  const rawAmount = vendorCreditData.amountCents || 0;
  // BM-04: minor units of the document's currency → minor units of the books'
  const rate = documentMinorRate(vendorCreditData, workspaceId, context);
  const amount = roundCents(rawAmount * rate);
  if (amount <= 0) return;
  // The credited bill's share of input tax is no longer reclaimable (L-118)
  const vcTax = vendorCreditData.taxVersion === 2 ? Math.min(amount, roundCents((vendorCreditData.taxAmountCents || 0) * rate)) : 0;
  const vcTaxAccount = vcTax > 0 ? resolveAccount(
    accounts,
    mappings,
    ['tax paid', 'input tax', 'tax asset', 'tax', 'tax expense'],
    a => (a.type === 'asset' || a.type === 'expense' || a.type === 'liability') && a.name.toLowerCase().includes('tax'),
    'Tax Paid'
  ) : null;

  // BF-07: stock sent back to the vendor comes off Inventory (at the bill line's cost) instead of the
  // expense, and the entry says which units leave stock (the server takes them out)
  const goods = (vendorCreditData.returnedGoods || []).filter(g => g.quantity > 0);
  const goodsBase = goods.map(g => roundCents(g.valueCents * rate));
  const goodsTotal = goodsBase.reduce((s, c) => s + c, 0);
  if (goodsTotal > amount - vcTax) throw new Error('The goods sent back are worth more than the credit (before tax): raise the credit, or send back fewer');
  const inventoryAccount = goods.length ? findAccount(accounts, mappings, ['inventory', 'stock', 'inventory asset'], a => resolveAccountRole(a) === 'inventory') : null;
  if (goods.length && !inventoryAccount) throw new Error('Add an Inventory account (an asset) to the chart of accounts to send stock back to a vendor');
  // M-21 step 2: with standard-cost posting on, the stock came in at its standard, so what goes back comes
  // off Inventory at the standard carrying value and the difference reverses the variance the receipt booked
  const standardizing = Boolean(currentWs?.standardCosting?.enabled);
  const itemsById = new Map((context?.inventory || []).map(i => [i.id, i]));
  const carriedValues = goods.map(g => {
    if (!standardizing) return roundCents(g.valueCents * rate);
    const standard = validStandardCost(itemsById.get(g.itemId)?.standardCostCents);
    return standard !== null ? roundCents(g.quantity * standard) : roundCents(g.valueCents * rate);
  });
  const carriedTotal = carriedValues.reduce((s, c) => s + c, 0);
  let varianceAccount: { id: string; name: string } | null = null;
  let varianceCents = 0;
  if (standardizing && goods.length) {
    const found = accounts.find(a => a.id === currentWs?.standardCosting?.varianceAccountId);
    if (!found) throw new Error('The purchase-price variance account set in Workspace Settings is not in the chart of accounts.');
    varianceAccount = found;
    varianceCents = carriedTotal - goodsTotal; // the receipt's variance (actual − standard) goes back
  }
  const rebate = amount - vcTax - goodsTotal;

  const vcTx = {
    uid,
    workspaceId,
    date: vcDate,
    description: `Vendor Credit ${vendorCreditData.number || vendorCreditId}: ${vendorCreditData.vendorName || 'Vendor'}`,
    totalAmountCents: amount,
    currency: vendorCreditData.currency || 'USD',
    exchangeRate: vendorCreditData.exchangeRate || 1,
    status: 'completed',
    type: 'actual',
    createdAt: new Date().toISOString(),
    metadata: {
      vendorCreditId,
      vendorId: vendorCreditData.vendorId,
      type: 'vendor-credit-issuance',
      // DIM-2 phase 2: each line sent back names the bill line it came in on (and the bill, under its own key so the
      // entry is never mistaken for the bill's own)
      // M-21 step 2: stockOut carries the standard value the books relieve at, and — only when it differs —
      // the actual value the return's stock move must use to keep the moving-average basis (the receipt's actual cost)
      ...(goods.length ? { stockOut: goods.map((g, i) => ({ itemId: g.itemId, quantity: g.quantity, valueCents: carriedValues[i], ...(carriedValues[i] !== goodsBase[i] ? { actualValueCents: goodsBase[i] } : {}), ...(Number.isSafeInteger(g.billLine) ? { billLine: g.billLine } : {}) })) } : {}),
      ...(goods.length && vendorCreditData.billId ? { returnsFromBillId: vendorCreditData.billId } : {}),
    },
    lines: [
      { accountId: apAccount.id, accountName: apAccount.name, amountCents: amount, debitCents: amount, creditCents: 0, description: 'Accounts Payable Reduction' },
      ...(carriedTotal > 0 && inventoryAccount ? [{ accountId: inventoryAccount.id, accountName: inventoryAccount.name, amountCents: -carriedTotal, debitCents: 0, creditCents: carriedTotal, description: 'Stock sent back to the vendor' }] : []),
      ...(varianceAccount && varianceCents !== 0 ? [{ accountId: varianceAccount.id, accountName: varianceAccount.name, amountCents: varianceCents, description: 'Purchase price variance reversed on stock sent back to the vendor', exchangeRate: rate }] : []),
      ...(rebate !== 0 ? [{ accountId: expenseAccount.id, accountName: expenseAccount.name, amountCents: -rebate, debitCents: 0, creditCents: rebate, description: 'Purchase Rebate / Expense Discount' }] : []),
      ...(vcTax > 0 && vcTaxAccount ? [{ accountId: vcTaxAccount.id, accountName: vcTaxAccount.name, amountCents: -vcTax, debitCents: 0, creditCents: vcTax, description: 'Input tax reversed by the credit' }] : [])
    ]
  };
  txsToPost.push(inBaseCurrency(vcTx, workspaceId, context, vendorCreditData.metadata?.rateUsed as never));

  await postTxsServerApi(txsToPost, workspaceId, entityMutation, context);
}
