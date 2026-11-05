/**
 * Per-workspace retention settings (L-08) and legal hold (BJ-05). The books themselves are kept
 * as long as the workspace exists (accounting law); what a workspace can tune is how long the
 * logs around them are kept and how long a deleted workspace can still be recovered. A legal
 * hold stops all of it: nothing is pruned and a deleted workspace is never purged.
 * Shared by the server (enforcement) and Settings (the form).
 */
import { z } from 'zod';
import {
  RETENTION_DEFAULTS,
  RETENTION_LIMITS,
  retentionFor,
  scheduledPurgeAt,
  type RetentionSettings,
} from './retentionPolicy';

export { RETENTION_DEFAULTS, RETENTION_LIMITS, retentionFor, scheduledPurgeAt, type RetentionSettings };

const days = (key: keyof typeof RETENTION_LIMITS) => z.number().int().min(RETENTION_LIMITS[key].min).max(RETENTION_LIMITS[key].max);

export const RetentionSettingsSchema = z.object({
  deletionGraceDays: days('deletionGraceDays'),
  emailLogDays: z.union([z.literal(0), days('emailLogDays')]),
  errorLogDays: days('errorLogDays'),
  legalHold: z.boolean(),
}).strict();
