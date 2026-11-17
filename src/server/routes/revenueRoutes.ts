import express from 'express';
import { z } from 'zod';
import { postJournalDocumentRoute } from '../http/journalDocumentRoute';

const RecognizeRevenueSchema = z.object({
  workspaceId: z.string().min(1, 'workspaceId is required'),
  contractId: z.string().optional(),
  periodId: z.string().optional(),
  amountCents: z.number().int().positive('amountCents must be a positive integer'),
  deferredAccountId: z.string().min(1, 'deferredAccountId is required'),
  revenueAccountId: z.string().min(1, 'revenueAccountId is required'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD format').optional()
});

export const revenueRouter = express.Router();

// ASC 606: recognising revenue moves the amount out of the deferred balance and into income.
// The steps (membership, lock, validator, the re-checked commit, the audit entry) are the shared
// document-journal route's; this route names the entry.
revenueRouter.post('/recognize', postJournalDocumentRoute({
  schema: RecognizeRevenueSchema,
  operationType: 'REVENUE_RECOGNIZE',
  legacyPrefix: 'rev',
  message: 'Revenue recognized successfully (ASC 606 compliance).',
  description: ({ contractId, periodId }) => `ASC 606 Revenue Recognition for Contract ${contractId || 'Unknown'} (Period ${periodId || 'N/A'})`,
  totalAmountCents: ({ amountCents }) => amountCents,
  lines: ({ amountCents, deferredAccountId, revenueAccountId }) => [
    { accountId: deferredAccountId, amountCents, description: 'Recognized revenue - reducing liability' },
    { accountId: revenueAccountId, amountCents: -amountCents, description: 'Recognized revenue - increasing income' },
  ],
  operationId: ({ contractId, periodId }) => (contractId && periodId ? `${contractId}_${periodId}` : undefined),
  audit: {
    action: 'REVENUE_RECOGNIZED',
    details: ({ contractId, periodId, amountCents, deferredAccountId, revenueAccountId }, txDate) => ({
      description: `Recognized revenue for contract ${contractId || 'Unknown'} (${amountCents} cents) on ${txDate}`,
      contractId: contractId || null,
      periodId: periodId || null,
      amountCents,
      deferredAccountId,
      revenueAccountId,
      date: txDate,
    }),
  },
}));
