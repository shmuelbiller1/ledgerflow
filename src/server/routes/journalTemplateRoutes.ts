import express from 'express';
import { getDb } from '../db/firestore';
import { JOURNAL_TEMPLATE_KIND, type JournalTemplate } from '../../lib/journalTemplates';
import { journalTemplateRemoveCommand, journalTemplateSaveCommand } from '../commands/workspaceHousekeeping';
import { executeCommand } from '../utils/commandExecutor';
import { legacyAnswer, workspaceInvocation } from '../utils/legacyCommandRoute';

/**
 * Journal entry templates (BD-09 / CA-27), mounted at
 * /api/v1/workspaces/:workspaceId/journal-templates (workspaceRoutes.ts, every member may read).
 * Owners, accountants and bookkeepers save and remove them — the registered commands
 * `journaltemplate.save` and `journaltemplate.remove` — and each keeps the answer its handler gave.
 * Kept with the workspace's documents (kind "journalTemplate", no `uid`, so they never show in
 * anyone's Vault); every change is in the audit trail. A template posts nothing: it only fills the
 * journal form.
 */
export const journalTemplateRouter = express.Router({ mergeParams: true });

const templatesOf = async (workspaceId: string): Promise<JournalTemplate[]> => {
  const snap = await getDb().collection('documents').where('workspaceId', '==', workspaceId).where('kind', '==', JOURNAL_TEMPLATE_KIND).get();
  return snap.docs.map(doc => ({ ...(doc.data() as JournalTemplate), id: doc.id })).sort((a, b) => a.name.localeCompare(b.name));
};

journalTemplateRouter.get('/', async (req, res) => {
  try {
    res.json({ status: 'success', data: { templates: await templatesOf((req.params as Record<string, string>).workspaceId) } });
  } catch (err) {
    res.status(500).json({ status: 'error', message: 'The templates could not be read', details: err instanceof Error ? err.message : String(err) });
  }
});

journalTemplateRouter.post('/', async (req, res) => {
  await executeCommand(req, res, {
    ...workspaceInvocation(req, journalTemplateSaveCommand),
    formatResponse: legacyAnswer({ badBody: 'Invalid template', failed: 'The template could not be saved', issues: true }),
  });
});

journalTemplateRouter.delete('/:templateId', async (req, res) => {
  const params = req.params as Record<string, string>;
  await executeCommand(req, res, {
    ...workspaceInvocation(req, journalTemplateRemoveCommand, { templateId: params.templateId }),
    formatResponse: legacyAnswer({ badBody: 'Check the template', failed: 'The template could not be removed' }),
  });
});
