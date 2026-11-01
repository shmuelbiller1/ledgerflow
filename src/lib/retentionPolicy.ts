/**
 * Pure retention defaults, bounds, and clamping helpers without Zod runtime overhead,
 * so client workspace and security surfaces do not bundle schema validators upfront.
 */
export interface RetentionSettings {
  /** Days a deleted workspace can be recovered before it is purged. */
  deletionGraceDays: number;
  /** Days the email send log is kept (bounces and spam complaints are always kept: never email them again). 0 = forever. */
  emailLogDays: number;
  /** Days browser error reports are kept. */
  errorLogDays: number;
  /** Litigation, audit or investigation: nothing is pruned or purged while on. */
  legalHold: boolean;
}

export const RETENTION_DEFAULTS: RetentionSettings = { deletionGraceDays: 30, emailLogDays: 730, errorLogDays: 90, legalHold: false };

export const RETENTION_LIMITS = {
  deletionGraceDays: { min: 30, max: 365 },
  emailLogDays: { min: 90, max: 3650 },
  errorLogDays: { min: 30, max: 365 },
} as const;

/** The workspace's settings, with defaults for what isn't set and anything out of range clamped. */
export function retentionFor(workspace: { retention?: Partial<RetentionSettings> | null } | null | undefined): RetentionSettings {
  const saved = workspace?.retention || {};
  const clamp = (key: keyof typeof RETENTION_LIMITS, value: unknown) => {
    const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : RETENTION_DEFAULTS[key];
    if (key === 'emailLogDays' && n === 0) return 0;
    return Math.min(RETENTION_LIMITS[key].max, Math.max(RETENTION_LIMITS[key].min, n));
  };
  return {
    deletionGraceDays: clamp('deletionGraceDays', saved.deletionGraceDays),
    emailLogDays: clamp('emailLogDays', saved.emailLogDays),
    errorLogDays: clamp('errorLogDays', saved.errorLogDays),
    legalHold: saved.legalHold === true,
  };
}

/** When a workspace deleted at `deletedAt` is purged under its settings. */
export function scheduledPurgeAt(workspace: { retention?: Partial<RetentionSettings> | null } | null | undefined, deletedAt: Date): string {
  return new Date(deletedAt.getTime() + retentionFor(workspace).deletionGraceDays * 86_400_000).toISOString();
}
