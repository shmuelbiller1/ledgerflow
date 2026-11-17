import { z } from 'zod';
import { HttpError } from '../auth/requestUser';
import type { CommandContext, CommandDefinition } from './types';

/**
 * Deleting a project, and putting it back.
 *
 * `projectUndo` did both from the browser: it read the project, deleted the row, kept the snapshot in a closure and
 * wrote it back if the toast's Undo was pressed within ten seconds. The delete and the undo were therefore only as
 * good as that tab — a reload lost the snapshot for good, a second tab could not know a row had been recreated
 * under the same id, and nothing recorded that a project had ever existed.
 *
 * `project.delete` therefore keeps the row: it writes the deleted project to `deletedProjects` under
 * `${workspaceId}_${projectId}` and answers with it. `project.restore` takes **only the id** and reads that record,
 * so the step back does not depend on the tab that deleted anything — it survives a reload, it works from a second
 * tab, and an accountant can run it next week. It refuses an id that has been taken again rather than overwriting
 * it, and it clears the record when the project is back.
 *
 * Deliberately metadata only, exactly as before: no invoice, bill, journal or time entry is touched, and a project
 * that documents still point at is not removed from them.
 */
const idSchema = z.string().trim().min(1).max(200).refine(id => !id.includes('/'), 'Id cannot contain a slash');

export const projectRestoreInput = z.object({ id: idSchema }).strict();

export const projectDeleteInput = z.object({ id: idSchema }).strict();

/** Where a deleted project waits: one row per workspace and project id, so it cannot be found from another workspace. */
const tombstoneId = (workspaceId: string, projectId: string) => `${workspaceId}_${projectId}`;

const ROLES = ['owner', 'accountant', 'bookkeeper'] as const;
type DeleteInput = z.output<typeof projectDeleteInput>;
type RestoreInput = z.output<typeof projectRestoreInput>;
type ProjectRow = Record<string, unknown> & { id?: string };

export const projectDeleteCommand: CommandDefinition<typeof projectDeleteInput, { project: ProjectRow }> = {
  name: 'project.delete',
  input: projectDeleteInput,
  roles: ROLES,
  async handler(ctx: CommandContext, tx, input: DeleteInput) {
    const ref = ctx.db.collection('projects').doc(input.id);
    const snapshot = await tx.get(ref);
    const row = snapshot.data() as ProjectRow | undefined;
    if (!snapshot.exists || row?.workspaceId !== ctx.workspaceId) {
      throw Object.assign(new HttpError('This project is not in the selected workspace.', 404), { code: 'NOT_FOUND' });
    }
    const deletedAt = new Date().toISOString();
    tx.delete(ref);
    // the row is kept on the server, not only in the answer: a reload must not be the end of the undo
    tx.set(ctx.db.collection('deletedProjects').doc(tombstoneId(ctx.workspaceId, input.id)), {
      ...row, id: input.id, workspaceId: ctx.workspaceId, deletedAt, deletedBy: ctx.actor,
    });
    return { project: { ...row, id: input.id, deletedAt } };
  },
  async preview(ctx: CommandContext, input: DeleteInput) {
    const snapshot = await ctx.db.collection('projects').doc(input.id).get();
    const row = snapshot.data() as ProjectRow | undefined;
    if (!snapshot.exists || row?.workspaceId !== ctx.workspaceId) {
      throw new HttpError('This project is not in the selected workspace.', 404);
    }
    return {
      title: `Delete the project “${String(row?.name || input.id)}”`,
      lines: [
        'The project row is removed; invoices, bills, journal lines and time already recorded keep their own rows',
        'The row is kept on the server, so it can be put back later — from this tab or any other',
      ],
    };
  },
  audit(_input: DeleteInput, result: { project: ProjectRow }) {
    return {
      action: 'PROJECT_DELETED',
      entityType: 'projects',
      entityId: String(result.project.id),
      description: `Deleted the project “${String(result.project.name || result.project.id)}”`,
    };
  },
  inverse(_input: DeleteInput, result: { project: ProjectRow }) {
    // the whole row is not needed: the server kept it, so the step back is the id alone
    return { command: 'project.restore', input: { id: String(result.project.id) } };
  },
  risk: 'normal',
  describe: {
    sentence: 'Delete one project and answer with the row that was removed, so it can be restored; do not use it to remove the documents that point at the project — they keep their own rows.',
    example: { id: 'proj_web' },
    refusals: [
      { code: 'NOT_FOUND', when: 'The project is not in the selected workspace, or is already gone.', next: 'Reload the projects and choose one in this workspace.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is not an owner, accountant or bookkeeper.', next: 'Ask a workspace owner to grant an appropriate role.' },
      { code: 'INVALID_INPUT', when: 'The id is missing or carries a slash.', next: 'Send the project id as it appears in the projects list.' },
    ],
    next: [{ command: 'project.restore', label: 'Put it back' }],
  },
};

