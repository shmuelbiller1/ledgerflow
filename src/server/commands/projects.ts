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
 * `project.delete` answers with the row it removed, and `inverse()` names `project.restore` with that row. That is
 * the whole undo: the step back is a command like any other, so it can be offered from the toast, from a screen,
 * or by an accountant a week later — and `project.restore` refuses a row that already exists rather than
 * overwriting it, which is the one thing the browser's version could not guarantee.
 *
 * Deliberately metadata only, exactly as before: no invoice, bill, journal or time entry is touched, and a project
 * that documents still point at is not removed from them.
 */
const idSchema = z.string().trim().min(1).max(200).refine(id => !id.includes('/'), 'Id cannot contain a slash');

/** The row as it was: the id, and everything else the project carried. `workspaceId` is not taken from it. */
export const projectRestoreInput = z.object({
  project: z.object({ id: idSchema }).passthrough(),
}).strict();

export const projectDeleteInput = z.object({ id: idSchema }).strict();

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
    tx.delete(ref);
    // the whole row travels back, so the caller can undo without having read anything itself
    return { project: { ...row, id: input.id } };
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
        'The answer carries the deleted row, so it can be put back as it was',
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
    return { command: 'project.restore', input: { project: result.project } };
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
    const incoming = input.project as ProjectRow;
    // a row from another workspace is not this workspace's to restore, whatever the payload says
    if (incoming.workspaceId !== undefined && incoming.workspaceId !== ctx.workspaceId) {
      throw Object.assign(new HttpError('This project belongs to another workspace.', 404), { code: 'NOT_FOUND' });
    }
    const ref = ctx.db.collection('projects').doc(String(incoming.id));
    const snapshot = await tx.get(ref);
    if (snapshot.exists) {
      // the browser's undo could overwrite a row that had been recreated under the same id; restoring must not
      throw Object.assign(new HttpError('A record already uses this ID. It was not overwritten.', 409), { code: 'CONFLICT' });
    }
    const { id: _rowId, ...fields } = incoming;
    const row = { ...fields, workspaceId: ctx.workspaceId };
    tx.set(ref, row);
    return { project: { ...row, id: String(incoming.id) } };
  },
  async preview(ctx: CommandContext, input: RestoreInput) {
    const id = String((input.project as ProjectRow).id);
    const snapshot = await ctx.db.collection('projects').doc(id).get();
    return snapshot.exists
      ? { title: `A record already uses the id ${id}`, lines: ['Nothing will be written'] }
      : { title: `Put the project “${String((input.project as ProjectRow).name || id)}” back`, lines: ['It returns under the same id, as it was'] };
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
    sentence: 'Put back a project from the row an earlier project.delete answered with; do not use it to overwrite a project that exists — that is a project.update.',
    example: { project: { id: 'proj_web', name: 'Website Redesign', status: 'active', workspaceId: 'ws_1' } },
    refusals: [
      { code: 'CONFLICT', when: 'A project with this id already exists.', next: 'Choose the project that is there, or restore under the id the deleted row had.' },
      { code: 'NOT_FOUND', when: 'The row names another workspace.', next: 'Restore the row into the workspace it came from.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is not an owner, accountant or bookkeeper.', next: 'Ask a workspace owner to grant an appropriate role.' },
      { code: 'INVALID_INPUT', when: 'The row has no id, or carries an id with a slash.', next: 'Send the project row that project.delete answered with.' },
    ],
    next: [{ command: 'project.delete', label: 'Delete it again' }],
  },
};
