import { z } from 'zod';
import { HttpError } from '../auth/requestUser';
import type { CommandContext, CommandDefinition } from './types';

/**
 * One payment against a loan: the record of what the ledger entry already posted.
 *
 * `LoansView` posts the entry through the same transaction route every posting screen uses, and then appended
 * `{ installment, date, transactionId }` to the loan's `payments` with an `updateDoc` from the tab. The entry is the
 * posting; this list is what the screen reads back to show which instalments are done — so a lost append shows a
 * paid instalment as still due, and a doubled one hides an instalment nobody paid.
 *
 * Three things the browser write could not promise, all of them in the answer:
 *
 * - the payment belongs to this workspace's loan (the tab could name any id);
 * - an instalment is recorded once (`CONFLICT` otherwise) — a retried save answers with "already recorded" instead of
 *   appending a second line;
 * - `payments` and `updatedAt` are written from the read inside the transaction, so two tabs recording two instalments
 *   keep both.
 */
const idSchema = z.string().trim().min(1).max(200).refine(id => !id.includes('/'), 'Id cannot contain a slash');
const text = (max: number) => z.string().trim().max(max);

export const loanPaymentInput = z.object({
  loanId: idSchema,
  /** which instalment of the schedule this settles, counted from 1 */
  installment: z.number().int().min(1).max(600),
  /** the day the money moved; the same date the entry carries */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'A date is YYYY-MM-DD'),
  /** the entry that posted it, so the payment can be traced back to the ledger */
  transactionId: text(200).optional(),
}).strict();

type PaymentInput = z.output<typeof loanPaymentInput>;
type LoanRow = Record<string, unknown> & {
  id?: string;
  payments?: Array<{ installment: number; date: string; transactionId?: string }>;
};
export type LoanPaymentRecorded = { loanId: string; installment: number; payments: number; created: boolean };

export const loanPaymentCommand: CommandDefinition<typeof loanPaymentInput, LoanPaymentRecorded> = {
  name: 'loan.payment',
  input: loanPaymentInput,
  roles: ['owner', 'accountant', 'bookkeeper'],
  async handler(ctx: CommandContext, tx, input: PaymentInput) {
    const ref = ctx.db.collection('loans').doc(input.loanId);
    const snapshot = await tx.get(ref);
    const existing = snapshot.data() as LoanRow | undefined;
    if (!snapshot.exists || existing?.workspaceId !== ctx.workspaceId) {
      throw Object.assign(new HttpError('This loan is not in the selected workspace.', 404), { code: 'NOT_FOUND' });
    }
    const payments = Array.isArray(existing.payments) ? existing.payments : [];
    if (payments.some(payment => payment.installment === input.installment)) {
      throw Object.assign(new HttpError(
        `Instalment ${input.installment} of this loan is already recorded; nothing was added.`,
        409,
      ), { code: 'CONFLICT' });
    }
    const next = [...payments, {
      installment: input.installment,
      date: input.date,
      ...(input.transactionId ? { transactionId: input.transactionId } : {}),
    }];
    tx.update(ref, { payments: next, updatedAt: new Date().toISOString() });
    return { loanId: input.loanId, installment: input.installment, payments: next.length, created: true };
  },
  async preview(ctx: CommandContext, input: PaymentInput) {
    const snapshot = await ctx.db.collection('loans').doc(input.loanId).get();
    const existing = snapshot.data() as LoanRow | undefined;
    if (!snapshot.exists || existing?.workspaceId !== ctx.workspaceId) {
      throw new HttpError('This loan is not in the selected workspace.', 404);
    }
    const recorded = (existing.payments || []).some(payment => payment.installment === input.installment);
    return {
      title: `Record instalment ${input.installment}`,
      lines: [input.date, recorded ? 'This instalment is already recorded' : 'The schedule line is marked paid'],
    };
  },
  audit(_input: PaymentInput, result: LoanPaymentRecorded) {
    return {
      action: 'LOAN_PAYMENT_RECORDED',
      entityType: 'loans',
      entityId: result.loanId,
      description: `Recorded instalment ${result.installment} of the loan ${result.loanId}`,
      details: { installment: result.installment, payments: result.payments },
    };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Record that one instalment of a loan was paid, against the entry that posted it; do not use it to post the payment, which is a journal entry.',
    example: { loanId: 'loan_1', installment: 3, date: '2026-11-01', transactionId: 'tx_9' },
    refusals: [
      { code: 'CONFLICT', when: 'That instalment of this loan is already recorded.', next: 'Open the loan and check which instalments are still due.' },
      { code: 'NOT_FOUND', when: 'The loan is not in the selected workspace.', next: 'Reload the loans and choose one in this workspace.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is a viewer.', next: 'Ask an owner, accountant or bookkeeper to record the payment.' },
    ],
    // no next step is offered: the instalment after this one is recorded the same way, and every name in `next`
    // must be a command the registry has (record-next-step.test.ts holds that)

  },
};
