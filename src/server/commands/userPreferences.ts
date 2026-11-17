import { z } from 'zod';
import type { CommandDefinition } from './types';

/**
 * The settings a person keeps on their own profile: which notices they want, and how each report is laid out.
 *
 * Both were `updateDoc(doc(db, 'users', uid), …)` from the browser. Neither is a ledger row, so the failure is
 * quieter than a bad posting and easier to miss: the tab typed `updatedAt` itself, a save on report A wrote the
 * whole `reportPreferences` map (so saving A in one tab and B in another left only B), nothing was audited, and
 * an `updatedAt` written by a clock that is a few minutes fast could make the next save look older than what is
 * stored.
 *
 * One command, because it is one row and one act: *this is how I want my own profile set*. It is `scope: 'person'`
 * — the row is the caller's, so there is no workspace to name and no role to check — and it merges rather than
 * replaces: a notice that is not mentioned keeps its old value, and a report's layout is written as its own dotted
 * field so the other reports' layouts survive.
 *
 * What it is **not**: a way to change someone else's profile (the row is `ctx.actor`'s), or a place to put a
 * workspace setting (`workspace.settings` owns those) or a role (`workspace.updaterole`).
 */
const text = (max: number) => z.string().trim().max(max);

/** A notice toggle or a chosen digest hour: the screen's own scalars, kept scalar. */
const prefValue = z.union([z.boolean(), z.number().finite(), z.string().trim().max(200)]);

export const userPreferencesInput = z.object({
  /** The notices this person wants; merged per key, so a save that mentions one does not clear the rest. */
  notificationPrefs: z.record(z.string().trim().min(1).max(80), prefValue).optional(),
  /**
   * One report's layout. `scopeKey` is what the client already computes for the report — the pair of person and
   * workspace — so the command does not guess it and two layouts in the same book cannot collide.
   */
  reportPreferences: z.object({
    scopeKey: text(200).min(1),
    workspaceId: text(200).min(1),
    preferences: z.record(z.string().trim().min(1).max(80), z.unknown()),
  }).strict().optional(),
}).strict();
type UserPreferencesInput = z.output<typeof userPreferencesInput>;

export type UserPreferencesResult = { changed: string[] };

export const userPreferencesCommand: CommandDefinition<typeof userPreferencesInput, UserPreferencesResult> = {
  name: 'user.preferences',
  input: userPreferencesInput,
  roles: ['owner'],
  scope: 'person',
  peopleOnly: true,
  async handler(ctx, tx, input: UserPreferencesInput) {
    if (input.notificationPrefs === undefined && input.reportPreferences === undefined) {
      throw Object.assign(new Error(
        'Nothing was sent to save: name the notices you want, or one report’s layout.',
      ), { code: 'INVALID_INPUT' });
    }
    const ref = ctx.db.collection('users').doc(ctx.actor);
    const snapshot = await tx.get(ref);
    const current = (snapshot.data() || {}) as Record<string, unknown>;
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { updatedAt: now };
    const changed: string[] = [];

    if (input.notificationPrefs !== undefined) {
      const existing = (current.notificationPrefs || {}) as Record<string, unknown>;
      patch.notificationPrefs = { ...existing, ...input.notificationPrefs };
      changed.push('notificationPrefs');
    }

    if (input.reportPreferences !== undefined) {
      const { scopeKey, workspaceId, preferences } = input.reportPreferences;
      // the map is re-written from the row this transaction read: one report's layout is added or replaced and
      // every other book's is carried over untouched. The owner fields come last — a layout may say anything about
      // how it looks, never about whose it is.
      const existing = (current.reportPreferences || {}) as Record<string, unknown>;
      patch.reportPreferences = {
        ...existing,
        [scopeKey]: { ...preferences, uid: ctx.actor, workspaceId, updatedAt: now },
      };
      changed.push(`reportPreferences.${scopeKey}`);
    }

    if (snapshot.exists) tx.update(ref, patch);
    // a person whose profile row has never been written (a tab that signed in and went straight to a report) gets
    // the same skeleton `user.provision` writes, with their settings on it, rather than a NOT_FOUND for a row they
    // never asked for
    else tx.set(ref, { uid: ctx.actor, email: ctx.email || '', role: 'client', createdAt: now, ...patch });
    return { changed };
  },
  async preview(ctx, input: UserPreferencesInput) {
    const lines: string[] = [];
    if (input.notificationPrefs) lines.push(`${Object.keys(input.notificationPrefs).length} notice setting(s)`);
    if (input.reportPreferences) lines.push(`the layout of the report kept as “${input.reportPreferences.scopeKey}”`);
    const snapshot = await ctx.db.collection('users').doc(ctx.actor).get();
    return {
      title: 'Change your own profile settings',
      lines: snapshot.exists ? lines : [...lines, 'Your profile row will be created with them'],
    };
  },
  audit(_input, result) {
    return {
      action: 'USER_PREFERENCES_CHANGED',
      entityType: 'users',
      entityId: 'self',
      description: `Changed their own profile settings (${result.changed.join(', ')})`,
      details: { changed: result.changed },
    };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Save the signed-in person’s own notice settings and report layouts on their profile; do not use it to change a workspace setting or someone else’s profile.',
    example: { notificationPrefs: { emailDigest: true, digestHour: 8 } },
    refusals: [
      { code: 'INVALID_INPUT', when: 'Nothing was named, or a notice is not a scalar or a report layout has no scope.', next: 'Send the notices, or one report’s scope key and layout.' },
      { code: 'UNAUTHENTICATED', when: 'The request has no signed-in person.', next: 'Sign in and run the command again.' },
    ],
    next: [{ command: 'workspace.settings', label: 'Change a setting the whole workspace shares' }],
  },
};
