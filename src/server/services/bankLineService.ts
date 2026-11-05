import { FieldValue } from '../db/firestore';
import { ledgerCreate } from './ledgerDoor';
import type { DocumentData, Firestore } from '../db/firestore';
import { TransactionValidator } from '../../kernel/validation/TransactionValidator';
import { resolveAccountRole } from '../../lib/accountUtils';
import type { ChartAccount } from '../../types';
import { afterPaymentRecorded } from './afterPayment';
import { createPaymentInTransaction } from './paymentService';

/**
 * Clearing a pending bank statement line, each in one database transaction that also marks the
 * line matched:
 * - payFromBankLine: a deposit that pays one or more invoices (or a withdrawal that pays bills)
 *   becomes a payment record (Y-10 / CA-01).
 * - splitBankLine: one line spread over several accounts, e.g. a card payment that is part
 *   supplies, part fuel (Y-09).
 * Bank lines hold the amount as seen by the bank: positive = money in, negative = money out.
 */

export class BankLineError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'BankLineError';
  }
}

type FirebaseTx = Parameters<Parameters<Firestore['runTransaction']>[0]>[0];

async function readPendingLine(db: Firestore, t: FirebaseTx, workspaceId: string, bankLineId: string) {
  const ref = db.collection('bankLines').doc(bankLineId);
  const snap = await t.get(ref);
  const line = snap.data();
  if (!line || line.workspaceId !== workspaceId) throw new BankLineError(404, 'Bank line not found');
  if (line.status !== 'pending') throw new BankLineError(409, `This bank line is already ${line.status}`);
  const amountCents = Number(line.amountCents);
  if (!Number.isSafeInteger(amountCents) || amountCents === 0) throw new BankLineError(400, 'This bank line has no amount');
  // AF-001 (Codex on #439): a line in another currency holds that currency's minor units; paying or splitting
  // it here would book them as the books' own money, so it waits for a conversion
  const lineCurrency = String(line.currency || '').toUpperCase();
  if (lineCurrency) {
    const home = String((await t.get(db.collection('workspaces').doc(workspaceId))).data()?.currency || 'USD').toUpperCase();
    if (lineCurrency !== home) throw new BankLineError(409, `This bank line is in ${lineCurrency}, not ${home}; it can't be booked until it is converted`);
  }
  return { ref, line, amountCents };
}

async function readBankAccount(db: Firestore, t: FirebaseTx, workspaceId: string, accountId: string | undefined) {
  if (!accountId) throw new BankLineError(400, 'Choose the bank account this statement belongs to');
  const account = (await t.get(db.collection('chartAccounts').doc(accountId))).data() as ChartAccount | undefined;
  if (!account || account.workspaceId !== workspaceId || resolveAccountRole(account) !== 'cash') {
    throw new BankLineError(400, 'The bank account must be a bank or cash account of this workspace');
  }
  return { ...account, id: accountId };
}

export interface PayFromBankLineInput {
  workspaceId: string;
  uid: string;
  bankLineId: string;
  bankAccountId?: string;
  allocations: { documentId: string; amountCents: number }[];
}

