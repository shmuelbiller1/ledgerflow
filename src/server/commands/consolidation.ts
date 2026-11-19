import { z } from 'zod';
import type { Transaction, Workspace } from '../../types';
import { buildSelfProvingEliminations, computeMultiEntityCloseStatus } from '../../lib/selfBalancingDimensions';
import { isWorkspaceMemberData } from '../db/firestore';
import { roleInWorkspace } from '../middleware/requireLedgerWriter';
import { CommandRefusal } from '../utils/commandExecutor';
import type { CommandContext, CommandDefinition } from './types';

const eliminateInput = z.object({
  workspaceId: z.string().min(1).optional(),
  entityWorkspaceIds: z.array(z.string().min(1)).min(1).max(50).describe('Entity books to verify along with the primary workspace'),
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'asOfDate must be YYYY-MM-DD').optional(),
  reportingCurrency: z.string().min(3).max(8).optional().describe('Currency for consolidated totals; defaults to the primary workspace’s currency'),
  exchangeRates: z.record(z.string(), z.number().positive()).optional().describe('Positive rates for translating foreign entity books'),
});
type Input = z.output<typeof eliminateInput>;
const roles = ['owner', 'accountant', 'bookkeeper'] as const;
export const consolidationRoleError = 'Only owners, accountants and bookkeepers can run intercompany eliminations';

function entityIdsOf(workspaceId: string, input: Input) {
  return [...new Set([workspaceId, ...input.entityWorkspaceIds])];
}

function assertEntityAccess(user: CommandContext['user'], id: string, data: Record<string, unknown> | undefined): asserts data is Record<string, unknown> {
  if (user.developerWorkspaceId && user.developerWorkspaceId !== id) {
    throw new CommandRefusal(`Forbidden: API key is scoped strictly to workspace ${user.developerWorkspaceId}`, 403, 'WORKSPACE_SCOPE');
  }
  if (!data) throw new CommandRefusal('Workspace not found.', 404, 'WORKSPACE_NOT_FOUND');
  if (!isWorkspaceMemberData(data, user, id)) {
    throw new CommandRefusal('Unauthorized: You are not a member of this workspace.', 403, 'NOT_A_MEMBER');
  }
  if (!user.admin && !roles.some(role => role === roleInWorkspace(data, user.uid))) {
    throw new CommandRefusal(consolidationRoleError, 403, 'ROLE_REQUIRED');
  }
}

function verify(entityData: Array<{ workspace: Workspace; transactions: Transaction[] }>, input: Input) {
  const effectiveDate = input.asOfDate || new Date().toISOString().slice(0, 10);
  const translation = {
    reportingCurrency: input.reportingCurrency || entityData[0].workspace.currency || 'USD',
    exchangeRates: input.exchangeRates,
  };
  const report = buildSelfProvingEliminations(
    entityData.map(e => ({ workspaceId: e.workspace.id, currency: e.workspace.currency, transactions: e.transactions })),
    effectiveDate, translation,
  );
  return { report, closeStatus: computeMultiEntityCloseStatus(entityData, effectiveDate, translation), effectiveDate };
}

type Verification = ReturnType<typeof verify> & { workspaceId: string; entityWorkspaceIds: string[] };
export const consolidationVerifyCommand: CommandDefinition<typeof eliminateInput, Verification> = {
  name: 'consolidation.verify',
  input: eliminateInput,
  roles,
  allowPlatformAdmin: true,
  async authorizeInput(ctx, input) {
    // Check secondary books even on a replay; the cached result contains their figures.
    for (const id of entityIdsOf(ctx.workspaceId, input)) {
      if (id === ctx.workspaceId) continue;
      if (ctx.user.developerWorkspaceId) {
        throw new CommandRefusal(`Forbidden: API key is scoped strictly to workspace ${ctx.user.developerWorkspaceId}`, 403, 'WORKSPACE_SCOPE');
      }
      assertEntityAccess(ctx.user, id, (await ctx.db.collection('workspaces').doc(id).get()).data());
    }
  },
  async handler(ctx, tx, input) {
    const entityWorkspaceIds = entityIdsOf(ctx.workspaceId, input);
    const entityData = [];
    for (const id of entityWorkspaceIds) {
      const data = id === ctx.workspaceId ? ctx.workspace : (await tx.get(ctx.db.collection('workspaces').doc(id))).data();
      assertEntityAccess(ctx.user, id, data);
      const entries = await tx.get(ctx.db.collection('transactions').where('workspaceId', '==', id));
      entityData.push({ workspace: { ...(data as unknown as Workspace), id }, transactions: entries.docs.map(d => ({ ...(d.data() as Transaction), id: d.id })) });
    }
    return { workspaceId: ctx.workspaceId, entityWorkspaceIds, ...verify(entityData, input) };
  },
  async preview(ctx, input) {
    const count = entityIdsOf(ctx.workspaceId, input).length;
    return { title: 'Verify intercompany eliminations', lines: [`Checks ${count} ${count === 1 ? 'entity' : 'entities'} as of ${input.asOfDate || 'today'}.`, 'Records the verification in the audit trail; does not post entries or close a period.'] };
  },
  audit(_input, { workspaceId, entityWorkspaceIds, report, effectiveDate }) {
    return {
      action: 'CONSOLIDATION_ELIMINATIONS_VERIFIED', entityType: 'consolidation', entityId: workspaceId,
      description: `Verified intercompany eliminations across ${entityWorkspaceIds.length} entities as of ${effectiveDate}`,
      details: { entityWorkspaceIds, asOfDate: effectiveDate, selfProving: report.selfProving, matchedCount: report.matchedCount,
        discrepancyCount: report.discrepancyCount, totalEliminatedCents: report.totalEliminatedCents },
    };
  },
  risk: 'normal',
  describe: {
    sentence: 'Verify and audit intercompany eliminations and close status across authorized entity books; use it to check the figures, not to post elimination entries or close a period.',
    example: { entityWorkspaceIds: ['ws_subsidiary'], asOfDate: '2026-10-31', reportingCurrency: 'USD' },
    refusals: [
      { code: 'ROLE_REQUIRED', when: 'The caller cannot write in one of the requested books.', next: 'Ask for an appropriate role there or leave that book out.' },
      { code: 'WORKSPACE_SCOPE', when: 'A scoped key asks for more than its own book.', next: 'Use a person with access to all the books.' },
      { code: 'INVALID_INPUT', when: 'No entities were supplied or a date or exchange rate is invalid.', next: 'Supply the entities and check the date and exchange rates.' },
    ],
  },
};
