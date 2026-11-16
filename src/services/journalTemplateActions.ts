import type { JournalTemplate, JournalTemplateInput } from '../lib/journalTemplates';
import { runCommand } from '../lib/runCommand';

/** Journal entry templates (BD-09 / CA-27) through the server, which checks who may save or remove. */
async function call<T>(workspaceId: string, path: string, init: { method: string; body?: unknown }): Promise<T> {
  // one call helper behind four exported functions, so this is one edit, not four
  const data = await runCommand<{ data?: unknown }>({
    path: `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/journal-templates${path}`,
    method: init.method as 'GET' | 'POST' | 'DELETE',
    ...(init.body === undefined ? {} : { body: init.body }),
  }) ?? {};
  // the route answers `{ data: … }`; the envelope is the route's, the payload is the caller's
  return (data as { data?: unknown }).data as T;
}

export async function listJournalTemplates(workspaceId: string): Promise<JournalTemplate[]> {
  const data = await call<{ templates?: JournalTemplate[] }>(workspaceId, '', { method: 'GET' });
  return Array.isArray(data?.templates) ? data.templates : [];
}

/** Saves the template; one already under that name (any case) is replaced. */
export async function saveJournalTemplate(workspaceId: string, input: JournalTemplateInput): Promise<{ template: JournalTemplate; replaced: boolean }> {
  return call<{ template: JournalTemplate; replaced: boolean }>(workspaceId, '', { method: 'POST', body: input });
}

export async function removeJournalTemplate(workspaceId: string, templateId: string): Promise<void> {
  await call(workspaceId, `/${encodeURIComponent(templateId)}`, { method: 'DELETE' });
}