export async function payFromBankLine(db: Firestore, input: PayFromBankLineInput) {
  if (input.allocations.length === 0) throw new BankLineError(400, 'Choose at least one invoice or bill');
  const { record, ...result } = await db.runTransaction(async (t) => {
    const { ref, line, amountCents } = await readPendingLine(db, t, input.workspaceId, input.bankLineId);
    const bank = await readBankAccount(db, t, input.workspaceId, input.bankAccountId || line.accountId);
    const isDeposit = amountCents > 0;
    const documentType = isDeposit ? 'invoice' : 'bill';
    const snaps = await t.getAll(...input.allocations.map(a => db.collection(isDeposit ? 'invoices' : 'bills').doc(a.documentId)));
    const docs: DocumentData[] = snaps.map(s => s.data() || {});
    const partyKey = isDeposit ? 'customerId' : 'vendorId';
    const parties = new Set(docs.map(d => d[partyKey]));
    if (parties.size !== 1 || !docs[0][partyKey]) {
      throw new BankLineError(400, `All the ${documentType}s paid by one bank line must be for the same ${isDeposit ? 'customer' : 'vendor'}`);
    }
    const allocated = input.allocations.reduce((sum, a) => sum + a.amountCents, 0);
    if (allocated > Math.abs(amountCents)) throw new BankLineError(400, `The ${documentType}s add up to more than the bank line`);

    const payment = await createPaymentInTransaction(db, t, {
      workspaceId: input.workspaceId,
      uid: input.uid,
      paymentDate: String(line.date).slice(0, 10),
      amountCents: Math.abs(amountCents),
      paymentMethod: 'bank_transfer',
      referenceNumber: String(line.description || '').slice(0, 200),
      customerId: isDeposit ? docs[0].customerId : undefined,
      vendorId: isDeposit ? undefined : docs[0].vendorId,
      entityName: docs[0].customerName || docs[0].vendorName || '',
      cashAccountId: bank.id,
      allocations: input.allocations.map(a => ({ ...a, documentType })),
    });
    t.update(ref, { status: 'matched', matchedTransactionId: payment.transactionId, matchedPaymentId: payment.paymentId, accountId: bank.id, updatedAt: new Date().toISOString() });
    return { paymentId: payment.paymentId, transactionId: payment.transactionId, unappliedCents: Math.abs(amountCents) - allocated, record: payment.payment };
  });
  await afterPaymentRecorded(db, record, input.uid);
  return result;
}

export interface SplitBankLineInput {
  workspaceId: string;
  uid: string;
  bankLineId: string;
  bankAccountId?: string;
  splits: { accountId: string; amountCents: number; description?: string }[];
}

export async function splitBankLine(db: Firestore, input: SplitBankLineInput) {
  if (input.splits.length === 0) throw new BankLineError(400, 'Add at least one line');
  return db.runTransaction(async (t) => {
    const { ref, line, amountCents } = await readPendingLine(db, t, input.workspaceId, input.bankLineId);
    const bank = await readBankAccount(db, t, input.workspaceId, input.bankAccountId || line.accountId);
    const total = input.splits.reduce((sum, s) => sum + s.amountCents, 0);
    if (total !== Math.abs(amountCents)) {
      throw new BankLineError(400, `The lines add up to ${total} cents; the bank line is ${Math.abs(amountCents)} cents`);
    }
    if (input.splits.some(s => s.accountId === bank.id)) throw new BankLineError(400, 'A split line cannot use the bank account itself');
    const workspace = (await t.get(db.collection('workspaces').doc(input.workspaceId))).data() || {};
    const sign = amountCents > 0 ? 1 : -1; // money in: DR bank, CR each split; money out: the reverse
    const description = String(line.description || 'Bank line');
    const ledgerTx = await TransactionValidator.validateAndPrepare({
      id: db.collection('transactions').doc().id,
      workspaceId: input.workspaceId,
      uid: input.uid,
      date: String(line.date).slice(0, 10),
      description,
      totalAmountCents: Math.abs(amountCents),
      currency: workspace.currency || 'USD',
      exchangeRate: 1,
      status: 'completed',
      type: 'actual',
      metadata: { type: 'bank-line-split', bankLineId: input.bankLineId },
      lines: [
        { accountId: bank.id, accountName: bank.name, amountCents: sign * Math.abs(amountCents), description },
        ...input.splits.map(s => ({ accountId: s.accountId, amountCents: -sign * s.amountCents, description: s.description || description })),
      ],
    }, { workspaceId: input.workspaceId, user: { uid: input.uid }, wsData: workspace }, undefined, t);
    ledgerCreate(t, db.collection('transactions').doc(ledgerTx.id), { ...ledgerTx, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    t.update(ref, { status: 'matched', matchedTransactionId: ledgerTx.id, accountId: bank.id, updatedAt: new Date().toISOString() });
    return { transactionId: ledgerTx.id };
  });
}
