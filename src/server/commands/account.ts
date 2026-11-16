import { z } from 'zod';
import { EMAIL_MODE_LABEL, EMAIL_MODES, type NotificationEmailMode } from '../../lib/notificationEmail';
import { getNotificationEmail, setNotificationEmailInTransaction } from '../services/notificationEmailService';
import {
  buildRecoveryCodes, prepareUseRecoveryCode, RecoveryError, recoveryStatus, removeAuthenticators, spendRecoveryCode, verifiedFactors,
} from '../services/recoveryCodeService';
import { COMMAND_ROLES, type CommandDefinition } from './types';

/**
 * The person's own account (L-85 recovery codes, S-18 notice emails): `scope: 'person'` commands —
 * the runner asks for a signed-in person only, audits under `person:<uid>`, and no workspace gates
 * or grants the write. Every person may run them on their own account, whatever their workspace
 * roles, so `roles` lists all of them.
 */

export const accountMakeRecoveryCodesInput = z.object({}).strict();
export type AccountMakeRecoveryCodesResult = { codes: string[]; uid: string };

const NO_FACTOR = 'Turn on two-step login first; recovery codes are for when the authenticator is lost';

export const accountMakeRecoveryCodesCommand: CommandDefinition<typeof accountMakeRecoveryCodesInput, AccountMakeRecoveryCodesResult> = {
  name: 'account.makerecoverycodes',
  input: accountMakeRecoveryCodesInput,
  roles: COMMAND_ROLES,
  scope: 'person',
  async prepare(ctx) {
    if ((await verifiedFactors(ctx.db, ctx.actor)).length === 0) throw new RecoveryError(409, NO_FACTOR);
  },
  async handler(ctx, tx) {
    const { codes, stored } = buildRecoveryCodes(ctx.actor);
    tx.set(ctx.db.collection('recoveryCodes').doc(ctx.actor), stored);
    // The codes are shown once, so they are *not* part of the handler result: the runner saves that
    // result as the idempotency record for a month, which would put ten working two-step bypass codes
    // in plain text in the database and its backups. Only the uid is recorded; a retry replays the
    // uid and gets no codes, so the route answers it with the "make new ones" refusal below.
    ctx.afterCommit(() => ({ codes }));
    return { uid: ctx.actor } as AccountMakeRecoveryCodesResult;
  },
  async preview(ctx) {
    const [status, factors] = await Promise.all([recoveryStatus(ctx.db, ctx.actor), verifiedFactors(ctx.db, ctx.actor)]);
    if (factors.length === 0) throw new RecoveryError(409, NO_FACTOR);
    return {
      title: 'Make ten new recovery codes',
      lines: [
        status.total === 0
          ? 'You have no recovery codes yet'
          : `${status.left} of ${status.total} recovery codes are left`,
        'The ten new codes replace all earlier ones; they are shown once and only their keyed hashes are kept',
      ],
    };
  },
  audit(_input, result) {
    return {
      action: 'ACCOUNT_RECOVERY_CODES_CREATED',
      entityType: 'recoveryCodes',
      entityId: result.uid,
      description: 'Ten new recovery codes made; any earlier ones stopped working',
    };
  },
  risk: 'normal',
  describe: {
    sentence: 'Make ten new one-time recovery codes for two-step login, replacing any earlier ones; do not use it to sign in — that is account.userecoverycode.',
    example: {},
    refusals: [
      { code: 'CONFLICT', when: 'Two-step login is off, so there is no authenticator to recover from.', next: 'Turn on two-step login first, then make recovery codes.' },
      { code: 'INVALID_INPUT', when: 'The input carries unexpected fields.', next: 'Send an empty input object.' },
      { code: 'UNAUTHENTICATED', when: 'The request has no signed-in person.', next: 'Sign in and run the command again.' },
    ],
    next: [{ command: 'account.userecoverycode', label: 'Use a recovery code when the authenticator is lost' }],
  },
};

export const accountUseRecoveryCodeInput = z.object({ code: z.string().min(1, 'Enter a recovery code') }).strict();
export type AccountUseRecoveryCodeInput = z.output<typeof accountUseRecoveryCodeInput>;
export type AccountUseRecoveryCodeResult = { left: number; uid: string };

