/**
 * The route that posts one journal entry for a document-flavoured write (ASC 842 lease
 * capitalisation, ASC 606 revenue recognition) and there is nothing else to it: both routes walked
 * through the same steps in the same order, so the order — and the refusals — now live in
 * `services/journalDocumentService.ts` once. This module is only the legacy HTTP shape of it: the
 * body is validated by the address's own schema and the answers keep the words they always had.
 *
 * `lease.capitalize` and `revenue.recognize` run the same service through the command runner, so a
 * route that keeps answering here and the registered command cannot drift apart.
 */
import express from 'express';
import type { z, ZodType } from 'zod';
import { errorMessage, requestUser } from '../auth/requestUser';
import { getDb } from '../db/firestore';
import { extractCanonicalOperationId } from '../utils/idempotency';
import { postJournalDocument, type JournalDocumentSpec } from '../services/journalDocumentService';

export type { JournalLine, JournalDocumentSpec } from '../services/journalDocumentService';

export function postJournalDocumentRoute<Schema extends ZodType>(
  spec: JournalDocumentSpec<Schema> & { schema: Schema },
): express.RequestHandler {
  return async (req, res) => {
    try {
      const parseResult = spec.schema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({
          status: 'error',
          error: 'Validation failed',
          details: parseResult.error.issues,
        });
        return;
      }

      const input = parseResult.data as z.infer<Schema>;
      const user = requestUser(req);
      const db = getDb();
      const result = await postJournalDocument(db, spec, input, user, extractCanonicalOperationId(req));
      res.json(result);
    } catch (e) {
      const explicitStatus = (e as { status?: number })?.status;
      const status = typeof explicitStatus === 'number'
        ? explicitStatus
        : (errorMessage(e).includes('Unauthorized') || errorMessage(e).includes('Forbidden') ? 403 : 400);
      res.status(status).json({ error: errorMessage(e) });
    }
  };
}
