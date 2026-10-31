import { FieldValue } from '../db/firestore';
import { ledgerCreate } from './ledgerDoor';
import type { DocumentData, Firestore } from '../db/firestore';
import { TransactionValidator } from '../../kernel/validation/TransactionValidator';
import { isUndepositedFundsAccount, resolveAccountRole } from '../../lib/accountUtils';
import { getDateInTimezoneISO } from '../../lib/calendarDate';
import type { ChartAccount } from '../../types';

/**
 * "Make deposit" (K-20): customer payments received into the Undeposited Funds account are taken
 * to the bank together. One ledger entry (DR bank, CR Undeposited Funds, the total) so it matches
 * the single deposit line on the bank statement; each payment is marked with that entry.
 * All in one database transaction.
 */

export class DepositError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'DepositError';
  }
}

export interface CreateDepositInput {
  workspaceId: string;
  uid: string;
  bankAccountId: string;
  date?: string;
  paymentIds: string[];
  memo?: string;
}

export async function createDeposit(db: Firestore, input: CreateDepositInput) {
  const paymentIds = Array.from(new Set(input.paymentIds));
  if (paymentIds.length === 0) throw new DepositError(400, 'Choose the payments to deposit');
  if (input.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new DepositError(400, 'Date must be YYYY-MM-DD');

  return db.runTransaction(async (t) => {
    const [workspaceSnap, bankSnap, ...paymentSnaps] = await t.getAll(
      db.collection('workspaces').doc(input.workspaceId),
      db.collection('chartAccounts').doc(input.bankAccountId),
      ...paymentIds.map(id => db.collection('payments').doc(id)),
    );
    const workspace = workspaceSnap.data();
    if (!workspace) throw new DepositError(404, 'Workspace not found');
    const depositDate = input.date || getDateInTimezoneISO(new Date(), typeof workspace.timezone === 'string' ? workspace.timezone : undefined);
    const bank = bankSnap.data() as ChartAccount | undefined;
    if (!bank || bank.workspaceId !== input.workspaceId || resolveAccountRole(bank) !== 'cash' || isUndepositedFundsAccount(bank)) {
      throw new DepositError(400, 'Choose the bank account the money went into');
    }

    const payments: (DocumentData & { id: string })[] = paymentSnaps.map(s => ({ ...(s.data() || {}), id: s.id }));
    for (const p of payments) {
      if (p.workspaceId !== input.workspaceId) throw new DepositError(404, `Payment ${p.id} not found`);
      if (p.status === 'void' || p.status === 'draft') throw new DepositError(409, `Payment ${p.number || p.id} is ${p.status}`);
      if (p.direction === 'made') throw new DepositError(400, `Payment ${p.number || p.id} is a payment to a vendor`);
      if (p.depositTransactionId) throw new DepositError(409, `Payment ${p.number || p.id} was already deposited`);
    }
    const holdingIds = new Set(payments.map(p => p.depositAccountId || p.cashAccountId));
    if (holdingIds.size !== 1) throw new DepositError(400, 'All the payments must be waiting in the same Undeposited Funds account');
    const holdingId = String([...holdingIds][0]);
    const holding = (await t.get(db.collection('chartAccounts').doc(holdingId))).data() as ChartAccount | undefined;
    if (!holding || holding.workspaceId !== input.workspaceId || !isUndepositedFundsAccount(holding)) {
      throw new DepositError(400, 'These payments are not waiting in an Undeposited Funds account');
    }

    const totalCents = payments.reduce((sum, p) => sum + (Number(p.amountCents) || 0), 0);
    if (!Number.isSafeInteger(totalCents) || totalCents <= 0) throw new DepositError(400, 'Nothing to deposit');
    const description = `Deposit of ${payments.length} payment${payments.length === 1 ? '' : 's'}${input.memo ? `: ${input.memo}` : ''}`;
    const ledgerTx = await TransactionValidator.validateAndPrepare({
      id: db.collection('transactions').doc().id,
      workspaceId: input.workspaceId,
      uid: input.uid,
      date: depositDate,
      description,
      totalAmountCents: totalCents,
      currency: workspace.currency || 'USD',
      exchangeRate: 1,
      status: 'completed',
      type: 'actual',
      metadata: { type: 'bank-deposit', paymentIds },
      lines: [
        { accountId: input.bankAccountId, accountName: bank.name, amountCents: totalCents, description },
        { accountId: holdingId, accountName: holding.name, amountCents: -totalCents, description },
      ],
    }, { workspaceId: input.workspaceId, user: { uid: input.uid }, wsData: workspace }, undefined, t);

    ledgerCreate(t, db.collection('transactions').doc(ledgerTx.id), { ...ledgerTx, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    for (const p of payments) {
      t.update(db.collection('payments').doc(p.id), { depositTransactionId: ledgerTx.id, depositedAt: depositDate, updatedAt: new Date().toISOString() });
    }
    return { transactionId: ledgerTx.id, totalCents, count: payments.length };
  });
}
