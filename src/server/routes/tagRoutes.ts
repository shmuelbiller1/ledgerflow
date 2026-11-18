/**
 * Tags for the whole workspace (K-15), mounted at /api/v1/workspaces/:workspaceId/tags
 * (workspaceRoutes.ts). Every member may read; renaming, merging and removing is for owners,
 * accountants and bookkeepers, and is the registered command `tag.change` so that the role check, the
 * preview and the audit line live with the schema instead of in this file.
 *
 * The answers are the ones the handler gave: `{ status: 'success', data: { changed } }`, a 400 with
 * "Invalid request" and the issues for a malformed body, the service's status and words for a refusal,
 * and "The tag could not be changed" with the cause for a 500.
 */
import express from 'express';
import { getDb } from '../db/firestore';
import { listTags } from '../services/tagService';
import { tagChangeCommand } from '../commands/tagAndTax';
import { executeCommand } from '../utils/commandExecutor';

export const tagRouter = express.Router({ mergeParams: true });

tagRouter.get('/', async (req, res) => {
  try {
    res.json({ status: 'success', data: { tags: await listTags(getDb(), (req.params as Record<string, string>).workspaceId) } });
  } catch (err) {
    res.status(500).json({ status: 'error', message: 'The tags could not be read', details: err instanceof Error ? err.message : String(err) });
  }
});

const WRITERS = new Set(['owner', 'accountant', 'bookkeeper']);

tagRouter.post('/change', async (req, res) => {
  // the mount admits every member, because every member may read the tags; this address was the
  // handler's own 403 in its own words, so it stays here — the command checks the role again
  const { userRole } = req as unknown as { userRole?: string };
  if (!WRITERS.has(String(userRole))) return res.status(403).json({ status: 'error', message: 'Only owners, accountants and bookkeepers change tags' });
  await executeCommand(req, res, {
    definition: tagChangeCommand,
    workspaceId: String((req.params as Record<string, string>).workspaceId || ''),
    input: req.body,
    formatResponse: (outcome) => {
      if (outcome.ok) return { status: 200, body: { status: 'success', data: outcome.data } };
      if (outcome.code === 'INVALID_INPUT') {
        return { status: 400, body: { status: 'error', message: 'Invalid request', details: (outcome.error as { issues?: unknown })?.issues } };
      }
      if (outcome.status < 500) return { status: outcome.status, body: { status: 'error', message: outcome.message } };
      const cause = outcome.error instanceof Error ? outcome.error.message : String(outcome.error ?? outcome.message);
      return { status: 500, body: { status: 'error', message: 'The tag could not be changed', details: cause } };
    },
  });
});
