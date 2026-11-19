import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { requireLiveDb } from '../db/firestore';
import { processDeepAuditInBackground } from '../services/deepAuditWorker';
import { assertDeveloperUsageQuota } from '../services/developerUsageQuota';
import type { CommandDefinition } from './types';

const inputSchema = z.object({ payload: z.record(z.string(), z.unknown()).optional() }).strict();

export const deepAuditCommand: CommandDefinition<typeof inputSchema, { jobId: string }> = {
  name: 'audit.deep',
  input: inputSchema,
  roles: ['owner', 'accountant', 'bookkeeper'],
  allowPlatformAdmin: true,
  async authorizeInput(ctx) {
    if (!ctx.user.admin) await assertDeveloperUsageQuota(ctx.db, ctx.workspaceId, ctx.workspace);
  },
  async handler(ctx, tx, { payload }) {
    requireLiveDb(ctx.db, 'Queue a deep audit');
    const jobId = `job_${randomUUID().replace(/-/g, '')}`;
    tx.create(ctx.db.collection('deepAuditJobs').doc(jobId), {
      id: jobId, workspaceId: ctx.workspaceId, uid: ctx.actor, status: 'processing', progress: 10,
      createdAt: new Date().toISOString(), payload: payload || {},
    });
    const { db, workspaceId, actor } = ctx;
    // Preserve 202 semantics: start, but do not await, the existing worker. The runner discards
    // callbacks from failed transaction attempts and does not launch a worker for a replay.
    ctx.afterCommit(() => {
      void processDeepAuditInBackground(db, jobId, workspaceId, actor).catch(err => console.error('[Background deepAudit Exception]', jobId, err));
    });
    return { jobId };
  },
  async preview() {
    return { title: 'Run a strategic deep audit', lines: ['Queues a job; poll its status for the report.', 'The completed job charges 1,200 compute credits and does not post ledger entries.'] };
  },
  audit(_input, { jobId }) {
    return { action: 'DEEP_AUDIT_QUEUED', entityType: 'deepAuditJobs', entityId: jobId, description: 'Queued a strategic deep audit' };
  },
  risk: 'normal',
  describe: {
    sentence: 'Queue a metered deep audit of receivables, customer concentration, inventory margins and valuation; use it for an asynchronous analysis, not to post an entry.',
    example: {},
    refusals: [
      { code: 'ROLE_REQUIRED', when: 'The caller cannot write in the workspace.', next: 'Ask a workspace writer to run it.' },
      { code: 'PAYMENT_REQUIRED', when: 'The developer API credit balance is exhausted.', next: 'Restore the balance before queuing this metered job.' },
      { code: 'QUOTA_EXCEEDED', when: 'The developer API spending limit was reached.', next: 'Ask an administrator to review the workspace budget for compute jobs.' },
    ],
  },
};
