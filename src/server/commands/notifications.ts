import { z } from 'zod';
import type { CommandContext, CommandDefinition } from './types';

/**
 * Mark the signed-in person's notifications as read.
 *
 * `useNotificationFeed.markNotificationsRead` built a `writeBatch` in the tab over the ids it had on screen: the
 * timestamp was the device's, the rows were not checked against the person (`notifications` is read by `uid`, and a
 * write had no such filter), and a batch that half-failed left the list showing some read and some not while the
 * store said otherwise.
 *
 * This is a `scope: 'person'` command because a notification is addressed to one person, not to a workspace: the
 * caller's own rows, and nothing else. Ids that are not theirs are skipped rather than refused — a screen that has
 * one stale row should not fail to clear the other nine — and the answer says how many were actually marked, so the
 * list can be brought in line with the server's own count.
 */
const idSchema = z.string().trim().min(1).max(200).refine(id => !id.includes('/'), 'Id cannot contain a slash');

export const notificationsReadInput = z.object({
  ids: z.array(idSchema).min(1).max(200),
}).strict();

type ReadInput = z.output<typeof notificationsReadInput>;
export type NotificationsRead = { marked: number; readAt: string };

export const notificationsReadCommand: CommandDefinition<typeof notificationsReadInput, NotificationsRead> = {
  name: 'notification.read',
  input: notificationsReadInput,
  roles: ['owner'],
  scope: 'person',
  async handler(ctx: CommandContext, tx, input: ReadInput) {
    const readAt = new Date().toISOString();
    let marked = 0;
    for (const id of input.ids) {
      const ref = ctx.db.collection('notifications').doc(id);
      const snapshot = await tx.get(ref);
      // someone else's notification, one already read, or one that is gone: nothing to do, and nothing to say
      if (!snapshot.exists) continue;
      const row = snapshot.data() as Record<string, unknown> | undefined;
      if (row?.uid !== ctx.actor || row?.read === true) continue;
      tx.update(ref, { read: true, readAt });
      marked += 1;
    }
    return { marked, readAt };
  },
  async preview(_ctx: CommandContext, input: ReadInput) {
    return { title: 'Mark these notifications as read', lines: [`${input.ids.length} notification(s)`, 'Your own only'] };
  },
  audit() { return null; },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Mark some of your own notifications as read, so the list stops showing them as new; do not use it to delete one or to touch someone else’s.',
    example: { ids: ['note_1', 'note_2'] },
    refusals: [
      { code: 'INVALID_INPUT', when: 'No ids, or more than 200 at once.', next: 'Send between one and two hundred notification ids.' },
      { code: 'UNAUTHENTICATED', when: 'The request has no signed-in person.', next: 'Sign in and try again.' },
    ],
  },
};
