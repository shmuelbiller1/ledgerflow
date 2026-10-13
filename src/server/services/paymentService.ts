import { createHash } from 'node:crypto';
import { deriveScopedOperationKey } from '../utils/idempotency';
import { isWithholdingAccount } from '../../lib/tax/withholding';
import { calculateAmountDue, settledStatus } from '../../lib/documentMath';
import { writeServerAuditLog } from './auditLogService';
import { resolveAccountRole } from '../../lib/accountUtils';
import type { ChartAccount } from '../../types';
import { assertPostingOpen, workspaceRole } from '../../lib/periodLock';
import { formatCurrency } from '../../lib/utils';
import { allocateInTransaction } from './numberingService';
import { advanceAccount } from '../../lib/advancePayments';
import type { DocumentReference, Firestore, Transaction } from '../db/firestore';

export interface CreatePaymentPayload {
  workspaceId: string;
  uid: string;
  paymentDate: string;
  amountCents: number;
  paymentMethod?: string;
  referenceNumber?: string;
  memo?: string;
  customerId?: string;
  vendorId?: string;
  entityName?: string;
  cashAccountId: string;
  offsetAccountId?: string;
  /** The rate on the payment day for a foreign document (home units per 1); the difference from its own rate is a realized exchange gain or loss (L-192). */
  paymentExchangeRate?: number;
  /** A deposit for this estimate (BE-05): the customer's own, not yet converted; it waits unapplied until the invoice is issued. */
  estimateId?: string;
  /** IL-5: tax withheld at source from a payment to a vendor (home currency): the vendor gets the rest, the tax authority is owed this */
  withheldCents?: number;
  withholdingRatePercent?: number;
  withholdingCertificate?: string;
  allocations: Array<{
    documentId: string;
    documentType: 'invoice' | 'bill';
    amountCents: number;
  }>;
}

const PAYMENT_METHODS = new Set(['cash', 'check', 'bank_transfer', 'card', 'other']);

export async function createPaymentAtomic(db: any, payload: CreatePaymentPayload) {
  return db.runTransaction((tx: unknown) => createPaymentInTransaction(db, tx, payload));
}

/** Idempotent manual/bulk payment posting: the result key and journal commit together.
 * The same key with different payment details or a different actor is always refused.
 */
export async function createPaymentIdempotent(db: Firestore, payload: CreatePaymentPayload, operationId: string) {
  const key = deriveScopedOperationKey(payload.workspaceId, 'PAYMENT_CREATE', operationId);
  const payloadHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  return db.runTransaction(async (tx: Transaction) => {
    const keyRef = db.collection('idempotencyKeys').doc(key);
    const previous = await tx.get(keyRef);
    if (previous.exists) {
      const old = previous.data() || {};
      if (old.actor !== payload.uid || old.payloadHash !== payloadHash) {
        throw Object.assign(new Error('Idempotency key reused for different payment details or actor'), { status: 409 });
      }
      if (old.status === 'success' && old.result) return { ...old.result, replayed: true };
      throw Object.assign(new Error('Payment operation is already in progress'), { status: 409 });
    }
    const result = await createPaymentInTransaction(db, tx, payload);
    const now = new Date();
    tx.set(keyRef, {
      id: key, workspaceId: payload.workspaceId, actor: payload.uid,
      operationType: 'PAYMENT_CREATE', status: 'success', payloadHash,
      result, createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 30 * 86400000).toISOString(),
    });
    return { ...result, replayed: false };
  });
}

/**
 * Records a payment inside an open database transaction (reads first, writes at the end), so a
 * caller can add its own writes, e.g. marking the bank line it came from as matched.
 */
