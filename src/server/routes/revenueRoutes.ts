import express from 'express';
import { z } from 'zod';
import { revenueRecognizeCommand } from '../commands/verticalAccounting';
import { executeCommand, withLegacyInputIdempotencyHash } from '../utils/commandExecutor';
import { journalDocumentAnswer } from '../utils/journalDocumentAnswer';

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
// document-journal service's; this route names the entry and keeps the answer the address has always
// given ({ status: 'ok', message, transactionId }, and { error } when it is refused).
// `revenue.recognize` runs the same service through the command runner.
revenueRouter.post('/recognize', async (req, res) => {
  const parsed = RecognizeRevenueSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ status: 'error', error: 'Validation failed', details: parsed.error.issues });
    return;
  }
  // Keep the legacy address's existing capacity behaviour; the command API has its own gate.
  await executeCommand(req, res, {
    definition: withLegacyInputIdempotencyHash({ ...revenueRecognizeCommand, capacity: undefined }),
    workspaceId: parsed.data.workspaceId, input: parsed.data, formatResponse: journalDocumentAnswer,
  });
});
