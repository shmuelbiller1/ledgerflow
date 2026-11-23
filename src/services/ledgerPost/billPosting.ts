import { resolveAccountRole } from '../../lib/accountUtils';
import { roundCents } from '../../lib/cents';
import { Bill } from '../../types';
import { calculateDocumentTax, cashPostedWithDocumentCents } from '../../lib/documentMath';
import { TransactionTemplates, labelKey } from '../../kernel/templates/TransactionTemplates';
import { allocateCents } from '../../lib/Allocation';
import { BILL_ACCRUAL_TYPE, billItemProblem, billStockLines, planStandardReceipt } from '../../lib/billStock';
import { getAccounts, getTransactions, getWorkspaces, inBaseCurrency, verifyLockDate, findAccount, resolveAccount, lineAccounts, loadInventory, postTxsServerApi, postingToday, documentMinorRate, taxLineStamp, liveDocumentPostings, reversalEntries } from './postingCore';
import type { EntityMutation, LedgerPostContext } from './postingCore';

/**
 * Post standard double-entry journal entries for a bill.
 * Reverses prior postings instead of deleting them.
 */
export async function postBillLedger(
  billId: string, 
  billData: Partial<Bill>, 
  workspaceId: string, 
  uid: string, 
  entityMutation?: EntityMutation, 
  context?: LedgerPostContext
) {
  if (!workspaceId || !billId) return;

  // a bill spread over months (K-17) keeps its monthly entries: undo the spread before un-posting it
  const unposting = ['draft', 'rejected', 'void', 'cancelled'].includes(String(billData.status || 'pending'));
  if (unposting && billData.prepaidSchedule?.id) {
    throw new Error('This bill is spread over months: undo the spread first (Purchases → Undo spread)');
  }

  const billDate = billData.date || postingToday(context);
  verifyLockDate(billDate, context);

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
    ['expense', 'operating expense'],
    a => a.type === 'expense' || a.category === 'Expense',
    'Operating Expense'
  );

  const cashAccount = resolveAccount(
    accounts,
    mappings,
    ['cash', 'bank', 'checking'],
    a => resolveAccountRole(a) === 'cash',
    'Cash & Cash Equivalents'
  );

  // 1. Reversing entries for the standing postings (a posting already reversed is left alone)
  const today = postingToday(context);
  const priorPostings = liveDocumentPostings(getTransactions(context), t => t.metadata?.billId === billId);
  const txsToPost = reversalEntries(priorPostings, {
    uid, workspaceId, today, context,
    describe: () => `Reversal of prior bill posting (Bill ${billData.number || billId})`,
    metadata: () => ({ billId, type: 'bill-reversal' })
  });
  // M-21 step 2: the carrying value the bill's original receipt posted at, so a repost keeps the basis
  // its unchanged lines were booked on (the item's standard can change once the stock sold down to zero)
  const priorAccrual = priorPostings.find(t => t.metadata?.type === BILL_ACCRUAL_TYPE);
  const originalReceipt = new Map<string | number, { itemId: string; quantity: number; valueCents: number; actualValueCents?: number }>();
  for (const row of (priorAccrual?.metadata?.stockIn as Array<{ itemId: string; quantity: number; valueCents: number; actualValueCents?: number; line?: number }> | undefined) || []) {
    if (typeof row.itemId === 'string' && Number.isFinite(row.quantity) && Number.isFinite(row.valueCents)) {
      // keyed by the bill line the units came in on, so repeated items on separate lines keep their
      // own basis (a row without a line index falls back to the item)
      const key = Number.isSafeInteger(row.line) && Number(row.line) >= 0 ? Number(row.line) : `item:${row.itemId}`;
      originalReceipt.set(key, {
        itemId: row.itemId, quantity: row.quantity, valueCents: row.valueCents,
        ...(typeof row.actualValueCents === 'number' ? { actualValueCents: row.actualValueCents } : {}),
      });
    }
  }

  const status = billData.status || 'pending';
  if (status === 'draft' || status === 'rejected' || status === 'void' || status === 'cancelled') {
    // the document itself is saved with them; a new draft has nothing to reverse and is still saved
    if (txsToPost.length > 0 || entityMutation) {
      await postTxsServerApi(txsToPost, workspaceId, entityMutation, context);
    }
    return;
  }

  const rawAmount = billData.amountCents || 0;
  // BM-04: minor units of the document's currency → minor units of the books' (¥ has none, KWD three)
  const rate = documentMinorRate(billData, workspaceId, context);
  const amount = roundCents(rawAmount * rate);
  if (amount <= 0) { if (entityMutation) { await postTxsServerApi([], workspaceId, entityMutation, context); } return; }

  const billNum = billData.number || billId;
  const vendor = billData.vendorName || 'Vendor';

  // 2. Transaction 1: Accrual Posting
  const taxAmount = roundCents(calculateDocumentTax(billData) * rate);
  const selfAssessed = roundCents((billData.selfAssessedTaxCents || 0) * rate);

  // only a bill with tax needs a tax account (a workspace without one could record no bill at all; L-183)
  const taxAccount = taxAmount > 0 || selfAssessed > 0 ? resolveAccount(
    accounts,
    mappings,
    ['tax paid', 'input tax', 'tax asset', 'tax', 'tax expense'],
    a => (a.type === 'asset' || a.type === 'expense' || a.type === 'liability') && a.name.toLowerCase().includes('tax'),
    'Tax Paid'
  ) : null;

  // J-08: lines that buy an inventory item post to Inventory, and the entry says what came in; each
  // item line's value is its share of the posted amount exactly as the lines below get it
  const itemSplits = (billData.splits || []).filter(sp => sp.itemId);
  for (const sp of itemSplits) {
    const problem = billItemProblem(sp);
    if (problem) throw new Error(`Bill ${billNum}: ${problem}`);
  }
  const inventoryAccount = itemSplits.length ? findAccount(accounts, mappings, ['inventory', 'stock', 'inventory asset'], a => resolveAccountRole(a) === 'inventory') : null;
  if (itemSplits.length && !inventoryAccount) throw new Error('Add an Inventory account (an asset) to the chart of accounts to buy stock on a bill');
  // BA-03: freight and duties spread over the items go to Inventory too (without items, they stay ordinary lines)
  const splits = (billData.splits || []).map(sp => ((sp.itemId || sp.landedCost) && inventoryAccount ? { ...sp, accountId: inventoryAccount.id } : sp));
  const weights = lineAccounts(splits, accounts, expenseAccount, a => !['cash', 'ar', 'ap'].includes(resolveAccountRole(a)));
  const stockIn = itemSplits.length && weights ? billStockLines(splits, allocateCents(amount - taxAmount, weights.map(w => w.weightCents))) : [];

  // M-21 step 2: a workspace posting at standard receives the items at their standard cost. The lines below
  // post Inventory at quantity × standard and the difference (actual − standard) to the variance account;
  // without the setting, the receipt posts exactly as before (the moving average, no variance line).
  // M-21 step 2: the plan is also applied when the workspace is no longer posting at standard but the
  // bill's original receipt was booked at a standard (its stock-in rows carry the actual value beside
  // the carrying value) — the repost must keep the value the stock was already carried at, or the
  // reversal/replacement pair moves Inventory with no quantity movement. Receipts that were never
  // standard-valued keep their plain actual-cost posting.
  const standardizing = Boolean(currentWs?.standardCosting?.enabled);
  const priorRows = (priorAccrual?.metadata?.stockIn as Array<{ itemId?: string; quantity?: number; valueCents?: number; actualValueCents?: number; line?: number }> | undefined) || [];
  const bookedAtStandard = priorRows.some(r => typeof r.actualValueCents === 'number');
  const standardPlan = (standardizing || bookedAtStandard) && stockIn.length
    ? planStandardReceipt(stockIn, await loadInventory(billData, context), standardizing, originalReceipt)
    : null;
  const stockInLines = standardPlan?.entries ?? stockIn;

  const accrualLines = TransactionTemplates.buildBillLines({
    billNumber: String(billNum),
    vendorName: vendor,
    totalCents: amount,
    taxCents: taxAmount,
    exchangeRate: billData.exchangeRate || 1,
    apAccount,
    expenseAccount,
    taxAccount,
    taxStamp: taxLineStamp(billData),
    lineAccounts: weights
  });

  // Reverse charge (T-03): the vendor charged no tax; the business owes it and reclaims it,
  // so the same amount goes to input tax (reclaimable) and to tax payable (due)
  // M-21: each Inventory line posts its own standard value (quantity × standard, labels kept), not a
  // share of the standard total; the difference between what the lines cost and what they post is one
  // variance line, so a bill with differently labelled lines keeps each label's own standard value. The
  // label groups are rebuilt whenever any line's standard value differs from its actual cost, even when
  // the variances cancel to a net zero (the groups still carry different values); the variance account
  // line is only posted when the net variance is non-zero.
  const planRevalues = standardPlan && (standardPlan.varianceCents !== 0 || standardPlan.entries.some(e => e.actualValueCents !== undefined));
  if (planRevalues && standardPlan) {
    const plan = standardPlan;
    if (!inventoryAccount) throw new Error('Add an Inventory account (an asset) to the chart of accounts to buy stock on a bill');
    const varianceAccount = accounts.find(a => a.id === currentWs?.standardCosting?.varianceAccountId);
    if (plan.varianceCents !== 0 && !varianceAccount) {
      throw new Error('The purchase-price variance account set in Workspace Settings is not in the chart of accounts.');
    }
    // what each label group of the receipt posts to Inventory under standard costing
    const standardByLabels = new Map<string, number>();
    for (const entry of plan.entries) {
      if (entry.line === undefined) continue;
      const key = labelKey(weights?.[entry.line]?.dimensions);
      standardByLabels.set(key, (standardByLabels.get(key) || 0) + entry.valueCents);
    }
    // M-21 step 2: the replacement posts each Inventory label group at its receipt's standard, but keeps
    // the non-receipt portion of the group: an ordinary split assigned to Inventory (no item, no landed
    // cost) is neither in the standard plan nor in the variance, so dropping it would leave the entry
    // unbalanced. A landed-cost line with no item of its own posts through the receipt (its cost is in the
    // standard plan and the variance), so its own Inventory line is dropped instead.
    // Each ordinary split's share is its part of the same allocation the accrual lines and the receipt
    // plan use (books' minor units, net of tax) — not its raw document amount, which is in the document's
    // currency and would be wrong on a foreign-currency bill or when the total minus tax differs from the
    // sum of the splits.
    const parts = weights ? allocateCents(amount - taxAmount, weights.map(w => w.weightCents)) : [];
    const ordinaryByLabels = new Map<string, number>();
    const landedOnlyLabels = new Set<string>();
    for (const [i, sp] of splits.entries()) {
      if (sp.itemId) continue;
      const key = labelKey(weights?.[i]?.dimensions);
      if (sp.landedCost) landedOnlyLabels.add(key);
      // the account the line actually posts to (by id or by name, as lineAccounts resolves it)
      else if (weights?.[i]?.account.id === inventoryAccount.id) ordinaryByLabels.set(key, (ordinaryByLabels.get(key) || 0) + (parts[i] || 0));
    }
    const rebuilt: typeof accrualLines = [];
    for (const line of accrualLines) {
      if (line.accountId !== inventoryAccount.id) {
        rebuilt.push(line);
        continue;
      }
      const key = labelKey(line.dimensions);
      if (standardByLabels.has(key)) {
        const amount = (standardByLabels.get(key) || 0) + (ordinaryByLabels.get(key) || 0);
        if (amount === 0) continue; // landed-only lines: their cost is in the variance
        rebuilt.push({ ...line, amountCents: amount });
        continue;
      }
      if (landedOnlyLabels.has(key)) {
        // landed-only: cost is in the variance; keep only an ordinary split sharing the label
        const ordinary = ordinaryByLabels.get(key) || 0;
        if (ordinary !== 0) rebuilt.push({ ...line, amountCents: ordinary });
        continue;
      }
      rebuilt.push(line); // an ordinary Inventory split with no receipt behind it, as it was
    }
    accrualLines.length = 0;
    accrualLines.push(...rebuilt);
    if (plan.varianceCents !== 0) {
      accrualLines.push({
        accountId: varianceAccount!.id,
        accountName: varianceAccount!.name,
        amountCents: plan.varianceCents, // debit when the stock cost more than planned
        description: `Purchase price variance on Bill ${billNum} (stock received at standard)`,
        exchangeRate: rate
      });
    }
  }

  if (selfAssessed > 0 && taxAccount) {
    const outputTaxAccount = findAccount(
      accounts,
      mappings,
      ['tax payable', 'sales tax', 'tax liability'],
      a => a.type === 'liability' && (a.name.toLowerCase().includes('tax') || a.category === 'Taxes')
    ) || taxAccount;
    accrualLines.push(
      { accountId: taxAccount.id, accountName: taxAccount.name, amountCents: selfAssessed, description: `Reverse-charge tax reclaimable on Bill ${billNum}`, exchangeRate: rate },
      { accountId: outputTaxAccount.id, accountName: outputTaxAccount.name, amountCents: -selfAssessed, description: `Reverse-charge tax due on Bill ${billNum}`, exchangeRate: rate }
    );
  }

  const accrualTx = {
    uid,
    workspaceId,
    date: billDate,
    description: `Bill ${billNum} - ${vendor}`,
    totalAmountCents: amount,
    currency: billData.currency || 'USD',
    exchangeRate: billData.exchangeRate || 1,
    status: 'completed',
    type: 'actual',
    createdAt: new Date().toISOString(),
    metadata: {
      billId,
      vendorId: billData.vendorId,
      type: BILL_ACCRUAL_TYPE,
      ...(stockInLines.length ? { stockIn: stockInLines } : {})
    },
    lines: accrualLines
  };
  txsToPost.push(inBaseCurrency(accrualTx, workspaceId, context, billData.metadata?.rateUsed as never));

  // 3. Transaction 2: Payment Posting (DR A/P, CR Cash)
  if (status === 'paid' || status === 'partially_paid') {
    // Only what was marked paid on the document itself; payment records and credits post their own entries
    const paidAmtCents = roundCents(cashPostedWithDocumentCents({ ...billData, status }) * rate);
    if (paidAmtCents > 0) {
      const paymentDate = billData.paymentDate || billData.paidAt || today;
      const paymentTx = {
        uid,
        workspaceId,
        date: paymentDate,
        description: `Payment Sent for Bill ${billNum} - ${vendor}`,
        totalAmountCents: paidAmtCents,
        currency: billData.currency || 'USD',
        exchangeRate: billData.exchangeRate || 1,
        status: 'completed',
        type: 'actual',
        createdAt: new Date().toISOString(),
        metadata: {
          billId,
          vendorId: billData.vendorId,
          type: 'bill-payment'
        },
        lines: TransactionTemplates.buildPaymentLines({
          documentNumber: String(billNum),
          entityName: vendor,
          amountCents: paidAmtCents,
          exchangeRate: billData.exchangeRate || 1,
          cashAccount,
          offsetAccount: apAccount,
          isReceipt: false,
          lineAccounts: weights // DIM-1: the payment carries the bill lines' labels
        })
      };
      txsToPost.push(inBaseCurrency(paymentTx, workspaceId, context, billData.metadata?.rateUsed as never));
    }
  }

  // Atomic post via Server API
  await postTxsServerApi(txsToPost, workspaceId, entityMutation, context);
}