export async function createPaymentInTransaction(db: any, tx: any, payload: CreatePaymentPayload) {
  const {
    workspaceId,
    uid,
    paymentDate,
    amountCents,
    paymentMethod = 'cash',
    referenceNumber = '',
    memo = '',
    customerId,
    vendorId,
    entityName,
    cashAccountId,
    offsetAccountId,
    estimateId,
    allocations = []
  } = payload;

  {
    // 1. Fetch workspace for lockDate and default mappings
    const wsRef = db.collection('workspaces').doc(workspaceId);
    const wsSnap = await tx.get(wsRef);
    if (!wsSnap.exists) throw new Error('NOT_FOUND');
    const wsData = wsSnap.data() || {};

    assertPostingOpen(paymentDate, wsData, uid);

    // 2. Validate cash account exists and belongs to workspace
    const cashAccRef = db.collection('chartAccounts').doc(cashAccountId);
    const cashAccSnap = await tx.get(cashAccRef);
    if (!cashAccSnap.exists) {
      throw new Error(`Invalid cash account ID: ${cashAccountId}`);
    }
    const cashAccData = cashAccSnap.data() || {};
    if (cashAccData.workspaceId !== workspaceId) {
      throw new Error(`Invalid cash account ID: ${cashAccountId}`);
    }

    let resolvedOffsetAccountId = offsetAccountId;
    if (resolvedOffsetAccountId) {
      const offsetAccRef = db.collection('chartAccounts').doc(resolvedOffsetAccountId);
      const offsetAccSnap = await tx.get(offsetAccRef);
      if (!offsetAccSnap.exists) {
        throw new Error(`Invalid offset account ID: ${resolvedOffsetAccountId}`);
      }
      const offsetAccData = offsetAccSnap.data() || {};
      if (offsetAccData.workspaceId !== workspaceId) {
        throw new Error(`Invalid offset account ID: ${resolvedOffsetAccountId}`);
      }
    }

    // a deposit for an estimate (BE-05): the customer's own estimate, still open, and nothing applied yet
    if (estimateId) {
      const estimate = (await tx.get(db.collection('estimates').doc(estimateId))).data();
      if (!estimate || estimate.workspaceId !== workspaceId) throw new Error('Estimate not found');
      if (!customerId || estimate.customerId !== customerId) throw new Error('The deposit must come from the estimate\'s customer');
      if (['declined', 'converted', 'expired'].includes(String(estimate.status))) throw new Error(`The estimate is ${estimate.status}; a deposit is taken before it becomes an invoice`);
      if (allocations.length) throw new Error('A deposit is not applied to invoices when it is received');
    }

    // 3. Read & validate target invoices / bills
    const allocationKeys = allocations.map(a => `${a.documentType}:${a.documentId}`);
    if (new Set(allocationKeys).size !== allocationKeys.length) {
      throw new Error('Each invoice or bill may appear only once in a payment');
    }

    const docUpdates: Array<{ ref: { id?: string; [k: string]: unknown }; updates: Record<string, unknown> }> = [];
    let totalAllocatedCents = 0;
    // A payment is in the currency of the documents it pays (all the same one); the ledger gets
    // it converted at the documents' rate, like the documents themselves (L-105).
    const baseCurrency = String(wsData.currency || 'USD');
    let paymentCurrency: string | null = null;
    let paymentRate = 1;

    for (const alloc of allocations) {
      totalAllocatedCents += alloc.amountCents;
      const collName = alloc.documentType === 'invoice' ? 'invoices' : 'bills';
      const docRef = db.collection(collName).doc(alloc.documentId);
      const docSnap = await tx.get(docRef);

      if (!docSnap.exists) {
        throw new Error(`Document ${alloc.documentId} not found`);
      }

      const docData = docSnap.data() || {};
      if (docData.workspaceId !== workspaceId) {
        throw new Error(`Document ${alloc.documentId} not found`);
      }

      if (docData.status === 'void' || docData.status === 'draft') {
        throw new Error(`Cannot record a payment against a ${docData.status} document`);
      }
      const docCurrency = String(docData.currency || baseCurrency);
      const docRate = typeof docData.exchangeRate === 'number' && docData.exchangeRate > 0 ? docData.exchangeRate : 1;
      if (paymentCurrency !== null && (docCurrency !== paymentCurrency || docRate !== paymentRate)) {
        throw new Error('One payment can only pay documents in the same currency (and exchange rate); record separate payments');
      }
      paymentCurrency = docCurrency;
      paymentRate = docCurrency === baseCurrency ? 1 : docRate;

      const currentPaid = docData.amountPaidCents || 0;
      const remainingBalance = calculateAmountDue(docData);

      if (alloc.amountCents > remainingBalance) {
        throw new Error(`Overpayment not allowed: allocation of ${alloc.amountCents} cents exceeds remaining balance of ${remainingBalance} cents for document ${alloc.documentId}`);
      }

      const newPaid = currentPaid + alloc.amountCents;

      const newStatus = newPaid > 0 ? settledStatus(docData, newPaid) : docData.status;

      docUpdates.push({
        ref: docRef,
        updates: {
          amountPaidCents: newPaid,
          settledByRecordsCents: (docData.settledByRecordsCents || 0) + alloc.amountCents,
          status: newStatus,
          updatedAt: new Date().toISOString()
        }
      });

      if (!resolvedOffsetAccountId) {
        resolvedOffsetAccountId = alloc.documentType === 'invoice'
          ? docData.arAccountId || wsData.defaultAccountMappings?.ar
          : docData.apAccountId || wsData.defaultAccountMappings?.ap;
      }
    }

    // the workspace's chart, read once when needed (every read must come before the writes)
    let chartCache: ChartAccount[] | null = null;
    const chartAccounts = async (): Promise<ChartAccount[]> => {
      if (!chartCache) {
        const chart = await tx.get(db.collection('chartAccounts').where('workspaceId', '==', workspaceId));
        chartCache = chart.docs.map((d: { id: string; data: () => ChartAccount }) => ({ ...d.data(), id: d.id }));
      }
      return chartCache as ChartAccount[];
    };

    // No mapping: the chart's receivables (customer payment) or payables (vendor payment) account
    const receipt = allocations.some(a => a.documentType === 'invoice') || Boolean(customerId);
    if (!resolvedOffsetAccountId) {
      const role = receipt ? 'ar' : 'ap';
      resolvedOffsetAccountId = (await chartAccounts()).find(a => resolveAccountRole(a) === role)?.id;
    }

    // BE-12: the part not matched to documents waits in Customer Deposits / Vendor Prepayments
    const unmatchedCents = amountCents - totalAllocatedCents;
    const advance = unmatchedCents > 0 ? advanceAccount(await chartAccounts(), receipt ? 'received' : 'made', wsData.defaultAccountMappings) : undefined;

    if (totalAllocatedCents > amountCents) {
      throw new Error(`Total allocated amount (${totalAllocatedCents} cents) exceeds payment amount (${amountCents} cents)`);
    }

    if (!resolvedOffsetAccountId) {
      throw new Error('Offset account ID (A/R or A/P) could not be resolved or is invalid');
    }

    // Validate resolved offset account
    const offsetAccRef = db.collection('chartAccounts').doc(resolvedOffsetAccountId);
    const offsetAccSnap = await tx.get(offsetAccRef);
    if (!offsetAccSnap.exists) {
      throw new Error(`Invalid offset account ID: ${resolvedOffsetAccountId}`);
    }
    const offsetAccData = offsetAccSnap.data() || {};
    if (offsetAccData.workspaceId !== workspaceId) {
      throw new Error(`Invalid offset account ID: ${resolvedOffsetAccountId}`);
    }

    // 4. Build Payment Document
    const paymentRef = db.collection('payments').doc();
    const paymentId = paymentRef.id;
    // the next number of the payment series (Settings → Document numbering); it was PMT-<random 4 digits>, which repeated (L-189)
    // the number is taken last, just before the writes (taking it writes the series, and every read must come first)
    let paymentNumber = '';
    const isReceiptPayment = allocations.some(a => a.documentType === 'invoice') || Boolean(customerId);
    const paymentData = {
      id: paymentId,
      workspaceId,
      uid,
      number: paymentNumber,
      // The fields screens and reports read (types.ts Payment)
      direction: isReceiptPayment ? 'received' : 'made',
      contactId: customerId || vendorId || null,
      contactName: entityName || '',
      method: PAYMENT_METHODS.has(paymentMethod) ? paymentMethod : 'other',
      reference: referenceNumber,
      depositAccountId: cashAccountId,
      unappliedCents: amountCents - totalAllocatedCents,
      // where the unapplied part is held (BE-12): the deposits/prepayments account, else A/R or A/P
      advanceAccountId: advance?.id || resolvedOffsetAccountId,
      ...(estimateId ? { estimateId } : {}),
      currency: paymentCurrency || baseCurrency,
      exchangeRate: paymentRate,
      status: 'posted',
      date: paymentDate,
      paymentDate,
      amountCents,
      paymentMethod,
      referenceNumber,
      memo,
      customerId: customerId || null,
      vendorId: vendorId || null,
      entityName: entityName || '',
      cashAccountId,
      offsetAccountId: resolvedOffsetAccountId,
      allocations,
      createdAt: new Date().toISOString()
    };

    // 5. Build General Ledger Transaction
    const isReceipt = isReceiptPayment;
    const ledgerTxRef = db.collection('transactions').doc();
    const baseAmountCents = Math.round(amountCents * paymentRate);
    // L-192: a foreign document paid at another day's rate: the bank gets what really arrived (or left),
    // the receivable/payable is cleared at the document's own rate, and the difference is realized
    // exchange gain or loss. Without a payment-day rate, both sides stay at the document's rate.
    const dayRate = payload.paymentExchangeRate;
    const foreignPayment = paymentCurrency !== null && paymentCurrency !== baseCurrency;
    const cashBaseCents = foreignPayment && typeof dayRate === 'number' && dayRate > 0 ? Math.round(amountCents * dayRate) : baseAmountCents;
    const realizedFxCents = cashBaseCents - baseAmountCents;
    // the unmatched part goes to the deposits/prepayments account when there is one (BE-12)
    const advanceBaseCents = advance ? baseAmountCents - Math.round(totalAllocatedCents * paymentRate) : 0;
    const offsetBaseCents = baseAmountCents - advanceBaseCents;
    let fxAccount: { id: string; name?: string } | undefined;
    if (realizedFxCents !== 0) {
      fxAccount = (await chartAccounts())
        .find((a: ChartAccount) => !a.isArchived && (resolveAccountRole(a) === 'fx_rounding' || /exchange|fx/i.test(String(a.name || ''))) && ['income', 'expense', 'revenue'].includes(String(a.type).toLowerCase()));
      if (!fxAccount) throw new Error('Add an exchange gain/loss account (category "Rounding Differences") before recording a payment at a different rate');
    }

    // IL-5: tax withheld at source: out of what settles the bills, the vendor is paid the rest and the
    // withheld tax is owed (a liability) until it is paid to the tax authority
    const withheld = Math.round(Number(payload.withheldCents || 0));
    let withholdingAccount: { id: string } | undefined;
    if (withheld !== 0) {
      if (isReceipt) throw new Error('Tax is withheld at source only on payments to vendors');
      if (!Number.isFinite(withheld) || withheld < 0 || withheld >= amountCents) throw new Error('The tax withheld is more than nothing and less than the payment');
      if (paymentRate !== 1 || realizedFxCents !== 0) throw new Error('Tax withheld at source is in the home currency only for now');
      withholdingAccount = (await chartAccounts()).find((a: ChartAccount) => isWithholdingAccount(a));
      if (!withholdingAccount) throw new Error('Add a liability account for tax withheld at source (for example "Tax withheld at source") first');
    }

    const ledgerTxData = {
      id: ledgerTxRef.id,
      uid,
      workspaceId,
      date: paymentDate,
      description: `Payment ${paymentId} (${paymentMethod}) - ${entityName || memo || 'Payment'}`,
      totalAmountCents: Math.max(baseAmountCents, cashBaseCents),
      currency: baseCurrency,
      exchangeRate: 1,
      status: 'completed',
      type: 'actual',
      createdAt: new Date().toISOString(),
      metadata: {
        paymentId,
        type: 'payment-posting',
        ...(paymentRate !== 1 ? { documentCurrency: paymentCurrency, documentAmountCents: amountCents, documentExchangeRate: paymentRate } : {}),
        ...(realizedFxCents !== 0 ? { paymentExchangeRate: dayRate, realizedFxCents } : {})
      },
      lines: [
        {
          accountId: cashAccountId,
          amountCents: isReceipt ? cashBaseCents : -(cashBaseCents - withheld),
          description: `Cash ${isReceipt ? 'Debit' : 'Credit'} for Payment ${paymentId}`
        },
        ...(withholdingAccount ? [{
          accountId: withholdingAccount.id,
          amountCents: -withheld,
          description: `Tax withheld at source for Payment ${paymentId}`
        }] : []),
        // (no line when all of it waits as a deposit/prepayment)
        ...(offsetBaseCents !== 0 || !advance ? [{
          accountId: resolvedOffsetAccountId,
          amountCents: isReceipt ? -offsetBaseCents : offsetBaseCents,
          description: `Offset ${isReceipt ? 'Credit' : 'Debit'} for Payment ${paymentId}`
        }] : []),
        ...(advance && advanceBaseCents > 0 ? [{
          accountId: advance.id,
          amountCents: isReceipt ? -advanceBaseCents : advanceBaseCents,
          description: `${isReceipt ? 'Customer deposit' : 'Vendor prepayment'} held for Payment ${paymentId}`
        }] : []),
        // more home currency received than booked is a gain (credit); more paid out is a loss (debit)
        ...(fxAccount ? [{
          accountId: fxAccount.id,
          amountCents: isReceipt ? -realizedFxCents : realizedFxCents,
          description: `Realized exchange ${(isReceipt ? realizedFxCents > 0 : realizedFxCents < 0) ? 'gain' : 'loss'} for Payment ${paymentId}`
        }] : [])
      ]
    };

    if (realizedFxCents !== 0) Object.assign(paymentData, { paymentExchangeRate: dayRate, realizedFxCents });
    if (withheld) Object.assign(paymentData, {
      withheldCents: withheld,
      ...(payload.withholdingRatePercent !== undefined ? { withholdingRatePercent: payload.withholdingRatePercent } : {}),
      ...(payload.withholdingCertificate ? { withholdingCertificate: payload.withholdingCertificate } : {}),
    });
    paymentNumber = await allocateInTransaction(db, tx, workspaceId, 'payment');
    paymentData.number = paymentNumber;

    // 6. Stage writes
    for (const update of docUpdates) {
      tx.update(update.ref, update.updates);
    }
    tx.set(paymentRef, paymentData);
    tx.set(ledgerTxRef, ledgerTxData);

    await writeServerAuditLog({
      workspaceId,
      uid,
      action: 'PAYMENT_RECORDED',
      entityType: 'payment',
      entityId: paymentId,
      details: {
        description: `Payment ${paymentNumber} of ${formatCurrency(amountCents, paymentCurrency || baseCurrency)} recorded for ${entityName || 'contact'}.`,
        paymentNumber,
        amountCents,
        paymentMethod
      }
    }, { db, tx });

    return { paymentId, transactionId: ledgerTxRef.id, payment: paymentData, ledgerTransaction: ledgerTxData };
  }
}