export const accountUseRecoveryCodeCommand: CommandDefinition<typeof accountUseRecoveryCodeInput, AccountUseRecoveryCodeResult> = {
  name: 'account.userecoverycode',
  input: accountUseRecoveryCodeInput,
  roles: COMMAND_ROLES,
  scope: 'person',
  // The checks and the spend read the same rows, so they run in that order: the lockout and whether
  // the code is an unused one (a wrong one is counted here, because the refusal that follows rolls
  // the runner's transaction back), then the spend inside the runner's own transaction, so the spent
  // code, the idempotency record and the audit entry commit together. Removing the authenticator
  // stays an after-commit step: it reaches Supabase's auth tables, which no books transaction covers.
  async prepare(ctx, input: AccountUseRecoveryCodeInput) {
    await prepareUseRecoveryCode(ctx.db, ctx.actor, input.code);
  },
  async handler(ctx, tx, input: AccountUseRecoveryCodeInput) {
    const { left } = await spendRecoveryCode(ctx.db, tx, ctx.actor, input.code);
    // The authenticator is removed only once the spend, the idempotency record and the audit entry
    // have committed: a rolled-back attempt leaves it, and the code, in place. A retry that replays
    // the committed result runs no handler at all, so this never removes a second one.
    ctx.afterCommit(() => removeAuthenticators(ctx.db, ctx.actor));
    return { left, uid: ctx.actor };
  },
  async preview(ctx) {
    const status = await recoveryStatus(ctx.db, ctx.actor);
    return {
      title: 'Use a recovery code',
      lines: [
        `${status.left} of ${status.total} recovery codes are left`,
        'A right code is used up and removes the authenticator: sign in with the password and set two-step login up again',
        'Five wrong codes in an hour lock the step for that hour',
      ],
    };
  },
  audit(_input, result) {
    return {
      action: 'ACCOUNT_RECOVERY_CODE_USED',
      entityType: 'recoveryCodes',
      entityId: result.uid,
      description: `A recovery code was used and the authenticator removed; ${result.left} codes left`,
      details: { left: result.left },
    };
  },
  risk: 'normal',
  describe: {
    sentence: 'Spend one recovery code after a lost authenticator: it removes two-step login so a password-only session gets in; do not use it while the authenticator is still available.',
    example: { code: 'abcde-fghij' },
    refusals: [
      { code: 'INVALID_INPUT', when: 'No recovery code was sent.', next: 'Send the code as { code }.' },
      { code: 'RECOVERY_CODE_REJECTED', when: 'The code is wrong or was used before.', next: 'Check the code and try another unused one; a retried request with the same operation key replays instead.' },
      { code: 'RECOVERY_RATE_LIMITED', when: 'Five wrong codes were tried within the hour.', next: 'Wait an hour, then try again.' },
      { code: 'UNAUTHENTICATED', when: 'The request has no signed-in session (a password-only one is enough).', next: 'Sign in with the password first.' },
    ],
    next: [{ command: 'account.makerecoverycodes', label: 'Make fresh recovery codes once two-step login is on again' }],
  },
};

const notificationModeInput = z.enum(EMAIL_MODES as [NotificationEmailMode, ...NotificationEmailMode[]]);
export const accountSetNotificationEmailInput = z.object({ mode: notificationModeInput }).strict();
export type AccountSetNotificationEmailResult = { mode: NotificationEmailMode; previousMode: NotificationEmailMode; uid: string };

export const accountSetNotificationEmailCommand: CommandDefinition<typeof accountSetNotificationEmailInput, AccountSetNotificationEmailResult> = {
  name: 'account.setnotificationemail',
  input: accountSetNotificationEmailInput,
  roles: COMMAND_ROLES,
  scope: 'person',
  async handler(ctx, tx, input) {
    const result = await setNotificationEmailInTransaction(ctx.db, tx, ctx.actor, input.mode);
    return { ...result, uid: ctx.actor };
  },
  async preview(ctx, input) {
    const current = await getNotificationEmail(ctx.db, ctx.actor);
    return {
      title: 'Change notice emails',
      lines: [
        `Today: ${EMAIL_MODE_LABEL[current]}`,
        `After: ${EMAIL_MODE_LABEL[input.mode]}`,
        ...(input.mode === current ? ['Nothing changes: that is the choice already'] : []),
      ],
    };
  },
  audit(_input, result) {
    if (result.mode === result.previousMode) return null;
    return {
      action: 'ACCOUNT_NOTIFICATION_EMAIL_SET',
      entityType: 'users',
      entityId: result.uid,
      description: `Notice emails: ${result.previousMode} → ${result.mode}`,
      details: { mode: result.mode, previousMode: result.previousMode },
    };
  },
  inverse(_input, result) {
    return { command: 'account.setnotificationemail', input: { mode: result.previousMode } };
  },
  risk: 'normal',
  describe: {
    sentence: 'Choose whether the bell\'s notices also arrive by email (off, each as it happens, or one summary a day); do not use it for marketing or workspace billing emails, which this choice does not govern.',
    example: { mode: 'daily' },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The mode is not off, immediate or daily.', next: 'Choose off, immediate or daily.' },
      { code: 'UNAUTHENTICATED', when: 'The request has no signed-in person.', next: 'Sign in and run the command again.' },
    ],
  },
};
