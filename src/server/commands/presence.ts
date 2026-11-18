import { z } from 'zod';
import type { CommandContext, CommandDefinition } from './types';

/**
 * Who is looking at this workspace right now.
 *
 * `useCollaborators` wrote `presence/{uid}` with `setDoc` every 30 seconds and `deleteDoc`-ed it on unmount and on
 * `beforeunload`. Two things were wrong with that and neither is about the books:
 *
 * - the row named **its own owner and its own clock**. A tab could write `presence/{someone else's uid}`, and
 *   `lastActive` was whatever the device believed; the presence list is what the app decides "who else is editing this
 *   invoice" from, so a wrong clock makes a collaborator look present for an hour or absent while typing.
 * - the workspace on the row was whatever the tab had loaded, so leaving one workspace and opening another left the
 *   marker pointing at the first one.
 *
 * So the beat is a command: the caller sends the name and colour it shows (display only), the server writes `uid`,
 * `email`, `lastActive` and the workspace — and `presence.leave` only ever deletes the caller's own row.
 *
 * Presence is *not* a record: nothing in it is historical, and a beat writes no audit line (there would be one every
 * thirty seconds per person). It is deliberately the one command pair that keeps a heartbeat.
 */
const text = (max: number) => z.string().trim().max(max);

export const presenceBeatInput = z.object({
  /** what the presence list shows for this person; the identity fields beside it come from the session */
  name: text(120).min(1),
  color: text(40).optional(),
}).strict();

export const presenceLeaveInput = z.object({}).strict();

export type PresenceBeat = { uid: string; workspaceId: string; lastActive: string };
export type PresenceLeft = { uid: string; left: boolean };

const ROLES = ['owner', 'accountant', 'bookkeeper', 'viewer'] as const;

export const presenceBeatCommand: CommandDefinition<typeof presenceBeatInput, PresenceBeat> = {
  name: 'presence.beat',
  input: presenceBeatInput,
  roles: ROLES,
  async handler(ctx: CommandContext, tx, input: z.output<typeof presenceBeatInput>) {
    const lastActive = new Date().toISOString();
    // one row per person, keyed by the session's own id — the id in the path is never the caller's to choose
    tx.set(ctx.db.collection('presence').doc(ctx.actor), {
      uid: ctx.actor,
      email: ctx.user.email || '',
      name: input.name,
      ...(input.color ? { color: input.color } : {}),
      currentWorkspaceId: ctx.workspaceId,
      lastActive,
    }, { merge: true });
    return { uid: ctx.actor, workspaceId: ctx.workspaceId, lastActive };
  },
  /** a heartbeat is not a decision: there is nothing to ask and nothing to undo */
  async preview(ctx: CommandContext, input: z.output<typeof presenceBeatInput>) {
    return { title: `Mark ${input.name} as present`, lines: [`in the workspace ${ctx.workspaceId}`] };
  },
  audit() { return null; },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Say that this person is still looking at this workspace, so the collaborator list can show them; do not use it to mark anyone else present — the row is always the caller’s own.',
    example: { name: 'Dana', color: '#3366ff' },
    refusals: [
      { code: 'INVALID_INPUT', when: 'There is no display name.', next: 'Send the name the presence list should show.' },
      { code: 'NOT_A_MEMBER', when: 'The caller is not a member of the workspace.', next: 'Open a workspace the person belongs to.' },
    ],
  },
};

export const presenceLeaveCommand: CommandDefinition<typeof presenceLeaveInput, PresenceLeft> = {
  name: 'presence.leave',
  input: presenceLeaveInput,
  roles: ROLES,
  async handler(ctx: CommandContext, tx) {
    const ref = ctx.db.collection('presence').doc(ctx.actor);
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) return { uid: ctx.actor, left: false };
    tx.delete(ref);
    return { uid: ctx.actor, left: true };
  },
  async preview() {
    return { title: 'Leave the collaborator list', lines: ['only the caller’s own row is removed'] };
  },
  audit() { return null; },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Take this person out of the collaborator list; do not use it to remove anyone else — the row deleted is always the caller’s own.',
    example: {},
    refusals: [
      { code: 'NOT_A_MEMBER', when: 'The caller is not a member of the workspace.', next: 'Open a workspace the person belongs to.' },
    ],
    next: [{ command: 'presence.beat', label: 'Come back into the list' }],
  },
};