export class PaymentApplyError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'PaymentApplyError';
  }
}

/**
 * Apply the unapplied part of a payment to invoices or bills later (BE-12, K-18): a customer's
 * deposit to the invoice it was for, a vendor prepayment to its bill. The documents are settled like
 * a payment would settle them, the payment's unapplied amount goes down, and when the money waited in
 * Customer Deposits / Vendor Prepayments one entry moves it to A/R or A/P, dated the day it is
 * applied. All in one database transaction; writers only; a closed period refuses.
 */
export async function applyUnappliedPayment(db: Firestore, input: {
  workspaceId: string;
  uid: string;
  paymentId: string;
  allocations: Array<{ documentId: string; documentType: 'invoice' | 'bill'; amountCents: number }>;
  date: string;
}) {
  return db.runTransaction(async (tx) => {
    const { workspaceId, uid, paymentId, allocations, date } = input;
    const wsSnap = await tx.get(db.collection('workspaces').doc(workspaceId));
    if (!wsSnap.exists) throw new PaymentApplyError(404, 'Workspace not found');
    const wsData = wsSnap.data() || {};
    if (!['owner', 'accountant', 'bookkeeper'].includes(workspaceRole(wsData, uid))) throw new PaymentApplyError(403, 'Only owners, accountants and bookkeepers apply payments');
    try {
      assertPostingOpen(date, wsData, uid);
    } catch (err) {
      throw new PaymentApplyError(409, err instanceof Error ? err.message : String(err));
    }
    const paymentRef = db.collection('payments').doc(paymentId);
    const payment = (await tx.get(paymentRef)).data();
    if (!payment || payment.workspaceId !== workspaceId) throw new PaymentApplyError(404, 'Payment not found');
    if (payment.status === 'void') throw new PaymentApplyError(409, 'The payment is void');
    const unapplied = Number(payment.unappliedCents) || 0;
    const total = allocations.reduce((sum, a) => sum + a.amountCents, 0);
    if (total <= 0) throw new PaymentApplyError(400, 'Choose what to apply it to');
    if (total > unapplied) throw new PaymentApplyError(409, `Only ${formatCurrency(unapplied, payment.currency)} of this payment is still unapplied`);
    const received = payment.direction === 'received';
    const wanted = received ? 'invoice' : 'bill';
    const partyId = received ? payment.customerId : payment.vendorId;
    const keys = allocations.map(a => a.documentId);
    if (new Set(keys).size !== keys.length) throw new PaymentApplyError(400, 'Each invoice or bill may appear only once');

    const baseCurrency = String(wsData.currency || 'USD');
    const paymentCurrency = String(payment.currency || baseCurrency);
    const rate = typeof payment.exchangeRate === 'number' && payment.exchangeRate > 0 ? payment.exchangeRate : 1;
    const docUpdates: Array<{ ref: DocumentReference; updates: Record<string, unknown> }> = [];
    for (const alloc of allocations) {
      if (alloc.documentType !== wanted) throw new PaymentApplyError(400, `A payment ${received ? 'received' : 'made'} is applied to ${wanted}s`);
      const ref = db.collection(received ? 'invoices' : 'bills').doc(alloc.documentId);
      const doc = (await tx.get(ref)).data();
      if (!doc || doc.workspaceId !== workspaceId) throw new PaymentApplyError(404, `Document ${alloc.documentId} not found`);
      if (doc.status === 'void' || doc.status === 'draft') throw new PaymentApplyError(409, `Cannot apply a payment to a ${doc.status} document`);
      if (partyId && (received ? doc.customerId : doc.vendorId) !== partyId) throw new PaymentApplyError(400, `${doc.number || alloc.documentId} belongs to another ${received ? 'customer' : 'vendor'}`);
      if (String(doc.currency || baseCurrency) !== paymentCurrency) throw new PaymentApplyError(400, `${doc.number || alloc.documentId} is in another currency than the payment`);
      const due = calculateAmountDue(doc);
      if (alloc.amountCents > due) throw new PaymentApplyError(409, `${doc.number || alloc.documentId} has only ${formatCurrency(due, paymentCurrency)} left to pay`);
      const paid = (Number(doc.amountPaidCents) || 0) + alloc.amountCents;
      docUpdates.push({ ref, updates: {
        amountPaidCents: paid,
        settledByRecordsCents: (Number(doc.settledByRecordsCents) || 0) + alloc.amountCents,
        status: settledStatus(doc, paid),
        updatedAt: new Date().toISOString(),
      } });
    }

    // the money waited in Customer Deposits / Vendor Prepayments: move it to A/R or A/P now
    const heldIn = String(payment.advanceAccountId || payment.offsetAccountId || '');
    const offset = String(payment.offsetAccountId || '');
    let ledgerTx: Record<string, unknown> | null = null;
    if (heldIn && offset && heldIn !== offset) {
      const baseCents = Math.round(total * rate);
      const description = `Payment ${payment.number || paymentId} applied (${received ? 'customer deposit' : 'vendor prepayment'})`;
      const { TransactionValidator } = await import('../../kernel/validation/TransactionValidator');
      ledgerTx = await TransactionValidator.validateAndPrepare(
        {
          id: db.collection('transactions').doc().id, workspaceId, uid, date, description, currency: baseCurrency, exchangeRate: 1,
          status: 'completed', type: 'actual', totalAmountCents: baseCents,
          metadata: { type: 'payment-application', paymentId, documents: allocations.map(a => a.documentId) },
          lines: received
            ? [{ accountId: heldIn, amountCents: baseCents, description }, { accountId: offset, amountCents: -baseCents, description }]
            : [{ accountId: offset, amountCents: baseCents, description }, { accountId: heldIn, amountCents: -baseCents, description }],
        },
        { workspaceId, user: { uid }, wsData }, undefined, tx,
      ) as unknown as Record<string, unknown>;
    }

    for (const u of docUpdates) tx.update(u.ref, u.updates);
    tx.update(paymentRef, {
      allocations: [...(payment.allocations || []), ...allocations],
      unappliedCents: unapplied - total,
      updatedAt: new Date().toISOString(),
    });
    if (ledgerTx) tx.create(db.collection('transactions').doc(String(ledgerTx.id)), { ...ledgerTx, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    await writeServerAuditLog({
      workspaceId, uid, action: 'PAYMENT_APPLIED', entityType: 'payment', entityId: paymentId,
      details: { description: `Payment ${payment.number || paymentId}: ${formatCurrency(total, paymentCurrency)} applied to ${allocations.length} ${wanted}${allocations.length === 1 ? '' : 's'}`, amountCents: total, transactionId: ledgerTx?.id || null },
    }, { db, tx });
    return { paymentId, appliedCents: total, unappliedCents: unapplied - total, transactionId: ledgerTx?.id || null };
  });
}