export const projectRestoreCommand: CommandDefinition<typeof projectRestoreInput, { project: ProjectRow }> = {
  name: 'project.restore',
  input: projectRestoreInput,
  roles: ROLES,
  async handler(ctx: CommandContext, tx, input: RestoreInput) {
    // the tombstone is scoped by workspace in its id, so another workspace's deleted project is simply not found
    const tombstoneRef = ctx.db.collection('deletedProjects').doc(tombstoneId(ctx.workspaceId, input.id));
    const tombstone = await tx.get(tombstoneRef);
    const kept = tombstone.data() as ProjectRow | undefined;
    if (!tombstone.exists || kept?.workspaceId !== ctx.workspaceId) {
      throw Object.assign(new HttpError('Nothing is on record for this project id.', 404), { code: 'NOT_FOUND' });
    }
    const ref = ctx.db.collection('projects').doc(input.id);
    const snapshot = await tx.get(ref);
    if (snapshot.exists) {
      // the browser's undo could overwrite a row that had been recreated under the same id; restoring must not
      throw Object.assign(new HttpError('A record already uses this ID. It was not overwritten.', 409), { code: 'CONFLICT' });
    }
    const { id: _rowId, deletedAt: _deletedAt, deletedBy: _deletedBy, ...fields } = kept;
    const row = { ...fields, workspaceId: ctx.workspaceId };
    tx.set(ref, row);
    tx.delete(tombstoneRef);
    return { project: { ...row, id: input.id } };
  },
  async preview(ctx: CommandContext, input: RestoreInput) {
    const kept = await ctx.db.collection('deletedProjects').doc(tombstoneId(ctx.workspaceId, input.id)).get();
    if (!kept.exists) return { title: `Nothing is on record for ${input.id}`, lines: ['Nothing will be written'] };
    const taken = await ctx.db.collection('projects').doc(input.id).get();
    return taken.exists
      ? { title: `A record already uses the id ${input.id}`, lines: ['Nothing will be written'] }
      : { title: `Put the project “${String((kept.data() as ProjectRow)?.name || input.id)}” back`, lines: ['It returns under the same id, as it was'] };
  },
  audit(_input: RestoreInput, result: { project: ProjectRow }) {
    return {
      action: 'PROJECT_RESTORED',
      entityType: 'projects',
      entityId: String(result.project.id),
      description: `Restored the project “${String(result.project.name || result.project.id)}”`,
    };
  },
  inverse(_input: RestoreInput, result: { project: ProjectRow }) {
    return { command: 'project.delete', input: { id: String(result.project.id) } };
  },
  risk: 'normal',
  describe: {
    sentence: 'Put back a project that project.delete removed, from the row the server kept; do not use it to overwrite a project that exists — that is a project.update.',
    example: { id: 'proj_web' },
    refusals: [
      { code: 'CONFLICT', when: 'A project with this id already exists.', next: 'Keep the project that is there, or delete it first to restore the older row.' },
      { code: 'NOT_FOUND', when: 'Nothing is on record for this id in this workspace.', next: 'Check the id, and that the project was deleted from this workspace.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is not an owner, accountant or bookkeeper.', next: 'Ask a workspace owner to grant an appropriate role.' },
      { code: 'INVALID_INPUT', when: 'The row has no id, or carries an id with a slash.', next: 'Send the project row that project.delete answered with.' },
    ],
    next: [{ command: 'project.delete', label: 'Delete it again' }],
  },
};
