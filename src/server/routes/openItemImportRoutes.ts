import express from 'express';
import { z } from 'zod';
import { getDb } from '../db/firestore';
import { requestUser } from '../auth/requestUser';
import { importOpenItems, OpenItemImportError } from '../services/openItemImportService';

/**
 * EG-14: opening open invoices and bills from a CSV, mounted at /api/v1/open-items (server.ts).
 * POST /preview reads the file against the books; POST /confirm validates all rows, then posts them
 * one at a time. Later posting failures can leave earlier rows saved. Owners and accountants.
 */
export const openItemImportRouter = express.Router();

const schema = z.object({
  workspaceId: z.string().min(1).max(127),
  side: z.enum(['customer', 'vendor']),
  csv: z.string().min(1).max(5_000_000),
}).strict();

function importHandler(mode: 'preview' | 'confirm'): express.RequestHandler {
  return async (req, res) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ status: 'error', message: 'Send the workspace, customer or vendor, and the file', rows: [] });
    try {
      const result = await importOpenItems(getDb(), requestUser(req), { ...parsed.data, mode });
      res.json({ status: 'success', ...result });
    } catch (err) {
      if (err instanceof OpenItemImportError) return res.status(err.status).json({ status: 'error', message: err.message, rows: err.rows });
      res.status(500).json({ status: 'error', message: 'The open items could not be imported', details: err instanceof Error ? err.message : String(err) });
    }
  };
}

openItemImportRouter.post('/preview', importHandler('preview'));
openItemImportRouter.post('/confirm', importHandler('confirm'));
