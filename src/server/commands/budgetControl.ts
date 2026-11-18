import { z } from 'zod';
import { BUDGET_CONTROLS, budgetControlOf, type BudgetControl } from '../services/budgetGuard';
import type { CommandDefinition } from './types';

export const budgetControlInput = z.object({
  budgetControl: z.enum(BUDGET_CONTROLS as [BudgetControl, ...BudgetControl[]]),
}).strict();
type BudgetControlResult = { workspaceId: string; before: BudgetControl; budgetControl: BudgetControl };

/** Change the posting policy and its audit in the runner's transaction. */
export const workspaceBudgetControlCommand: CommandDefinition<typeof budgetControlInput, BudgetControlResult> = {
  name: 'workspace.budgetcontrol', input: budgetControlInput, roles: ['owner'],
  async handler(ctx, tx, input) {
    const ref = ctx.db.collection('workspaces').doc(ctx.workspaceId);
    // The runner read and authorized this exact workspace snapshot in the transaction.
    const before = budgetControlOf(ctx.workspace);
    tx.update(ref, { budgetControl: input.budgetControl });
    return { workspaceId: ctx.workspaceId, before, budgetControl: input.budgetControl };
  },
  async preview(ctx, input) {
    return { title: 'Change budget control', lines: [`Change from ${budgetControlOf(ctx.workspace)} to ${input.budgetControl}`, 'Affects future posting checks, not existing entries'] };
  },
  audit(_input, result) {
    return { action: 'BUDGET_CONTROL_CHANGED', entityType: 'workspaces', entityId: result.workspaceId, description: `Budget control changed from ${result.before} to ${result.budgetControl}`, details: { from: result.before, to: result.budgetControl } };
  },
  inverse(_input, result) { return { command: 'workspace.budgetcontrol', input: { budgetControl: result.before } }; },
  risk: 'normal',
  describe: {
    sentence: 'Set whether over-budget posting is ignored, warned or blocked; do not use it to change a budget amount.',
    example: { budgetControl: 'block' },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The mode is not off, warn or block.', next: 'Choose one of the three modes.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is not the workspace owner.', next: 'Ask the owner to change this setting.' },
    ],
  },
};
