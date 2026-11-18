import type { Bill } from '../../types';
import { calculateAmountDue } from '../../lib/documentMath';
import { claimOf } from '../../lib/expenseClaims';

/** UI eligibility only; the server must still enforce settlement and approval rules at commit. */
export function billMayBeVoided(bill: Bill): boolean {
  if (['paid', 'void', 'cancelled', 'rejected'].includes(bill.status) || claimOf(bill)?.state === 'submitted') return false;
  // A paid status may be legacy (without amountPaidCents), while an approved document may
  // already be fully settled without having its status updated. Do not strand applied money.
  if (bill.amountCents > 0 && calculateAmountDue(bill) === 0) return false;
  // Even a partial payment or credit needs to be undone before the bill can be voided.
  return (bill.amountPaidCents || 0) === 0 && (bill.settledByRecordsCents || 0) === 0;
}
