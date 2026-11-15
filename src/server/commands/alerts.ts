import { z } from 'zod';
import {
  alertSettingsAuditDescription,
  normalizeAlertSettings,
  saveAlertSettingsInTransaction,
  AlertSettingsError,
  type AlertSettingsWriteResult,
} from '../services/bookAlertService';
import { alertSettingsProblem, type AlertSettings } from '../../lib/bookAlerts';
import type { CommandDefinition } from './types';

export const alertSettingsUpdateInput = z.object({
  cashLowCents: z.number().int().nullable().optional(),
  closeReminderDay: z.number().int().nullable().optional(),
  budgetAlerts: z.boolean().optional(),
}).strict();

type AlertSettingsUpdateInput = z.output<typeof alertSettingsUpdateInput>;

function assertAlertSettings(input: AlertSettings): void {
  const problem = alertSettingsProblem(input);
  if (problem) throw new AlertSettingsError(400, problem, 'INVALID_ALERT_SETTINGS');
}

export const alertSettingsUpdateCommand: CommandDefinition<typeof alertSettingsUpdateInput, AlertSettingsWriteResult> = {
  name: 'alerts.update',
  input: alertSettingsUpdateInput,
  roles: ['owner', 'accountant'],
  async handler(ctx, tx, input: AlertSettingsUpdateInput) {
    return saveAlertSettingsInTransaction(ctx.db, tx, {
      workspaceId: ctx.workspaceId,
      uid: ctx.actor,
      alerts: input,
    });
  },
  async preview(ctx, input) {
    assertAlertSettings(input);
    const alerts = normalizeAlertSettings(input);
    return {
      title: 'Update book alert settings',
      lines: [alertSettingsAuditDescription(alerts, String(ctx.workspace.currency || 'USD'))],
    };
  },
  audit(_input, result) {
    return {
      action: 'ALERTS_SAVED',
      entityType: 'workspaces',
      entityId: result.workspaceId,
      description: alertSettingsAuditDescription(result.alerts, result.currency),
    };
  },
  inverse(_input, result) {
    return { command: 'alerts.update', input: result.previousAlerts };
  },
  risk: 'normal',
  describe: {
    sentence: 'Change when this workspace is reminded about closing its books, overspent budgets, or low cash; do not use this to change ledger entries.',
    example: { cashLowCents: 50000, closeReminderDay: 5, budgetAlerts: true },
    refusals: [
      { code: 'INVALID_INPUT', when: 'A setting has the wrong type or an unsupported field was supplied.', next: 'Send only cashLowCents, closeReminderDay, and budgetAlerts with the documented types.' },
      { code: 'INVALID_ALERT_SETTINGS', when: 'The cash amount or reminder day is outside its allowed range.', next: 'Use a nonnegative whole-cent cash amount and a reminder day from 1 to 28, or null to turn a setting off.' },
      { code: 'WORKSPACE_NOT_FOUND', when: 'The named workspace no longer exists.', next: 'Choose an existing workspace.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is not an owner or accountant.', next: 'Ask a workspace owner or accountant to change alert settings.' },
    ],
  },
};
