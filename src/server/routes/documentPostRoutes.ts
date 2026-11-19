import express from 'express';
import { documentPostWithLegacyKey, legacyDocumentBody, postedDocumentType } from '../commands/documentPost';
import { requireLedgerWriter } from '../middleware/requireLedgerWriter';
import { executeCommand } from '../utils/commandExecutor';
import { legacyPostingAnswer } from '../utils/legacyPostingAnswer';

/** L-94: this strict compatibility address accepts a document, never browser-built postings. */
export const documentPostRouter = express.Router();

documentPostRouter.post('/:type/:id/post', requireLedgerWriter, async (req, res) => {
  const collection = postedDocumentType.safeParse(req.params.type);
  if (!collection.success) return res.status(400).json({ error: 'Only invoices, bills, credit notes and vendor credits are posted here' });
  const parsed = legacyDocumentBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Send the document only: { workspaceId, action, data }', details: parsed.error.issues });
  await executeCommand(req, res, {
    definition: documentPostWithLegacyKey(req.get('Idempotency-Key')),
    workspaceId: parsed.data.workspaceId,
    input: { ...parsed.data, collection: collection.data, docId: String(req.params.id) },
    legacyRoute: true,
    legacyOperationId: 'ignore',
    formatResponse: legacyPostingAnswer,
  });
});
