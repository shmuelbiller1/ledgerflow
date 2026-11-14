import { Transaction } from '../../types';
import { DoubleEntryValidator } from './DoubleEntryValidator';
import { getDb } from '../../server/db/firestore';
import { TransactionSchema } from '../../schemas';
import { getAbsoluteTotal } from '../../lib/txFilters';
import { SecurityService } from '../../services/securityService';
import { assertPostingOpen, lockMessage, postingLock } from '../../lib/periodLock';
import { settleHomeCurrency } from '../../lib/txFilters';

export interface ValidationContext {
  workspaceId: string;
  user: { uid: string; admin?: boolean };
  wsData: import("../../lib/periodLock").PeriodLockSettings | undefined;
  accountsMap?: Map<string, { workspaceId?: string; name?: string } | undefined>;
}

export class TransactionValidator {
  
  static validateTransactionState(
    existingTx: Transaction, 
    context: ValidationContext, 
    options?: { isReversalUpdate?: boolean }
  ) {
    // 1. Period Lock (exempt if setting reversalEventId as part of a sanctioned reversal)
    const lock = !options?.isReversalUpdate && existingTx.date ? postingLock(existingTx.date, context.wsData, context.user.uid) : null;
    if (lock) {
      throw new Error(`Period Locked: Cannot modify transaction on ${existingTx.date}: ${lockMessage(existingTx.date, lock).replace(/^Period Locked: /, '')}`);
    }

    // 2. Status Locks
    if ((existingTx.status === 'certified' || existingTx.status === 'void') && !context.user.admin) {
      throw new Error(`Forbidden: Transaction ${existingTx.id} status is locked.`);
    }

    // 3. Ownership
    if (existingTx.workspaceId !== context.workspaceId) {
      throw new Error(`Forbidden: Transaction does not belong to authorized workspace.`);
    }
  }

  static async validateAndPrepare(
    transaction: Omit<Partial<Transaction>, 'type' | 'status' | 'lines'> & { type?: string; status?: string; lines?: Partial<Transaction['lines'][number]>[] },
    context: ValidationContext,
    existingTx?: Transaction,
    t?: Pick<import("../../server/db/pgFirestore").Transaction, 'getAll'>
  ): Promise<Transaction> {
    const db = getDb();
    
    // Ensure ownership & workspace (N14: Unconditionally enforce ownership)
    transaction.workspaceId = context.workspaceId;
    transaction.uid = context.user.uid;

    // N9: Prevent ghost simulation IDs from persisting as regular ledger transactions
    if (transaction.id && typeof transaction.id === 'string' && transaction.id.startsWith('ghost-') && transaction.type !== 'forecast') {
      throw new Error("Invalid transaction ID: 'ghost-' prefix is reserved for ephemeral client simulations.");
    }

    // #88 & N15 - Semantic contract: totalAmountCents is ALWAYS absolute positive safe integer, using FX-aware line amounts
    if (Array.isArray(transaction.lines) && transaction.lines.length > 0) {
      const calculatedTotal = getAbsoluteTotal(transaction as Transaction);
      if (!Number.isSafeInteger(calculatedTotal)) {
        throw new Error(`Validation Failed: totalAmountCents exceeds safe integer bounds.`);
      }
      transaction.totalAmountCents = calculatedTotal;
    } else if (transaction.totalAmountCents !== undefined && transaction.totalAmountCents !== null) {
      const absVal = Math.abs(Math.round(transaction.totalAmountCents));
      if (!Number.isSafeInteger(absVal)) {
        throw new Error(`Validation Failed: totalAmountCents exceeds safe integer bounds.`);
      }
      transaction.totalAmountCents = absVal;
    }

    // Full Schema Validation
    const parsed = TransactionSchema.safeParse(transaction);
    if (!parsed.success) {
      const errMsgs = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ');
      throw new Error(`Schema validation failed: ${errMsgs}`);
    }

    const validatedTx = {
      ...parsed.data,
      id: parsed.data.id || transaction.id || db.collection("transactions").doc().id,
      totalAmountCents: transaction.totalAmountCents ?? 0
    } as Transaction;

    // 1. Period Lock
    if (validatedTx.date) assertPostingOpen(validatedTx.date, context.wsData, context.user.uid);

    // 2. Status Locks
    if (existingTx && (existingTx.status === 'certified' || existingTx.status === 'void') && !context.user.admin) {
      throw new Error(`Forbidden: Transaction ${existingTx.id} status is locked.`);
    }

    // 3. Ownership / Immutability
    if (existingTx && existingTx.workspaceId !== context.workspaceId) {
      throw new Error(`Forbidden: Transaction does not belong to authorized workspace.`);
    }

    // 4. Account Verification
    if (validatedTx.lines) {
      const accountIds = Array.from(new Set<string>(validatedTx.lines.map((l) => l.accountId).filter(Boolean)));
      if (accountIds.length > 0) {
        let accMap = context.accountsMap;
        if (!accMap) {
          const accRefs = accountIds.map(id => db.collection('chartAccounts').doc(id));
          const accSnaps = t ? await t.getAll(...accRefs) : await db.getAll(...accRefs);
          accMap = new Map<string, { workspaceId?: string; name?: string } | undefined>();
          for (const snap of accSnaps) {
            accMap.set(snap.id, snap.data() as { workspaceId?: string; name?: string } | undefined);
          }
        }
        for (const id of accountIds) {
          const accData = accMap.get(id);
          if (!accData || accData.workspaceId !== context.workspaceId) {
            throw new Error(`Account ${id} does not exist or does not belong to authorized workspace.`);
          }
        }
        for (const line of validatedTx.lines) {
          if (!line.accountName && accMap.has(line.accountId)) {
            line.accountName = accMap.get(line.accountId)?.name || 'Account';
          }
        }
      }
    }

    // 5. Double Entry (in the entry's currency, then in the home currency — BUG-07)
    DoubleEntryValidator.validateJournalEntry(validatedTx);
    settleHomeCurrency(validatedTx);
    // #654: settling can move a rounding cent onto a line; the total follows the settled home amounts
    if (Array.isArray(validatedTx.lines) && validatedTx.lines.length > 0) validatedTx.totalAmountCents = getAbsoluteTotal(validatedTx);
    
    // 6. Server-Authoritative Forensic Hash Stamping
    if (!process.env.SYSTEM_SALT && process.env.NODE_ENV !== 'test') {
      throw new Error("SYSTEM_SALT environment variable is required for forensic stamping.");
    }
    const forensicHash = SecurityService.generateForensicHash(validatedTx);
    validatedTx.verification = {
      ...validatedTx.verification,
      status: 'verified',
      verifiedAt: new Date().toISOString(),
      verifiedBy: 'server-vault',
      timestamp: new Date().toISOString(),
      hash: forensicHash
    };

    return validatedTx;
  }
}

