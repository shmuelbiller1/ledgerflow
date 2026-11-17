/**
 * The two worlds a workspace setting is changed in, behind one call.
 *
 * A signed-in screen changes a setting by asking the server: `workspace.settings` carries the allowlist, the role
 * check, the audit line and the currency rule. The sample company has no workspace on the server, so there is
 * nothing to ask — its screens write their own in-memory copy (`localUpdate`), and `guestSession()` says which world
 * the tab is in.
 *
 * This matters because the screens used to do both with one call: `updateDoc(doc(db, 'workspaces', id), …)` went to
 * Postgres when signed in and to the sample database in a demo. Moving them to the command without this branch
 * would have made the demo's settings screens request a server that does not have their workspace — the sample
 * company's own tests say so out loud ("Sample settings must not request a server").
 *
 * What it deliberately does not do: decide *what* a setting is. The keys, their ranges and the refusals live in the
 * command (`src/server/commands/workspaceSettingsPanel.ts`), and the axes in `workspace.dimensionaxes`; a screen that
 * invents a key here still gets refused on the server.
 */
import { runNamedCommand } from './commandByName';
import { localUpdate } from './db/localStore';
import { guestSession } from './db/guestDatabase';
import type { DimensionDefinition } from '../types';

/** Change settings on the workspace: the sample company's own copy in a demo, the command when signed in. */
export async function saveWorkspaceSettings(workspaceId: string, fields: Record<string, unknown>): Promise<void> {
  if (guestSession()) {
    await localUpdate('workspaces', workspaceId, mergeNestedMaps(fields));
    return;
  }
  await runNamedCommand('workspace.settings', fields, { workspaceId });
}

/**
 * The server merges `reportNotes` one note at a time (NESTED_MAPS in workspaceSettingsPanel.ts). The sample
 * company must do the same, or saving one note would replace every other note: each note becomes its own dotted
 * field (`reportNotes.<key>`), which the sample database writes in place. A cleared note is stored as null, which
 * the screen reads as no note.
 */
function mergeNestedMaps(fields: Record<string, unknown>): Record<string, unknown> {
  const notes = fields.reportNotes;
  if (!notes || typeof notes !== 'object' || Array.isArray(notes)) return fields;
  const { reportNotes: _ignored, ...rest } = fields;
  const flat: Record<string, unknown> = { ...rest };
  for (const [key, value] of Object.entries(notes as Record<string, unknown>)) flat[`reportNotes.${key}`] = value;
  return flat;
}

/** Save the workspace's label axes (which labels exist and what they are called), same two worlds. */
export async function saveWorkspaceAxes(workspaceId: string, dimensions: DimensionDefinition[]): Promise<void> {
  if (guestSession()) {
    await localUpdate('workspaces', workspaceId, { dimensions });
    return;
  }
  await runNamedCommand('workspace.dimensionaxes', { dimensions }, { workspaceId });
}
