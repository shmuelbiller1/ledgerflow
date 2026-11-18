import Decimal from 'decimal.js';
import { Request, Response, NextFunction } from 'express';
import { DoubleEntryValidator } from '../../../kernel/validation/DoubleEntryValidator';
import { errorMessage } from '../../auth/requestUser';

/** A bank line sent by the browser for match suggestions (statement import, not yet stored). */
export type ExternalBankLine = { id?: string; amountCents?: number; amount?: number; description?: string; merchant?: string; date?: string };

export function formatTzDate(d: Date = new Date(), timezone = 'UTC'): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = formatter.formatToParts(d);
    const y = parts.find(p => p.type === 'year')?.value;
    const m = parts.find(p => p.type === 'month')?.value;
    const day = parts.find(p => p.type === 'day')?.value;
    if (y && m && day) return `${y}-${m}-${day}`;
  } catch {
    // fallback
  }
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function enforceDoubleEntrySafety(req: Request, res: Response, next: NextFunction) {
  const transaction = req.body.transaction;
  // Let /batch bypass this middleware
  if (req.path === '/batch') {
    return next();
  }
  if (req.body.partialUpdate) {
    return next();
  }
  if (!transaction || !Array.isArray(transaction.lines) || transaction.lines.length < 2) {
    return res.status(400).json({ error: "Invalid transaction structure: at least 2 lines required." });
  }
  
  if (transaction.currency && !/^[A-Z]{3}$/.test(transaction.currency)) {
    return res.status(400).json({ error: "Currency must be a valid ISO 4217 3-letter code." });
  }

  try {
    const netSum = transaction.lines.reduce((acc: Decimal, line: { amountCents?: unknown }) => {
      if (typeof line.amountCents !== 'number' || !Number.isSafeInteger(line.amountCents)) {
        throw new Error("Invalid cents integer format.");
      }
      return acc.plus(new Decimal(line.amountCents));
    }, new Decimal(0));

    if (!netSum.isZero()) {
      return res.status(422).json({
        error: `Mathematical imbalance: Net ledger sum is ${netSum.toNumber()} cents. Debits must equal Credits.`
      });
    }

    DoubleEntryValidator.validateJournalEntry(transaction);
    next();
  } catch (err) {
    return res.status(400).json({ error: errorMessage(err) });
  }
}

/**
 * Optimistic Concurrency Control: detects if existing transaction was updated since client read it.
 * The comparison is a pure function and lives in `lib/recordVersion.ts` so the batch-update service can
 * use it inside its transaction without importing from `routes/`; it is re-exported here for the routes.
 */
export { isUpdatedAtMismatch } from '../../../lib/recordVersion';

/**
 * Z-05: the version a client sends in an `If-Match` header (an entry's ETag is its `updatedAt` in
 * quotes; a weak `W/` prefix is accepted). `*` means any version, so it checks nothing.
 */
export function ifMatchVersion(header: string | undefined): string | undefined {
  const value = String(header || '').trim().replace(/^W\//, '');
  if (!value || value === '*') return undefined;
  return value.replace(/^"(.*)"$/, '$1') || undefined;
}
